import { useState } from 'react';
import toast from 'react-hot-toast';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, grayscale } from 'pdf-lib';
import { Alert, Card, DataTable, Dropzone, StatCard, StatStrip, type Column } from '../../components/ui/pbx';
import styles from './Labels.module.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).href;

interface Rect { x: number; y: number; w: number; h: number; }
interface LabelResult { orderNumber: string | null; code: string | null; }
interface ProcessResult { pageCount: number; labelCount: number; fileName: string; labels: LabelResult[]; }
interface LabelRow extends LabelResult { index: number; }

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
                // Printed in black ink on the label itself, not a screen colour.
                outPage.drawText(info.code, {
                    x: (rect.w - textWidth) / 2,
                    y: rect.h * 0.12 + 50,
                    size: fontSize,
                    font,
                    color: grayscale(0),
                });
            }

            labels.push({ orderNumber: info?.orderNumber ?? null, code: info?.code ?? null });
            labelCount++;
        }
    }

    const outBytes = await outDoc.save();
    return { blob: new Blob([outBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), pageCount, labelCount, labels };
}

const COLUMNS: Column<LabelRow>[] = [
    { key: 'index', header: '#', numeric: true, width: 40, render: (l) => l.index + 1 },
    { key: 'orderNumber', header: 'Order', mono: true, render: (l) => l.orderNumber ?? '—' },
    {
        key: 'code',
        header: 'Stamp',
        render: (l) => (l.code ? <span className={styles.code}>{l.code}</span> : <span className={styles.missing}>No order number found</span>),
    },
];

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/** Labels: crops each shipping label in a PDF to its border and stamps the last 3 digits of its order number. */
export function Labels() {
    const [processing, setProcessing] = useState(false);
    const [result, setResult]         = useState<ProcessResult | null>(null);
    const [error, setError]           = useState<string | null>(null);

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

    const onFiles = (files: File[]) => {
        const file = files[0];
        if (!file) return;
        if (!isPdf(file)) {
            toast.error('Choose a PDF file');
            return;
        }
        handleFile(file);
    };

    const stamped   = result?.labels.filter(l => l.code).length  ?? 0;
    const unstamped = result?.labels.filter(l => !l.code).length ?? 0;

    return (
        <div className={styles.labels}>
            <p className={styles.note}>
                Each label in the PDF is cropped to its border and stamped with the last 3 digits of its order number. The cropped
                PDF downloads as soon as it is ready; nothing is uploaded.
            </p>

            <Dropzone
                onFiles={onFiles}
                accept=".pdf,application/pdf"
                multiple={false}
                icon="printer"
                disabled={processing}
                title={processing ? 'Cropping and stamping labels…' : result ? 'Drop another labels PDF' : 'Drop a shipping labels PDF'}
                hint="One PDF of shipping labels"
                buttonLabel={processing ? 'Working…' : 'Choose PDF'}
            />

            {error && (
                <Alert tone="negative" title="The PDF could not be processed">
                    {error}
                </Alert>
            )}

            {result && !processing && (
                <>
                    <StatStrip label={`Labels from ${result.fileName}`} minWidth={140}>
                        <StatCard label="Pages" value={result.pageCount.toLocaleString('en-IN')} />
                        <StatCard label="Labels stamped" value={stamped.toLocaleString('en-IN')} tone="positive" />
                        <StatCard
                            label="No order number"
                            value={unstamped.toLocaleString('en-IN')}
                            tone={unstamped > 0 ? 'negative' : 'neutral'}
                            sub={unstamped > 0 ? 'cropped but not stamped' : undefined}
                        />
                    </StatStrip>

                    <Card title="Labels" eyebrow={result.fileName} padding="none">
                        <DataTable
                            columns={COLUMNS}
                            rows={result.labels.map((label, index) => ({ ...label, index }))}
                            getRowId={(l) => String(l.index)}
                            caption={`Labels cropped from ${result.fileName}`}
                        />
                    </Card>
                </>
            )}
        </div>
    );
}
