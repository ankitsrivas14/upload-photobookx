import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { api, type COGSVersion, type COGSTotalOverrides } from '../services/api';
import { Badge, Button, Card, DateField, Dialog, EmptyState, SegmentedControl, Select, Skeleton, StatCard, StatStrip, TextField, Tooltip } from '../components/ui/pbx';
import { cx, formatINR } from '../components/ui/format';
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

function versionBadge(v: COGSVersion, now: Date): { label: string; tone: 'info' | 'neutral' } {
  const eff = new Date(v.effectiveFrom);
  if (eff > now) return { label: 'Scheduled', tone: 'info' };
  return { label: 'Past', tone: 'neutral' };
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

const VALUE_KEYS: ValueKey[] = ['smallPrepaidValue', 'smallCODValue', 'largePrepaidValue', 'largeCODValue'];
const VALUE_LABELS: Record<ValueKey, string> = {
  smallPrepaidValue: 'Small prepaid',
  smallCODValue: 'Small COD',
  largePrepaidValue: 'Large prepaid',
  largeCODValue: 'Large COD',
};

interface CostTableProps {
  category: 'pre' | 'post';
  fields: CostField[];
  overrides: COGSTotalOverrides;
  onChange: (fields: CostField[]) => void;
  onOverrideChange: (key: ValueKey, value: number | undefined) => void;
}

function CostTable({ category, fields, overrides, onChange, onOverrideChange }: CostTableProps) {
  const [newName, setNewName] = useState('');
  // Track raw string input per total cell so user can type freely before blur
  const totalInputRefs = useRef<Partial<Record<ValueKey, string>>>({});

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

  const updateValue = (id: string, key: ValueKey, value: number) => {
    // Editing a cell clears the override for that column
    onOverrideChange(key, undefined);
    setField(id, { [key]: value });
  };

  const computedTotal = (key: ValueKey) => rows.reduce((s, f) => s + (f[key] || 0), 0);

  const title = category === 'pre' ? 'Pre cost' : 'Post cost';
  const subtitle = category === 'pre'
    ? 'Production costs before the order ships (materials, GST, payment fees…)'
    : 'Delivery & logistics costs after the order ships (shipping, COD handling…)';

  return (
    <Card title={title} eyebrow={subtitle} padding="sm">
      <div className={styles.addRow}>
        <TextField
          size="sm"
          placeholder={`New ${title.toLowerCase()} component`}
          aria-label={`New ${title.toLowerCase()} component`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addField()}
        />
        <Button size="sm" icon="plus" onClick={addField} disabled={!newName.trim()}>Add field</Button>
      </div>

      <div className="pbx-table">
        <div className="pbx-table__scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Cost field</th>
                {VALUE_KEYS.map((k) => (
                  <th key={k} scope="col" className={styles.right}>{VALUE_LABELS[k]}</th>
                ))}
                <th scope="col"><span className="pbx-sr">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((field) => (
                <tr key={field.id}>
                  <td className={styles.nameCell}>
                    <span className={styles.fieldName}>{field.name}</span>
                    <span className={styles.controls}>
                      <Select
                        size="sm"
                        aria-label={`${field.name}: applies to`}
                        value={field.type}
                        onChange={(v) => setField(field.id, { type: v as CostField['type'] })}
                        options={[{ value: 'cogs', label: 'COGS' }, { value: 'ndr', label: 'NDR' }, { value: 'both', label: 'Both' }]}
                      />
                      <Select
                        size="sm"
                        aria-label={`${field.name}: calculation`}
                        value={field.calculationType}
                        onChange={(v) => setField(field.id, { calculationType: v as CostField['calculationType'] })}
                        options={[{ value: 'fixed', label: 'Fixed (₹)' }, { value: 'percentage', label: 'Percentage (%)' }]}
                      />
                      {field.calculationType === 'percentage' && (
                        <SegmentedControl
                          size="sm"
                          label={`${field.name}: percentage of price`}
                          value={field.percentageType}
                          onChange={(v) => setField(field.id, { percentageType: v as CostField['percentageType'] })}
                          options={[{ value: 'excluded', label: 'Excl. of price' }, { value: 'included', label: 'Incl. in price' }]}
                        />
                      )}
                    </span>
                  </td>
                  {VALUE_KEYS.map((key) => {
                    const isOverridden = overrides[key] !== undefined;
                    return (
                      <td key={key} className={styles.valueCell}>
                        <Tooltip content={isOverridden ? 'Click to edit and clear the total override' : undefined}>
                          <TextField
                            size="sm"
                            type="number"
                            min="0"
                            step="0.01"
                            className={cx(styles.valueInput, isOverridden && styles.overridden)}
                            aria-label={`${field.name}, ${VALUE_LABELS[key]}`}
                            value={isOverridden ? '' : field[key]}
                            placeholder={isOverridden ? '—' : undefined}
                            onFocus={() => { if (isOverridden) onOverrideChange(key, undefined); }}
                            onChange={(e) => updateValue(field.id, key, parseFloat(e.target.value) || 0)}
                          />
                        </Tooltip>
                      </td>
                    );
                  })}
                  <td>
                    <div className={styles.actions}>
                      <Button size="sm" variant="ghost" iconOnly icon="trash-2" tooltip="Delete field" onClick={() => deleteField(field.id)}>
                        {`Delete ${field.name}`}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="pbx-table__empty">
                    <EmptyState size="sm" icon="calculator" title="No fields yet" description="Add one above." />
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow}>
                <td>{title} total</td>
                {VALUE_KEYS.map((key) => {
                  const isOverridden = overrides[key] !== undefined;
                  const displayValue = isOverridden ? overrides[key]! : computedTotal(key);
                  return (
                    <td key={key} className={styles.valueCell}>
                      <Tooltip content={isOverridden ? 'Override active — edit a cell above to revert to computed total' : 'Edit to override the total for this column'}>
                        <TextField
                          size="sm"
                          type="number"
                          min="0"
                          step="1"
                          className={cx(styles.valueInput, styles.totalInput, isOverridden && styles.overridden)}
                          aria-label={`${title} total, ${VALUE_LABELS[key]}`}
                          value={totalInputRefs.current[key] ?? displayValue}
                          onChange={(e) => {
                            totalInputRefs.current[key] = e.target.value;
                            const v = parseFloat(e.target.value);
                            if (!isNaN(v)) onOverrideChange(key, v);
                          }}
                          onFocus={(e) => {
                            totalInputRefs.current[key] = String(displayValue);
                            e.target.select();
                          }}
                          onBlur={() => {
                            delete totalInputRefs.current[key];
                            // If user cleared the field, remove override
                            if (overrides[key] === undefined) return;
                          }}
                        />
                      </Tooltip>
                    </td>
                  );
                })}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </Card>
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
  const [preOverrides, setPreOverrides] = useState<COGSTotalOverrides>({});
  const [postOverrides, setPostOverrides] = useState<COGSTotalOverrides>({});
  // The version waiting for a delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    setPreOverrides(v.totalOverrides?.pre ?? {});
    setPostOverrides(v.totalOverrides?.post ?? {});
  };

  const startNewVersion = () => {
    setIsNewDraft(true);
    setSelectedId(null);
    const base = versions.length > 0 ? normaliseFields(versions[0].fields) : [];
    setEditFields(base);
    setEditEffectiveFrom('');
    setPreOverrides(versions[0]?.totalOverrides?.pre ?? {});
    setPostOverrides(versions[0]?.totalOverrides?.post ?? {});
  };

  const makeOverrideHandler = (setter: React.Dispatch<React.SetStateAction<COGSTotalOverrides>>) =>
    (key: ValueKey, value: number | undefined) =>
      setter((prev) => {
        const next = { ...prev };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return next;
      });

  const handleSave = async () => {
    if (!editEffectiveFrom) { toast.error('Please set an effective-from date'); return; }
    setIsSaving(true);
    const totalOverrides = { pre: preOverrides, post: postOverrides };
    try {
      if (isNewDraft) {
        await api.saveCOGSConfiguration({ fields: editFields, effectiveFrom: editEffectiveFrom, totalOverrides });
        toast.success('New COGS version created — P&L recomputing in background');
      } else {
        await api.updateCOGSVersion(selectedId!, { fields: editFields, effectiveFrom: editEffectiveFrom, totalOverrides });
        toast.success('COGS version updated — P&L recomputing in background');
      }
      await loadVersions();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteCOGSVersion(id);
      toast.success('Version deleted');
      setSelectedId(null);
      setIsNewDraft(false);
      await loadVersions();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Failed to delete version');
    }
  };

  // Grand total: use override if set, otherwise sum fields for each category
  const grandTotal = (key: ValueKey) => {
    const preVal = preOverrides[key] ?? editFields.filter(f => f.category === 'pre').reduce((s, f) => s + (f[key] || 0), 0);
    const postVal = postOverrides[key] ?? editFields.filter(f => f.category === 'post').reduce((s, f) => s + (f[key] || 0), 0);
    return preVal + postVal;
  };

  if (isLoading) {
    return <Skeleton lines={8} />;
  }

  const editorOpen = isNewDraft || selectedId !== null;

  return (
    <>
      <Card
        title="COGS versions"
        eyebrow="pre cost + post cost make the COGS per order"
        padding="sm"
        actions={
          <>
            {!isNewDraft && selectedId && versions.length > 1 && (
              <Button size="sm" variant="ghost" icon="trash-2" onClick={() => setConfirmDeleteId(selectedId)}>Delete version</Button>
            )}
            <Button size="sm" variant="primary" onClick={handleSave} loading={isSaving} disabled={!editorOpen}>
              {isNewDraft ? 'Create version' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className={styles.versions}>
          {versions.map((v) => {
            const isActive = v._id === currentVersion?._id;
            const badge = isActive ? { label: 'Current', tone: 'positive' as const } : versionBadge(v, now);
            const isSelected = !isNewDraft && selectedId === v._id;
            return (
              <button key={v._id} type="button" className={styles.version} aria-pressed={isSelected} onClick={() => openVersion(v)}>
                <Badge size="sm" tone={badge.tone}>{badge.label}</Badge>
                <span className={styles.versionDate}>{versionLabel(v)}</span>
              </button>
            );
          })}
          {isNewDraft && (
            <span className={cx(styles.version, styles.draft)}>
              <Badge size="sm" tone="caution">Draft</Badge>
              <span className={styles.versionDate}>New version</span>
            </span>
          )}
          <Button size="sm" variant="ghost" icon="plus" onClick={startNewVersion}>New version</Button>
        </div>
      </Card>

      {editorOpen ? (
        <>
          <div className={styles.effective}>
            <DateField
              label="Effective from"
              value={editEffectiveFrom}
              onChange={setEditEffectiveFrom}
              hint="Orders placed on this date or later use these values."
            />
          </div>

          <CostTable
            category="pre"
            fields={editFields}
            overrides={preOverrides}
            onChange={setEditFields}
            onOverrideChange={makeOverrideHandler(setPreOverrides)}
          />

          <CostTable
            category="post"
            fields={editFields}
            overrides={postOverrides}
            onChange={setEditFields}
            onOverrideChange={makeOverrideHandler(setPostOverrides)}
          />

          <StatStrip label="Total COGS, pre plus post">
            {VALUE_KEYS.map((key) => (
              <StatCard key={key} label={`Total COGS · ${VALUE_LABELS[key]}`} value={formatINR(grandTotal(key))} sub="pre + post" />
            ))}
          </StatStrip>
        </>
      ) : (
        <EmptyState icon="calculator" title="Select a version or create one" description="Each version applies from its effective date." />
      )}

      <Dialog
        open={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        size="sm"
        tone="negative"
        icon="triangle-alert"
        title="Delete this version?"
        description="P&L recomputes for the dates it covered."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => { const id = confirmDeleteId; setConfirmDeleteId(null); if (id) handleDelete(id); }}>Delete version</Button>
          </>
        }
      />
    </>
  );
}
