import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Badge, Button, Card, DataList, EmptyState, Skeleton } from '../../components/ui/pbx';
import { cx, formatINR } from '../../components/ui/format';
import { api, type ClaimMessage, type FreightClaim as Claim } from '../../services/api';
import { istWhen } from './failureReasonsFormat';
import { CLAIM_HINT, CLAIM_LABEL, CLAIM_TONE, dayIst } from './freightClaimsFormat';
import shared from '../AnalysisPage.module.css';
import styles from './FreightClaims.module.css';

type Detail = Claim & { richpanel: { id: string; number: number | null; url: string | null } | null; notes: string | null };

/** One order's freight claim: what failed, the freight at stake, where the claim stands, and the email thread. */
export function FreightClaim() {
    const { order = '' } = useParams();
    const navigate = useNavigate();
    const [claim, setClaim] = useState<Detail | null>(null);
    const [messages, setMessages] = useState<ClaimMessage[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.getFreightClaim(order);
            if (res.success && res.claim) {
                setClaim(res.claim);
                setMessages(res.messages ?? []);
            } else {
                setError(res.error || `${order} could not be loaded`);
            }
        } catch {
            setError(`${order} could not be loaded`);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, [order]);

    const back = (
        <div className={shared.toolbar}>
            <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => navigate('/admin/analysis/freight-claims')}>
                All claims
            </Button>
        </div>
    );

    if (isLoading) return <>{back}<Skeleton lines={8} /></>;

    if (error || !claim) return (
        <>
            {back}
            <Alert tone="negative" action={<Button size="sm" onClick={load}>Retry</Button>}>{error ?? `${order} could not be loaded`}</Alert>
        </>
    );

    const c = claim;
    const facts = [
        { label: 'AWB', value: <span className={styles.mono}>{c.awb ?? '–'}</span> },
        { label: 'Courier', value: c.courier ?? '–' },
        { label: 'Placed', value: dayIst(c.placedAt) },
        { label: 'Payment', value: `${c.payment} · ${formatINR(c.value)}` },
        {
            label: 'Freight',
            sub: c.freight ? `forward ${formatINR(c.freight.forward)} + RTO ${formatINR(c.freight.rto)}` : 'no Shiprocket charge on record',
            value: c.freight ? formatINR(c.freight.total) : '–',
        },
        { label: 'Shiprocket ticket', value: <span className={styles.mono}>{c.tickets.length ? c.tickets.join(', ') : '–'}</span> },
        ...(c.refund?.promisedAt
            ? [{ label: 'Refund promised', sub: dayIst(c.refund.promisedAt), value: c.refund.promisedAmount != null ? formatINR(c.refund.promisedAmount) : '–' }]
            : []),
        ...(c.refund?.receivedAt
            ? [{ label: 'Refund received', sub: dayIst(c.refund.receivedAt), value: c.refund.receivedAmount != null ? formatINR(c.refund.receivedAmount) : '–', tone: 'positive' as const }]
            : []),
    ];

    return (
        <>
            {back}

            <div className={styles.layout}>
                <div className={styles.side}>
                    <Card title={c.order} eyebrow="freight claim" padding="sm">
                        <div className={styles.stage}>
                            <Badge dot tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Badge>
                            <p className={styles.stageHint}>{CLAIM_HINT[c.status]}</p>
                            {c.nextStep ? <p className={styles.nextStep}>{`Next: ${c.nextStep}`}</p> : null}
                            {c.notes ? <p className={styles.stageHint}>{c.notes}</p> : null}
                        </div>
                    </Card>
                    <Card title="Order" padding="sm">
                        <p className={styles.failure}>
                            <span className={styles.reasonGroup}>{c.group}</span>
                            <span className={styles.reasonWords}>
                                {`${c.reason ?? 'No courier wording'}${c.attempts == null ? '' : ` · ${c.attempts} delivery attempt${c.attempts === 1 ? '' : 's'}`}`}
                            </span>
                        </p>
                        <DataList items={facts} />
                    </Card>
                </div>

                <Card
                    title="Conversation"
                    eyebrow="support@shiprocket.com"
                    padding="sm"
                    actions={
                        c.richpanel?.url ? (
                            <a className={shared.link} href={c.richpanel.url} target="_blank" rel="noreferrer">Open in Richpanel</a>
                        ) : null
                    }
                >
                    {messages.length ? (
                        <ol className={styles.thread}>
                            {messages.map((m) =>
                                m.kind === 'survey' ? (
                                    <li key={m.id} className={styles.survey}>{`Shiprocket sent a rating survey · ${istWhen(m.at)}`}</li>
                                ) : (
                                    <li key={m.id} className={cx(styles.message, m.from === 'us' ? styles.fromUs : styles.fromThem)}>
                                        <span className={styles.messageHead}>{`${m.from === 'us' ? 'PhotoBookX' : 'Shiprocket'} · ${istWhen(m.at)}`}</span>
                                        <p className={styles.messageText}>{m.text}</p>
                                    </li>
                                ),
                            )}
                        </ol>
                    ) : (
                        <EmptyState size="sm" icon="message-circle" title="No conversation yet" description="No ticket has been raised for this order yet." />
                    )}
                </Card>
            </div>
        </>
    );
}
