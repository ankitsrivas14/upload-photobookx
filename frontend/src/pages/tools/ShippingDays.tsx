import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Switch, type Column } from '../../components/ui/pbx';
import { formatINR } from '../../components/ui/format';
import { api, type SetAsideOrder, type ShippingDay, type ShippingRun } from '../../services/api';
import styles from './Labels.module.css';

type Kind = 'labels' | 'manifest';
interface Auto { enabled: boolean; lastRunAt: string | null; lastRun: ShippingRun | null }

const when = (iso: string | null) =>
    iso
        ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
        : '—';

function lastRunLine(auto: Auto): string {
    const run = auto.lastRun;
    if (!run || !auto.lastRunAt) return 'It has not run yet.';
    const couriers = Object.entries(run.byCourier).map(([name, n]) => `${name} ${n}`).join(', ');
    const booked = run.booked
        ? `booked ${run.booked} for ${formatINR(run.cost, { decimals: 2 })}${couriers ? ` (${couriers})` : ''}`
        : 'nothing new to book';
    return `Last run ${when(auto.lastRunAt)} IST: ${booked}. Wallet ${formatINR(run.wallet)}.`;
}

/**
 * Tools › Labels: the files of the 2-hourly booking job. Each day collects the labels and manifest rows of everything
 * booked while it is open; downloading either PDF closes it, and later bookings start the next day.
 */
export function ShippingDays() {
    const [auto, setAuto] = useState<Auto | null>(null);
    const [days, setDays] = useState<ShippingDay[] | null>(null);
    const [aside, setAside] = useState<SetAsideOrder[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await api.getShipping();
            if (!res.success) throw new Error(res.error);
            setAuto(res.auto ?? null);
            setDays(res.days ?? []);
            setAside(res.aside ?? []);
            setError(null);
        } catch (err) {
            setError(err instanceof Error && err.message ? err.message : 'The shipping days could not be loaded');
            setDays((d) => d ?? []);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const download = async (day: ShippingDay, kind: Kind) => {
        setBusy(`${day.id}:${kind}`);
        try {
            await api.downloadShippingFile(day.id, kind);
            if (day.open) toast.success('Day closed. New bookings go into the next day.');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'The download failed');
        } finally {
            setBusy(null);
            load();
        }
    };

    const toggle = async (enabled: boolean) => {
        setBusy('switch');
        const res = await api.setShippingAuto(enabled).catch(() => null);
        setBusy(null);
        if (!res?.success) {
            toast.error(res?.error || 'The switch could not be changed');
            return;
        }
        setAuto((a) => (a ? { ...a, enabled } : a));
    };

    const columns: Column<ShippingDay>[] = [
        {
            key: 'day',
            header: 'Day',
            render: (d) => (
                <span className={styles.dayCell}>
                    {when(d.openedAt)}
                    {d.open ? <Badge tone="positive" dot size="sm">Open</Badge> : <span className={styles.closed}>to {when(d.closedAt)}</span>}
                </span>
            ),
        },
        { key: 'labels', header: 'Labels', numeric: true, width: 72, render: (d) => d.labels.toLocaleString('en-IN') },
        {
            key: 'couriers',
            header: 'Couriers',
            render: (d) => d.couriers.map((c) => `${c.name} ${c.count}`).join(' · ') || '—',
        },
        {
            key: 'files',
            header: 'Download',
            align: 'right',
            render: (d) => (
                <span className={styles.fileButtons}>
                    {(['labels', 'manifest'] as Kind[]).map((kind) => (
                        <Button
                            key={kind}
                            size="sm"
                            variant="secondary"
                            icon="download"
                            loading={busy === `${d.id}:${kind}`}
                            disabled={!d.labels || busy !== null}
                            tooltip={d.open ? 'Downloading closes this day' : undefined}
                            onClick={() => download(d, kind)}
                        >
                            {kind === 'labels' ? 'Labels' : 'Manifest'}
                        </Button>
                    ))}
                </span>
            ),
        },
    ];

    const asideColumns: Column<SetAsideOrder>[] = [
        { key: 'order', header: 'Order', mono: true, width: 96, render: (o) => o.order },
        { key: 'amount', header: 'COD', numeric: true, width: 88, render: (o) => (o.amount == null ? '—' : formatINR(o.amount)) },
        { key: 'reason', header: 'Why', render: (o) => o.reason },
        { key: 'since', header: 'Checked', width: 132, render: (o) => when(o.since) },
    ];

    const run = auto?.lastRun ?? null;
    return (
        <>
            {error && (
                <Alert tone="negative" title="Shipping days unavailable">
                    {error}
                </Alert>
            )}

            {auto && (
                <Card
                    title="Auto-booking"
                    description="Every 2 hours, Claude Code on your Mac books the NEW Shiprocket orders: the cheapest of Delhivery, Xpressbees, Blue Dart and DTDC unless its NDR or RTO scores are poor, prepaid first. COD orders with an address too thin to deliver are set aside. It runs while the Claude app is open."
                    actions={
                        <Switch
                            label={auto.enabled ? 'On' : 'Off'}
                            checked={auto.enabled}
                            disabled={busy === 'switch'}
                            onChange={(e) => toggle(e.target.checked)}
                        />
                    }
                >
                    <p className={styles.note}>{auto.enabled ? lastRunLine(auto) : 'Off: the job books nothing until it is switched back on.'}</p>
                    {run && run.recharge > 0 && (
                        <Alert tone="negative" title={`Recharge the Shiprocket wallet by at least ${formatINR(run.recharge)}`}>
                            Waiting for money: {run.waiting.map((w) => w.order).join(', ')}. Shiprocket books only while the wallet keeps ₹100.
                        </Alert>
                    )}
                    {run && run.failed.length > 0 && (
                        <Alert tone="caution" title="Not booked on the last run">
                            {run.failed.map((f) => `${f.order}: ${f.reason}`).join('; ')}
                        </Alert>
                    )}
                    {run && run.notes.length > 0 && <p className={styles.note}>{run.notes.join(' · ')}</p>}
                </Card>
            )}

            <Card
                title="Daily files"
                description="Labels and manifest for everything booked while a day is open. Downloading either file closes the day; later bookings start the next one."
                padding="none"
            >
                <DataTable
                    columns={columns}
                    rows={days ?? []}
                    getRowId={(d) => d.id}
                    loading={days === null}
                    caption="Shipping days, latest first"
                    empty={<EmptyState size="sm" icon="truck" title="No days yet" description="The first booking opens one." />}
                />
            </Card>

            {aside.length > 0 && (
                <Card
                    title="Set aside"
                    description="COD orders whose address looks too thin or bogus to deliver. They stay NEW in Shiprocket: call the customer and fix the address there, or book them by hand."
                    padding="none"
                >
                    <DataTable columns={asideColumns} rows={aside} getRowId={(o) => o.order} caption="COD orders set aside" />
                </Card>
            )}
        </>
    );
}
