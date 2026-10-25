import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { ClaudeCall, ClaudeReview, ClaudeWindow } from '../../services/api';
import { History, Sparkles, CheckCircle2, CircleDashed } from 'lucide-react';

const DECISION_COLORS: Record<string, { bg: string; text: string }> = {
    SCALE: { bg: '#e0f2fe', text: '#0369a1' },
    DUPLICATE: { bg: '#f3e8ff', text: '#6b21a8' },
    CONTINUE: { bg: '#dcfce7', text: '#166534' },
    MONITOR: { bg: '#fef3c7', text: '#92400e' },
    CLOSE: { bg: '#fee2e2', text: '#991b1b' },
};

const WINDOWS: Array<[string, string]> = [
    ['yesterday', 'Yesterday'],
    ['last3', 'Last 3 days'],
    ['active7', 'Last 7 active days'],
    ['active30', 'Last 30 active days'],
];

const card = { backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '1rem', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' };
const label = { margin: 0, fontSize: '0.7rem', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.04em' };
const list = { margin: '0.5rem 0 0', paddingLeft: '1.1rem', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 };

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
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sparkles size={16} color="#7c3aed" />
                    <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>Claude Analysis</h1>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#fff', border: '1px solid #e2e8f0', padding: '0.4rem 0.75rem', borderRadius: '8px' }}>
                    <History size={14} color="#94a3b8" />
                    <select
                        value={selectedDate}
                        onChange={(e) => e.target.value && loadReview(e.target.value)}
                        disabled={dates.length === 0}
                        style={{ border: 'none', background: 'none', fontSize: '0.825rem', color: '#475569', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                    >
                        {dates.length === 0 && <option value="">No reviews yet</option>}
                        {dates.map((d) => (
                            <option key={d} value={d}>{formatDate(d)}</option>
                        ))}
                    </select>
                </div>
            </div>

            {error && <div style={{ ...card, borderColor: '#fecaca', color: '#991b1b', fontSize: '0.85rem' }}>{error}</div>}

            {isLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Loading Claude analysis...</div>
            ) : !review ? (
                !error && (
                    <div style={{ ...card, color: '#64748b', fontSize: '0.85rem' }}>
                        No Claude reviews yet. Each "ads" review in Claude Code shows up here with the decision and the reason for every ad set.
                    </div>
                )
            ) : (
                <>
                    <Summary review={review} />
                    {review.previousGrading && review.previousGrading.length > 0 && (
                        <div style={card}>
                            <p style={label}>How the previous calls played out</p>
                            <ul style={list}>
                                {review.previousGrading.map((g) => (
                                    <li key={`${g.adsetName}-${g.decision}`}><strong style={{ color: '#1e293b' }}>{g.adsetName}</strong> ({g.decision}): {g.outcome}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {review.calls.map((call) => (
                        <CallCard key={call.adsetId} call={call} breakeven={breakeven} />
                    ))}
                    <Footnotes checks={review.checks} notes={review.notes} />
                </>
            )}
        </div>
    );
}

function Summary({ review }: { review: ClaudeReview }) {
    const be = review.breakeven;
    const tiles: Array<[string, string]> = [
        ['Data as of', formatTime(review.dataAsOf) || '—'],
        ['Breakeven ROAS (Meta)', be ? be.metaRoas.toFixed(2) : '—'],
        ['Orders delivered', be ? `${be.deliveryRatePct}%` : '—'],
        ['Margin per order', be ? inr(be.marginPerOrder) : '—'],
        ['Daily budget', review.account ? `${inr(review.account.budgetBefore)} → ${inr(review.account.budgetAfter)}` : '—'],
    ];
    return (
        <div style={card}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                {tiles.map(([title, value]) => (
                    <div key={title}>
                        <p style={label}>{title}</p>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>{value}</div>
                    </div>
                ))}
            </div>
            {review.summary && <p style={{ margin: '0.85rem 0 0', fontSize: '0.85rem', color: '#475569', lineHeight: 1.5 }}>{review.summary}</p>}
        </div>
    );
}

function Footnotes({ checks = [], notes = [] }: { checks?: string[]; notes?: string[] }) {
    if (checks.length === 0 && notes.length === 0) return null;
    return (
        <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {checks.length > 0 && (
                <div>
                    <p style={label}>Check at the next review</p>
                    <ul style={list}>{checks.map((c) => <li key={c}>{c}</li>)}</ul>
                </div>
            )}
            {notes.length > 0 && (
                <div>
                    <p style={label}>Notes</p>
                    <ul style={list}>{notes.map((n) => <li key={n}>{n}</li>)}</ul>
                </div>
            )}
        </div>
    );
}

function CallCard({ call, breakeven }: { call: ClaudeCall; breakeven?: number }) {
    const colors = DECISION_COLORS[call.decision] || { bg: '#f1f5f9', text: '#475569' };
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
        <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', wordBreak: 'break-word' }}>{call.adsetName}</div>
                    {call.campaignName && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.15rem' }}>{call.campaignName}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                    <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', backgroundColor: colors.bg, color: colors.text, fontWeight: 700, textTransform: 'uppercase' }}>
                        {call.decision}
                    </span>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>{budgetText}</span>
                </div>
            </div>
            <p style={{ margin: '0.7rem 0', fontSize: '0.85rem', color: '#475569', lineHeight: 1.55 }}>{call.reason}</p>
            {call.metrics && <Metrics metrics={call.metrics} breakeven={breakeven} />}
            <div style={{ marginTop: '0.7rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: call.applied?.confirmed ? '#15803d' : '#94a3b8' }}>
                {call.applied ? <CheckCircle2 size={13} /> : <CircleDashed size={13} />}
                {appliedText}
            </div>
        </div>
    );
}

function Metrics({ metrics, breakeven }: { metrics: Record<string, ClaudeWindow>; breakeven?: number }) {
    const cell = { padding: '0.35rem 0.5rem', fontSize: '0.78rem', color: '#475569' };
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '420px' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f8fafc', textAlign: 'left' }}>
                        {['Window', 'Spend', 'Purchases', 'ROAS', 'CPA'].map((h) => (
                            <th key={h} style={{ ...cell, color: '#94a3b8', fontWeight: 600 }}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {WINDOWS.filter(([key]) => metrics[key]).map(([key, title]) => {
                        const w = metrics[key];
                        const roasColor = !w.spend ? '#94a3b8' : breakeven != null && w.roas >= breakeven ? '#15803d' : '#b91c1c';
                        return (
                            <tr key={key} style={{ borderTop: '1px solid #f1f5f9' }}>
                                <td style={cell}>{title}</td>
                                <td style={cell}>{inr(w.spend)}</td>
                                <td style={cell}>{w.purchases}</td>
                                <td style={{ ...cell, fontWeight: 700, color: roasColor }}>{w.spend ? w.roas.toFixed(2) : '—'}</td>
                                <td style={cell}>{w.purchases ? inr(w.cpa) : '—'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export default ClaudeAnalysis;
