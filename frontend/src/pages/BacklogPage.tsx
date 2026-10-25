import { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { api, type BacklogOrder } from '../services/api';
import { Button, Card, DataList, DeliveryBadge, Drawer, EmptyState, Icon, PageHeader, SegmentedControl, Skeleton } from '../components/ui/pbx';
import { cx } from '../components/ui/format';
import styles from './BacklogPage.module.css';
import toast from 'react-hot-toast';

type ViewMode = 'all' | 'default';

type StatusKey = 'unfulfilled' | 'confirmed' | 'transit' | 'delivered' | 'failed';

// Pre-computed fields attached to each order on load — never recomputed during render
interface EnrichedOrder extends BacklogOrder {
  _monthKey: string;   // 'YYYY-MM'
  _day: number;        // day-of-month for week bucketing
  _status: StatusKey;
  _statusText: string; // the raw status, readable
  _dateLabel: string;  // formatted display string
}

const WEEKS = [
  { label: 'Week 1', range: '1st–7th' },
  { label: 'Week 2', range: '8th–14th' },
  { label: 'Week 3', range: '15th–21st' },
  { label: 'Week 4', range: '22nd–28th' },
  { label: 'Week 5', range: '29th–end' },
] as const;

// Tile markers: hollow until shipped, then grey, blue, green or orange
const STATUS: Record<StatusKey, { label: string; className: string }> = {
  unfulfilled: { label: 'Unfulfilled', className: styles.unfulfilled },
  confirmed: { label: 'Confirmed', className: styles.confirmed },
  transit: { label: 'In transit', className: styles.transit },
  delivered: { label: 'Delivered', className: styles.delivered },
  failed: { label: 'Failed', className: styles.failed },
};

const STATUS_ORDER: StatusKey[] = ['unfulfilled', 'confirmed', 'transit', 'delivered', 'failed'];

const shopifyUrl = (order: BacklogOrder) => `https://admin.shopify.com/store/c3532f-a9/orders/${order.id}`;

function weekIndex(day: number): number {
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  if (day <= 28) return 3;
  return 4;
}

function computeStatus(order: BacklogOrder): StatusKey {
  const status = order.deliveryStatus?.toLowerCase() || '';
  if (status === 'delivered') return 'delivered';
  if (status.includes('fail') || status.includes('rto')) return 'failed';
  // Out for delivery shares the in-transit marker
  if (status.includes('transit') || status.includes('shipped') || status === 'out_for_delivery') return 'transit';
  if (!order.fulfillmentStatus || order.fulfillmentStatus === 'unfulfilled') return 'unfulfilled';
  return 'confirmed';
}

function enrich(order: BacklogOrder): EnrichedOrder {
  const d = new Date(order.createdAt);
  const month = d.getMonth() + 1;
  const raw = (order.deliveryStatus || order.fulfillmentStatus || 'pending').replace(/_/g, ' ');
  return {
    ...order,
    _monthKey: `${d.getFullYear()}-${String(month).padStart(2, '0')}`,
    _day: d.getDate(),
    _status: computeStatus(order),
    _statusText: raw.charAt(0).toUpperCase() + raw.slice(1),
    _dateLabel: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * One order tile. Its hover card is mounted only while the tile is hovered: rendering a
 * card for each of thousands of tiles up front made the page slow to open.
 */
const OrderTile = memo(function OrderTile({ order, onOpen }: { order: EnrichedOrder; onOpen: (order: EnrichedOrder) => void }) {
  const [tip, setTip] = useState<{ end: boolean; above: boolean } | null>(null);
  return (
    <a
      href={shopifyUrl(order)}
      target="_blank"
      rel="noopener noreferrer"
      className={cx(styles.tile, STATUS[order._status].className)}
      aria-label={`${order.name}, ${order._statusText}, ${order._dateLabel}`}
      onClick={(e) => {
        // A plain click opens the drawer; Cmd/Ctrl/Shift-click still opens Shopify.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onOpen(order);
      }}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setTip({ end: r.left > window.innerWidth / 2, above: r.bottom + 200 > window.innerHeight });
      }}
      onMouseLeave={() => setTip(null)}
    >
      {tip && (
        <span className={cx(styles.tip, tip.end && styles.tipEnd, tip.above && styles.tipAbove)} role="presentation">
          <strong>{order.name}</strong>
          {order.customerName && <span>{order.customerName}</span>}
          <span className={styles.tipStatus}>{order._statusText}</span>
          {order.lineItems.length > 0 ? (
            order.lineItems.map((item, idx) => (
              <span key={idx} className={styles.tipItem}>
                {item.quantity}× {item.title}{item.variantTitle ? ` · ${item.variantTitle}` : ''}
              </span>
            ))
          ) : (
            <span className={styles.tipItem}>No items listed</span>
          )}
          <span className={styles.tipDate}>{order._dateLabel}</span>
        </span>
      )}
    </a>
  );
});

export default function BacklogPage() {
  const [orders, setOrders] = useState<EnrichedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('default');
  const [openOrder, setOpenOrder] = useState<EnrichedOrder | null>(null);
  const handleOpen = useCallback((order: EnrichedOrder) => setOpenOrder(order), []);

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

  // Filter once, then single-pass bucket into month → week, counting statuses on the way
  const { ordersByMonth, statusCounts, visibleCount } = useMemo(() => {
    const visible = viewMode === 'all'
      ? orders
      : orders.filter(o => {
          const s = o.deliveryStatus?.toLowerCase() || '';
          return s !== 'delivered' && !s.includes('fail') && !s.includes('rto') && s !== 'attempted_delivery';
        });

    const counts: Record<StatusKey, number> = { unfulfilled: 0, confirmed: 0, transit: 0, delivered: 0, failed: 0 };
    const monthBuckets = new Map<string, EnrichedOrder[][]>();
    for (const o of visible) {
      counts[o._status]++;
      let weekBuckets = monthBuckets.get(o._monthKey);
      if (!weekBuckets) {
        weekBuckets = [[], [], [], [], []];
        monthBuckets.set(o._monthKey, weekBuckets);
      }
      weekBuckets[weekIndex(o._day)].push(o);
    }

    // Sort orders within each week oldest-first (createdAt strings sort correctly)
    monthBuckets.forEach(weekBuckets => weekBuckets.forEach(w => w.sort((a, b) => a.createdAt < b.createdAt ? -1 : 1)));

    // Months and weeks in calendar order, oldest first, so stuck orders come up top
    const months = monthsRange
      .map(month => {
        const weekBuckets = monthBuckets.get(month.key);
        // All five weeks, so the columns line up month to month
        const weeks = WEEKS.map((week, i) => ({ ...week, orders: weekBuckets ? weekBuckets[i] : [] }));
        const totalOrders = weekBuckets ? weekBuckets.reduce((s, w) => s + w.length, 0) : 0;
        return { ...month, weeks, totalOrders };
      })
      .filter(m => m.totalOrders > 0 || m.key === currentMonthKey);
    return { ordersByMonth: months, statusCounts: counts, visibleCount: visible.length };
  }, [orders, viewMode, monthsRange, currentMonthKey]);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Backlog"
        description="Order history since January 2026, by month and week. Hover a tile for its order; click to open it."
        actions={
          <>
            <SegmentedControl
              size="sm"
              label="View"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              options={[{ value: 'default', label: 'Actionable' }, { value: 'all', label: 'All orders' }]}
            />
            <Button size="sm" icon="refresh-cw" loading={loading} onClick={() => { api.invalidateCache(); loadOrders(); }}>
              Refresh
            </Button>
          </>
        }
      />

      <div className={styles.legend} aria-label="Tile colours">
        {STATUS_ORDER.map((key) => (
          <span key={key} className={cx(styles.legendItem, statusCounts[key] === 0 && styles.legendEmpty)}>
            <span className={cx(styles.swatch, STATUS[key].className)} aria-hidden="true" />
            {STATUS[key].label}
            <b>{loading ? '—' : statusCounts[key].toLocaleString('en-IN')}</b>
          </span>
        ))}
        <span className={styles.legendTotal}>{loading ? '' : `${visibleCount.toLocaleString('en-IN')} orders`}</span>
      </div>

      {loading ? (
        <div className={styles.loading} aria-busy="true">
          {[1, 2, 3].map((i) => <Skeleton key={i} height={120} />)}
        </div>
      ) : visibleCount === 0 ? (
        <EmptyState
          icon="search"
          title="No orders match this view"
          description={viewMode === 'default' ? 'Every order is delivered or failed. Switch to All orders to see them.' : 'No orders since January 2026.'}
        />
      ) : (
        ordersByMonth.map(section => (
          <Card key={section.key} title={section.label} eyebrow={`${section.totalOrders.toLocaleString('en-IN')} orders`}>
            {section.totalOrders === 0 ? (
              <p className={styles.none}>No orders in this view yet this month.</p>
            ) : (
              <div className={styles.weeks}>
                {section.weeks.map(week => (
                  <div key={week.label} className={styles.week}>
                    <div className={styles.weekLabel}>
                      <span>{week.label}</span>
                      <span className={styles.weekMeta}>{`${week.range} · ${week.orders.length}`}</span>
                    </div>
                    {week.orders.length > 0 ? (
                      <div className={styles.tiles}>
                        {week.orders.map(order => (
                          <OrderTile key={order.id} order={order} onOpen={handleOpen} />
                        ))}
                      </div>
                    ) : (
                      <span className={styles.weekEmpty}>—</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      <Drawer
        open={!!openOrder}
        onClose={() => setOpenOrder(null)}
        title={openOrder?.name ?? ''}
        description={openOrder ? [openOrder.customerName, `placed ${openOrder._dateLabel}`].filter(Boolean).join(' · ') : undefined}
        footer={openOrder ? (
          <a href={shopifyUrl(openOrder)} target="_blank" rel="noopener noreferrer" className="pbx-btn pbx-btn--primary pbx-btn--sm">
            <Icon name="external-link" size={14} />
            Open in Shopify
          </a>
        ) : undefined}
      >
        {openOrder && (
          <div className={styles.drawerBody}>
            <DataList
              items={[
                { label: 'Delivery status', value: openOrder.deliveryStatus ? <DeliveryBadge status={openOrder.deliveryStatus} size="sm" /> : '—' },
                { label: 'Fulfilment', value: (openOrder.fulfillmentStatus || 'unfulfilled').replace(/_/g, ' ') },
                { label: 'Backlog marker', value: STATUS[openOrder._status].label },
              ]}
            />
            <DataList
              title="Items"
              items={openOrder.lineItems.length > 0
                ? openOrder.lineItems.map((item) => ({ label: item.title, sub: item.variantTitle ?? undefined, value: `× ${item.quantity}` }))
                : [{ label: 'No items listed', value: '—', tone: 'muted' as const }]}
            />
          </div>
        )}
      </Drawer>
    </div>
  );
}
