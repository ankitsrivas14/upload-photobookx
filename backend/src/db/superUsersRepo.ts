import bcrypt from 'bcryptjs';
import { getFirestore } from './firestore';

/**
 * Admin users (`superUsers/{id}`), moved from the Mongo `superusers` collection with their
 * ids unchanged, so tokens issued before the move stay valid. Passwords are bcrypt hashes
 * (cost 10, as before) and never leave this module except through `checkPassword`.
 */

const COLLECTION = 'superUsers';
const BCRYPT_ROUNDS = 10;

export interface SuperUserDoc {
  id: string;
  email: string;
  password: string; // bcrypt hash
  name: string;
  isActive: boolean;
}

const col = () => getFirestore().collection(COLLECTION);

function fromDoc(id: string, data: any): SuperUserDoc {
  return { id, email: data.email, password: data.password, name: data.name, isActive: data.isActive !== false };
}

export async function findByEmail(email: string): Promise<SuperUserDoc | null> {
  const snap = await col().where('email', '==', String(email).trim().toLowerCase()).limit(1).get();
  return snap.empty ? null : fromDoc(snap.docs[0].id, snap.docs[0].data());
}

export async function findById(id: string | undefined): Promise<SuperUserDoc | null> {
  if (!id) return null;
  const snap = await col().doc(String(id)).get();
  return snap.exists ? fromDoc(snap.id, snap.data()) : null;
}

export async function count(): Promise<number> {
  return (await col().count().get()).data().count;
}

export async function create(user: { email: string; password: string; name: string }): Promise<SuperUserDoc> {
  const ref = col().doc();
  const now = new Date();
  const data = {
    email: user.email.trim().toLowerCase(),
    password: await bcrypt.hash(user.password, BCRYPT_ROUNDS),
    name: user.name.trim(),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data);
  return fromDoc(ref.id, data);
}

export async function setPassword(id: string, newPassword: string): Promise<void> {
  await col().doc(id).set(
    { password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS), updatedAt: new Date() },
    { merge: true }
  );
}

export function checkPassword(user: SuperUserDoc, candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, user.password);
}
