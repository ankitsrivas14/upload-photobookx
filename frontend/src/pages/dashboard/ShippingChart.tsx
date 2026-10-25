import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { Card, DataList, SegmentedControl } from '../../components/ui/pbx';
import { formatINR } from '../../components/ui/format';
import { AXIS_TICK, REF_LABEL, TOOLTIP_ITEM, TOOLTIP_LABEL, TOOLTIP_STYLE } from './chartStyles';
import styles from '../DashboardPage.module.css';

const STORE_TIMEZONE = 'Asia/Kolkata';

type Granularity = 'day' | 'week' | 'month';
type LineKey = 'all' | 'small' | 'large';

export interface ShippingRecord {
  dateKey: string;
  avgShipping: number | null;
  avgShippingSmall: number | null;
  avgShippingLarge: number | null;
}

type ChartPoint = Omit<ShippingRecord, 'dateKey'> & { date: string };

// Small and large differ by dash as well as colour, so the lines stay apart without colour vision.
const LINES = [
  { key: 'all' as const, dataKey: 'avgShipping' as const, name: 'All fulfilled', color: 'var(--chart-line)', dash: undefined },
  { key: 'small' as const, dataKey: 'avgShippingSmall' as const, name: 'Small variant', color: 'var(--chart-highlight)', dash: '5 3' },
  { key: 'large' as const, dataKey: 'avgShippingLarge' as const, name: 'Large variant', color: 'var(--chart-amber)', dash: '2 2' },
];

const GRANULARITY_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const avgOfNums = (arr: (number | null)[]): number | null => {
  const valid = arr.filter((v): v is number => v !== null && v > 0);
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
};

const toLabel = (dateKey: string) =>
  new Date(dateKey).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: STORE_TIMEZONE });

const groupAverage = (date: string, group: ShippingRecord[]): ChartPoint => ({
  date,
  avgShipping: avgOfNums(group.map((r) => r.avgShipping)),
  avgShippingSmall: avgOfNums(group.map((r) => r.avgShippingSmall)),
  avgShippingLarge: avgOfNums(group.map((r) => r.avgShippingLarge)),
});

interface ShippingChartProps {
  records: ShippingRecord[];
  granularity: Granularity;
  onGranularity: (granularity: Granularity) => void;
  active: Record<LineKey, boolean>;
  onToggle: (key: LineKey) => void;
}

