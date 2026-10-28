import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import toast from 'react-hot-toast';
import { Alert, Badge, Button, Card, DataList, DateField, Dialog, EmptyState, Skeleton, TextField } from '../../components/ui/pbx';
import { cx, formatINR } from '../../components/ui/format';
import { api, type ClaimMessage, type FreightClaimDetail } from '../../services/api';
import { istWhen } from './failureReasonsFormat';
import { CLAIM_HINT, CLAIM_LABEL, CLAIM_TONE, dayIst } from './freightClaimsFormat';
import shared from '../AnalysisPage.module.css';
import styles from './FreightClaims.module.css';

const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

/**
 * Closes a claim as refunded once you have found the credit in the Shiprocket wallet. Mounted only while open, so
 * each opening starts from the claim's freight and today.
 */
function MarkRefunded({ claim, onClose, onSaved }: { claim: FreightClaimDetail; onClose: () => void; onSaved: () => void }) {
    const [amount, setAmount] = useState(() => (claim.freight ? String(claim.freight.total) : ''));
    const [date, setDate] = useState(todayIst);
    const [note, setNote] = useState('');
    const [touched, setTouched] = useState(false);
    const [saving, setSaving] = useState(false);

    const value = Number(amount);
    const amountError = touched && !(value > 0) ? 'Enter the amount credited' : undefined;
    const dateError = touched && !date ? 'Pick the day it was credited' : undefined;

    const save = async () => {
        setTouched(true);
        if (!(value > 0) || !date) return;
        setSaving(true);
        try {
            const res = await api.markClaimRefunded(claim.order, { amount: value, date, note: note.trim() || undefined });
            if (!res.success) throw new Error(res.error || 'The refund could not be saved');
            toast.success(`${claim.order} marked refunded`);
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'The refund could not be saved');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog
            open
            onClose={saving ? undefined : onClose}
            title={`Mark ${claim.order} refunded`}
            description="Use this once the refund is in the Shiprocket wallet. The claim closes and is not chased again."
            icon="circle-check"
            tone="positive"
            size="sm"
            footer={
                <>
                    <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button variant="primary" onClick={save} loading={saving}>Mark refunded</Button>
                </>
            }
        >
            <div className={styles.form}>
                <TextField
                    label="Amount credited"
                    prefix="₹"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    error={amountError}
                    hint={claim.freight ? `Forward + RTO freight is ${formatINR(claim.freight.total)}` : undefined}
                />
                <DateField label="Credited on" value={date} onChange={setDate} max={todayIst()} required error={dateError} />
                <TextField label="Note" placeholder="Optional" multiline rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
        </Dialog>
    );
}

/**
 * One order's freight claim, in the panel beside the claims list (full width on narrow screens): where the claim
 * stands, what failed, the freight at stake, and the email thread with Shiprocket. A claim can be marked refunded here.
 */
export function ClaimDetail({ order, onClose, onChanged }: { order: string; onClose: () => void; onChanged?: () => void }) {
    const [claim, setClaim] = useState<FreightClaimDetail | null>(null);
    const [messages, setMessages] = useState<ClaimMessage[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [marking, setMarking] = useState(false);

    const load = async (quiet = false) => {
        if (!quiet) setIsLoading(true);
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

    useEffect(() => {
        setMarking(false);
        load();
    }, [order]);

    const close = <Button variant="ghost" size="sm" icon="x" iconOnly onClick={onClose}>Close</Button>;

    if (isLoading) return (
        <Card title={order} eyebrow="freight claim" padding="sm" actions={close}>
            <Skeleton lines={8} />
        </Card>
    );

    if (error || !claim) return (
        <Card title={order} eyebrow="freight claim" padding="sm" actions={close}>
            <Alert tone="negative" action={<Button size="sm" onClick={() => load()}>Retry</Button>}>{error ?? `${order} could not be loaded`}</Alert>
        </Card>
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
        <div className={styles.panel}>
            <Card title={c.order} eyebrow="freight claim" padding="sm" actions={close}>
                <div className={styles.stage}>
                    <Badge dot tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Badge>
                    <p className={styles.stageHint}>{CLAIM_HINT[c.status]}</p>
                    {c.nextStep ? <p className={styles.nextStep}>{`Next: ${c.nextStep}`}</p> : null}
                    {c.notes ? <p className={styles.stageHint}>{c.notes}</p> : null}
                    {c.manual ? (
                        <p className={styles.stageHint}>{`Marked refunded by hand on ${dayIst(c.manual.at)}${c.manual.note ? ` · ${c.manual.note}` : ''}`}</p>
                    ) : null}
                    {c.status !== 'refund_received' ? (
                        <Button variant="secondary" size="sm" icon="circle-check" onClick={() => setMarking(true)}>Mark refunded</Button>
                    ) : null}
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

            {/* On the page body, not in the sticky panel, so the dialog covers the whole screen. */}
            {marking
                ? createPortal(
                    <MarkRefunded
                        claim={c}
                        onClose={() => setMarking(false)}
                        onSaved={() => {
                            setMarking(false);
                            load(true);
                            onChanged?.();
                        }}
                    />,
                    document.body,
                )
                : null}
        </div>
    );
}
