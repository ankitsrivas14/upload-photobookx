import { useState, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip as ChartTooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { Alert, Badge, Button, Card, EmptyState, Icon, Select, Skeleton, StatCard, StatStrip, TextField, Tooltip } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import { AXIS_TICK, TOOLTIP_ITEM, TOOLTIP_LABEL, TOOLTIP_STYLE } from '../dashboard/chartStyles';
import styles from '../AnalysisPage.module.css';

interface DailyPoint {
  dateKey: string;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
}

type Grade = 'Excellent' | 'Good' | 'Bad' | 'Worst' | null;

const GRADE_TONE: Record<Exclude<Grade, null>, 'positive' | 'info' | 'caution' | 'negative'> = {
  Excellent: 'positive',
  Good: 'info',
  Bad: 'caution',
  Worst: 'negative',
};

interface Campaign {
  name: string;
  startDate: string;
  endDate: string;
  firstSeen: string;
  lastSeen: string;
  isRunning: boolean;
  activeDays: number;
  spanDays: number;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  grade: Grade;
  realizedRoas: number;
  gradeReason: string;
  daily: DailyPoint[];
}

interface Totals {
  campaigns: number; running: number; spend: number;
  revenue: number; roas: number; purchases: number;
}

interface Bucket {
  campaigns: number; days: number; spend: number;
  revenue: number; roas: number; purchases: number; cpa: number;
}

interface Grading {
  breakevenROAS: number;
  deliveryFailureRatePct: number;
  available: boolean;
}

interface Comparison {
  prefixesConfigured: boolean;
  window: { start: string; end: string } | null;
  agency: Bucket;
  nonAgency: Bucket;
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fullDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const monthLabel = (m: string) =>
  new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

function ComparePanel({ cmp }: { cmp: Comparison }) {
  const { agency: a, nonAgency: n } = cmp;

  if (!cmp.prefixesConfigured) {
    return (
      <Alert tone="caution" title="Agency vs non-agency">
        Add at least one campaign prefix first. Without one, every campaign counts as the agency's, so there's nothing to compare against.
      </Alert>
    );
  }

  const totalSpend = a.spend + n.spend;
  const share = (v: number) => (totalSpend > 0 ? (v / totalSpend) * 100 : 0);

  // Only ROAS and CPA have a "better" direction; spend/revenue/counts are just context.
  const rows: { k: string; a: string; n: string; winner?: 'a' | 'n' | null }[] = [
    { k: 'Campaigns', a: fmt(a.campaigns), n: fmt(n.campaigns) },
    { k: 'Ad spend', a: `₹${fmt(a.spend)}`, n: `₹${fmt(n.spend)}` },
    { k: 'Share of spend', a: `${share(a.spend).toFixed(1)}%`, n: `${share(n.spend).toFixed(1)}%` },
    { k: 'Revenue (Meta)', a: `₹${fmt(a.revenue)}`, n: `₹${fmt(n.revenue)}` },
    {
      k: 'ROAS', a: a.roas.toFixed(2), n: n.roas.toFixed(2),
      winner: a.roas === n.roas ? null : a.roas > n.roas ? 'a' : 'n',
    },
    { k: 'Purchases', a: fmt(a.purchases), n: fmt(n.purchases) },
    {
      k: 'Cost per purchase',
      a: a.cpa ? `₹${fmt(a.cpa)}` : '—',
      n: n.cpa ? `₹${fmt(n.cpa)}` : '—',
      // Lower CPA wins, but only when both sides actually have purchases.
      winner: !a.cpa || !n.cpa ? null : a.cpa === n.cpa ? null : a.cpa < n.cpa ? 'a' : 'n',
    },
  ];

  const roasGap = a.roas - n.roas;
  const verdict = a.roas === 0 && n.roas === 0
    ? 'No spend recorded on either side yet.'
    : roasGap > 0
      ? `The agency is ahead on ROAS by ${roasGap.toFixed(2)} (${a.roas.toFixed(2)} vs ${n.roas.toFixed(2)}).`
      : roasGap < 0
        ? `The agency is behind on ROAS by ${Math.abs(roasGap).toFixed(2)} (${a.roas.toFixed(2)} vs ${n.roas.toFixed(2)}).`
        : 'Both sides are returning the same ROAS.';

  return (
    <Card title="Agency vs non-agency" eyebrow={verdict} padding="sm">
      {cmp.window && (
        <p className={styles.note}>
          {`Like-for-like over ${fullDay(cmp.window.start)}${cmp.window.start !== cmp.window.end ? ` – ${fullDay(cmp.window.end)}` : ''}, the days the agency has data for. Non-agency campaigns outside this window are left out.`}
        </p>
      )}

      {totalSpend > 0 && (
        <div className={styles.share}>
          <div className={styles.shareBar}>
            <Tooltip content={`Agency ₹${fmt(a.spend)}`}>
              <span className={styles.shareAgency} style={{ width: `${share(a.spend)}%` }} />
            </Tooltip>
            <Tooltip content={`Non-agency ₹${fmt(n.spend)}`}>
              <span className={styles.shareOther} style={{ width: `${share(n.spend)}%` }} />
            </Tooltip>
          </div>
          <div className={styles.shareKey}>
            <span><b className={styles.shareAgency} /> Agency</span>
            <span><b className={styles.shareOther} /> Non-agency</span>
          </div>
        </div>
      )}

      <div className="pbx-table">
        <div className="pbx-table__scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className={styles.right}>Agency</th>
                <th scope="col" className={styles.right}>Non-agency</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.k}>
                  <td className={styles.muted}>{r.k}</td>
                  <td className={cx('pbx-num', styles.right, r.winner === 'a' && styles.winner)}>{r.a}</td>
                  <td className={cx('pbx-num', styles.right, r.winner === 'n' && styles.winner)}>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

function CampaignCard({ c, month }: { c: Campaign; month: string }) {
  const [open, setOpen] = useState(false);
  const chartData = c.daily.map((d) => ({ ...d, date: dayLabel(d.dateKey) }));

  const figures: Array<[string, string, string?]> = [
    ['Ad spend', `₹${fmt(c.spend)}`],
    ['Revenue', `₹${fmt(c.revenue)}`],
    ['ROAS (Meta)', c.roas.toFixed(2)],
    ['Realized ROAS', c.realizedRoas ? c.realizedRoas.toFixed(2) : '—', c.grade ? styles[`grade${c.grade}`] : undefined],
    ['Purchases', fmt(c.purchases)],
    ['Avg spend/day', `₹${fmt(Math.round(c.spend / Math.max(1, c.activeDays)))}`],
  ];

  return (
    <Card
      title={c.name}
      eyebrow={`${fullDay(c.startDate)} → ${!month && c.isRunning ? 'now' : fullDay(c.endDate)} · ${c.activeDays} day${c.activeDays === 1 ? '' : 's'} with data${c.spanDays !== c.activeDays ? ` of ${c.spanDays}` : ''}`}
      actions={
        <>
          <Badge size="sm" tone={c.isRunning ? 'positive' : 'neutral'}>{c.isRunning ? 'Running' : 'Ended'}</Badge>
          {c.grade && (
            <Tooltip content={c.gradeReason}>
              <Badge size="sm" tone={GRADE_TONE[c.grade]} dot={false}>{c.grade}</Badge>
            </Tooltip>
          )}
        </>
      }
      padding="sm"
    >
      {month && (c.firstSeen < c.startDate || c.lastSeen > c.endDate) && (
        <p className={styles.note}>
          {`Showing ${monthLabel(month)} only; the campaign itself ran ${fullDay(c.firstSeen)} → ${c.isRunning ? 'now' : fullDay(c.lastSeen)}.`}
        </p>
      )}

      <div className={styles.figs}>
        {figures.map(([k, v, cls]) => (
          <div key={k}>
            <div className={styles.metaLabel}>{k}</div>
            <div className={cx(styles.figValue, cls)}>{v}</div>
          </div>
        ))}
      </div>

      {c.gradeReason && <p className={styles.note}>{c.gradeReason}</p>}

      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} interval="preserveStartEnd" minTickGap={24} />
          <YAxis yAxisId="left" tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
          <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
          <ChartTooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={TOOLTIP_LABEL}
            itemStyle={TOOLTIP_ITEM}
            formatter={(value, n) => (n === 'Ad spend' ? [`₹${fmt(Number(value))}`, n] : [Number(value).toFixed(2), n ?? ''])}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--ink-muted)' }} />
          <Bar yAxisId="left" dataKey="spend" name="Ad spend" fill="var(--chart-bar)" isAnimationActive={false} />
          <Line yAxisId="right" type="linear" dataKey="roas" name="ROAS" stroke="var(--chart-line)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: 'var(--chart-highlight)', stroke: 'none' }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>

      <button type="button" className={styles.disclosure} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        {`${open ? 'Hide' : 'Show'} day-by-day numbers (${c.daily.length} days)`}
      </button>

      {open && (
        <div className="pbx-table">
          <div className="pbx-table__scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col" className={styles.right}>Ad spend</th>
                  <th scope="col" className={styles.right}>Revenue</th>
                  <th scope="col" className={styles.right}>ROAS</th>
                  <th scope="col" className={styles.right}>Purchases</th>
                </tr>
              </thead>
              <tbody>
                {[...c.daily].reverse().map((d) => {
                  const idle = d.spend === 0;
                  return (
                    <tr key={d.dateKey} className={idle ? styles.idle : undefined}>
                      <td>
                        {dayLabel(d.dateKey)}
                        {idle && <span className={styles.timelineMeta}> no delivery</span>}
                      </td>
                      <td className={cx('pbx-num', styles.right)}>{`₹${fmt(d.spend)}`}</td>
                      <td className={cx('pbx-num', styles.right)}>{`₹${fmt(d.revenue)}`}</td>
                      <td className={cx('pbx-num', styles.right, styles.strong, !idle && (d.roas >= 1 ? styles.good : styles.bad))}>
                        {idle ? '—' : d.roas.toFixed(2)}
                      </td>
                      <td className={cx('pbx-num', styles.right)}>{fmt(d.purchases)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

export function Agency() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [grading, setGrading] = useState<Grading | null>(null);
  const [showCompare, setShowCompare] = useState(false);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [prefixInput, setPrefixInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  // '' = all time; otherwise YYYY-MM
  const [month, setMonth] = useState('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);

  useEffect(() => { loadData(month); }, [month]);

  const loadData = async (m = month) => {
    setIsLoading(true);
    try {
      const res = await api.getAgencyData(m || undefined);
      if (res.success) {
        setCampaigns(res.campaigns || []);
        setTotals(res.totals || null);
        setComparison(res.comparison || null);
        setGrading(res.grading || null);
        setPrefixes(res.namePrefixes || []);
        // The month list spans all data, so it stays stable whichever month is picked.
        setAvailableMonths(res.availableMonths || []);
      }
    } catch (err) {
      console.error('Failed to load agency data:', err);
      toast.error('Failed to load agency data');
    } finally {
      setIsLoading(false);
    }
  };

  const savePrefixes = async (next: string[]) => {
    const prev = prefixes;
    setPrefixes(next); // optimistic
    const res = await api.saveAgencyPrefixes(next);
    if (res.success) {
      setPrefixes(res.namePrefixes || next);
      await loadData(month); // re-filters which campaigns count as the agency's
    } else {
      setPrefixes(prev);
      toast.error(res.error || 'Failed to save prefixes');
    }
  };

  const handleAddPrefix = () => {
    const p = prefixInput.trim();
    if (!p) return;
    if (prefixes.some((x) => x.toLowerCase() === p.toLowerCase())) {
      toast.error('That prefix is already added');
      return;
    }
    setPrefixInput('');
    savePrefixes([...prefixes, p]);
  };

  if (isLoading && !totals) {
    return <Skeleton lines={8} />;
  }

  return (
    <>
      <div className={styles.toolbar}>
        <Select
          label="Period"
          inlineLabel
          size="sm"
          value={month}
          onChange={setMonth}
          disabled={isLoading}
          options={[{ value: '', label: 'All time' }, ...availableMonths.map((m) => ({ value: m, label: monthLabel(m) }))]}
        />
        <Button size="sm" variant={showCompare ? 'primary' : 'secondary'} icon="layers" aria-pressed={showCompare} onClick={() => setShowCompare((v) => !v)}>
          Compare
        </Button>
        <span className={styles.meta}>
          {month ? `Every number below counts ${monthLabel(month)} only.` : 'All time.'}{' '}
          Meta's daily campaign figures, synced every hour.
        </span>
      </div>

      {grading && (
        <p className={styles.note}>
          {grading.available
            ? `Graded against your breakeven ROAS of ${grading.breakevenROAS.toFixed(2)}, after discounting Meta's ROAS by the ~${grading.deliveryFailureRatePct}% delivery-failure rate.`
            : 'Campaigns are ungraded; breakeven ROAS needs delivered-order history first.'}
        </p>
      )}

      <Card
        title="Agency campaign prefixes"
        eyebrow={prefixes.length === 0 ? 'none yet, so every campaign counts' : 'campaigns whose name starts with one of these count as the agency’s'}
      >
        <div className={styles.prefixes}>
          {prefixes.map((p) => (
            <span key={p} className={styles.prefix}>
              <span className="pbx-mono">{p}</span>
              <Tooltip content="Remove prefix" repeatsLabel>
                <button type="button" aria-label={`Remove the prefix ${p}`} onClick={() => savePrefixes(prefixes.filter((x) => x !== p))}>
                  <Icon name="x" size={12} />
                </button>
              </Tooltip>
            </span>
          ))}
          {prefixes.length === 0 && <span className={styles.muted}>No prefixes yet</span>}
        </div>
        <div className={styles.prefixForm}>
          <TextField
            size="sm"
            aria-label="New prefix"
            placeholder='e.g. "S | "'
            value={prefixInput}
            onChange={(e) => setPrefixInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddPrefix(); }}
          />
          <Button size="sm" icon="plus" onClick={handleAddPrefix}>Add prefix</Button>
        </div>
      </Card>

      {/* Everything below reflects the selected month */}
      <div className={cx(styles.stack, isLoading && styles.dimmed)}>
        {showCompare && comparison && <ComparePanel cmp={comparison} />}

        {totals && (
          <StatStrip>
            <StatCard label="Campaigns" value={fmt(totals.campaigns)} sub={totals.running ? `${totals.running} live` : undefined} />
            <StatCard label="Total ad spend" value={`₹${fmt(totals.spend)}`} />
            <StatCard label="Revenue (Meta)" value={`₹${fmt(totals.revenue)}`} />
            <StatCard label="Blended ROAS" value={totals.roas.toFixed(2)} />
            <StatCard label="Purchases" value={fmt(totals.purchases)} />
          </StatStrip>
        )}

        {campaigns.length === 0 ? (
          <EmptyState
            icon="chart-column"
            title="No agency campaigns"
            description={month ? `No agency campaigns ran in ${monthLabel(month)}.` : 'No agency campaigns found. Check your prefixes above.'}
          />
        ) : (
          campaigns.map((c) => <CampaignCard key={c.name} c={c} month={month} />)
        )}
      </div>
    </>
  );
}

export default Agency;
