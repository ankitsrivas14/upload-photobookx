import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api, type COGSVersion } from '../services/api';
import styles from './COGSPage.module.css';

interface CostField {
  id: string;
  name: string;
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

function normaliseFields(raw: any[]): CostField[] {
  return raw.map((f) => ({
    ...f,
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
  // Converts any ISO string to YYYY-MM-DD local for <input type="date">
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

export function COGSPage() {
  const [versions, setVersions] = useState<COGSVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Which version is open in the editor (null = new-version draft)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // true when creating a brand-new version
  const [isNewDraft, setIsNewDraft] = useState(false);

  // Editor state (mirrors one version's data)
  const [editFields, setEditFields] = useState<CostField[]>([]);
  const [editEffectiveFrom, setEditEffectiveFrom] = useState('');
  const [newFieldName, setNewFieldName] = useState('');

  const now = new Date();

  // The version with the latest effectiveFrom <= now
  const currentVersion = versions.find((v) => {
    const eff = new Date(v.effectiveFrom);
    return eff <= now;
  });

  useEffect(() => {
    loadVersions();
  }, []);

  const loadVersions = async () => {
    try {
      setIsLoading(true);
      const res = await api.getCOGSVersions();
      if (res.success) {
        // Sorted newest-first by backend
        setVersions(res.versions);
        // Auto-select the current active version
        const active = res.versions.find((v) => new Date(v.effectiveFrom) <= new Date());
        if (active) openVersion(active, res.versions);
      }
    } catch (err) {
      toast.error('Failed to load COGS versions');
    } finally {
      setIsLoading(false);
    }
  };

  const openVersion = (v: COGSVersion, vList: COGSVersion[] = versions) => {
    setIsNewDraft(false);
    setSelectedId(v._id);
    setEditFields(normaliseFields(v.fields));
    setEditEffectiveFrom(toDateInputValue(v.effectiveFrom));
    setNewFieldName('');
    void vList; // used by caller, not needed here
  };

  const startNewVersion = () => {
    setIsNewDraft(true);
    setSelectedId(null);
    // Pre-populate from the latest version (versions sorted newest-first)
    const base = versions.length > 0 ? normaliseFields(versions[0].fields) : [];
    setEditFields(base);
    setEditEffectiveFrom('');
    setNewFieldName('');
  };

  // ── field mutations ──────────────────────────────────────────────────────────

  const addField = () => {
    if (!newFieldName.trim()) return;
    setEditFields([...editFields, {
      id: Date.now().toString(),
      name: newFieldName.trim(),
      smallPrepaidValue: 0,
      smallCODValue: 0,
      largePrepaidValue: 0,
      largeCODValue: 0,
      type: 'cogs',
      calculationType: 'fixed',
      percentageType: 'excluded',
    }]);
    setNewFieldName('');
  };

  const deleteField = (id: string) =>
    setEditFields(editFields.filter((f) => f.id !== id));

  const updateValue = (id: string, variant: 'small' | 'large', pm: 'prepaid' | 'cod', value: number) => {
    const key = `${variant}${pm === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof CostField;
    setEditFields(editFields.map((f) => f.id === id ? { ...f, [key]: value } : f));
  };

  const updateType = (id: string, type: 'cogs' | 'ndr' | 'both') =>
    setEditFields(editFields.map((f) => f.id === id ? { ...f, type } : f));

  const updateCalcType = (id: string, calculationType: 'fixed' | 'percentage') =>
    setEditFields(editFields.map((f) => f.id === id ? { ...f, calculationType } : f));

  const updatePctType = (id: string, percentageType: 'included' | 'excluded') =>
    setEditFields(editFields.map((f) => f.id === id ? { ...f, percentageType } : f));

  // ── save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editEffectiveFrom) {
      toast.error('Please set an effective-from date');
      return;
    }
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

  // ── helpers ──────────────────────────────────────────────────────────────────

  const total = (variant: 'small' | 'large', pm: 'prepaid' | 'cod') =>
    editFields.reduce((s, f) => {
      const key = `${variant}${pm === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof CostField;
      return s + ((f[key] as number) || 0);
    }, 0);

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
          <p>Cost components are version-based — each version applies from its effective date onward</p>
        </div>
      </div>

      <div className={styles['layout']}>
        {/* ── Version sidebar ──────────────────────────────────────── */}
        <div className={styles['version-sidebar']}>
          <div className={styles['sidebar-header']}>
            <h3>Versions</h3>
            <button className={styles['new-version-btn']} onClick={startNewVersion}>+ New</button>
          </div>
          <ul className={styles['version-list']}>
            {isNewDraft && (
              <li
                className={`${styles['version-item']} ${styles['new-draft']} ${styles['selected']}`}
                onClick={() => {/* already open */}}
              >
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
            {versions.length === 0 && !isNewDraft && (
              <li style={{ padding: '1.5rem 1rem', fontSize: '0.8125rem', color: '#94a3b8', textAlign: 'center' }}>
                No versions yet
              </li>
            )}
          </ul>
        </div>

        {/* ── Editor panel ─────────────────────────────────────────── */}
        {editorOpen ? (
          <div className={styles['editor-panel']}>
            {/* Header */}
            <div className={styles['editor-header']}>
              <div>
                <p className={styles['editor-title']}>
                  {isNewDraft ? 'New Version' : `Version: ${editEffectiveFrom}`}
                </p>
                <p className={styles['editor-subtitle']}>
                  Orders placed on or after the effective date will use this cost configuration
                </p>
              </div>
              <div className={styles['editor-actions']}>
                {!isNewDraft && selectedId && versions.length > 1 && (
                  <button
                    className={styles['delete-version-btn']}
                    onClick={() => handleDelete(selectedId)}
                  >
                    Delete
                  </button>
                )}
                <button
                  className={styles['save-btn']}
                  onClick={handleSave}
                  disabled={isSaving}
                >
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
                All orders placed on this date or later will use these values
              </span>
            </div>

            {/* Add field row */}
            <div className={styles['add-field-section']}>
              <input
                type="text"
                placeholder="New cost component name (e.g. Printing Cost)"
                value={newFieldName}
                onChange={(e) => setNewFieldName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addField()}
                className={styles['field-name-input']}
              />
              <button
                className={styles['add-field-btn']}
                onClick={addField}
                disabled={!newFieldName.trim()}
              >
                + Add Field
              </button>
            </div>

            {/* Fields table */}
            <div className={styles['table-container']}>
              <table className={styles['cogs-table']}>
                <thead>
                  <tr>
                    <th>Cost Field</th>
                    <th>Type</th>
                    <th>Calc</th>
                    <th className={styles['value-header']}>Small Prepaid</th>
                    <th className={styles['value-header']}>Small COD</th>
                    <th className={styles['value-header']}>Large Prepaid</th>
                    <th className={styles['value-header']}>Large COD</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {editFields.map((field) => (
                    <tr key={field.id}>
                      <td className={styles['name-cell']}>{field.name}</td>
                      <td>
                        <select
                          value={field.type}
                          onChange={(e) => updateType(field.id, e.target.value as 'cogs' | 'ndr' | 'both')}
                          className={styles['table-select']}
                        >
                          <option value="cogs">COGS</option>
                          <option value="ndr">NDR</option>
                          <option value="both">Both</option>
                        </select>
                      </td>
                      <td>
                        <div className={styles['calc-cell']}>
                          <select
                            value={field.calculationType}
                            onChange={(e) => updateCalcType(field.id, e.target.value as 'fixed' | 'percentage')}
                            className={styles['table-select-small']}
                          >
                            <option value="fixed">₹</option>
                            <option value="percentage">%</option>
                          </select>
                          {field.calculationType === 'percentage' && (
                            <select
                              value={field.percentageType}
                              onChange={(e) => updatePctType(field.id, e.target.value as 'included' | 'excluded')}
                              className={styles['table-select-small']}
                            >
                              <option value="excluded">Ex</option>
                              <option value="included">In</option>
                            </select>
                          )}
                        </div>
                      </td>
                      {(['small', 'large'] as const).map((v) =>
                        (['prepaid', 'cod'] as const).map((pm) => (
                          <td key={`${v}-${pm}`}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={field[`${v}${pm === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof CostField] as number}
                              onChange={(e) => updateValue(field.id, v, pm, parseFloat(e.target.value) || 0)}
                              className={styles['table-input']}
                            />
                          </td>
                        ))
                      )}
                      <td>
                        <button
                          onClick={() => deleteField(field.id)}
                          className={styles['table-delete-btn']}
                          title="Delete"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {editFields.length === 0 && (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8', fontSize: '0.875rem' }}>
                        No cost fields yet. Add one above.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className={styles['totals-label']}>Total Costs</td>
                    <td className={styles['totals-cell']}>₹{total('small', 'prepaid').toFixed(0)}</td>
                    <td className={styles['totals-cell']}>₹{total('small', 'cod').toFixed(0)}</td>
                    <td className={styles['totals-cell']}>₹{total('large', 'prepaid').toFixed(0)}</td>
                    <td className={styles['totals-cell']}>₹{total('large', 'cod').toFixed(0)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
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
