import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Icon, Skeleton, StatCard, StatStrip, Tabs, type Column } from '../../components/ui/pbx';
import { formatINR } from '../../components/ui/format';
import { api, type ClaimStatus, type FreightClaim } from '../../services/api';
import { fmt } from './failureReasonsFormat';
import { CLAIM_LABEL, CLAIM_TONE, CLOSED_STAGES, OPEN_STAGES, dayIst } from './freightClaimsFormat';
import shared from '../AnalysisPage.module.css';
import styles from './FreightClaims.module.css';

const lastMessage = (c: FreightClaim) =>
    c.lastMessageAt ? `${c.lastMessageFrom === 'us' ? 'Us' : 'Shiprocket'} · ${dayIst(c.lastMessageAt)}` : '–';

/**
 * Freight claims: every failed order outside "Refused or cancelled at the door", newest first, with how far its claim
 * with Shiprocket has got. Each order opens its own page with the email thread.
 */
export function FreightClaims() {
    const navigate = useNavigate();
    const [claims, setClaims] = useState<FreightClaim[] | null>(null);
    const [statuses, setStatuses] = useState<ClaimStatus[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [tab, setTab] = useState('all');

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.getFreightClaims();
            if (res.success) {
                setClaims(res.claims ?? []);
                setStatuses(res.statuses ?? []);
            } else {
                setError(res.error || 'Freight claims could not be loaded');
            }
        } catch {
            setError('Freight claims could not be loaded');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const rows = useMemo(() => (claims ?? []).filter((c) => tab === 'all' || c.status === tab), [claims, tab]);

    if (isLoading) return <Skeleton lines={8} />;

    if (error || !claims) return (
        <Alert tone="negative" action={<Button size="sm" onClick={load}>Retry</Button>}>{error ?? 'Freight claims could not be loaded'}</Alert>
    );

    const count = (s: ClaimStatus) => claims.filter((c) => c.status === s).length;
    const open = claims.filter((c) => OPEN_STAGES.includes(c.status)).length;
    const atStake = claims.filter((c) => !CLOSED_STAGES.includes(c.status)).reduce((s, c) => s + (c.freight?.total ?? 0), 0);
    const refunded = claims.reduce((s, c) => s + (c.refund?.receivedAmount ?? 0), 0);
    const tabs = [
        { id: 'all', label: 'All', count: claims.length },
        ...statuses.map((s) => ({ id: s, label: CLAIM_LABEL[s], count: count(s) })),
    ];

    const columns: Column<FreightClaim>[] = [
        { key: 'order', header: 'Order', mono: true, render: (c) => <span className={styles.nowrap}>{c.order}</span> },
        { key: 'placed', header: 'Placed', render: (c) => <span className={shared.date}>{dayIst(c.placedAt)}</span> },
        { key: 'courier', header: 'Courier', render: (c) => <span className={styles.nowrap}>{c.courier ?? '–'}</span> },
        {
            key: 'reason',
            header: 'Why it failed',
            render: (c) => (
                <span className={styles.reason}>
                    <span className={styles.reasonGroup}>{c.group}</span>
                    <span className={styles.reasonWords}>{c.reason ?? '–'}</span>
                </span>
            ),
        },
        { key: 'freight', header: 'Freight', numeric: true, render: (c) => (c.freight ? formatINR(c.freight.total) : '–') },
        { key: 'status', header: 'Claim', render: (c) => <Badge size="sm" dot tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Badge> },
        { key: 'ticket', header: 'Ticket', mono: true, render: (c) => (c.tickets.length ? c.tickets.join(', ') : '–') },
        { key: 'last', header: 'Last message', render: (c) => <span className={styles.nowrap}>{lastMessage(c)}</span> },
        { key: 'open', header: <span className="pbx-sr">Open</span>, width: 28, render: () => <Icon name="chevron-right" size={16} className={styles.chevron} aria-hidden="true" /> },
    ];

    return (
        <>
            <StatStrip>
                <StatCard label="In the pipeline" value={fmt(claims.length)} sub="failed orders, newest first" />
                <StatCard label="Open claims" value={fmt(open)} sub="tickets with Shiprocket" />
                <StatCard label="Freight at stake" value={formatINR(atStake, { compact: true })} sub="forward + RTO, claims not closed" />
                <StatCard label="Refunded" value={formatINR(refunded)} tone={refunded > 0 ? 'positive' : undefined} sub={`${fmt(count('refund_received'))} claims`} />
            </StatStrip>

            <Card
                title="Claims"
                description="Every failed order except those refused or cancelled at the door, newest first. Open an order for its conversation with Shiprocket."
                padding="none"
            >
                <Tabs items={tabs} value={tab} onChange={setTab} label="Claim stages" className={styles.tabs} />
                <DataTable
                    columns={columns}
                    rows={rows}
                    getRowId={(c) => c.order}
                    onRowClick={(c) => navigate(`/admin/analysis/freight-claims/${encodeURIComponent(c.order)}`)}
                    empty={<EmptyState size="sm" icon="package" title="No claims at this stage" />}
                    caption="Freight claims"
                />
            </Card>

            <p className={shared.note}>
                Tickets go to support@shiprocket.com from hi@photobookx.com through Richpanel, and each conversation is copied here.
            </p>
        </>
    );
}
