import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import styles from './ProfitPredictionCalculator.module.css';

const DEFAULT_WORKING_DAYS = 30;

function formatIndianNumber(num: number, decimals = 0): string {
  const [intPart, decPart] = num.toFixed(decimals).split('.');
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const formatted = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree : lastThree;
  return decPart ? `${formatted}.${decPart}` : formatted;
}

export function ProfitPredictionCalculator() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  // Input: target monthly profit (₹)
  const [targetMonthlyProfit, setTargetMonthlyProfit] = useState<string>('');
  // Assumptions
  const [avgProfitPerOrder, setAvgProfitPerOrder] = useState<string>('');
  const [avgRevenuePerOrder, setAvgRevenuePerOrder] = useState<string>('');
  const [roasRequired, setRoasRequired] = useState<string>('');
  const [workingDaysPerMonth, setWorkingDaysPerMonth] = useState<string>(String(DEFAULT_WORKING_DAYS));

  const [loadingFromData, setLoadingFromData] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const meRes = await api.getMe();
      if (!meRes.success) {
        api.logout();
        navigate('/admin');
        return;
      }
    } catch (err) {
      console.error('Failed to load user:', err);
      api.logout();
      navigate('/admin');
    } finally {
      setIsLoading(false);
    }
  };

  const loadFromLast30Days = useCallback(async () => {
    setLoadingFromData(true);
    try {
      const [ordersRes, adSpendRes] = await Promise.all([
        api.getOrders(250, true),
        api.getDailyAdSpend(),
      ]);

      const orders = ordersRes.success && ordersRes.orders ? ordersRes.orders : [];
      const adSpendEntries = adSpendRes.success && adSpendRes.entries ? adSpendRes.entries : [];

      const now = new Date();
      const cutoff = new Date(now);
      cutoff.setDate(cutoff.getDate() - 30);

      const ordersLast30 = orders.filter((o) => !o.cancelledAt && new Date(o.createdAt) >= cutoff);
      const totalRevenue = ordersLast30.reduce((s, o) => s + (o.totalPrice ?? 0), 0);
      const orderCount = ordersLast30.length;

      const adSpendLast30 = adSpendEntries
        .filter((e) => new Date(e.date) >= cutoff)
        .reduce((s, e) => s + e.amount, 0);

      if (orderCount > 0) {
        setAvgRevenuePerOrder((totalRevenue / orderCount).toFixed(0));
      }
      if (adSpendLast30 > 0 && totalRevenue > 0) {
        setRoasRequired((totalRevenue / adSpendLast30).toFixed(2));
      }
    } catch (err) {
      console.error('Failed to load from last 30 days:', err);
    } finally {
      setLoadingFromData(false);
    }
  }, []);

  const targetProfitNum = parseFloat(targetMonthlyProfit) || 0;
  const avgProfitNum = parseFloat(avgProfitPerOrder) || 0;
  const avgRevenueNum = parseFloat(avgRevenuePerOrder) || 0;
  const roasNum = parseFloat(roasRequired) || 0;
  const workingDays = Math.max(1, Math.min(31, parseInt(workingDaysPerMonth, 10) || DEFAULT_WORKING_DAYS));

  const results = (() => {
    if (targetProfitNum <= 0 || avgProfitNum <= 0) {
      return null;
    }
    const monthlyOrdersRequired = targetProfitNum / avgProfitNum;
    const monthlyRevenueRequired = monthlyOrdersRequired * (avgRevenueNum || 0);
    const monthlyAdSpendRequired = roasNum > 0 ? monthlyRevenueRequired / roasNum : 0;
    const dailyProfitRequired = targetProfitNum / workingDays;
    const dailyRevenueRequired = monthlyRevenueRequired / workingDays;
    const dailyAdSpendRequired = monthlyAdSpendRequired / workingDays;
    const dailyOrdersRequired = monthlyOrdersRequired / workingDays;

    return {
      monthlyRevenueRequired,
      monthlyProfitRequired: targetProfitNum,
      monthlyAdSpendRequired,
      dailyRevenueRequired,
      dailyProfitRequired,
      dailyAdSpendRequired,
      dailyOrdersRequired,
      monthlyOrdersRequired,
      roasRequired: roasNum,
    };
  })();

  if (isLoading) {
    return (
      <div className={styles['calculator-loading']}>
        <div className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className={styles['calculator-content']}>
        <header className={styles['page-header']}>
          <h1 className={styles['page-title']}>Profit Prediction Calculator</h1>
          <p className={styles['page-subtitle']}>
            Enter your target monthly profit and assumptions to see required revenue, ad spend, ROAS, and daily orders.
          </p>
        </header>

        <section className={styles.card}>
          <h2 className={styles['card-title']}>Target</h2>
          <div className={styles['input-group']}>
            <label className={styles.label} htmlFor="target-profit">
              Target monthly profit (₹)
            </label>
            <input
              id="target-profit"
              type="number"
              min="0"
              step="1000"
              className={styles.input}
              placeholder="e.g. 100000"
              value={targetMonthlyProfit}
              onChange={(e) => setTargetMonthlyProfit(e.target.value)}
            />
          </div>
        </section>

        <section className={styles.card}>
          <h2 className={styles['card-title']}>Assumptions</h2>
          <div className={styles['input-group']}>
            <label className={styles.label} htmlFor="avg-profit">
              Average profit per order (₹)
            </label>
            <input
              id="avg-profit"
              type="number"
              min="0"
              step="10"
              className={styles.input}
              placeholder="e.g. 250"
              value={avgProfitPerOrder}
              onChange={(e) => setAvgProfitPerOrder(e.target.value)}
            />
          </div>
          <div className={styles['input-group']}>
            <label className={styles.label} htmlFor="avg-revenue">
              Average revenue per order (₹)
            </label>
            <input
              id="avg-revenue"
              type="number"
              min="0"
              step="10"
              className={styles.input}
              placeholder="e.g. 800"
              value={avgRevenuePerOrder}
              onChange={(e) => setAvgRevenuePerOrder(e.target.value)}
            />
          </div>
          <div className={styles['input-group']}>
            <label className={styles.label} htmlFor="roas">
              ROAS required (Revenue / Ad Spend)
            </label>
            <input
              id="roas"
              type="number"
              min="0.1"
              step="0.1"
              className={styles.input}
              placeholder="e.g. 2.5"
              value={roasRequired}
              onChange={(e) => setRoasRequired(e.target.value)}
            />
          </div>
          <div className={styles['input-group']}>
            <label className={styles.label} htmlFor="working-days">
              Working days per month
            </label>
            <input
              id="working-days"
              type="number"
              min="1"
              max="31"
              step="1"
              className={styles.input}
              value={workingDaysPerMonth}
              onChange={(e) => setWorkingDaysPerMonth(e.target.value)}
            />
          </div>
          <button
            type="button"
            className={styles['load-from-data-btn']}
            onClick={loadFromLast30Days}
            disabled={loadingFromData}
          >
            {loadingFromData ? 'Loading…' : 'Use averages from last 30 days'}
          </button>
        </section>

        {results && (
          <section className={styles.card}>
            <h2 className={styles['card-title']}>Results</h2>
            <div className={styles['results-grid']}>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Monthly revenue required</div>
                <div className={styles['result-value']}>₹{formatIndianNumber(results.monthlyRevenueRequired, 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Daily revenue required</div>
                <div className={styles['result-value']}>₹{formatIndianNumber(results.dailyRevenueRequired, 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Monthly profit required</div>
                <div className={`${styles['result-value']} ${styles.positive}`}>₹{formatIndianNumber(results.monthlyProfitRequired, 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Daily profit required</div>
                <div className={`${styles['result-value']} ${styles.positive}`}>₹{formatIndianNumber(results.dailyProfitRequired, 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Daily ad spend required</div>
                <div className={styles['result-value']}>₹{formatIndianNumber(results.dailyAdSpendRequired, 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Monthly ad spend required</div>
                <div className={styles['result-value']}>₹{formatIndianNumber(results.monthlyAdSpendRequired, 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>ROAS required</div>
                <div className={`${styles['result-value']} ${styles.highlight}`}>{results.roasRequired.toFixed(2)}x</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Daily orders required</div>
                <div className={styles['result-value']}>{formatIndianNumber(Math.round(results.dailyOrdersRequired), 0)}</div>
              </div>
              <div className={styles['result-item']}>
                <div className={styles['result-label']}>Monthly orders required</div>
                <div className={styles['result-value']}>{formatIndianNumber(Math.round(results.monthlyOrdersRequired), 0)}</div>
              </div>
            </div>
          </section>
        )}
    </div>
  );
}
