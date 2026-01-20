import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './ExpensesOverview.css';

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

export function ExpensesOverview() {
  const [isLoading, setIsLoading] = useState(true);
  const [expenses, setExpenses] = useState<MetaAdsExpense[]>([]);

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    setIsLoading(true);
    try {
      const response = await api.getMetaAdsExpenses(1, 1000); // Get all expenses
      if (response.success && response.expenses) {
        setExpenses(response.expenses);
      }
    } catch (err) {
      console.error('Failed to load expenses:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate ad spend statistics
  const calculateAdSpends = () => {
    let totalExemptSpend = 0;
    let totalTaxedSpend = 0;
    let totalPreTaxSpend = 0;

    expenses.forEach(expense => {
      // Only expenses explicitly marked as tax exempt are counted as exempt
      // Everything else (false, undefined, null) is treated as taxed
      if (expense.isTaxExempt === true) {
        // Tax exempt - use amount as-is
        totalExemptSpend += expense.amount;
      } else {
        // Taxed (or field missing) - amount includes 18% GST
        // Pre-tax amount = Total amount / 1.18
        const preTaxAmount = expense.amount / 1.18;
        totalTaxedSpend += expense.amount;
        totalPreTaxSpend += preTaxAmount;
      }
    });

    const totalActualSpend = totalExemptSpend + totalPreTaxSpend;
    const totalGST = totalTaxedSpend - totalPreTaxSpend;

    return {
      totalExemptSpend,
      totalTaxedSpend,
      totalPreTaxSpend,
      totalGST,
      totalActualSpend,
      exemptCount: expenses.filter(e => e.isTaxExempt === true).length,
      taxedCount: expenses.filter(e => e.isTaxExempt !== true).length,
    };
  };

  const stats = calculateAdSpends();

  if (isLoading) {
    return (
      <div className="loading-section">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="expenses-overview">
      <div className="content-section">
        <div className="section-header">
          <h2>Expenses Overview</h2>
          <p>Track and analyze your business advertising expenses</p>
        </div>

        {/* Main Ad Spend Metric */}
        <div className="hero-stat">
          <div className="hero-stat-content">
            <div className="hero-stat-label">Total Actual Ad Spend</div>
            <div className="hero-stat-value">₹{stats.totalActualSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="hero-stat-description">
              Pre-tax advertising expenses • {expenses.length} total transactions
            </div>
          </div>
        </div>

        {/* Placeholder for future stats and charts */}
        <div className="future-stats-placeholder">
          {/* More stats and charts will be added here */}
        </div>
      </div>
    </div>
  );
}
