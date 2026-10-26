import { Timestamp } from 'firebase-admin/firestore';
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { getFirestore } from '../db/firestore';

/**
 * The day files behind Tools › Labels. The booking job (~/Documents/Coding/photobookx-shipping on the admin's Mac, run
 * every 2 hours by a Claude Code task) books Shiprocket orders and files one cropped label per AWB, plus each Shiprocket
 * manifest with its layout, into the open day; its lib/store.mjs describes the records. Here the admin lists the days,
 * turns the job on or off, and on a day's first download closes it and assembles its two PDFs: every label in booking
 * order, and per courier one manifest header, every row of the day, and one footer.
 */

interface Band { page: number; y0: number; y1: number }
interface TextBox { x: number; y: number; w: number; size: number; str: string }
interface ManifestRow extends Band { awb: string; order: string | null; sno: { x: number; y: number; w: number; size: number } }
interface ManifestLayout {
  manifestId: string | null;
  courierName: string | null;
  pageWidth: number;
  pageHeight: number;
  header: Band;
  colHeader: Band;
  footer: Band;
  idText: TextBox | null;
  totalText: TextBox | null;
  snoColumn: { x0: number; x1: number };
  rows: ManifestRow[];
}
interface RowDoc {
  awb: string;
  dayId: string;
  seq: number;
  order: string;
  courierId: number | string;
  courierName: string;
  labelFileId: string;
  manifestFileId: string;
  manifestRow: number;
}

export type DayFile = 'labels' | 'manifest';

export interface ShippingDay {
  id: string;
  openedAt: string | null;
  closedAt: string | null;
  closedBy: DayFile | null;
  open: boolean;
  labels: number;
  couriers: Array<{ name: string; count: number }>;
}

export interface ShippingRun {
  at: string;
  booked: number;
  cost: number;
  byCourier: Record<string, number>;
  aside: Array<{ order: string; reason: string }>;
  waiting: Array<{ order: string; rate: number }>;
  failed: Array<{ order: string; reason: string }>;
  wallet: number;
  recharge: number;
  notes: string[];
}

export interface SetAsideOrder {
  order: string;
  reason: string;
  amount: number | null;
  since: string | null;
}

const iso = (t?: Timestamp | null) => (t ? t.toDate().toISOString() : null);

/** The job's switch and last run, the latest 60 days, and the COD orders waiting with a weak address. */
export async function getShippingOverview() {
  const db = getFirestore();
  const [auto, days, aside] = await Promise.all([
    db.doc('meta/shippingAuto').get(),
    db.collection('shippingDays').orderBy('openedAt', 'desc').limit(60).get(),
    db.collection('shippingBookings').where('status', '==', 'aside').get(),
  ]);
  const a = auto.data() ?? {};
  return {
    auto: {
      enabled: a.enabled !== false,
      lastRunAt: iso(a.lastRunAt),
      lastRun: (a.lastRun as ShippingRun | undefined) ?? null,
    },
    days: days.docs.map((d): ShippingDay => {
      const v = d.data();
      return {
        id: d.id,
        openedAt: iso(v.openedAt),
        closedAt: iso(v.closedAt),
        closedBy: v.closedBy ?? null,
        open: v.status === 'open',
        labels: v.rowCount ?? 0,
        couriers: Object.values((v.couriers ?? {}) as Record<string, { name: string; count: number }>)
          .sort((x, y) => y.count - x.count),
      };
    }),
    aside: aside.docs
      .map((d): SetAsideOrder => {
        const v = d.data();
        return { order: v.order ?? d.id, reason: v.reason ?? '', amount: v.amount ?? null, since: iso(v.updatedAt) };
      })
      .sort((x, y) => (y.since ?? '').localeCompare(x.since ?? '')),
  };
}

export async function setAutoBooking(enabled: boolean) {
  await getFirestore().doc('meta/shippingAuto').set({ enabled }, { merge: true });
}

/**
 * Closes the day if it is still open, so bookings after this go into a new day. In a transaction with the job's
 * filing (which opens a new day once the pointer is cleared), a booking lands wholly in one day or the next.
 */
