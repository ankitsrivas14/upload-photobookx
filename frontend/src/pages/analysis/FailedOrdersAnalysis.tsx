import { useState, useEffect, useMemo } from 'react';
import { api } from '../../services/api';
import styles from '../AnalysisPage.module.css';

type StatMap = Record<string, { failed: number; total: number }>;

function verdictColor(rate: number) {
    if (rate <= 8)  return { bg: '#dcfce7', color: '#15803d', label: 'Good' };
    if (rate <= 18) return { bg: '#fef3c7', color: '#b45309', label: 'Caution' };
    return             { bg: '#fee2e2', color: '#b91c1c', label: 'Avoid' };
}

function fmt(n: number) { return n.toLocaleString('en-IN'); }

export function FailedOrdersAnalysis() {
    const [failedCount, setFailedCount] = useState(0);
    const [courierStats, setCourierStats] = useState<StatMap>({});
    const [cityStats, setCityStats]       = useState<StatMap>({});
    const [totalOrders, setTotalOrders]   = useState(0);
    const [isLoading, setIsLoading]       = useState(true);
    const [error, setError]               = useState<string | null>(null);
    const [addedCities, setAddedCities]   = useState<Set<string>>(new Set());

    const markAdded = async (city: string) => {
        const isAdded = addedCities.has(city);
        setAddedCities(prev => {
            const next = new Set(prev);
            isAdded ? next.delete(city) : next.add(city);
            return next;
        });
        try {
            isAdded ? await api.removeCodAddedCity(city) : await api.addCodAddedCity(city);
        } catch {
            setAddedCities(prev => {
                const next = new Set(prev);
                isAdded ? next.add(city) : next.delete(city);
                return next;
            });
        }
    };

    useEffect(() => { load(); }, []);

    const load = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [res, addedRes] = await Promise.all([
                api.getFailedOrdersAnalysis(),
                api.getCodAddedCities(),
            ]);
            if (res.success) {
                setFailedCount(res.failedCount ?? 0);
                setCourierStats(res.courierStats ?? {});
                setCityStats(res.cityStats ?? {});
                setTotalOrders(Object.values(res.courierStats ?? {}).reduce((s, v) => s + v.total, 0));
            } else {
                setError('Failed to fetch analysis');
            }
            if (addedRes.success) setAddedCities(new Set(addedRes.cities ?? []));
        } catch {
            setError('An error occurred while fetching orders.');
        } finally {
            setIsLoading(false);
        }
    };

    const couriers = useMemo(() =>
        Object.entries(courierStats)
            .filter(([c, s]) => s.total > 0 && c !== 'Unknown')
            .map(([courier, s]) => ({
                courier,
                total: s.total,
                failed: s.failed,
                rate: parseFloat(((s.failed / s.total) * 100).toFixed(1)),
            }))
            .sort((a, b) => b.rate - a.rate),
    [courierStats]);

    const cities = useMemo(() =>
        Object.entries(cityStats)
            .filter(([city, s]) => s.failed > 0 && city !== 'unknown' && city !== '')
            .map(([city, s]) => ({
                city: city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                total: s.total,
                failed: s.failed,
                rate: parseFloat(((s.failed / s.total) * 100).toFixed(1)),
            }))
            .sort((a, b) => b.rate - a.rate),
    [cityStats]);

    const overallRate = totalOrders > 0 ? ((failedCount / totalOrders) * 100).toFixed(1) : '0.0';

    if (isLoading) return (
        <div className={styles['loading-section']}>
            <div className={styles.spinner} />
            <p>Analysing orders…</p>
        </div>
    );

    if (error) return (
        <div className={`${styles['content-section']} ${styles['error-state']}`}>
            <p>{error}</p>
            <button onClick={load} className={styles['retry-btn']}>Retry</button>
        </div>
    );

    const blockCities = cities.filter(c => c.failed >= 5 && c.rate >= 20);
    const watchCities = cities.filter(c => !(c.failed >= 5 && c.rate >= 20) && c.failed >= 3 && c.rate >= 25);

    return (
        <div className={styles['analysis-content']} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>

            {/* ── Summary stats ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                {[
                    { label: 'Failed Orders', value: fmt(failedCount), color: '#ef4444' },
                    { label: 'Total Orders',  value: fmt(totalOrders), color: '#1e293b' },
                    { label: 'Fail Rate',     value: `${overallRate}%`, color: parseFloat(overallRate) > 15 ? '#ef4444' : parseFloat(overallRate) > 8 ? '#d97706' : '#16a34a' },
                ].map(s => (
                    <div key={s.label} className={styles['stat-card']}>
                        <div className={styles['stat-value']} style={{ color: s.color }}>{s.value}</div>
                        <div className={styles['stat-label']}>{s.label}</div>
                    </div>
                ))}
            </div>

            {/* ── Two columns ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>

                {/* Courier table */}
                <div className={styles['table-card']}>
                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>Courier Performance</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.125rem' }}>Sorted by fail rate — use Good, avoid Red</div>
                    </div>
                    <table className={styles['data-table']}>
                        <thead>
                            <tr>
                                <th>Courier</th>
                                <th style={{ textAlign: 'right' }}>Orders</th>
                                <th style={{ textAlign: 'right' }}>Failed</th>
                                <th style={{ textAlign: 'right' }}>Fail Rate</th>
                                <th style={{ textAlign: 'center' }}>Verdict</th>
                            </tr>
                        </thead>
                        <tbody>
                            {couriers.map(c => {
                                const v = verdictColor(c.rate);
                                return (
                                    <tr key={c.courier}>
                                        <td style={{ fontWeight: 500, color: '#1e293b', fontSize: '0.875rem' }}>{c.courier}</td>
                                        <td style={{ textAlign: 'right', color: '#64748b', fontSize: '0.875rem' }}>{fmt(c.total)}</td>
                                        <td style={{ textAlign: 'right', color: '#64748b', fontSize: '0.875rem' }}>{fmt(c.failed)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.875rem', color: v.color }}>{c.rate}%</td>
                                        <td style={{ textAlign: 'center' }}>
                                            <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: v.bg, color: v.color }}>
                                                {v.label}
                                            </span>
                                        </td>
                                    </tr>
                                );
                            })}
                            {couriers.length === 0 && (
                                <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>No data available</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* City COD Risk */}
                <div className={styles['table-card']}>
                    <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9' }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b' }}>City COD Risk</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.125rem' }}>Click a city to mark it as added to your COD block list</div>
                    </div>
                    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                        {blockCities.length > 0 && (
                            <div>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b91c1c', marginBottom: '0.625rem' }}>
                                    Block COD
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {blockCities.map(c => {
                                        const done = addedCities.has(c.city);
                                        return (
                                            <div
                                                key={c.city}
                                                onClick={() => markAdded(c.city)}
                                                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.5rem 0.875rem', background: done ? '#f0fdf4' : '#fff1f2', border: `1px solid ${done ? '#86efac' : '#fecdd3'}`, borderRadius: '8px', gap: '0.1rem', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 0 2px ${done ? '#22c55e' : '#f43f5e'}`)}
                                                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                                            >
                                                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: done ? '#15803d' : '#9f1239' }}>{c.city}</span>
                                                <span style={{ fontSize: '0.7rem', color: done ? '#16a34a' : '#e11d48' }}>{done ? '✓ added' : `${c.rate}% fail`}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {watchCities.length > 0 && (
                            <div>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#92400e', marginBottom: '0.625rem' }}>
                                    Watch
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    {watchCities.map(c => {
                                        const done = addedCities.has(c.city);
                                        return (
                                            <div
                                                key={c.city}
                                                onClick={() => markAdded(c.city)}
                                                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0.5rem 0.875rem', background: done ? '#f0fdf4' : '#fffbeb', border: `1px solid ${done ? '#86efac' : '#fde68a'}`, borderRadius: '8px', gap: '0.1rem', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.boxShadow = `0 0 0 2px ${done ? '#22c55e' : '#f59e0b'}`)}
                                                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                                            >
                                                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: done ? '#15803d' : '#78350f' }}>{c.city}</span>
                                                <span style={{ fontSize: '0.7rem', color: done ? '#16a34a' : '#b45309' }}>{done ? '✓ added' : `${c.rate}% fail`}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {blockCities.length === 0 && watchCities.length === 0 && (
                            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem', padding: '1.5rem 0' }}>No high-risk cities detected</div>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
