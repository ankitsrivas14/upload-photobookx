import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { ShopifyOrder } from '../../services/api';
import styles from '../AnalysisPage.module.css';

const getGroupedCourierName = (courier: string | null | undefined): string => {
    if (!courier) return 'Unknown';
    const normalized = courier.toLowerCase();
    if (normalized.includes('xpressbees')) return 'Xpressbees';
    if (normalized.includes('shadowfax')) return 'Shadowfax';
    if (normalized.includes('amazon')) return 'Amazon';
    if (normalized.includes('delhivery')) return 'Delhivery';
    if (normalized.includes('blue dart') || normalized.includes('bluedart')) return 'Blue Dart';
    if (normalized.includes('ekart')) return 'Ekart';
    if (normalized.includes('ecom')) return 'Ecom Express';
    if (normalized.includes('dtdc')) return 'DTDC';
    return courier;
};

const TicketModal = ({ ticket, onClose, onUpdate }: { ticket: any, onClose: () => void, onUpdate: () => void }) => {
    const [isUpdating, setIsUpdating] = useState(false);

    const handleCloseTicket = async () => {
        setIsUpdating(true);
        try {
            const res = await api.updateTicketStatus(ticket._id, 'closed');
            if (res.success) {
                onUpdate();
                onClose();
            } else {
                alert(res.error || 'Failed to close ticket');
            }
        } catch (err) {
            alert('Error closing ticket');
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'flex-end', zIndex: 1100
        }} onClick={onClose}>
            <div style={{
                backgroundColor: '#fff', width: '100%', maxWidth: '450px', height: '100%',
                display: 'flex', flexDirection: 'column', boxShadow: '-10px 0 15px -3px rgba(0,0,0,0.1)',
                animation: 'slideIn 0.3s ease-out'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#1e293b' }}>Ticket Details</h3>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Management</div>
                            {ticket.status !== 'closed' && (
                                <button 
                                    onClick={handleCloseTicket}
                                    disabled={isUpdating}
                                    style={{ 
                                        background: '#fee2e2', color: '#991b1b', border: 'none', 
                                        padding: '0.4rem 1rem', borderRadius: '8px', fontSize: '0.8rem', 
                                        fontWeight: 700, cursor: 'pointer'
                                    }}
                                >
                                    {isUpdating ? 'Closing...' : 'Close Ticket'}
                                </button>
                            )}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Order</div>
                                <div style={{ fontSize: '1rem', color: '#1e293b', fontWeight: 600 }}>{ticket.orderNumber}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>AWB</div>
                                <div style={{ fontSize: '1rem', color: '#1e293b', fontWeight: 600 }}>{ticket.awb}</div>
                            </div>
                        </div>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600 }}>AI Casual Message</div>
                        <div style={{ 
                            marginTop: '0.5rem', padding: '1.25rem', backgroundColor: '#f1f5f9', borderRadius: '10px', 
                            border: '1px solid #cbd5e1', fontSize: '0.9rem', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.6
                        }}>
                            {ticket.generatedMessage}
                        </div>
                        <button 
                            onClick={() => navigator.clipboard.writeText(ticket.generatedMessage)}
                            style={{ 
                                marginTop: '0.75rem', width: '100%', padding: '0.6rem', borderRadius: '8px', 
                                backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#334155', 
                                fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600
                            }}
                        >
                            Copy to Clipboard
                        </button>
                    </div>

                    <div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600, marginBottom: '1.25rem' }}>Snapshot at Creation</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', position: 'relative' }}>
                            <div style={{ position: 'absolute', left: '7px', top: '10px', bottom: '10px', width: '2px', backgroundColor: '#e2e8f0' }}></div>
                            {ticket.activities.slice(0, 8).map((activity: any, idx: number) => (
                                <div key={idx} style={{ display: 'flex', gap: '1rem', position: 'relative', zIndex: 1 }}>
                                    <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: idx === 0 ? '#3b82f6' : '#fff', border: `3px solid ${idx === 0 ? '#3b82f6' : '#cbd5e1'}`, flexShrink: 0, marginTop: '3px' }}></div>
                                    <div>
                                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.85rem' }}>{activity.activity}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{activity.date}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            ` }} />
        </div>
    );
};

