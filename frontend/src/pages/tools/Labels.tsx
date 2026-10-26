import { useState } from 'react';
import toast from 'react-hot-toast';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { Alert, Card, DataTable, Dropzone, StatCard, StatStrip, type Column } from '../../components/ui/pbx';
import { ShippingDays } from './ShippingDays';
import styles from './Labels.module.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
).href;

interface Rect { x: number; y: number; w: number; h: number; }
interface Box { x0: number; x1: number; y0: number; y1: number; }
interface LabelResult { orderNumber: string | null; }
interface ProcessResult { pageCount: number; labelCount: number; skipped: number; fileName: string; labels: LabelResult[]; }
interface LabelRow extends LabelResult { index: number; }

/** A box with less dark ink than this inside its edges is an empty label frame, which an odd label count leaves. */
const BLANK_INK = 0.01;

function isDark(r: number, g: number, b: number): boolean {
    return (r + g + b) / 3 < 140;
}

function parseOrderNumbers(text: string): string[] {
    return text.match(/PB\d+S/g) ?? [];
}

async function detectLabelRects(jsPage: any, pageH: number): Promise<{ rects: Rect[]; skipped: number }> {
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

    if (left >= right || top >= bottom) return { rects: [], skipped: 0 };

    // Look for a vertical centre divider in the middle 40% of the content band
    const bandStart = Math.round(left + (right - left) * 0.3);
    const bandEnd   = Math.round(left + (right - left) * 0.7);
    let maxDensity = 0, centerX = Math.round((left + right) / 2);
    for (let x = bandStart; x <= bandEnd; x++) {
        if (colDark[x] > maxDensity) { maxDensity = colDark[x]; centerX = x; }
    }

    // A real divider line spans most of the content height → density > 25%
    const boxes: Box[] = maxDensity > 0.25
        ? [{ x0: left, x1: centerX - 1, y0: top, y1: bottom }, { x0: centerX + 1, x1: right, y0: top, y1: bottom }]
        : [{ x0: left, x1: right, y0: top, y1: bottom }];

    // Share of dark pixels inside a box, 6 px in from its edges so a bare frame counts as empty.
    const ink = (b: Box) => {
        let dark = 0, all = 0;
        for (let y = b.y0 + 6; y <= b.y1 - 6; y++) {
            for (let x = b.x0 + 6; x <= b.x1 - 6; x++) {
                const i = (y * width + x) * 4;
                all++;
                if (isDark(data[i], data[i + 1], data[i + 2])) dark++;
            }
        }
        return all ? dark / all : 0;
    };
    const kept = boxes.filter((b) => ink(b) >= BLANK_INK);
    const rects = kept.map((b) => ({
        x: b.x0 / scale,
        y: pageH - (b.y1 + 1) / scale,
        w: (b.x1 - b.x0 + 1) / scale,
        h: (b.y1 - b.y0 + 1) / scale,
    }));
    return { rects, skipped: boxes.length - kept.length };
}

async function cropLabels(buffer: ArrayBuffer): Promise<{ blob: Blob; pageCount: number; labelCount: number; skipped: number; labels: LabelResult[] }> {
    const jsDoc  = await pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
    const libDoc = await PDFDocument.load(buffer);
    const outDoc = await PDFDocument.create();

    const pageCount = libDoc.getPageCount();
    let labelCount  = 0;
    let skipped     = 0;
    const labels: LabelResult[] = [];

    for (let i = 0; i < pageCount; i++) {
        const jsPage  = await jsDoc.getPage(i + 1);
        const libPage = libDoc.getPage(i);
        const { height: pageH } = libPage.getSize();

        const found       = await detectLabelRects(jsPage, pageH);
        const textContent = await jsPage.getTextContent();
        const orders      = parseOrderNumbers(textContent.items.map((item: any) => item.str).join(' '));
        const [embedded]  = await outDoc.embedPages([libPage]);
        skipped += found.skipped;

        found.rects.forEach((rect, j) => {
            const outPage = outDoc.addPage([rect.w, rect.h]);
            outPage.drawPage(embedded, { x: -rect.x, y: -rect.y });
            labels.push({ orderNumber: orders[j] ?? null });
            labelCount++;
        });
    }

    const outBytes = await outDoc.save();
    return { blob: new Blob([outBytes.buffer as ArrayBuffer], { type: 'application/pdf' }), pageCount, labelCount, skipped, labels };
}

const COLUMNS: Column<LabelRow>[] = [
    { key: 'index', header: '#', numeric: true, width: 40, render: (l) => l.index + 1 },
    { key: 'orderNumber', header: 'Order', mono: true, render: (l) => l.orderNumber ?? '—' },
];

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * Labels: the booking job's daily label and manifest files, and a cropper for any Shiprocket labels PDF that cuts
 * each label to its border, one label a page.
 */
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
            const { blob, pageCount, labelCount, skipped, labels } = await cropLabels(buffer);
            const url = URL.createObjectURL(blob);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = 'cropped_' + file.name.replace(/\.pdf$/i, '') + '.pdf';
            a.click();
            URL.revokeObjectURL(url);
            setResult({ pageCount, labelCount, skipped, fileName: file.name, labels });
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

    return (
        <div className={styles.labels}>
            <ShippingDays />

            <Card
                title="Crop a labels PDF"
                description="Each label in a Shiprocket labels PDF is cropped to its border, one label a page, and an empty frame left by an odd label count is dropped. The cropped PDF downloads as soon as it is ready; nothing is uploaded."
            >
                <Dropzone
                    onFiles={onFiles}
                    accept=".pdf,application/pdf"
                    multiple={false}
                    icon="printer"
                    disabled={processing}
                    title={processing ? 'Cropping labels…' : result ? 'Drop another labels PDF' : 'Drop a shipping labels PDF'}
                    hint="One PDF of shipping labels"
                    buttonLabel={processing ? 'Working…' : 'Choose PDF'}
                />
            </Card>

            {error && (
                <Alert tone="negative" title="The PDF could not be processed">
                    {error}
                </Alert>
            )}

            {result && !processing && (
                <>
                    <StatStrip label={`Labels from ${result.fileName}`} minWidth={140}>
                        <StatCard label="Pages" value={result.pageCount.toLocaleString('en-IN')} />
                        <StatCard label="Labels cropped" value={result.labelCount.toLocaleString('en-IN')} tone="positive" />
                        <StatCard label="Empty frames dropped" value={result.skipped.toLocaleString('en-IN')} />
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
