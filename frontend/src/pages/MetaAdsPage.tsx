import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import { Button, Card, Dialog, EmptyState, Skeleton, TextField } from '../components/ui/pbx';
import { cx, formatINR } from '../components/ui/format';
import styles from './MetaAdsPage.module.css';

interface DailyAdSpend {
  id: string;
  date: string;
  amount: number;
  dailyAmountSpent?: number | null;
  notes: string;
  createdAt: string;
}

export function MetaAdsPage() {
  const [isLoading, setIsLoading] = useState(true);

  // Daily Ad Spend state
  const [dailyAdSpendEntries, setDailyAdSpendEntries] = useState<DailyAdSpend[]>([]);
  const [adSpendDate, setAdSpendDate] = useState(new Date().toISOString().split('T')[0]);
  const [adSpendAmount, setAdSpendAmount] = useState('');
  const [adSpendNotes, setAdSpendNotes] = useState('');
  const [isSubmittingAdSpend, setIsSubmittingAdSpend] = useState(false);
  // The entry waiting for a delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const adSpendRes = await api.getDailyAdSpend();

      if (adSpendRes.success && adSpendRes.entries) {
        setDailyAdSpendEntries(adSpendRes.entries);
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Daily Ad Spend handlers
  const handleSubmitAdSpend = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!adSpendAmount || parseFloat(adSpendAmount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!adSpendDate) {
      toast.error('Please select a date');
      return;
    }

    setIsSubmittingAdSpend(true);
    try {
      const response = await api.createDailyAdSpend({
        date: adSpendDate,
        amount: parseFloat(adSpendAmount),
        notes: adSpendNotes.trim() || undefined,
      });

      if (response.success && response.entry) {
        setDailyAdSpendEntries([response.entry, ...dailyAdSpendEntries]);
        // Reset form
        setAdSpendAmount('');
        setAdSpendNotes('');
      } else {
        toast.error(response.error || 'Failed to add daily ad spend');
      }
    } catch (err) {
      console.error('Failed to add daily ad spend:', err);
      toast.error('Failed to add daily ad spend');
    } finally {
      setIsSubmittingAdSpend(false);
    }
  };

  const handleDeleteAdSpend = async (entryId: string) => {
    try {
      const response = await api.deleteDailyAdSpend(entryId);
      if (response.success) {
        setDailyAdSpendEntries(dailyAdSpendEntries.filter(e => e.id !== entryId));
      } else {
        toast.error(response.error || 'Failed to delete entry');
      }
    } catch (err) {
      console.error('Failed to delete entry:', err);
      toast.error('Failed to delete entry');
    }
  };

  const dateLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <Card title="Add daily spend" eyebrow="actual daily spend from the Meta Ads dashboard">
        <form onSubmit={handleSubmitAdSpend} className={styles.form}>
          <TextField label="Date" type="date" required value={adSpendDate} onChange={(e) => setAdSpendDate(e.target.value)} />
          <TextField
            label="Amount spent"
            type="number"
            required
            min="0"
            step="0.01"
            prefix="₹"
            placeholder="0.00"
            value={adSpendAmount}
            onChange={(e) => setAdSpendAmount(e.target.value)}
          />
          <TextField
            label="Notes"
            placeholder="Campaign name, notes…"
            className={styles.notes}
            value={adSpendNotes}
            onChange={(e) => setAdSpendNotes(e.target.value)}
          />
          <Button type="submit" variant="primary" icon="plus" loading={isSubmittingAdSpend}>Add spend</Button>
        </form>
      </Card>

      <Card title="Daily spend history" eyebrow={isLoading ? undefined : `${dailyAdSpendEntries.length} entries`} padding="sm">
        {isLoading ? (
          <Skeleton lines={6} />
        ) : dailyAdSpendEntries.length === 0 ? (
          <EmptyState size="sm" icon="indian-rupee" title="No daily spend yet" description="Add the first day's spend above." />
        ) : (
          <div className="pbx-table">
            <div className="pbx-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className={styles.right}>Amount spent</th>
                    <th scope="col" className={styles.right}>Daily amount spent</th>
                    <th scope="col" className={styles.right}>Change</th>
                    <th scope="col" className={styles.notesCol}>Notes</th>
                    <th scope="col">Added on</th>
                    <th scope="col"><span className="pbx-sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {dailyAdSpendEntries.map(entry => {
                    // Change from the entered amount to Meta's daily amount; within ±1% shows as a dash
                    const change = entry.amount > 0 && entry.dailyAmountSpent != null
                      ? ((entry.dailyAmountSpent - entry.amount) / entry.amount) * 100
                      : null;
                    return (
                      <tr key={entry.id}>
                        <td className={styles.strong}>{dateLabel(entry.date)}</td>
                        <td className={cx('pbx-num', styles.right)}>{entry.amount > 0 ? formatINR(entry.amount, { decimals: 2 }) : '—'}</td>
                        <td className={cx('pbx-num', styles.right)}>{entry.dailyAmountSpent != null ? formatINR(entry.dailyAmountSpent, { decimals: 2 }) : '—'}</td>
                        <td className={cx('pbx-num', styles.right)}>
                          {change === null || Math.abs(change) <= 1 ? (
                            <span className="pbx-amount--none">—</span>
                          ) : (
                            // More spend than entered reads as a loss
                            <span className={change > 0 ? styles.up : styles.down}>
                              {change > 0 ? '▲ ' : '▼ '}{`${Math.abs(change).toFixed(2)}%`}
                            </span>
                          )}
                        </td>
                        <td className={styles.muted}>{entry.notes || '—'}</td>
                        <td className={styles.date}>
                          {new Date(entry.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td>
                          <div className={styles.actions}>
                            <Button size="sm" variant="ghost" iconOnly icon="trash-2" title="Delete entry" onClick={() => setDeleteId(entry.id)}>
                              {`Delete the entry for ${dateLabel(entry.date)}`}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        size="sm"
        tone="negative"
        icon="triangle-alert"
        title="Delete this entry?"
        description="The day's spend is removed from the history."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { const id = deleteId; setDeleteId(null); if (id) handleDeleteAdSpend(id); }}>Delete</Button>
          </>
        }
      />
    </>
  );
}
