import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import styles from './MetaAdsPage.module.css';

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
  isTaxExempt?: boolean;
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
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('current'); // 'current', 'all', or 'YYYY-MM'

  // Form state
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [notes, setNotes] = useState('');
  const [isTaxExempt, setIsTaxExempt] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [expensesRes, sourcesRes] = await Promise.all([
        api.getMetaAdsExpenses(1, 1000), // Load all expenses
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
  }, [selectedSourceId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        isTaxExempt,
      });

      if (response.success && response.expense) {
        setExpenses([response.expense, ...expenses]);
        // Reset only amount field
        setAmount('');
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

  // Get available months from expenses
  const getAvailableMonths = () => {
    const monthsSet = new Set<string>();
    expenses.forEach(expense => {
      const expenseDate = new Date(expense.date);
      const monthKey = `${expenseDate.getFullYear()}-${String(expenseDate.getMonth() + 1).padStart(2, '0')}`;
      monthsSet.add(monthKey);
    });
    return Array.from(monthsSet).sort().reverse();
  };

  const availableMonths = getAvailableMonths();

  // Filter expenses based on selected month
  const getFilteredExpenses = () => {
    if (selectedMonthFilter === 'all') {
      return expenses;
    }
    
    let targetMonth: number;
    let targetYear: number;
    
    if (selectedMonthFilter === 'current') {
      targetMonth = new Date().getMonth();
      targetYear = new Date().getFullYear();
    } else {
      // Format: YYYY-MM
      const [year, month] = selectedMonthFilter.split('-');
      targetYear = parseInt(year);
      targetMonth = parseInt(month) - 1;
    }
    
    return expenses.filter(expense => {
      const expenseDate = new Date(expense.date);
      return expenseDate.getMonth() === targetMonth && expenseDate.getFullYear() === targetYear;
    });
  };

  const filteredExpenses = getFilteredExpenses();
  
  // Raw total - no tax deduction
  const totalAmount = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);

  // Calculate average daily spend for filtered period
  const getDailySpendAverage = () => {
    if (selectedMonthFilter === 'all') {
      // For "All Time", calculate across all expenses
      if (filteredExpenses.length === 0) {
        return { averageDailySpend: 0, totalSpend: 0, daysCount: 0, startDate: null, endDate: null };
      }
      
      const sortedExpenses = [...filteredExpenses].sort((a, b) => 
        new Date(a.date).getTime() - new Date(b.date).getTime()
      );
      
      const startDate = new Date(sortedExpenses[0].date);
      const endDate = new Date(sortedExpenses[sortedExpenses.length - 1].date);
      const daysCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const totalSpend = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const averageDailySpend = totalSpend / daysCount;
      
      return { averageDailySpend, totalSpend, daysCount, startDate, endDate };
    }
    
    // For specific month - use filtered expenses
    const monthExpenses = filteredExpenses;
    
    if (monthExpenses.length === 0) {
      return { averageDailySpend: 0, totalSpend: 0, daysCount: 0, startDate: null, endDate: null };
    }
    
    // Find first and last transaction dates
    const sortedExpenses = [...monthExpenses].sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    
    const startDate = new Date(sortedExpenses[0].date);
    const endDate = new Date(sortedExpenses[sortedExpenses.length - 1].date);
    
    // Calculate number of days between first and last transaction (inclusive)
    const daysCount = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calculate total spend for the month
    const totalSpend = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    
    // Calculate average
    const averageDailySpend = totalSpend / daysCount;
    
    return { averageDailySpend, totalSpend, daysCount, startDate, endDate };
  };

  // Calculate spend per source for filtered period
  const getMonthlySpendBySource = () => {
    // Use source name as key to ensure proper grouping
    const sourceMap = new Map<string, { name: string; amount: number }>();
    
    filteredExpenses.forEach(expense => {
      // Use sourceName as key to ensure all expenses from same source are grouped
      const key = expense.sourceName;
      if (sourceMap.has(key)) {
        const existing = sourceMap.get(key)!;
        sourceMap.set(key, { name: existing.name, amount: existing.amount + expense.amount });
      } else {
        sourceMap.set(key, { name: expense.sourceName, amount: expense.amount });
      }
    });
    
    return Array.from(sourceMap.values()).sort((a, b) => b.amount - a.amount);
  };

  const dailySpendData = getDailySpendAverage();
  const monthlySpendBySource = getMonthlySpendBySource();
  const periodTotal = monthlySpendBySource.reduce((sum, s) => sum + s.amount, 0);

  // Get month label for display
  const getMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  const getCurrentFilterLabel = () => {
    if (selectedMonthFilter === 'all') return 'All Time';
    if (selectedMonthFilter === 'current') return 'This Month';
    return getMonthLabel(selectedMonthFilter);
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
        <div className={styles['section-header']}>
          <div className={styles['header-content']}>
            <div>
            </div>
            <div className={styles['month-filter']}>
              <label htmlFor="month-select">Period:</label>
              <select 
                id="month-select"
                value={selectedMonthFilter} 
                onChange={(e) => setSelectedMonthFilter(e.target.value)}
                className={styles['filter-select']}
              >
                <option value="current">This Month</option>
                <option value="all">All Time</option>
                {availableMonths.length > 0 && <option disabled>───────────</option>}
                {availableMonths.map(monthKey => (
                  <option key={monthKey} value={monthKey}>
                    {getMonthLabel(monthKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className={styles['expense-stats']}>
          <div className={styles['stat-card']}>
            <div className={styles['stat-icon']} style={{ backgroundColor: '#e0f2fe', color: '#0284c7' }}>
              ₹
            </div>
            <div className={styles['stat-content']}>
              <div className={styles['stat-value']}>₹{totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className={styles['stat-label']}>Total Amount Paid</div>
            </div>
          </div>
          <div className={styles['stat-card']}>
            <div className={styles['stat-icon']} style={{ backgroundColor: '#f3f0ff', color: '#7c3aed' }}>
              📊
            </div>
            <div className={styles['stat-content']}>
              <div className={styles['stat-value']}>{expenses.length}</div>
              <div className={styles['stat-label']}>Total Entries</div>
            </div>
          </div>
        </div>

        {/* Add Expense Form */}
        <div className={styles['add-expense-form']}>
          <h3>Add New Expense</h3>
          <form onSubmit={handleSubmit}>
            <div className={styles['form-row']}>
              <div className={styles['form-group']}>
                <label>Amount (₹)</label>
                <div className={styles['input-with-prefix']}>
                  <span className={styles['input-prefix']}>₹</span>
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

              <div className={styles['form-group']}>
                <label>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>

              <div className={styles['form-group']}>
                <label>Source</label>
                <div className={styles['source-select-wrapper']}>
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
                    className={styles['add-source-btn']}
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

            <div className={styles['form-group']}>
              <label>Notes (Optional)</label>
              <input
                type="text"
                placeholder="Add any notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className={styles['form-actions']}>
              <div className={styles['checkbox-group']}>
                <label className={styles['checkbox-label']}>
                  <input
                    type="checkbox"
                    checked={isTaxExempt}
                    onChange={(e) => setIsTaxExempt(e.target.checked)}
                    className={styles['checkbox-input']}
                  />
                  <span className={styles['checkbox-text']}>
                    <svg className={styles['checkbox-icon']} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Tax Exempt
                  </span>
                </label>
              </div>

              <button type="submit" className={styles['submit-btn']} disabled={isSubmitting}>
              {isSubmitting ? (
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
                  Add Expense
                </>
              )}
              </button>
            </div>
          </form>
        </div>

        {/* Expenses List */}
        <div className={styles['expenses-list']}>
          <div className={styles['list-header']}>
            <h3>Expense History ({getCurrentFilterLabel()})</h3>
            <span className={styles['entry-count']}>{filteredExpenses.length} entries</span>
          </div>

          {filteredExpenses.length === 0 ? (
            <div className={styles['empty-state']}>
              <div className={styles['empty-icon']}>📝</div>
              <div className={styles['empty-text']}>No expenses logged yet</div>
            </div>
          ) : (
            <div className={styles['table-card']}>
              <table className={styles['data-table']}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Source</th>
                    <th>Notes</th>
                    <th>Tax</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className={styles['date-cell']}>
                        {new Date(expense.date).toLocaleDateString('en-IN', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className={styles['amount-cell']}>
                        ₹{expense.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td>
                        <span className={styles['source-badge']}>{expense.sourceName}</span>
                      </td>
                      <td className={styles['notes-cell']}>
                        {expense.notes || <span className={styles['no-notes']}>—</span>}
                      </td>
                      <td>
                        {expense.isTaxExempt ? (
                          <span className={`${styles['tax-badge']} ${styles.exempt}`}>Exempt</span>
                        ) : (
                          <span className={`${styles['tax-badge']} ${styles.taxable}`}>Taxable</span>
                        )}
                      </td>
                      <td className={styles['date-cell']}>
                        {new Date(expense.createdAt).toLocaleDateString('en-IN', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td>
                        <button
                          className={styles['delete-btn']}
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
        <div className={styles['modal-overlay']} onClick={() => setShowAddSourceModal(false)}>
          <div className={`${styles['modal-content']} ${styles['source-modal']}`} onClick={(e) => e.stopPropagation()}>
            <div className={styles['modal-header']}>
              <h2>Add New Source</h2>
              <button className={styles['modal-close']} onClick={() => setShowAddSourceModal(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className={styles['modal-body']}>
              <div className={styles['form-group']}>
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

            <div className={styles['modal-footer']}>
              <button
                className={`${styles['modal-btn']} ${styles.cancel}`}
                onClick={() => {
                  setShowAddSourceModal(false);
                  setNewSourceName('');
                }}
              >
                Cancel
              </button>
              <button
                className={`${styles['modal-btn']} ${styles.confirm}`}
                onClick={handleAddSource}
                disabled={isAddingSource || !newSourceName.trim()}
              >
                {isAddingSource ? (
                  <>
                    <div className={styles['btn-loader']}></div>
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

      {/* Right Sidebar */}
      <aside className={styles['stats-sidebar']}>
        <div className={styles['sidebar-section']}>
          <h3 className={styles['sidebar-section-title']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20"/>
              <path d="M17 12H3"/>
              <path d="M19 18l2-2-2-2"/>
              <path d="M5 6L3 8l2 2"/>
            </svg>
            Average Daily Spend
          </h3>
          {dailySpendData.daysCount > 0 ? (
            <div className={styles['avg-daily-spend']}>
              <div className={styles['avg-spend-card']}>
                <div className={styles['avg-spend-label']}>Average per Day</div>
                <div className={styles['avg-spend-value']}>
                  ₹{dailySpendData.averageDailySpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className={styles['avg-spend-details']}>
                <div className={styles['detail-row']}>
                  <span className={styles['detail-label']}>Total this month:</span>
                  <span className={styles['detail-value']}>₹{dailySpendData.totalSpend.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                </div>
                <div className={styles['detail-row']}>
                  <span className={styles['detail-label']}>Days counted:</span>
                  <span className={styles['detail-value']}>{dailySpendData.daysCount}</span>
                </div>
                <div className={styles['detail-row']}>
                  <span className={styles['detail-label']}>Period:</span>
                  <span className={styles['detail-value']}>
                    {dailySpendData.startDate?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - {dailySpendData.endDate?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles['no-data']}>No expenses this month</div>
          )}
        </div>

        <div className={styles['sidebar-section']}>
          <h3 className={styles['sidebar-section-title']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            By Source
          </h3>
          <div className={styles['month-total']}>
            <span className={styles['month-label']}>Total ({getCurrentFilterLabel()})</span>
            <span className={styles['month-amount']}>₹{periodTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className={styles['source-spend-list']}>
            {monthlySpendBySource.length === 0 ? (
              <div className={styles['no-data']}>No expenses for this period</div>
            ) : (
              monthlySpendBySource.map((source) => (
                <div key={source.name} className={styles['source-spend-item']}>
                  <div className={styles['source-info']}>
                    <div className={styles['source-name']}>{source.name}</div>
                    <div className={styles['source-amount']}>
                      ₹{source.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className={styles['source-bar']}>
                    <div 
                      className={styles['source-bar-fill']} 
                      style={{ 
                        width: `${periodTotal > 0 ? (source.amount / periodTotal) * 100 : 0}%` 
                      }}
                    ></div>
                  </div>
                  <div className={styles['source-percentage']}>
                    {periodTotal > 0 ? ((source.amount / periodTotal) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