const TrackingModal = ({ order, onClose }: { order: ShopifyOrder, onClose: () => void }) => {
    const awb = order.awbCode || (order.trackingUrl ? order.trackingUrl.split('/').pop() : null);
    const [tracking, setTracking] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [complaintMessage, setComplaintMessage] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isCreatingTicket, setIsCreatingTicket] = useState(false);
    const [ticketCreated, setTicketCreated] = useState(false);
    const [copySuccess, setCopySuccess] = useState(false);

    useEffect(() => {
        const fetchTrackingAndTicket = async () => {
            if (!awb) {
                setError('No tracking ID found for this order.');
                setIsLoading(false);
                return;
            }
            setIsLoading(true);
            try {
                const [trackingRes, ticketRes] = await Promise.all([
                    api.getTracking(awb),
                    api.getTicketByAWB(awb)
                ]);

                if (trackingRes.success && trackingRes.tracking) {
                    setTracking(trackingRes.tracking);
                } else {
                    setError(trackingRes.error || 'Failed to fetch tracking details');
                }

                if (ticketRes.success && ticketRes.ticket) {
                    setComplaintMessage(ticketRes.ticket.generatedMessage);
                    setTicketCreated(true);
                }
            } catch (err) {
                setError('Error connecting to backend services');
            } finally {
                setIsLoading(false);
            }
        };
        fetchTrackingAndTicket();
    }, [awb]);

    const handleGenerateComplaint = async () => {
        if (!tracking) return;
        setIsGenerating(true);
        try {
            const activities = tracking?.tracking_data?.shipment_track_activities || [];
            const currentStatus = tracking?.tracking_data?.shipment_track?.[0]?.current_status || 'Unknown';
            
            const res = await api.generateComplaint({
                activities,
                orderName: order.name,
                courierName: order.courierName || 'the courier',
                customerName: order.customerName || 'N/A',
                awb: awb || 'N/A',
                currentStatus: currentStatus
            } as any);
            if (res.success && res.message) {
                setComplaintMessage(res.message);
            } else {
                alert(res.error || 'Failed to generate complaint message');
            }
        } catch (err) {
            alert('Error connecting to AI service');
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCreateTicket = async () => {
        if (!tracking || !complaintMessage) return;
        setIsCreatingTicket(true);
        try {
            const activities = tracking?.tracking_data?.shipment_track_activities || [];
            const currentStatus = tracking?.tracking_data?.shipment_track?.[0]?.current_status || 'Unknown';
            
            const res = await api.createTicket({
                orderNumber: order.name,
                customerName: order.customerName || 'N/A',
                awb: awb || 'N/A',
                courierName: order.courierName || 'Unknown',
                currentStatus: currentStatus,
                activities: activities,
                generatedMessage: complaintMessage
            });
            
            if (res.success) {
                setTicketCreated(true);
            } else {
                alert(res.error || 'Failed to create ticket');
            }
        } catch (err) {
            alert('Error creating ticket');
        } finally {
            setIsCreatingTicket(false);
        }
    };

    const handleCopy = () => {
        if (complaintMessage) {
            navigator.clipboard.writeText(complaintMessage);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        }
    };

    const activities = tracking?.tracking_data?.shipment_track_activities || [];
    const currentStatus = tracking?.tracking_data?.shipment_track?.[0]?.current_status || 'Unknown';

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            padding: '1rem'
        }}>
            <div style={{
                backgroundColor: '#fff', borderRadius: '16px', width: '100%', maxWidth: '750px',
                maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)'
            }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Order {order.name} - Tracking Journey</h3>
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.9rem', color: '#64748b' }}>AWB: {awb || 'N/A'}</p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '2rem' }}>
                            <div className={styles.spinner} style={{ margin: '0 auto' }}></div>
                            <p style={{ marginTop: '1rem', color: '#64748b' }}>Fetching real-time updates...</p>
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#ef4444' }}>{error}</div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: complaintMessage ? '1.2fr 1fr' : '1fr', gap: '2rem' }}>
                            <div>
                                <div style={{ marginBottom: '1.5rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                    <div style={{ fontSize: '0.85rem', color: '#64748b' }}>Current Status</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', marginTop: '0.25rem' }}>{currentStatus}</div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'relative' }}>
                                    <div style={{ position: 'absolute', left: '7px', top: '10px', bottom: '10px', width: '2px', backgroundColor: '#e2e8f0' }}></div>
                                    
                                    {activities.length === 0 ? (
                                        <p style={{ textAlign: 'center', color: '#94a3b8' }}>No activity history found.</p>
                                    ) : activities.map((activity: any, idx: number) => (
                                        <div key={idx} style={{ display: 'flex', gap: '1rem', position: 'relative', zIndex: 1 }}>
                                            <div style={{ 
                                                width: '16px', height: '16px', borderRadius: '50%', 
                                                backgroundColor: idx === 0 ? '#3b82f6' : '#fff',
                                                border: `3px solid ${idx === 0 ? '#3b82f6' : '#cbd5e1'}`,
                                                flexShrink: 0, marginTop: '4px'
                                            }}></div>
                                            <div>
                                                <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.85rem' }}>{activity.activity}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.1rem' }}>{activity.location}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>{activity.date}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {complaintMessage && (
                                <div style={{ borderLeft: '1px solid #f1f5f9', paddingLeft: '1.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <h4 style={{ margin: 0, color: '#1e293b' }}>Casual Message</h4>
                                        <button 
                                            onClick={handleCopy}
                                            style={{ 
                                                fontSize: '0.75rem', padding: '0.4rem 0.8rem', borderRadius: '6px',
                                                backgroundColor: copySuccess ? '#22c55e' : '#f1f5f9',
                                                color: copySuccess ? '#fff' : '#475569',
                                                border: 'none', cursor: 'pointer', fontWeight: 600, transition: 'all 0.2s'
                                            }}
                                        >
                                            {copySuccess ? 'Copied!' : 'Copy'}
                                        </button>
                                    </div>
                                    <div style={{ 
                                        backgroundColor: '#f1f5f9', padding: '1.25rem', borderRadius: '12px', 
                                        fontSize: '0.9rem', color: '#1e293b', border: '1px solid #cbd5e1',
                                        lineHeight: 1.5, maxHeight: '400px', overflowY: 'auto', whiteSpace: 'pre-wrap'
                                    }}>
                                        {complaintMessage}
                                    </div>
                                    
                                    <div style={{ marginTop: '1.5rem' }}>
                                        <button 
                                            onClick={handleCreateTicket}
                                            disabled={isCreatingTicket || ticketCreated}
                                            style={{ 
                                                width: '100%', padding: '0.75rem', borderRadius: '10px', border: 'none', 
                                                backgroundColor: ticketCreated ? '#22c55e' : '#3b82f6', 
                                                color: '#fff', fontWeight: 600, cursor: (isCreatingTicket || ticketCreated) ? 'default' : 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {isCreatingTicket ? (
                                                <>
                                                    <div className={styles.spinner} style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff' }}></div>
                                                    Saving...
                                                </>
                                            ) : ticketCreated ? (
                                                <>✅ Ticket Saved</>
                                            ) : (
                                                <>🎫 Create Ticket</>
                                            )}
                                        </button>
                                        {ticketCreated && <p style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: '0.5rem', textAlign: 'center' }}>Ticket recovered from DB.</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ padding: '1.25rem', borderTop: '1px solid #f1f5f9', backgroundColor: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {!complaintMessage ? (
                            <button 
                                onClick={handleGenerateComplaint}
                                disabled={isGenerating || isLoading || !!error}
                                style={{ 
                                    padding: '0.75rem 1.5rem', borderRadius: '10px', border: 'none', 
                                    backgroundColor: '#1e293b', color: '#fff', fontWeight: 600, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '0.5rem', opacity: (isGenerating || isLoading || !!error) ? 0.7 : 1
                                }}
                            >
                                {isGenerating ? (
                                    <>
                                        <div className={styles.spinner} style={{ width: '16px', height: '16px', border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff' }}></div>
                                        Thinking...
                                    </>
                                ) : (
                                    <>
                                        ✨ Generate Casual Message
                                    </>
                                )}
                            </button>
                        ) : (
                            <button 
                                onClick={() => { setComplaintMessage(null); setTicketCreated(false); handleGenerateComplaint(); }}
                                style={{ background: 'none', border: '1px solid #cbd5e1', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
                            >
                                Rewrite
                            </button>
                        )}
                    </div>
                    <button onClick={onClose} style={{ 
                        padding: '0.6rem 1.2rem', borderRadius: '8px', border: '1px solid #e2e8f0', 
                        backgroundColor: '#fff', color: '#475569', fontWeight: 600, cursor: 'pointer' 
                    }}>Close</button>
                </div>
            </div>
        </div>
    );
};

export function StuckOrdersAnalysis() {
    const [stuckOrders, setStuckOrders] = useState<ShopifyOrder[]>([]);
    const [outForDeliveryOrders, setOutForDeliveryOrders] = useState<ShopifyOrder[]>([]);
    const [attemptedDeliveryOrders, setAttemptedDeliveryOrders] = useState<ShopifyOrder[]>([]);
    const [inTransitOrders, setInTransitOrders] = useState<ShopifyOrder[]>([]);
    const [fullTickets, setFullTickets] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | null>(null);
    const [viewingTicket, setViewingTicket] = useState<any | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [ordersRes, ticketsRes] = await Promise.all([
                api.getOrders(1000, true),
                api.getTickets()
            ]);

            if (ticketsRes.success && ticketsRes.tickets) {
                setFullTickets(ticketsRes.tickets);
            }

            if (ordersRes.success && ordersRes.orders) {
                const now = new Date();
                const STUCK_DAYS_THRESHOLD = 4;
                const OFD_STUCK_DAYS_THRESHOLD = 3;
                const ATTEMPTED_STUCK_DAYS_THRESHOLD = 5;
                const IN_TRANSIT_STUCK_DAYS_THRESHOLD = 7;
                
                const allStuck = ordersRes.orders.filter(order => {
                    const createdAt = new Date(order.createdAt);
                    const CUTOFF_DATE = new Date('2026-01-28');
                    if (createdAt < CUTOFF_DATE) return false;

                    if (order.cancelledAt) return false;
                    
                    const deliveryStatus = (order.deliveryStatus || '').toLowerCase();
                    const fulfillmentStatus = (order.fulfillmentStatus || '').toLowerCase();
                    
                    const terminalNumericStatuses = ['7', '12', '13', '15', '16', '17', '18', '19', '20', '42', '46', '10', '21', '27', '38']; 
                    
                    const isTerminal = 
                        deliveryStatus === 'delivered' || 
                        deliveryStatus === 'failure' || 
                        deliveryStatus.includes('failed') || 
                        deliveryStatus.includes('rto') ||
                        terminalNumericStatuses.includes(deliveryStatus);
                    
                    if (isTerminal) return false;
                    
                    if (!fulfillmentStatus || fulfillmentStatus === 'unfulfilled') return false;
                    return true;
                });

                const ofd: ShopifyOrder[] = [];
                const attempted: ShopifyOrder[] = [];
                const inTransit: ShopifyOrder[] = [];
                const stuck: ShopifyOrder[] = [];

                allStuck.forEach(order => {
                    const deliveryStatus = (order.deliveryStatus || '').toLowerCase();
                    const isOFD = deliveryStatus === 'out_for_delivery' || deliveryStatus === 'out for delivery' || deliveryStatus === '11' || deliveryStatus === '24';
                    const isAttempted = deliveryStatus === 'attempted_delivery' || deliveryStatus === 'attempted delivery' || deliveryStatus === 'ndr' || deliveryStatus === '11';
                    const isInTransit = deliveryStatus === 'in_transit' || deliveryStatus === 'in transit' || deliveryStatus === '6' || deliveryStatus === 'shipped' || deliveryStatus === '23' || deliveryStatus === '22';
                    
                    const createdAt = new Date(order.createdAt);
                    const diffTime = Math.abs(now.getTime() - createdAt.getTime());
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (isOFD) {
                        const referenceDate = order.firstAttemptDate ? new Date(order.firstAttemptDate) : createdAt;
                        const dpt = Math.abs(now.getTime() - referenceDate.getTime());
                        const ofdDays = Math.ceil(dpt / (1000 * 60 * 60 * 24));

                        if (ofdDays >= OFD_STUCK_DAYS_THRESHOLD) {
                            ofd.push(order);
                        }
                    } else if (isAttempted) {
                        const referenceDate = order.firstAttemptDate ? new Date(order.firstAttemptDate) : createdAt;
                        const dpt = Math.abs(now.getTime() - referenceDate.getTime());
                        const attemptedDays = Math.ceil(dpt / (1000 * 60 * 60 * 24));

                        if (attemptedDays >= ATTEMPTED_STUCK_DAYS_THRESHOLD) {
                            attempted.push(order);
                        }
                    } else if (isInTransit) {
                        if (diffDays >= IN_TRANSIT_STUCK_DAYS_THRESHOLD) {
                            inTransit.push(order);
                        }
                    } else {
                        if (diffDays >= STUCK_DAYS_THRESHOLD) {
                            stuck.push(order);
                        }
                    }
                });

                // Sort by oldest first
                ofd.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                attempted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                inTransit.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                stuck.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

                setOutForDeliveryOrders(ofd);
                setAttemptedDeliveryOrders(attempted);
                setInTransitOrders(inTransit);
                setStuckOrders(stuck);
            } else {
                setError(ordersRes.error || 'Failed to fetch orders');
            }
        } catch (err) {
            console.error('Error fetching orders:', err);
            setError('An error occurred while fetching orders.');
        } finally {
            setIsLoading(false);
        }
    };

    const OrderTable = ({ orders, title }: { orders: ShopifyOrder[], title: string }) => {
        const isOFDTable = title.includes('Out for Delivery');
        const isAttemptedTable = title.includes('Attempted Delivery');
        const isInTransitTable = title.includes('In Transit');

        return (
            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9' }}>
                <h3 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                    {title} ({orders.length})
                </h3>
                {orders.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '0.9rem', textAlign: 'center', padding: '2rem' }}>No orders found!</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #f1f5f9', textAlign: 'left' }}>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Order</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Customer</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Date</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Status</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Courier</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Days Active</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Ticket</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map(order => {
                                    const createdAt = new Date(order.createdAt);
                                    const diffTime = Math.abs(new Date().getTime() - createdAt.getTime());
                                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                                    
                                    const awb = order.awbCode || (order.trackingUrl ? order.trackingUrl.split('/').pop() : null);
                                    const existingTicket = fullTickets.find(t => t.awb === awb);
                                    const hasTicket = !!existingTicket;

                                    let badgeColor = '#f3f4f6';
                                    let badgeText = '#374151';
                                    
                                    if (isOFDTable) {
                                        badgeColor = '#dcfce7'; // Green
                                        badgeText = '#166534';
                                    } else if (isAttemptedTable) {
                                        badgeColor = '#fee2e2'; // Red
                                        badgeText = '#991b1b';
                                    } else if (isInTransitTable) {
                                        badgeColor = '#e0f2fe'; // Sky Blue
                                        badgeText = '#075985';
                                    } else {
                                        badgeColor = '#fef3c7'; // Amber (Other)
                                        badgeText = '#92400e';
                                    }

                                    return (
                                        <tr key={order.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '0.75rem', verticalAlign: 'middle' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <div style={{ 
                                                        width: '8px', 
                                                        height: '8px', 
                                                        borderRadius: '50%', 
                                                        flexShrink: 0,
                                                        backgroundColor: (order.paymentMethod || '').toLowerCase() === 'cod' ? '#f97316' : '#10b981',
                                                        boxShadow: (order.paymentMethod || '').toLowerCase() === 'cod' 
                                                            ? '0 0 0 2px rgba(249, 115, 22, 0.2)' 
                                                            : '0 0 0 2px rgba(16, 185, 129, 0.2)'
                                                    }} />
                                                    <span style={{ fontWeight: 600, color: '#334155' }}>{order.name}</span>
                                                </div>
                                            </td>
                                            <td style={{ padding: '0.75rem', color: '#334155' }}>{order.customerName || 'N/A'}</td>
                                            <td style={{ padding: '0.75rem', color: '#64748b' }}>{new Date(order.createdAt).toLocaleDateString()}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <span style={{ 
                                                    padding: '0.25rem 0.6rem', 
                                                    borderRadius: '9999px', 
                                                    fontSize: '0.75rem', 
                                                    backgroundColor: badgeColor, 
                                                    color: badgeText,
                                                    fontWeight: 500,
                                                    display: 'inline-block'
                                                }}>
                                                    {(order.deliveryStatus || 'Unknown').replace(/_/g, ' ')}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.75rem', color: '#64748b' }}>{getGroupedCourierName(order.courierName)}</td>
                                            <td style={{ padding: '0.75rem', color: '#64748b' }}>{diffDays} days</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                {hasTicket ? (
                                                    <button 
                                                        onClick={() => setViewingTicket(existingTicket)}
                                                        style={{ 
                                                            padding: '0.3rem 0.6rem', borderRadius: '8px', fontSize: '0.75rem',
                                                            backgroundColor: existingTicket.status === 'closed' ? '#f1f5f9' : '#eff6ff', 
                                                            color: existingTicket.status === 'closed' ? '#64748b' : '#2563eb', 
                                                            border: `1px solid ${existingTicket.status === 'closed' ? '#e2e8f0' : '#bfdbfe'}`,
                                                            fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
                                                            transition: 'all 0.2s', boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                                        }}
                                                    >
                                                        🎫 {existingTicket.status === 'closed' ? 'Closed' : 'Ticket'}
                                                    </button>
                                                ) : (
                                                    <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>None</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <div style={{ display: 'flex', gap: '1rem' }}>
                                                    <button 
                                                        onClick={() => setSelectedOrder(order)}
                                                        style={{ 
                                                            background: 'none', border: 'none', color: '#3b82f6', 
                                                            textDecoration: 'none', fontWeight: 600, cursor: 'pointer',
                                                            padding: 0, fontSize: '0.85rem'
                                                        }}
                                                    >
                                                        Activities
                                                    </button>
                                                    {order.trackingUrl && (
                                                        <a 
                                                            href={order.trackingUrl} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#312e81', textDecoration: 'none', fontSize: '0.85rem' }}
                                                        >
                                                            Track
                                                        </a>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className={styles['loading-section']}>
                <div className={styles.spinner}></div>
                <p>Analyzing delivery statuses...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`${styles['content-section']} ${styles['error-state']}`}>
                <p>{error}</p>
                <button onClick={loadData} className={styles['retry-btn']}>Retry</button>
            </div>
        );
    }

    const hasAnyOrders = outForDeliveryOrders.length > 0 || attemptedDeliveryOrders.length > 0 || inTransitOrders.length > 0 || stuckOrders.length > 0;

    return (
        <div className={styles['analysis-content']} style={{ display: 'grid', gap: '2rem', paddingBottom: '2rem' }}>
            {!hasAnyOrders && (
                <div style={{ backgroundColor: '#fff', padding: '3rem', borderRadius: '12px', textAlign: 'center', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
                    <h3 style={{ margin: 0, color: '#1e293b' }}>All caught up!</h3>
                    <p style={{ color: '#64748b', marginTop: '0.5rem' }}>No stuck or problematic orders found.</p>
                </div>
            )}
            
            <OrderTable title="Stuck Out for Delivery Orders (3+ Days)" orders={outForDeliveryOrders} />
            <OrderTable title="Stuck Attempted Delivery Orders (5+ Days)" orders={attemptedDeliveryOrders} />
            <OrderTable title="Stuck In Transit Orders (7+ Days)" orders={inTransitOrders} />
            {stuckOrders.length > 0 && <OrderTable title="Other Stuck Orders (4+ Days)" orders={stuckOrders} />}

            {selectedOrder && (
                <TrackingModal order={selectedOrder} onClose={() => { setSelectedOrder(null); loadData(); }} />
            )}

            {viewingTicket && (
                <TicketModal 
                    ticket={viewingTicket} 
                    onClose={() => setViewingTicket(null)} 
                    onUpdate={() => { loadData(); }} 
                />
            )}
        </div>
    );
}
