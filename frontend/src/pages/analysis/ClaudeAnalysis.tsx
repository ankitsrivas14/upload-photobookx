import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { ClaudeCall, ClaudeReview, ClaudeWindow } from '../../services/api';
import { Alert, Badge, Card, DataList, EmptyState, Icon, Select, Skeleton, StatCard, StatStrip } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import styles from '../AnalysisPage.module.css';

const DECISION_TONES: Record<string, 'info' | 'brand' | 'positive' | 'caution' | 'negative'> = {
    SCALE: 'info',
    DUPLICATE: 'brand',
    CONTINUE: 'positive',
    MONITOR: 'caution',
    CLOSE: 'negative',
};

const WINDOWS: Array<[string, string]> = [
    ['yesterday', 'Yesterday'],
    ['last3', 'Last 3 days'],
    ['active7', 'Last 7 active days'],
    ['active30', 'Last 30 active days'],
];

const inr = (n?: number | null) => (n == null ? '—' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const formatDate = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const formatTime = (iso?: string) =>
    iso ? `${new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} IST` : '';

export function ClaudeAnalysis() {
    const [dates, setDates] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState('');
    const [review, setReview] = useState<ClaudeReview | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        loadDates();
    }, []);

    const loadDates = async () => {
        try {
            const res = await api.getClaudeAnalysisDates();
            const found = res.success ? res.dates || [] : [];
            setDates(found);
            if (!res.success) setError(res.error || 'Failed to load review dates');
            if (found.length > 0) {
                await loadReview(found[0]);
            } else {
                setIsLoading(false);
            }
        } catch (err) {
            console.error('Error loading Claude analysis dates:', err);
            setError('Failed to load Claude analysis');
            setIsLoading(false);
        }
    };

    const loadReview = async (date: string) => {
        setSelectedDate(date);
        setIsLoading(true);
        setError('');
        try {
            const res = await api.getClaudeAnalysis(date);
            setReview(res.success ? res.review || null : null);
            if (!res.success) setError(res.error || 'Failed to load this review');
        } catch (err) {
            console.error('Error loading Claude analysis:', err);
            setError('Failed to load this review');
        } finally {
            setIsLoading(false);
        }
    };

    const breakeven = review?.breakeven?.metaRoas;

    return (
        <>
            <div className={styles.toolbar}>
                <Select
                    label="Review"
                    inlineLabel
                    size="sm"
                    value={selectedDate}
                    onChange={(v) => v && loadReview(v)}
                    disabled={dates.length === 0}
                    options={dates.length === 0 ? [{ value: '', label: 'No reviews yet' }] : dates.map((d) => ({ value: d, label: formatDate(d) }))}
                />
                {review?.dataAsOf && <span className={styles.meta}>{`data as of ${formatTime(review.dataAsOf)}`}</span>}
            </div>

            {error && <Alert tone="negative">{error}</Alert>}

            {isLoading ? (
                <Skeleton lines={8} />
            ) : !review ? (
                !error && (
                    <EmptyState
                        icon="sparkles"
                        title="No reviews yet"
                        description={'Each "ads" review in Claude Code shows up here with the decision and the reason for every ad set.'}
                    />
                )
            ) : (
                <>
                    <Summary review={review} />
                    {review.previousGrading && review.previousGrading.length > 0 && (
                        <Card title="How the previous calls played out">
                            <DataList
                                items={review.previousGrading.map((g) => ({
                                    label: g.adsetName,
                                    sub: g.outcome,
                                    value: <Badge size="sm" tone={DECISION_TONES[g.decision] ?? 'neutral'} dot={false}>{g.decision}</Badge>,
                                }))}
                            />
                        </Card>
                    )}
                    {review.calls.map((call) => (
                        <CallCard key={call.adsetId} call={call} breakeven={breakeven} />
                    ))}
                    <Footnotes checks={review.checks} notes={review.notes} />
                </>
            )}
        </>
    );
}

