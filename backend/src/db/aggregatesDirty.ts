import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from './firestore';

/**
 * Bookkeeping for the incremental daily aggregates (dailyOrderStats, dailyShipping, dailyPnl,
 * dailyRoas), kept in two small docs:
 *   - `dirty`: the IST dates whose inputs changed since they were last recomputed, a `full`
 *     flag for changes that touch every date (COGS edits, imports), and a lease so only one
 *     scheduled run recomputes at a time.
 *   - `state`: when the last full rebuild ran and the historical COD RTO rate it computed,
 *     which incremental P&L recomputes reuse instead of reading every order.
 *
 * Writers mark dates after their write lands; a recompute takes the marks before it reads
 * its inputs. So a date that changes mid-recompute stays marked for the next run.
 *
 * `aggregatesBook('meta')` is the real one; tests pass a scratch collection.
 */

const STORE_TZ = 'Asia/Kolkata';

/** IST 'YYYY-MM-DD' of an order's creation: the day its aggregates are keyed by. */
export function orderDateKey(order: any): string | null {
  if (!order?.created_at) return null;
  return new Date(order.created_at).toLocaleDateString('en-CA', { timeZone: STORE_TZ });
}

export interface AggregatesState {
  lastFullRebuildAt?: string;
  lastFullRebuildDay?: string; // IST 'YYYY-MM-DD'
  rtoRate?: number;
}

export interface DirtyTake {
  dates: string[];
  full: boolean;
  leaseId: string | null; // null when there was nothing to take (no lease held)
}

export function aggregatesBook(collection: string) {
  const dirtyRef = () => getFirestore().collection(collection).doc('aggregatesDirty');
  const stateRef = () => getFirestore().collection(collection).doc('aggregates');

  async function markDatesDirty(dateKeys: Iterable<string | null | undefined>): Promise<void> {
    const keys = [...new Set([...dateKeys].filter((k): k is string => !!k))];
    if (keys.length === 0) return;
    await dirtyRef().set({ dates: FieldValue.arrayUnion(...keys) }, { merge: true });
  }

  async function requestFullRebuild(reason: string): Promise<void> {
    await dirtyRef().set(
      { full: true, fullReason: reason, fullRequestedAt: new Date().toISOString() },
      { merge: true }
    );
  }

  async function isFullRebuildRequested(): Promise<boolean> {
    const snap = await dirtyRef().get();
    return !!snap.data()?.full;
  }

  /**
   * Atomically take the dirty dates and hold a lease for `leaseMs`. A full rebuild
   * (`full: true`) also takes the full flag and always holds the lease; an incremental take
   * holds it only when there are dates to recompute. Returns null while another run holds
   * an unexpired lease, leaving the marks for later.
   */
  async function takeDirty(opts: { leaseMs: number; full: boolean }): Promise<DirtyTake | null> {
    const db = getFirestore();
    const ref = dirtyRef();
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data: any = snap.exists ? snap.data() : {};
      if (data.leaseUntil && Date.parse(data.leaseUntil) > Date.now()) return null;
      const dates: string[] = Array.isArray(data.dates) ? data.dates : [];
      const full = opts.full && !!data.full;
      if (!opts.full && dates.length === 0) return { dates, full: false, leaseId: null };
      const leaseId = randomUUID();
      tx.set(
        ref,
        {
          dates: [],
          ...(opts.full ? { full: false } : {}),
          leaseId,
          leaseUntil: new Date(Date.now() + opts.leaseMs).toISOString(),
        },
        { merge: true }
      );
      return { dates, full, leaseId };
    });
  }

  /** Release the lease, unless it expired and another run has taken it since. */
  async function releaseLease(leaseId: string | null): Promise<void> {
    if (!leaseId) return;
    const db = getFirestore();
    const ref = dirtyRef();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data()?.leaseId === leaseId) tx.set(ref, { leaseId: null, leaseUntil: null }, { merge: true });
    });
  }

  /** Put taken work back after a failed recompute so the next run retries it. */
  async function restoreDirty(take: DirtyTake, reason: string): Promise<void> {
    await markDatesDirty(take.dates);
    if (take.full) await requestFullRebuild(reason);
  }

  async function readState(): Promise<AggregatesState> {
    const snap = await stateRef().get();
    return (snap.data() as AggregatesState) || {};
  }

  async function writeState(state: AggregatesState): Promise<void> {
    await stateRef().set(state, { merge: true });
  }

  return {
    markDatesDirty,
    requestFullRebuild,
    isFullRebuildRequested,
    takeDirty,
    releaseLease,
    restoreDirty,
    readState,
    writeState,
  };
}

const book = aggregatesBook('meta');
export const {
  markDatesDirty,
  requestFullRebuild,
  isFullRebuildRequested,
  takeDirty,
  releaseLease,
  restoreDirty,
  readState,
  writeState,
} = book;
