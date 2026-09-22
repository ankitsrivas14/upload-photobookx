import { getFirestore } from './firestore';

/**
 * Firestore-backed store for Shopify orders — one document per order in `orders`,
 * replacing the single ~15MB `ShopifyOrderCache` blob for the read hot path.
 *
 * Each doc holds the (trimmed) order plus helper fields:
 *   - `monthKey`  : IST 'YYYY-MM' of created_at   (indexed → fast month reads)
 *   - `nameBare`  : order name without a leading '#' (for id/status lookups)
 *   - `nameLower` : lower-cased bare name           (for prefix search)
 */

const COLLECTION = 'orders';
const STORE_TZ = 'Asia/Kolkata';

function monthKeyOf(order: any): string | null {
  if (!order?.created_at) return null;
  return new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: STORE_TZ }).substring(0, 7);
}

function bare(name: string): string {
  return String(name || '').replace(/^#/, '');
}

function toDoc(order: any) {
  const name = order.name || '';
  const custName = `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim();
  return {
    ...order,
    monthKey: monthKeyOf(order),
    nameBare: bare(name),
    nameLower: bare(name).toLowerCase(),
    customerNameLower: custName.toLowerCase(),
  };
}

/** Upsert many orders (chunked into Firestore's 500-write batches). */
export async function upsertMany(orders: any[]): Promise<number> {
  const db = getFirestore();
  let written = 0;
  for (let i = 0; i < orders.length; i += 450) {
    const chunk = orders.slice(i, i + 450);
    const batch = db.batch();
    for (const o of chunk) {
      if (o?.id == null) continue;
      batch.set(db.collection(COLLECTION).doc(String(o.id)), toDoc(o), { merge: true });
      written++;
    }
    await batch.commit();
  }
  return written;
}

/** All orders created in the given IST month ('YYYY-MM'). */
export async function getMonth(monthKey: string): Promise<any[]> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).where('monthKey', '==', monthKey).get();
  return snap.docs.map((d) => d.data());
}

/** Every order (used by the 'all' / 'last30' views — reads the whole collection). */
export async function getAll(): Promise<any[]> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).get();
  return snap.docs.map((d) => d.data());
}

/** The IST months that have orders, newest first — from a metadata rollup if present,
 *  else derived cheaply by scanning distinct monthKeys is expensive, so we keep a
 *  tiny `meta/orderMonths` doc updated on write. */
export async function listMonths(): Promise<string[]> {
  const db = getFirestore();
  const doc = await db.collection('meta').doc('orderMonths').get();
  const months: string[] = (doc.exists && (doc.data() as any)?.months) || [];
  return [...months].sort().reverse();
}

async function addMonths(monthKeys: Set<string>): Promise<void> {
  if (monthKeys.size === 0) return;
  const db = getFirestore();
  const ref = db.collection('meta').doc('orderMonths');
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const existing: string[] = (doc.exists && (doc.data() as any)?.months) || [];
    const merged = Array.from(new Set([...existing, ...monthKeys]));
    tx.set(ref, { months: merged }, { merge: true });
  });
}

/** Prefix search on order name (and customer name), capped. */
export async function search(query: string, limit = 50): Promise<any[]> {
  const db = getFirestore();
  const q = bare(query);
  const ql = q.toLowerCase();
  const [byName, byNameLower, byCustomer] = await Promise.all([
    db.collection(COLLECTION).where('nameBare', '>=', q).where('nameBare', '<=', q + '').limit(limit).get(),
    db.collection(COLLECTION).where('nameLower', '>=', ql).where('nameLower', '<=', ql + '').limit(limit).get(),
    db.collection(COLLECTION).where('customerNameLower', '>=', ql).where('customerNameLower', '<=', ql + '').limit(limit).get(),
  ]);
  const map = new Map<string, any>();
  for (const d of [...byName.docs, ...byNameLower.docs, ...byCustomer.docs]) map.set(d.id, d.data());
  return Array.from(map.values()).slice(0, limit);
}

/** Update an order's latest fulfillment shipment_status (Delivered/Failed mark). */
export async function patchStatusByName(orderName: string, shipmentStatus: string): Promise<void> {
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).where('nameBare', '==', bare(orderName)).limit(5).get();
  const now = new Date().toISOString();
  for (const d of snap.docs) {
    const o: any = d.data();
    const fulfillments = Array.isArray(o.fulfillments) && o.fulfillments.length > 0
      ? o.fulfillments
      : [{}];
    fulfillments[fulfillments.length - 1] = {
      ...fulfillments[fulfillments.length - 1],
      shipment_status: shipmentStatus,
      updated_at: now,
    };
    await d.ref.set({ fulfillments }, { merge: true });
  }
}

/** Convenience used by the dual-write path: upsert + keep the month index fresh. */
export async function saveAll(orders: any[]): Promise<number> {
  const written = await upsertMany(orders);
  const months = new Set<string>();
  for (const o of orders) {
    const m = monthKeyOf(o);
    if (m) months.add(m);
  }
  await addMonths(months);
  return written;
}
