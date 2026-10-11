import { getFirestore } from './firestore';
import { sanitizeForFirestore, fromFirestore } from './keyedStore';

/**
 * A Firestore accessor for collections that were Mongo `_id`-keyed (feature pages).
 * New docs get a Firestore auto-id; every returned doc carries `_id` = its document id,
 * so the frontend keeps using `_id` exactly as it did with Mongo. The one-time backfill
 * preserves the original Mongo `_id` (as a string) so references stay stable.
 */
export function docStore(collection: string) {
  const col = () => getFirestore().collection(collection);
  const withId = (id: string, data: any) => ({ ...fromFirestore(data), _id: id, id });

  return {
    async create(data: any): Promise<any> {
      const ref = col().doc();
      const doc = withId(ref.id, sanitizeForFirestore(data));
      await ref.set(doc);
      return doc;
    },

    async getById(id: string): Promise<any | null> {
      const s = await col().doc(String(id)).get();
      return s.exists ? withId(s.id, s.data()) : null;
    },

    async updateById(id: string, data: any): Promise<any | null> {
      const ref = col().doc(String(id));
      await ref.set(sanitizeForFirestore(data), { merge: true });
      const s = await ref.get();
      return s.exists ? withId(s.id, s.data()) : null;
    },

    async deleteById(id: string): Promise<void> {
      await col().doc(String(id)).delete();
    },

    async all(): Promise<any[]> {
      const s = await col().get();
      return s.docs.map((d) => withId(d.id, d.data()));
    },

    async where(field: string, op: FirebaseFirestore.WhereFilterOp, value: any): Promise<any[]> {
      const s = await col().where(field, op, value).get();
      return s.docs.map((d) => withId(d.id, d.data()));
    },

    /** Multiple equality/range clauses ANDed together. */
    async query(clauses: Array<[string, FirebaseFirestore.WhereFilterOp, any]>): Promise<any[]> {
      let q: FirebaseFirestore.Query = col();
      for (const [f, op, v] of clauses) q = q.where(f, op, v);
      const s = await q.get();
      return s.docs.map((d) => withId(d.id, d.data()));
    },

    /** Docs where a string field starts with `prefix` (e.g. dateStr '2026-05-'). */
    async prefix(field: string, prefix: string): Promise<any[]> {
      const s = await col().where(field, '>=', prefix).where(field, '<=', prefix + '').get();
      return s.docs.map((d) => withId(d.id, d.data()));
    },

    /** Upsert with an explicit (deterministic/composite) document id. */
    async setById(id: string, data: any): Promise<any> {
      const ref = col().doc(String(id));
      await ref.set({ ...sanitizeForFirestore(data), _id: String(id), id: String(id) }, { merge: true });
      const s = await ref.get();
      return withId(s.id, s.data());
    },

    async count(): Promise<number> {
      return (await col().get()).size;
    },

    /** Insert many new docs (auto-ids), batched; returns the created docs (with _id). */
    async bulkCreate(items: any[]): Promise<any[]> {
      const db = getFirestore();
      const created: any[] = [];
      for (let i = 0; i < items.length; i += 450) {
        const batch = db.batch();
        for (const it of items.slice(i, i + 450)) {
          const ref = col().doc();
          const doc = { ...sanitizeForFirestore(it), _id: ref.id, id: ref.id };
          batch.set(ref, doc);
          created.push(doc);
        }
        await batch.commit();
      }
      return created;
    },

    /** Merge `patch` into every doc matching the clauses. Returns count updated. */
    async updateWhere(clauses: Array<[string, FirebaseFirestore.WhereFilterOp, any]>, patch: any): Promise<number> {
      let q: FirebaseFirestore.Query = col();
      for (const [f, op, v] of clauses) q = q.where(f, op, v);
      const snap = await q.get();
      const db = getFirestore();
      let n = 0;
      const ids = snap.docs.map((d) => d.id);
      for (let i = 0; i < ids.length; i += 450) {
        const batch = db.batch();
        for (const id of ids.slice(i, i + 450)) { batch.set(col().doc(id), sanitizeForFirestore(patch), { merge: true }); n++; }
        await batch.commit();
      }
      return n;
    },

    /** Merge `patch` into each doc id. */
    async updateByIds(ids: string[], patch: any): Promise<number> {
      const db = getFirestore();
      let n = 0;
      for (let i = 0; i < ids.length; i += 450) {
        const batch = db.batch();
        for (const id of ids.slice(i, i + 450)) { batch.set(col().doc(String(id)), sanitizeForFirestore(patch), { merge: true }); n++; }
        await batch.commit();
      }
      return n;
    },

    /** Backfill: copy Mongo docs, preserving the original _id as the Firestore doc id. */
    async bulkImport(items: any[]): Promise<number> {
      const db = getFirestore();
      let n = 0;
      for (let i = 0; i < items.length; i += 450) {
        const batch = db.batch();
        for (const it of items.slice(i, i + 450)) {
          const id = String(it._id ?? db.collection(collection).doc().id);
          batch.set(db.collection(collection).doc(id), withId(id, sanitizeForFirestore(it)), { merge: true });
          n++;
        }
        await batch.commit();
      }
      return n;
    },
  };
}
