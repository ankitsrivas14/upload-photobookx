import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../../services/api';
import { Alert, Badge, Button, Card, EmptyState, Skeleton, StatCard, StatStrip } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import styles from '../AnalysisPage.module.css';

type StatMap = Record<string, { failed: number; total: number }>;

function verdict(rate: number): { tone: 'positive' | 'caution' | 'negative'; label: string } {
    if (rate <= 8)  return { tone: 'positive', label: 'Good' };
    if (rate <= 18) return { tone: 'caution', label: 'Caution' };
    return             { tone: 'negative', label: 'Avoid' };
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
        } catch (err) {
            setAddedCities(prev => {
                const next = new Set(prev);
                isAdded ? next.add(city) : next.delete(city);
                return next;
            });
            toast.error(errorMessage(err, `Failed to update ${city}`));
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

    if (isLoading) return <Skeleton lines={8} />;

    if (error) return (
        <Alert tone="negative" action={<Button size="sm" onClick={load}>Retry</Button>}>{error}</Alert>
    );

    const blockCities = cities.filter(c => c.failed >= 5 && c.rate >= 20);
    const watchCities = cities.filter(c => !(c.failed >= 5 && c.rate >= 20) && c.failed >= 3 && c.rate >= 25);
    const rate = parseFloat(overallRate);

    // A city chip: click to mark it added to the COD block list (or undo)
    const cityChip = (c: (typeof cities)[number], tone: 'negative' | 'caution') => {
        const done = addedCities.has(c.city);
        return (
            <button
                key={c.city}
                type="button"
                className={cx(styles.city, styles[tone], done && styles.cityDone)}
                aria-pressed={done}
                onClick={() => markAdded(c.city)}
            >
                <span className={styles.cityName}>{c.city}</span>
                <span className={styles.cityMeta}>{done ? '✓ added' : `${c.rate}% fail · ${c.failed} of ${c.total}`}</span>
            </button>
        );
    };

    return (
        <>
            <StatStrip>
                <StatCard label="Failed orders" value={fmt(failedCount)} tone="negative" />
                <StatCard label="Total orders" value={fmt(totalOrders)} />
                <StatCard label="Fail rate" value={`${overallRate}%`} tone={rate > 15 ? 'negative' : rate > 8 ? 'caution' : 'positive'} />
            </StatStrip>

            <div className={styles.split}>
                <Card title="Courier performance" eyebrow="sorted by fail rate" padding="sm">
                    {couriers.length === 0 ? (
                        <EmptyState size="sm" icon="truck" title="No courier data yet" />
                    ) : (
                        <div className="pbx-table">
                            <div className="pbx-table__scroll">
                                <table>
                                    <thead>
                                        <tr>
                                            <th scope="col">Courier</th>
                                            <th scope="col" className={styles.right}>Orders</th>
                                            <th scope="col" className={styles.right}>Failed</th>
                                            <th scope="col" className={styles.right}>Fail rate</th>
                                            <th scope="col">Verdict</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {couriers.map(c => {
                                            const v = verdict(c.rate);
                                            return (
                                                <tr key={c.courier}>
                                                    <td className={styles.strong}>{c.courier}</td>
                                                    <td className={cx('pbx-num', styles.right)}>{fmt(c.total)}</td>
                                                    <td className={cx('pbx-num', styles.right)}>{fmt(c.failed)}</td>
                                                    <td className={cx('pbx-num', styles.right, styles.strong)}>{`${c.rate}%`}</td>
                                                    <td><Badge size="sm" tone={v.tone}>{v.label}</Badge></td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </Card>

                <Card title="City COD risk" eyebrow="click a city once it is on your COD block list">
                    {blockCities.length === 0 && watchCities.length === 0 ? (
                        <EmptyState size="sm" icon="map-pin" title="No high-risk cities" description="No city has enough failed COD orders to flag." />
                    ) : (
                        <div className={styles.cityGroups}>
                            {blockCities.length > 0 && (
                                <div>
                                    <div className={styles.groupLabel}>Block COD <span>5+ failed, 20%+ fail rate</span></div>
                                    <div className={styles.cities}>{blockCities.map(c => cityChip(c, 'negative'))}</div>
                                </div>
                            )}
                            {watchCities.length > 0 && (
                                <div>
                                    <div className={styles.groupLabel}>Watch <span>3+ failed, 25%+ fail rate</span></div>
                                    <div className={styles.cities}>{watchCities.map(c => cityChip(c, 'caution'))}</div>
                                </div>
                            )}
                        </div>
                    )}
                </Card>
            </div>
        </>
    );
}
