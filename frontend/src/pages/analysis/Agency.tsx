import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import Papa from 'papaparse';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { Plus, FileUp, X, Filter } from 'lucide-react';

interface DayCampaign {
  name: string;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  isNew: boolean;
}

interface Day {
  dateKey: string;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  launched: number;
  campaigns: DayCampaign[];
}

interface Totals {
  spend: number; revenue: number; roas: number;
  purchases: number; campaigns: number; days: number;
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function Agency() {
  const [days, setDays] = useState<Day[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [prefixInput, setPrefixInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAgencyData();
      if (res.success) {
        setDays(res.days || []);
        setTotals(res.totals || null);
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

  // Upload one day's Meta "Campaigns" CSV. Re-uploading the same file is safe.
  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const toastId = toast.loading('Reading campaigns CSV…');

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          // Tolerant header matching — Meta's column labels drift between exports.
          const pick = (row: any, aliases: string[]): any => {
            const keys = Object.keys(row);
            for (const a of aliases) {
              const exact = keys.find((k) => k.trim().toLowerCase() === a);
              if (exact && String(row[exact]).trim() !== '') return row[exact];
            }
            for (const a of aliases) {
              const partial = keys.find((k) => k.trim().toLowerCase().includes(a));
              if (partial && String(row[partial]).trim() !== '') return row[partial];
            }
            return undefined;
          };
          const num = (v: any) => {
            if (v === undefined || v === null) return 0;
            return parseFloat(String(v).replace(/[₹,]/g, '').trim()) || 0;
          };

          const rows = (results.data as any[])
            .map((row) => {
              const name = pick(row, ['campaign name']);
              const rawDate = pick(row, ['reporting starts', 'reporting ends', 'day', 'date']);
              if (!name || !rawDate) return null;
              const d = new Date(String(rawDate).split(/ [-–to] /)[0].trim());
              if (isNaN(d.getTime())) return null;
              return {
                name: String(name).trim(),
                date: d.toISOString().slice(0, 10),
                status: pick(row, ['campaign delivery', 'delivery', 'status']) || 'active',
                spend: num(pick(row, ['amount spent', 'spend', 'cost'])),
                roas: num(pick(row, ['purchase roas', 'roas', 'return on ad spend'])),
                purchases: num(pick(row, ['purchases', 'results'])),
                impressions: num(pick(row, ['impressions'])),
                clicks: num(pick(row, ['clicks (all)', 'clicks'])),
                ctr: num(pick(row, ['ctr (all)', 'ctr'])),
                cpc: num(pick(row, ['cpc (all)', 'cpc'])),
                frequency: num(pick(row, ['frequency'])),
                addsToCart: num(pick(row, ['adds to cart'])),
              };
            })
            .filter(Boolean);

          if (rows.length === 0) {
            toast.error('No campaign rows found — is this a Meta "Campaigns" export?', { id: toastId });
            return;
          }

          const res = await api.importAgencyCampaigns(rows as any[]);
          if (res.success) {
            const when = res.dates?.length === 1 ? dayLabel(res.dates[0]) : `${res.dates?.length} days`;
            const bits = [`${when}: ${res.campaigns} agency campaign${res.campaigns === 1 ? '' : 's'}`];
            if (res.newCampaigns) bits.push(`${res.newCampaigns} newly launched`);
            if (res.discarded) bits.push(`${res.discarded} not the agency's`);
            toast.success(bits.join(' · '), { id: toastId });
            await loadData();
          } else {
            toast.error(res.error || 'Import failed', { id: toastId });
          }
        } catch (err) {
          console.error('Agency CSV import error:', err);
          toast.error('Import failed', { id: toastId });
        }
      },
      error: () => toast.error('Could not read that CSV', { id: toastId }),
    });

