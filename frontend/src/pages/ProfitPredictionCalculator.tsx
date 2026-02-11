import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import styles from './ProfitPredictionCalculator.module.css';

const DEFAULT_WORKING_DAYS = 30;

interface COGSField {
  id: string;
  name: string;
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  percentageType?: 'included' | 'excluded';
}

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
  
  // Auto-calculated from historical data
  const [avgProfitPerOrder, setAvgProfitPerOrder] = useState<number>(0);
  const [avgRevenuePerOrder, setAvgRevenuePerOrder] = useState<number>(0);
  const [roas, setRoas] = useState<number>(0);
  const [workingDays] = useState<number>(DEFAULT_WORKING_DAYS);
  const [dataSource, setDataSource] = useState<string>('');

  useEffect(() => {
    loadDataAndCalculate();
  }, []);

  const loadDataAndCalculate = async () => {
    try {
      const meRes = await api.getMe();
      if (!meRes.success) {
        api.logout();
        navigate('/admin');
        return;
      }

      // Load historical data including RTO orders
      const [ordersRes, adSpendRes, cogsRes, rtoRes] = await Promise.all([
        api.getOrders(250, true),
        api.getDailyAdSpend(),
        api.getCOGSConfiguration(),
        api.getRTOOrderIds(),
      ]);

      const orders = ordersRes.success && ordersRes.orders ? ordersRes.orders : [];
      const adSpendEntries = adSpendRes.success && adSpendRes.entries ? adSpendRes.entries : [];
      const cogsFields = cogsRes && cogsRes.fields ? cogsRes.fields : [];
      const rtoOrderIds = new Set(rtoRes.success && rtoRes.rtoOrderIds ? rtoRes.rtoOrderIds : []);

      // Hard cutoff date - do not consider data before this date
      const hardCutoffDate = new Date('2026-01-28T00:00:00');
      
      const now = new Date();
      const last30DaysCutoff = new Date(now);
      last30DaysCutoff.setDate(last30DaysCutoff.getDate() - 30);

      // Use the more recent cutoff date (either Jan 28, 2026 or 30 days ago)
      const effectiveCutoff = hardCutoffDate > last30DaysCutoff ? hardCutoffDate : last30DaysCutoff;

      // Filter orders from last 30 days (exclude cancelled, exclude before hard cutoff)
      const ordersLast30 = orders.filter((o) => {
        if (o.cancelledAt) return false;
        const orderDate = new Date(o.createdAt);
        return orderDate >= effectiveCutoff;
      });
      
      const orderCount = ordersLast30.length;

      // Calculate total ad spend (also respect hard cutoff)
      const adSpendLast30 = adSpendEntries
        .filter((e) => new Date(e.date) >= effectiveCutoff)
        .reduce((s, e) => s + e.amount, 0);

      // Helper function to determine if order failed
      const isOrderFailed = (order: any): boolean => {
        if (rtoOrderIds.has(order.id)) return true;
        const status = order.deliveryStatus?.toLowerCase() || '';
        return status === 'failure' || status.includes('failed') || status.includes('rto');
      };

      // Calculate profit for each order considering delivery status and NDR
      let totalRevenue = 0;
      let totalCosts = 0;
      
      if (cogsFields.length > 0) {
        ordersLast30.forEach((order) => {
          const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
          const isPrepaid = paymentMethod === 'prepaid';
          const variant = 'small'; // Default for averaging
          
          const isFailed = isOrderFailed(order);
          
          let orderRevenue = 0;
          let orderCosts = 0;
          let fieldsToUse: COGSField[] = [];
          
          // Determine revenue and which cost fields to apply
          if (isFailed) {
            // Failed/RTO = no money, apply NDR costs (loss)
            orderRevenue = 0;
            // Apply NDR and Both fields
            fieldsToUse = cogsFields.filter(f => f.type === 'ndr' || f.type === 'both');
          } else {
            // Delivered, Prepaid, or Pending = count revenue
            // (Pending orders will likely be delivered, so include their revenue for planning)
            orderRevenue = order.totalPrice || 0;
            // Apply COGS and Both fields
            fieldsToUse = cogsFields.filter(f => f.type === 'cogs' || f.type === 'both');
          }
          
          // Calculate costs based on selected fields
          fieldsToUse.forEach(field => {
            const key = `${variant}${isPrepaid ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
            const value = field[key] as number;
            
            if (field.calculationType === 'fixed') {
              orderCosts += value;
            } else {
              // Percentage calculation
              const salePrice = order.totalPrice || 0;
              const percentageType = field.percentageType || 'excluded';
              
              if (percentageType === 'included') {
                // Included: percentage is part of total amount
                // Formula: amount × (percentage / (100 + percentage))
                // Example: ₹100 with 12% included = ₹100 × (12/112) = ₹10.71
                orderCosts += (value / (100 + value)) * salePrice;
              } else {
                // Excluded: percentage is added on top
                // Formula: amount × (percentage / 100)
                // Example: ₹100 with 12% excluded = ₹100 × 0.12 = ₹12
                orderCosts += (value / 100) * salePrice;
              }
            }
          });
          
          totalRevenue += orderRevenue;
          totalCosts += orderCosts;
        });
      }

      // Calculate total profit (revenue - costs - ad spend)
      const totalProfit = totalRevenue - totalCosts - adSpendLast30;

      // Calculate averages
      if (orderCount > 0) {
        setAvgRevenuePerOrder(totalRevenue / orderCount);
        setAvgProfitPerOrder(totalProfit / orderCount);
      }
      
      if (adSpendLast30 > 0 && totalRevenue > 0) {
        setRoas(totalRevenue / adSpendLast30);
      }

      // Determine date range for display
      const isUsingHardCutoff = effectiveCutoff.getTime() === hardCutoffDate.getTime();
      const dateRangeText = isUsingHardCutoff 
        ? `from ${hardCutoffDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} onwards`
        : 'from last 30 days';
      
      setDataSource(`Based on ${orderCount} orders ${dateRangeText}`);
    } catch (err) {
      console.error('Failed to load data:', err);
      api.logout();
      navigate('/admin');
    } finally {
      setIsLoading(false);
    }
  };

  const targetProfitNum = parseFloat(targetMonthlyProfit) || 0;

  const results = (() => {
    if (targetProfitNum <= 0 || avgProfitPerOrder <= 0) {
      return null;
    }
    const monthlyOrdersRequired = targetProfitNum / avgProfitPerOrder;
    const monthlyRevenueRequired = monthlyOrdersRequired * avgRevenuePerOrder;
    const monthlyAdSpendRequired = roas > 0 ? monthlyRevenueRequired / roas : 0;
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
      roasRequired: roas,
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
            Enter your target monthly profit to see what's required to achieve it.
          </p>
          {dataSource && (
            <p className={styles['data-source']}>{dataSource}</p>
          )}
        </header>

        <section className={styles.card}>
          <h2 className={styles['card-title']}>Target Monthly Profit</h2>
          <div className={styles['input-group']}>
            <label className={styles.label} htmlFor="target-profit">
              How much profit do you want to make per month? (₹)
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

        {avgProfitPerOrder > 0 && (
            <section className={styles.card}>
              <h2 className={styles['card-title']}>Current Averages (Per Order)</h2>
              <div className={styles['averages-grid']}>
                <div className={styles['average-item']}>
                  <div className={styles['average-label']}>Avg. Revenue per Order</div>
                  <div className={styles['average-value']}>₹{formatIndianNumber(avgRevenuePerOrder, 2)}</div>
                </div>
                <div className={styles['average-item']}>
                  <div className={styles['average-label']}>Avg. Costs per Order</div>
                  <div className={styles['average-value']}>₹{formatIndianNumber(avgRevenuePerOrder - avgProfitPerOrder, 2)}</div>
                </div>
                <div className={styles['average-item']}>
                  <div className={styles['average-label']}>Avg. Profit per Order</div>
                  <div className={styles['average-value']}>₹{formatIndianNumber(avgProfitPerOrder, 2)}</div>
                </div>
                <div className={styles['average-item']}>
                  <div className={styles['average-label']}>Profit Margin</div>
                  <div className={styles['average-value']}>{avgRevenuePerOrder > 0 ? ((avgProfitPerOrder / avgRevenuePerOrder) * 100).toFixed(1) : '0'}%</div>
                </div>
                <div className={styles['average-item']}>
                  <div className={styles['average-label']}>Current ROAS</div>
                  <div className={styles['average-value']}>{roas.toFixed(2)}x</div>
                </div>
              </div>
            </section>
        )}

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
