import { Timestamp } from 'firebase-admin/firestore';
import { getFirestore } from '../db/firestore';
import shiprocketService from './shiprocketService';

/**
 * Failure reasons (Analysis › Failure reasons): every Shiprocket order that came back to us or was lost, with why,
 * month by month. The nightly failureReasonsSync re-reads the last three months, because returns keep landing for
 * weeks after a month ends; older months stay as stored. scripts/refreshFailureReasons.ts backfills from any month.
 *
 *   failureReasons/{order number}  { order, month, shiprocketId, placedAt, payment, value, courier, awb, status,
 *                                    group, reason, code, attempts, tracked, refreshedAt }
 *   meta/failureReasons            { refreshedAt, months: { 'YYYY-MM': { orders, delivered, cancelled, refreshedAt } } }
 *
 * "Failed" means RTO delivered, lost, destroyed or disposed of. The reason is Shiprocket's NDR reason from tracking
 * (`tracking_data.ndr`: the last failed delivery attempt before the return), else the courier's last undelivered
 * scan, and the group comes from Shiprocket's NDR code.
 */

const COLLECTION = 'failureReasons';
const META = 'meta/failureReasons';

/** Shiprocket order status codes, for GET /orders?filter_by=status&filter=… */
const DELIVERED = 7;
const CANCELLED = 5;
const FAILED: Record<string, string> = { 16: 'RTO DELIVERED', 33: 'LOST', 39: 'DESTROYED', 53: 'DISPOSED OFF' };
const COURIER_LOSS: Record<string, string> = {
  LOST: 'Lost by the courier',
  DESTROYED: 'Destroyed by the courier',
  'DISPOSED OFF': 'Disposed of by the courier',
};

/** Reason groups in display order, by Shiprocket's NDR code (`undelivered_reason_code`). */
const REASON_GROUPS: { group: string; codes: string[] }[] = [
  { group: 'Refused or cancelled at the door', codes: ['SRNDR18', 'SRNDR6', 'SRNDR14'] },
  { group: 'Not available or not reachable', codes: ['SRNDR1', 'SRNDR16', 'SRNDR8'] },
  { group: 'Address or pincode problem', codes: ['SRNDR2', 'SRNDR11', 'SRNDR10'] },
  { group: 'Wanted a later delivery', codes: ['SRNDR4'] },
  { group: 'COD cash not ready', codes: ['SRNDR3'] },
  { group: 'Courier side', codes: ['SRNDR20'] },
  { group: 'Other', codes: [] },
];
export const GROUP_NAMES = REASON_GROUPS.map((g) => g.group);
const COURIER_SIDE = 'Courier side';
const NO_ATTEMPT = 'Returned without a delivery attempt';

/** Tracking scans that mean the return has started (Shiprocket `sr-status`). */
const RETURN_SCANS = new Set(['9', '10', '14', '40', '41', '46', '75', '78']);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRACKING_WORKERS = 4;

interface Reason {
  reason: string | null;
  code: string | null;
  attempts: number | null;
  tracked: boolean;
}

export interface FailureMonth {
  month: string;
  orders: number;
  delivered: number;
  cancelled: number;
  failed: number;
  /** Orders neither delivered, failed nor cancelled yet: in transit, or not shipped. */
  open: number;
  /** Returns may still come in: the month is current, or over a tenth of its orders are still open. */
  settling: boolean;
  cod: number;
  prepaid: number;
  value: number;
  groups: Record<string, number>;
}

const pad = (n: number | string) => String(n).padStart(2, '0');

/** The current month in India, YYYY-MM. */
function istMonth(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 7);
}

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function monthsFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

/** Shiprocket's "28 Oct 2026, 03:35 PM" (India time) as a Date. */
function parsePlaced(created: unknown): Date | null {
  const m = /^(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2}) (AM|PM)$/.exec(String(created ?? '').trim());
  const month = m ? MONTH_NAMES.indexOf(m[2]) + 1 : 0;
  if (!m || !month) return null;
  const hour = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0);
  return new Date(`${m[3]}-${pad(month)}-${pad(m[1])}T${pad(hour)}:${m[5]}:00+05:30`);
}

/** Courier wording, with long digit runs (phone numbers) masked. */
function tidy(text: unknown): string {
  return String(text ?? '').replace(/\d{6,}/g, '#').replace(/\s+/g, ' ').replace(/^Pending - /, '').trim();
}

