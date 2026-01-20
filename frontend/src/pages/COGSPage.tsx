import { useState, useEffect } from 'react';
import { api } from '../services/api';
import styles from './COGSPage.module.css';

interface CostField {
  id: string;
  name: string;
  smallValue: number;
  largeValue: number;
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
        // Ensure all fields have type and calculationType properties (for backwards compatibility)
        const fieldsWithDefaults = config.fields.map(field => ({
          ...field,
          type: field.type ?? 'cogs',
          calculationType: field.calculationType ?? 'fixed',
        }));
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
      smallValue: 0,
      largeValue: 0,
      type: 'cogs',
      calculationType: 'fixed',
    };

    setCostFields([...costFields, newField]);
    setNewFieldName('');
  };

  const handleDeleteField = (id: string) => {
    setCostFields(costFields.filter(field => field.id !== id));
  };

  const handleUpdateSmallValue = (id: string, value: number) => {
    setCostFields(costFields.map(field => 
      field.id === id ? { ...field, smallValue: value } : field
    ));
  };

  const handleUpdateLargeValue = (id: string, value: number) => {
    setCostFields(costFields.map(field => 
      field.id === id ? { ...field, largeValue: value } : field
    ));
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

  const calculateTotal = (variant: 'small' | 'large') => {
    return costFields.reduce((sum, field) => 
      sum + (variant === 'small' ? field.smallValue : field.largeValue), 
    0);
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

      {/* Split View */}
      <div className={styles['split-container']}>
        {/* Small Book */}
        <div className={styles['variant-column']}>
          <div className={styles['variant-header']}>
            <h3>Small Book</h3>
            <div className={styles['total-badge']}>
              Total: ₹{calculateTotal('small').toFixed(2)}
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
                    value={field.smallValue}
                    onChange={(e) => handleUpdateSmallValue(field.id, parseFloat(e.target.value) || 0)}
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

        {/* Large Book */}
        <div className={styles['variant-column']}>
          <div className={styles['variant-header']}>
            <h3>Large Book</h3>
            <div className={styles['total-badge']}>
              Total: ₹{calculateTotal('large').toFixed(2)}
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
                    value={field.largeValue}
                    onChange={(e) => handleUpdateLargeValue(field.id, parseFloat(e.target.value) || 0)}
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
      </div>
    </div>
  );
}
