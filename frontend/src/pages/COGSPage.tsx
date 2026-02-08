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
  percentageType: 'included' | 'excluded';
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
              percentageType: field.percentageType ?? 'excluded', // Default to excluded for backwards compatibility
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
      percentageType: 'excluded',
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

  const handleUpdatePercentageType = (id: string, percentageType: 'included' | 'excluded') => {
    setCostFields(costFields.map(field => 
      field.id === id ? { ...field, percentageType } : field
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

      {/* Editable Table View */}
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
            {costFields.map((field) => (
              <tr key={field.id}>
                <td className={styles['name-cell']}>{field.name}</td>
                <td>
                  <select
                    value={field.type}
                    onChange={(e) => handleUpdateType(field.id, e.target.value as 'cogs' | 'ndr' | 'both')}
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
                      onChange={(e) => handleUpdateCalculationType(field.id, e.target.value as 'fixed' | 'percentage')}
                      className={styles['table-select-small']}
                    >
                      <option value="fixed">₹</option>
                      <option value="percentage">%</option>
                    </select>
                    {field.calculationType === 'percentage' && (
                      <select
                        value={field.percentageType}
                        onChange={(e) => handleUpdatePercentageType(field.id, e.target.value as 'included' | 'excluded')}
                        className={styles['table-select-small']}
                      >
                        <option value="excluded">Ex</option>
                        <option value="included">In</option>
                      </select>
                    )}
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.smallPrepaidValue}
                    onChange={(e) => handleUpdateValue(field.id, 'small', 'prepaid', parseFloat(e.target.value) || 0)}
                    className={styles['table-input']}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.smallCODValue}
                    onChange={(e) => handleUpdateValue(field.id, 'small', 'cod', parseFloat(e.target.value) || 0)}
                    className={styles['table-input']}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.largePrepaidValue}
                    onChange={(e) => handleUpdateValue(field.id, 'large', 'prepaid', parseFloat(e.target.value) || 0)}
                    className={styles['table-input']}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={field.largeCODValue}
                    onChange={(e) => handleUpdateValue(field.id, 'large', 'cod', parseFloat(e.target.value) || 0)}
                    className={styles['table-input']}
                  />
                </td>
                <td>
                  <button
                    onClick={() => handleDeleteField(field.id)}
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
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className={styles['totals-label']}>Total Costs</td>
              <td className={styles['totals-cell']}>₹{calculateTotal('small', 'prepaid').toFixed(0)}</td>
              <td className={styles['totals-cell']}>₹{calculateTotal('small', 'cod').toFixed(0)}</td>
              <td className={styles['totals-cell']}>₹{calculateTotal('large', 'prepaid').toFixed(0)}</td>
              <td className={styles['totals-cell']}>₹{calculateTotal('large', 'cod').toFixed(0)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
