import { useEffect, useState } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Alert, Card, EmptyState, Skeleton } from '../../components/ui/pbx';
import { cx, formatINR } from '../../components/ui/format';
import { api, type MetaCpaPeriod } from '../../services/api';
import { AXIS_TICK, CURSOR_FILL, REF_LABEL } from './chartStyles';
import { LineSwatch } from './LineSwatch';
import styles from '../DashboardPage.module.css';

/** The weekly chart shows about six months. */
const WEEKS_SHOWN = 26;

interface Row extends MetaCpaPeriod {
  /** Axis label: "19 Oct" for a week, "Oct" for a month. */
  label: string;
  /** Tooltip heading: "19 Oct – 25 Oct 2026", or "October 2026". */
  title: string;
  /** The period running now, still filling in. */
  current: boolean;
}

const fromKey = (key: string) => new Date(key + 'T00:00:00');
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// The ad account and the store both keep India time.
const todayIst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dayMonth = (d: Date) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

function weekRows(weeks: MetaCpaPeriod[]): Row[] {
  const today = todayIst();
  return weeks.slice(-WEEKS_SHOWN).map((w) => {
    const start = fromKey(w.start);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const current = w.start <= today && today <= keyOf(end);
    return {
      ...w,
      label: dayMonth(start),
      title: `${dayMonth(start)} – ${end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}${current ? ' (so far)' : ''}`,
      current,
    };
  });
}

function monthRows(months: MetaCpaPeriod[]): Row[] {
  const thisMonth = todayIst().slice(0, 7);
  const severalYears = new Set(months.map((m) => m.start.slice(0, 4))).size > 1;
  return months.map((m) => {
    const current = m.start.slice(0, 7) === thisMonth;
    const start = fromKey(m.start);
    return {
      ...m,
      label: start.toLocaleDateString('en-IN', severalYears ? { month: 'short', year: '2-digit' } : { month: 'short' }),
      title: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) + (current ? ' (so far)' : ''),
      current,
    };
  });
}

/**
 * Five evenly spaced ticks from 0 that cover `max`, on a round step (1, 2, 2.5 or 5 × 10ⁿ). Both
 * scales use five, so the grid lines meet the CPA and the spend labels alike.
 */
function niceTicks(max: number): number[] {
  const raw = max > 0 ? max / 4 : 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

/** Average CPA over the periods shown: their spend divided by their purchases. */
function averageCpa(rows: Row[]): number | null {
  const spend = rows.reduce((s, r) => s + r.spend, 0);
  const purchases = rows.reduce((s, r) => s + r.purchases, 0);
  return spend > 0 && purchases > 0 ? Math.round(spend / purchases) : null;
}

function CpaTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
  if (!row) return null;
  return (
    <div className={styles.cpaTip}>
      <div className={styles.cpaTipTitle}>{row.title}</div>
      <div className={styles.cpaTipValue}>{row.cpa != null ? `CPA ${formatINR(row.cpa)}` : row.spend > 0 ? 'No purchases' : 'No spend'}</div>
      <div className={styles.cpaTipSub}>{`${formatINR(row.spend)} spent · ${row.purchases.toLocaleString('en-IN')} purchase${row.purchases === 1 ? '' : 's'}`}</div>
    </div>
  );
}

/**
 * CPA per period as bars on the left scale, ad spend as a line on the right scale, and the average
 * CPA as a dashed line. The running period's bar is in the highlight colour; `labels` prints each
 * bar's CPA.
 */
