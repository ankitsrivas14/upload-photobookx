import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './MetaAdsPage.css';

interface ExpenseSource {
  id: string;
  name: string;
  category: string;
  createdAt: string;
}

interface MetaAdsExpense {
  id: string;
  amount: number;
  date: string;
  sourceId: string;
  sourceName: string;
  notes?: string;
  createdAt: string;
}

export function MetaAdsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [expenses, setExpenses] = useState<MetaAdsExpense[]>([]);
  const [sources, setSources] = useState<ExpenseSource[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [isAddingSource, setIsAddingSource] = useState(false);

  // Form state
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [expensesRes, sourcesRes] = await Promise.all([
        api.getMetaAdsExpenses(),
        api.getExpenseSources(),
      ]);

      if (expensesRes.success && expensesRes.expenses) {
        setExpenses(expensesRes.expenses);
      }

      if (sourcesRes.success && sourcesRes.sources) {
        setSources(sourcesRes.sources);
        if (sourcesRes.sources.length > 0 && !selectedSourceId) {
          setSelectedSourceId(sourcesRes.sources[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddSource = async () => {
    if (!newSourceName.trim()) {
      alert('Please enter a source name');
      return;
    }

    setIsAddingSource(true);
    try {
      const response = await api.createExpenseSource(newSourceName.trim());
      if (response.success && response.source) {
        setSources([...sources, response.source]);
        setSelectedSourceId(response.source.id);
        setNewSourceName('');
        setShowAddSourceModal(false);
      } else {
        alert(response.error || 'Failed to create source');
      }
    } catch (err) {
      console.error('Failed to create source:', err);
      alert('Failed to create source');
    } finally {
      setIsAddingSource(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!amount || parseFloat(amount) <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (!date) {
      alert('Please select a date');
      return;
    }

    if (!selectedSourceId) {
      alert('Please select a source');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await api.createMetaAdsExpense({
        amount: parseFloat(amount),
        date,
        sourceId: selectedSourceId,
        notes: notes.trim() || undefined,
      });

      if (response.success && response.expense) {
        setExpenses([response.expense, ...expenses]);
        // Reset form
        setAmount('');
        setDate(new Date().toISOString().split('T')[0]);
        setNotes('');
      } else {
        alert(response.error || 'Failed to create expense');
      }
    } catch (err) {
      console.error('Failed to create expense:', err);
      alert('Failed to create expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!confirm('Are you sure you want to delete this expense entry?')) {
      return;
    }

    try {
      const response = await api.deleteMetaAdsExpense(expenseId);
      if (response.success) {
        setExpenses(expenses.filter(e => e.id !== expenseId));
      } else {
        alert(response.error || 'Failed to delete expense');
      }
    } catch (err) {
      console.error('Failed to delete expense:', err);
      alert('Failed to delete expense');
    }
  };

  const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  if (isLoading) {
    return (
      <div className="loading-section">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="meta-ads-page">
      <div className="content-section">
        <div className="section-header">
          <h2>Meta Ads Expenses</h2>
          <p>Track and manage your Meta (Facebook/Instagram) advertising expenses</p>
        </div>

        {/* Stats */}
        <div className="expense-stats">
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#e0f2fe', color: '#0284c7' }}>
              ₹
            </div>
            <div className="stat-content">
              <div className="stat-value">₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="stat-label">Total Expenses</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon" style={{ backgroundColor: '#f3f0ff', color: '#7c3aed' }}>
              📊
            </div>
            <div className="stat-content">
              <div className="stat-value">{expenses.length}</div>
              <div className="stat-label">Total Entries</div>
            </div>
          </div>
        </div>

        {/* Add Expense Form */}
        <div className="add-expense-form">
          <h3>Add New Expense</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Amount (₹)</label>
                <div className="input-with-prefix">
                  <span className="input-prefix">₹</span>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Source</label>
                <div className="source-select-wrapper">
                  <select
                    value={selectedSourceId}
                    onChange={(e) => setSelectedSourceId(e.target.value)}
                    required
                  >
                    <option value="">Select source...</option>
                    {sources.map(source => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="add-source-btn"
                    onClick={() => setShowAddSourceModal(true)}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add
                  </button>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label>Notes (Optional)</label>
              <input
                type="text"
                placeholder="Add any notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <button type="submit" className="submit-btn" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <div className="btn-loader"></div>
                  Adding...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Expense
                </>
              )}
            </button>
          </form>
        </div>

        {/* Expenses List */}
        <div className="expenses-list">
          <div className="list-header">
            <h3>Expense History</h3>
            <span className="entry-count">{expenses.length} entries</span>
          </div>

          {expenses.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">📝</div>
              <div className="empty-text">No expenses logged yet</div>
            </div>
          ) : (
            <div className="table-card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Source</th>
                    <th>Notes</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="date-cell">
                        {new Date(expense.date).toLocaleDateString('en-IN', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="amount-cell">
                        ₹{expense.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <span className="source-badge">{expense.sourceName}</span>
                      </td>
                      <td className="notes-cell">
                        {expense.notes || <span className="no-notes">—</span>}
                      </td>
                      <td className="date-cell">
                        {new Date(expense.createdAt).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td>
                        <button
                          className="delete-btn"
                          onClick={() => handleDeleteExpense(expense.id)}
                          title="Delete expense"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
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

      {/* Add Source Modal */}
      {showAddSourceModal && (
        <div className="modal-overlay" onClick={() => setShowAddSourceModal(false)}>
          <div className="modal-content source-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add New Source</h2>
              <button className="modal-close" onClick={() => setShowAddSourceModal(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Source Name</label>
                <input
                  type="text"
                  placeholder="e.g., Facebook Ads, Instagram Ads"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddSource();
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="modal-btn cancel"
                onClick={() => {
                  setShowAddSourceModal(false);
                  setNewSourceName('');
                }}
              >
                Cancel
              </button>
              <button
                className="modal-btn confirm"
                onClick={handleAddSource}
                disabled={isAddingSource || !newSourceName.trim()}
              >
                {isAddingSource ? (
                  <>
                    <div className="btn-loader"></div>
                    Adding...
                  </>
                ) : (
                  'Add Source'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
