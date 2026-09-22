import { getFirestore } from './firestore';

/**
 * A tiny generic Firestore accessor for collections that are keyed by a natural id
 * (a dateKey, an order id, an order number, …). Keeps the many small collection
 * migrations DRY: one document per key, read by id / range / whole collection.
 *
 * `idField` is the field on each item that becomes the Firestore document id.
 */
export function keyedStore<T extends Record<string, any>>(collection: string, idField: keyof T) {
  const col = () => getFirestore().collection(collection);

  // Deep-convert Mongo values Firestore can't store: ObjectId → string; drop _id/__v.
  // Dates are preserved (Firestore stores them as Timestamps).
  function strip(value: any): any {
    if (value == null) return value;
    if (value instanceof Date) return value;
    if (typeof value === 'object') {
      if (value._bsontype === 'ObjectId' || value._bsontype === 'ObjectID' || typeof value.toHexString === 'function') {
        return value.toString();
      }
      if (Array.isArray(value)) return value.map(strip);
      const out: any = {};
      for (const k of Object.keys(value)) {
        if (k === '_id' || k === '__v') continue;
        out[k] = strip(value[k]);
      }
      return out;
    }
    return value;
  }

  return {
    async get(id: string): Promise<T | null> {
      const snap = await col().doc(id).get();
      return snap.exists ? (snap.data() as T) : null;
    },

    async set(item: T): Promise<void> {
      const id = String(item[idField]);
      if (!id) return;
      await col().doc(id).set(strip(item), { merge: true });
    },

    /** Upsert many (chunked into 450-write batches). Returns count written. */
    async bulkSet(items: T[]): Promise<number> {
      const db = getFirestore();
      let n = 0;
      for (let i = 0; i < items.length; i += 450) {
        const batch = db.batch();
        for (const item of items.slice(i, i + 450)) {
          const id = String(item[idField]);
          if (!id) continue;
          batch.set(db.collection(collection).doc(id), strip(item), { merge: true });
          n++;
        }
        await batch.commit();
      }
      return n;
    },

    async delete(id: string): Promise<void> {
      await col().doc(id).delete();
    },

    async deleteMany(ids: string[]): Promise<void> {
      const db = getFirestore();
      for (let i = 0; i < ids.length; i += 450) {
        const batch = db.batch();
        for (const id of ids.slice(i, i + 450)) batch.delete(db.collection(collection).doc(String(id)));
        await batch.commit();
      }
    },

    /** Whole collection. */
    async all(): Promise<T[]> {
      const snap = await col().get();
      return snap.docs.map((d) => d.data() as T);
    },

    /** Documents whose id (== a string field like dateKey) is within [start, end]. */
    async rangeByField(field: keyof T & string, start?: string, end?: string): Promise<T[]> {
      let q: FirebaseFirestore.Query = col();
      if (start) q = q.where(field, '>=', start);
      if (end) q = q.where(field, '<=', end);
      const snap = await q.get();
      return snap.docs.map((d) => d.data() as T);
    },

    /** Get several documents by id in one batched read. */
    async getMany(ids: string[]): Promise<T[]> {
      const db = getFirestore();
      const uniq = [...new Set(ids.map(String).filter(Boolean))];
      const out: T[] = [];
      for (let i = 0; i < uniq.length; i += 300) {
        const refs = uniq.slice(i, i + 300).map((id) => db.collection(collection).doc(id));
        const snaps = await db.getAll(...refs);
        for (const s of snaps) if (s.exists) out.push(s.data() as T);
      }
      return out;
    },
  };
}
