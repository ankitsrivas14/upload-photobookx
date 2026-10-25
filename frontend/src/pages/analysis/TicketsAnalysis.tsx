import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { Alert, Badge, Button, Card, DataList, Drawer, EmptyState, Skeleton } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import styles from '../AnalysisPage.module.css';

interface TicketActivity {
    activity: string;
    date: string;
}

interface Ticket {
    _id: string;
    orderNumber: string;
    customerName: string;
    awb: string;
    courierName: string;
    currentStatus: string;
    activities: TicketActivity[];
    generatedMessage: string;
    status: string;
    createdAt: string;
}

const STATUS: Record<string, { label: string; tone: 'info' | 'caution' | 'positive' | 'neutral' }> = {
    open: { label: 'Open', tone: 'info' },
    in_progress: { label: 'In progress', tone: 'caution' },
    resolved: { label: 'Resolved', tone: 'positive' },
    closed: { label: 'Closed', tone: 'neutral' },
};

export function TicketsAnalysis() {
    const navigate = useNavigate();
    const [copied, setCopied] = useState(false);
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
                toast.success('Ticket status updated');
            } else {
                toast.error(res.error || 'Failed to update status');
            }
        } catch {
            toast.error('Error updating ticket status');
        } finally {
            setIsUpdating(false);
        }
    };

    if (isLoading) {
        return <Skeleton lines={8} />;
    }

    if (error) {
        return <Alert tone="negative" action={<Button size="sm" onClick={loadTickets}>Retry</Button>}>{error}</Alert>;
    }

    const statusOf = (status: string) => STATUS[status] ?? { label: status.replace('_', ' '), tone: 'neutral' as const };

    return (
        <>
            <Card
                title="Shipment tickets"
                eyebrow={`${tickets.length} tickets · click one for its details`}
                padding="sm"
                actions={<Button size="sm" variant="primary" icon="plus" onClick={() => navigate('/admin/analysis/tickets/new')}>New ticket</Button>}
            >
                {tickets.length === 0 ? (
                    <EmptyState size="sm" icon="life-buoy" title="No tickets yet" description="Raise one with New ticket, or from Stuck orders." />
                ) : (
                    <div className="pbx-table">
                        <div className="pbx-table__scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col" className={styles.right}>#</th>
                                        <th scope="col">AWB</th>
                                        <th scope="col">Opened</th>
                                        <th scope="col">Customer</th>
                                        <th scope="col">Status</th>
                                        <th scope="col">Message</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tickets.map((ticket, idx) => {
                                        const status = statusOf(ticket.status);
                                        return (
                                            <tr
                                                key={ticket._id}
                                                className={cx('is-clickable', selectedTicket?._id === ticket._id && 'is-selected')}
                                                onClick={() => setSelectedTicket(ticket)}
                                            >
                                                <td className={cx('pbx-num', styles.right, styles.muted)}>{idx + 1}</td>
                                                <td className="pbx-mono">{ticket.awb}</td>
                                                <td className={styles.date}>{new Date(ticket.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                                                <td>{ticket.customerName}</td>
                                                <td><Badge size="sm" tone={status.tone}>{status.label}</Badge></td>
                                                <td className={styles.preview}><span>{ticket.generatedMessage}</span></td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Card>

            <Drawer
                open={!!selectedTicket}
                onClose={() => setSelectedTicket(null)}
                title="Ticket details"
                description={selectedTicket ? `${selectedTicket.orderNumber} · AWB ${selectedTicket.awb}` : undefined}
                footer={selectedTicket && selectedTicket.status !== 'closed' ? (
                    <Button size="sm" variant="danger" onClick={() => handleUpdateStatus(selectedTicket._id, 'closed')} loading={isUpdating}>Close ticket</Button>
                ) : undefined}
            >
                {selectedTicket && (
                    <div className={styles.stack}>
                        <DataList
                            items={[
                                { label: 'Order', value: selectedTicket.orderNumber },
                                { label: 'AWB', value: <span className="pbx-mono">{selectedTicket.awb}</span> },
                                { label: 'Customer', value: selectedTicket.customerName },
                                { label: 'Status', value: <Badge size="sm" tone={statusOf(selectedTicket.status).tone}>{statusOf(selectedTicket.status).label}</Badge> },
                            ]}
                        />
                        <Alert
                            tone="brand"
                            title="AI message"
                            action={
                                <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={() => { navigator.clipboard.writeText(selectedTicket.generatedMessage); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                                    {copied ? 'Copied' : 'Copy'}
                                </Button>
                            }
                        >
                            <p className={styles.message}>{selectedTicket.generatedMessage}</p>
                        </Alert>
                        {selectedTicket.activities.length > 0 && (
                            <div>
                                <div className={styles.subHead}><span>Tracking archive</span></div>
                                <ol className={styles.timeline}>
                                    {selectedTicket.activities.slice(0, 10).map((activity, idx) => (
                                        <li key={idx} className={idx === 0 ? styles.timelineNow : undefined}>
                                            <span className={styles.timelineTitle}>{activity.activity}</span>
                                            <span className={styles.timelineMeta}>{activity.date}</span>
                                        </li>
                                    ))}
                                </ol>
                                {selectedTicket.activities.length > 10 && (
                                    <p className={styles.muted}>{`+ ${selectedTicket.activities.length - 10} more scans`}</p>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Drawer>
        </>
    );
}
