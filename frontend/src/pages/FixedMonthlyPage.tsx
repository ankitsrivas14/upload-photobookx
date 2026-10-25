import { useState, useEffect } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Button, Card, EmptyState, Skeleton } from '../components/ui/pbx';
import { cx, formatINR } from '../components/ui/format';
import styles from './FixedMonthlyPage.module.css';

interface Expense {
  _id: string;
  month: string;
  label: string;
  amount: number;
}

function toMonthInput(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
}

export function FixedMonthlyPage() {
  const [selectedMonth, setSelectedMonth] = useState<string>(() => toMonthInput(new Date()));
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // New entry form
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAmount, setEditAmount] = useState('');

  useEffect(() => {
    loadExpenses();
  }, [selectedMonth]);

  const loadExpenses = async () => {
    setIsLoading(true);
    try {
      const res = await api.getFixedMonthlyExpenses(selectedMonth);
      if (res.success) setExpenses(res.entries);
    } catch {
      toast.error('Failed to load expenses');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newLabel.trim() || !newAmount) return;
    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount < 0) { toast.error('Enter a valid amount'); return; }
    setIsAdding(true);
    try {
      const res = await api.createFixedMonthlyExpense({ month: selectedMonth, label: newLabel.trim(), amount });
      if (res.success) {
        setExpenses(prev => [...prev, res.entry]);
        setNewLabel('');
        setNewAmount('');
        toast.success('Expense added');
      }
    } catch {
      toast.error('Failed to add expense');
    } finally {
      setIsAdding(false);
    }
  };

  const startEdit = (e: Expense) => {
    setEditingId(e._id);
    setEditLabel(e.label);
    setEditAmount(String(e.amount));
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (id: string) => {
    const amount = parseFloat(editAmount);
    if (!editLabel.trim() || isNaN(amount) || amount < 0) { toast.error('Enter valid values'); return; }
    try {
      const res = await api.updateFixedMonthlyExpense(id, { label: editLabel.trim(), amount });
      if (res.success) {
        setExpenses(prev => prev.map(e => e._id === id ? res.entry : e));
        setEditingId(null);
        toast.success('Updated');
      }
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteFixedMonthlyExpense(id);
      setExpenses(prev => prev.filter(e => e._id !== id));
      toast.success('Deleted');
    } catch {
      toast.error('Failed to delete');
    }
  };

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const money = (n: number) => formatINR(n, { decimals: 2 });
  const monthLabel = new Date(`${selectedMonth}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <Card
      title={`Fixed monthly costs · ${monthLabel}`}
      eyebrow="deducted from that month's profit on the Sales page"
      padding="sm"
      actions={
        <label className={styles.monthField}>
          <span>Month</span>
          <span className="pbx-input pbx-input--sm">
            <input type="month" value={selectedMonth} onChange={e => e.target.value && setSelectedMonth(e.target.value)} />
          </span>
        </label>
      }
    >
      {/* Add a cost: Enter in either field adds it */}
      <div className={styles.addRow}>
        <span className="pbx-input pbx-input--sm">
          <input
            type="text"
            placeholder="Label, e.g. Office rent"
            aria-label="New cost label"
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
        </span>
        <span className="pbx-input pbx-input--sm">
          <span className="pbx-input__affix">₹</span>
          <input
            type="number"
            placeholder="Amount"
            aria-label="New cost amount"
            value={newAmount}
            onChange={e => setNewAmount(e.target.value)}
            min="0"
            step="0.01"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
        </span>
        <Button size="sm" variant="primary" icon="plus" onClick={handleAdd} loading={isAdding} disabled={!newLabel.trim() || !newAmount}>
          Add
        </Button>
      </div>

      {isLoading ? (
        <Skeleton lines={4} />
      ) : expenses.length === 0 ? (
        <EmptyState size="sm" icon="receipt" title="No fixed costs this month" description="Add rent, salaries or subscriptions above." />
      ) : (
        <div className="pbx-table">
          <div className="pbx-table__scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Cost</th>
                  <th scope="col" className={styles.right}>Amount</th>
                  <th scope="col"><span className="pbx-sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map(e => (
                  <tr key={e._id}>
                    <td>
                      {editingId === e._id ? (
                        <span className="pbx-input pbx-input--sm">
                          <input aria-label="Cost label" value={editLabel} onChange={ev => setEditLabel(ev.target.value)} autoFocus />
                        </span>
                      ) : (
                        e.label
                      )}
                    </td>
                    <td className={cx('pbx-num', styles.right)}>
                      {editingId === e._id ? (
                        <span className={cx('pbx-input pbx-input--sm', styles.amountInput)}>
                          <span className="pbx-input__affix">₹</span>
                          <input
                            type="number"
                            aria-label="Cost amount"
                            value={editAmount}
                            onChange={ev => setEditAmount(ev.target.value)}
                            min="0"
                            step="0.01"
                          />
                        </span>
                      ) : (
                        money(e.amount)
                      )}
                    </td>
                    <td>
                      <div className={styles.actions}>
                        {editingId === e._id ? (
                          <>
                            <Button size="sm" variant="primary" onClick={() => saveEdit(e._id)}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => startEdit(e)}>Edit</Button>
                            <Button size="sm" variant="ghost" iconOnly icon="trash-2" title="Delete" onClick={() => handleDelete(e._id)}>
                              {`Delete ${e.label}`}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={styles.total}>
                  <td>Total</td>
                  <td className={cx('pbx-num', styles.right)}>{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