/** Average Shiprocket charge on fulfilled orders over the last 30 points, plus 30-day averages. */
export function ShippingChart({ records, granularity, onGranularity, active, onToggle }: ShippingChartProps) {
  // 30-point lookback window, never before 2026-01-01
  const now = new Date();
  const todayKey = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const windowStart = new Date(now);
  if (granularity === 'day') windowStart.setDate(windowStart.getDate() - 29);
  else if (granularity === 'week') windowStart.setDate(windowStart.getDate() - 29 * 7);
  else { windowStart.setMonth(windowStart.getMonth() - 29); windowStart.setDate(1); }
  const cutoffKey = '2026-01-01';
  const windowKey = windowStart.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const effectiveStartKey = cutoffKey > windowKey ? cutoffKey : windowKey;
  const windowed = records.filter((r) => r.dateKey >= effectiveStartKey && r.dateKey <= todayKey);

  let data: ChartPoint[];
  if (granularity === 'day') {
    // Raw daily values — the real per-day average shipping charge, no smoothing.
    data = windowed.map(({ dateKey, ...rest }) => ({ date: toLabel(dateKey), ...rest }));
  } else if (granularity === 'week') {
    // Weeks start on Monday.
    const weeks: ShippingRecord[][] = [];
    let cur: ShippingRecord[] = [];
    windowed.forEach((r) => {
      if (new Date(r.dateKey).getDay() === 1 && cur.length > 0) { weeks.push(cur); cur = []; }
      cur.push(r);
    });
    if (cur.length) weeks.push(cur);
    data = weeks.map((g) => groupAverage(`${toLabel(g[0].dateKey)} – ${toLabel(g[g.length - 1].dateKey)}`, g));
  } else {
    const months: Record<string, ShippingRecord[]> = {};
    windowed.forEach((r) => {
      (months[r.dateKey.slice(0, 7)] ??= []).push(r);
    });
    data = Object.values(months).map((g) =>
      groupAverage(new Date(g[0].dateKey).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: STORE_TIMEZONE }), g),
    );
  }

  // Reference line: the mean of the first shown line across the window
  const avgKey = active.all ? 'avgShipping' : active.small ? 'avgShippingSmall' : 'avgShippingLarge';
  const shownAvg = avgOfNums(data.map((d) => d[avgKey]));

  // Y ticks every ₹30 around the shown lines
  const shown = data
    .flatMap((d) => LINES.map((l) => (active[l.key] ? d[l.dataKey] : null)))
    .filter((v): v is number => v !== null);
  const tickMin = shown.length ? Math.floor(Math.min(...shown) / 30) * 30 : 0;
  const tickMax = shown.length ? Math.ceil(Math.max(...shown) / 30) * 30 : 120;
  const ticks: number[] = [];
  for (let t = tickMin; t <= tickMax; t += 30) ticks.push(t);

  // 30-day averages over the daily records
  const since = new Date(now);
  since.setDate(since.getDate() - 29);
  const sinceKey = since.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const last30 = records.filter((r) => r.dateKey >= sinceKey);
  const fmt = (v: number | null) => (v !== null ? formatINR(v, { decimals: 2 }) : '—');

  return (
    <>
      <Card
        className={styles.wide}
        title="Shipping charge · fulfilled orders"
        eyebrow="orders with both sizes count only in All"
        actions={
          <>
            <SegmentedControl
              size="sm"
              label="Group by"
              value={granularity}
              onChange={(v) => onGranularity(v as Granularity)}
              options={GRANULARITY_OPTIONS}
            />
            <span className={styles.toggles}>
              {LINES.map((l) => (
                <button key={l.key} type="button" className={styles.toggle} aria-pressed={active[l.key]} onClick={() => onToggle(l.key)}>
                  <svg width="16" height="6" aria-hidden="true">
                    <line x1="0" y1="3" x2="16" y2="3" stroke={l.color} strokeWidth={2} strokeDasharray={l.dash} />
                  </svg>
                  {l.name}
                </button>
              ))}
            </span>
          </>
        }
      >
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} interval="preserveStartEnd" minTickGap={30} />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={48}
              ticks={ticks}
              domain={[tickMin, tickMax]}
              tickFormatter={(v: number) => formatINR(v, { compact: true })}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL}
              itemStyle={TOOLTIP_ITEM}
              formatter={(value, name) => [value !== null && value !== undefined ? formatINR(Number(value), { decimals: 2 }) : '—', name]}
            />
            {shownAvg !== null && (
              <ReferenceLine
                y={shownAvg}
                stroke="var(--ink-subtle)"
                strokeDasharray="4 3"
                label={{ ...REF_LABEL, value: `avg ${formatINR(shownAvg)}`, position: 'insideTopRight' }}
              />
            )}
            {LINES.map((l) =>
              active[l.key] ? (
                <Line
                  key={l.key}
                  type="linear"
                  dataKey={l.dataKey}
                  name={l.name}
                  stroke={l.color}
                  strokeWidth={1.5}
                  strokeDasharray={l.dash}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: l.color }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : null,
            )}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Shipping · 30-day average" eyebrow="per fulfilled order">
        <DataList
          items={[
            { label: 'All fulfilled', sub: 'every fulfilled order', value: fmt(avgOfNums(last30.map((r) => r.avgShipping))) },
            { label: 'Small variant', sub: 'orders with only small items', value: fmt(avgOfNums(last30.map((r) => r.avgShippingSmall))) },
            { label: 'Large variant', sub: 'orders with only large items', value: fmt(avgOfNums(last30.map((r) => r.avgShippingLarge))) },
          ]}
        />
      </Card>
    </>
  );
}
