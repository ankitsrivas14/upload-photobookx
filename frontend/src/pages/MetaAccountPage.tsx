import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Alert, Card, EmptyState, PageHeader, Skeleton } from '../components/ui/pbx';
import { formatINR } from '../components/ui/format';
import { api, type MetaCpaPeriod } from '../services/api';
import { AXIS_TICK, CURSOR_FILL, REF_LABEL } from './dashboard/chartStyles';
import styles from './MetaAccountPage.module.css';

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

function CpaTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
  if (!row) return null;
  return (
    <div className={styles.tip}>
      <div className={styles.tipTitle}>{row.title}</div>
      <div className={styles.tipValue}>{row.cpa != null ? `CPA ${formatINR(row.cpa)}` : row.spend > 0 ? 'No purchases' : 'No spend'}</div>
      <div className={styles.tipSub}>{`${formatINR(row.spend)} spent · ${row.purchases.toLocaleString('en-IN')} purchase${row.purchases === 1 ? '' : 's'}`}</div>
    </div>
  );
}

/** CPA per period as bars; the running period in the highlight colour. `labels` prints each bar's value. */
function CpaChart({ rows, labels }: { rows: Row[]; labels?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: labels ? 18 : 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => formatINR(v)} />
        <ChartTooltip cursor={CURSOR_FILL} content={({ active, payload }) => <CpaTooltip active={active} payload={payload} />} />
        <Bar dataKey="cpa" isAnimationActive={false}>
          {rows.map((r) => (
            <Cell key={r.start} fill={r.current ? 'var(--chart-highlight)' : 'var(--chart-bar)'} />
          ))}
          {labels ? <LabelList dataKey="cpa" position="top" {...REF_LABEL} formatter={(v) => (typeof v === 'number' ? formatINR(v) : '')} /> : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SoFar({ what }: { what: string }) {
  return (
    <span className={styles.key}>
      <span className={styles.swatch} aria-hidden="true" />
      {`${what} so far`}
    </span>
  );
}

/**
 * Meta account: numbers straight from the Meta ad account, which the backend syncs every hour.
 * For now, cost per purchase (CPA) by week and by month across all campaigns.
 */
export function MetaAccountPage() {
  const [data, setData] = useState<{ weeks: Row[]; months: Row[]; firstDate: string | null } | null>(null);
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
        setData({ weeks: weekRows(res.weeks ?? []), months: monthRows(res.months ?? []), firstDate: res.firstDate ?? null });
      })
      .catch(() => {
        if (live) setError('Could not load the Meta figures.');
      });
    return () => {
      live = false;
    };
  }, []);

  const since = data?.firstDate ? fromKey(data.firstDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Meta ad account"
        title="Meta account"
        description="Cost per purchase (CPA): ad spend divided by purchases, as Ads Manager counts them, across every campaign. Synced from Meta every hour."
      />
      {error ? (
        <Alert tone="negative" title={error} />
      ) : data && data.weeks.length === 0 ? (
        <EmptyState icon="chart-column" title="No Meta data yet" description="The hourly sync hasn't stored any ad spend." />
      ) : (
        <>
          <Card title="Weekly CPA" eyebrow={`Monday to Sunday · last ${WEEKS_SHOWN} weeks`} actions={<SoFar what="This week" />}>
            {data ? <CpaChart rows={data.weeks} /> : <Skeleton height={220} />}
          </Card>
          <Card title="Monthly CPA" eyebrow={since ? `by calendar month · data from ${since}` : 'by calendar month'} actions={<SoFar what="This month" />}>
            {data ? <CpaChart rows={data.months} labels /> : <Skeleton height={220} />}
          </Card>
        </>
      )}
    </div>
  );
}
