import { getFirestore } from '../db/firestore';
import { getCreatedBetween } from '../db/ordersRepo';

/** The books kept on the shelf, in the order the admin lists them. */
export const STOCK_ITEMS = [
  { sku: 'jl-large', label: 'Jyotirlinga Large' },
  { sku: 'jl-small', label: 'Jyotirlinga Small' },
  { sku: 'dham-large', label: 'Dhaam Large' },
  { sku: 'dham-small', label: 'Dhaam Small' },
] as const;
export type StockSku = (typeof STOCK_ITEMS)[number]['sku'];

/** A shelf count: books on hand at `countedAt`, and books then sold but not yet shipped. */
interface StockCount {
  sku: StockSku;
  count: number;
  countedAt: string;
  committed: number;
}

export interface StockLevel {
  sku: StockSku;
  label: string;
  counted: number;
  countedAt: string;
  /** Books in orders still waiting to ship when counted. */
  committed: number;
  /** Books ordered since the count (cancelled orders left out). */
  soldSince: number;
  /** Books left to sell: counted − committed − soldSince. */
  available: number;
  /** Books a day: the busiest daily average of the last 3, 7 and 30 days. */
  pace: number;
  /** Whole days of stock left at that pace; null when nothing sells. */
  daysLeft: number | null;
  low: boolean;
}

const COLLECTION = 'stockCounts';
/** A book is low once it has this many days of stock or fewer. */
export const ALERT_DAYS = 10;
// The busiest of these windows (full days to yesterday) sets the pace, so a rush shows up within
// days while a quiet stretch, such as an ad pause, doesn't hide what a normal day takes.
const PACE_WINDOWS = [3, 7, 30];

const istDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const daysAgo = (now: Date, n: number) => istDay(new Date(now.getTime() - n * 86_400_000));

/** The stocked book a line item takes off the shelf, if it is one. */
export function skuOf(item: any): StockSku | null {
  const text = `${item.title ?? ''} ${item.variant_title ?? ''}`.toLowerCase();
  const line = text.includes('jyotirling') ? 'jl' : text.includes('dhaam') || text.includes('dham') ? 'dham' : null;
  return line ? (`${line}-${text.includes('large') ? 'large' : 'small'}` as StockSku) : null;
}

/** Books per stocked line in the orders `keep` accepts. */
function units(orders: any[], keep: (order: any) => boolean): Record<StockSku, number> {
  const out = Object.fromEntries(STOCK_ITEMS.map((i) => [i.sku, 0])) as Record<StockSku, number>;
  for (const order of orders) {
    if (order.cancelled_at || !keep(order)) continue;
    for (const item of order.line_items ?? []) {
      const sku = skuOf(item);
      if (sku) out[sku] += item.quantity ?? 1;
    }
  }
  return out;
}

// Still to ship: Shopify leaves fulfillment_status empty until the order ships ('partial' when part has).
const waitingToShip = (order: any) => !order.fulfillment_status || order.fulfillment_status === 'unfulfilled' || order.fulfillment_status === 'partial';

/**
 * Record a shelf count, taken after the day's shipments. Books in orders still waiting to ship
 * are noted with it, since they are on the shelf but already sold.
 */
export async function recordStockCounts(counts: Partial<Record<StockSku, number>>, now = new Date()): Promise<StockCount[]> {
  const orders = await getCreatedBetween(daysAgo(now, 60));
  const committed = units(orders, waitingToShip);
  const countedAt = now.toISOString();
  const docs = (Object.entries(counts) as Array<[StockSku, number]>).map(([sku, count]) => ({ sku, count, countedAt, committed: committed[sku] }));
  const batch = getFirestore().batch();
  for (const doc of docs) batch.set(getFirestore().collection(COLLECTION).doc(`${doc.sku}_${countedAt}`), doc);
  await batch.commit();
  return docs;
}

/** Each stocked book's latest count, what has sold since, the pace it sells at and the days left. */
export async function getStockLevels(now = new Date()): Promise<StockLevel[]> {
  const snap = await getFirestore().collection(COLLECTION).get();
  const latest = new Map<StockSku, StockCount>();
  for (const d of snap.docs) {
    const c = d.data() as StockCount;
    if (!latest.has(c.sku) || latest.get(c.sku)!.countedAt < c.countedAt) latest.set(c.sku, c);
  }
  if (!latest.size) return [];

  const oldestCount = [...latest.values()].reduce((m, c) => (c.countedAt < m ? c.countedAt : m), now.toISOString());
  const from = [daysAgo(now, Math.max(...PACE_WINDOWS)), istDay(oldestCount)].sort()[0];
  const orders = await getCreatedBetween(from);
  const today = istDay(now);
  const paces = PACE_WINDOWS.map((w) => {
    const start = daysAgo(now, w);
    const sold = units(orders, (o) => {
      const day = istDay(o.created_at);
      return day >= start && day < today;
    });
    return { w, sold };
  });

  return STOCK_ITEMS.filter((i) => latest.has(i.sku)).map(({ sku, label }) => {
    const c = latest.get(sku)!;
    const soldSince = units(orders, (o) => new Date(o.created_at) > new Date(c.countedAt))[sku];
    const available = c.count - c.committed - soldSince;
    const pace = Math.max(...paces.map((p) => p.sold[sku] / p.w));
    const daysLeft = pace > 0 ? Math.floor(Math.max(available, 0) / pace) : null;
    return {
      sku,
      label,
      counted: c.count,
      countedAt: c.countedAt,
      committed: c.committed,
      soldSince,
      available,
      pace: Math.round(pace * 100) / 100,
      daysLeft,
      low: available <= 0 || (daysLeft !== null && daysLeft <= ALERT_DAYS),
    };
  });
}
