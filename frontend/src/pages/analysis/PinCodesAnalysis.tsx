import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from '../AnalysisPage.module.css';

export function PinCodesAnalysis() {
    const [pinCodeStats, setPinCodeStats] = useState<Record<string, { codFailed: number; codTotal: number; codDelivered: number; paidDelivered: number; codFailedOrders: string[]; codDeliveredOrders: string[]; paidDeliveredOrders: string[] }>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Blocked Pin Codes State
    const [showModal, setShowModal] = useState(false);
    const [blockedPinCodes, setBlockedPinCodes] = useState<any[]>([]);
    const [newPinCode, setNewPinCode] = useState('');
    const [newPinCodeNotes, setNewPinCodeNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [copiedPin, setCopiedPin] = useState<string | null>(null);
    const [copiedSection, setCopiedSection] = useState<string | null>(null);

    const handleCopy = (pin: string, orders: string[]) => {
        if (!orders || orders.length === 0) return;
        const textToCopy = orders.join(', ');
        navigator.clipboard.writeText(textToCopy);
        setCopiedPin(pin);
        setTimeout(() => setCopiedPin(null), 2000);
    };

    const handleCopyPincodes = (pincodes: string[], sectionName: string) => {
        if (!pincodes || pincodes.length === 0) return;
        const textToCopy = pincodes.join(',');
        navigator.clipboard.writeText(textToCopy);
        setCopiedSection(sectionName);
        setTimeout(() => setCopiedSection(null), 2000);
    };

    const loadBlockedPinCodes = async () => {
        try {
            const res = await api.getBlockedPinCodes();
            if (res.success && res.pinCodes) {
                setBlockedPinCodes(res.pinCodes);
            }
        } catch (err) {
            console.error('Failed to load blocked pin codes:', err);
        }
    };

    useEffect(() => {
        loadPinCodes();
        loadBlockedPinCodes();
    }, []);

    const handleAddPinCode = async () => {
        if (!newPinCode.trim()) return;
        setIsSaving(true);
        try {
            // Deduplicate the list of input pin codes
            const pinCodesList = Array.from(new Set(
                newPinCode.split('\n').map(p => p.trim()).filter(p => !!p)
            ));

            const res = await api.addBlockedPinCode(pinCodesList, newPinCodeNotes);

            if (res.success && res.pinCodes) {
                // Deduplicate incoming array from backend just in case
                const uniqueNew = [];
                const seen = new Set();
                for (const item of res.pinCodes) {
                    if (!seen.has(item.pinCode)) {
                        seen.add(item.pinCode);
                        uniqueNew.push(item);
                    }
                }

                const addedPincodes = uniqueNew.map(p => p.pinCode);
                setBlockedPinCodes([
                    ...uniqueNew,
                    ...blockedPinCodes.filter(p => !addedPincodes.includes(p.pinCode))
                ]);
                setNewPinCode('');
                setNewPinCodeNotes('');
            }
        } catch (err) {
            console.error('Failed to add pin code:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeletePinCode = async (pinCode: string) => {
        try {
            const res = await api.deleteBlockedPinCode(pinCode);
            if (res.success) {
                setBlockedPinCodes(blockedPinCodes.filter(p => p.pinCode !== pinCode));
            }
        } catch (err) {
            console.error('Failed to delete pin code:', err);
        }
    };

    // Replaced by combined useEffect above
    const loadPinCodes = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const [res, rtoResponse] = await Promise.all([
                api.getOrders(10000, true), // fetch quite a few orders to get a good sample size
                api.getRTOOrderIds(),
            ]);

            if (res.success && res.orders) {
                const rtoOrderIds = new Set(rtoResponse.success ? rtoResponse.rtoOrderIds : []);

                const validOrders = res.orders.filter(order => {
                    if (order.cancelledAt) return false;
                    return true;
                });

                const stats: Record<string, { codFailed: number; codTotal: number; codDelivered: number; paidDelivered: number; codFailedOrders: string[]; codDeliveredOrders: string[]; paidDeliveredOrders: string[] }> = {};

                validOrders.forEach(order => {
                    const rawPin = order.zip || 'Unknown';
                    const pin = rawPin.trim() || 'Unknown';

                    // Skip orders where the pin code is completely redacted or unknown
                    // (They skew the analysis and aren't actionable pin codes)
                    if (pin === 'Unknown' || pin === 'Option') {
                        return;
                    }

                    const isCOD = (order.paymentMethod || '').toUpperCase() === 'COD';

                    const deliveryStatusLower = (order.deliveryStatus || '').toLowerCase();
                    const isFailed =
                        rtoOrderIds.has(order.id) ||
                        deliveryStatusLower === 'failure' ||
                        deliveryStatusLower.includes('failed') ||
                        deliveryStatusLower.includes('rto');

                    const isDelivered =
                        deliveryStatusLower === 'delivered' ||
                        !!order.deliveredAt ||
                        !!order.deliveredDate;

                    // Only consider orders that have reached an end-state (failed or delivered)
                    if (!isFailed && !isDelivered) {
                        return;
                    }

                    if (!stats[pin]) {
                        stats[pin] = { codFailed: 0, codTotal: 0, codDelivered: 0, paidDelivered: 0, codFailedOrders: [], codDeliveredOrders: [], paidDeliveredOrders: [] };
                    }

                    if (isCOD) {
                        stats[pin].codTotal += 1;
                        if (isFailed) {
                            stats[pin].codFailed += 1;
                            stats[pin].codFailedOrders.push(order.name);
                        }
                        if (isDelivered) {
                            stats[pin].codDelivered += 1;
                            stats[pin].codDeliveredOrders.push(order.name);
                        }
                    } else {
                        if (isDelivered) {
                            stats[pin].paidDelivered += 1;
                            stats[pin].paidDeliveredOrders.push(order.name);
                        }
                    }
                });

                setPinCodeStats(stats);
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
                <p>Loading pin codes analysis...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`${styles['content-section']} ${styles['error-state']}`}>
                <p>{error}</p>
                <button onClick={loadPinCodes} className={styles['retry-btn']}>Retry</button>
            </div>
        );
    }

    const pinCodeDataList = Object.entries(pinCodeStats)
        .filter(([, stats]) => stats.codFailed > 0 && stats.codDelivered === 0)
        .map(([pin, stats]) => {
            const failRate = parseFloat(((stats.codFailed / stats.codTotal) * 100).toFixed(1));
            return {
                pin,
                failed: stats.codFailed,
                total: stats.codTotal,
                failRate,
                orders: stats.codFailedOrders
            };
        })
        .sort((a, b) => b.failed !== a.failed ? b.failed - a.failed : b.failRate - a.failRate);

    const codDeliveredRTOPinCodes = Object.entries(pinCodeStats)
        .filter(([pin, stats]) => stats.codDelivered > 0 && blockedPinCodes.some(p => p.pinCode === pin))
        .map(([pin, stats]) => ({
            pin,
            delivered: stats.codDelivered,
            failed: stats.codFailed,
            total: stats.codTotal,
            orders: stats.codDeliveredOrders
        }))
        .sort((a, b) => b.delivered - a.delivered);

    const paidDeliveredRTOPinCodes = Object.entries(pinCodeStats)
        .filter(([pin, stats]) => stats.paidDelivered > 0 && blockedPinCodes.some(p => p.pinCode === pin))
        .map(([pin, stats]) => ({
            pin,
            delivered: stats.paidDelivered,
            orders: stats.paidDeliveredOrders
        }))
        .sort((a, b) => b.delivered - a.delivered);

    return (
        <div className={styles['analysis-content']} style={{ display: 'grid', gap: '1.5rem', paddingBottom: '2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '3rem', fontWeight: 700, color: '#ef4444', lineHeight: 1 }}>{pinCodeDataList.length}</div>
                    <div style={{ fontWeight: 600, color: '#64748b', marginTop: '0.5rem', textAlign: 'center', fontSize: '0.9rem' }}>COD Pin Codes with Failures<br /><span style={{ fontSize: '0.75rem', fontWeight: 400 }}>(From past COD orders)</span></div>
                </div>
            </div>

            <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            Failed Pin Codes
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Pin codes causing the most failed orders across all past records.</p>
                    </div>
                    {pinCodeDataList.length > 0 && (
                        <button
                            onClick={() => handleCopyPincodes(pinCodeDataList.map(r => r.pin), 'failed')}
                            style={{ background: 'none', border: '1px solid #bfdbfe', cursor: 'pointer', color: '#3b82f6', fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#f0f9ff', display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500, transition: 'all 0.2s' }}
                            title="Copy all failed pin codes"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            {copiedSection === 'failed' ? 'Copied!' : 'Copy Pin Codes'}
                        </button>
                    )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.25rem' }}>
                    {pinCodeDataList.map((row) => {
                        const isRTO = blockedPinCodes.some(p => p.pinCode === row.pin);
                        return (
                            <div
                                key={row.pin}
                                onClick={() => handleCopy(row.pin, row.orders)}
                                style={{
                                    padding: '0.35rem 0.75rem',
                                    backgroundColor: isRTO ? '#fee2e2' : '#f8fafc',
                                    border: `1px solid ${isRTO ? '#fca5a5' : '#e2e8f0'}`,
                                    borderRadius: '16px',
                                    fontSize: '0.85rem',
                                    fontWeight: isRTO ? 700 : 500,
                                    color: isRTO ? '#ef4444' : '#475569',
                                    cursor: row.orders.length > 0 ? 'pointer' : 'default',
                                    transition: 'all 0.2s ease',
                                    position: 'relative'
                                }}
                                title={isRTO ? `RTO Pin Code` : `Failed Orders: ${row.failed} / Total: ${row.total} (${row.failRate}%) - Click to copy orders`}
                            >
                                {copiedPin === row.pin ? 'Copied' : row.pin}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            RTO Pin Codes
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Pin codes explicitly blocked or flagged for RTO.</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {blockedPinCodes.length > 0 && (
                            <button
                                onClick={() => handleCopyPincodes(blockedPinCodes.map(p => p.pinCode), 'rto')}
                                style={{ background: 'none', border: '1px solid #bfdbfe', cursor: 'pointer', color: '#3b82f6', fontSize: '0.85rem', padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#f0f9ff', display: 'flex', alignItems: 'center', gap: '0.35rem', fontWeight: 500, transition: 'all 0.2s' }}
                                title="Copy all RTO pin codes"
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                {copiedSection === 'rto' ? 'Copied!' : 'Copy Pin Codes'}
                            </button>
                        )}
                        <button
                            onClick={() => setShowModal(true)}
                            style={{ background: 'none', border: '1px solid #e2e8f0', cursor: 'pointer', color: '#475569', padding: '0.4rem', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', transition: 'all 0.2s' }}
                            title="Manage RTO Pin Codes"
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.25rem' }}>
                    {blockedPinCodes.length === 0 ? (
                        <div style={{ color: '#64748b', fontSize: '0.9rem' }}>No RTO pin codes configured. Add some using the settings gear above.</div>
                    ) : (
                        blockedPinCodes.map((p) => (
                            <div
                                key={p.pinCode}
                                style={{
                                    padding: '0.35rem 0.75rem',
                                    backgroundColor: '#fee2e2',
                                    border: '1px solid #fca5a5',
                                    borderRadius: '16px',
                                    fontSize: '0.85rem',
                                    fontWeight: 700,
                                    color: '#ef4444'
                                }}
                                title={p.notes ? `Notes: ${p.notes}` : 'RTO Pin Code'}
                            >
                                {p.pinCode}
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div style={{ padding: '1.25rem', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)', border: '1px solid #f1f5f9', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                    <div>
                        <h3 style={{ marginTop: 0, marginBottom: '0.25rem', fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>
                            Successful Deliveries to RTO Pin Codes
                        </h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Pin codes in your RTO list that actually have history of successful deliveries.</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '0.5rem' }}>
                    {/* COD Deliveries */}
                    <div>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            COD Orders Delivered
                            {codDeliveredRTOPinCodes.length > 0 && (
                                <button
                                    onClick={() => handleCopyPincodes(codDeliveredRTOPinCodes.map(r => r.pin), 'codDelivered')}
                                    style={{ background: 'none', border: '1px solid #bbf7d0', cursor: 'pointer', color: '#16a34a', fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '6px', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 500 }}
                                    title="Copy these pin codes"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    {copiedSection === 'codDelivered' ? 'Copied!' : 'Copy'}
                                </button>
                            )}
                        </h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {codDeliveredRTOPinCodes.length === 0 ? (
                                <div style={{ color: '#64748b', fontSize: '0.85rem' }}>No successful COD deliveries found.</div>
                            ) : (
                                codDeliveredRTOPinCodes.map((row) => (
                                    <div
                                        key={row.pin}
                                        onClick={() => handleCopy(row.pin + '-cod', row.orders)}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            backgroundColor: '#dcfce7',
                                            border: '1px solid #86efac',
                                            borderRadius: '16px',
                                            fontSize: '0.85rem',
                                            fontWeight: 700,
                                            color: '#16a34a',
                                            cursor: row.orders.length > 0 ? 'pointer' : 'default',
                                            transition: 'all 0.2s ease',
                                        }}
                                        title={`Delivered COD Orders: ${row.delivered} / Failed: ${row.failed} - Click to copy orders`}
                                    >
                                        {copiedPin === row.pin + '-cod' ? 'Copied' : row.pin}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Paid Deliveries */}
                    <div>
                        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569', marginBottom: '0.75rem', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            Prepaid Orders Delivered
                            {paidDeliveredRTOPinCodes.length > 0 && (
                                <button
                                    onClick={() => handleCopyPincodes(paidDeliveredRTOPinCodes.map(r => r.pin), 'paidDelivered')}
                                    style={{ background: 'none', border: '1px solid #99f6e4', cursor: 'pointer', color: '#0d9488', fontSize: '0.75rem', padding: '0.25rem 0.6rem', borderRadius: '6px', backgroundColor: '#ccfbf1', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 500 }}
                                    title="Copy these pin codes"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                    {copiedSection === 'paidDelivered' ? 'Copied!' : 'Copy'}
                                </button>
                            )}
                        </h4>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {paidDeliveredRTOPinCodes.length === 0 ? (
                                <div style={{ color: '#64748b', fontSize: '0.85rem' }}>No successful Prepaid deliveries found.</div>
                            ) : (
                                paidDeliveredRTOPinCodes.map((row) => (
                                    <div
                                        key={row.pin}
                                        onClick={() => handleCopy(row.pin + '-paid', row.orders)}
                                        style={{
                                            padding: '0.35rem 0.75rem',
                                            backgroundColor: '#f0fdfa',
                                            border: '1px solid #5eead4',
                                            borderRadius: '16px',
                                            fontSize: '0.85rem',
                                            fontWeight: 700,
                                            color: '#0d9488',
                                            cursor: row.orders.length > 0 ? 'pointer' : 'default',
                                            transition: 'all 0.2s ease',
                                        }}
                                        title={`Delivered Prepaid Orders: ${row.delivered} - Click to copy orders`}
                                    >
                                        {copiedPin === row.pin + '-paid' ? 'Copied' : row.pin}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Manage Blocked Pin Codes Modal */}
            {showModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
                    <div style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '12px', width: '90%', maxWidth: '500px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1e293b' }}>Manage RTO Pin Codes</h2>
                            <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.75rem', color: '#64748b', lineHeight: 1 }}>&times;</button>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <textarea
                                    placeholder="Enter Pin Codes (one per line)..."
                                    value={newPinCode}
                                    onChange={(e) => setNewPinCode(e.target.value)}
                                    style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem', minHeight: '60px', resize: 'vertical' }}
                                />
                                <button
                                    onClick={handleAddPinCode}
                                    disabled={isSaving || !newPinCode.trim()}
                                    style={{ padding: '0.75rem 1.5rem', borderRadius: '6px', backgroundColor: '#3b82f6', color: '#fff', border: 'none', cursor: (isSaving || !newPinCode.trim()) ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: '0.95rem', alignSelf: 'flex-start' }}
                                >
                                    {isSaving ? 'Saving...' : 'Add'}
                                </button>
                            </div>
                            <input
                                type="text"
                                placeholder="Notes (optional, e.g., 'High RTO Zone')"
                                value={newPinCodeNotes}
                                onChange={(e) => setNewPinCodeNotes(e.target.value)}
                                style={{ width: '100%', padding: '0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.95rem', boxSizing: 'border-box' }}
                            />
                        </div>

                        <div style={{ overflowY: 'auto', maxHeight: '300px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.95rem' }}>
                                <thead>
                                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                                        <th style={{ padding: '0.75rem', color: '#475569', fontWeight: 600, width: '30%' }}>Pin Code</th>
                                        <th style={{ padding: '0.75rem', color: '#475569', fontWeight: 600, width: '55%' }}>Notes</th>
                                        <th style={{ padding: '0.75rem', color: '#475569', fontWeight: 600, textAlign: 'right', width: '15%' }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {blockedPinCodes.length === 0 ? (
                                        <tr><td colSpan={3} style={{ padding: '1.5rem 1rem', textAlign: 'center', color: '#64748b' }}>No RTO pin codes added yet.</td></tr>
                                    ) : (
                                        blockedPinCodes.map((p) => (
                                            <tr key={p.pinCode} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                <td style={{ padding: '0.75rem', fontWeight: 500 }}>{p.pinCode}</td>
                                                <td style={{ padding: '0.75rem', color: '#64748b' }}>{p.notes || '-'}</td>
                                                <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                    <button onClick={() => handleDeletePinCode(p.pinCode)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }} title="Remove">
                                                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                                        </svg>
                                                    </button>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
