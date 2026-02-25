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

export function FailedOrdersAnalysis() {
    const [orders, setOrders] = useState<ShopifyOrder[]>([]);
    const [courierStats, setCourierStats] = useState<Record<string, { failed: number; total: number }>>({});
    const [cityStats, setCityStats] = useState<Record<string, { failed: number; total: number }>>({});
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

                    if (!stats[courier]) {
                        stats[courier] = { failed: 0, total: 0 };
                    }
                    stats[courier].total += 1;

                    if (!statsCity[city]) {
                        statsCity[city] = { failed: 0, total: 0 };
                    }
                    statsCity[city].total += 1;

                    if (isFailed) {
                        stats[courier].failed += 1;
                        statsCity[city].failed += 1;
                        currentFailedOrders.push(order);
                    }
                });

                // Sort by most recent first (created_at desc)
                currentFailedOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

                // Keep only top 1000 (if there were more)
                setOrders(currentFailedOrders.slice(0, 1000));
                setCourierStats(stats);
                setCityStats(statsCity);
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
        <div className={styles['analysis-content']}>
            <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 250px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: '2rem', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <div style={{ fontSize: '3.5rem', fontWeight: 700, color: '#ef4444', lineHeight: 1 }}>{orders.length}</div>
                    <div style={{ fontWeight: 600, color: '#64748b', marginTop: '0.75rem', textAlign: 'center' }}>Total Failed Orders<br /><span style={{ fontSize: '0.8rem', fontWeight: 400 }}>(From recently analysed)</span></div>
                </div>

                <div style={{ flex: '3 1 500px', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
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

                <div style={{ flex: '3 1 500px', padding: '1.5rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
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
                                                topCitiesData.map((entry, index) => (
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
            </div>

            <div className={styles['table-card']} style={{ marginTop: '2rem' }}>
                <table className={styles['data-table']}>
                    <thead>
                        <tr>
                            <th>Order Number</th>
                            <th>Date</th>
                            <th>Items</th>
                            <th>Total Value</th>
                            <th>Status</th>
                            <th>Carrier</th>
                            <th>Payment Method</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>
                                    No failed orders found in the recent history.
                                </td>
                            </tr>
                        ) : (
                            orders.map(order => (
                                <tr key={order.id}>
                                    <td><strong>{order.name}</strong></td>
                                    <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                    <td>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {order.lineItems?.slice(0, 2).map((item, i) => (
                                                <span key={i} style={{ fontSize: '0.85rem' }}>
                                                    {item.quantity}x {item.title}
                                                </span>
                                            ))}
                                            {(order.lineItems?.length || 0) > 2 && (
                                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                                    +{((order.lineItems?.length || 0) - 2)} more
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td>₹{order.totalPrice || 0}</td>
                                    <td>
                                        <span style={{
                                            padding: '4px 8px',
                                            borderRadius: '4px',
                                            fontSize: '0.85rem',
                                            fontWeight: 500,
                                            backgroundColor: order.cancelledAt ? '#fee2e2' : '#ffedd5',
                                            color: order.cancelledAt ? '#ef4444' : '#f97316'
                                        }}>
                                            {order.cancelledAt ? 'Cancelled' : (order.deliveryStatus || 'Failed')}
                                        </span>
                                    </td>
                                    <td>{getGroupedCourierName(order.courierName)}</td>
                                    <td>{order.paymentMethod || 'Unknown'}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
