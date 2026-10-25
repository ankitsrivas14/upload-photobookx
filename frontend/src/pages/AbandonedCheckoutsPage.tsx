import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Badge, Button, Card, Dialog, EmptyState, Icon, PageHeader, Skeleton, StatCard, StatStrip, TextField } from '../components/ui/pbx';
import styles from './AbandonedCheckoutsPage.module.css';
import toast from 'react-hot-toast';

type LeadStatus = 'pending' | 'message_sent' | 'not_required';

interface AbandonedCheckout {
  _id: string;
  dateStr: string;
  name: string;
  phone: string;
  status: LeadStatus;
}

const STATUS_BADGE: Record<LeadStatus, { label: string; tone: 'caution' | 'positive' | 'neutral' }> = {
  pending: { label: 'To message', tone: 'caution' },
  message_sent: { label: 'Messaged', tone: 'positive' },
  not_required: { label: 'Not needed', tone: 'neutral' },
};

export default function AbandonedCheckoutsPage() {
  const [textData, setTextData] = useState('');
  const [checkouts, setCheckouts] = useState<AbandonedCheckout[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [templateMessage, setTemplateMessage] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  // The row whose WhatsApp link was just opened, highlighted until its status is set
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
    } catch {
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
        setCheckouts(response.checkouts as AbandonedCheckout[]);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load abandoned checkouts');
    } finally {
      setFetching(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: LeadStatus) => {
    try {
      const response = await api.updateAbandonedCheckoutStatus(id, newStatus);
      if (response.success && response.checkout) {
        setCheckouts(prev => prev.map(c => c._id === id ? response.checkout : c));
        // Clear the highlight if this was the active row
        if (activeRowId === id) {
          setActiveRowId(null);
        }
      }
    } catch {
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

  const counts = checkouts.reduce(
    (acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }),
    { pending: 0, message_sent: 0, not_required: 0 } as Record<LeadStatus, number>,
  );

  return (
    <div className={styles.page}>
      <PageHeader
        title="Abandoned checkouts"
        description="Paste Shopify's abandoned checkouts to extract leads, then message them on WhatsApp."
        actions={
          <Button size="sm" icon="message-circle" onClick={() => setIsTemplateModalOpen(true)}>
            WhatsApp template
          </Button>
        }
      />

      <StatStrip>
        <StatCard label="Leads" value={fetching ? '—' : checkouts.length.toLocaleString('en-IN')} />
        <StatCard label="To message" value={fetching ? '—' : counts.pending.toLocaleString('en-IN')} tone={counts.pending > 0 ? 'caution' : 'neutral'} />
        <StatCard label="Messaged" value={fetching ? '—' : counts.message_sent.toLocaleString('en-IN')} />
        <StatCard label="Not needed" value={fetching ? '—' : counts.not_required.toLocaleString('en-IN')} />
      </StatStrip>

      <div className={styles.row}>
        <Card
          title="Paste from Shopify"
          eyebrow="raw abandoned checkout text"
          footer={
            <Button variant="primary" size="sm" onClick={handleSubmit} loading={loading} disabled={!textData.trim()}>
              {loading ? 'Extracting…' : 'Extract leads'}
            </Button>
          }
        >
          <TextField
            multiline
            rows={14}
            aria-label="Abandoned checkout data from Shopify"
            placeholder={'Paste your raw Shopify abandoned checkout data here…\nExample:\n13 May 2026 at 19:02\n+919936207777\nJyoti agarwal\nPayment Page…'}
            value={textData}
            onChange={(e) => setTextData(e.target.value)}
          />
        </Card>

        <Card className={styles.wide} title="Extracted leads" eyebrow={fetching ? undefined : `${checkouts.length.toLocaleString('en-IN')} leads`} padding="sm">
          {fetching ? (
            <Skeleton lines={6} />
          ) : checkouts.length === 0 ? (
            <EmptyState size="sm" icon="user-x" title="No leads yet" description="Paste abandoned checkouts from Shopify to extract them." />
          ) : (
            <div className="pbx-table">
              <div className="pbx-table__scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Name</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="pbx-sr">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkouts.map((checkout, index) => {
                      const rowId = checkout._id || index.toString();
                      const badge = STATUS_BADGE[checkout.status] ?? STATUS_BADGE.pending;
                      return (
                        <tr key={rowId} className={activeRowId === rowId ? 'is-selected' : undefined}>
                          <td className={styles.date}>{checkout.dateStr}</td>
                          <td className={styles.name}>{checkout.name}</td>
                          <td className="pbx-mono">{checkout.phone}</td>
                          <td><Badge size="sm" tone={badge.tone}>{badge.label}</Badge></td>
                          <td>
                            {checkout.status === 'pending' ? (
                              <div className={styles.actions}>
                                <a
                                  href={generateWhatsAppLink(checkout.phone, checkout.name)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="pbx-btn pbx-btn--secondary pbx-btn--sm"
                                  onClick={() => setActiveRowId(rowId)}
                                >
                                  <Icon name="message-circle" size={14} />
                                  Send on WhatsApp
                                </a>
                                <Button size="sm" variant="ghost" iconOnly icon="check" tooltip="Mark as messaged" onClick={() => handleUpdateStatus(checkout._id, 'message_sent')}>
                                  {`Mark ${checkout.name} as messaged`}
                                </Button>
                                <Button size="sm" variant="ghost" iconOnly icon="x" tooltip="Mark as not needed" onClick={() => handleUpdateStatus(checkout._id, 'not_required')}>
                                  {`Mark ${checkout.name} as not needed`}
                                </Button>
                              </div>
                            ) : (
                              <div className={styles.actions}><span className="pbx-amount--none">—</span></div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Dialog
        open={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title="WhatsApp template"
        description="Pre-filled when you send a lead a WhatsApp message."
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsTemplateModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveTemplate} loading={savingTemplate}>Save template</Button>
          </>
        }
      >
        <TextField
          multiline
          rows={7}
          label="Message"
          hint={<>Write <strong>[Name]</strong> where the customer's name should go.</>}
          placeholder="Hi [Name], we noticed you left something in your cart…"
          value={templateMessage}
          onChange={(e) => setTemplateMessage(e.target.value)}
        />
      </Dialog>
    </div>
  );
}