function CpaChart({ rows, average, labels }: { rows: Row[]; average: number | null; labels?: boolean }) {
  const cpaTicks = niceTicks(Math.max(average ?? 0, ...rows.map((r) => r.cpa ?? 0)));
  const spendTicks = niceTicks(Math.max(...rows.map((r) => r.spend)));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={rows} margin={{ top: labels ? 18 : 8, right: 0, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} interval="preserveStartEnd" minTickGap={12} />
        <YAxis yAxisId="cpa" ticks={cpaTicks} domain={[0, cpaTicks[4]]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatINR(v)} />
        <YAxis yAxisId="spend" orientation="right" ticks={spendTicks} domain={[0, spendTicks[4]]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatINR(v, { compact: true })} />
        <ChartTooltip cursor={CURSOR_FILL} content={({ active, payload }) => <CpaTooltip active={active} payload={payload} />} />
        <Bar yAxisId="cpa" dataKey="cpa" isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.start} fill={r.current ? 'var(--chart-highlight)' : 'var(--chart-bar)'} />
          ))}
          {labels ? <LabelList dataKey="cpa" position="top" {...REF_LABEL} formatter={(v) => (typeof v === 'number' ? formatINR(v) : '')} /> : null}
        </Bar>
        {average != null ? <ReferenceLine yAxisId="cpa" y={average} stroke="var(--ink-subtle)" strokeDasharray="4 3" /> : null}
        <Line yAxisId="spend" dataKey="spend" type="monotone" stroke="var(--chart-line)" strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** The chart's key, in the card footer: the spend line, the average, and the running period. */
function ChartKey({ rows, average, running }: { rows: Row[]; average: number | null; running: string }) {
  return (
    <>
      <span className={cx(styles.key, styles.metaKey)}>
        <LineSwatch color="var(--chart-line)" solid />
        ad spend (right)
      </span>
      {average != null ? (
        <span className={cx(styles.key, styles.metaKey)}>
          <LineSwatch color="var(--ink-subtle)" />
          {`avg CPA ${formatINR(average)}`}
        </span>
      ) : null}
      {rows.some((r) => r.current) ? (
        <span className={cx(styles.key, styles.metaKey)}>
          <span className={styles.barSwatch} aria-hidden="true" />
          {running}
        </span>
      ) : null}
    </>
  );
}

/**
 * The Dashboard's Meta account area: numbers straight from the Meta ad account, which the backend
 * syncs every hour. For now, cost per purchase (CPA) and ad spend by week and by month across all
 * campaigns.
 */
export function MetaAccountSection() {
  const [data, setData] = useState<{ weeks: Row[]; months: Row[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api
      .getMetaCpa()
      .then((res) => {
        if (!live) return;
        if (!res.success) {
          setError(res.error || 'Could not load the Meta figures.');
          return;
        }
        setData({ weeks: weekRows(res.weeks ?? []), months: monthRows(res.months ?? []) });
      })
      .catch(() => {
        if (live) setError('Could not load the Meta figures.');
      });
    return () => {
      live = false;
    };
  }, []);

  const weekAverage = data ? averageCpa(data.weeks) : null;
  const monthAverage = data ? averageCpa(data.months) : null;
  const firstMonth = data?.months[0] ? fromKey(data.months[0].start).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : null;

  return (
    <section className={styles.metaArea} aria-labelledby="meta-account-title">
      <div className={styles.metaHead}>
        <h2 id="meta-account-title" className={styles.metaTitle}>Meta account</h2>
        <p className={styles.metaNote}>
          Straight from the Meta ad account, synced every hour. CPA is ad spend divided by purchases, as Ads Manager counts them, across every campaign.
        </p>
      </div>
      {error ? (
        <Alert tone="negative" title={error} />
      ) : data && data.weeks.length === 0 ? (
        <EmptyState icon="chart-column" title="No Meta data yet" description="The hourly sync hasn't stored any ad spend." />
      ) : (
        <div className={styles.metaRow}>
          <Card
            title="Weekly CPA and ad spend"
            eyebrow={`Monday to Sunday · last ${WEEKS_SHOWN} weeks`}
            footer={data ? <ChartKey rows={data.weeks} average={weekAverage} running="this week" /> : undefined}
          >
            {data ? <CpaChart rows={data.weeks} average={weekAverage} /> : <Skeleton height={240} />}
          </Card>
          <Card
            title="Monthly CPA and ad spend"
            eyebrow={firstMonth ? `by calendar month · from ${firstMonth}` : 'by calendar month'}
            footer={data ? <ChartKey rows={data.months} average={monthAverage} running="this month" /> : undefined}
          >
            {data ? <CpaChart rows={data.months} average={monthAverage} labels /> : <Skeleton height={240} />}
          </Card>
        </div>
      )}
    </section>
  );
}
