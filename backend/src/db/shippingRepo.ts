import { getFirestore } from './firestore';

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

/** Upsert many charge docs (chunked into 450-write batches). */
export async function upsertMany(docs: any[]): Promise<number> {
  const db = getFirestore();
  let n = 0;
  mapCache = null; // invalidate the shipping-map cache on write
  for (let i = 0; i < docs.length; i += 450) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 450)) {
      const id = bare(d.orderNumber);
      if (!id) continue;
      // Drop Mongo-only fields Firestore can't serialize (_id is an ObjectId).
      const rest: any = { ...d };
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

/** Fetch charge docs for the given order numbers, keyed by bare order number. */
export async function getMany(orderNumbers: string[]): Promise<Map<string, any>> {
  const db = getFirestore();
  const ids = [...new Set(orderNumbers.map(bare).filter(Boolean))];
  const map = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 300) {
    const refs = ids.slice(i, i + 300).map((id) => db.collection(COLLECTION).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) map.set(s.id, s.data());
  }
  return map;
}
