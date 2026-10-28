import { useState, useEffect } from 'react';
import { api, errorMessage } from '../../services/api';
import { toast } from 'react-hot-toast';
import { Button, Card, Checkbox, DateField, Dialog, EmptyState, Icon, Skeleton, TextField } from '../../components/ui/pbx';
import styles from '../AnalysisPage.module.css';

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

  // A delete waiting for confirmation
  const [confirmDelete, setConfirmDelete] = useState<{ title: string; description: string; run: () => void } | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const res = await api.getReelsData();
      if (res.success) {
        setReels((res.reels || []).map((r: Reel) => ({ ...r, strategyIds: (r.strategyIds || []).map(String) })));
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
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to add reel'));
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
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to add strategy'));
    } finally {
      setSavingStrategy(false);
    }
  };

  const handleDeleteReel = async (id: string) => {
    const prev = reels;
    setReels((r) => r.filter((x) => x._id !== id));
    try {
      await api.deleteReel(id);
    } catch (err) {
      setReels(prev);
      toast.error(errorMessage(err, 'Failed to delete reel'));
    }
  };

  const handleDeleteStrategy = async (id: string) => {
    const prevStrategies = strategies;
    const prevReels = reels;
    setStrategies((s) => s.filter((x) => x._id !== id));
    setReels((rs) => rs.map((r) => ({ ...r, strategyIds: r.strategyIds.filter((sid) => sid !== id) })));
    try {
      await api.deleteReelStrategy(id);
    } catch (err) {
      setStrategies(prevStrategies);
      setReels(prevReels);
      toast.error(errorMessage(err, 'Failed to delete strategy'));
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
    try {
      await api.toggleReelStrategy(reel._id, strategyId, marked);
    } catch (err) {
      // Revert
      setReels((rs) =>
        rs.map((r) =>
          r._id === reel._id
            ? { ...r, strategyIds: marked ? r.strategyIds.filter((s) => s !== strategyId) : [...r.strategyIds, strategyId] }
            : r
        )
      );
      toast.error(errorMessage(err, 'Failed to update'));
    }
  };

  if (isLoading) {
    return <Skeleton lines={6} />;
  }

  return (
    <>
      <div className={styles.row}>
        <Card className={styles.wide} title="Add reel">
          <div className={styles.reelForm}>
            <TextField size="sm" aria-label="Reel name" placeholder="Name" value={reelName} onChange={(e) => setReelName(e.target.value)} />
            <TextField size="sm" aria-label="Reel URL" placeholder="Reel URL" value={reelUrl} onChange={(e) => setReelUrl(e.target.value)} />
            <DateField size="sm" aria-label="Reel date" value={reelDate} onChange={setReelDate} />
            <Button size="sm" variant="primary" icon="plus" loading={savingReel} onClick={handleAddReel}>Add</Button>
          </div>
        </Card>
        <Card title="Add strategy">
          <div className={styles.strategyForm}>
            <TextField
              size="sm"
              aria-label="Strategy name"
              placeholder="Strategy name"
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddStrategy(); }}
            />
            <Button size="sm" icon="plus" loading={savingStrategy} onClick={handleAddStrategy}>Add</Button>
          </div>
        </Card>
      </div>

      <Card title="Reels and strategies" eyebrow="tick the strategies each reel uses" padding="sm">
        {reels.length === 0 && strategies.length === 0 ? (
          <EmptyState size="sm" icon="clapperboard" title="No reels yet" description="Add a reel and a strategy to start the matrix." />
        ) : (
          <div className="pbx-table">
            <div className="pbx-table__scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className={styles.reelCol}>Reel</th>
                    {strategies.map((s) => (
                      <th key={s._id} scope="col" className={styles.strategyCol}>
                        <span className={styles.strategyHead}>
                          {s.name}
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            icon="trash-2"
                            tooltip="Delete strategy"
                            onClick={() => setConfirmDelete({ title: `Delete the "${s.name}" strategy?`, description: 'Its column and every tick in it go.', run: () => handleDeleteStrategy(s._id) })}
                          >
                            {`Delete ${s.name}`}
                          </Button>
                        </span>
                      </th>
                    ))}
                    {strategies.length === 0 && <th scope="col" className={styles.muted}>No strategies yet</th>}
                  </tr>
                </thead>
                <tbody>
                  {reels.map((reel) => {
                    const marked = new Set(reel.strategyIds);
                    return (
                      <tr key={reel._id}>
                        <td className={styles.reelCol}>
                          <span className={styles.reelCell}>
                            <Button
                              size="sm"
                              variant="ghost"
                              iconOnly
                              icon="trash-2"
                              tooltip="Delete reel"
                              onClick={() => setConfirmDelete({ title: `Delete "${reel.name}"?`, description: 'The reel and its ticks go.', run: () => handleDeleteReel(reel._id) })}
                            >
                              {`Delete ${reel.name}`}
                            </Button>
                            <span>
                              <a className={styles.link} href={reel.url} target="_blank" rel="noreferrer">
                                {reel.name}
                                <Icon name="external-link" size={12} />
                              </a>
                              <span className={styles.timelineMeta}>
                                {new Date(reel.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              </span>
                            </span>
                          </span>
                        </td>
                        {strategies.map((s) => (
                          <td key={s._id} className={styles.strategyCol}>
                            <Checkbox aria-label={`${reel.name}: ${s.name}`} checked={marked.has(s._id)} onChange={() => toggleCell(reel, s._id)} />
                          </td>
                        ))}
                        {strategies.length === 0 && <td />}
                      </tr>
                    );
                  })}
                  {reels.length === 0 && (
                    <tr>
                      <td colSpan={Math.max(1, strategies.length + 1)} className="pbx-table__empty">
                        <EmptyState size="sm" icon="clapperboard" title="No reels yet" description="Add one above." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Dialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        size="sm"
        tone="negative"
        icon="triangle-alert"
        title={confirmDelete?.title ?? ''}
        description={confirmDelete?.description}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { const run = confirmDelete?.run; setConfirmDelete(null); run?.(); }}>Delete</Button>
          </>
        }
      />
    </>
  );
}

export default Reels;
