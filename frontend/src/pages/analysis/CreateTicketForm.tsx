import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../services/api';
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
    const [issueType, setIssueType] = useState('incomplete_address');
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

    const handleSearchOrder = async (val: string) => {
        setOrderNumber(val);
        if (val.length < 2) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        setIsSearching(true);
        try {
            const res = await api.searchOrders(val);
            if (res.success && res.orders) {
                setSuggestions(res.orders);
                setShowSuggestions(true);
            } else {
                setSuggestions([]);
                setShowSuggestions(true);
            }
        } catch (err) {
            console.error('Search error:', err);
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
        } catch (err) {
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
            if (orderNumber.length >= 2) {
                await handleSearchOrder(orderNumber);
            }
        } catch (e) {
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

            const res = await api.generateIncompleteAddressMessage(selectedOrder.customerName, selectedOrder.name);
            if (res.success && res.message) {
                setAiMessage(res.message);
                toast.success('AI Message Generated');
            }
        } catch (err) {
            toast.error('Failed to generate AI message');
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
            toast.error('Error creating ticket');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className={styles['analysis-content']} style={{ maxWidth: '700px', margin: '0 auto' }}>
            <div style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2.5rem' }}>
                    <Link 
                        to="/admin/analysis/tickets" 
                        style={{ 
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            width: '32px', height: '32px', borderRadius: '8px', backgroundColor: '#f1f5f9',
                            color: '#475569', textDecoration: 'none'
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </Link>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
                        Raise New Support Ticket
                    </h3>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Order Selection */}
                    <div style={{ position: 'relative' }} ref={dropdownRef}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', margin: 0 }}>
                                Order Number
                            </label>
                            <button 
                                onClick={handleSyncOrders}
                                style={{ background: 'none', border: 'none', color: '#7c3aed', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                            >
                                🔄 Sync from Shopify
                            </button>
                        </div>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                value={orderNumber}
                                onChange={(e) => handleSearchOrder(e.target.value)}
                                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                                placeholder="Order Number or Customer Name"
                                style={{ 
                                    width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', 
                                    border: '1px solid #e2e8f0', fontSize: '0.95rem', outline: 'none'
                                }}
                            />
                            {isSearching && (
                                <div style={{ position: 'absolute', right: '12px', top: '10px' }}>
                                    <div className={styles.spinner} style={{ width: '20px', height: '20px', borderWidth: '2px' }}></div>
                                </div>
                            )}
                        </div>

                        {selectedOrder && !showSuggestions && (
                            <div style={{ 
                                marginTop: '1.25rem', padding: '1.25rem', 
                                background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', 
                                borderRadius: '12px', border: '1px solid #e2e8f0',
                                boxShadow: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.5)',
                                display: 'flex', flexDirection: 'column', gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>Selected Customer</div>
                                        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '1.1rem' }}>{selectedOrder.customerName}</div>
                                    </div>
                                    {customerPhone && !customerPhone.includes('x') ? (
                                        <span style={{ fontSize: '0.7rem', color: '#047857', fontWeight: 700, backgroundColor: '#d1fae5', padding: '4px 8px', borderRadius: '6px', border: '1px solid #a7f3d0' }}>DATA VERIFIED</span>
                                    ) : (
                                        <span style={{ fontSize: '0.7rem', color: '#b45309', fontWeight: 700, backgroundColor: '#ffedd5', padding: '4px 8px', borderRadius: '6px', border: '1px solid #fed7aa' }}>NEEDS PHONE NUMBER</span>
                                    )}
                                </div>
                                
                                {selectedOrder.shopifyOrderId ? (
                                    <a 
                                        href={`https://admin.shopify.com/store/c3532f-a9/orders/${selectedOrder.shopifyOrderId}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ 
                                            fontSize: '0.8rem', color: '#2563eb', display: 'inline-flex', 
                                            alignItems: 'center', gap: '0.4rem', textDecoration: 'none',
                                            fontWeight: 600, width: 'fit-content'
                                        }}
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                            <polyline points="15 3 21 3 21 9" />
                                            <line x1="10" y1="14" x2="21" y2="3" />
                                        </svg>
                                        View Order in Shopify Admin
                                    </a>
                                ) : (
                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>Fetching Shopify link...</div>
                                )}

                                <div style={{ marginTop: '0.25rem' }}>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600, marginBottom: '0.4rem' }}>Verify or Paste Address from Shopify</div>
                                    <input 
                                        type="text"
                                        placeholder="Paste address block here (e.g. from Shopify Admin)"
                                        value={customerPhone === 'xxxxxxxxxx' ? '' : customerPhone}
                                        onChange={(e) => handlePhoneChange(e.target.value)}
                                        style={{ 
                                            padding: '0.75rem', fontSize: '0.95rem', width: '100%', 
                                            borderRadius: '8px', border: '2px solid',
                                            borderColor: customerPhone.includes('x') || !customerPhone ? '#fbbf24' : '#e2e8f0',
                                            backgroundColor: '#fff',
                                            transition: 'all 0.2s ease', outline: 'none',
                                            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                                        }}
                                        onFocus={(e) => (e.target.style.borderColor = '#7c3aed')}
                                        onBlur={(e) => (e.target.style.borderColor = customerPhone.includes('x') || !customerPhone ? '#fbbf24' : '#e2e8f0')}
                                    />
                                </div>
                            </div>
                        )}

                        {showSuggestions && (suggestions.length > 0 || isSearching) && (
                            <div style={{ 
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                                backgroundColor: '#fff', border: '1px solid #e2e8f0', borderRadius: '8px',
                                marginTop: '4px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                                maxHeight: '200px', overflowY: 'auto'
                            }}>
                                {suggestions.length > 0 ? suggestions.map((s, idx) => (
                                    <div 
                                        key={idx}
                                        onClick={() => handleSelectOrder(s)}
                                        style={{ 
                                            padding: '0.75rem 1rem', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                                            display: 'flex', justifyContent: 'space-between'
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                                    >
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{s.name}</span>
                                            <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{s.customerName}</span>
                                        </div>
                                    </div>
                                )) : !isSearching && (
                                    <div style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                                        No orders found for "{orderNumber}"
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Issue Type */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
                            Issue Type
                        </label>
                        <select
                            value={issueType}
                            onChange={(e) => setIssueType(e.target.value)}
                            style={{ 
                                width: '100%', padding: '0.75rem 1rem', borderRadius: '8px', 
                                border: '1px solid #e2e8f0', fontSize: '0.95rem', outline: 'none',
                                backgroundColor: '#fff'
                            }}
                        >
                            <option value="incomplete_address">Incomplete Address</option>
                        </select>
                    </div>

                    {/* AI Generator Button */}
                    <button
                        onClick={handleGenerateAiMessage}
                        disabled={!selectedOrder || isGenerating}
                        style={{ 
                            alignSelf: 'flex-start', padding: '0.6rem 1.2rem', borderRadius: '8px',
                            backgroundColor: selectedOrder ? '#7c3aed' : '#f1f5f9',
                            color: selectedOrder ? '#fff' : '#94a3b8',
                            border: 'none', fontSize: '0.875rem', fontWeight: 600, cursor: selectedOrder ? 'pointer' : 'default',
                            display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s'
                        }}
                    >
                        {isGenerating ? (
                            <div className={styles.spinner} style={{ width: '16px', height: '16px', borderTopColor: '#fff', borderWidth: '2px' }}></div>
                        ) : '🪄'}
                        Generate AI Message
                    </button>

                    {/* AI Message Preview */}
                    {aiMessage && (
                        <div>
                            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginBottom: '0.5rem' }}>
                                WhatsApp Message Preview
                            </label>
                            <textarea
                                value={aiMessage}
                                onChange={(e) => setAiMessage(e.target.value)}
                                style={{ 
                                    width: '100%', padding: '1rem', borderRadius: '8px', border: '1px solid #7c3aed', 
                                    fontSize: '0.9rem', minHeight: '120px', lineHeight: 1.5, resize: 'vertical',
                                    marginBottom: '0.75rem'
                                }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div style={{ 
                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                    borderRadius: '8px', border: '1px solid #e2e8f0', 
                                    padding: '0.4rem 0.5rem', backgroundColor: '#f8fafc'
                                }}>
                                    <input 
                                        type="text" 
                                        readOnly 
                                        value={getWaLink()}
                                        style={{ 
                                            flex: 1, border: 'none', background: 'none', 
                                            fontSize: '0.8rem', color: '#64748b', outline: 'none'
                                        }}
                                    />
                                    <button 
                                        onClick={() => handleCopyLink(getWaLink())}
                                        style={{ 
                                            backgroundColor: '#fff', border: '1px solid #e2e8f0', 
                                            borderRadius: '6px', padding: '0.3rem', 
                                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}
                                        title="Copy Link"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                        </svg>
                                    </button>
                                </div>
                                
                                {selectedOrder?.customerPhone && (
                                    <a 
                                        href={`${getWaLink()}?text=${encodeURIComponent(aiMessage)}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ 
                                            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                            color: '#16a34a', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none'
                                        }}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.414 0 .004 5.412.001 12.049a11.82 11.82 0 001.592 5.911L0 24l6.117-1.605a11.794 11.794 0 005.925 1.599h.005c6.637 0 12.046-5.412 12.049-12.05a11.79 11.79 0 00-3.48-8.513z"/>
                                        </svg>
                                        Direct WhatsApp Link
                                    </a>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
                        <button
                            onClick={handleSubmit}
                            disabled={!selectedOrder || !aiMessage || isSubmitting}
                            style={{ 
                                flex: 1, padding: '0.875rem', borderRadius: '8px',
                                backgroundColor: (!selectedOrder || !aiMessage) ? '#f1f5f9' : '#0f172a',
                                color: (!selectedOrder || !aiMessage) ? '#94a3b8' : '#fff',
                                border: 'none', fontSize: '1rem', fontWeight: 700, 
                                cursor: (!selectedOrder || !aiMessage) ? 'default' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'
                            }}
                        >
                            {isSubmitting ? 'Raising Ticket...' : 'Confirm & Create Ticket'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
