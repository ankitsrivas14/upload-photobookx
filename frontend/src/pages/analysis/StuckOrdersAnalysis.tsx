import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../services/api';
import type { ShopifyOrder } from '../../services/api';
import { Alert, Badge, Button, Card, DataList, Dialog, Drawer, EmptyState, Icon, Skeleton, StatCard, StatStrip, Tooltip } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import styles from '../AnalysisPage.module.css';

interface TrackActivity {
    activity: string;
    date: string;
    location?: string;
}

interface Ticket {
    _id: string;
    orderNumber: string;
    awb: string;
    status: string;
    generatedMessage: string;
    activities: TrackActivity[];
}

interface TrackingData {
    tracking_data?: {
        shipment_track_activities?: TrackActivity[];
        shipment_track?: Array<{ current_status?: string }>;
    };
}

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

/** A shipment's activity, newest first; the latest event is marked. */
const Timeline = ({ activities, showLocation = false }: { activities: TrackActivity[]; showLocation?: boolean }) => (
    <ol className={styles.timeline}>
        {activities.map((activity, idx) => (
            <li key={idx} className={idx === 0 ? styles.timelineNow : undefined}>
                <span className={styles.timelineTitle}>{activity.activity}</span>
                {showLocation && activity.location && <span className={styles.timelineMeta}>{activity.location}</span>}
                <span className={styles.timelineMeta}>{activity.date}</span>
            </li>
        ))}
    </ol>
);

