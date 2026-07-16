import { useState, useEffect, useMemo, Fragment } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import Papa from 'papaparse';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { Plus, Trash2, AlertTriangle, FileUp, X, Filter } from 'lucide-react';

interface Campaign {
  _id: string;
  name: string;
  createdDate: string;
  notes: string;
  matched: boolean;
  matchesPrefix: boolean;
  spend: number;
  revenue: number;
  roas: number;
  purchases: number;
  activeDays: number;
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const dayLabel = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function Agency() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availableCampaigns, setAvailableCampaigns] = useState<string[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [prefixInput, setPrefixInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState('');
  const [createdDate, setCreatedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getAgencyData();
      if (res.success) {
        setCampaigns(res.campaigns || []);
        setAvailableCampaigns(res.availableCampaigns || []);
        setPrefixes(res.namePrefixes || []);
      }
    } catch (err) {
      console.error('Failed to load agency data:', err);
      toast.error('Failed to load agency data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!name.trim() || !createdDate) {
      toast.error('Campaign name and created date are required');
      return;
    }
    setSaving(true);
    try {
      const res = await api.logAgencyCampaign(name.trim(), createdDate);
      if (res.success) {
        setName('');
        await loadData(); // reload so Meta spend/ROAS gets joined in
        toast.success('Campaign logged');
      } else {
        toast.error(res.error || 'Failed to log campaign');
      }
    } catch {
      toast.error('Failed to log campaign');
    } finally {
      setSaving(false);
    }
  };

  const savePrefixes = async (next: string[]) => {
    const prev = prefixes;
    setPrefixes(next); // optimistic
    const res = await api.saveAgencyPrefixes(next);
    if (res.success) {
      setPrefixes(res.namePrefixes || next);
      await loadData(); // re-evaluates which logged campaigns still match
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

  const handlePrune = async () => {
    if (!window.confirm(`Remove ${strays.length} logged campaign(s) that don't start with your agency prefixes?`)) return;
    const res = await api.pruneAgencyCampaigns();
    if (res.success) {
      toast.success(`Removed ${res.removed} non-matching campaign${res.removed === 1 ? '' : 's'}`);
      await loadData();
    } else {
      toast.error(res.error || 'Failed to remove');
    }
  };

  // Upload a Meta "Campaigns" CSV export: logs any new campaigns and stores their
  // spend/ROAS. Re-uploading the same file is safe (rows upsert, logged campaigns skip).
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
            const bits = [`${res.imported} new campaign${res.imported === 1 ? '' : 's'} logged`];
            if (res.skipped) bits.push(`${res.skipped} already logged`);
            if (res.discarded) bits.push(`${res.discarded} not the agency's`);
            if (res.datedFromFirstSeen) bits.push(`${res.datedFromFirstSeen} dated from first-seen`);
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

  const handleDelete = async (id: string) => {
    if (!window.confirm('Remove this campaign from the agency log?')) return;
    const prev = campaigns;
    setCampaigns((c) => c.filter((x) => x._id !== id));
    const res = await api.deleteAgencyCampaign(id);
    if (!res.success) {
      setCampaigns(prev);
      toast.error('Failed to delete');
    }
  };

  // Group campaigns into creation-day cohorts: "the campaigns the agency launched
  // on day X have together spent ₹S and returned ROAS R".
  const cohorts = useMemo(() => {
    const map = new Map<string, { dateKey: string; campaigns: Campaign[]; spend: number; revenue: number; purchases: number }>();
    for (const c of campaigns) {
      const dateKey = new Date(c.createdDate).toISOString().slice(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, { dateKey, campaigns: [], spend: 0, revenue: 0, purchases: 0 });
      const g = map.get(dateKey)!;
      g.campaigns.push(c);
      g.spend += c.spend;
      g.revenue += c.revenue;
      g.purchases += c.purchases;
    }
    return Array.from(map.values()).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
  }, [campaigns]);

  // Charts read oldest → newest
  const chartData = useMemo(() =>
    [...cohorts].reverse().map((g) => ({
      date: dayLabel(g.dateKey),
      spend: g.spend,
      roas: g.spend > 0 ? Number((g.revenue / g.spend).toFixed(2)) : 0,
      launched: g.campaigns.length,
    })), [cohorts]);

  // Logged campaigns that no longer start with any configured prefix
  const strays = useMemo(
    () => (prefixes.length ? campaigns.filter((c) => !c.matchesPrefix) : []),
    [campaigns, prefixes]
  );

  const totals = useMemo(() => {
    const spend = campaigns.reduce((s, c) => s + c.spend, 0);
    const revenue = campaigns.reduce((s, c) => s + c.revenue, 0);
    const purchases = campaigns.reduce((s, c) => s + c.purchases, 0);
    return {
      count: campaigns.length,
      spend, revenue, purchases,
      roas: spend > 0 ? revenue / spend : 0,
      unmatched: campaigns.filter((c) => !c.matched).length,
    };
  }, [campaigns]);

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
            Campaigns the agency created, grouped by launch day. Upload a Meta <strong>Campaigns</strong> CSV — spend, ROAS and launch dates are picked up from it automatically.
          </p>
        </div>
        <label style={{
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem',
          backgroundColor: '#0f172a', color: '#fff', border: 'none', padding: '0.5rem 1rem',
          borderRadius: '8px', fontSize: '0.825rem', fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          <FileUp size={14} /> Upload Campaigns CSV
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
          strings are treated as the agency's — everything else in the CSV is discarded on import.
          {prefixes.length === 0 && ' No prefixes set yet, so every campaign in the CSV is currently kept.'}
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
          {prefixes.length === 0 && (
            <span style={{ fontSize: '0.78rem', color: '#cbd5e1' }}>No prefixes yet</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, flex: '1 1 260px' }}
            placeholder='e.g. "S | " or "23 April"'
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

      {strays.length > 0 && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.8rem', color: '#991b1b' }}>
            <AlertTriangle size={16} color="#dc2626" />
            {strays.length} logged campaign{strays.length === 1 ? '' : 's'} no longer match your prefixes (imported before they were set).
          </span>
          <button
            onClick={handlePrune}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#dc2626',
              color: '#fff', border: 'none', padding: '0.4rem 0.85rem', borderRadius: '8px',
              fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <Trash2 size={13} /> Remove them
          </button>
        </div>
      )}

      {/* KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
        {[
          { k: 'Campaigns logged', v: fmt(totals.count) },
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

      {totals.unmatched > 0 && (
        <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.6rem', borderColor: '#fde68a', backgroundColor: '#fffbeb' }}>
          <AlertTriangle size={16} color="#d97706" />
          <span style={{ fontSize: '0.8rem', color: '#92400e' }}>
            {totals.unmatched} logged campaign{totals.unmatched === 1 ? '' : 's'} had no matching campaign in your uploaded Meta data — check the name matches exactly, or upload that day's campaign CSV.
          </span>
        </div>
      )}

      {/* Add campaign (manual fallback / corrections) */}
      <div style={card}>
        <p style={label}>Add a campaign manually</p>
        <p style={{ margin: '-0.4rem 0 0.75rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
          Only needed for campaigns missing from the CSV, or to fix a launch date (delete and re-add).
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, flex: '2 1 280px' }}
            placeholder="Campaign name (must match Meta)"
            list="agency-campaign-names"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <datalist id="agency-campaign-names">
            {availableCampaigns.map((n) => <option key={n} value={n} />)}
          </datalist>
          <input style={{ ...inputStyle, flex: '0 1 160px' }} type="date" value={createdDate} onChange={(e) => setCreatedDate(e.target.value)} />
          <button
            onClick={handleAdd}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#0f172a',
              color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px',
              fontSize: '0.825rem', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            <Plus size={14} /> Log
          </button>
        </div>
      </div>

      {chartData.length > 0 && (
        <>
          {/* Spend + ROAS by launch day */}
          <div style={card}>
            <p style={label}>Spend & ROAS by launch day</p>
            <p style={{ margin: '-0.4rem 0 0.75rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
              For the campaigns launched on each day: total ad spend they have consumed, and the spend-weighted ROAS they returned.
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

          {/* Launch velocity */}
          <div style={card}>
            <p style={label}>Campaigns launched per day</p>
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ fontSize: '0.8rem', borderRadius: '8px', border: '1px solid #f1f5f9' }} />
                <Bar dataKey="launched" name="Campaigns launched" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Cohort table */}
      <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
        {cohorts.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            No campaigns logged yet — add the first one above.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9', textAlign: 'left' }}>
                {['Campaign', 'Ad spend', 'Revenue', 'ROAS', 'Purchases', 'Active days', ''].map((h, i) => (
                  <th key={h} style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, textAlign: i === 0 ? 'left' : i === 6 ? 'center' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((g) => {
                const roas = g.spend > 0 ? g.revenue / g.spend : 0;
                return (
                  <Fragment key={g.dateKey}>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, color: '#1e293b' }}>
                        {dayLabel(g.dateKey)} — {g.campaigns.length} campaign{g.campaigns.length === 1 ? '' : 's'} launched
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', color: '#1e293b' }}>₹{fmt(g.spend)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', color: '#1e293b' }}>₹{fmt(g.revenue)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 800, textAlign: 'right', color: roas >= 1 ? '#16a34a' : '#dc2626' }}>{roas.toFixed(2)}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right', color: '#1e293b' }}>{fmt(g.purchases)}</td>
                      <td colSpan={2} />
                    </tr>
                    {g.campaigns.map((c) => (
                      <tr key={c._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.6rem 0.75rem 0.6rem 1.75rem', fontSize: '0.825rem', color: '#475569' }}>
                          {c.name}
                          {!c.matched && (
                            <span title="No matching campaign found in uploaded Meta data" style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: '#d97706', fontWeight: 700 }}>· no data</span>
                          )}
                          {prefixes.length > 0 && !c.matchesPrefix && (
                            <span title="Doesn't start with any configured agency prefix" style={{ marginLeft: '0.4rem', fontSize: '0.68rem', color: '#dc2626', fontWeight: 700 }}>· not agency</span>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#475569' }}>₹{fmt(c.spend)}</td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#475569' }}>₹{fmt(c.revenue)}</td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', fontWeight: 700, color: c.spend === 0 ? '#cbd5e1' : c.roas >= 1 ? '#16a34a' : '#dc2626' }}>{c.spend === 0 ? '—' : c.roas.toFixed(2)}</td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#475569' }}>{fmt(c.purchases)}</td>
                        <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.825rem', textAlign: 'right', color: '#94a3b8' }}>{c.activeDays || '—'}</td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                          <button onClick={() => handleDelete(c._id)} title="Remove from log" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.5, padding: 0, display: 'inline-flex' }}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Agency;
