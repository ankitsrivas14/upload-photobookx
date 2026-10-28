import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import { Alert, Badge, Button, Card, DataList, DataTable, EmptyState, Icon, Skeleton, StatCard, StatStrip, type Column } from '../../components/ui/pbx';
import { formatINR } from '../../components/ui/format';
import { api, type FailureMonth, type FailureReasonGroup } from '../../services/api';
import { AXIS_TICK, CURSOR_FILL } from '../dashboard/chartStyles';
import { LineSwatch } from '../dashboard/LineSwatch';
import { failRate, fmt, istWhen, monthLabel, pct, shortGroup } from './failureReasonsFormat';
import shared from '../AnalysisPage.module.css';
import styles from './FailureReasons.module.css';

interface Overview {
    refreshedAt: string | null;
    groups: string[];
    months: FailureMonth[];
    reasons: FailureReasonGroup[];
}

interface ChartRow {
    month: string;
    label: string;
    title: string;
    /** Failed %, 0–100. */
    rate: number;
    failed: number;
    finished: number;
}

function RateTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
    const row = active ? (payload?.[0]?.payload as ChartRow | undefined) : undefined;
    if (!row) return null;
    return (
        <div className={styles.tip}>
            <div className={styles.tipTitle}>{row.title}</div>
            <div className={styles.tipValue}>{`${row.rate.toFixed(1)}% failed`}</div>
            <div className={styles.tipSub}>{`${fmt(row.failed)} of ${fmt(row.finished)} delivered or failed`}</div>
        </div>
    );
}