function Summary({ review }: { review: ClaudeReview }) {
    const be = review.breakeven;
    return (
        <>
            <StatStrip>
                <StatCard label="Breakeven ROAS (Meta)" value={be ? be.metaRoas.toFixed(2) : '—'} />
                <StatCard label="Orders delivered" value={be ? `${be.deliveryRatePct}%` : '—'} />
                <StatCard label="Margin per order" value={be ? inr(be.marginPerOrder) : '—'} />
                <StatCard
                    label="Daily budget"
                    value={review.account ? inr(review.account.budgetAfter) : '—'}
                    sub={review.account && review.account.budgetBefore !== review.account.budgetAfter ? `was ${inr(review.account.budgetBefore)}` : undefined}
                />
            </StatStrip>
            {review.summary && (
                <Card title={`Review · ${formatDate(review.date)}`}>
                    <p className={styles.prose}>{review.summary}</p>
                </Card>
            )}
        </>
    );
}

function Footnotes({ checks = [], notes = [] }: { checks?: string[]; notes?: string[] }) {
    if (checks.length === 0 && notes.length === 0) return null;
    return (
        <div className={styles.row}>
            {checks.length > 0 && (
                <Card title="Check at the next review">
                    <ul className={styles.list}>{checks.map((c) => <li key={c}>{c}</li>)}</ul>
                </Card>
            )}
            {notes.length > 0 && (
                <Card title="Notes">
                    <ul className={styles.list}>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </Card>
            )}
        </div>
    );
}

function CallCard({ call, breakeven }: { call: ClaudeCall; breakeven?: number }) {
    const budgetChanged = call.budgetBefore != null && call.budgetAfter != null && call.budgetBefore !== call.budgetAfter;
    const paused = call.statusAfter === 'PAUSED';
    const budgetText = paused
        ? `Paused (was ${inr(call.budgetBefore)}/day)`
        : budgetChanged
            ? `${inr(call.budgetBefore)} → ${inr(call.budgetAfter)}/day`
            : `${inr(call.budgetAfter ?? call.budgetBefore)}/day`;
    const appliedText = call.applied
        ? `Applied ${formatTime(call.applied.at)}${call.applied.confirmed ? ' · confirmed in Meta' : ' · not confirmed in Meta'}`
        : budgetChanged || paused ? 'Not applied yet' : 'No change needed';

    return (
        <Card
            title={call.adsetName}
            eyebrow={call.campaignName}
            actions={
                <>
                    <Badge tone={DECISION_TONES[call.decision] ?? 'neutral'} dot={false}>{call.decision}</Badge>
                    <span className={styles.budget}>{budgetText}</span>
                </>
            }
            footer={
                <span className={cx(styles.applied, call.applied?.confirmed && styles.appliedOk)}>
                    <Icon name={call.applied ? 'circle-check' : 'info'} size={13} />
                    {appliedText}
                </span>
            }
        >
            <p className={styles.prose}>{call.reason}</p>
            {call.metrics && <Metrics metrics={call.metrics} breakeven={breakeven} />}
        </Card>
    );
}

function Metrics({ metrics, breakeven }: { metrics: Record<string, ClaudeWindow>; breakeven?: number }) {
    return (
        <div className={cx('pbx-table', styles.metrics)}>
            <div className="pbx-table__scroll">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Window</th>
                            <th scope="col" className={styles.right}>Spend</th>
                            <th scope="col" className={styles.right}>Purchases</th>
                            <th scope="col" className={styles.right}>ROAS</th>
                            <th scope="col" className={styles.right}>CPA</th>
                        </tr>
                    </thead>
                    <tbody>
                        {WINDOWS.filter(([key]) => metrics[key]).map(([key, title]) => {
                            const w = metrics[key];
                            // ROAS at or above breakeven is good, below is a loss
                            const roasClass = !w.spend ? styles.muted : breakeven != null && w.roas >= breakeven ? styles.good : styles.bad;
                            return (
                                <tr key={key}>
                                    <td>{title}</td>
                                    <td className={cx('pbx-num', styles.right)}>{inr(w.spend)}</td>
                                    <td className={cx('pbx-num', styles.right)}>{w.purchases}</td>
                                    <td className={cx('pbx-num', styles.right, styles.strong, roasClass)}>{w.spend ? w.roas.toFixed(2) : '—'}</td>
                                    <td className={cx('pbx-num', styles.right)}>{w.purchases ? inr(w.cpa) : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default ClaudeAnalysis;
