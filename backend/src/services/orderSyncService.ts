import shopifyService from './shopifyService';
import { getFirestore } from '../db/firestore';

// The first run (no cursor yet) looks back this far, so status changes that the old
// created_at-based sync missed (late deliveries, RTOs, cancellations, refunds) catch up.
const FIRST_RUN_LOOKBACK_DAYS = 60;
// Re-read a little before the cursor so an order changed while the last run was paging isn't missed.
const OVERLAP_MS = 5 * 60 * 1000;
const MAX_ORDERS_PER_RUN = 5000;

/**
 * Pull every Shopify order *updated* since the last successful sync into Firestore.
 *
 * Filtering on updated_at rather than created_at means any order whose status changes is
 * picked up, however old it is: deliveries, RTOs, cancellations and refunds all bump
 * updated_at. The cursor lives in `meta/ordersSync` and only moves forward when a run
 * fetched everything (a run that hits the cap retries the same window next time).
 */
export async function syncChangedOrders(): Promise<{ fetched: number; written: number; since: string }> {
  const ref = getFirestore().collection('meta').doc('ordersSync');
  const snap = await ref.get();
  const startedAt = new Date();
  const cursor = snap.exists ? (snap.data()?.updatedAtCursor as string | undefined) : undefined;
  const since = cursor
    ? new Date(new Date(cursor).getTime() - OVERLAP_MS)
    : new Date(startedAt.getTime() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const orders = await shopifyService.fetchRecentOrders(since.toISOString(), MAX_ORDERS_PER_RUN, 'updated');
  const { saveAll } = await import('../db/ordersRepo');
  const written = orders.length > 0 ? await saveAll(orders) : 0;

  const complete = orders.length < MAX_ORDERS_PER_RUN;
  if (!complete) console.warn(`syncChangedOrders: hit the ${MAX_ORDERS_PER_RUN}-order cap; cursor not advanced`);
  await ref.set(
    {
      ...(complete ? { updatedAtCursor: startedAt.toISOString() } : {}),
      lastRunAt: startedAt.toISOString(),
      lastFetched: orders.length,
    },
    { merge: true }
  );
  return { fetched: orders.length, written, since: since.toISOString() };
}
