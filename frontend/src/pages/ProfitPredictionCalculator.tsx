import { useState, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { api } from '../services/api';
import styles from './ProfitPredictionCalculator.module.css';

function fmt(num: number, decimals = 0): string {
  const [intPart, decPart] = num.toFixed(decimals).split('.');
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const formatted = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree : lastThree;
  return decPart ? `${formatted}.${decPart}` : formatted;
}

type DayOption = 7 | 14 | 30 | 90;

interface Summary {
  days: number;
  completedDays: number;
  orders: number;
  revenue: number;
  cogs: number;
  adSpend: number;
  profit: number;
  avgRevenuePerOrder: number;
  avgCogsPerOrder: number;
  avgProfitPerOrder: number;
  profitMargin: number;
  roas: number;
}

interface DailyRow {
  date: string;
  orders: number;
  revenue: number;
  cogs: number;
  adSpend: number;
  profit: number;
  isCompleted: boolean;
  avgRevenuePerOrder: number;
  avgCogsPerOrder: number;
  avgProfitPerOrder: number;
  roas: number;
}

interface ChartPoint {
  label: string;
  isCompleted: boolean;
  [key: string]: number | string | boolean | null;
}

interface MetricChartProps {
  title: string;
  data: ChartPoint[];
  dataKey: string;
  color: string;
  formatValue: (v: number) => string;
  zeroLine?: boolean;
}

function MetricChart({ title, data, dataKey, color, formatValue, zeroLine }: MetricChartProps) {
  const completedData = data.filter(d => d.isCompleted);
  if (completedData.length === 0) return null;

  return (
    <div className={styles['chart-item']}>
      <div className={styles['chart-title']}>{title}</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={completedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatValue}
            width={60}
          />
          {zeroLine && <ReferenceLine y={0} stroke="#e2e8f0" />}
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
            formatter={(v: number) => [formatValue(v), title]}
            labelStyle={{ color: '#64748b', marginBottom: 4 }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProfitPredictionCalculator() {
  const [days, setDays] = useState<DayOption>(90);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [targetMonthlyProfit, setTargetMonthlyProfit] = useState('');

  useEffect(() => {
    load(days);
  }, [days]);

  const load = async (d: DayOption) => {
    setIsLoading(true);
    try {
      const res = await api.getDailyAverages(d);
      if (res.success && res.summary) {
        setSummary(res.summary);
        setDaily(res.daily ?? []);
      }
    } catch (err) {
      console.error('Failed to load daily averages:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await api.backfillDailyPnl();
      await load(days);
    } catch (err) {
      console.error('Failed to sync PnL data:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const needsSync = summary !== null && summary.orders > 0 && summary.revenue === 0;

  const chartData = useMemo(() => {
    const completed = daily.filter(d => d.isCompleted);

    // Group into ISO weeks (Mon–Sun). Key = 'YYYY-Www'
    const weeks = new Map<string, typeof completed>();
    for (const d of completed) {
      const date = new Date(d.date);
      const day = date.getDay() === 0 ? 7 : date.getDay(); // Mon=1 … Sun=7
      const mon = new Date(date);
      mon.setDate(date.getDate() - (day - 1));
      const key = mon.toLocaleDateString('en-CA'); // YYYY-MM-DD of Monday
      if (!weeks.has(key)) weeks.set(key, []);
      weeks.get(key)!.push(d);
    }

    return [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, rows]) => {
        const monDate = new Date(key);
        const sunDate = new Date(key);
        sunDate.setDate(monDate.getDate() + 6);
        const label = `${monDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}–${sunDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;

        const orderedRows = rows.filter(r => r.orders > 0);
        const avg = (vals: number[]) => vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;

        const totRevenue = rows.reduce((s, r) => s + r.revenue, 0);
        const totProfit  = rows.reduce((s, r) => s + r.profit, 0);
        const totAdSpend = rows.reduce((s, r) => s + r.adSpend, 0);

        return {
          label,
          avgRevenue:   avg(orderedRows.map(r => r.avgRevenuePerOrder)),
          avgCosts:     avg(orderedRows.map(r => r.avgCogsPerOrder)),
          avgProfit:    avg(orderedRows.map(r => r.avgProfitPerOrder)),
          profitMargin: totRevenue > 0 ? (totProfit / totRevenue) * 100 : null,
          roas:         totAdSpend > 0 ? totRevenue / totAdSpend : null,
          isCompleted:  true,
        };
      });
  }, [daily]);

  const targetNum = parseFloat(targetMonthlyProfit) || 0;

  const prediction = (() => {
    if (!summary || targetNum <= 0 || summary.avgProfitPerOrder <= 0) return null;

    const monthlyOrders = targetNum / summary.avgProfitPerOrder;
    const monthlyRevenue = monthlyOrders * summary.avgRevenuePerOrder;
    const monthlyAdSpend = summary.roas > 0 ? monthlyRevenue / summary.roas : 0;

    return {
      monthlyOrders,
      monthlyRevenue,
      monthlyAdSpend,
      dailyOrders: monthlyOrders / 30,
      dailyRevenue: monthlyRevenue / 30,
      dailyProfit: targetNum / 30,
      dailyAdSpend: monthlyAdSpend / 30,
    };
  })();

  return (
    <div className={styles['calculator-content']}>
      <header className={styles['page-header']}>
        <div>
          <h1 className={styles['page-title']}>Profit Prediction Calculator</h1>
          <p className={styles['page-subtitle']}>
            Real averages from your DailyPnl data — same numbers used in the Sales page bar chart.
          </p>
        </div>
        <div className={styles['header-controls']}>
          <button
            className={`${styles['sync-btn']} ${needsSync ? styles['sync-btn-warn'] : ''}`}
            onClick={handleSync}
            disabled={isSyncing || isLoading}
          >
            {isSyncing ? 'Syncing…' : 'Sync PnL'}
          </button>
          <div className={styles['day-selector']}>
            {([7, 14, 30, 90] as DayOption[]).map(d => (
              <button
                key={d}
                className={`${styles['day-btn']} ${days === d ? styles['day-btn-active'] : ''}`}
                onClick={() => setDays(d)}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </header>

      {needsSync && (
        <div className={styles['sync-notice']}>
          Revenue data is missing — click <strong>Sync PnL</strong> to recompute from order history.
        </div>
      )}

      {isLoading ? (
        <div className={styles['calculator-loading']}>
          <div className={styles.spinner} />
        </div>
      ) : !summary ? (
        <div className={styles['empty-state']}>
          No data available. Run a backfill from the Sales page first.
        </div>
      ) : (
        <>
          {/* ── Current Averages ── */}
          <section className={styles.card}>
            <h2 className={styles['card-title']}>
              Current Averages
              <span className={styles['card-subtitle']}>
                {summary.completedDays} completed days · {fmt(summary.orders)} orders
                {summary.completedDays < summary.days && (
                  <span className={styles['subtitle-note']}> (pending days excluded)</span>
                )}
              </span>
            </h2>
            <div className={styles['averages-grid']}>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Avg. Revenue per Order</div>
                <div className={styles['average-value']}>₹{fmt(summary.avgRevenuePerOrder, 2)}</div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Avg. Costs per Order</div>
                <div className={styles['average-value']}>₹{fmt(summary.avgCogsPerOrder, 2)}</div>
                <div className={styles['average-note']}>COGS + shipping + ad spend</div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Avg. Profit per Order</div>
                <div className={`${styles['average-value']} ${summary.avgProfitPerOrder >= 0 ? styles.positive : styles.negative}`}>
                  ₹{fmt(summary.avgProfitPerOrder, 2)}
                </div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Profit Margin</div>
                <div className={`${styles['average-value']} ${summary.profitMargin >= 0 ? styles.positive : styles.negative}`}>
                  {summary.profitMargin.toFixed(1)}%
                </div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Current ROAS</div>
                <div className={styles['average-value']}>{summary.roas.toFixed(2)}x</div>
              </div>
            </div>
          </section>

          {/* ── Period Totals ── */}
          <section className={styles.card}>
            <h2 className={styles['card-title']}>
              Period Totals
              <span className={styles['card-subtitle']}>last {summary.days} days</span>
            </h2>
            <div className={styles['averages-grid']}>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Total Revenue</div>
                <div className={styles['average-value']}>₹{fmt(summary.revenue, 0)}</div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Total COGS + Shipping</div>
                <div className={styles['average-value']}>₹{fmt(summary.cogs, 0)}</div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Total Ad Spend</div>
                <div className={styles['average-value']}>₹{fmt(summary.adSpend, 0)}</div>
              </div>
              <div className={styles['average-item']}>
                <div className={styles['average-label']}>Total Profit</div>
                <div className={`${styles['average-value']} ${summary.profit >= 0 ? styles.positive : styles.negative}`}>
                  {summary.profit >= 0 ? '+' : ''}₹{fmt(summary.profit, 0)}
                </div>
              </div>
            </div>
          </section>

          {/* ── Prediction Calculator ── */}
          <section className={styles.card}>
            <h2 className={styles['card-title']}>Profit Prediction Calculator</h2>
            <p className={styles['card-description']}>
              Enter your target monthly profit to see what's required to achieve it.
            </p>
            <div className={styles['input-group']}>
              <label className={styles.label} htmlFor="target-profit">
                Target Monthly Profit (₹)
              </label>
              <input
                id="target-profit"
                type="number"
                min="0"
                step="1000"
                className={styles.input}
                placeholder="e.g. 500000"
                value={targetMonthlyProfit}
                onChange={(e) => setTargetMonthlyProfit(e.target.value)}
              />
            </div>

            {prediction && (
              <div className={styles['results-grid']}>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Monthly orders required</div>
                  <div className={styles['result-value']}>{fmt(Math.ceil(prediction.monthlyOrders))}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Daily orders required</div>
                  <div className={styles['result-value']}>{prediction.dailyOrders.toFixed(1)}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Monthly revenue required</div>
                  <div className={styles['result-value']}>₹{fmt(prediction.monthlyRevenue, 0)}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Daily revenue required</div>
                  <div className={styles['result-value']}>₹{fmt(prediction.dailyRevenue, 0)}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Daily profit required</div>
                  <div className={`${styles['result-value']} ${styles.positive}`}>₹{fmt(prediction.dailyProfit, 0)}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Monthly ad spend required</div>
                  <div className={styles['result-value']}>₹{fmt(prediction.monthlyAdSpend, 0)}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>Daily ad spend required</div>
                  <div className={styles['result-value']}>₹{fmt(prediction.dailyAdSpend, 0)}</div>
                </div>
                <div className={styles['result-item']}>
                  <div className={styles['result-label']}>ROAS required</div>
                  <div className={`${styles['result-value']} ${styles.highlight}`}>{summary.roas.toFixed(2)}x</div>
                </div>
              </div>
            )}
          </section>

          {/* ── Trend Charts ── */}
          {chartData.length > 0 && (
            <section className={styles.card}>
              <h2 className={styles['card-title']}>
                Daily Trends
                <span className={styles['card-subtitle']}>last {summary.days} days · weekly</span>
              </h2>
              <div className={styles['charts-grid']}>
                <MetricChart
                  title="Avg. Revenue per Order"
                  data={chartData}
                  dataKey="avgRevenue"
                  color="#2563eb"
                  formatValue={v => `₹${fmt(v)}`}
                />
                <MetricChart
                  title="Avg. Costs per Order"
                  data={chartData}
                  dataKey="avgCosts"
                  color="#7c3aed"
                  formatValue={v => `₹${fmt(v)}`}
                />
                <MetricChart
                  title="Avg. Profit per Order"
                  data={chartData}
                  dataKey="avgProfit"
                  color="#059669"
                  formatValue={v => `₹${fmt(v)}`}
                  zeroLine
                />
                <MetricChart
                  title="Profit Margin"
                  data={chartData}
                  dataKey="profitMargin"
                  color="#0891b2"
                  formatValue={v => `${v.toFixed(1)}%`}
                  zeroLine
                />
                <MetricChart
                  title="ROAS"
                  data={chartData}
                  dataKey="roas"
                  color="#d97706"
                  formatValue={v => `${v.toFixed(2)}x`}
                />
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