async function closeIfOpen(dayId: string, by: DayFile) {
  const db = getFirestore();
  return db.runTransaction(async (tx) => {
    const dayRef = db.doc(`shippingDays/${dayId}`);
    const pointerRef = db.doc('meta/shippingDay');
    const [day, pointer] = await Promise.all([tx.get(dayRef), tx.get(pointerRef)]);
    if (!day.exists) return null;
    const v = day.data()!;
    if (v.status !== 'open') return v;
    const closedAt = Timestamp.now();
    tx.update(dayRef, { status: 'closed', closedAt, closedBy: by });
    tx.set(
      pointerRef,
      pointer.data()?.openDayId === dayId ? { openDayId: null, lastClosedAt: closedAt } : { lastClosedAt: closedAt },
      { merge: true }
    );
    return { ...v, status: 'closed', closedAt, closedBy: by };
  });
}

async function loadFiles(ids: string[]) {
  const db = getFirestore();
  const snaps = ids.length ? await db.getAll(...ids.map((id) => db.doc(`shippingFiles/${id}`))) : [];
  const files = new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data()!]));
  const missing = ids.filter((id) => !files.has(id));
  if (missing.length) throw new Error(`Missing files: ${missing.join(', ')}`);
  return files;
}

async function buildLabels(rows: RowDoc[]) {
  const files = await loadFiles(rows.map((r) => r.labelFileId));
  const out = await PDFDocument.create();
  for (const r of rows) {
    const src = await PDFDocument.load(files.get(r.labelFileId)!.pdf);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return out.save();
}

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(1, 1, 1);
const BOTTOM_MARGIN = 40;

function cover(page: PDFPage, x: number, y: number, width: number, height: number) {
  page.drawRectangle({ x, y, width, height, color: WHITE });
}

// The header keeps the first manifest's look; its count and manifest IDs are rewritten for the whole day.
function rewriteHeader(page: PDFPage, font: PDFFont, layout: ManifestLayout, total: number, manifestIds: string[]) {
  const t = layout.totalText;
  if (t) {
    cover(page, t.x - 1, t.y - t.size * 0.3, t.w + 2, t.size * 1.25);
    const text = `Total shipments to dispatch :${total}`;
    page.drawText(text, { x: t.x + t.w - font.widthOfTextAtSize(text, t.size), y: t.y, size: t.size, font, color: BLACK });
  }
  // Shiprocket's reprints have no ID line; then the IDs go where it would be, one line above the count.
  const anchor = layout.idText ?? (t ? { ...t, y: t.y + 11 } : null);
  if (!anchor) return;
  if (layout.idText) cover(page, anchor.x - 1, anchor.y - anchor.size * 0.3, anchor.w + 2, anchor.size * 1.25);
  const label = manifestIds.length > 1
    ? `Manifest IDs : ${manifestIds.map((id) => id.replace(/^MANIFEST-/, '')).join(', ')}`
    : `Manifest ID : ${manifestIds[0]}`;
  const right = anchor.x + anchor.w;
  let size = anchor.size;
  while (size > 6 && font.widthOfTextAtSize(label, size) > right - 300) size -= 0.5;
  page.drawText(label, { x: right - font.widthOfTextAtSize(label, size), y: anchor.y, size, font, color: BLACK });
}

// Rows keep their manifest's serial number until renumbered here, 1 to n down the courier's list.
function renumber(page: PDFPage, font: PDFFont, layout: ManifestLayout, row: ManifestRow, bottom: number, n: number) {
  const { x0, x1 } = layout.snoColumn;
  cover(page, x0 + 1, bottom + 1, x1 - x0 - 2, row.y1 - row.y0 - 2);
  const text = String(n);
  const centre = row.sno.x + row.sno.w / 2;
  page.drawText(text, {
    x: centre - font.widthOfTextAtSize(text, row.sno.size) / 2,
    y: bottom + (row.sno.y - row.y0),
    size: row.sno.size,
    font,
    color: BLACK,
  });
}

async function buildManifest(rows: RowDoc[]) {
  const files = await loadFiles([...new Set(rows.map((r) => r.manifestFileId))]);
  const sources = new Map<string, PDFDocument>();
  for (const [id, f] of files) sources.set(id, await PDFDocument.load(f.pdf));
  const layoutOf = (id: string) => files.get(id)!.layout as ManifestLayout;

  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const byCourier = new Map<string, RowDoc[]>();
  for (const r of rows) byCourier.set(String(r.courierId), [...(byCourier.get(String(r.courierId)) ?? []), r]);

  for (const list of byCourier.values()) {
    const ids = [...new Set(list.map((r) => r.manifestFileId))];
    const first = layoutOf(ids[0]);
    const last = layoutOf(ids[ids.length - 1]);
    const width = first.pageWidth;
    const height = first.pageHeight;
    const pages: PDFPage[] = [];
    let page = out.addPage([width, height]);
    pages.push(page);
    let cursor = height;
    // Draws a band of a source page below the last one; returns the y of its bottom edge.
    const place = async (fileId: string, band: Band) => {
      const [strip] = await out.embedPages(
        [sources.get(fileId)!.getPage(band.page)],
        [{ left: 0, bottom: band.y0, right: width, top: band.y1 }]
      );
      cursor -= band.y1 - band.y0;
      page.drawPage(strip, { x: 0, y: cursor });
      return cursor;
    };
    const nextPage = () => {
      page = out.addPage([width, height]);
      pages.push(page);
      cursor = height - 36;
    };

    await place(ids[0], first.header);
    rewriteHeader(page, font, first, list.length, ids.map((id) => files.get(id)!.manifestId as string));
    let n = 0;
    for (const r of list) {
      const layout = layoutOf(r.manifestFileId);
      const row = layout.rows[r.manifestRow];
      if (cursor - (row.y1 - row.y0) < BOTTOM_MARGIN) {
        nextPage();
        await place(ids[0], first.colHeader);
      }
      renumber(page, font, layout, row, await place(r.manifestFileId, row), ++n);
    }
    if (cursor - (last.footer.y1 - last.footer.y0) < BOTTOM_MARGIN) nextPage();
    await place(ids[ids.length - 1], last.footer);

    pages.forEach((p, i) => {
      const text = `page ${i + 1} of ${pages.length}`;
      p.drawText(text, { x: (width - font.widthOfTextAtSize(text, 10)) / 2, y: 26, size: 10, font, color: BLACK });
    });
  }
  return out.save();
}

// The day's opening time in India, for file names: 2026-10-27-0136.
function dayStamp(openedAt?: Timestamp) {
  const t = new Date((openedAt?.toMillis() ?? Date.now()) + 5.5 * 3600e3).toISOString();
  return `${t.slice(0, 10)}-${t.slice(11, 13)}${t.slice(14, 16)}`;
}

/**
 * The day's labels or manifest as a PDF. Downloading either closes the day first (user, 2026-10-27: "When we
 * download any of them day ends, and we start to build a new file for afterward orders"). Null for an unknown or
 * empty day.
 */
export async function dayPdf(dayId: string, kind: DayFile) {
  const day = await closeIfOpen(dayId, kind);
  if (!day) return null;
  const snap = await getFirestore().collection('shippingRows').where('dayId', '==', dayId).get();
  const rows = snap.docs.map((d) => d.data() as RowDoc).sort((a, b) => a.seq - b.seq);
  if (!rows.length) return null;
  const bytes = kind === 'labels' ? await buildLabels(rows) : await buildManifest(rows);
  return { bytes, filename: `${kind}-${dayStamp(day.openedAt)}.pdf` };
}

/** Builds a day's PDF without closing it: for checking the layout locally. */
export async function previewDayPdf(dayId: string, kind: DayFile) {
  const snap = await getFirestore().collection('shippingRows').where('dayId', '==', dayId).get();
  const rows = snap.docs.map((d) => d.data() as RowDoc).sort((a, b) => a.seq - b.seq);
  return kind === 'labels' ? buildLabels(rows) : buildManifest(rows);
}
