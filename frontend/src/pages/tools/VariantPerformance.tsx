import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import { Amount, Card, DataTable, EmptyState, SegmentedControl, type Column } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import styles from './VariantPerformance.module.css';

type DayOption = 7 | 14 | 30 | 90;
type Tone = 'positive' | 'caution' | 'negative';

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

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

interface RankedRow extends Bucket {
  key: string;
  rank: number;
  profitBar: number;
  marginBar: number;
}

interface SplitRow {
  label: string;
  orders: number;
  avgProfitPerOrder: number;
  profitMargin: number;
  rtoRate: number;
}

const LABELS: Record<string, string> = {
  'small-prepaid': 'Small · Prepaid',
  'small-cod':     'Small · COD',
  'large-prepaid': 'Large · Prepaid',
  'large-cod':     'Large · COD',
};

const RANK_LABELS = ['1st', '2nd', '3rd', '4th'];

const count = (n: number) => n.toLocaleString('en-IN');
const signedTone = (value: number): Tone => (value >= 0 ? 'positive' : 'negative');
// Up to 10% RTO is healthy, up to 20% needs watching, above that is a problem.
const rtoTone = (rate: number): Tone => (rate <= 10 ? 'positive' : rate <= 20 ? 'caution' : 'negative');

/** A thin bar under a figure; `value` is 0–100. */
function Meter({ value, tone }: { value: number; tone: Tone }) {
  return (
    <span className={styles.meter} aria-hidden="true">
      <span className={cx(styles.fill, styles[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

const Percent = ({ value, tone }: { value: number; tone: Tone }) => <span className={cx('pbx-num', styles[tone])}>{value.toFixed(1)}%</span>;

const RANK_COLUMNS: Column<RankedRow>[] = [
  { key: 'rank', header: 'Rank', width: 48, render: (r) => <span className={cx(styles.rank, r.rank === 0 && styles.first)}>{RANK_LABELS[r.rank]}</span> },
  {
    key: 'variant',
    header: 'Variant and payment',
    render: (r) => (
      <span className={styles.name}>
        <span className={styles.label}>{LABELS[r.key]}</span>
        <span className={styles.sub}>{count(r.orders)} orders</span>
      </span>
    ),
  },
  {
    key: 'avgProfitPerOrder',
    header: 'Profit per order',
    numeric: true,
    render: (r) => (
      <span className={styles.metric}>
        <Amount value={r.avgProfitPerOrder} signed />
        <Meter value={r.profitBar} tone={signedTone(r.avgProfitPerOrder)} />
      </span>
    ),
  },
  {
    key: 'profitMargin',
    header: 'Margin',
    numeric: true,
    render: (r) => (
      <span className={styles.metric}>
        <Percent value={r.profitMargin} tone={signedTone(r.profitMargin)} />
        <Meter value={r.marginBar} tone={signedTone(r.profitMargin)} />
      </span>
    ),
  },
  {
    key: 'rtoRate',
    header: 'RTO',
    numeric: true,
    render: (r) => (
      <span className={styles.metric}>
        <Percent value={r.rtoRate} tone={rtoTone(r.rtoRate)} />
        <Meter value={(r.rtoRate / 40) * 100} tone={rtoTone(r.rtoRate)} />
      </span>
    ),
  },
  { key: 'profit', header: 'Total profit', numeric: true, render: (r) => <Amount value={r.profit} signed /> },
];

const SPLIT_COLUMNS: Column<SplitRow>[] = [
  { key: 'label', header: 'Group', render: (r) => <span className={styles.label}>{r.label}</span> },
  { key: 'orders', header: 'Orders', numeric: true, render: (r) => count(r.orders) },
  { key: 'avgProfitPerOrder', header: 'Profit per order', numeric: true, render: (r) => <Amount value={r.avgProfitPerOrder} signed /> },
  { key: 'profitMargin', header: 'Margin', numeric: true, render: (r) => <Percent value={r.profitMargin} tone={signedTone(r.profitMargin)} /> },
  { key: 'rtoRate', header: 'RTO', numeric: true, render: (r) => <Percent value={r.rtoRate} tone={rtoTone(r.rtoRate)} /> },
];

/** Variant performance: the four size and payment combinations ranked by profit per order, and two head-to-heads. */
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
      toast.error('Could not load variant performance. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const ranked = useMemo<RankedRow[]>(() => {
    const sorted = [...buckets].sort((a, b) => b.avgProfitPerOrder - a.avgProfitPerOrder);
    const maxProfit = sorted[0]?.avgProfitPerOrder ?? 1;
    const maxMargin = Math.max(...sorted.map(b => Math.abs(b.profitMargin)), 1);
    return sorted.map((b, rank) => ({
      ...b,
      key: `${b.variant}-${b.payment}`,
      rank,
      profitBar: maxProfit > 0 ? Math.max((b.avgProfitPerOrder / maxProfit) * 100, 0) : 0,
      marginBar: Math.min(Math.abs(b.profitMargin) / maxMargin * 100, 100),
    }));
  }, [buckets]);

  const totalPending = buckets.reduce((s, b) => s + b.pending, 0);

  const agg = (label: string, rows: Bucket[]): SplitRow => {
    const orders = rows.reduce((s, b) => s + b.orders, 0);
    const profit = rows.reduce((s, b) => s + b.profit, 0);
    const revenue = rows.reduce((s, b) => s + b.revenue, 0);
    const rto = rows.reduce((s, b) => s + b.rto, 0);
    return {
      label,
      orders,
      avgProfitPerOrder: orders > 0 ? profit / orders : 0,
      profitMargin: revenue > 0 ? (profit / revenue) * 100 : 0,
      rtoRate: orders > 0 ? (rto / orders) * 100 : 0,
    };
  };

  // Dimension splits
  const splits = [
    { title: 'Small vs Large', rows: [agg('Small', buckets.filter(b => b.variant === 'small')), agg('Large', buckets.filter(b => b.variant === 'large'))] },
    { title: 'Prepaid vs COD', rows: [agg('Prepaid', buckets.filter(b => b.payment === 'prepaid')), agg('COD', buckets.filter(b => b.payment === 'cod'))] },
  ];

  return (
    <div className={styles.variants}>
      <div className={styles.toolbar}>
        <SegmentedControl size="sm" label="Period" value={String(days)} onChange={(v) => setDays(Number(v) as DayOption)} options={PERIODS} />
        <p className={styles.note}>
          Delivered and failed orders only.
          {!isLoading && totalPending > 0 ? ` ${count(totalPending)} orders still in transit are left out until they settle.` : ''}
        </p>
      </div>

      <Card title="Ranking" description="By profit per order." padding="none">
        <DataTable
          columns={RANK_COLUMNS}
          rows={ranked}
          getRowId={(r) => r.key}
          loading={isLoading}
          caption="Variant and payment combinations ranked by profit per order"
          empty={<EmptyState size="sm" icon="layers" title="No settled orders" description="Nothing was delivered or failed in this period." />}
        />
      </Card>

      <div className={styles.splits}>
        {splits.map((split) => (
          <Card key={split.title} title={split.title} padding="none">
            <DataTable columns={SPLIT_COLUMNS} rows={split.rows} getRowId={(r) => r.label} loading={isLoading} caption={split.title} />
          </Card>
        ))}
      </div>
    </div>
  );
}
