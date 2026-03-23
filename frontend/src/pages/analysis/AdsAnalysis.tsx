import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';
import { 
    Upload, 
    Trash2, 
    BrainCircuit,
    Clipboard
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
    const [chatHistory, setChatHistory] = useState<any[]>([]);
    const [chatInput, setChatInput] = useState('');
    const [isSendingChat, setIsSendingChat] = useState(false);

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
                setChatHistory(data.chat || []);
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
                setChatHistory(res.data.chat || []);
            } else {
                setRecommendations([]);
                setOverallStrategy('');
                setChatHistory([]);
            }
        } catch (err) {
            toast.error('Failed to load session');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSendChat = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        const effectiveDate = selectedDate || historyDates[0] || archivedDates[archivedDates.length - 1];
        if (!chatInput.trim() || !effectiveDate || isSendingChat) return;
        
        if (!selectedDate) setSelectedDate(effectiveDate);

        const message = chatInput.trim();
        setChatInput('');
        setIsSendingChat(true);

        const tempChat = [...chatHistory, { role: 'user', content: message, timestamp: new Date() }];
        setChatHistory(tempChat);

        try {
            const res = await api.adsChat(message, effectiveDate);
            if (res.success) {
                setChatHistory(res.chat);
            } else {
                toast.error(res.error || 'Chat failed');
            }
        } catch (err) {
            toast.error('Failed to connect to AI strategist');
        } finally {
            setIsSendingChat(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const toastId = toast.loading('Processing CSVs...');
        let processedCount = 0;

        for (const file of files) {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: async (results) => {
                    const fileName = file.name.toLowerCase();
                    const level = fileName.includes('campaign') ? 'campaign' : 
                                 (fileName.includes('adset') || fileName.includes('ad set')) ? 'adset' : 'ad';

                    const data = results.data.map((row: any) => ({
                        name: row['Ad Set Name'] || row['Campaign Name'] || row['Ad Name'] || 'Unknown',
                        status: row['Delivery'] || 'Unknown',
                        spend: parseFloat(row['Amount spent (INR)'] || '0'),
                        purchases: parseInt(row['Purchases'] || '0'),
                        roas: parseFloat(row['Website purchase ROAS (return on ad spend)'] || '0'),
                        reach: parseInt(row['Reach'] || '0'),
                        impressions: parseInt(row['Impressions'] || '0'),
                        level,
                        date: row['Reporting Starts']
                    }));

                    try {
                        const res = await api.saveAdsPerformance(data, level);
                        if (res.success) {
                            processedCount++;
                            if (processedCount === files.length) {
                                toast.success(`Successfully archived ${files.length} reports`, { id: toastId });
                                setUploadedData(prev => [...prev, ...data]);
                                loadData();
                            }
                        }
                    } catch (err) {
                        toast.error(`Error processing ${file.name}`);
                    }
                }
            });
        }
    };

    const handleExportJSON = async () => {
        const toastId = toast.loading('Extracting full historical database...');
        try {
            const allRes = await api.getAdsPerformanceAll();
            
            const fullSnapshot = {
                exportType: 'FULL_HISTORIC_ADS_PERFORMANCE',
                totalRecords: allRes.count,
                timestamp: new Date().toISOString(),
                // Group by date for easier external analysis
                performanceData: allRes.success ? allRes.data : [],
                aiHistory: {
                    recommendationsAvailable: recommendations,
                    overallStrategy: overallStrategy
                },
                chatHistoryContext: chatHistory
            };

            await navigator.clipboard.writeText(JSON.stringify(fullSnapshot, null, 2));
            toast.success(`Exported ${allRes.count} total records!`, { id: toastId });
        } catch (err) {
            toast.error('Failed to export dataset', { id: toastId });
        }
    };

    const handleClearAdsPerformance = async () => {
        if (!window.confirm('Clear ALL archived ads data? This cannot be undone.')) return;
        try {
            const res = await api.clearAdsPerformance();
            if (res.success) {
                toast.success('Archive cleared');
                setArchivedDates([]);
                setRecommendations([]);
                setOverallStrategy('');
                setChatHistory([]);
            }
        } catch (err) {
            toast.error('Failed to clear archive');
        }
    };

    const handleAnalyzeAds = async () => {
        setIsAnalyzing(true);
        try {
            const res = await api.analyzeAds(uploadedData);
            if (res.success) {
                toast.success('Analysis complete');
                setRecommendations(res.recommendations);
                setOverallStrategy(res.overallStrategy);
                setChatHistory([]);
                const datesRes = await api.getAdsAnalysisDates();
                if (datesRes.success) setHistoryDates(datesRes.dates);
            } else {
                toast.error(res.error || 'Analysis failed');
            }
        } catch (err) {
            toast.error('Consultation failed');
        } finally {
            setIsAnalyzing(false);
        }
    };

    const [tooltip, setTooltip] = useState<{ dateLabel: string; hasData: boolean; x: number; y: number } | null>(null);

    const renderDataCalendar = () => {
        const year = 2026;
        const months = [
            { name: 'January', idx: 0 }, { name: 'February', idx: 1 }, 
            { name: 'March', idx: 2 }, { name: 'April', idx: 3 }
        ];

        return (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#0f172a', margin: 0 }}>Ads Data Archive Coverage — {year}</h2>
                        <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>Visual overview of data available for analysis.</p>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
                    {months.map(month => {
                        const daysInMonth = new Date(year, month.idx + 1, 0).getDate();
                        const startDay = (new Date(year, month.idx, 1).getDay() + 6) % 7;

                        return (
                            <div key={month.idx}>
                                <h3 style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem', textAlign: 'center' }}>{month.name}</h3>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                                    {Array(startDay).fill(null).map((_, i) => <div key={`e-${i}`} />)}
                                    {Array.from({ length: daysInMonth }).map((_, i) => {
                                        const day = i + 1;
                                        const dateKey = `${year}-${(month.idx + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                                        const hasData = archivedDates.includes(dateKey);
                                        return (
                                            <div
                                                key={day}
                                                onMouseEnter={(e) => {
                                                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                                                    setTooltip({ dateLabel: `${day} ${month.name}`, hasData, x: rect.left + rect.width / 2, y: rect.top });
                                                }}
                                                onMouseLeave={() => setTooltip(null)}
                                                style={{ aspectRatio: '1/1', borderRadius: '2px', backgroundColor: hasData ? '#7c3aed' : '#f1f5f9', cursor: 'pointer' }}
                                            />
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {tooltip && (
                    <div style={{ position: 'fixed', left: tooltip.x, top: tooltip.y - 10, transform: 'translate(-50%, -100%)', backgroundColor: '#1e293b', color: 'white', padding: '0.4rem 0.6rem', borderRadius: '4px', fontSize: '0.7rem', zIndex: 1000, whiteSpace: 'nowrap' }}>
                        {tooltip.dateLabel}: {tooltip.hasData ? '✅ Archived' : '❌ Missing'}
                    </div>
                )}
            </div>
        );
    };

    const getDecisionColor = (decision: string) => {
        switch (decision) {
            case 'SCALE': return '#10b981';
            case 'DUPLICATE': return '#7c3aed';
            case 'CLOSE': return '#ef4444';
            case 'MONITOR': return '#f59e0b';
            default: return '#64748b';
        }
    };

    if (isLoading) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading Strategy Center...</div>;

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' }}>Ads Strategy Center</h1>
                    <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.9rem' }}>AI-driven Meta performance scaling & risk management.</p>
                </div>
                
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#fff', padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>History:</span>
                        <select 
                            value={selectedDate}
                            onChange={(e) => handleDateChange(e.target.value)}
                            style={{ border: 'none', background: 'none', fontSize: '0.85rem', color: '#1e293b', fontWeight: 600, outline: 'none', cursor: 'pointer' }}
                        >
                            <option value="">Select date...</option>
                            {historyDates.map(d => (
                                <option key={d} value={d}>{new Date(d).toLocaleDateString()}</option>
                            ))}
                        </select>
                    </div>

                    <button
                        onClick={handleAnalyzeAds}
                        disabled={isAnalyzing}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#7c3aed', color: 'white', border: 'none', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                    >
                        <BrainCircuit size={18} />
                        {isAnalyzing ? 'Architecting...' : 'Initiate Analysis'}
                    </button>

                    <button
                        onClick={handleExportJSON}
                        disabled={historyDates.length === 0 && archivedDates.length === 0}
                        title="Copy ALL archived ads records to clipboard"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: '#f1f5f9', color: '#1e293b', border: '1px solid #e2e8f0', padding: '0.6rem 1rem', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                    >
                        <Clipboard size={18} />
                        Export All Data
                    </button>
                    
                    <button onClick={handleClearAdsPerformance} style={{ color: '#ef4444', border: 'none', padding: '0.6rem', background: 'none', cursor: 'pointer' }}>
                        <Trash2 size={20} />
                    </button>
                </div>
            </div>

            {/* Calendar View */}
            {renderDataCalendar()}

            {/* Upload Area */}
            <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Archival Sync</h3>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Multi-file CSV upload for Campaigns, Ad Sets, and Ads.</p>
                </div>
                <label style={{ backgroundColor: '#f8fafc', color: '#1e293b', padding: '0.6rem 1.2rem', borderRadius: '8px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Upload size={18} /> Upload & Archive
                    <input type="file" accept=".csv" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
            </div>

            {/* Results Section */}
            {(overallStrategy || recommendations.length > 0) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {overallStrategy && (
                        <div style={{ backgroundColor: '#f5f3ff', padding: '1.5rem', borderRadius: '12px', border: '1px solid #ddd6fe' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <BrainCircuit size={20} color="#7c3aed" />
                                <strong style={{ color: '#5b21b6' }}>AI Strategic Narrative</strong>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.95rem', color: '#4c1d95', lineHeight: 1.6 }}>{overallStrategy}</p>
                        </div>
                    )}

                    {recommendations.length > 0 && (
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            {recommendations.map((rec, i) => (
                                <div key={i} style={{ backgroundColor: '#fff', border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{rec.name}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{rec.rationale}</div>
                                    </div>
                                    <div style={{ textAlign: 'right', minWidth: '120px' }}>
                                        <div style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 800, color: 'white', backgroundColor: getDecisionColor(rec.decision) }}>{rec.decision}</div>
                                        {rec.targetSpend && <div style={{ fontSize: '0.8rem', fontWeight: 700, marginTop: '4px' }}>₹{rec.targetSpend.toLocaleString()}</div>}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Strategy Chat */}
            <div style={{ backgroundColor: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f1f5f9', background: '#f8fafc', fontWeight: 600 }}>Interrogate Strategy Architect</div>
                <div style={{ height: '400px', overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {chatHistory.length === 0 && <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>Type your strategy questions below.</p>}
                    {chatHistory.map((msg, i) => (
                        <div key={i} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ padding: '0.6rem 1rem', borderRadius: '12px', fontSize: '0.9rem', backgroundColor: msg.role === 'user' ? '#1e293b' : '#f1f5f9', color: msg.role === 'user' ? '#fff' : '#1e293b' }}>
                                {msg.role === 'assistant' ? (
                                    <ReactMarkdown 
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            p: ({node, ...props}) => <p style={{ margin: '0 0 0.5rem 0' }} {...props} />,
                                            ul: ({node, ...props}) => <ul style={{ paddingLeft: '1.25rem', margin: '0 0 0.5rem 0' }} {...props} />,
                                            li: ({node, ...props}) => <li style={{ marginBottom: '0.25rem' }} {...props} />,
                                            strong: ({node, ...props}) => <strong style={{ fontWeight: 700 }} {...props} />
                                        }}
                                    >
                                        {msg.content}
                                    </ReactMarkdown>
                                ) : (
                                    msg.content
                                )}
                            </div>
                            <span style={{ fontSize: '0.6rem', color: '#94a3b8', textAlign: msg.role === 'user' ? 'right' : 'left' }}>{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                    ))}
                </div>
                <form onSubmit={handleSendChat} style={{ padding: '1rem', borderTop: '1px solid #f1f5f9', display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                    <textarea 
                        value={chatInput} 
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                        placeholder="State your strategic inquiry..."
                        style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', outline: 'none', fontSize: '0.9rem', resize: 'vertical', minHeight: '80px', fontFamily: 'inherit' }}
                    />
                    <button type="submit" disabled={isSendingChat || !chatInput.trim()} style={{ backgroundColor: '#7c3aed', color: 'white', border: 'none', borderRadius: '8px', padding: '0.75rem 1.25rem', fontWeight: 600, cursor: 'pointer' }}>
                        {isSendingChat ? 'Analysing...' : 'Consult'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default AdsAnalysis;
