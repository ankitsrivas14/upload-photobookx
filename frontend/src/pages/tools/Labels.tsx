import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).href;

interface Rect { x: number; y: number; w: number; h: number; }
interface LabelResult { orderNumber: string | null; code: string | null; }
interface ProcessResult { pageCount: number; labelCount: number; fileName: string; labels: LabelResult[]; }

function isDark(r: number, g: number, b: number): boolean {
    return (r + g + b) / 3 < 140;
}

function parseOrderCodes(text: string): Array<{ orderNumber: string; code: string }> {
    const results: Array<{ orderNumber: string; code: string }> = [];
    const re = /PB(\d+)S/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        results.push({ orderNumber: m[0], code: m[1].slice(-3).padStart(3, '0') });
    }
    return results;
}

async function detectLabelRects(jsPage: any, pageH: number): Promise<Rect[]> {
    const scale = 1.5;
    const vp    = jsPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width  = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d')!;
    await jsPage.render({ canvasContext: ctx, viewport: vp }).promise;

    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const colDark = new Float32Array(width);
    const rowDark = new Float32Array(height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (isDark(data[i], data[i + 1], data[i + 2])) { colDark[x]++; rowDark[y]++; }
        }
    }
    for (let x = 0; x < width; x++) colDark[x] /= height;
    for (let y = 0; y < height; y++) rowDark[y] /= width;

    const COL_MIN = 3 / height;
    const ROW_MIN = 3 / width;

    let left = 0;        while (left < width    && colDark[left]   < COL_MIN) left++;
    let right = width-1; while (right > left    && colDark[right]  < COL_MIN) right--;
    let top   = 0;        while (top  < height   && rowDark[top]    < ROW_MIN) top++;
    let bottom = height-1; while (bottom > top   && rowDark[bottom] < ROW_MIN) bottom--;

    if (left >= right || top >= bottom) return [];

    const toPdfY = (cy: number) => pageH - cy / scale;

    // Look for a vertical centre divider in the middle 40% of the content band
    const bandStart = Math.round(left + (right - left) * 0.3);
    const bandEnd   = Math.round(left + (right - left) * 0.7);
    let maxDensity = 0, centerX = Math.round((left + right) / 2);
    for (let x = bandStart; x <= bandEnd; x++) {
        if (colDark[x] > maxDensity) { maxDensity = colDark[x]; centerX = x; }
    }

    // A real divider line spans most of the content height → density > 25%
    if (maxDensity > 0.25) {
        return [
            { x: left / scale,          y: toPdfY(bottom + 1), w: (centerX - left) / scale,  h: (bottom - top + 1) / scale },
            { x: (centerX + 1) / scale, y: toPdfY(bottom + 1), w: (right - centerX) / scale, h: (bottom - top + 1) / scale },
        ];
    }

    return [{ x: left / scale, y: toPdfY(bottom + 1), w: (right - left + 1) / scale, h: (bottom - top + 1) / scale }];
}

