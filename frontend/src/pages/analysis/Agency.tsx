import { useState, useEffect } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { Plus, X, Filter, ChevronDown, ChevronRight, GitCompareArrows } from 'lucide-react';

interface DailyPoint {
  dateKey: string;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
}

type Grade = 'Excellent' | 'Good' | 'Bad' | 'Worst' | null;

const GRADE_STYLE: Record<Exclude<Grade, null>, { bg: string; fg: string }> = {
  Excellent: { bg: '#dcfce7', fg: '#166534' },
  Good: { bg: '#dbeafe', fg: '#1e40af' },
  Bad: { bg: '#fef3c7', fg: '#92400e' },
  Worst: { bg: '#fee2e2', fg: '#991b1b' },
};

interface Campaign {
  name: string;
  startDate: string;
  endDate: string;
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
  agency: Bucket;
  nonAgency: Bucket;
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const fullDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const card: React.CSSProperties = {
  backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '1rem',
};
const label: React.CSSProperties = {
  margin: '0 0 0.75rem 0', fontSize: '0.7rem', fontWeight: 800, color: '#7c3aed',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

function ComparePanel({ cmp }: { cmp: Comparison }) {
  const { agency: a, nonAgency: n } = cmp;

  if (!cmp.prefixesConfigured) {
    return (
      <div style={{ ...card, borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
        <p style={{ ...label, color: '#b45309' }}>Agency vs Non-agency</p>
        <p style={{ margin: 0, fontSize: '0.8rem', color: '#92400e' }}>
          Add at least one campaign prefix above first — without one, every campaign counts as the agency's, so there's nothing to compare against.
        </p>
      </div>
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

  const cell = (win: boolean): React.CSSProperties => ({
    padding: '0.6rem 0.75rem', fontSize: '0.85rem', textAlign: 'right',
    fontWeight: win ? 800 : 600,
    color: win ? '#16a34a' : '#334155',
  });

  return (
    <div style={{ ...card, padding: 0 }}>
      <div style={{ padding: '1rem 1rem 0.5rem 1rem' }}>
        <p style={{ ...label, marginBottom: '0.35rem' }}>Agency vs Non-agency</p>
        <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b' }}>{verdict}</p>
      </div>

      {/* Share-of-spend bar */}
      {totalSpend > 0 && (
        <div style={{ padding: '0.35rem 1rem 0.85rem 1rem' }}>
          <div style={{ display: 'flex', height: '8px', borderRadius: '999px', overflow: 'hidden', backgroundColor: '#f1f5f9' }}>
            <div style={{ width: `${share(a.spend)}%`, backgroundColor: '#7c3aed' }} title={`Agency ₹${fmt(a.spend)}`} />
            <div style={{ width: `${share(n.spend)}%`, backgroundColor: '#cbd5e1' }} title={`Non-agency ₹${fmt(n.spend)}`} />
          </div>
          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.4rem', fontSize: '0.72rem', color: '#94a3b8' }}>
            <span><span style={{ color: '#7c3aed', fontWeight: 800 }}>■</span> Agency</span>
            <span><span style={{ color: '#cbd5e1', fontWeight: 800 }}>■</span> Non-agency</span>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8fafc', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, textAlign: 'left' }}>Metric</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.72rem', color: '#7c3aed', fontWeight: 800, textAlign: 'right' }}>Agency</th>
              <th style={{ padding: '0.6rem 0.75rem', fontSize: '0.72rem', color: '#94a3b8', fontWeight: 800, textAlign: 'right' }}>Non-agency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} style={{ borderBottom: '1px solid #f8fafc' }}>
                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.82rem', color: '#64748b' }}>{r.k}</td>
                <td style={cell(r.winner === 'a')}>{r.a}</td>
                <td style={cell(r.winner === 'n')}>{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CampaignCard({ c }: { c: Campaign }) {
  const [open, setOpen] = useState(false);
  const chartData = c.daily.map((d) => ({ ...d, date: dayLabel(d.dateKey) }));

  const stat = (k: string, v: string, color?: string) => (
    <div>
      <div style={{ fontSize: '0.65rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: color || '#0f172a', marginTop: '0.1rem' }}>{v}</div>
    </div>
  );

  return (
    <div style={{ ...card, padding: 0 }}>
      {/* Header */}
      <div style={{ padding: '1rem', borderBottom: '1px solid #f8fafc' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.15rem' }}>
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>{c.name}</span>
          <span style={{
            fontSize: '0.65rem', fontWeight: 800, borderRadius: '999px', padding: '0.1rem 0.45rem',
            textTransform: 'uppercase', letterSpacing: '0.03em',
            color: c.isRunning ? '#166534' : '#475569',
            backgroundColor: c.isRunning ? '#dcfce7' : '#f1f5f9',
          }}>
            {c.isRunning ? 'Running' : 'Ended'}
          </span>
          {c.grade && (
            <span
              title={c.gradeReason}
              style={{
                fontSize: '0.65rem', fontWeight: 800, borderRadius: '999px', padding: '0.1rem 0.5rem',
                textTransform: 'uppercase', letterSpacing: '0.03em', cursor: 'help',
                color: GRADE_STYLE[c.grade].fg, backgroundColor: GRADE_STYLE[c.grade].bg,
              }}
            >
              {c.grade}
            </span>
          )}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
          {fullDay(c.startDate)} → {c.isRunning ? 'now' : fullDay(c.endDate)}
          {' · '}{c.activeDays} day{c.activeDays === 1 ? '' : 's'} with data
          {c.spanDays !== c.activeDays && ` of ${c.spanDays}`}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.75rem', marginTop: '0.85rem' }}>
          {stat('Ad spend', `₹${fmt(c.spend)}`)}
          {stat('Revenue', `₹${fmt(c.revenue)}`)}
          {stat('ROAS (Meta)', c.roas.toFixed(2))}
          {stat('Realized ROAS', c.realizedRoas ? c.realizedRoas.toFixed(2) : '—',
            c.grade ? GRADE_STYLE[c.grade].fg : undefined)}
          {stat('Purchases', fmt(c.purchases))}
          {stat('Avg spend/day', `₹${fmt(Math.round(c.spend / Math.max(1, c.activeDays)))}`)}
        </div>

        {c.gradeReason && (
          <p style={{ margin: '0.7rem 0 0 0', fontSize: '0.73rem', color: '#94a3b8' }}>{c.gradeReason}</p>
        )}
      </div>

      {/* Daily chart across the campaign's own lifespan */}
      <div style={{ padding: '0.85rem 0.5rem 0.25rem 0' }}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" />
            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} />
            <Tooltip
              formatter={(value: any, n?: string) =>
                (n === 'Ad spend' ? [`₹${fmt(Number(value))}`, n] : [Number(value).toFixed(2), n ?? ''])}
              contentStyle={{ fontSize: '0.8rem', borderRadius: '8px', border: '1px solid #f1f5f9' }}
            />
            <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
            <Bar yAxisId="left" dataKey="spend" name="Ad spend" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#7c3aed" strokeWidth={2} dot={{ r: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Day-by-day numbers */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none',
          border: 'none', borderTop: '1px solid #f8fafc', padding: '0.6rem 1rem', cursor: 'pointer',
          fontSize: '0.78rem', fontWeight: 600, color: '#64748b',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {open ? 'Hide' : 'Show'} day-by-day numbers ({c.daily.length} days)
      </button>

      {open && (
        <div style={{ overflowX: 'auto', borderTop: '1px solid #f8fafc' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc' }}>
                {['Day', 'Ad spend', 'Revenue', 'ROAS', 'Purchases'].map((h, i) => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...c.daily].reverse().map((d) => {
                const idle = d.spend === 0;
                return (
                  <tr key={d.dateKey} style={{ borderTop: '1px solid #f8fafc' }}>
                    <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', color: idle ? '#cbd5e1' : '#475569' }}>
                      {dayLabel(d.dateKey)}
                      {idle && <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem' }}>no delivery</span>}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', textAlign: 'right', color: idle ? '#cbd5e1' : '#475569' }}>₹{fmt(d.spend)}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', textAlign: 'right', color: idle ? '#cbd5e1' : '#475569' }}>₹{fmt(d.revenue)}</td>
                    <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', textAlign: 'right', fontWeight: 700, color: idle ? '#cbd5e1' : d.roas >= 1 ? '#16a34a' : '#dc2626' }}>
                      {idle ? '—' : d.roas.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.45rem 0.75rem', fontSize: '0.8rem', textAlign: 'right', color: idle ? '#cbd5e1' : '#475569' }}>{fmt(d.purchases)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
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

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAgencyData();
      if (res.success) {
        setCampaigns(res.campaigns || []);
        setTotals(res.totals || null);
        setComparison(res.comparison || null);
        setGrading(res.grading || null);
        setPrefixes(res.namePrefixes || []);
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
      await loadData(); // re-filters which campaigns count as the agency's
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

  const inputStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem 0.75rem',
    fontSize: '0.85rem', color: '#1e293b', outline: 'none',
  };

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Loading Agency…</div>;
  }

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>Agency</h1>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Every campaign the agency runs, with its full daily history. Data comes from the campaign CSVs you sync on the <strong>Ads Analysis</strong> page.
          </p>
          {grading && (
            <p style={{ margin: '0.3rem 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              {grading.available
                ? <>Graded against your breakeven ROAS of <strong>{grading.breakevenROAS.toFixed(2)}</strong>, after discounting Meta's ROAS by the <strong>~{grading.deliveryFailureRatePct}%</strong> delivery-failure rate.</>
                : <>Campaigns are ungraded — breakeven ROAS needs delivered-order history first.</>}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowCompare((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            backgroundColor: showCompare ? '#7c3aed' : '#fff',
            color: showCompare ? '#fff' : '#1e293b',
            border: `1px solid ${showCompare ? '#7c3aed' : '#e2e8f0'}`,
            padding: '0.5rem 1rem', borderRadius: '8px',
            fontSize: '0.825rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <GitCompareArrows size={14} /> Compare
        </button>
      </div>

      {/* Agency campaign prefixes */}
      <div style={card}>
        <p style={{ ...label, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Filter size={12} /> Agency campaign prefixes
        </p>
        <p style={{ margin: '-0.4rem 0 0.75rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
          Your Meta data covers the whole account. Only campaigns whose name <strong>starts with</strong> one of these
          strings count as the agency's — everything else is ignored.
          {prefixes.length === 0 && ' No prefixes set yet, so every campaign is currently counted.'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center', marginBottom: '0.6rem' }}>
          {prefixes.map((p) => (
            <span key={p} style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem', backgroundColor: '#ede9fe',
              color: '#5b21b6', borderRadius: '999px', padding: '0.25rem 0.6rem', fontSize: '0.78rem', fontWeight: 600,
            }}>
              {p}
              <button
                onClick={() => savePrefixes(prefixes.filter((x) => x !== p))}
                title="Remove prefix"
                style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', padding: 0, display: 'flex' }}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {prefixes.length === 0 && <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>No prefixes yet</span>}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, flex: '1 1 260px' }}
            placeholder='e.g. "S | "'
            value={prefixInput}
            onChange={(e) => setPrefixInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAddPrefix(); }}
          />
          <button
            onClick={handleAddPrefix}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#0f172a',
              color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px',
              fontSize: '0.825rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> Add prefix
          </button>
        </div>
      </div>

      {/* Agency vs non-agency comparison */}
      {showCompare && comparison && <ComparePanel cmp={comparison} />}

      {/* Overall KPI tiles */}
      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {[
            { k: 'Campaigns', v: `${fmt(totals.campaigns)}${totals.running ? ` · ${totals.running} live` : ''}` },
            { k: 'Total ad spend', v: `₹${fmt(totals.spend)}` },
            { k: 'Revenue (Meta)', v: `₹${fmt(totals.revenue)}` },
            { k: 'Blended ROAS', v: totals.roas.toFixed(2) },
            { k: 'Purchases', v: fmt(totals.purchases) },
          ].map((t) => (
            <div key={t.k} style={card}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t.k}</div>
              <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#0f172a', marginTop: '0.25rem' }}>{t.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* One card per campaign, newest launch first */}
      {campaigns.length === 0 ? (
        <div style={{ ...card, padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
          No agency campaigns found. Sync a campaigns CSV on the Ads Analysis page, and check your prefixes above.
        </div>
      ) : (
        campaigns.map((c) => <CampaignCard key={c.name} c={c} />)
      )}
    </div>
  );
}

export default Agency;
