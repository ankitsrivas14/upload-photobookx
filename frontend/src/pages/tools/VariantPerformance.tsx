import { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/api';
import styles from './VariantPerformance.module.css';

function fmt(num: number, decimals = 0): string {
  const [intPart, decPart] = num.toFixed(decimals).split('.');
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const formatted = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree : lastThree;
  return decPart ? `${formatted}.${decPart}` : formatted;
}

type DayOption = 7 | 14 | 30 | 90;

interface Bucket {
  variant: 'small' | 'large';
  payment: 'prepaid' | 'cod';
  orders: number;
  delivered: number;
  rto: number;
  pending: number;
  deliveryRate: number;
  rtoRate: number;
  revenue: number;
  cogs: number;
  adSpend: number;
  profit: number;
  avgRevenuePerOrder: number;
  avgProfitPerOrder: number;
  profitMargin: number;
}

const LABELS: Record<string, string> = {
  'small-prepaid': 'Small · Prepaid',
  'small-cod':     'Small · COD',
  'large-prepaid': 'Large · Prepaid',
  'large-cod':     'Large · COD',
};

const RANK_COLORS = ['#f59e0b', '#94a3b8', '#cd7c3a', '#cbd5e1'];
const RANK_LABELS = ['1st', '2nd', '3rd', '4th'];

function rtoColor(rate: number) {
  if (rate <= 10) return '#059669';
  if (rate <= 20) return '#f59e0b';
  return '#dc2626';
}

export function VariantPerformance() {
  const [days, setDays] = useState<DayOption>(30);
  const [isLoading, setIsLoading] = useState(true);
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  useEffect(() => { load(days); }, [days]);

  const load = async (d: DayOption) => {
    setIsLoading(true);
    try {
      const res = await api.getVariantPerformance(d);
      if (res.success && res.buckets) setBuckets(res.buckets);
    } catch (err) {
      console.error('Failed to load variant performance:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const ranked = useMemo(() =>
    [...buckets].sort((a, b) => b.avgProfitPerOrder - a.avgProfitPerOrder),
  [buckets]);

  const maxProfit = ranked[0]?.avgProfitPerOrder ?? 1;
  const maxMargin = Math.max(...ranked.map(b => Math.abs(b.profitMargin)), 1);

  const totalPending = buckets.reduce((s, b) => s + b.pending, 0);

  // Dimension splits
  const small = buckets.filter(b => b.variant === 'small');
  const large = buckets.filter(b => b.variant === 'large');
  const prepaid = buckets.filter(b => b.payment === 'prepaid');
  const cod = buckets.filter(b => b.payment === 'cod');

  const agg = (rows: Bucket[]) => {
    const orders = rows.reduce((s, b) => s + b.orders, 0);
    const profit = rows.reduce((s, b) => s + b.profit, 0);
    const revenue = rows.reduce((s, b) => s + b.revenue, 0);
    const rto = rows.reduce((s, b) => s + b.rto, 0);
    return {
      orders,
      profit,
      avgProfitPerOrder: orders > 0 ? profit / orders : 0,
      profitMargin: revenue > 0 ? (profit / revenue) * 100 : 0,
      rtoRate: orders > 0 ? (rto / orders) * 100 : 0,
    };
  };

  const dims = [
    { label: 'Small', sub: 'vs Large', a: agg(small), b: agg(large), bLabel: 'Large' },
    { label: 'Prepaid', sub: 'vs COD', a: agg(prepaid), b: agg(cod), bLabel: 'COD' },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Variant Performance</h1>
          <p className={styles.subtitle}>Ranked by avg profit per order · delivered &amp; failed orders only</p>
        </div>
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
      </header>

      {isLoading ? (
        <div className={styles.loading}><div className={styles.spinner} /></div>
      ) : (
        <>
          {totalPending > 0 && (
            <p className={styles['pending-note']}>
              {fmt(totalPending)} orders still in transit — excluded until they settle.
            </p>
          )}

          {/* ── Ranked leaderboard ── */}
          <div className={styles.leaderboard}>
            {ranked.map((b, i) => {
              const key = `${b.variant}-${b.payment}`;
              const profitBarWidth = maxProfit > 0 ? Math.max((b.avgProfitPerOrder / maxProfit) * 100, 0) : 0;
              const marginBarWidth = Math.min(Math.abs(b.profitMargin) / maxMargin * 100, 100);
              return (
                <div key={key} className={`${styles['rank-row']} ${i === 0 ? styles['rank-row-top'] : ''}`}>
                  {/* Rank */}
                  <div className={styles['rank-badge']} style={{ color: RANK_COLORS[i] }}>
                    {RANK_LABELS[i]}
                  </div>

                  {/* Label + orders */}
                  <div className={styles['rank-name']}>
                    <span className={styles['rank-label']}>{LABELS[key]}</span>
                    <span className={styles['rank-orders']}>{fmt(b.orders)} orders</span>
                  </div>

                  {/* Avg profit — primary metric */}
                  <div className={styles['rank-primary']}>
                    <div className={`${styles['rank-profit']} ${b.avgProfitPerOrder >= 0 ? styles.positive : styles.negative}`}>
                      ₹{fmt(b.avgProfitPerOrder, 0)}
                    </div>
                    <div className={styles['rank-profit-label']}>avg profit / order</div>
                    <div className={styles['profit-bar-track']}>
                      <div
                        className={`${styles['profit-bar-fill']} ${b.avgProfitPerOrder >= 0 ? styles['bar-positive'] : styles['bar-negative']}`}
                        style={{ width: `${profitBarWidth}%` }}
                      />
                    </div>
                  </div>

                  {/* Secondary metrics */}
                  <div className={styles['rank-secondaries']}>
                    <div className={styles['secondary-item']}>
                      <span className={styles['secondary-label']}>Margin</span>
                      <span className={`${styles['secondary-value']} ${b.profitMargin >= 0 ? styles.positive : styles.negative}`}>
                        {b.profitMargin.toFixed(1)}%
                      </span>
                      <div className={styles['bar-track']}>
                        <div
                          className={`${styles['bar-fill']} ${b.profitMargin >= 0 ? styles['bar-positive'] : styles['bar-negative']}`}
                          style={{ width: `${marginBarWidth}%` }}
                        />
                      </div>
                    </div>
                    <div className={styles['secondary-item']}>
                      <span className={styles['secondary-label']}>RTO Rate</span>
                      <span className={styles['secondary-value']} style={{ color: rtoColor(b.rtoRate) }}>
                        {b.rtoRate.toFixed(1)}%
                      </span>
                      <div className={styles['bar-track']}>
                        <div
                          className={styles['bar-fill']}
                          style={{ width: `${Math.min(b.rtoRate / 40 * 100, 100)}%`, background: rtoColor(b.rtoRate) }}
                        />
                      </div>
                    </div>
                    <div className={styles['secondary-item']}>
                      <span className={styles['secondary-label']}>Total Profit</span>
                      <span className={`${styles['secondary-value']} ${b.profit >= 0 ? styles.positive : styles.negative}`}>
                        {b.profit >= 0 ? '+' : ''}₹{fmt(b.profit, 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Dimension splits ── */}
          <div className={styles['splits-grid']}>
            {dims.map(dim => (
              <div key={dim.label} className={styles['split-card']}>
                <div className={styles['split-title']}>{dim.label} <span className={styles['split-vs']}>{dim.sub}</span></div>
                <div className={styles['split-rows']}>
                  {[{ label: dim.label, d: dim.a }, { label: dim.bLabel, d: dim.b }].map(({ label, d }) => (
                    <div key={label} className={styles['split-row']}>
                      <span className={styles['split-row-label']}>{label}</span>
                      <span className={styles['split-row-orders']}>{fmt(d.orders)} orders</span>
                      <span className={`${styles['split-row-profit']} ${d.avgProfitPerOrder >= 0 ? styles.positive : styles.negative}`}>
                        ₹{fmt(d.avgProfitPerOrder, 0)}/order
                      </span>
                      <span className={`${styles['split-row-margin']} ${d.profitMargin >= 0 ? styles.positive : styles.negative}`}>
                        {d.profitMargin.toFixed(1)}%
                      </span>
                      <span className={styles['split-row-rto']} style={{ color: rtoColor(d.rtoRate) }}>
                        {d.rtoRate.toFixed(1)}% RTO
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
