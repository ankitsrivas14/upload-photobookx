import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { ShopifyOrder } from '../../services/api';
import styles from '../AnalysisPage.module.css';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';

const getGroupedCourierName = (courier: string | null | undefined): string => {
    if (!courier) return 'Unknown';
    const normalized = courier.toLowerCase();
    if (normalized.includes('xpressbees')) return 'Xpressbees';
    if (normalized.includes('shadowfax')) return 'Shadowfax';
    if (normalized.includes('amazon')) return 'Amazon';
    if (normalized.includes('delhivery')) return 'Delhivery';
    if (normalized.includes('blue dart') || normalized.includes('bluedart')) return 'Blue Dart';
    if (normalized.includes('ekart')) return 'Ekart';
    if (normalized.includes('ecom')) return 'Ecom Express';
    if (normalized.includes('dtdc')) return 'DTDC';
    return courier;
};

const getPickupDelayCategory = (order: ShopifyOrder): string => {
    if (!order.pickupDate) return 'Not Picked Up';
    const orderDate = new Date(order.createdAt);
    const pickupDate = new Date(order.pickupDate);
    orderDate.setHours(0, 0, 0, 0);
    pickupDate.setHours(0, 0, 0, 0);
    const diffTime = pickupDate.getTime() - orderDate.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    if (diffDays === 0) return '0 days (Same Day)';
    if (diffDays === 1) return '1 day';
    if (diffDays >= 5) return '5+ days';
    return `${diffDays} days`;
};

const getFirstAttemptDelayCategory = (order: ShopifyOrder): string => {
    if (!order.firstAttemptDate) return 'No Attempt Data';
    const orderDate = new Date(order.createdAt);
    const attemptDate = new Date(order.firstAttemptDate);
    orderDate.setHours(0, 0, 0, 0);
    attemptDate.setHours(0, 0, 0, 0);
    const diffTime = attemptDate.getTime() - orderDate.getTime();
    const diffDays = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));

    if (diffDays === 0) return '0 days (Same Day)';
    if (diffDays >= 10) return '10+ days';
    return `${diffDays} days`;
};