const TicketDrawer = ({ ticket, onClose, onUpdate }: { ticket: Ticket | null, onClose: () => void, onUpdate: () => void }) => {
    const [isUpdating, setIsUpdating] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCloseTicket = async () => {
        if (!ticket) return;
        setIsUpdating(true);
        try {
            const res = await api.updateTicketStatus(ticket._id, 'closed');
            if (res.success) {
                onUpdate();
                onClose();
            } else {
                toast.error(res.error || 'Failed to close ticket');
            }
        } catch {
            toast.error('Error closing ticket');
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <Drawer
            open={!!ticket}
            onClose={onClose}
            title="Ticket details"
            description={ticket ? `${ticket.orderNumber} · AWB ${ticket.awb}` : undefined}
            footer={ticket && ticket.status !== 'closed' ? (
                <Button size="sm" variant="danger" onClick={handleCloseTicket} loading={isUpdating}>Close ticket</Button>
            ) : undefined}
        >
            {ticket && (
                <div className={styles.stack}>
                    <DataList
                        items={[
                            { label: 'Order', value: ticket.orderNumber },
                            { label: 'AWB', value: <span className="pbx-mono">{ticket.awb}</span> },
                            { label: 'Status', value: <Badge size="sm" tone={ticket.status === 'closed' ? 'neutral' : 'info'}>{ticket.status === 'closed' ? 'Closed' : 'Open'}</Badge> },
                        ]}
                    />
                    <Alert
                        tone="brand"
                        title="AI message"
                        action={
                            <Button size="sm" icon={copied ? 'check' : 'copy'} onClick={() => { navigator.clipboard.writeText(ticket.generatedMessage); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                                {copied ? 'Copied' : 'Copy'}
                            </Button>
                        }
                    >
                        <p className={styles.message}>{ticket.generatedMessage}</p>
                    </Alert>
                    <div>
                        <div className={styles.subHead}><span>Snapshot at creation</span></div>
                        <Timeline activities={ticket.activities.slice(0, 8)} />
                    </div>
                </div>
            )}
        </Drawer>
    );
};

const TrackingDialog = ({ order, onClose }: { order: ShopifyOrder, onClose: () => void }) => {
    const awb = order.awbCode || (order.trackingUrl ? order.trackingUrl.split('/').pop() : null);
    const [tracking, setTracking] = useState<TrackingData | null>(null);
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
            } catch {
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
                toast.error(res.error || 'Failed to generate complaint message');
            }
        } catch {
            toast.error('Error connecting to AI service');
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
                toast.error(res.error || 'Failed to create ticket');
            }
        } catch {
            toast.error('Error creating ticket');
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
        <Dialog
            open
            onClose={onClose}
            size="lg"
            title={`Tracking · ${order.name}`}
            description={`AWB ${awb || 'N/A'}`}
            footer={
                <>
                    {!complaintMessage ? (
                        <Button variant="primary" icon="sparkles" onClick={handleGenerateComplaint} loading={isGenerating} disabled={isLoading || !!error}>
                            {isGenerating ? 'Writing…' : 'Generate casual message'}
                        </Button>
                    ) : (
                        <Button onClick={() => { setComplaintMessage(null); setTicketCreated(false); handleGenerateComplaint(); }}>Rewrite</Button>
                    )}
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </>
            }
        >
            {isLoading ? (
                <Skeleton lines={6} />
            ) : error ? (
                <Alert tone="negative">{error}</Alert>
            ) : (
                <div className={cx(styles.trackGrid, complaintMessage && styles.trackGridSplit)}>
                    <div className={styles.stack}>
                        <DataList items={[{ label: 'Current status', value: <span className={styles.strong}>{currentStatus}</span> }]} />
                        {activities.length === 0 ? (
                            <p className={styles.muted}>No activity history found.</p>
                        ) : (
                            <Timeline activities={activities} showLocation />
                        )}
                    </div>
                    {complaintMessage && (
                        <div className={styles.stack}>
                            <Alert
                                tone="brand"
                                title="Casual message"
                                action={<Button size="sm" icon={copySuccess ? 'check' : 'copy'} onClick={handleCopy}>{copySuccess ? 'Copied' : 'Copy'}</Button>}
                            >
                                <p className={styles.message}>{complaintMessage}</p>
                            </Alert>
                            <Button variant="primary" icon={ticketCreated ? 'check' : 'life-buoy'} onClick={handleCreateTicket} loading={isCreatingTicket} disabled={ticketCreated} fullWidth>
                                {ticketCreated ? 'Ticket saved' : 'Create ticket'}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </Dialog>
    );
};

const TABLES = [
    { key: 'ofd', title: 'Out for delivery', rule: '3+ days', tone: 'info' as const },
    { key: 'attempted', title: 'Attempted delivery', rule: '5+ days', tone: 'negative' as const },
    { key: 'transit', title: 'In transit', rule: '7+ days', tone: 'info' as const },
    { key: 'other', title: 'Other', rule: '4+ days', tone: 'caution' as const },
];

export function StuckOrdersAnalysis() {
    const [stuckOrders, setStuckOrders] = useState<ShopifyOrder[]>([]);
    const [outForDeliveryOrders, setOutForDeliveryOrders] = useState<ShopifyOrder[]>([]);
    const [attemptedDeliveryOrders, setAttemptedDeliveryOrders] = useState<ShopifyOrder[]>([]);
    const [inTransitOrders, setInTransitOrders] = useState<ShopifyOrder[]>([]);
    const [fullTickets, setFullTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedOrder, setSelectedOrder] = useState<ShopifyOrder | null>(null);
    const [viewingTicket, setViewingTicket] = useState<Ticket | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [ordersRes, ticketsRes] = await Promise.all([
                // Only open shipments can be stuck; the server leaves out finished orders.
                api.getOrders(10000, true, undefined, undefined, 'terminal'),
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

    const orderTable = (orders: ShopifyOrder[], tone: 'info' | 'negative' | 'caution') => (
        <div className="pbx-table">
            <div className="pbx-table__scroll">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Order</th>
                            <th scope="col">Customer</th>
                            <th scope="col">Placed</th>
                            <th scope="col">Status</th>
                            <th scope="col">Courier</th>
                            <th scope="col" className={styles.right}>Days active</th>
                            <th scope="col">Ticket</th>
                            <th scope="col"><span className="pbx-sr">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => {
                            const createdAt = new Date(order.createdAt);
                            const diffTime = Math.abs(new Date().getTime() - createdAt.getTime());
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            const awb = order.awbCode || (order.trackingUrl ? order.trackingUrl.split('/').pop() : null);
                            const existingTicket = fullTickets.find(t => t.awb === awb);
                            const isCOD = (order.paymentMethod || '').toLowerCase() === 'cod';
                            return (
                                <tr key={order.id}>
                                    <td>
                                        <span className={styles.order}>
                                            <span className="pbx-mono">{order.name}</span>
                                            <Badge size="sm" dot={false} tone={isCOD ? 'neutral' : 'info'}>{isCOD ? 'COD' : 'Prepaid'}</Badge>
                                        </span>
                                    </td>
                                    <td>{order.customerName || 'N/A'}</td>
                                    <td className={styles.date}>{createdAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                                    <td><Badge size="sm" tone={tone}>{(order.deliveryStatus || 'Unknown').replace(/_/g, ' ')}</Badge></td>
                                    <td className={styles.muted}>{getGroupedCourierName(order.courierName)}</td>
                                    <td className={cx('pbx-num', styles.right)}>{diffDays}</td>
                                    <td>
                                        {existingTicket ? (
                                            <button type="button" className={styles.badgeButton} onClick={() => setViewingTicket(existingTicket)}>
                                                <Badge size="sm" dot={false} icon="life-buoy" tone={existingTicket.status === 'closed' ? 'neutral' : 'info'}>
                                                    {existingTicket.status === 'closed' ? 'Closed' : 'Ticket'}
                                                </Badge>
                                            </button>
                                        ) : (
                                            <span className="pbx-amount--none">—</span>
                                        )}
                                    </td>
                                    <td>
                                        <div className={styles.actions}>
                                            <Button size="sm" onClick={() => setSelectedOrder(order)}>Activities</Button>
                                            {order.trackingUrl && (
                                                <Tooltip content="Track shipment" repeatsLabel>
                                                    <a
                                                        href={order.trackingUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="pbx-btn pbx-btn--ghost pbx-btn--sm pbx-btn--icon"
                                                        aria-label={`Track ${order.name}`}
                                                    >
                                                        <Icon name="external-link" size={14} />
                                                    </a>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );

    if (isLoading) {
        return <Skeleton lines={8} />;
    }

    if (error) {
        return <Alert tone="negative" action={<Button size="sm" onClick={loadData}>Retry</Button>}>{error}</Alert>;
    }

    const lists: Record<string, ShopifyOrder[]> = {
        ofd: outForDeliveryOrders,
        attempted: attemptedDeliveryOrders,
        transit: inTransitOrders,
        other: stuckOrders,
    };
    const hasAnyOrders = outForDeliveryOrders.length > 0 || attemptedDeliveryOrders.length > 0 || inTransitOrders.length > 0 || stuckOrders.length > 0;

    return (
        <>
            <StatStrip>
                {TABLES.map((t) => (
                    <StatCard key={t.key} label={`${t.title} · ${t.rule}`} value={lists[t.key].length.toLocaleString('en-IN')} tone={lists[t.key].length > 0 ? 'caution' : 'neutral'} />
                ))}
            </StatStrip>

            {!hasAnyOrders && <EmptyState icon="circle-check" title="All caught up" description="No stuck or problematic orders." />}

            {TABLES.filter((t) => t.key !== 'other' || stuckOrders.length > 0).map((t) => (
                <Card key={t.key} title={`Stuck · ${t.title}`} eyebrow={`${t.rule} · ${lists[t.key].length} orders`} padding="sm">
                    {lists[t.key].length === 0 ? (
                        <EmptyState size="sm" icon="circle-check" title="No orders here" />
                    ) : (
                        orderTable(lists[t.key], t.tone)
                    )}
                </Card>
            ))}

            {selectedOrder && (
                <TrackingDialog order={selectedOrder} onClose={() => { setSelectedOrder(null); loadData(); }} />
            )}

            <TicketDrawer
                ticket={viewingTicket}
                onClose={() => setViewingTicket(null)}
                onUpdate={() => { loadData(); }}
            />
        </>
    );
}