async function cropLabels(buffer: ArrayBuffer): Promise<{ blob: Blob; pageCount: number; labelCount: number; labels: LabelResult[] }> {
    const jsDoc  = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const libDoc = await PDFDocument.load(buffer);
    const outDoc = await PDFDocument.create();
    const font   = await outDoc.embedFont(StandardFonts.HelveticaBold);

    const pageCount = libDoc.getPageCount();
    let labelCount  = 0;
    const labels: LabelResult[] = [];

    for (let i = 0; i < pageCount; i++) {
        const jsPage  = await jsDoc.getPage(i + 1);
        const libPage = libDoc.getPage(i);
        const { height: pageH } = libPage.getSize();

        const rects       = await detectLabelRects(jsPage, pageH);
        const textContent = await jsPage.getTextContent();
        const pageText    = textContent.items.map((item: any) => item.str).join(' ');
        const codes       = parseOrderCodes(pageText);
        const [embedded]  = await outDoc.embedPages([libPage]);

        for (let j = 0; j < rects.length; j++) {
            const rect    = rects[j];
            const info    = codes[j] ?? null;
            const outPage = outDoc.addPage([rect.w, rect.h]);

            outPage.drawPage(embedded, { x: -rect.x, y: -rect.y });

            if (info) {
                const fontSize  = 20;
                const textWidth = font.widthOfTextAtSize(info.code, fontSize);
                outPage.drawText(info.code, {
                    x: (rect.w - textWidth) / 2,
                    y: rect.h * 0.12 + 50,
                    size: fontSize,
                    font,
                    color: rgb(0, 0, 0),
                });
            }

            labels.push({ orderNumber: info?.orderNumber ?? null, code: info?.code ?? null });
            labelCount++;
        }
    }

    const outBytes = await outDoc.save();
    return { blob: new Blob([outBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), pageCount, labelCount, labels };
}

export function Labels() {
    const [processing, setProcessing] = useState(false);
    const [result, setResult]         = useState<ProcessResult | null>(null);
    const [error, setError]           = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (file: File) => {
        setError(null);
        setResult(null);
        setProcessing(true);
        try {
            const buffer = await file.arrayBuffer();
            const { blob, pageCount, labelCount, labels } = await cropLabels(buffer);
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = 'cropped_' + file.name.replace(/\.pdf$/i, '') + '.pdf';
            a.click();
            URL.revokeObjectURL(url);
            setResult({ pageCount, labelCount, fileName: file.name, labels });
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

    const stamped   = result?.labels.filter(l => l.code).length  ?? 0;
    const unstamped = result?.labels.filter(l => !l.code).length ?? 0;

    return (
        <div style={{ padding: '2rem', maxWidth: '680px' }}>
            <div style={{ marginBottom: '1.75rem' }}>
                <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.375rem', fontWeight: 700, color: '#0f172a' }}>Labels</h1>
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                    Upload a shipping labels PDF — each label is cropped to its border and stamped with the last 3 digits of its order number.
                </p>
            </div>

            <div
                onClick={() => !processing && inputRef.current?.click()}
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
                style={{
                    border: '2px dashed #e2e8f0', borderRadius: '12px', padding: '3rem 2rem',
                    textAlign: 'center', cursor: processing ? 'default' : 'pointer',
                    background: '#f8fafc', transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => !processing && (e.currentTarget.style.borderColor = '#94a3b8')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            >
                <input ref={inputRef} type="file" accept=".pdf" onChange={onFileChange} style={{ display: 'none' }} />
                {processing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', color: '#64748b', fontSize: '0.875rem' }}>
                        <div style={{ width: 36, height: 36, border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                        Cropping and stamping labels…
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📄</div>
                        <div style={{ fontWeight: 600, color: '#1e293b', fontSize: '0.9375rem', marginBottom: '0.25rem' }}>
                            {result ? 'Upload another PDF' : 'Click or drag a PDF here'}
                        </div>
                        <div style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>Shipping labels PDF</div>
                    </>
                )}
            </div>

            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {error && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#dc2626', fontSize: '0.875rem' }}>
                    {error}
                </div>
            )}

            {result && !processing && (
                <div style={{ marginTop: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center' }}>
                        <div style={{ flex: 1, padding: '0.875rem 1rem', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0369a1' }}>{result.pageCount}</div>
                            <div style={{ fontSize: '0.75rem', color: '#0284c7', fontWeight: 500 }}>Pages</div>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '1.25rem' }}>→</div>
                        <div style={{ flex: 1, padding: '0.875rem 1rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#15803d' }}>{stamped}</div>
                            <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 500 }}>Stamped</div>
                        </div>
                        {unstamped > 0 && (
                            <>
                                <div style={{ color: '#94a3b8', fontSize: '1.25rem' }}>+</div>
                                <div style={{ flex: 1, padding: '0.875rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#dc2626' }}>{unstamped}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#ef4444', fontWeight: 500 }}>No order</div>
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                            <thead>
                                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                                    <th style={{ padding: '0.625rem 1rem', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>#</th>
                                    <th style={{ padding: '0.625rem 1rem', textAlign: 'left', color: '#64748b', fontWeight: 600 }}>Order</th>
                                    <th style={{ padding: '0.625rem 1rem', textAlign: 'center', color: '#64748b', fontWeight: 600 }}>Stamped</th>
                                </tr>
                            </thead>
                            <tbody>
                                {result.labels.map((l, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid #f8fafc' }}>
                                        <td style={{ padding: '0.625rem 1rem', color: '#94a3b8', fontWeight: 600 }}>{idx + 1}</td>
                                        <td style={{ padding: '0.625rem 1rem', color: '#1e293b', fontWeight: 500 }}>{l.orderNumber ?? '—'}</td>
                                        <td style={{ padding: '0.625rem 1rem', textAlign: 'center' }}>
                                            {l.code
                                                ? <span style={{ display: 'inline-block', padding: '0.2rem 0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', fontWeight: 800, color: '#15803d', fontSize: '0.9375rem', letterSpacing: '0.05em' }}>{l.code}</span>
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
