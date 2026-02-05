import { useState, useEffect } from 'react';
import { api } from '../services/api';
import styles from './COGSPage.module.css';

interface CostField {
  id: string;
  name: string;
  // Old structure (deprecated)
  smallValue?: number;
  largeValue?: number;
  // New structure with payment method support
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
}

export function COGSPage() {
  const [costFields, setCostFields] = useState<CostField[]>([]);
  const [newFieldName, setNewFieldName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConfiguration();
  }, []);

  const loadConfiguration = async () => {
    try {
      setIsLoading(true);
      const config = await api.getCOGSConfiguration();
      if (config && config.fields) {
        // Migrate old structure to new structure and ensure defaults
        const fieldsWithDefaults = config.fields.map(field => {
          // If old structure exists but not new, migrate
          const smallPrepaidValue = field.smallPrepaidValue ?? field.smallValue ?? 0;
          const smallCODValue = field.smallCODValue ?? field.smallValue ?? 0;
          const largePrepaidValue = field.largePrepaidValue ?? field.largeValue ?? 0;
          const largeCODValue = field.largeCODValue ?? field.largeValue ?? 0;
          
          return {
            ...field,
            smallPrepaidValue,
            smallCODValue,
            largePrepaidValue,
            largeCODValue,
            type: field.type ?? 'cogs',
            calculationType: field.calculationType ?? 'fixed',
          };
        });
        setCostFields(fieldsWithDefaults);
      }
    } catch (error) {
      console.error('Failed to load COGS configuration:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddField = () => {
    if (!newFieldName.trim()) return;

    const newField: CostField = {
      id: Date.now().toString(),
      name: newFieldName.trim(),
      smallPrepaidValue: 0,
      smallCODValue: 0,
      largePrepaidValue: 0,
      largeCODValue: 0,
      type: 'cogs',
      calculationType: 'fixed',
    };

    setCostFields([...costFields, newField]);
    setNewFieldName('');
  };

  const handleDeleteField = (id: string) => {
    setCostFields(costFields.filter(field => field.id !== id));
  };

  const handleUpdateValue = (id: string, variant: 'small' | 'large', paymentMethod: 'prepaid' | 'cod', value: number) => {
    setCostFields(costFields.map(field => {
      if (field.id !== id) return field;
      
      const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof CostField;
      return { ...field, [key]: value };
    }));
  };

  const handleUpdateType = (id: string, type: 'cogs' | 'ndr' | 'both') => {
    setCostFields(costFields.map(field => 
      field.id === id ? { ...field, type } : field
    ));
  };

  const handleUpdateCalculationType = (id: string, calculationType: 'fixed' | 'percentage') => {
    setCostFields(costFields.map(field => 
      field.id === id ? { ...field, calculationType } : field
    ));
  };

  const handleSaveConfiguration = async () => {
    try {
      setIsSaving(true);
      await api.saveCOGSConfiguration({ fields: costFields });
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Failed to save COGS configuration:', error);
      alert('Failed to save configuration. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const calculateTotal = (variant: 'small' | 'large', paymentMethod: 'prepaid' | 'cod') => {
    return costFields.reduce((sum, field) => {
      const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof CostField;
      return sum + (field[key] as number || 0);
    }, 0);
  };

  if (isLoading) {
    return (
      <div className={styles['loading-section']}>
        <div className={styles.spinner}></div>
        <p>Loading configuration...</p>
      </div>
    );
  }

  return (
    <div className={styles['cogs-page']}>
      <div className={styles['page-header']}>
        <div>
          <h2>COGS Configuration</h2>
          <p>Configure cost components for Small and Large photobooks</p>
        </div>
        <button 
          onClick={handleSaveConfiguration}
          className={styles['save-btn']}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* Add New Field */}
      <div className={styles['add-field-section']}>
        <input
          type="text"
          placeholder="Enter cost component name (e.g., Printing Cost)"
          value={newFieldName}
          onChange={(e) => setNewFieldName(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleAddField()}
          className={styles['field-name-input']}
        />
        <button 
          onClick={handleAddField}
          className={styles['add-field-btn']}
          disabled={!newFieldName.trim()}
        >
          + Add Cost Field
        </button>
      </div>

      {/* 4-Column View: Small Prepaid, Small COD, Large Prepaid, Large COD */}
      <div className={styles['grid-container']}>
        {/* Small Prepaid */}
        <div className={styles['variant-column']}>
          <div className={styles['variant-header']}>
            <h3>Small - Prepaid</h3>
            <div className={styles['total-badge']}>
              Total: ₹{calculateTotal('small', 'prepaid').toFixed(2)}
            </div>
          </div>
          <div className={styles['fields-list']}>
            {costFields.map((field) => (
              <div key={field.id} className={styles['field-item']}>
                <div className={styles['field-header']}>
                  <label className={styles['field-label']}>{field.name}</label>
                  <select
                    value={field.type}
                    onChange={(e) => handleUpdateType(field.id, e.target.value as 'cogs' | 'ndr' | 'both')}
                    className={styles['type-select']}
                  >
                    <option value="cogs">COGS Only</option>
                    <option value="ndr">NDR Only</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div className={styles['field-input-group']}>
                  <select
                    value={field.calculationType}
                    onChange={(e) => handleUpdateCalculationType(field.id, e.target.value as 'fixed' | 'percentage')}
                    className={styles['calc-type-select']}
                    title="Calculation type"
                  >
                    <option value="fixed">₹</option>
                    <option value="percentage">%</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.smallPrepaidValue}
                    onChange={(e) => handleUpdateValue(field.id, 'small', 'prepaid', parseFloat(e.target.value) || 0)}
                    className={styles['field-input']}
                    placeholder={field.calculationType === 'percentage' ? 'Enter %' : 'Enter ₹'}
                  />
                  <button
                    onClick={() => handleDeleteField(field.id)}
                    className={styles['delete-field-btn']}
                    title="Delete field"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Small COD */}
        <div className={styles['variant-column']}>
          <div className={styles['variant-header']}>
            <h3>Small - COD</h3>
            <div className={styles['total-badge']}>
              Total: ₹{calculateTotal('small', 'cod').toFixed(2)}
            </div>
          </div>
          <div className={styles['fields-list']}>
            {costFields.map((field) => (
              <div key={field.id} className={styles['field-item']}>
                <div className={styles['field-header']}>
                  <label className={styles['field-label']}>{field.name}</label>
                  <select
                    value={field.type}
                    onChange={(e) => handleUpdateType(field.id, e.target.value as 'cogs' | 'ndr' | 'both')}
                    className={styles['type-select']}
                  >
                    <option value="cogs">COGS Only</option>
                    <option value="ndr">NDR Only</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div className={styles['field-input-group']}>
                  <select
                    value={field.calculationType}
                    onChange={(e) => handleUpdateCalculationType(field.id, e.target.value as 'fixed' | 'percentage')}
                    className={styles['calc-type-select']}
                    title="Calculation type"
                  >
                    <option value="fixed">₹</option>
                    <option value="percentage">%</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.smallCODValue}
                    onChange={(e) => handleUpdateValue(field.id, 'small', 'cod', parseFloat(e.target.value) || 0)}
                    className={styles['field-input']}
                    placeholder={field.calculationType === 'percentage' ? 'Enter %' : 'Enter ₹'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Large Prepaid */}
        <div className={styles['variant-column']}>
          <div className={styles['variant-header']}>
            <h3>Large - Prepaid</h3>
            <div className={styles['total-badge']}>
              Total: ₹{calculateTotal('large', 'prepaid').toFixed(2)}
            </div>
          </div>
          <div className={styles['fields-list']}>
            {costFields.map((field) => (
              <div key={field.id} className={styles['field-item']}>
                <div className={styles['field-header']}>
                  <label className={styles['field-label']}>{field.name}</label>
                  <select
                    value={field.type}
                    onChange={(e) => handleUpdateType(field.id, e.target.value as 'cogs' | 'ndr' | 'both')}
                    className={styles['type-select']}
                  >
                    <option value="cogs">COGS Only</option>
                    <option value="ndr">NDR Only</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div className={styles['field-input-group']}>
                  <select
                    value={field.calculationType}
                    onChange={(e) => handleUpdateCalculationType(field.id, e.target.value as 'fixed' | 'percentage')}
                    className={styles['calc-type-select']}
                    title="Calculation type"
                  >
                    <option value="fixed">₹</option>
                    <option value="percentage">%</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.largePrepaidValue}
                    onChange={(e) => handleUpdateValue(field.id, 'large', 'prepaid', parseFloat(e.target.value) || 0)}
                    className={styles['field-input']}
                    placeholder={field.calculationType === 'percentage' ? 'Enter %' : 'Enter ₹'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Large COD */}
        <div className={styles['variant-column']}>
          <div className={styles['variant-header']}>
            <h3>Large - COD</h3>
            <div className={styles['total-badge']}>
              Total: ₹{calculateTotal('large', 'cod').toFixed(2)}
            </div>
          </div>
          <div className={styles['fields-list']}>
            {costFields.map((field) => (
              <div key={field.id} className={styles['field-item']}>
                <div className={styles['field-header']}>
                  <label className={styles['field-label']}>{field.name}</label>
                  <select
                    value={field.type}
                    onChange={(e) => handleUpdateType(field.id, e.target.value as 'cogs' | 'ndr' | 'both')}
                    className={styles['type-select']}
                  >
                    <option value="cogs">COGS Only</option>
                    <option value="ndr">NDR Only</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div className={styles['field-input-group']}>
                  <select
                    value={field.calculationType}
                    onChange={(e) => handleUpdateCalculationType(field.id, e.target.value as 'fixed' | 'percentage')}
                    className={styles['calc-type-select']}
                    title="Calculation type"
                  >
                    <option value="fixed">₹</option>
                    <option value="percentage">%</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.largeCODValue}
                    onChange={(e) => handleUpdateValue(field.id, 'large', 'cod', parseFloat(e.target.value) || 0)}
                    className={styles['field-input']}
                    placeholder={field.calculationType === 'percentage' ? 'Enter %' : 'Enter ₹'}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
