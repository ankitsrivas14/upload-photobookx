import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api, type COGSVersion } from '../services/api';
import styles from './COGSPage.module.css';

interface CostField {
  id: string;
  name: string;
  category: 'pre' | 'post';
  smallValue?: number;
  largeValue?: number;
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  percentageType: 'included' | 'excluded';
}

type ValueKey = 'smallPrepaidValue' | 'smallCODValue' | 'largePrepaidValue' | 'largeCODValue';

function normaliseFields(raw: any[]): CostField[] {
  return raw.map((f) => ({
    ...f,
    category: f.category ?? 'pre',
    smallPrepaidValue: f.smallPrepaidValue ?? f.smallValue ?? 0,
    smallCODValue: f.smallCODValue ?? f.smallValue ?? 0,
    largePrepaidValue: f.largePrepaidValue ?? f.largeValue ?? 0,
    largeCODValue: f.largeCODValue ?? f.largeValue ?? 0,
    type: f.type ?? 'cogs',
    calculationType: f.calculationType ?? 'fixed',
    percentageType: f.percentageType ?? 'excluded',
  }));
}

function toDateInputValue(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA');
}

function versionLabel(v: COGSVersion): string {
  return new Date(v.effectiveFrom).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function versionBadge(v: COGSVersion, now: Date): { label: string; cls: string } {
  const eff = new Date(v.effectiveFrom);
  if (eff > now) return { label: 'Scheduled', cls: styles['badge-scheduled'] };
  return { label: 'Past', cls: styles['badge-past'] };
}

function emptyField(category: 'pre' | 'post'): CostField {
  return {
    id: Date.now().toString() + Math.random(),
    name: '',
    category,
    smallPrepaidValue: 0,
    smallCODValue: 0,
    largePrepaidValue: 0,
    largeCODValue: 0,
    type: 'cogs',
    calculationType: 'fixed',
    percentageType: 'excluded',
  };
}

// ── sub-component: one cost table ────────────────────────────────────────────

interface CostTableProps {
  category: 'pre' | 'post';
  fields: CostField[];
  onChange: (fields: CostField[]) => void;
}

function CostTable({ category, fields, onChange }: CostTableProps) {
  const [newName, setNewName] = useState('');

  const rows = fields.filter((f) => f.category === category);
  const otherRows = fields.filter((f) => f.category !== category);

  const update = (updated: CostField[]) => onChange([...otherRows, ...updated]);

  const addField = () => {
    if (!newName.trim()) return;
    update([...rows, { ...emptyField(category), id: Date.now().toString(), name: newName.trim() }]);
    setNewName('');
  };

  const deleteField = (id: string) => update(rows.filter((f) => f.id !== id));

  const setField = (id: string, patch: Partial<CostField>) =>
    update(rows.map((f) => f.id === id ? { ...f, ...patch } : f));

  const updateValue = (id: string, key: ValueKey, value: number) =>
    setField(id, { [key]: value });

  const total = (key: ValueKey) => rows.reduce((s, f) => s + (f[key] || 0), 0);

  const title = category === 'pre' ? 'Pre Cost' : 'Post Cost';
  const subtitle = category === 'pre'
    ? 'Production costs before the order ships (materials, GST, payment fees…)'
    : 'Delivery & logistics costs after the order ships (shipping, COD handling…)';

  return (
    <div className={styles['cost-table-section']}>
      <div className={styles['cost-table-header']}>
        <div>
          <h3 className={styles['cost-table-title']}>{title}</h3>
          <p className={styles['cost-table-subtitle']}>{subtitle}</p>
        </div>
      </div>

      <div className={styles['add-field-section']}>
        <input
          type="text"
          placeholder={`New ${title.toLowerCase()} component`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addField()}
          className={styles['field-name-input']}
        />
        <button className={styles['add-field-btn']} onClick={addField} disabled={!newName.trim()}>
          + Add Field
        </button>
      </div>

      <div className={styles['table-container']}>
        <table className={styles['cogs-table']}>
          <thead>
            <tr>
              <th>Cost Field</th>
              <th className={styles['value-header']}>Small Prepaid</th>
              <th className={styles['value-header']}>Small COD</th>
              <th className={styles['value-header']}>Large Prepaid</th>
              <th className={styles['value-header']}>Large COD</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((field) => (
              <tr key={field.id}>
                <td className={styles['name-cell']}>
                  <span className={styles['field-name']}>{field.name}</span>
                  <div className={styles['field-controls']}>
                    <select
                      value={field.type}
                      onChange={(e) => setField(field.id, { type: e.target.value as CostField['type'] })}
                      className={styles['control-select']}
                    >
                      <option value="cogs">COGS</option>
                      <option value="ndr">NDR</option>
                      <option value="both">Both</option>
                    </select>
                    <select
                      value={field.calculationType}
                      onChange={(e) => setField(field.id, { calculationType: e.target.value as CostField['calculationType'] })}
                      className={styles['control-select']}
                    >
                      <option value="fixed">Fixed (₹)</option>
                      <option value="percentage">Percentage (%)</option>
                    </select>
                    {field.calculationType === 'percentage' && (
                      <select
                        value={field.percentageType}
                        onChange={(e) => setField(field.id, { percentageType: e.target.value as CostField['percentageType'] })}
                        className={styles['control-select']}
                      >
                        <option value="excluded">Excl. of price</option>
                        <option value="included">Incl. in price</option>
                      </select>
                    )}
                  </div>
                </td>
                {(['smallPrepaidValue', 'smallCODValue', 'largePrepaidValue', 'largeCODValue'] as ValueKey[]).map((key) => (
                  <td key={key}>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={field[key]}
                      onChange={(e) => updateValue(field.id, key, parseFloat(e.target.value) || 0)}
                      className={styles['table-input']}
                    />
                  </td>
                ))}
                <td>
                  <button onClick={() => deleteField(field.id)} className={styles['table-delete-btn']} title="Delete">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                  No fields yet. Add one above.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td className={styles['totals-label']}>{title} Total</td>
              <td className={styles['totals-cell']}>₹{total('smallPrepaidValue').toFixed(0)}</td>
              <td className={styles['totals-cell']}>₹{total('smallCODValue').toFixed(0)}</td>
              <td className={styles['totals-cell']}>₹{total('largePrepaidValue').toFixed(0)}</td>
              <td className={styles['totals-cell']}>₹{total('largeCODValue').toFixed(0)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ── main page ────────────────────────────────────────────────────────────────

export function COGSPage() {
  const [versions, setVersions] = useState<COGSVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNewDraft, setIsNewDraft] = useState(false);

  const [editFields, setEditFields] = useState<CostField[]>([]);
  const [editEffectiveFrom, setEditEffectiveFrom] = useState('');

  const now = new Date();

  const currentVersion = versions.find((v) => new Date(v.effectiveFrom) <= now);

  useEffect(() => { loadVersions(); }, []);

  const loadVersions = async () => {
    try {
      setIsLoading(true);
      const res = await api.getCOGSVersions();
      if (res.success) {
        setVersions(res.versions);
        const active = res.versions.find((v) => new Date(v.effectiveFrom) <= new Date());
        if (active) openVersion(active);
      }
    } catch {
      toast.error('Failed to load COGS versions');
    } finally {
      setIsLoading(false);
    }
  };

  const openVersion = (v: COGSVersion) => {
    setIsNewDraft(false);
    setSelectedId(v._id);
    setEditFields(normaliseFields(v.fields));
    setEditEffectiveFrom(toDateInputValue(v.effectiveFrom));
  };

  const startNewVersion = () => {
    setIsNewDraft(true);
    setSelectedId(null);
    const base = versions.length > 0 ? normaliseFields(versions[0].fields) : [];
    setEditFields(base);
    setEditEffectiveFrom('');
  };

  const handleSave = async () => {
    if (!editEffectiveFrom) { toast.error('Please set an effective-from date'); return; }
    setIsSaving(true);
    try {
      if (isNewDraft) {
        await api.saveCOGSConfiguration({ fields: editFields, effectiveFrom: editEffectiveFrom });
        toast.success('New COGS version created — P&L recomputing in background');
      } else {
        await api.updateCOGSVersion(selectedId!, { fields: editFields, effectiveFrom: editEffectiveFrom });
        toast.success('COGS version updated — P&L recomputing in background');
      }
      await loadVersions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this version? P&L will recompute for affected dates.')) return;
    try {
      await api.deleteCOGSVersion(id);
      toast.success('Version deleted');
      setSelectedId(null);
      setIsNewDraft(false);
      await loadVersions();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete version');
    }
  };

  // Combined totals across both tables
  const grandTotal = (key: ValueKey) => editFields.reduce((s, f) => s + (f[key] || 0), 0);

  if (isLoading) {
    return (
      <div className={styles['loading-section']}>
        <div className={styles.spinner}></div>
        <p>Loading COGS versions...</p>
      </div>
    );
  }

  const editorOpen = isNewDraft || selectedId !== null;

  return (
    <div className={styles['cogs-page']}>
      <div className={styles['page-header']}>
        <div>
          <h2>COGS Configuration</h2>
          <p>Version-based cost config — Pre Cost + Post Cost combine into the final COGS per order</p>
        </div>
      </div>

      <div className={styles['layout']}>
        {/* Version sidebar */}
        <div className={styles['version-sidebar']}>
          <div className={styles['sidebar-header']}>
            <h3>Versions</h3>
            <button className={styles['new-version-btn']} onClick={startNewVersion}>+ New</button>
          </div>
          <ul className={styles['version-list']}>
            {isNewDraft && (
              <li className={`${styles['version-item']} ${styles['new-draft']} ${styles['selected']}`}>
                <span className={`${styles['version-badge']} ${styles['badge-draft']}`}>Draft</span>
                <span className={styles['version-date']}>New version</span>
                <span className={styles['version-meta']}>Unsaved</span>
              </li>
            )}
            {versions.map((v) => {
              const isActive = v._id === currentVersion?._id;
              const badge = isActive
                ? { label: 'Current', cls: styles['badge-current'] }
                : versionBadge(v, now);
              const isSelected = !isNewDraft && selectedId === v._id;
              return (
                <li
                  key={v._id}
                  className={`${styles['version-item']} ${isSelected ? styles['selected'] : ''}`}
                  onClick={() => openVersion(v)}
                >
                  <span className={`${styles['version-badge']} ${badge.cls}`}>{badge.label}</span>
                  <span className={styles['version-date']}>{versionLabel(v)}</span>
                  <span className={styles['version-meta']}>{v.fields.length} field{v.fields.length !== 1 ? 's' : ''}</span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Editor */}
        {editorOpen ? (
          <div className={styles['editor-panel']}>
            {/* Header row */}
            <div className={styles['editor-header']}>
              <div>
                <p className={styles['editor-title']}>
                  {isNewDraft ? 'New Version' : `Version: ${editEffectiveFrom}`}
                </p>
                <p className={styles['editor-subtitle']}>
                  Orders on or after the effective date use this config
                </p>
              </div>
              <div className={styles['editor-actions']}>
                {!isNewDraft && selectedId && versions.length > 1 && (
                  <button className={styles['delete-version-btn']} onClick={() => handleDelete(selectedId)}>
                    Delete
                  </button>
                )}
                <button className={styles['save-btn']} onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving…' : isNewDraft ? 'Create Version' : 'Save Changes'}
                </button>
              </div>
            </div>

            {/* Effective-from date */}
            <div className={styles['effective-date-row']}>
              <span className={styles['effective-date-label']}>Effective from</span>
              <input
                type="date"
                className={styles['effective-date-input']}
                value={editEffectiveFrom}
                onChange={(e) => setEditEffectiveFrom(e.target.value)}
              />
              <span className={styles['date-hint']}>
                Orders placed on this date or later will use these values
              </span>
            </div>

            {/* Pre Cost table */}
            <CostTable category="pre" fields={editFields} onChange={setEditFields} />

            {/* Post Cost table */}
            <CostTable category="post" fields={editFields} onChange={setEditFields} />

            {/* Grand total summary */}
            <div className={styles['grand-total-row']}>
              <span className={styles['grand-total-label']}>Total COGS (Pre + Post)</span>
              <div className={styles['grand-total-values']}>
                <div className={styles['grand-total-item']}>
                  <span className={styles['grand-total-variant']}>Small Prepaid</span>
                  <span className={styles['grand-total-amount']}>₹{grandTotal('smallPrepaidValue').toFixed(0)}</span>
                </div>
                <div className={styles['grand-total-item']}>
                  <span className={styles['grand-total-variant']}>Small COD</span>
                  <span className={styles['grand-total-amount']}>₹{grandTotal('smallCODValue').toFixed(0)}</span>
                </div>
                <div className={styles['grand-total-item']}>
                  <span className={styles['grand-total-variant']}>Large Prepaid</span>
                  <span className={styles['grand-total-amount']}>₹{grandTotal('largePrepaidValue').toFixed(0)}</span>
                </div>
                <div className={styles['grand-total-item']}>
                  <span className={styles['grand-total-variant']}>Large COD</span>
                  <span className={styles['grand-total-amount']}>₹{grandTotal('largeCODValue').toFixed(0)}</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles['no-version-placeholder']}>
            <p>Select a version from the left to edit it, or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
}
