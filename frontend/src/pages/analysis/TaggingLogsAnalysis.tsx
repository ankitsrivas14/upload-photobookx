import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import styles from '../AnalysisPage.module.css';

interface TaggingJobLog {
    _id: string;
    startedAt: string;
    completedAt: string;
    outcome: 'success' | 'error' | 'skipped';
    taggedCount: number;
    taggedCustomers: Array<{
        customerId: number;
        orderNumber: string;
        customerName?: string;
    }>;
    errorMessage?: string;
}

export function TaggingLogsAnalysis() {
    const [logs, setLogs] = useState<TaggingJobLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Filters
    const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');

    useEffect(() => {
        loadLogs();
    }, [outcomeFilter, startDate, endDate]);

    const loadLogs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            let activeEndDate = endDate;
            if (activeEndDate) {
                activeEndDate = `${activeEndDate}T23:59:59.999Z`;
            }
            let activeStartDate = startDate;
            if (activeStartDate) {
                activeStartDate = `${activeStartDate}T00:00:00.000Z`;
            }

            let url = `/api/admin/tagging-logs?limit=50&offset=0`;
            if (outcomeFilter && outcomeFilter !== 'all') url += `&outcome=${outcomeFilter}`;
            if (activeStartDate) url += `&startDate=${activeStartDate}`;
            if (activeEndDate) url += `&endDate=${activeEndDate}`;

            const response = await (api as any).request(url) as { success: boolean, logs?: any[], error?: string };

            if (response.success && response.logs) {
                setLogs(response.logs);
            } else {
                setError(response.error || 'Failed to load logs');
            }
        } catch (err: any) {
            setError(err.message || 'An error occurred while fetching logs');
        } finally {
            setIsLoading(false);
        }
    };

    const formatDuration = (start: string, end: string) => {
        const diff = new Date(end).getTime() - new Date(start).getTime();
        return `${(diff / 1000).toFixed(1)}s`;
    };

    if (isLoading) {
        return (
            <div className={styles['loading-section']}>
                <div className={styles.spinner}></div>
                <p>Loading tagging logs...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`${styles['content-section']} ${styles['error-state']}`}>
                <p>{error}</p>
                <button onClick={loadLogs} className={styles['retry-btn']}>Retry</button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#1e293b', margin: '0 0 0.25rem 0' }}>Job Run History</h2>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>Logs for the background job that tags high-risk customers with "no-cod".</p>
                </div>
                <button
                    onClick={loadLogs}
                    style={{
                        background: 'white',
                        border: '1px solid #e2e8f0',
                        padding: '0.4rem 0.75rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        color: '#334155',
                        fontWeight: 500,
                        cursor: 'pointer'
                    }}
                >
                    Refresh
                </button>
            </div>

            {/* Filters Bar */}
            <div style={{ display: 'flex', gap: '1.5rem', backgroundColor: '#fff', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid #e2e8f0', alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.02em' }}>Outcome:</label>
                    <select
                        value={outcomeFilter}
                        onChange={(e) => setOutcomeFilter(e.target.value)}
                        style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', color: '#1e293b', background: '#fff', cursor: 'pointer', minWidth: '120px' }}
                    >
                        <option value="all">All Outcomes</option>
                        <option value="success">Success</option>
                        <option value="error">Error</option>
                        <option value="skipped">Skipped</option>
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.02em' }}>From:</label>
                    <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', color: '#1e293b', background: '#fff', cursor: 'pointer' }}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.02em' }}>To:</label>
                    <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{ padding: '0.35rem 0.5rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', outline: 'none', color: '#1e293b', background: '#fff', cursor: 'pointer' }}
                    />
                </div>
                {(startDate || endDate || outcomeFilter !== 'all') && (
                    <button
                        onClick={() => {
                            setOutcomeFilter('all');
                            setStartDate('');
                            setEndDate('');
                        }}
                        style={{ marginLeft: 'auto', background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '0.35rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 500 }}
                    >
                        Clear Filters
                    </button>
                )}
            </div>

            <div className={styles['table-card']}>
                <div style={{ overflowX: 'auto' }}>
                    <table className={styles['data-table']}>
                        <thead>
                            <tr>
                                <th>Date & Time</th>
                                <th>Duration</th>
                                <th>Outcome</th>
                                <th>Tagged Count</th>
                                <th>Details</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: 'center', padding: '3rem', color: '#64748b', fontSize: '0.9rem' }}>
                                        No logs found. The job might not have run yet.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log._id}>
                                        <td style={{ whiteSpace: 'nowrap', color: '#1e293b', fontWeight: 500, fontSize: '0.9rem' }}>
                                            {new Date(log.startedAt).toLocaleString('en-IN', {
                                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                            })}
                                        </td>
                                        <td style={{ color: '#64748b', fontSize: '0.85rem' }}>
                                            {formatDuration(log.startedAt, log.completedAt)}
                                        </td>
                                        <td>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '0.15rem 0.5rem',
                                                borderRadius: '999px',
                                                fontSize: '0.65rem',
                                                fontWeight: 600,
                                                letterSpacing: '0.05em',
                                                textTransform: 'uppercase',
                                                backgroundColor: log.outcome === 'success' ? '#ecfdf5' : log.outcome === 'error' ? '#fef2f2' : '#f8fafc',
                                                color: log.outcome === 'success' ? '#059669' : log.outcome === 'error' ? '#dc2626' : '#64748b',
                                                border: `1px solid ${log.outcome === 'success' ? '#a7f3d0' : log.outcome === 'error' ? '#fecaca' : '#e2e8f0'}`
                                            }}>
                                                {log.outcome}
                                            </span>
                                        </td>
                                        <td>
                                            <span style={{ fontWeight: 600, color: '#1e293b' }}>{log.taggedCount}</span>
                                        </td>
                                        <td style={{ maxWidth: '400px', fontSize: '0.85rem', color: '#475569' }}>
                                            {log.outcome === 'error' ? (
                                                <span style={{ color: '#ef4444' }}>{log.errorMessage}</span>
                                            ) : (
                                                log.taggedCustomers?.length > 0 ? (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                                                        {log.taggedCustomers.map(c => (
                                                            <span key={`${c.customerId}-${c.orderNumber}`} style={{
                                                                background: '#f8fafc', border: '1px solid #e2e8f0', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.75rem', color: '#334155', whiteSpace: 'nowrap'
                                                            }}>
                                                                <span style={{ color: '#0ea5e9', fontWeight: 500 }}>{c.orderNumber}</span>
                                                                {c.customerName && <span style={{ color: '#64748b', marginLeft: '0.25rem' }}>({c.customerName})</span>}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span style={{ color: '#94a3b8' }}>-</span>
                                                )
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
