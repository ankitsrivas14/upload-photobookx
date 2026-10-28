import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, Card, DataTable, EmptyState, Skeleton, StatCard, StatStrip, Tabs, type Column } from '../../components/ui/pbx';
import { formatINR } from '../../components/ui/format';
import { api, type FailedOrderReason, type FailureMonth } from '../../services/api';
import { failRate, fmt, monthLabel, pct, shortGroup } from './failureReasonsFormat';
import shared from '../AnalysisPage.module.css';
import styles from './FailureReasons.module.css';

interface MonthData {
    groups: string[];
    summary: FailureMonth;
    orders: FailedOrderReason[];
}

const placedDay = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '–';

const COLUMNS: Column<FailedOrderReason>[] = [
    { key: 'order', header: 'Order', mono: true, render: (o) => o.order },
    { key: 'placed', header: 'Placed', render: (o) => <span className={shared.date}>{placedDay(o.placedAt)}</span> },
    { key: 'payment', header: 'Payment', render: (o) => o.payment },
    { key: 'value', header: 'Value', numeric: true, render: (o) => formatINR(o.value) },
    { key: 'courier', header: 'Courier', render: (o) => <span className={styles.nowrap}>{o.courier ?? '–'}</span> },
    {
        key: 'reason',
        header: 'Why it failed',
        render: (o) => (
            <span className={styles.reason}>
                <span className={styles.reasonGroup}>{o.group}</span>
                <span className={styles.reasonWords}>{o.reason ?? 'Not read from tracking yet'}</span>
            </span>
        ),
    },
    { key: 'attempts', header: 'Attempts', numeric: true, render: (o) => (o.attempts == null ? '–' : o.attempts) },
];

/** One month of failed Shiprocket orders: its counts, then every order with why it failed, filterable by reason group. */
export function FailureReasonsMonth() {
    const { month = '' } = useParams();
    const navigate = useNavigate();
    const [data, setData] = useState<MonthData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [group, setGroup] = useState('all');

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.getFailureReasonsMonth(month);
            if (res.success && res.summary) {
                setData({ groups: res.groups ?? [], summary: res.summary, orders: res.orders ?? [] });
            } else {
                setError(res.error || `${monthLabel(month)} could not be loaded`);
            }
        } catch {
            setError(`${monthLabel(month)} could not be loaded`);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        setGroup('all');
        load();
    }, [month]);

    const back = (
        <div className={shared.toolbar}>
            <Button variant="ghost" size="sm" icon="chevron-left" onClick={() => navigate('/admin/analysis/failure-reasons')}>
                All months
            </Button>
        </div>
    );

    if (isLoading) return <>{back}<Skeleton lines={8} /></>;

    if (error || !data) return (
        <>
            {back}
            <Alert tone="negative" action={<Button size="sm" onClick={load}>Retry</Button>}>{error ?? `${monthLabel(month)} could not be loaded`}</Alert>
        </>
    );

    const s = data.summary;
    const rows = group === 'all' ? data.orders : data.orders.filter((o) => o.group === group);
    const tabs = [
        { id: 'all', label: 'All', count: data.orders.length },
        ...data.groups.filter((g) => s.groups[g] > 0).map((g) => ({ id: g, label: shortGroup(g), count: s.groups[g] })),
    ];

    return (
        <>
            {back}

            <StatStrip>
                <StatCard label="Failed orders" value={fmt(s.failed)} tone="negative" sub={monthLabel(month)} />
                <StatCard label="Failed %" value={pct(failRate(s))} sub={`of ${fmt(s.failed + s.delivered)} delivered or failed`} />
                <StatCard label="COD / prepaid" value={`${fmt(s.cod)} / ${fmt(s.prepaid)}`} sub="of the failed orders" />
                <StatCard label="Order value" value={formatINR(s.value)} sub="of the failed orders" />
            </StatStrip>

            {s.settling ? (
                <Alert tone="info" title="Returns are still coming in">
                    {`${fmt(s.open)} of this month's ${fmt(s.orders)} orders are still moving or not shipped yet, so more of them may fail.`}
                </Alert>
            ) : null}

            <Card title={monthLabel(month)} eyebrow="failed orders" padding="none">
                {data.orders.length ? <Tabs items={tabs} value={group} onChange={setGroup} label="Reason groups" className={styles.tabs} /> : null}
                <DataTable
                    columns={COLUMNS}
                    rows={rows}
                    getRowId={(o) => o.order}
                    empty={<EmptyState size="sm" icon="package" title={s.settling ? 'No failed orders yet' : 'No failed orders'} />}
                    caption={`Failed orders placed in ${monthLabel(month)}`}
                />
            </Card>
        </>
    );
}