    event.target.value = ''; // allow re-uploading the same file
  };

  // Charts read oldest → newest
  const chartData = useMemo(
    () => [...days].reverse().map((d) => ({
      date: dayLabel(d.dateKey),
      spend: d.spend,
      roas: d.roas,
      launched: d.launched,
    })),
    [days]
  );

  const inputStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem 0.75rem',
    fontSize: '0.85rem', color: '#1e293b', outline: 'none',
  };
  const card: React.CSSProperties = {
    backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '1rem',
  };
  const label: React.CSSProperties = {
    margin: '0 0 0.75rem 0', fontSize: '0.7rem', fontWeight: 800, color: '#7c3aed',
    textTransform: 'uppercase', letterSpacing: '0.05em',
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
            Day-by-day performance of the agency's campaigns, straight from your daily Meta <strong>Campaigns</strong> exports.
          </p>
        </div>
        <label style={{
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
          backgroundColor: '#0f172a', color: '#fff', border: 'none', padding: '0.5rem 1rem',
          borderRadius: '8px', fontSize: '0.825rem', fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          <FileUp size={14} /> Upload day's CSV
          <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: 'none' }} />
        </label>
      </div>

      {/* Agency campaign prefixes */}
      <div style={card}>
        <p style={{ ...label, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Filter size={12} /> Agency campaign prefixes
        </p>
        <p style={{ margin: '-0.4rem 0 0.75rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
          Your Meta export covers the whole account. Only campaigns whose name <strong>starts with</strong> one of these
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

      {/* KPI tiles */}
      {totals && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
          {[
            { k: 'Days tracked', v: fmt(totals.days) },
            { k: 'Campaigns', v: fmt(totals.campaigns) },
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

      {chartData.length > 0 && (
        <>
          <div style={card}>
            <p style={label}>Daily spend & ROAS</p>
            <p style={{ margin: '-0.4rem 0 0.75rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              What the agency's campaigns spent each day, and the ROAS they returned that day.
            </p>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip
                  formatter={(value: any, n?: string) =>
                    (n === 'Ad spend' ? [`₹${fmt(Number(value))}`, n] : [Number(value).toFixed(2), n ?? ''])}
                  contentStyle={{ fontSize: '0.8rem', borderRadius: '8px', border: '1px solid #f1f5f9' }}
                />
                <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
                <Bar yAxisId="left" dataKey="spend" name="Ad spend" fill="#c4b5fd" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div style={card}>
            <p style={label}>Campaigns launched per day</p>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ fontSize: '0.8rem', borderRadius: '8px', border: '1px solid #f1f5f9' }} />
                <Bar dataKey="launched" name="Launched" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Day-by-day table */}
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        {days.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            No data yet — upload a day's Campaigns CSV above.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9', textAlign: 'left' }}>
                {['Day / Campaign', 'Ad spend', 'Revenue', 'ROAS', 'Purchases'].map((h, i) => (
                  <th key={h} style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <Fragment key={d.dateKey}>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>
                      {dayLabel(d.dateKey)}
                      <span style={{ fontWeight: 500, color: '#94a3b8' }}>
                        {' '}— {d.campaigns.length} campaign{d.campaigns.length === 1 ? '' : 's'}
                        {d.launched > 0 && `, ${d.launched} launched`}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', color: '#1e293b' }}>₹{fmt(d.spend)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', color: '#1e293b' }}>₹{fmt(d.revenue)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right', color: d.roas >= 1 ? '#16a34a' : '#dc2626' }}>{d.roas.toFixed(2)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', color: '#1e293b' }}>{fmt(d.purchases)}</td>
                  </tr>
                  {d.campaigns.map((c) => (
                    <tr key={`${d.dateKey}|${c.name}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.6rem 0.75rem 0.6rem 1.75rem', fontSize: '0.825rem', color: '#475569' }}>
                        {c.name}
                        {c.isNew && (
                          <span title="First day this campaign appears in your data" style={{
                            marginLeft: '0.45rem', fontSize: '0.65rem', fontWeight: 800, color: '#4338ca',
                            backgroundColor: '#e0e7ff', borderRadius: '999px', padding: '0.1rem 0.4rem',
                            textTransform: 'uppercase', letterSpacing: '0.03em',
                          }}>launched</span>
                        )}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#475569' }}>₹{fmt(c.spend)}</td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#475569' }}>₹{fmt(c.revenue)}</td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', fontWeight: 700, color: c.spend === 0 ? '#cbd5e1' : c.roas >= 1 ? '#16a34a' : '#dc2626' }}>{c.spend === 0 ? '—' : c.roas.toFixed(2)}</td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#475569' }}>{fmt(c.purchases)}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Agency;