function groupOf(status: string, r: Reason): string {
  if (status !== 'RTO DELIVERED' || r.reason === NO_ATTEMPT) return COURIER_SIDE;
  return REASON_GROUPS.find((g) => r.code && g.codes.includes(r.code))?.group ?? 'Other';
}

/** Why a returned order failed, from its tracking. Null tracking means it couldn't be read this time. */
function reasonFromTracking(tracking: any): Reason {
  if (!tracking) return { reason: null, code: null, attempts: null, tracked: false };
  const ndr = tracking.ndr;
  if (ndr?.reason) {
    const attempts = Number(ndr.attempts);
    return { reason: tidy(ndr.reason), code: ndr.undelivered_reason_code || null, attempts: Number.isFinite(attempts) ? attempts : null, tracked: true };
  }
  const scans = [...(tracking.shipment_track_activities ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const returnStart = scans.findIndex((s) => RETURN_SCANS.has(String(s['sr-status'])));
  const undelivered = (returnStart < 0 ? scans : scans.slice(0, returnStart))
    .filter((s) => String(s['sr-status']) === '21' || /undeliver|refus|reject|cancel/i.test(`${s.status} ${s.activity}`))
    .map((s) => tidy(s.activity || s.status));
  return undelivered.length
    ? { reason: undelivered[undelivered.length - 1], code: null, attempts: undelivered.length, tracked: true }
    : { reason: NO_ATTEMPT, code: null, attempts: 0, tracked: true };
}

async function readReasons(awbs: string[]): Promise<Map<string, Reason>> {
  const out = new Map<string, Reason>();
  const queue = [...awbs];
  const worker = async () => {
    for (let awb = queue.shift(); awb; awb = queue.shift()) {
      const response = await shiprocketService.getAWBTrackingActivities(awb);
      out.set(awb, reasonFromTracking(response?.tracking_data ?? null));
    }
  };
  await Promise.all(Array.from({ length: TRACKING_WORKERS }, worker));
  return out;
}

/**
 * Re-reads each month from `fromMonth` (default: two months back) to now: the month's order, delivered and cancelled
 * counts, and every failed order. Reasons are read from tracking only for orders not stored with one yet. A stored
 * order that is no longer failed in Shiprocket is removed.
 */
export async function refreshFailureReasons(opts: { fromMonth?: string } = {}) {
  const db = getFirestore();
  const now = Timestamp.now();
  const months = monthsFrom(opts.fromMonth ?? shiftMonth(istMonth(), -2), istMonth());
  const totals: Record<string, { orders: number; delivered: number; cancelled: number; refreshedAt: Timestamp }> = {};
  let failed = 0;
  let tracked = 0;
  let removed = 0;

  for (const month of months) {
    const [y, m] = month.split('-').map(Number);
    const window = { from: `${month}-01`, to: `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` };
    const count = async (status?: number) =>
      (await shiprocketService.listOrders({ ...window, ...(status ? { filter_by: 'status', filter: status } : {}), per_page: 1 })).total;
    totals[month] = { orders: await count(), delivered: await count(DELIVERED), cancelled: await count(CANCELLED), refreshedAt: now };

    const found = new Map<string, { o: any; status: string }>();
    for (const [code, status] of Object.entries(FAILED)) {
      for (let page = 1; ; page++) {
        const { data } = await shiprocketService.listOrders({ ...window, filter_by: 'status', filter: code, per_page: 100, page });
        for (const o of data) if (o.channel_order_id) found.set(o.channel_order_id, { o, status });
        if (data.length < 100) break;
      }
    }

    const stored = new Map((await db.collection(COLLECTION).where('month', '==', month).get()).docs.map((d) => [d.id, d.data()]));
    const toTrack = [...found.values()]
      .filter(({ o, status }) => {
        const prev = stored.get(o.channel_order_id);
        return status === 'RTO DELIVERED' && o.shipments?.[0]?.awb && !(prev?.tracked && prev.status === status);
      })
      .map(({ o }) => String(o.shipments[0].awb));
    const reasons = await readReasons(toTrack);
    tracked += [...reasons.values()].filter((r) => r.tracked).length;

    let batch = db.batch();
    let ops = 0;
    const flush = async (force = false) => {
      if (ops && (force || ops >= 400)) {
        await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };
    for (const [order, { o, status }] of found) {
      const ship = o.shipments?.[0] ?? {};
      const prev = stored.get(order);
      const fresh = ship.awb ? reasons.get(String(ship.awb)) : undefined;
      const r: Reason = COURIER_LOSS[status]
        ? { reason: COURIER_LOSS[status], code: null, attempts: null, tracked: true }
        : fresh ?? (prev ? { reason: prev.reason ?? null, code: prev.code ?? null, attempts: prev.attempts ?? null, tracked: !!prev.tracked } : reasonFromTracking(null));
      const placed = parsePlaced(o.created_at);
      batch.set(db.collection(COLLECTION).doc(order), {
        order,
        month,
        shiprocketId: o.id ?? null,
        placedAt: placed ? Timestamp.fromDate(placed) : null,
        payment: /cod/i.test(String(o.payment_method ?? '')) ? 'COD' : 'Prepaid',
        value: Number(o.total) || 0,
        courier: ship.courier ?? null,
        awb: ship.awb ? String(ship.awb) : null,
        status,
        ...r,
        group: groupOf(status, r),
        refreshedAt: now,
      });
      ops++;
      await flush();
    }
    for (const id of stored.keys()) {
      if (found.has(id)) continue;
      batch.delete(db.collection(COLLECTION).doc(id));
      ops++;
      removed++;
      await flush();
    }
    await flush(true);
    failed += found.size;
  }

  await db.doc(META).set({ refreshedAt: now, months: totals }, { merge: true });
  return { months, failed, tracked, removed };
}

function summarise(month: string, totals: any, docs: any[]): FailureMonth {
  const orders = Number(totals?.orders ?? 0);
  const delivered = Number(totals?.delivered ?? 0);
  const cancelled = Number(totals?.cancelled ?? 0);
  const failed = docs.length;
  const open = Math.max(0, orders - delivered - cancelled - failed);
  const cod = docs.filter((d) => d.payment === 'COD').length;
  return {
    month,
    orders,
    delivered,
    cancelled,
    failed,
    open,
    settling: month >= istMonth() || open > 0.1 * Math.max(1, orders - cancelled),
    cod,
    prepaid: failed - cod,
    value: Math.round(docs.reduce((sum, d) => sum + (Number(d.value) || 0), 0)),
    groups: Object.fromEntries(GROUP_NAMES.map((g) => [g, docs.filter((d) => d.group === g).length])),
  };
}

const iso = (t: any): string | null => (t?.toDate ? t.toDate().toISOString() : null);

/** Every month (latest first) with its counts and reason groups, and each group's courier wordings. */
export async function getFailureReasonsOverview() {
  const db = getFirestore();
  const [meta, snap] = await Promise.all([db.doc(META).get(), db.collection(COLLECTION).get()]);
  const totals = meta.data()?.months ?? {};
  const docs = snap.docs.map((d) => d.data());
  const keys = [...new Set([...Object.keys(totals), ...docs.map((d) => String(d.month))])].sort().reverse();
  const reasons = GROUP_NAMES.map((group) => {
    const inGroup = docs.filter((d) => d.group === group);
    const counts = new Map<string, number>();
    for (const d of inGroup) {
      const reason = d.reason ?? 'Not read yet';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    return { group, count: inGroup.length, wordings: [...counts].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })) };
  });
  return {
    refreshedAt: iso(meta.data()?.refreshedAt),
    groups: GROUP_NAMES,
    months: keys.map((k) => summarise(k, totals[k], docs.filter((d) => d.month === k))),
    reasons,
  };
}

/** One month's counts and its failed orders, oldest first. */
export async function getFailureReasonsMonth(month: string) {
  const db = getFirestore();
  const [meta, snap] = await Promise.all([db.doc(META).get(), db.collection(COLLECTION).where('month', '==', month).get()]);
  const docs = snap.docs.map((d) => d.data());
  const placed = (d: any) => (d.placedAt?.toMillis ? d.placedAt.toMillis() : 0);
  return {
    refreshedAt: iso(meta.data()?.refreshedAt),
    groups: GROUP_NAMES,
    summary: summarise(month, meta.data()?.months?.[month], docs),
    orders: docs
      .sort((a, b) => placed(a) - placed(b) || String(a.order).localeCompare(String(b.order)))
      .map((d) => ({
        order: String(d.order),
        placedAt: iso(d.placedAt),
        payment: d.payment === 'COD' ? 'COD' : 'Prepaid',
        value: Number(d.value) || 0,
        courier: d.courier ?? null,
        status: String(d.status),
        group: String(d.group),
        reason: d.reason ?? null,
        attempts: typeof d.attempts === 'number' ? d.attempts : null,
      })),
  };
}
