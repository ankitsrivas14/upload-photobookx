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

/** Upsert many charge docs (chunked into 450-write batches). */
export async function upsertMany(docs: any[]): Promise<number> {
  const db = getFirestore();
  let n = 0;
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
