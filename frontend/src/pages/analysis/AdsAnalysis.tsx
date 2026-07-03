import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';
import { 
    Trash2, 
    BrainCircuit,
    Clipboard,
    History,
    FileUp,
    Calendar
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function AdsAnalysis() {
    const [isLoading, setIsLoading] = useState(true);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [recommendations, setRecommendations] = useState<any[]>([]);
    const [overallStrategy, setOverallStrategy] = useState<string>('');
    const [uploadedData, setUploadedData] = useState<any[]>([]);
    const [archivedDates, setArchivedDates] = useState<string[]>([]);
    const [historyDates, setHistoryDates] = useState<string[]>([]);
    const [selectedDate, setSelectedDate] = useState<string>('');

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [statusRes, analysisRes, datesRes] = await Promise.all([
                api.getAdsPerformanceStatus(),
                api.getAdsAnalysisLatest(),
                api.getAdsAnalysisDates()
            ]);

            if (statusRes.success) {
                setArchivedDates(statusRes.archivedDates || []);
            }

            if (datesRes.success) {
                setHistoryDates(datesRes.dates || []);
            }

            if (analysisRes.success && analysisRes.data) {
                const data = analysisRes.data;
                setRecommendations(data.recommendations || []);
                setOverallStrategy(data.overallStrategy || '');
                setSelectedDate(data.date || '');
            }
        } catch (err) {
            console.error('Error loading ads analysis:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDateChange = async (date: string) => {
        if (!date) return;
        setSelectedDate(date);
        setIsLoading(true);
        try {
            const res = await api.getAdsAnalysis(date);
            if (res.success && res.data) {
                setRecommendations(res.data.recommendations || []);
                setOverallStrategy(res.data.overallStrategy || '');
            } else {
                setRecommendations([]);
                setOverallStrategy('');
            }
        } catch (err) {
            toast.error('Failed to load session');
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setRecommendations([]);
        setOverallStrategy('');
        const toastId = toast.loading('Syncing...');
        let processedCount = 0;
        const totalFiles = files.length;

        for (const file of Array.from(files)) { // Convert FileList to Array for consistent iteration
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: async (results) => {
                    const fileName = file.name.toLowerCase();
                    let level: 'campaign' | 'adset' | 'ad' = 'ad';
                    
                    if (fileName.includes('campaign')) {
                        level = 'campaign';
                    } else if (fileName.includes('ad-set') || fileName.includes('ad_set') || fileName.includes('adset') || fileName.includes('ad set')) {
                        level = 'adset';
                    } else if (fileName.includes('ads') || fileName.includes('creative')) {
                        level = 'ad';
                    }

                    const data = results.data.filter((row: any) => Object.keys(row).length > 2).map((row: any) => {
                        const rawKeys = Object.keys(row);
                        const cleanKey = (k: string) => k.replace(/[^\x20-\x7E]/g, '').trim();
                        const keyMap: Record<string, string> = {};
                        rawKeys.forEach(k => { keyMap[cleanKey(k).toLowerCase()] = k; });
                        const keys = Object.keys(keyMap);

                        const findActualKey = (candidates: string[]) => {
                            for (const cand of candidates) {
                                if (keyMap[cand.toLowerCase()]) return keyMap[cand.toLowerCase()];
                            }
                            for (const cand of candidates) {
                                const found = keys.find(k => k.includes(cand.toLowerCase()));
                                if (found) return keyMap[found];
                            }
                            return null;
                        };

                        const cleanNum = (val: any) => {
                            if (val === undefined || val === null) return 0;
                            const str = String(val).replace(/[₹,]/g, '').trim();
                            return parseFloat(str) || 0;
                        };

                        const nameKey = findActualKey(['ad set name', 'campaign name', 'ad name', 'ad set', 'campaign', 'ad', 'name']);
                        const name = (nameKey && !nameKey.toLowerCase().includes('account')) ? row[nameKey] : 'Unknown';
                        const spendKey = findActualKey(['amount spent', 'spend', 'cost']);
                        const spend = cleanNum(row[spendKey || '']);
                        const purchasesKey = findActualKey(['purchases', 'results', 'conversions']);
                        const purchases = Math.round(cleanNum(row[purchasesKey || '']));
                        const roasKey = findActualKey(['roas', 'return on ad spend', 'website purchase roas']);
                        const roas = cleanNum(row[roasKey || '']);
                        const reachKey = findActualKey(['reach']);
                        const reach = cleanNum(row[reachKey || '']);
                        const impressionsKey = findActualKey(['impressions']);
                        const impressions = cleanNum(row[impressionsKey || '']);
                        
                        // New fields for deeper AI Analysis
                        const cpcKey = findActualKey(['cpc', 'cost per link click']);
                        const cpc = cleanNum(row[cpcKey || '']);
                        const ctrKey = findActualKey(['ctr', 'link click-through rate']);
                        const ctr = cleanNum(row[ctrKey || '']);
                        const cpaKey = findActualKey(['cost per result', 'cost per purchase', 'cpa']);
                        let cpa = cleanNum(row[cpaKey || '']);
                        if (!cpa && purchases > 0) cpa = spend / purchases; // fallback calculation
                        const clicksKey = findActualKey(['link clicks', 'clicks (all)', 'clicks']);
                        const clicks = cleanNum(row[clicksKey || '']);

                        const cpmKey = findActualKey(['cost per 1,000 impressions', 'cpm']);
                        const cpm = cleanNum(row[cpmKey || '']);
                        const frequencyKey = findActualKey(['frequency']);
                        const frequency = cleanNum(row[frequencyKey || '']);
                        const addsToCartKey = findActualKey(['adds to cart']);
                        const addsToCart = cleanNum(row[addsToCartKey || '']);
                        const outboundClicksKey = findActualKey(['outbound clicks']);
                        const outboundClicks = cleanNum(row[outboundClicksKey || '']);

                        // Actual daily budget — critical for SCALE vs DUPLICATE decisions
                        const budgetKey = findActualKey(['ad set budget', 'budget']);
                        const dailyBudget = cleanNum(row[budgetKey || '']);

                        // Video funnel — hook/hold diagnostics for reel creatives
                        const videoPlays = cleanNum(row[findActualKey(['video plays']) || '']);
                        const videoAvgPlayTime = cleanNum(row[findActualKey(['video average play time']) || '']);
                        const videoPlays25 = cleanNum(row[findActualKey(['video plays at 25%']) || '']);
                        const videoPlays50 = cleanNum(row[findActualKey(['video plays at 50%']) || '']);
                        const videoPlays75 = cleanNum(row[findActualKey(['video plays at 75%']) || '']);
                        const videoPlays95 = cleanNum(row[findActualKey(['video plays at 95%']) || '']);
                        const videoPlays100 = cleanNum(row[findActualKey(['video plays at 100%']) || '']);

                        const dateKey = findActualKey(['reporting starts', 'date', 'day']);
                        const date = row[dateKey || ''] || '';
                        const statusKey = findActualKey(['delivery', 'status', 'ad delivery']);
                        const status = row[statusKey || ''] || 'Active';

                        return { name, status, spend, purchases, roas, reach, impressions, cpc, ctr, cpa, clicks, cpm, frequency, addsToCart, outboundClicks, dailyBudget, videoPlays, videoAvgPlayTime, videoPlays25, videoPlays50, videoPlays75, videoPlays95, videoPlays100, level, date };
                    });

                    try {
                        const res = await api.saveAdsPerformance(data, level);
                        if (res.success) {
                            processedCount++;
                            setUploadedData(prev => [...prev, ...data]);
                            if (processedCount === totalFiles) {
                                toast.success(`Successfully synced ${totalFiles} tactical reports`, { id: toastId });
                                loadData();
                            }
                        }
                    } catch (err) {
                        toast.error(`Sync error: ${file.name}`);
                    }
                }
            });
        }
    };

const handleExportJSON = async () => {
        const toastId = toast.loading('Exporting performance snapshot...');
        try {
            const allRes = await api.getAdsPerformanceAll();
            const fullSnapshot = {
                exportType: 'HISTORIC_PERFORMANCE_AUDIT',
                timestamp: new Date().toISOString(),
                records: allRes.success ? allRes.data : [],
                strategicNarrative: overallStrategy
            };
            await navigator.clipboard.writeText(JSON.stringify(fullSnapshot, null, 2));
            toast.success('Snapshot copied!', { id: toastId });
        } catch (err) {
            toast.error('Export failed', { id: toastId });
        }
    };

    const handleClearAdsPerformance = async () => {
        if (!window.confirm('Wipe ALL archived ads data? This cannot be undone.')) return;
        try {
            const res = await api.clearAdsPerformance();
            if (res.success) {
                toast.success('Archive wiped');
                setArchivedDates([]);
                setRecommendations([]);
                setOverallStrategy('');
            }
        } catch (err) {
            toast.error('Wipe failed');
        }
    };

    const handleAnalyzeAds = async () => {
        setIsAnalyzing(true);
        try {
            // Source data: Prioritize newly synced data ALWAYS
            let sourceData = [...uploadedData];
            const isFreshUpload = sourceData.length > 0;
            
            // If nothing fresh, and we are looking at an archive, allow re-analysis of the archive
            if (sourceData.length === 0 && recommendations.length > 0) {
                console.log('No fresh sync found. Re-analyzing existing view...');
                sourceData = recommendations.map(r => ({
                    name: r.name,
                    spend: r.stats?.spend || 0,
                    purchases: r.stats?.purchases || 0,
                    roas: r.stats?.roas || 0,
                    reach: r.stats?.reach || 0,
                    impressions: r.stats?.impressions || 0,
                    cpc: r.stats?.cpc || 0,
                    ctr: r.stats?.ctr || 0,
                    cpa: r.stats?.cpa || 0,
                    clicks: r.stats?.clicks || 0,
                    cpm: r.stats?.cpm || 0,
                    frequency: r.stats?.frequency || 0,
                    addsToCart: r.stats?.addsToCart || 0,
                    outboundClicks: r.stats?.outboundClicks || 0,
                    level: r.level || 'adset'
                }));
            }

            if (sourceData.length === 0) {
                toast.error('No performance data found. Please sync CSV files first.');
                return;
            }

            // Deduplicate only exact matches of name + level to preserve campaigns, ad sets, and ads together
            const uniqueMap: Record<string, any> = {};

            sourceData.forEach(item => { 
                const cleanName = (item.name || '').trim();
                const level = item.level || 'unknown';
                if (!cleanName || cleanName.toLowerCase() === 'unknown') return;
                
                // Deduplicate by Name + Stats to avoid dropping distinct adsets that share identical names
                const key = `${level}:${cleanName}:${item.spend}:${item.reach}`;
                if (!uniqueMap[key]) {
                    uniqueMap[key] = item;
                }
            });

            const dedupedData = Object.values(uniqueMap);
            console.log(`Auditing ${dedupedData.length} unique items across all levels.`);

            const res = await api.analyzeAds(dedupedData);
            if (res.success) {
                toast.success(`Analysis ready for ${dedupedData.length} entities`);
                setRecommendations(res.recommendations);
                setOverallStrategy(res.overallStrategy);
                if (isFreshUpload) {
                    setUploadedData([]); // Clear buffer after successful analysis
                }
                loadData(); // Sync archive grid
            } else {
                toast.error(res.error || 'AI Analysis failed');
            }
        } catch (err) {
            console.error('Audit Error:', err);
            toast.error('Strategic engine failure');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const getStatusColor = (decision: string) => {
        switch (decision) {
            case 'SCALE': return { bg: '#e0f2fe', text: '#0369a1' };
            case 'DUPLICATE': return { bg: '#f3e8ff', text: '#6b21a8' };
            case 'CLOSE': return { bg: '#fee2e2', text: '#991b1b' };
            case 'MONITOR': return { bg: '#fef3c7', text: '#92400e' };
            default: return { bg: '#f1f5f9', text: '#475569' };
        }
    };

    const MarkdownContent = ({ content, color }: { content: string, color?: string }) => (
        <div style={{ fontSize: '0.825rem', color: color || '#64748b', lineHeight: 1.4 }}>
            <ReactMarkdown 
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({node, ...props}) => <p style={{ margin: '0 0 0.4rem 0' }} {...props} />,
                    ul: ({node, ...props}) => <ul style={{ paddingLeft: '1rem', margin: '0 0 0.4rem 0' }} {...props} />,
                    li: ({node, ...props}) => <li style={{ marginBottom: '0.2rem' }} {...props} />,
                    strong: ({node, ...props}) => <strong style={{ fontWeight: 700, color: '#1e293b' }} {...props} />
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );

    if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Loading Strategic Center...</div>;
    const handleDeleteDate = async (date: string) => {
        if (!window.confirm(`Are you sure you want to PERMANENTLY delete all archived ad data and AI strategy for ${date}?`)) return;
        
        try {
            const res = await api.deleteAdsPerformanceByDate(date);
            if (res.success) {
                toast.success(`Archive for ${date} cleared.`);
                loadData(); // Refresh grid
                if (date === selectedDate) {
                    setRecommendations([]);
                    setOverallStrategy('');
                    setSelectedDate('');
                }
            } else {
                toast.error(res.error || 'Failed to delete');
            }
        } catch (err) {
            toast.error('Error deleting archive');
        }
    };

    return (
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Minimal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#1e293b' }}>Strategy Center</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#fff', border: '1px solid #f1f5f9', padding: '0.4rem 0.75rem', borderRadius: '8px' }}>
                        <History size={14} color="#94a3b8" />
                        <select 
                            value={selectedDate}
                            onChange={(e) => handleDateChange(e.target.value)}
                            style={{ border: 'none', background: 'none', fontSize: '0.825rem', color: '#64748b', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="">History...</option>
                            {historyDates.map(d => (
                                <option key={d} value={d}>{new Date(d).toLocaleDateString()}</option>
                            ))}
                        </select>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', backgroundColor: '#fff', border: '1px solid #f1f5f9', padding: '0.4rem 1rem', borderRadius: '8px', fontSize: '0.825rem', fontWeight: 600, color: '#1e293b' }}>
                        <FileUp size={14} /> Sync
                        <input type="file" accept=".csv" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    <button
                        onClick={handleAnalyzeAds}
                        disabled={isAnalyzing}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#0f172a', color: '#fff', border: 'none', padding: '0.4rem 1rem', borderRadius: '8px', fontSize: '0.825rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                        <BrainCircuit size={14} /> {isAnalyzing ? 'Architecting...' : 'Initiate Audit'}
                    </button>
                    <button onClick={handleExportJSON} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><Clipboard size={16} /></button>
                    <button onClick={handleClearAdsPerformance} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', opacity: 0.5 }}><Trash2 size={16} /></button>
                </div>
            </div>

            {/* Overall Strategy Brief */}
            {overallStrategy && (
                <div style={{ backgroundColor: '#fff', padding: '1rem', borderRadius: '10px', border: '1px solid #f1f5f9', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                    <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.7rem', fontWeight: 800, color: '#7c3aed', textTransform: 'uppercase' }}>AI Strategic Narrative</p>
                    <MarkdownContent content={overallStrategy} color="#475569" />
                </div>
            )}

            {/* Recommendations Table */}
            {recommendations.length > 0 && (
                <div style={{ backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #f1f5f9', textAlign: 'left' }}>
                                <th style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, width: '40px' }}>#</th>
                                <th style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600 }}>Performance Area / Ad Set</th>
                                <th style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, width: '120px' }}>Decision</th>
                                <th style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#94a3b8', fontWeight: 600, width: '120px' }}>Target Budget</th>
                            </tr>
                        </thead>
                        <tbody>
                            {recommendations.map((rec, i) => {
                                const colors = getStatusColor(rec.decision);
                                return (
                                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', verticalAlign: 'top' }}>
                                        <td style={{ padding: '0.75rem', fontSize: '0.75rem', color: '#cbd5e1', fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#1e293b', marginBottom: '0.25rem' }}>{rec.name}</div>
                                            <MarkdownContent content={rec.rationale} />
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.7rem', backgroundColor: colors.bg, color: colors.text, fontWeight: 700, textTransform: 'uppercase' }}>{rec.decision}</span>
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>{typeof rec.targetSpend === 'number' ? `₹${rec.targetSpend.toLocaleString()}` : rec.targetSpend}</div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Sharper, Fixed Archival Map (Full Year) */}
            <div style={{ alignSelf: 'flex-start', width: '100%', marginTop: '0.5rem', backgroundColor: '#fff', border: '1px solid #f1f5f9', borderRadius: '10px', padding: '1rem' }}>
                <div style={{ fontSize: '0.75rem', color: '#1e293b', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <Calendar size={14} color="#6366f1" /> 
                    <span>Performance Data Coverage (2026)</span>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
                    {/* Weekday Labels */}
                    <div style={{ display: 'grid', gridTemplateRows: 'repeat(7, 12px)', gap: '2px', fontSize: '10px', color: '#94a3b8', fontWeight: 700, flexShrink: 0 }}>
                        {['M', '', 'W', '', 'F', '', 'S'].map((l, i) => <div key={i} style={{ height: '12px', display: 'flex', alignItems: 'center' }}>{l}</div>)}
                    </div>

                    {/* Months Grid (Whole Year) */}
                    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(monthIdx => {
                            const year = 2026;
                            const monthName = new Date(year, monthIdx).toLocaleString('default', { month: 'short' }).toUpperCase();
                            const firstDayOfMonth = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
                            const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
                            const numWeeks = Math.ceil((daysInMonth + firstDayOfMonth) / 7);

                            const tiles = [];
                            for (let col = 0; col < numWeeks; col++) {
                                for (let row = 0; row < 7; row++) {
                                    const dayOfMonth = col * 7 + row - firstDayOfMonth + 1;
                                    if (dayOfMonth < 1 || dayOfMonth > daysInMonth) continue;

                                    const dateKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
                                    const hasData = archivedDates.includes(dateKey);

                                    tiles.push(
                                        <div
                                            key={dateKey}
                                            title={hasData ? `Click to delete archive for ${dateKey}` : `No data for ${dateKey}`}
                                            onClick={() => hasData && handleDeleteDate(dateKey)}
                                            style={{
                                                gridColumn: col + 1,
                                                gridRow: row + 1,
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '2px',
                                                backgroundColor: hasData ? '#6366f1' : '#e2e8f0',
                                                cursor: hasData ? 'pointer' : 'default',
                                                transition: 'transform 0.1s ease',
                                            }}
                                            onMouseEnter={(e) => hasData && (e.currentTarget.style.transform = 'scale(1.3)')}
                                            onMouseLeave={(e) => hasData && (e.currentTarget.style.transform = 'scale(1)')}
                                        />
                                    );
                                }
                            }

                            return (
                                <div key={monthIdx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                                    <div style={{ 
                                        display: 'grid', 
                                        gap: '2px', 
                                        gridTemplateColumns: `repeat(${numWeeks}, 12px)`, 
                                        gridTemplateRows: 'repeat(7, 12px)',
                                        gridAutoFlow: 'column'
                                    }}>
                                        {tiles}
                                    </div>
                                    <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#64748b', marginTop: '0.6rem', letterSpacing: '0.02em' }}>{monthName}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AdsAnalysis;
