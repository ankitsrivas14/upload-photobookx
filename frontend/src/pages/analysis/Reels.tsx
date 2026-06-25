import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { toast } from 'react-hot-toast';
import { Plus, Trash2, ExternalLink, Check } from 'lucide-react';

interface Strategy {
  _id: string;
  name: string;
}

interface Reel {
  _id: string;
  name: string;
  url: string;
  date: string;
  strategyIds: string[];
}

export function Reels() {
  const [reels, setReels] = useState<Reel[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add-reel form
  const [reelName, setReelName] = useState('');
  const [reelUrl, setReelUrl] = useState('');
  const [reelDate, setReelDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingReel, setSavingReel] = useState(false);

  // Add-strategy form
  const [strategyName, setStrategyName] = useState('');
  const [savingStrategy, setSavingStrategy] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getReelsData();
      if (res.success) {
        setReels((res.reels || []).map((r: any) => ({ ...r, strategyIds: (r.strategyIds || []).map(String) })));
        setStrategies(res.strategies || []);
      }
    } catch (err) {
      console.error('Failed to load reels:', err);
      toast.error('Failed to load reels');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddReel = async () => {
    if (!reelName.trim() || !reelUrl.trim() || !reelDate) {
      toast.error('Name, URL and date are required');
      return;
    }
    setSavingReel(true);
    try {
      const res = await api.createReel(reelName.trim(), reelUrl.trim(), reelDate);
      if (res.success && res.reel) {
        setReels((prev) => [{ ...res.reel, strategyIds: [] }, ...prev]);
        setReelName('');
        setReelUrl('');
        toast.success('Reel added');
      } else {
        toast.error(res.error || 'Failed to add reel');
      }
    } catch {
      toast.error('Failed to add reel');
    } finally {
      setSavingReel(false);
    }
  };

  const handleAddStrategy = async () => {
    if (!strategyName.trim()) {
      toast.error('Strategy name is required');
      return;
    }
    setSavingStrategy(true);
    try {
      const res = await api.createReelStrategy(strategyName.trim());
      if (res.success && res.strategy) {
        setStrategies((prev) => [...prev, res.strategy]);
        setStrategyName('');
        toast.success('Strategy added');
      } else {
        toast.error(res.error || 'Failed to add strategy');
      }
    } catch {
      toast.error('Failed to add strategy');
    } finally {
      setSavingStrategy(false);
    }
  };

  const handleDeleteReel = async (id: string) => {
    if (!window.confirm('Delete this reel?')) return;
    const prev = reels;
    setReels((r) => r.filter((x) => x._id !== id));
    const res = await api.deleteReel(id);
    if (!res.success) {
      setReels(prev);
      toast.error('Failed to delete reel');
    }
  };

  const handleDeleteStrategy = async (id: string) => {
    if (!window.confirm('Delete this strategy column?')) return;
    const prevStrategies = strategies;
    const prevReels = reels;
    setStrategies((s) => s.filter((x) => x._id !== id));
    setReels((rs) => rs.map((r) => ({ ...r, strategyIds: r.strategyIds.filter((sid) => sid !== id) })));
    const res = await api.deleteReelStrategy(id);
    if (!res.success) {
      setStrategies(prevStrategies);
      setReels(prevReels);
      toast.error('Failed to delete strategy');
    }
  };

  const toggleCell = async (reel: Reel, strategyId: string) => {
    const marked = !reel.strategyIds.includes(strategyId);
    // Optimistic update
    setReels((rs) =>
      rs.map((r) =>
        r._id === reel._id
          ? { ...r, strategyIds: marked ? [...r.strategyIds, strategyId] : r.strategyIds.filter((s) => s !== strategyId) }
          : r
      )
    );
    const res = await api.toggleReelStrategy(reel._id, strategyId, marked);
    if (!res.success) {
      // Revert
      setReels((rs) =>
        rs.map((r) =>
          r._id === reel._id
            ? { ...r, strategyIds: marked ? r.strategyIds.filter((s) => s !== strategyId) : [...r.strategyIds, strategyId] }
            : r
        )
      );
      toast.error('Failed to update');
    }
  };

  const inputStyle: React.CSSProperties = {
    border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.5rem 0.75rem',
    fontSize: '0.85rem', color: '#1e293b', outline: 'none',
  };
  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#0f172a',
    color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px',
    fontSize: '0.825rem', fontWeight: 600, cursor: 'pointer',
  };

  if (isLoading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Loading Reels…</div>;
  }

  return (
    <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>Reels</h1>

      {/* Add forms */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {/* Add reel */}
        <div style={{ flex: '1 1 420px', backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '1rem' }}>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.7rem', fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Reel</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <input style={{ ...inputStyle, flex: '1 1 140px' }} placeholder="Name" value={reelName} onChange={(e) => setReelName(e.target.value)} />
            <input style={{ ...inputStyle, flex: '2 1 200px' }} placeholder="Reel URL" value={reelUrl} onChange={(e) => setReelUrl(e.target.value)} />
            <input style={{ ...inputStyle, flex: '0 1 150px' }} type="date" value={reelDate} onChange={(e) => setReelDate(e.target.value)} />
            <button style={{ ...btnStyle, opacity: savingReel ? 0.6 : 1 }} disabled={savingReel} onClick={handleAddReel}>
              <Plus size={14} /> Add
            </button>
          </div>
        </div>

        {/* Add strategy */}
        <div style={{ flex: '1 1 280px', backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '1rem' }}>
          <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.7rem', fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Add Strategy</p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Strategy name"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddStrategy(); }}
            />
            <button style={{ ...btnStyle, opacity: savingStrategy ? 0.6 : 1 }} disabled={savingStrategy} onClick={handleAddStrategy}>
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      </div>

      {/* Matrix table */}
      <div style={{ backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', overflowX: 'auto' }}>
        {reels.length === 0 && strategies.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
            Add a reel and a strategy to start building the matrix.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                <th style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, textAlign: 'left', position: 'sticky', left: 0, backgroundColor: '#f8fafc', minWidth: '220px' }}>
                  Reel
                </th>
                {strategies.map((s) => (
                  <th key={s._id} style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#475569', fontWeight: 700, textAlign: 'center', minWidth: '110px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                      <span>{s.name}</span>
                      <button onClick={() => handleDeleteStrategy(s._id)} title="Delete strategy" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.5, padding: 0, display: 'flex' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </th>
                ))}
                {strategies.length === 0 && (
                  <th style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#cbd5e1', fontWeight: 500, textAlign: 'center' }}>No strategies yet</th>
                )}
              </tr>
            </thead>
            <tbody>
              {reels.map((reel) => {
                const marked = new Set(reel.strategyIds);
                return (
                  <tr key={reel._id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem', position: 'sticky', left: 0, backgroundColor: '#fff' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <button onClick={() => handleDeleteReel(reel._id)} title="Delete reel" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.5, padding: 0, display: 'flex' }}>
                          <Trash2 size={14} />
                        </button>
                        <div>
                          <a href={reel.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                            {reel.name}
                            <ExternalLink size={12} color="#94a3b8" />
                          </a>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            {new Date(reel.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                    </td>
                    {strategies.map((s) => {
                      const isOn = marked.has(s._id);
                      return (
                        <td key={s._id} style={{ padding: '0.5rem', textAlign: 'center' }}>
                          <button
                            onClick={() => toggleCell(reel, s._id)}
                            title={isOn ? 'Marked' : 'Not marked'}
                            style={{
                              width: '24px', height: '24px', borderRadius: '6px', cursor: 'pointer',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              border: isOn ? '1px solid #16a34a' : '1px solid #e2e8f0',
                              backgroundColor: isOn ? '#16a34a' : '#fff',
                              transition: 'all 0.1s ease',
                            }}
                          >
                            {isOn && <Check size={15} color="#fff" strokeWidth={3} />}
                          </button>
                        </td>
                      );
                    })}
                    {strategies.length === 0 && <td />}
                  </tr>
                );
              })}
              {reels.length === 0 && (
                <tr>
                  <td colSpan={Math.max(1, strategies.length + 1)} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                    No reels yet — add one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default Reels;
