import { getApps, initializeApp, getApp } from 'firebase-admin/app';
import { getFirestore as adminGetFirestore, Firestore } from 'firebase-admin/firestore';

// The Firestore database id. A named database was created (`upload-photobookx`),
// not the '(default)' one, so we must target it explicitly. Override via env if needed.
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'upload-photobookx';

/**
 * Lazily-initialised Firestore handle (Native mode, default database in the same
 * GCP project as the functions). Initialised on first use so importing a route that
 * merely references it never crashes an environment without credentials.
 *
 * Requires Firestore Native to be enabled once for the project.
 */
let cached: Firestore | null = null;

export function getFirestore(): Firestore {
  if (cached) return cached;
  if (!getApps().length) {
    initializeApp();
  }
  const db = adminGetFirestore(getApp(), DATABASE_ID);
  // Trimmed order objects legitimately contain undefined fields (e.g. no customer).
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // settings() throws if called twice — safe to ignore.
  }
  cached = db;
  return db;
}
