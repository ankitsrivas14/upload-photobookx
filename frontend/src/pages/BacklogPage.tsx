import { useState, useEffect, useMemo } from 'react';
import { api, type BacklogOrder } from '../services/api';
import styles from './BacklogPage.module.css';
import toast from 'react-hot-toast';

type ViewMode = 'all' | 'default';

// Pre-computed fields attached to each order on load — never recomputed during render
interface EnrichedOrder extends BacklogOrder {
  _monthKey: string;   // 'YYYY-MM'
  _day: number;        // day-of-month for week bucketing
  _statusClass: string;
  _dateLabel: string;  // formatted display string
}

const WEEK_LABELS = [
  'Week 1 (1st–7th)',
  'Week 2 (8th–14th)',
  'Week 3 (15th–21st)',
  'Week 4 (22nd–28th)',
  'Week 5 (29th–end)',
] as const;

function weekIndex(day: number): number {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  if (day <= 28) return 3;
  return 4;
}

function computeStatusClass(order: BacklogOrder): string {
  const status = order.deliveryStatus?.toLowerCase() || '';
  if (status === 'delivered') return styles.delivered;
  if (status.includes('fail') || status.includes('rto')) return styles.failed;
  if (status.includes('transit') || status.includes('shipped')) return styles.transit;
  if (status === 'out_for_delivery') return styles.outForDelivery;
  if (!order.fulfillmentStatus || order.fulfillmentStatus === 'unfulfilled') return styles.unfulfilled;
  return styles.confirmed;
}

function enrich(order: BacklogOrder): EnrichedOrder {
  const d = new Date(order.createdAt);
  const month = d.getMonth() + 1;
  return {
    ...order,
    _monthKey: `${d.getFullYear()}-${String(month).padStart(2, '0')}`,
    _day: d.getDate(),
    _statusClass: computeStatusClass(order),
    _dateLabel: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  };
}

export default function BacklogPage() {
  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('default');

  useEffect(() => { loadOrders(); }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const response = await api.getBacklogOrders();
      if (response.success && response.orders) {
        // Enrich once on load — all downstream reads are plain property accesses
        setOrders(response.orders.map(enrich));
      } else {
        toast.error(response.error || 'Failed to load orders');
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
      toast.error('An error occurred while loading orders');
    } finally {
      setLoading(false);
    }
  };

  // Build month labels from Jan 2026 to today — recomputes once per day at most
  const monthsRange = useMemo(() => {
    const months: { label: string; key: string }[] = [];
    const end = new Date();
    let y = 2026, m = 1;
    while (true) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.push({
        key,
        label: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      });
      if (y === end.getFullYear() && m === end.getMonth() + 1) break;
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return months;
  }, []);

  const currentMonthKey = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  // Fix 2+3: filter once, then single-pass bucket into month → week
  const ordersByMonth = useMemo(() => {
    // Filter
    const visible = viewMode === 'all'
      ? orders
      : orders.filter(o => {
          const s = o.deliveryStatus?.toLowerCase() || '';
          return s !== 'delivered' && !s.includes('fail') && !s.includes('rto') && s !== 'attempted_delivery';
        });

    // Single-pass bucket: month key → week index → orders[]
    const monthBuckets = new Map<string, EnrichedOrder[][]>();
    for (const o of visible) {
      let weekBuckets = monthBuckets.get(o._monthKey);
      if (!weekBuckets) {
        weekBuckets = [[], [], [], [], []];
        monthBuckets.set(o._monthKey, weekBuckets);
      }
      weekBuckets[weekIndex(o._day)].push(o);
    }

    // Sort orders within each week oldest-first (createdAt strings sort correctly)
    monthBuckets.forEach(weekBuckets => weekBuckets.forEach(w => w.sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)));

    // Build final structure in monthsRange order
    return monthsRange
      .map(month => {
        const weekBuckets = monthBuckets.get(month.key);
        const weeks = weekBuckets
          ? WEEK_LABELS.map((label, i) => ({ label, orders: weekBuckets[i] })).filter(w => w.orders.length > 0)
          : [];
        const totalOrders = weekBuckets ? weekBuckets.reduce((s, w) => s + w.length, 0) : 0;
        return { ...month, weeks, totalOrders };
      })
      .filter(m => m.totalOrders > 0 || m.key === currentMonthKey);
  }, [orders, viewMode, monthsRange, currentMonthKey]);

  return (
    <div className={styles['backlog-page']}>
      <header className={styles['header']}>
        <div className={styles['header-left']}>
          <div className={styles['titles']}>
            <h1>Backlog Mosaic</h1>
            <p className={styles['subtitle']}>Orders history from Jan 2026</p>
          </div>
        </div>
        <div className={styles['header-actions']}>
          <div className={styles['legend']}>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.unfulfilled}`}></span> Unfulfilled</div>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.transit}`}></span> In Transit</div>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.delivered}`}></span> Delivered</div>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.failed}`}></span> Failed</div>
          </div>
          <div className={styles['view-selector']}>
            <label htmlFor="view-mode">View Mode</label>
            <select
              id="view-mode"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className={styles['select-input']}
            >
              <option value="default">Default (Actionable)</option>
              <option value="all">All Orders</option>
            </select>
          </div>
          <button className={styles['refresh-btn']} onClick={loadOrders} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? styles.spinning : ''}>
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className={styles['content']}>
        {loading ? (
          <div className={styles['loading-state']}>
            <div className={styles['spinner']}></div>
            <p>Scanning orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={styles['empty-state']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <h3>No results</h3>
            <p>No orders matched your current view criteria.</p>
          </div>
        ) : (
          <div className={styles['month-sections']}>
            {ordersByMonth.map(section => (
              <section key={section.key} className={styles['month-section']}>
                <div className={styles['section-header']}>
                  <h2 className={styles['month-title']}>{section.label}</h2>
                  <span className={styles['month-count']}>{section.totalOrders}</span>
                </div>
                <div className={styles['month-weeks']}>
                  {section.weeks.map(week => (
                    <div key={week.label} className={styles['week-block']}>
                      <h3 className={styles['week-title']}>{week.label} <span className={styles['week-count']}>({week.orders.length})</span></h3>
                      <div className={styles['orders-grid']}>
                        {week.orders.map(order => (
                          <div
                            key={order.id}
                            className={`${styles['order-box']} ${order._statusClass}`}
                            onClick={() => window.open(`https://admin.shopify.com/store/c3532f-a9/orders/${order.id}`, '_blank')}
                          >
                            <div className={styles['box-hover-card']}>
                              <div className={styles['card-name']}>{order.name}</div>
                              <div className={styles['card-customer']}>{order.customerName}</div>
                              <div className={styles['card-status']}>{order.deliveryStatus || order.fulfillmentStatus || 'Pending'}</div>
                              <div className={styles['card-items']}>
                                {order.lineItems.length > 0 ? (
                                  order.lineItems.map((item, idx) => (
                                    <div key={idx} className={styles['item-row']}>
                                      <span className={styles['item-qty']}>{item.quantity}x</span>
                                      <div className={styles['item-details']}>
                                        <span className={styles['item-title']}>{item.title}</span>
                                        {item.variantTitle && (
                                          <span className={styles['item-variant']}>{item.variantTitle}</span>
                                        )}
                                      </div>
                                    </div>
                                  ))
                                ) : (
                                  <div className={styles['item-row']}>No items listed</div>
                                )}
                              </div>
                              <div className={styles['card-date']}>{order._dateLabel}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
