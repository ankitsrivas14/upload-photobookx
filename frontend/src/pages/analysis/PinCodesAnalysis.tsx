import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Alert, Button, Card, Dialog, EmptyState, Skeleton, StatCard, StatStrip, TextField, Tooltip } from '../../components/ui/pbx';
import { cx } from '../../components/ui/format';
import styles from '../AnalysisPage.module.css';

interface BlockedPinCode {
    pinCode: string;
    notes?: string;
}

export function PinCodesAnalysis() {
    const [pinCodeStats, setPinCodeStats] = useState<Record<string, { codFailed: number; codTotal: number; codDelivered: number; paidDelivered: number; codFailedOrders: string[]; codDeliveredOrders: string[]; paidDeliveredOrders: string[] }>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Blocked Pin Codes State
    const [showModal, setShowModal] = useState(false);
    const [blockedPinCodes, setBlockedPinCodes] = useState<BlockedPinCode[]>([]);
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
                const uniqueNew: BlockedPinCode[] = [];
                const seen = new Set<string>();
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
        return <Skeleton lines={8} />;
    }

    if (error) {
        return <Alert tone="negative" action={<Button size="sm" onClick={loadPinCodes}>Retry</Button>}>{error}</Alert>;
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

    const copyButton = (pins: string[], section: string, label = 'Copy pin codes') =>
        pins.length > 0 ? (
            <Button size="sm" icon={copiedSection === section ? 'check' : 'copy'} onClick={() => handleCopyPincodes(pins, section)}>
                {copiedSection === section ? 'Copied' : label}
            </Button>
        ) : null;

    return (
        <>
            <StatStrip>
                <StatCard label="COD pin codes with failures" value={pinCodeDataList.length.toLocaleString('en-IN')} tone={pinCodeDataList.length > 0 ? 'negative' : 'neutral'} sub="no COD delivery yet" />
                <StatCard label="RTO pin codes" value={blockedPinCodes.length.toLocaleString('en-IN')} sub="blocked or flagged" />
                <StatCard label="RTO pin codes with COD deliveries" value={codDeliveredRTOPinCodes.length.toLocaleString('en-IN')} />
                <StatCard label="RTO pin codes with prepaid deliveries" value={paidDeliveredRTOPinCodes.length.toLocaleString('en-IN')} />
            </StatStrip>

            <Card
                title="Failed pin codes"
                eyebrow="COD pin codes with failures and no delivery · click one to copy its orders"
                actions={copyButton(pinCodeDataList.map(r => r.pin), 'failed')}
            >
                {pinCodeDataList.length === 0 ? (
                    <EmptyState size="sm" icon="map-pin" title="No failed pin codes" />
                ) : (
                    <div className={styles.pins}>
                        {pinCodeDataList.map((row) => {
                            const isRTO = blockedPinCodes.some(p => p.pinCode === row.pin);
                            return (
                                <Tooltip content={isRTO ? 'RTO pin code' : `Failed ${row.failed} of ${row.total} (${row.failRate}%) · click to copy the orders`} key={row.pin}>
                                    <button
                                        type="button"
                                        className={cx(styles.pin, isRTO && styles.pinRisk)}
                                        onClick={() => handleCopy(row.pin, row.orders)}
                                    >
                                        {copiedPin === row.pin ? 'Copied' : row.pin}
                                    </button>
                                </Tooltip>
                            );
                        })}
                    </div>
                )}
            </Card>

            <Card
                title="RTO pin codes"
                eyebrow="blocked or flagged for RTO"
                actions={
                    <>
                        {copyButton(blockedPinCodes.map(p => p.pinCode), 'rto')}
                        <Button size="sm" icon="settings" onClick={() => setShowModal(true)}>Manage</Button>
                    </>
                }
            >
                {blockedPinCodes.length === 0 ? (
                    <EmptyState size="sm" icon="map-pin" title="No RTO pin codes yet" description="Add some with Manage." />
                ) : (
                    <div className={styles.pins}>
                        {blockedPinCodes.map((p) => (
                            <Tooltip content={p.notes ? `Notes: ${p.notes}` : 'RTO pin code'} key={p.pinCode}>
                                <span className={cx(styles.pin, styles.pinRisk, styles.pinStatic)}>
                                    {p.pinCode}
                                </span>
                            </Tooltip>
                        ))}
                    </div>
                )}
            </Card>

            <Card title="Successful deliveries to RTO pin codes" eyebrow="RTO pin codes that still have delivered orders · click one to copy its orders">
                <div className={styles.row}>
                    <div>
                        <div className={styles.subHead}>
                            <span>COD orders delivered</span>
                            {copyButton(codDeliveredRTOPinCodes.map(r => r.pin), 'codDelivered', 'Copy')}
                        </div>
                        {codDeliveredRTOPinCodes.length === 0 ? (
                            <p className={styles.muted}>No successful COD deliveries found.</p>
                        ) : (
                            <div className={styles.pins}>
                                {codDeliveredRTOPinCodes.map((row) => (
                                    <Tooltip content={`Delivered COD orders: ${row.delivered} · failed: ${row.failed} · click to copy the orders`} key={row.pin}>
                                        <button
                                            type="button"
                                            className={cx(styles.pin, styles.pinGood)}
                                            onClick={() => handleCopy(row.pin + '-cod', row.orders)}
                                        >
                                            {copiedPin === row.pin + '-cod' ? 'Copied' : row.pin}
                                        </button>
                                    </Tooltip>
                                ))}
                            </div>
                        )}
                    </div>
                    <div>
                        <div className={styles.subHead}>
                            <span>Prepaid orders delivered</span>
                            {copyButton(paidDeliveredRTOPinCodes.map(r => r.pin), 'paidDelivered', 'Copy')}
                        </div>
                        {paidDeliveredRTOPinCodes.length === 0 ? (
                            <p className={styles.muted}>No successful prepaid deliveries found.</p>
                        ) : (
                            <div className={styles.pins}>
                                {paidDeliveredRTOPinCodes.map((row) => (
                                    <Tooltip content={`Delivered prepaid orders: ${row.delivered} · click to copy the orders`} key={row.pin}>
                                        <button
                                            type="button"
                                            className={cx(styles.pin, styles.pinGood)}
                                            onClick={() => handleCopy(row.pin + '-paid', row.orders)}
                                        >
                                            {copiedPin === row.pin + '-paid' ? 'Copied' : row.pin}
                                        </button>
                                    </Tooltip>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </Card>

            <Dialog open={showModal} onClose={() => setShowModal(false)} size="lg" title="Manage RTO pin codes">
                <div className={styles.blockForm}>
                    <TextField
                        multiline
                        rows={3}
                        label="Pin codes"
                        hint="One per line."
                        placeholder={'110001\n560034'}
                        value={newPinCode}
                        onChange={(e) => setNewPinCode(e.target.value)}
                    />
                    <TextField label="Notes" placeholder="e.g. High RTO zone" value={newPinCodeNotes} onChange={(e) => setNewPinCodeNotes(e.target.value)} />
                    <Button variant="primary" icon="plus" onClick={handleAddPinCode} loading={isSaving} disabled={!newPinCode.trim()}>Block pin codes</Button>
                </div>
                {blockedPinCodes.length === 0 ? (
                    <EmptyState size="sm" icon="map-pin" title="No RTO pin codes added yet" />
                ) : (
                    <div className="pbx-table">
                        <div className="pbx-table__scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th scope="col">Pin code</th>
                                        <th scope="col">Notes</th>
                                        <th scope="col"><span className="pbx-sr">Actions</span></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {blockedPinCodes.map((p) => (
                                        <tr key={p.pinCode}>
                                            <td className="pbx-mono">{p.pinCode}</td>
                                            <td className={styles.muted}>{p.notes || '—'}</td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <Button size="sm" variant="ghost" iconOnly icon="trash-2" tooltip="Remove" onClick={() => handleDeletePinCode(p.pinCode)}>
                                                        {`Remove ${p.pinCode}`}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Dialog>
        </>
    );
}
