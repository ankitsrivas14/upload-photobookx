import { useState, useEffect } from 'react';
import { api } from '../services/api';
import styles from './AbandonedCheckoutsPage.module.css';
import toast from 'react-hot-toast';

export default function AbandonedCheckoutsPage() {
  const [textData, setTextData] = useState('');
  const [checkouts, setCheckouts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateMessage, setTemplateMessage] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);

  useEffect(() => {
    loadCheckouts();
    loadTemplate();
  }, []);

  const loadTemplate = async () => {
    try {
      const response = await api.getWhatsAppTemplate();
      if (response.success && response.message) {
        setTemplateMessage(response.message);
      }
    } catch (err) {
      console.error('Failed to load template:', err);
    }
  };

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const response = await api.saveWhatsAppTemplate(templateMessage);
      if (response.success) {
        toast.success('Template saved successfully');
        setIsTemplateModalOpen(false);
      } else {
        toast.error(response.error || 'Failed to save template');
      }
    } catch (err) {
      toast.error('An error occurred while saving the template');
    } finally {
      setSavingTemplate(false);
    }
  };

  const generateWhatsAppLink = (phone: string, name: string) => {
    const cleanPhone = phone.replace('+', '');
    if (!templateMessage.trim()) return `https://api.whatsapp.com/send?phone=${cleanPhone}`;
    
    // Replace [Name] or [name] with the actual name
    const personalizedMessage = templateMessage.replace(/\[name\]/gi, name);
    return `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(personalizedMessage)}`;
  };

  const loadCheckouts = async () => {
    setFetching(true);
    try {
      const response = await api.getAbandonedCheckouts();
      if (response.success && response.checkouts) {
        setCheckouts(response.checkouts);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load abandoned checkouts');
    } finally {
      setFetching(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: 'pending' | 'message_sent' | 'not_required') => {
    try {
      const response = await api.updateAbandonedCheckoutStatus(id, newStatus);
      if (response.success && response.checkout) {
        setCheckouts(prev => prev.map(c => c._id === id ? response.checkout : c));
        // Remove yellow highlight if this was the active row
        if (activeRowId === id) {
          setActiveRowId(null);
        }
      }
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const handleSubmit = async () => {
    if (!textData.trim()) {
      toast.error('Please paste some data first');
      return;
    }

    setLoading(true);
    try {
      const response = await api.submitAbandonedCheckoutsData(textData);
      if (response.success) {
        toast.success(response.message || 'Processed successfully');
        setTextData(''); // Clear the textarea
        loadCheckouts(); // Reload the table
      } else {
        toast.error(response.error || 'Failed to process data');
      }
    } catch (err) {
      console.error(err);
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.titles}>
            <h1>Abandoned Checkouts</h1>
            <p className={styles.subtitle}>Paste your raw Shopify abandoned checkout data to extract leads</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button 
            className={styles.templateBtn}
            onClick={() => setIsTemplateModalOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            Message Template
          </button>
        </div>
      </header>

      <div className={styles.content}>
        <div className={styles.inputSection}>
          <textarea
            className={styles.textarea}
            placeholder="Paste your raw Shopify abandoned checkout data here...&#10;Example:&#10;13 May 2026 at 19:02&#10;+919936207777&#10;Jyoti agarwal&#10;Payment Page..."
            value={textData}
            onChange={(e) => setTextData(e.target.value)}
          />
          <button 
            className={styles.submitBtn} 
            onClick={handleSubmit} 
            disabled={loading || !textData.trim()}
          >
            {loading ? 'Processing...' : 'Extract & Save'}
          </button>
        </div>

        <div className={styles.tableSection}>
          <h2>Extracted Leads ({checkouts.length})</h2>
          
          {fetching ? (
            <div className={styles.loadingState}>Loading...</div>
          ) : checkouts.length === 0 ? (
            <div className={styles.emptyState}>No abandoned checkouts extracted yet.</div>
          ) : (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Name</th>
                    <th>Phone Number</th>
                    <th>Action</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {checkouts.map((checkout, index) => (
                    <tr 
                      key={checkout._id || index} 
                      className={activeRowId === (checkout._id || index.toString()) ? styles.activeRow : ''}
                    >
                      <td>{checkout.dateStr}</td>
                      <td className={styles.nameCell}>{checkout.name}</td>
                      <td className={styles.phoneCell}>
                        {checkout.phone}
                      </td>
                      <td className={styles.actionCell}>
                        {checkout.status === 'pending' ? (
                          <a 
                            href={generateWhatsAppLink(checkout.phone, checkout.name)} 
                            target="_blank" 
                            rel="noreferrer" 
                            className={styles.waIconButton}
                            title="Send WhatsApp Message"
                            onClick={() => setActiveRowId(checkout._id || index.toString())}
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.06-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/>
                            </svg>
                            WhatsApp
                          </a>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                      <td>
                        {checkout.status === 'pending' ? (
                          <div className={styles.statusActions}>
                            <button 
                              className={styles.tickBtn} 
                              onClick={() => handleUpdateStatus(checkout._id, 'message_sent')}
                              title="Mark as Sent"
                            >
                              ✓
                            </button>
                            <button 
                              className={styles.crossBtn} 
                              onClick={() => handleUpdateStatus(checkout._id, 'not_required')}
                              title="Mark as Not Required"
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <span className={`${styles.statusLabel} ${styles[checkout.status]}`}>
                            {checkout.status === 'message_sent' ? 'Done' : 'Ignored'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {isTemplateModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsTemplateModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>WhatsApp Message Template</h2>
              <button className={styles.closeBtn} onClick={() => setIsTemplateModalOpen(false)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalHint}>
                Use <strong>[Name]</strong> as a placeholder for the customer's name. This message will be pre-filled when you click a phone number.
              </p>
              <textarea
                className={styles.templateTextarea}
                placeholder="Hi [Name], we noticed you left something in your cart..."
                value={templateMessage}
                onChange={(e) => setTemplateMessage(e.target.value)}
              />
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setIsTemplateModalOpen(false)}>Cancel</button>
              <button className={styles.saveBtn} onClick={handleSaveTemplate} disabled={savingTemplate}>
                {savingTemplate ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
