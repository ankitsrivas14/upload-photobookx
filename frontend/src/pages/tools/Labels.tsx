import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
).href;

interface PageResult {
    page: number;
    orderNumber: string | null;
    code: string | null;
}

async function extractTextPerPage(buffer: ArrayBuffer): Promise<string[]> {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const texts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        texts.push(content.items.map((item: any) => item.str).join(' '));
    }
    return texts;
}

function parseOrderCode(text: string): { orderNumber: string; code: string } | null {
    const match = text.match(/PB(\d+)S/);
    if (!match) return null;
    const digits = match[1];
    const code = digits.slice(-3).padStart(3, '0');
    return { orderNumber: match[0], code };
}

export function Labels() {
    const [results, setResults]     = useState<PageResult[]>([]);
    const [processing, setProcessing] = useState(false);
    const [fileName, setFileName]   = useState<string>('');
    const [error, setError]         = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        setError(null);
        setResults([]);
        setFileName(file.name);
        setProcessing(true);

        try {
            const buffer = await file.arrayBuffer();

            // 1. Extract text per page
            const pageTexts = await extractTextPerPage(buffer.slice(0));

            // 2. Parse order codes
            const pageResults: PageResult[] = pageTexts.map((text, i) => {
                const parsed = parseOrderCode(text);
                return {
                    page: i + 1,
                    orderNumber: parsed?.orderNumber ?? null,
                    code: parsed?.code ?? null,
                };
            });
            setResults(pageResults);

            const missing = pageResults.filter(r => !r.code);
            if (missing.length === pageResults.length) {
                setError('No order numbers (PBxxxxS) found in any page.');
                setProcessing(false);
                return;
            }

            // 3. Stamp codes onto PDF with pdf-lib
            const pdfDoc = await PDFDocument.load(buffer);
            const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
            const pages = pdfDoc.getPages();

            for (let i = 0; i < pages.length; i++) {
                const code = pageResults[i]?.code;
                if (!code) continue;

                const page = pages[i];
                const { width, height } = page.getSize();
                const fontSize = 18;
                const textWidth = font.widthOfTextAtSize(code, fontSize);

                page.drawText(code, {
                    x: (width - textWidth) / 2,
                    y: height * 0.22,
                    size: fontSize,
                    font,
                    color: rgb(0, 0, 0),
                });
            }

            // 4. Download
            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'final_' + file.name.replace(/\.pdf$/i, '') + '.pdf';
            a.click();
            URL.revokeObjectURL(url);

        } catch (err: any) {
            setError(err?.message || 'Failed to process PDF');
        } finally {
            setProcessing(false);
        }
    };

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = '';
    };

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file?.type === 'application/pdf') handleFile(file);
    };

    const successCount = results.filter(r => r.code).length;
    const failCount    = results.filter(r => !r.code).length;

    return (
        <div style={{ padding: '2rem', maxWidth: '680px' }}>
            <div style={{ marginBottom: '1.75rem' }}>
                <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.375rem', fontWeight: 700, color: '#0f172a' }}>Labels</h1>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                    Upload a shipping labels PDF — the last 3 digits of each order number will be stamped at the bottom of every label.
                </p>
            </div>

            {/* Drop zone */}
            <div
                onClick={() => inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
                style={{
                    border: '2px dashed #e2e8f0',
                    borderRadius: '12px',
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    cursor: processing ? 'default' : 'pointer',
                    background: '#f8fafc',
                    transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => !processing && (e.currentTarget.style.borderColor = '#94a3b8')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            >
                <input ref={inputRef} type="file" accept=".pdf" onChange={onFileChange} style={{ display: 'none' }} />

                {processing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: '#64748b', fontSize: '0.875rem' }}>
                        <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Processing {fileName}…
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📄</div>
                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem', marginBottom: '0.25rem' }}>
                            {fileName ? `Re-upload to reprocess` : 'Click or drag a PDF here'}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Shipping labels with PBxxxxS order numbers</div>
                    </>
                )}
            </div>

            {/* Spinner keyframe */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {error && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '0.875rem' }}>
                    {error}
                </div>
            )}

            {results.length > 0 && !processing && (
                <div style={{ marginTop: '1.5rem' }}>
                    {/* Summary */}
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                        <div style={{ flex: 1, padding: '0.875rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#15803d' }}>{successCount}</div>
                            <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 500 }}>Labelled</div>
                        </div>
                        {failCount > 0 && (
                            <div style={{ flex: 1, padding: '0.875rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#dc2626' }}>{failCount}</div>
                                <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 500 }}>No order found</div>
                            </div>
                        )}
                    </div>

                    {/* Per-page table */}
                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                    <th style={{ padding: '0.625rem 1rem', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Page</th>
                                    <th style={{ padding: '0.625rem 1rem', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Order Number</th>
                                    <th style={{ padding: '0.625rem 1rem', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>Code Stamped</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map(r => (
                                    <tr key={r.page} style={{ borderBottom: '1px solid #f8fafc' }}>
                                        <td style={{ padding: '0.625rem 1rem', color: '#94a3b8', fontWeight: 600 }}>{r.page}</td>
                                        <td style={{ padding: '0.625rem 1rem', color: '#1e293b', fontWeight: 500 }}>{r.orderNumber ?? '—'}</td>
                                        <td style={{ padding: '0.625rem 1rem', textAlign: 'center' }}>
                                            {r.code
                                                ? <span style={{ display: 'inline-block', padding: '0.2rem 0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: 800, color: '#15803d', fontSize: '0.9375rem', letterSpacing: '0.05em' }}>{r.code}</span>
                                                : <span style={{ color: '#ef4444', fontWeight: 500 }}>Not found</span>
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
