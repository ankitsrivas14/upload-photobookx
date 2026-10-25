import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from './firestore';
import { fromFirestore, sanitizeForFirestore } from './keyedStore';

/**
 * Customer upload data, moved from Mongo with ids unchanged: magic links (`magicLinks/{id}`),
 * the photos uploaded through them (`uploadedImages/{id}`, whose `magicLinkId` is the link's
 * id) and delivery tickets (`tickets/{id}`). Every doc returned carries `_id` (its id), as the
 * Mongo docs did, so route code and API responses keep their shape.
 */

const links = () => getFirestore().collection('magicLinks');
const images = () => getFirestore().collection('uploadedImages');
const tickets = () => getFirestore().collection('tickets');

const withId = (snap: FirebaseFirestore.DocumentSnapshot): any => ({ ...fromFirestore(snap.data()), _id: snap.id });
const time = (v: any) => (v instanceof Date ? v.getTime() : 0);

async function insert(col: FirebaseFirestore.CollectionReference, data: any): Promise<any> {
  const ref = col.doc();
  const now = new Date();
  await ref.set(sanitizeForFirestore({ ...data, createdAt: now, updatedAt: now }));
  return withId(await ref.get());
}

async function patch(col: FirebaseFirestore.CollectionReference, id: string, data: any): Promise<any | null> {
  const ref = col.doc(String(id));
  if (!(await ref.get()).exists) return null;
  await ref.set(sanitizeForFirestore({ ...data, updatedAt: new Date() }), { merge: true });
  return withId(await ref.get());
}

// ─── magic links ──────────────────────────────────────────────────────────────

export const createLink = (data: any) => insert(links(), data);
export const updateLink = (id: string, data: any) => patch(links(), id, data);

export async function linkByToken(token: string): Promise<any | null> {
  const snap = await links().where('token', '==', String(token)).limit(1).get();
  return snap.empty ? null : withId(snap.docs[0]);
}

/** Newest first, `limit` per page. */
export async function listLinks(page: number, limit: number): Promise<{ links: any[]; total: number }> {
  const [snap, total] = await Promise.all([
    links().orderBy('createdAt', 'desc').offset((page - 1) * limit).limit(limit).get(),
    links().count().get(),
  ]);
  return { links: snap.docs.map(withId), total: total.data().count };
}

export async function addUploads(id: string, by: 1 | -1): Promise<void> {
  const ref = links().doc(String(id));
  if (by > 0) {
    await ref.update({ currentUploads: FieldValue.increment(1), updatedAt: new Date() });
    return;
  }
  // Never below zero.
  await getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if ((snap.data()?.currentUploads ?? 0) > 0) {
      tx.update(ref, { currentUploads: FieldValue.increment(-1), updatedAt: new Date() });
    }
  });
}

// ─── uploaded images ──────────────────────────────────────────────────────────

export const createImage = (data: any) => insert(images(), { uploadedAt: new Date(), ...data });
export const updateImage = (id: string, data: any) => patch(images(), id, data);

export async function imagesForLink(linkId: string, order: 'asc' | 'desc' = 'asc'): Promise<any[]> {
  const snap = await images().where('magicLinkId', '==', String(linkId)).get();
  const sign = order === 'asc' ? 1 : -1;
  return snap.docs.map(withId).sort((a, b) => sign * (time(a.uploadedAt) - time(b.uploadedAt)));
}

/** The image, only if it belongs to this link. */
export async function imageForLink(imageId: string, linkId: string): Promise<any | null> {
  const snap = await images().doc(String(imageId)).get();
  if (!snap.exists) return null;
  const image = withId(snap);
  return String(image.magicLinkId) === String(linkId) ? image : null;
}

export async function deleteImage(id: string): Promise<void> {
  await images().doc(String(id)).delete();
}

export async function deleteImagesForLink(linkId: string): Promise<number> {
  const snap = await images().where('magicLinkId', '==', String(linkId)).get();
  for (let i = 0; i < snap.docs.length; i += 450) {
    const batch = getFirestore().batch();
    for (const d of snap.docs.slice(i, i + 450)) batch.delete(d.ref);
    await batch.commit();
  }
  return snap.size;
}

// ─── tickets ──────────────────────────────────────────────────────────────────

export const createTicket = (data: any) => insert(tickets(), { status: 'open', ...data });
export const updateTicket = (id: string, data: any) => patch(tickets(), id, data);

/** Newest first. */
export async function listTickets(): Promise<any[]> {
  const snap = await tickets().get();
  return snap.docs.map(withId).sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

export async function latestTicketForAwb(awb: string): Promise<any | null> {
  const snap = await tickets().where('awb', '==', String(awb)).get();
  return snap.docs.map(withId).sort((a, b) => time(b.createdAt) - time(a.createdAt))[0] ?? null;
}
