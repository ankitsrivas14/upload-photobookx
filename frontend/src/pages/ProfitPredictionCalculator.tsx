import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services/api';
import { Alert, Button, Card, DataList, EmptyState, SegmentedControl, Skeleton, StatCard, StatStrip, TextField } from '../components/ui/pbx';
import { formatINR } from '../components/ui/format';
import { AXIS_TICK, TOOLTIP_ITEM, TOOLTIP_LABEL, TOOLTIP_STYLE } from './dashboard/chartStyles';
import styles from './ProfitPredictionCalculator.module.css';

type DayOption = 7 | 14 | 30 | 90;

const PERIODS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

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

interface WeekPoint {
  label: string;
  avgRevenue: number | null;
  avgCosts: number | null;
  avgProfit: number | null;
  profitMargin: number | null;
  roas: number | null;
}

const rupees = (value: number, decimals = 0) => formatINR(value, { decimals });
const count = (value: number) => value.toLocaleString('en-IN');

interface TrendChartProps {
  title: string;
  data: WeekPoint[];
  dataKey: keyof Omit<WeekPoint, 'label'>;
  formatValue: (v: number) => string;
  zeroLine?: boolean;
}

/** One weekly metric as a small line chart on the Ledger chart styles. */
function TrendChart({ title, data, dataKey, formatValue, zeroLine }: TrendChartProps) {
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartTitle}>{title}</figcaption>
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} minTickGap={24} interval="preserveStartEnd" />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={formatValue} width={56} />
          {zeroLine ? <ReferenceLine y={0} stroke="var(--line-strong)" /> : null}
          <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} formatter={(v) => [formatValue(Number(v)), title]} />
          <Line type="linear" dataKey={dataKey} stroke="var(--chart-line)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: 'var(--chart-highlight)', stroke: 'none' }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}

/** Profit calculator: per-order averages and totals for a period, and what a monthly profit target needs. */
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
      toast.error('Could not load the averages. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      const res = await api.backfillDailyPnl();
      if (res.success) toast.success('Profit and loss recomputed');
      else toast.error(res.error || 'Could not sync profit and loss');
      await load(days);
    } catch (err) {
      console.error('Failed to sync PnL data:', err);
      toast.error('Could not sync profit and loss');
    } finally {
      setIsSyncing(false);
    }
  };

  const needsSync = summary !== null && summary.orders > 0 && summary.revenue === 0;

  const chartData = useMemo<WeekPoint[]>(() => {
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

  const syncButton = (
    <Button size="sm" icon="refresh-cw" loading={isSyncing} disabled={isLoading} onClick={handleSync}>
      {isSyncing ? 'Syncing…' : 'Sync P/L'}
    </Button>
  );

  return (
    <div className={styles.calculator}>
      <div className={styles.toolbar}>
        <SegmentedControl size="sm" label="Period" value={String(days)} onChange={(v) => setDays(Number(v) as DayOption)} options={PERIODS} />
        {syncButton}
      </div>

      {needsSync && (
        <Alert tone="caution" title="Revenue is missing for this period">
          Sync P/L recomputes daily profit and loss from the order history.
        </Alert>
      )}

      {isLoading ? (
        <div className={styles.loading}>
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={160} />
        </div>
      ) : !summary ? (
        <EmptyState icon="calculator" title="No profit and loss data yet" description="Sync P/L to compute it from the order history." action={syncButton} />
      ) : (
        <>
          <Card
            title="Current averages"
            eyebrow={`${summary.completedDays} completed days · ${count(summary.orders)} orders`}
            description={summary.completedDays < summary.days ? 'Days with orders still pending are left out.' : undefined}
            padding="none"
          >
            <StatStrip label="Current averages" minWidth={140}>
              <StatCard label="Revenue per order" value={rupees(summary.avgRevenuePerOrder, 2)} />
              <StatCard label="Costs per order" value={rupees(summary.avgCogsPerOrder, 2)} sub="COGS, shipping and ads" />
              <StatCard
                label="Profit per order"
                value={formatINR(summary.avgProfitPerOrder, { decimals: 2, signed: true })}
                tone={summary.avgProfitPerOrder >= 0 ? 'positive' : 'negative'}
              />
              <StatCard label="Profit margin" value={`${summary.profitMargin.toFixed(1)}%`} tone={summary.profitMargin >= 0 ? 'positive' : 'negative'} />
              <StatCard label="ROAS" value={`${summary.roas.toFixed(2)}×`} />
            </StatStrip>
          </Card>

          <Card title="Period totals" eyebrow={`Last ${summary.days} days`} padding="none">
            <StatStrip label="Period totals" minWidth={140}>
              <StatCard label="Revenue" value={rupees(summary.revenue)} />
              <StatCard label="COGS and shipping" value={rupees(summary.cogs)} />
              <StatCard label="Ad spend" value={rupees(summary.adSpend)} />
              <StatCard label="Profit" value={formatINR(summary.profit, { signed: true })} tone={summary.profit >= 0 ? 'positive' : 'negative'} />
            </StatStrip>
          </Card>

          <Card
            title="Profit target"
            description="What a monthly profit needs at the averages above."
            footer={prediction ? `At ${rupees(summary.avgProfitPerOrder, 2)} profit per order and ${summary.roas.toFixed(2)}× ROAS; a month is 30 days.` : undefined}
          >
            <TextField
              className={styles.target}
              label="Monthly profit target"
              prefix="₹"
              type="number"
              min="0"
              step="1000"
              placeholder="500000"
              value={targetMonthlyProfit}
              onChange={(e) => setTargetMonthlyProfit(e.target.value)}
              hint={targetNum > 0 && !prediction ? 'Profit per order is zero or negative, so no number of orders reaches this target.' : undefined}
            />

            {prediction && (
              <div className={styles.results}>
                <DataList
                  title="Each month"
                  items={[
                    { label: 'Orders', value: count(Math.ceil(prediction.monthlyOrders)) },
                    { label: 'Revenue', value: rupees(prediction.monthlyRevenue) },
                    { label: 'Ad spend', value: rupees(prediction.monthlyAdSpend) },
                  ]}
                  total={{ label: 'Profit', value: rupees(targetNum), tone: 'positive' }}
                />
                <DataList
                  title="Each day"
                  items={[
                    { label: 'Orders', value: prediction.dailyOrders.toFixed(1) },
                    { label: 'Revenue', value: rupees(prediction.dailyRevenue) },
                    { label: 'Ad spend', value: rupees(prediction.dailyAdSpend) },
                  ]}
                  total={{ label: 'Profit', value: rupees(prediction.dailyProfit), tone: 'positive' }}
                />
              </div>
            )}
          </Card>

          {chartData.length > 0 && (
            <Card title="Weekly trends" eyebrow={`Last ${summary.days} days`}>
              <div className={styles.charts}>
                <TrendChart title="Revenue per order" data={chartData} dataKey="avgRevenue" formatValue={(v) => rupees(v)} />
                <TrendChart title="Costs per order" data={chartData} dataKey="avgCosts" formatValue={(v) => rupees(v)} />
                <TrendChart title="Profit per order" data={chartData} dataKey="avgProfit" formatValue={(v) => rupees(v)} zeroLine />
                <TrendChart title="Profit margin" data={chartData} dataKey="profitMargin" formatValue={(v) => `${v.toFixed(1)}%`} zeroLine />
                <TrendChart title="ROAS" data={chartData} dataKey="roas" formatValue={(v) => `${v.toFixed(2)}×`} />
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
