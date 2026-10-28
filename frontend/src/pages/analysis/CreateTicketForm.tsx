import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../../services/api';
import { Badge, Button, Card, Icon, OptionCard, TextField } from '../../components/ui/pbx';
import styles from '../AnalysisPage.module.css';

interface OrderSuggestion {
    name: string;
    customerName: string;
    customerPhone?: string;
    shopifyOrderId?: string | number;
}

export function CreateTicketForm() {
    const navigate = useNavigate();
    const dropdownRef = useRef<HTMLDivElement>(null);
    
    const [orderNumber, setOrderNumber] = useState('');
    const [suggestions, setSuggestions] = useState<OrderSuggestion[]>([]);
    const [selectedOrder, setSelectedOrder] = useState<OrderSuggestion | null>(null);
    const [issueType, setIssueType] = useState('');
    const [aiMessage, setAiMessage] = useState('');
    
    const [isSearching, setIsSearching] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [customerPhone, setCustomerPhone] = useState('');

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setShowSuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleFetchOrder = async () => {
        const query = orderNumber.trim();
        if (query.length < 2) {
            toast.error('Please enter a valid order number or name');
            return;
        }

        setIsSearching(true);
        setSelectedOrder(null);
        setSuggestions([]);
        setShowSuggestions(false);

        try {
            // First try direct fetch from Shopify (best for exact order numbers to avoid cache misses)
            const isLikelyOrderNumber = /^#?\d+$/.test(query);
            
            if (isLikelyOrderNumber) {
                const res = await api.getOrder(query);
                if (res.success && res.order) {
                    const fetchedOrder = {
                        name: res.order.name,
                        customerName: res.order.customerName || 'N/A',
                        customerPhone: res.order.customerPhone || '',
                        shopifyOrderId: res.order.id
                    };
                    setSelectedOrder(fetchedOrder);
                    if (fetchedOrder.customerPhone && fetchedOrder.customerPhone !== 'xxxxxxxxxx') {
                        setCustomerPhone(fetchedOrder.customerPhone);
                    } else {
                        setCustomerPhone('');
                    }
                    setIsSearching(false);
                    return;
                }
            }

            // Fallback to search (for names or if direct fetch fails)
            const res = await api.searchOrders(query);
            if (res.success && res.orders && res.orders.length > 0) {
                setSuggestions(res.orders);
                setShowSuggestions(true);
            } else {
                toast.error('No orders found');
            }
        } catch (err) {
            console.error('Search/Fetch error:', err);
            toast.error('Error fetching order');
        } finally {
            setIsSearching(false);
        }
    };

    const handleSelectOrder = async (order: OrderSuggestion) => {
        setSelectedOrder(order);
        setOrderNumber(order.name);
        setCustomerPhone(order.customerPhone || '');
        setShowSuggestions(false);

        // Fetch full details to get Shopify ID and phone number if not available
        try {
            const res = await api.getOrder(order.name);
            if (res.success && res.order) {
                const refreshedOrder = {
                    name: res.order.name,
                    customerName: res.order.customerName || order.customerName,
                    customerPhone: res.order.customerPhone || order.customerPhone || '',
                    shopifyOrderId: res.order.id
                };
                setSelectedOrder(refreshedOrder);
                if (refreshedOrder.customerPhone && (!customerPhone || customerPhone === 'xxxxxxxxxx')) {
                    setCustomerPhone(refreshedOrder.customerPhone);
                }
            }
        } catch {
            console.warn('Failed to fetch full order details upon selection');
        }
    };

    const handlePhoneChange = (val: string) => {
        // Extract 10-digit phone number from long pasted strings
        if (val.length > 15) {
            const match = val.match(/(?:\+91|91)?[6789]\d{9}/);
            // If match found, take the last 10 digits
            if (match) {
                const digits = match[0].replace(/[^\d]/g, '');
                const phone = digits.length > 10 ? digits.slice(-10) : digits;
                setCustomerPhone(phone);
                return;
            }
        }
        setCustomerPhone(val);
    };

    const handleSyncOrders = async () => {
        setIsSearching(true);
        try {
            await api.getOrders(10000, true);
            toast.success('Shopify Sync Complete!');
            if (orderNumber.trim().length >= 2) {
                await handleFetchOrder();
            }
        } catch {
            toast.error('Sync failed');
        } finally {
            setIsSearching(false);
        }
    };

    const handleGenerateAiMessage = async () => {
        if (!selectedOrder) return;
        setIsGenerating(true);
        try {
            // First try to fetch actual phone and name from Shopify/Shiprocket if missing
            if (!customerPhone || selectedOrder.customerName === 'N/A') {
                const orderRes = await api.getOrder(selectedOrder.name);
                if (orderRes.success && orderRes.order) {
                    const updatedOrder = {
                        name: orderRes.order.name,
                        customerName: orderRes.order.customerName || selectedOrder.customerName,
                        customerPhone: orderRes.order.customerPhone || selectedOrder.customerPhone || customerPhone,
                        shopifyOrderId: orderRes.order.id
                    };
                    setSelectedOrder(updatedOrder);
                    if (updatedOrder.customerPhone && !customerPhone) {
                        setCustomerPhone(updatedOrder.customerPhone);
                    }
                }
            }

            let res;
            if (issueType === 'multiple_orders') {
                res = await api.generateMultipleOrdersMessage(selectedOrder.customerName, selectedOrder.name);
            } else if (issueType === 'incomplete_address') {
                res = await api.generateIncompleteAddressMessage(selectedOrder.customerName, selectedOrder.name);
            }

            if (res && res.success && res.message) {
                setAiMessage(res.message);
                toast.success('AI Message Generated');
            } else {
                toast.error('Failed to generate AI message');
            }
        } catch (err) {
            toast.error(errorMessage(err, 'Failed to generate AI message'));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCopyLink = (link: string) => {
        navigator.clipboard.writeText(link);
        toast.success('Link copied to clipboard');
    };

    const getWaLink = () => {
        if (!customerPhone) return '';
        const cleanPhone = customerPhone.replace(/[^\d]/g, '');
        const finalPhone = (cleanPhone.length === 10) ? `91${cleanPhone}` : cleanPhone;
        // Check if phone was masked (xxxxxxxxxx)
        if (cleanPhone.includes('x') || !cleanPhone) return 'https://wa.me/+';
        return `https://wa.me/+${finalPhone}`;
    };

    const handleSubmit = async () => {
        if (!selectedOrder || !aiMessage) return;
        setIsSubmitting(true);
        try {
            const res = await api.createTicket({
                orderNumber: selectedOrder.name,
                customerName: selectedOrder.customerName,
                generatedMessage: aiMessage,
                status: 'open',
                currentStatus: issueType,
                activities: [],
                awb: 'MANUAL-' + selectedOrder.name,
                courierName: 'Manual'
            });

            if (res.success) {
                toast.success('Ticket created successfully');
                navigate('/admin/analysis/tickets');
            } else {
                toast.error(res.error || 'Failed to create ticket');
            }
        } catch (err) {
            toast.error(errorMessage(err, 'Error creating ticket'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const phoneMissing = !customerPhone || customerPhone.includes('x');

    return (
        <Card
            className={styles.formCard}
            title="New support ticket"
            eyebrow="for an order that needs the customer's help"
            actions={<Button size="sm" variant="ghost" icon="chevron-left" onClick={() => navigate('/admin/analysis/tickets')}>Back to tickets</Button>}
        >
            <div className={styles.stack}>
                <div className={styles.searchWrap} ref={dropdownRef}>
                    <div className={styles.searchRow}>
                        <TextField
                            label="Order"
                            placeholder="Order number or customer name"
                            value={orderNumber}
                            onChange={(e) => setOrderNumber(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFetchOrder()}
                            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                        />
                        <Button onClick={handleFetchOrder} loading={isSearching}>Fetch</Button>
                        <Button variant="ghost" icon="refresh-cw" onClick={handleSyncOrders} disabled={isSearching}>Sync from Shopify</Button>
                    </div>

                    {showSuggestions && (suggestions.length > 0 || isSearching) && (
                        <ul className={styles.suggest} role="listbox" aria-label="Matching orders">
                            {suggestions.length > 0 ? suggestions.map((s, idx) => (
                                <li key={idx}>
                                    <button type="button" role="option" aria-selected={false} onClick={() => handleSelectOrder(s)}>
                                        <span className="pbx-mono">{s.name}</span>
                                        <span className={styles.muted}>{s.customerName}</span>
                                    </button>
                                </li>
                            )) : !isSearching && (
                                <li className={styles.muted}>{`No orders found for "${orderNumber}"`}</li>
                            )}
                        </ul>
                    )}
                </div>

                {selectedOrder && !showSuggestions && (
                    <div className={styles.customer}>
                        <div className={styles.customerHead}>
                            <div>
                                <div className={styles.metaLabel}>Selected customer</div>
                                <div className={styles.customerName}>{selectedOrder.customerName}</div>
                            </div>
                            {phoneMissing ? (
                                <Badge tone="caution">Needs phone number</Badge>
                            ) : (
                                <Badge tone="positive">Data verified</Badge>
                            )}
                        </div>
                        {selectedOrder.shopifyOrderId ? (
                            <a
                                className={styles.link}
                                href={`https://admin.shopify.com/store/c3532f-a9/orders/${selectedOrder.shopifyOrderId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <Icon name="external-link" size={13} />
                                View the order in Shopify admin
                            </a>
                        ) : (
                            <span className={styles.muted}>Fetching the Shopify link…</span>
                        )}
                        <TextField
                            label="Phone, or the address from Shopify"
                            placeholder="Paste the address block from Shopify admin"
                            hint="The phone number is picked out of a pasted address."
                            value={customerPhone === 'xxxxxxxxxx' ? '' : customerPhone}
                            onChange={(e) => handlePhoneChange(e.target.value)}
                            error={phoneMissing ? 'No phone number yet' : undefined}
                        />
                    </div>
                )}

                <div className={styles.field}>
                    <span className={styles.fieldLabel}>Issue</span>
                    <div className={styles.options} role="radiogroup" aria-label="Issue">
                        <OptionCard
                            name="issueType"
                            value="incomplete_address"
                            checked={issueType === 'incomplete_address'}
                            onChange={() => setIssueType('incomplete_address')}
                            title="Incomplete address"
                            description="Ask the customer for the missing parts of the address."
                        />
                        <OptionCard
                            name="issueType"
                            value="multiple_orders"
                            checked={issueType === 'multiple_orders'}
                            onChange={() => setIssueType('multiple_orders')}
                            title="Multiple orders"
                            description="Check with a customer who placed more than one order."
                        />
                    </div>
                </div>

                <div>
                    <Button icon="sparkles" onClick={handleGenerateAiMessage} loading={isGenerating} disabled={!selectedOrder || !issueType}>
                        Generate AI message
                    </Button>
                </div>

                {aiMessage && (
                    <div className={styles.stack}>
                        <TextField
                            multiline
                            rows={6}
                            label="WhatsApp message"
                            value={aiMessage}
                            onChange={(e) => setAiMessage(e.target.value)}
                        />
                        <div className={styles.waRow}>
                            <TextField size="sm" readOnly aria-label="WhatsApp link" value={getWaLink()} />
                            <Button size="sm" icon="copy" onClick={() => handleCopyLink(getWaLink())}>Copy link</Button>
                            <Button
                                size="sm"
                                icon="copy"
                                onClick={() => {
                                    navigator.clipboard.writeText(aiMessage);
                                    toast.success('Message copied to clipboard');
                                }}
                            >
                                Copy message
                            </Button>
                        </div>
                        {selectedOrder?.customerPhone && (
                            <a className={styles.link} href={`${getWaLink()}?text=${encodeURIComponent(aiMessage)}`} target="_blank" rel="noopener noreferrer">
                                <Icon name="message-circle" size={13} />
                                Open in WhatsApp with this message
                            </a>
                        )}
                    </div>
                )}

                <Button variant="primary" onClick={handleSubmit} loading={isSubmitting} disabled={!selectedOrder || !aiMessage} fullWidth>
                    {isSubmitting ? 'Creating ticket…' : 'Create ticket'}
                </Button>
            </div>
        </Card>
    );
}
