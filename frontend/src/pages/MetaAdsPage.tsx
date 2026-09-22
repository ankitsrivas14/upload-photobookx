import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
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
      alert('Please enter a valid amount');
      return;
    }

    if (!adSpendDate) {
      alert('Please select a date');
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
        alert(response.error || 'Failed to add daily ad spend');
      }
    } catch (err) {
      console.error('Failed to add daily ad spend:', err);
      alert('Failed to add daily ad spend');
    } finally {
      setIsSubmittingAdSpend(false);
    }
  };

  const handleDeleteAdSpend = async (entryId: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) {
      return;
    }

    try {
      const response = await api.deleteDailyAdSpend(entryId);
      if (response.success) {
        setDailyAdSpendEntries(dailyAdSpendEntries.filter(e => e.id !== entryId));
      } else {
        alert(response.error || 'Failed to delete entry');
      }
    } catch (err) {
      console.error('Failed to delete entry:', err);
      alert('Failed to delete entry');
    }
  };

  if (isLoading) {
    return (
      <div className={styles['loading-section']}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles['meta-ads-page-wrapper']}>
      <div className={styles['meta-ads-page']}>
      <div className={styles['content-section']}>
        {/* Daily Ad Spend Section */}
        <div className={styles['daily-ad-spend-section']}>
          <div className={styles['section-header']} style={{ marginTop: '2rem' }}>
            <h3>Daily Ad Spend (From Meta)</h3>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginTop: '0.25rem' }}>
              Track actual daily spend from Meta Ads dashboard
            </p>
          </div>

          {/* Add Daily Ad Spend Form */}
          <div className={styles['add-expense-form']} style={{ marginTop: '1rem' }}>
            <form onSubmit={handleSubmitAdSpend}>
              <div className={styles['form-row']}>
                <div className={styles['form-group']}>
                  <label>Date</label>
                  <input
                    type="date"
                    value={adSpendDate}
                    onChange={(e) => setAdSpendDate(e.target.value)}
                    required
                  />
                </div>

                <div className={styles['form-group']}>
                  <label>Amount Spent (₹)</label>
                  <div className={styles['input-with-prefix']}>
                    <span className={styles['input-prefix']}>₹</span>
                    <input
                      type="number"
                      placeholder="0.00"
                      value={adSpendAmount}
                      onChange={(e) => setAdSpendAmount(e.target.value)}
                      step="0.01"
                      min="0"
                      required
                    />
                  </div>
                </div>

                <div className={styles['form-group']}>
                  <label>Notes (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g., Campaign name, notes..."
                    value={adSpendNotes}
                    onChange={(e) => setAdSpendNotes(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles['form-actions']}>
                <button type="submit" className={styles['submit-btn']} disabled={isSubmittingAdSpend}>
                  {isSubmittingAdSpend ? (
                    <>
                      <div className={styles['btn-loader']}></div>
                      Adding...
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                      Add Daily Spend
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Daily Ad Spend List */}
          <div className={styles['expenses-list']} style={{ marginTop: '1.5rem' }}>
            <div className={styles['list-header']}>
              <h3>Daily Spend History</h3>
              <span className={styles['entry-count']}>{dailyAdSpendEntries.length} entries</span>
            </div>

            {dailyAdSpendEntries.length === 0 ? (
              <div className={styles['empty-state']}>
                <div className={styles['empty-icon']}>📊</div>
                <div className={styles['empty-text']}>No daily spend entries yet</div>
              </div>
            ) : (
              <div className={styles['table-card']}>
                <table className={styles['data-table']}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Amount Spent</th>
                      <th>Daily Amount Spent</th>
                      <th>Change (%)</th>
                      <th>Notes</th>
                      <th>Added On</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyAdSpendEntries.map(entry => (
                      <tr key={entry.id}>
                        <td>
                          <strong>
                            {new Date(entry.date).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric'
                            })}
                          </strong>
                        </td>
                        <td>
                          <span className={styles['amount-cell']}>
                            {entry.amount > 0
                              ? `₹${entry.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </span>
                        </td>
                        <td>
                          <span className={styles['amount-cell']}>
                            {entry.dailyAmountSpent != null
                              ? `₹${entry.dailyAmountSpent.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : '—'}
                          </span>
                        </td>
                        <td>
                          {entry.amount > 0 && entry.dailyAmountSpent != null ? (() => {
                            const percentageChange = ((entry.dailyAmountSpent - entry.amount) / entry.amount) * 100;
                            if (Math.abs(percentageChange) <= 1) return '—';

                            return (
                              <span
                                className={styles['amount-cell']}
                                style={{ color: percentageChange > 0 ? '#dc2626' : percentageChange < 0 ? '#059669' : '#64748b' }}
                              >
                                {percentageChange > 0 ? '+' : ''}{percentageChange.toFixed(2)}%
                              </span>
                            );
                          })() : '—'}
                        </td>
                        <td>
                          <span className={styles['notes-cell']}>
                            {entry.notes || '-'}
                          </span>
                        </td>
                        <td className={styles['date-cell']}>
                          {new Date(entry.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td>
                          <button
                            className={styles['delete-btn']}
                            onClick={() => handleDeleteAdSpend(entry.id)}
                            title="Delete entry"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 6h18"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>
                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}
