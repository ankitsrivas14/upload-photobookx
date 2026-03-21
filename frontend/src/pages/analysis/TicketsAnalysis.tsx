import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from '../AnalysisPage.module.css';

interface Ticket {
    _id: string;
    orderNumber: string;
    customerName: string;
    awb: string;
    courierName: string;
    currentStatus: string;
    activities: any[];
    generatedMessage: string;
    status: string;
    createdAt: string;
}

export function TicketsAnalysis() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
    const [isUpdating, setIsUpdating] = useState(false);

    useEffect(() => {
        loadTickets();
    }, []);

    const loadTickets = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.getTickets();
            if (res.success && res.tickets) {
                setTickets(res.tickets);
            } else {
                setError(res.error || 'Failed to fetch tickets');
            }
        } catch (err) {
            console.error('Error fetching tickets:', err);
            setError('An error occurred while fetching tickets.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateStatus = async (id: string, newStatus: string) => {
        setIsUpdating(true);
        try {
            const res = await api.updateTicketStatus(id, newStatus);
            if (res.success && res.ticket) {
                setTickets(prev => prev.map(t => t._id === id ? res.ticket : t));
                if (selectedTicket?._id === id) {
                    setSelectedTicket(res.ticket);
                }
            } else {
                alert(res.error || 'Failed to update status');
            }
        } catch (err) {
            alert('Error updating ticket status');
        } finally {
            setIsUpdating(false);
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open': return { bg: '#e0f2fe', text: '#0369a1' };
            case 'in_progress': return { bg: '#fef3c7', text: '#92400e' };
            case 'resolved': return { bg: '#dcfce7', text: '#15803d' };
            case 'closed': return { bg: '#f1f5f9', text: '#475569' };
            default: return { bg: '#f1f5f9', text: '#475569' };
        }
    };

    if (isLoading) {
        return (
            <div className={styles['loading-section']}>
                <div className={styles.spinner}></div>
                <p>Loading tickets...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`${styles['content-section']} ${styles['error-state']}`}>
                <p>{error}</p>
                <button onClick={loadTickets} className={styles['retry-btn']}>Retry</button>
            </div>
        );
    }

    return (
        <div className={styles['analysis-content']} style={{ display: 'grid', gridTemplateColumns: selectedTicket ? '1fr 400px' : '1fr', gap: '2rem' }}>
            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', border: '1px solid #f1f5f9' }}>
                <h3 style={{ marginTop: 0, marginBottom: '1.5rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                    Shipment Concern Tickets ({tickets.length})
                </h3>
                
                {tickets.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem' }}>
                        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🎫</div>
                        <p style={{ color: '#64748b' }}>No tickets created yet.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid #f1f5f9', textAlign: 'left' }}>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600, width: '40px' }}>#</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>AWB Number</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Opened Date</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Customer Name</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600, width: '100px' }}>Status</th>
                                    <th style={{ padding: '0.75rem', color: '#64748b', fontWeight: 600 }}>Content Preview</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tickets.map((ticket, idx) => {
                                    const colors = getStatusColor(ticket.status);
                                    const isSelected = selectedTicket?._id === ticket._id;
                                    
                                    return (
                                        <tr 
                                            key={ticket._id} 
                                            style={{ 
                                                borderBottom: '1px solid #f1f5f9',
                                                backgroundColor: isSelected ? '#f8fafc' : 'transparent',
                                                cursor: 'pointer'
                                            }}
                                            onClick={() => setSelectedTicket(ticket)}
                                        >
                                            <td style={{ padding: '0.75rem', color: '#94a3b8', fontSize: '0.75rem' }}>{idx + 1}</td>
                                            <td style={{ padding: '0.75rem', fontWeight: 600, color: '#1e293b' }}>{ticket.awb}</td>
                                            <td style={{ padding: '0.75rem', color: '#64748b' }}>
                                                {new Date(ticket.createdAt).toLocaleDateString()}
                                            </td>
                                            <td style={{ padding: '0.75rem', color: '#475569' }}>{ticket.customerName}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <span style={{ 
                                                    padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.70rem',
                                                    backgroundColor: colors.bg, color: colors.text, fontWeight: 700,
                                                    textTransform: 'uppercase'
                                                }}>
                                                    {ticket.status.replace('_', ' ')}
                                                </span>
                                            </td>
                                            <td style={{ padding: '0.75rem', maxWidth: '250px' }}>
                                                <div style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                                                    {ticket.generatedMessage}
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

            {selectedTicket && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)', border: '1px solid #f1f5f9' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                            <h4 style={{ margin: 0, color: '#1e293b' }}>Ticket Details</h4>
                            <button onClick={() => setSelectedTicket(null)} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#94a3b8' }}>&times;</button>
                        </div>

                        <div style={{ marginBottom: '1.25rem', padding: '1rem', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Management</div>
                                {selectedTicket.status !== 'closed' && (
                                    <button 
                                        onClick={() => handleUpdateStatus(selectedTicket._id, 'closed')}
                                        disabled={isUpdating}
                                        style={{ 
                                            background: '#fee2e2', color: '#991b1b', border: 'none', 
                                            padding: '0.3rem 0.8rem', borderRadius: '6px', fontSize: '0.75rem', 
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
                                    <div style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 600 }}>{selectedTicket.orderNumber}</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>AWB</div>
                                    <div style={{ fontSize: '0.9rem', color: '#1e293b', fontWeight: 600 }}>{selectedTicket.awb}</div>
                                </div>
                            </div>
                        </div>
                        
                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600 }}>AI Message</div>
                            <div style={{ 
                                marginTop: '0.5rem', padding: '1rem', backgroundColor: '#f1f5f9', borderRadius: '8px', 
                                border: '1px solid #cbd5e1', fontSize: '0.85rem', color: '#1e293b', whiteSpace: 'pre-wrap', lineHeight: 1.5,
                                maxHeight: '250px', overflowY: 'auto'
                            }}>
                                {selectedTicket.generatedMessage}
                            </div>
                            <button 
                                onClick={() => navigator.clipboard.writeText(selectedTicket.generatedMessage)}
                                style={{ 
                                    marginTop: '0.5rem', width: '100%', padding: '0.4rem', borderRadius: '6px', 
                                    backgroundColor: '#fff', border: '1px solid #e2e8f0', color: '#334155', 
                                    fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600
                                }}
                            >
                                Copy Message
                            </button>
                        </div>

                        <div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600, marginBottom: '1rem' }}>Tracking Archive</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative' }}>
                                <div style={{ position: 'absolute', left: '7px', top: '10px', bottom: '10px', width: '2px', backgroundColor: '#e2e8f0' }}></div>
                                {selectedTicket.activities.slice(0, 10).map((activity: any, idx: number) => (
                                    <div key={idx} style={{ display: 'flex', gap: '0.75rem', position: 'relative', zIndex: 1 }}>
                                        <div style={{ width: '16px', height: '16px', borderRadius: '50%', backgroundColor: idx === 0 ? '#3b82f6' : '#fff', border: `3px solid ${idx === 0 ? '#3b82f6' : '#cbd5e1'}`, flexShrink: 0, marginTop: '3px' }}></div>
                                        <div>
                                            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.8rem' }}>{activity.activity}</div>
                                            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>{activity.date}</div>
                                        </div>
                                    </div>
                                ))}
                                {selectedTicket.activities.length > 10 && (
                                    <div style={{ paddingLeft: '1.5rem', fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                        + {selectedTicket.activities.length - 10} more historic scans
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
