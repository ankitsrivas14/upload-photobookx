import { useState, useEffect } from 'react';
import { api } from '../services/api';
import toast from 'react-hot-toast';
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

  const formatINR = (n: number) =>
    '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Fixed Monthly Expenses</h2>
          <p className={styles.subtitle}>Recurring costs deducted from that month's profit on the Sales page</p>
        </div>
      </div>

      <div className={styles.monthRow}>
        <label className={styles.monthLabel}>Month</label>
        <input
          type="month"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className={styles.monthInput}
        />
      </div>

      {/* Add new expense */}
      <div className={styles.addRow}>
        <input
          type="text"
          placeholder="Expense label (e.g. Office Rent)"
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          className={styles.labelInput}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <input
          type="number"
          placeholder="Amount (₹)"
          value={newAmount}
          onChange={e => setNewAmount(e.target.value)}
          className={styles.amountInput}
          min="0"
          step="0.01"
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          className={styles.addBtn}
          onClick={handleAdd}
          disabled={isAdding || !newLabel.trim() || !newAmount}
        >
          + Add
        </button>
      </div>

      {/* Expense list */}
      <div className={styles.tableWrap}>
        {isLoading ? (
          <div className={styles.emptyState}>Loading…</div>
        ) : expenses.length === 0 ? (
          <div className={styles.emptyState}>No expenses for this month. Add one above.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLabel}>EXPENSE</th>
                <th className={styles.thAmount}>AMOUNT</th>
                <th className={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(e => (
                <tr key={e._id}>
                  <td className={styles.tdLabel}>
                    {editingId === e._id ? (
                      <input
                        className={styles.editInput}
                        value={editLabel}
                        onChange={ev => setEditLabel(ev.target.value)}
                        autoFocus
                      />
                    ) : (
                      e.label
                    )}
                  </td>
                  <td className={styles.tdAmount}>
                    {editingId === e._id ? (
                      <input
                        type="number"
                        className={`${styles.editInput} ${styles.editAmountInput}`}
                        value={editAmount}
                        onChange={ev => setEditAmount(ev.target.value)}
                        min="0"
                        step="0.01"
                      />
                    ) : (
                      formatINR(e.amount)
                    )}
                  </td>
                  <td className={styles.tdActions}>
                    {editingId === e._id ? (
                      <>
                        <button className={styles.saveBtn} onClick={() => saveEdit(e._id)}>Save</button>
                        <button className={styles.cancelBtn} onClick={cancelEdit}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className={styles.editBtn} onClick={() => startEdit(e)}>Edit</button>
                        <button className={styles.deleteBtn} onClick={() => handleDelete(e._id)}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14H6L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4h6v2" />
                          </svg>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={styles.totalLabel}>Total</td>
                <td className={styles.totalAmount}>{formatINR(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