export function FailedOrdersAnalysis() {
    const [orders, setOrders] = useState<ShopifyOrder[]>([]);
    const [courierStats, setCourierStats] = useState<Record<string, { failed: number; total: number }>>({});
    const [cityStats, setCityStats] = useState<Record<string, { failed: number; total: number }>>({});
    const [delayStats, setDelayStats] = useState<Record<string, { failed: number; total: number }>>({});
    const [attemptDelayStats, setAttemptDelayStats] = useState<Record<string, { failed: number; total: number }>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadFailedOrders();
    }, []);

    const loadFailedOrders = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [res, discardedResponse, rtoResponse] = await Promise.all([
                api.getOrders(1000, true),
                api.getDiscardedOrderIds(),
                api.getRTOOrderIds(),
            ]);

            if (res.success && res.orders) {
                const discardedOrderIds = new Set(discardedResponse.success ? discardedResponse.discardedOrderIds : []);
                const rtoOrderIds = new Set(rtoResponse.success ? rtoResponse.rtoOrderIds : []);

                const CUTOFF_DATE = new Date('2026-01-28T00:00:00+05:30');

                const validOrders = res.orders.filter(order => {
                    const orderDate = new Date(order.createdAt);
                    if (orderDate < CUTOFF_DATE) return false;

                    if (order.cancelledAt || discardedOrderIds.has(order.id)) return false;
                    return true;
                });

                const stats: Record<string, { failed: number; total: number }> = {};
                const statsCity: Record<string, { failed: number; total: number }> = {};
                const statsDelay: Record<string, { failed: number; total: number }> = {};
                const statsAttempt: Record<string, { failed: number; total: number }> = {};
                const currentFailedOrders: ShopifyOrder[] = [];

                validOrders.forEach(order => {
                    const courier = getGroupedCourierName(order.courierName);
                    // Normalize city names: trim, lower case.
                    const rawCity = order.city || 'Unknown';
                    const city = rawCity.trim().toLowerCase();

                    const deliveryStatusLower = (order.deliveryStatus || '').toLowerCase();
                    const isFailed =
                        rtoOrderIds.has(order.id) ||
                        deliveryStatusLower === 'failure' ||
                        deliveryStatusLower.includes('failed') ||
                        deliveryStatusLower.includes('rto');

                    const delayCat = getPickupDelayCategory(order);
                    const attemptCat = getFirstAttemptDelayCategory(order);

                    if (!stats[courier]) {
                        stats[courier] = { failed: 0, total: 0 };
                    }
                    stats[courier].total += 1;

                    if (!statsCity[city]) {
                        statsCity[city] = { failed: 0, total: 0 };
                    }
                    statsCity[city].total += 1;

                    if (!statsDelay[delayCat]) {
                        statsDelay[delayCat] = { failed: 0, total: 0 };
                    }
                    statsDelay[delayCat].total += 1;

                    if (!statsAttempt[attemptCat]) {
                        statsAttempt[attemptCat] = { failed: 0, total: 0 };
                    }
                    statsAttempt[attemptCat].total += 1;

                    if (isFailed) {
                        stats[courier].failed += 1;
                        statsCity[city].failed += 1;
                        statsDelay[delayCat].failed += 1;
                        statsAttempt[attemptCat].failed += 1;
                        currentFailedOrders.push(order);
                    }
                });

                // Sort by most recent first (created_at desc)
                currentFailedOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

                // Keep only top 1000 (if there were more)
                setOrders(currentFailedOrders.slice(0, 1000));
                setCourierStats(stats);
                setCityStats(statsCity);
                setDelayStats(statsDelay);
                setAttemptDelayStats(statsAttempt);
            } else {
                setError(res.error || 'Failed to fetch orders');
            }
        } catch (err) {
            console.error('Error fetching failed orders:', err);
            setError('An error occurred while fetching orders.');
        } finally {
            setIsLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div className={styles['loading-section']}>
                <div className={styles.spinner}></div>
                <p>Loading failed orders analysis...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`${styles['content-section']} ${styles['error-state']}`}>
                <p>{error}</p>
                <button onClick={loadFailedOrders} className={styles['retry-btn']}>Retry</button>
            </div>
        );
    }

    return (
        <div className={styles['analysis-content']} style={{ display: 'grid', gap: '1.5rem', paddingBottom: '2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '3rem', fontWeight: 700, color: '#ef4444', lineHeight: 1 }}>{orders.length}</div>
                    <div style={{ fontWeight: 600, color: '#64748b', marginTop: '0.5rem', textAlign: 'center', fontSize: '0.9rem' }}>Total Failed Orders<br /><span style={{ fontSize: '0.75rem', fontWeight: 400 }}>(From recently analysed)</span></div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1.5rem' }}>
                <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div>
                            <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                                Carrier Failure Rates
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Sorted by worst performing carriers</p>
                        </div>
                    </div>
                    <div style={{ height: 260, width: '100%' }}>
                        {(() => {
                            const chartData = Object.entries(courierStats)
                                .filter(([courier, stats]) => stats.total > 0 && courier !== 'Unknown')
                                .map(([courier, stats]) => ({
                                    name: courier,
                                    total: stats.total,
                                    failed: stats.failed,
                                    failRate: parseFloat(((stats.failed / stats.total) * 100).toFixed(1))
                                }))
                                .sort((a, b) => b.failRate !== a.failRate ? b.failRate - a.failRate : b.total - a.total);

                            if (chartData.length === 0) {
                                return <div style={{ color: '#64748b', fontSize: '0.9rem', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>No courier data available.</div>;
                            }

                            return (
                                <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                                    <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 60, left: 10, bottom: 0 }} style={{ outline: 'none' }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                        <XAxis
                                            type="number"
                                            domain={[0, 'dataMax + 5']}
                                            hide
                                        />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }}
                                            width={110}
                                        />
                                        <Tooltip
                                            cursor={{ fill: '#f8fafc' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)', fontSize: '13px' }}
                                            formatter={(value: any, name: any, props: any) => {
                                                const { payload } = props;
                                                if (name === 'failRate') return [`${value}% (${payload.failed} failed of ${payload.total} total)`, 'Failure Rate'];
                                                return [value, name];
                                            }}
                                        />
                                        <Bar dataKey="failRate" radius={[0, 4, 4, 0]} barSize={24} activeBar={false}>
                                            {
                                                chartData.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={entry.failRate > 15 ? '#ef4444' : (entry.failRate > 8 ? '#f59e0b' : '#10b981')} style={{ outline: 'none' }} />
                                                ))
                                            }
                                            <LabelList dataKey="failRate" position="right" formatter={(val: any) => `${val}%`} fontSize={12} fontWeight={600} fill="#64748b" />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            );
                        })()}
                    </div>
                </div>

                <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div>
                            <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                                Highest Failing Cities
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Cities causing the most failed orders</p>
                        </div>
                    </div>
                    <div style={{ height: 260, width: '100%' }}>
                        {(() => {
                            const topCitiesData = Object.entries(cityStats)
                                .filter(([city, stats]) => stats.failed > 0 && city !== 'unknown' && city !== '')
                                .map(([city, stats]) => {
                                    const failRate = parseFloat(((stats.failed / stats.total) * 100).toFixed(1));
                                    return {
                                        name: city.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
                                        failed: stats.failed,
                                        total: stats.total,
                                        failRate,
                                        displayLabel: `${stats.failed} failed (${failRate}%)`
                                    };
                                })
                                .sort((a, b) => b.failed !== a.failed ? b.failed - a.failed : b.failRate - a.failRate)
                                .slice(0, 10); // Show top 10 cites

                            if (topCitiesData.length === 0) {
                                return <div style={{ color: '#64748b', fontSize: '0.9rem', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>No city data available with minimum order threshold.</div>;
                            }

                            return (
                                <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                                    <BarChart data={topCitiesData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }} style={{ outline: 'none' }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                        <XAxis
                                            type="number"
                                            domain={[0, 'dataMax + 2']}
                                            hide
                                        />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }}
                                            width={100}
                                        />
                                        <Tooltip
                                            cursor={{ fill: '#f8fafc' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)', fontSize: '13px' }}
                                            formatter={(value: any, name: any, props: any) => {
                                                const { payload } = props;
                                                if (name === 'failed') return [`${value} failed out of ${payload.total} total (${payload.failRate}%)`, 'Failed Orders'];
                                                return [value, name];
                                            }}
                                        />
                                        <Bar dataKey="failed" radius={[0, 4, 4, 0]} barSize={20} activeBar={false}>
                                            {
                                                topCitiesData.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill="#f43f5e" style={{ outline: 'none' }} />
                                                ))
                                            }
                                            <LabelList dataKey="displayLabel" position="right" fontSize={11} fontWeight={600} fill="#64748b" />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            );
                        })()}
                    </div>
                </div>

                <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div>
                            <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                                Failure by Pickup Delay
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Number of failed orders based on pickup time</p>
                        </div>
                    </div>
                    <div style={{ height: 260, width: '100%' }}>
                        {(() => {
                            const sortOrder = ['0 days (Same Day)', '1 day', '2 days', '3 days', '4 days', '5+ days', 'Not Picked Up'];
                            const delayData = sortOrder
                                .map(cat => {
                                    const stats = delayStats[cat] || { failed: 0, total: 0 };
                                    return {
                                        name: cat,
                                        failed: stats.failed,
                                        total: stats.total,
                                        failRate: stats.total > 0 ? parseFloat(((stats.failed / stats.total) * 100).toFixed(1)) : 0,
                                        displayLabel: `${stats.failed} failed`
                                    };
                                })
                                .filter(d => d.failed > 0);

                            if (delayData.length === 0) {
                                return <div style={{ color: '#64748b', fontSize: '0.9rem', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>No delay data available.</div>;
                            }

                            return (
                                <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                                    <BarChart data={delayData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }} style={{ outline: 'none' }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                        <XAxis type="number" domain={[0, 'dataMax + 2']} hide />
                                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} width={120} />
                                        <Tooltip
                                            cursor={{ fill: '#f8fafc' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)', fontSize: '13px' }}
                                            formatter={(value: any, name: any, props: any) => {
                                                const { payload } = props;
                                                if (name === 'failed') return [`${value} failed out of ${payload.total} total (${payload.failRate}%)`, 'Failed Orders'];
                                                return [value, name];
                                            }}
                                        />
                                        <Bar dataKey="failed" radius={[0, 4, 4, 0]} barSize={20} activeBar={false}>
                                            {
                                                delayData.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill="#8b5cf6" style={{ outline: 'none' }} />
                                                ))
                                            }
                                            <LabelList dataKey="displayLabel" position="right" fontSize={11} fontWeight={600} fill="#64748b" />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            );
                        })()}
                    </div>
                </div>

                <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div>
                            <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                                Failure by First Attempt Time
                            </h3>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Number of failed orders based on transit days to first attempt</p>
                        </div>
                    </div>
                    <div style={{ height: 260, width: '100%' }}>
                        {(() => {
                            const sortOrder = ['0 days (Same Day)', '1 days', '2 days', '3 days', '4 days', '5 days', '6 days', '7 days', '8 days', '9 days', '10+ days', 'No Attempt Data'];
                            const delayData = sortOrder
                                .map(cat => {
                                    const stats = attemptDelayStats[cat] || { failed: 0, total: 0 };
                                    return {
                                        name: cat,
                                        failed: stats.failed,
                                        total: stats.total,
                                        failRate: stats.total > 0 ? parseFloat(((stats.failed / stats.total) * 100).toFixed(1)) : 0,
                                        displayLabel: `${stats.failed} failed`
                                    };
                                })
                                .filter(d => d.failed > 0);

                            if (delayData.length === 0) {
                                return <div style={{ color: '#64748b', fontSize: '0.9rem', display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}>No attempt delay data available.</div>;
                            }

                            return (
                                <ResponsiveContainer width="100%" height="100%" style={{ outline: 'none' }}>
                                    <BarChart data={delayData} layout="vertical" margin={{ top: 10, right: 30, left: 10, bottom: 0 }} style={{ outline: 'none' }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                        <XAxis type="number" domain={[0, 'dataMax + 2']} hide />
                                        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} width={120} />
                                        <Tooltip
                                            cursor={{ fill: '#f8fafc' }}
                                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)', fontSize: '13px' }}
                                            formatter={(value: any, name: any, props: any) => {
                                                const { payload } = props;
                                                if (name === 'failed') return [`${value} failed out of ${payload.total} total (${payload.failRate}%)`, 'Failed Orders'];
                                                return [value, name];
                                            }}
                                        />
                                        <Bar dataKey="failed" radius={[0, 4, 4, 0]} barSize={20} activeBar={false}>
                                            {
                                                delayData.map((_, index) => (
                                                    <Cell key={`cell-${index}`} fill="#f59e0b" style={{ outline: 'none' }} />
                                                ))
                                            }
                                            <LabelList dataKey="displayLabel" position="right" fontSize={11} fontWeight={600} fill="#64748b" />
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            );
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
}