/** Failed % per month as bars on a 5-point scale, with the average over the months shown as a dashed line. */
function RateChart({ rows, average }: { rows: ChartRow[]; average: number | null }) {
    const top = Math.max(5, Math.ceil(Math.max(average ?? 0, ...rows.map((r) => r.rate)) / 5) * 5);
    const ticks = Array.from({ length: top / 5 + 1 }, (_, i) => i * 5);
    return (
        <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={rows} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} interval="preserveStartEnd" minTickGap={12} />
                <YAxis ticks={ticks} domain={[0, top]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${v}%`} />
                <ChartTooltip cursor={CURSOR_FILL} content={({ active, payload }) => <RateTooltip active={active} payload={payload} />} />
                <Bar dataKey="rate" fill="var(--chart-bar)" maxBarSize={40} isAnimationActive={false} />
                {average != null ? <ReferenceLine y={average} stroke="var(--ink-subtle)" strokeDasharray="4 3" /> : null}
            </ComposedChart>
        </ResponsiveContainer>
    );
}

/**
 * Failure reasons: failed Shiprocket orders (returned to us, lost, destroyed or disposed of) month by month, grouped by
 * why they failed. Each month opens its own page with the orders and the couriers' words.
 */
export function FailureReasons() {
    const navigate = useNavigate();
    const [data, setData] = useState<Overview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.getFailureReasons();
            if (res.success) {
                setData({ refreshedAt: res.refreshedAt ?? null, groups: res.groups ?? [], months: res.months ?? [], reasons: res.reasons ?? [] });
            } else {
                setError(res.error || 'Failure reasons could not be loaded');
            }
        } catch {
            setError('Failure reasons could not be loaded');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const chart = useMemo(() => {
        const rows: ChartRow[] = (data?.months ?? [])
            .filter((m) => !m.settling && failRate(m) != null)
            .slice()
            .reverse()
            .map((m) => ({
                month: m.month,
                label: monthLabel(m.month, true),
                title: monthLabel(m.month),
                rate: (failRate(m) ?? 0) * 100,
                failed: m.failed,
                finished: m.failed + m.delivered,
            }));
        const failed = rows.reduce((s, r) => s + r.failed, 0);
        const finished = rows.reduce((s, r) => s + r.finished, 0);
        return { rows, average: finished > 0 ? (failed / finished) * 100 : null };
    }, [data]);

    if (isLoading) return <Skeleton lines={8} />;

    if (error || !data) return (
        <Alert tone="negative" action={<Button size="sm" onClick={load}>Retry</Button>}>{error ?? 'Failure reasons could not be loaded'}</Alert>
    );

    if (!data.months.length) return (
        <EmptyState icon="truck" title="No failure data yet" description="The nightly sync reads failed orders from Shiprocket and fills this in." />
    );

    const total = data.months.reduce((s, m) => s + m.failed, 0);
    const delivered = data.months.reduce((s, m) => s + m.delivered, 0);
    const value = data.months.reduce((s, m) => s + m.value, 0);
    const withFailures = data.months.filter((m) => m.failed > 0);
    const oldest = withFailures[withFailures.length - 1]?.month;
    const newest = withFailures[0]?.month;
    const span = !oldest || !newest
        ? ''
        : oldest.slice(0, 4) === newest.slice(0, 4)
            ? `${monthLabel(oldest, true)}–${monthLabel(newest, true)} ${newest.slice(0, 4)}`
            : `${monthLabel(oldest, true)} ${oldest.slice(0, 4)}–${monthLabel(newest, true)} ${newest.slice(0, 4)}`;
    const countOf = (group: string) => data.reasons.find((r) => r.group === group)?.count ?? 0;
    const [first, second] = data.groups;
    const settling = data.months.filter((m) => m.settling);

    const columns: Column<FailureMonth>[] = [
        {
            key: 'month',
            header: 'Month',
            render: (m) => (
                <span className={styles.monthCell}>
                    {monthLabel(m.month)}
                    {m.settling ? <Badge size="sm" tone="info">Still coming in</Badge> : null}
                </span>
            ),
        },
        { key: 'orders', header: 'Orders', numeric: true, render: (m) => fmt(m.orders) },
        { key: 'failed', header: 'Failed', numeric: true, render: (m) => fmt(m.failed) },
        { key: 'rate', header: 'Failed %', numeric: true, render: (m) => pct(failRate(m)) },
        ...data.groups.map((g): Column<FailureMonth> => ({
            key: g,
            header: shortGroup(g),
            numeric: true,
            render: (m) => (m.groups[g] ? fmt(m.groups[g]) : '–'),
        })),
        { key: 'open', header: <span className="pbx-sr">Open</span>, width: 28, render: () => <Icon name="chevron-right" size={16} className={styles.chevron} aria-hidden="true" /> },
    ];

    const reasons = data.reasons
        .filter((r) => r.count > 0)
        .map((r) => ({
            label: r.group,
            sub: r.wordings.slice(0, 2).map((w) => `${w.reason} (${fmt(w.count)})`).join(' · '),
            value: `${fmt(r.count)} · ${pct(total ? r.count / total : null, 0)}`,
        }));

    return (
        <>
            <StatStrip>
                <StatCard label="Failed orders" value={fmt(total)} tone="negative" sub={`${span} · ${formatINR(value, { compact: true })} of orders`} />
                <StatCard label="Failed %" value={pct(total + delivered ? total / (total + delivered) : null)} sub="of orders delivered or failed" />
                {first ? <StatCard label={shortGroup(first)} value={fmt(countOf(first))} sub={`${pct(total ? countOf(first) / total : null, 0)} of failed orders`} /> : null}
                {second ? <StatCard label={shortGroup(second)} value={fmt(countOf(second))} sub={`${pct(total ? countOf(second) / total : null, 0)} of failed orders`} /> : null}
            </StatStrip>

            <div className={styles.overview}>
                <Card
                    title="Failed % by month"
                    eyebrow="delivered or failed orders"
                    padding="sm"
                    footer={
                        <div className={styles.keys}>
                            {chart.average != null ? (
                                <span className={styles.key}>
                                    <LineSwatch color="var(--ink-subtle)" />
                                    {`avg ${chart.average.toFixed(1)}%`}
                                </span>
                            ) : null}
                            {settling.length ? (
                                <span className={styles.key}>{`Not shown while returns come in: ${settling.map((m) => monthLabel(m.month, true)).join(', ')}`}</span>
                            ) : null}
                        </div>
                    }
                >
                    {chart.rows.length ? (
                        <RateChart rows={chart.rows} average={chart.average} />
                    ) : (
                        <EmptyState size="sm" icon="chart-column" title="No finished month yet" />
                    )}
                </Card>

                <Card title="Why they failed" eyebrow="all months" padding="sm">
                    <DataList items={reasons} total={{ label: 'All failed orders', value: fmt(total) }} />
                </Card>
            </div>

            <Card
                title="By month"
                description="Each order counts in the month it was placed. Open a month for its orders and the couriers' own words."
                padding="none"
            >
                <DataTable
                    columns={columns}
                    rows={data.months}
                    getRowId={(m) => m.month}
                    onRowClick={(m) => navigate(`/admin/analysis/failure-reasons/${m.month}`)}
                    caption="Failed Shiprocket orders by month"
                />
            </Card>

            <p className={shared.note}>
                {`From Shiprocket, refreshed nightly; last ${istWhen(data.refreshedAt)}. Failed means returned to us (RTO), lost, destroyed or disposed of; cancelled orders are not counted. The reason is the courier's last failed delivery attempt before the return.`}
            </p>
        </>
    );
}
