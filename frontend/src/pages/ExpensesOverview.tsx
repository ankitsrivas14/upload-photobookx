import { useState, useEffect } from 'react';
import { api } from '../services/api';
import styles from './ExpensesOverview.module.css';

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
      <div className={styles['loading-section']}>
        <div className={styles.spinner}></div>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className={styles['expenses-overview']}>
      <div className={styles['content-section']}>

        {/* Main Ad Spend Metric */}
        <div className={styles['hero-stat']}>
          <div className={styles['hero-stat-content']}>
            <div className={styles['hero-stat-label']}>Total Actual Ad Spend</div>
            <div className={styles['hero-stat-value']}>₹{stats.totalActualSpend.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className={styles['hero-stat-description']}>
              Pre-tax advertising expenses • {expenses.length} total transactions
            </div>
          </div>
        </div>

        {/* Placeholder for future stats and charts */}
        <div className={styles['future-stats-placeholder']}>
          {/* More stats and charts will be added here */}
        </div>
      </div>
    </div>
  );
}
