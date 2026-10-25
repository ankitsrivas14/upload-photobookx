import { getFirestore } from './firestore';
import { fromFirestore } from './keyedStore';

/**
 * Firestore store for Shiprocket shipping charges — `shippingCharges/{orderNumber}`
 * (order number without a leading '#'). Read by document id (batched getAll), which is
 * fast, instead of a Mongo `$in` over hundreds of order numbers on the slow tier.
 */
const COLLECTION = 'shippingCharges';

function bare(n: string): string {
  return String(n || '').replace(/^#/, '');
}

// Short-lived cache of shippingCharge → charge for the backfills (see ordersRepo).
let mapCache: { map: Map<string, number>; at: number } | null = null;
const MAP_TTL_MS = 60 * 1000;

// Order number, customer name and phone of every charge, for the order search: Firestore
// can't do the substring match it needs, so it filters this list in memory.
let searchCache: { rows: any[]; at: number } | null = null;
const SEARCH_TTL_MS = 5 * 60 * 1000;

// Field types as the old Mongo schema cast them, so every doc keeps one type per field
// (Shiprocket returns some ids and pincodes as numbers, others as strings).
const NUMBER_FIELDS = [
  'shippingCharge', 'freightForward', 'freightCOD', 'freightRTO', 'whatsappCharges', 'otherCharges',
  'shiprocketOrderId', 'shopifyOrderId', 'weight',
];
const STRING_FIELDS = [
  'awbCode', 'courierName', 'status', 'pickupDate', 'deliveredDate', 'firstAttemptDate',
  'customerName', 'customerCity', 'customerState', 'customerPincode', 'customerPhone',
];

function normalize(doc: any): any {
  const out: any = { ...doc };
  for (const f of NUMBER_FIELDS) {
    if (out[f] == null || out[f] === '') continue;
    const n = Number(out[f]);
    out[f] = Number.isFinite(n) ? n : undefined;
  }
  for (const f of STRING_FIELDS) if (out[f] != null) out[f] = String(out[f]);
  if (out.fetchedAt != null && !(out.fetchedAt instanceof Date)) out.fetchedAt = new Date(out.fetchedAt);
  out.updatedAt = new Date();
  return out;
}

/** Upsert many charge docs (chunked into 450-write batches). */
export async function upsertMany(docs: any[]): Promise<number> {
  const db = getFirestore();
  let n = 0;
  mapCache = null; // invalidate the caches on write
  searchCache = null;
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 450)) {
      const id = bare(d.orderNumber);
      if (!id) continue;
      // Drop Mongo-only fields Firestore can't serialize (_id is an ObjectId).
      const rest: any = normalize(d);
      delete rest._id;
      delete rest.__v;
      batch.set(db.collection(COLLECTION).doc(id), { ...rest, orderNumber: id }, { merge: true });
      n++;
    }
    await batch.commit();
  }
  return n;
}

/**
 * Whole-collection map of bare order number → shipping charge amount (with `#` variant),
 * for the backfills' shipping map. Cached briefly so one run reads it once.
 */
export async function getAllAsMap(): Promise<Map<string, number>> {
  if (mapCache && Date.now() - mapCache.at < MAP_TTL_MS) return mapCache.map;
  const db = getFirestore();
  const snap = await db.collection(COLLECTION).get();
  const map = new Map<string, number>();
  for (const d of snap.docs) {
    const charge = (d.data() as any).shippingCharge ?? 0;
    map.set(d.id, charge);
    map.set(`#${d.id}`, charge);
  }
  mapCache = { map, at: Date.now() };
  return map;
}

/** Every shipping-charge doc (full fields). */
export async function getAllDocs(): Promise<any[]> {
  const snap = await getFirestore().collection(COLLECTION).get();
  return snap.docs.map((d) => fromFirestore(d.data()));
}

/** Fetch charge docs for the given order numbers, keyed by bare order number. */
export async function getMany(orderNumbers: string[]): Promise<Map<string, any>> {
  const db = getFirestore();
  const ids = [...new Set(orderNumbers.map(bare).filter(Boolean))];
  const map = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.collection(COLLECTION).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) map.set(s.id, fromFirestore(s.data()));
  }
  return map;
}

/**
 * Charges whose order number or customer name contains `query` (case-insensitive), as
 * { orderNumber, customerName, customerPhone, shopifyOrderId }. Reads every charge's search
 * fields at most once per SEARCH_TTL_MS.
 */
export async function searchByOrderOrCustomer(query: string, limit = 30): Promise<any[]> {
  if (!searchCache || Date.now() - searchCache.at > SEARCH_TTL_MS) {
    const snap = await getFirestore()
      .collection(COLLECTION)
      .select('customerName', 'customerPhone', 'shopifyOrderId')
      .get();
    searchCache = { rows: snap.docs.map((d) => ({ ...d.data(), orderNumber: d.id })), at: Date.now() };
  }
  const q = query.toLowerCase();
  const qNumber = bare(q);
  const out: any[] = [];
  for (const row of searchCache.rows) {
    if (
      String(row.orderNumber).toLowerCase().includes(qNumber) ||
      String(row.customerName || '').toLowerCase().includes(q)
    ) {
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out;
}
