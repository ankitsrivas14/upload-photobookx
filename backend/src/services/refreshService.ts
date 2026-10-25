import shiprocketService from './shiprocketService';
import { fullRebuildDue, processDirtyDates, rebuildAll } from './aggregatesService';
import { markDatesDirty, orderDateKey } from '../db/aggregatesDirty';
import { RTOOrder } from '../models';

/**
 * Server-side equivalent of the SalesPage "Refresh" button, so the data stays fresh
 * on a schedule and users rarely need to trigger it by hand.
 *
 * It mirrors the frontend's refresh flow:
 *   1. Pull the latest order changes from Shopify.
 *   2. Work out which orders still need a Shiprocket shipping sync (same rules the
 *      frontend applied in handleRefresh — see SalesPage.tsx).
 *   3. Fetch those shipping charges in ONE bulk call (the Shiprocket order-map and
 *      wallet-transaction caches keep it cheap).
 *   4. Recompute the daily aggregates the dashboards read: only the dates whose inputs
 *      changed, or every date on the nightly full rebuild (see aggregatesService).
 *
 * Only-terminal orders that already have a charge are skipped, so steady-state runs
 * do very little external work. Between full rebuilds only recent orders are checked.
 */

// Orders created before this were a one-off backfill and are intentionally ignored.
const SYNC_CUTOFF_DATE = new Date('2026-01-10T00:00:00');
// Shipping-charge search fix date: terminal orders with a 0 charge fetched before this
// get one more attempt with the corrected Shiprocket search; after it we trust the 0.
const FIX_DATE = new Date('2026-03-21T00:00:00Z');
// Orders settle (delivered or RTO) within weeks, so the half-hourly runs only check orders
// created this recently; the nightly full run checks every order.
const SHIPPING_WINDOW_DAYS = 30;

/** Delivery status from a raw Shopify order — latest fulfillment, else order-level status. */
function deriveDeliveryStatus(order: any): string | null {
  if (order.fulfillments?.length) {
    const latest = order.fulfillments[order.fulfillments.length - 1];
    if (latest?.shipment_status) return latest.shipment_status;
  }
  return order.fulfillment_status || null;
}

/** Which order names still need a Shiprocket shipping sync (ports the SalesPage filter). */
function selectOrdersNeedingShippingSync(
  orders: any[],
  rtoSet: Set<number>,
  chargeMap: Map<string, any>
): string[] {
  return orders
    .filter((o) => {
      if (o.cancelled_at) return false;

      const deliveryStatus = (deriveDeliveryStatus(o) || '').toLowerCase();

      // Unfulfilled with no delivery status yet → nothing to sync.
      const isUnfulfilled = !o.fulfillment_status || o.fulfillment_status === 'unfulfilled';
      if (isUnfulfilled && !deliveryStatus) return false;

      if (new Date(o.created_at) < SYNC_CUTOFF_DATE) return false;

      const isDelivered = deliveryStatus === 'delivered';
      const isFailed =
        rtoSet.has(o.id) ||
        deliveryStatus === 'failure' ||
        deliveryStatus.includes('failed') ||
        deliveryStatus.includes('rto');
      const isTerminal = isFailed || isDelivered;

      const charge = chargeMap.get(o.name);
      const hasStatusData = !!deliveryStatus;
      const hasChargeData = (charge?.shippingCharge ?? 0) > 0;
      const wasFetchedAfterFix = charge?.fetchedAt && new Date(charge.fetchedAt) >= FIX_DATE;

      // Non-terminal → always sync (status may have changed).
      if (!isTerminal) return true;
      // Terminal but no status yet → sync to get initial data.
      if (!hasStatusData) return true;
      // Terminal with a real charge → done.
      if (hasChargeData) return false;
      // Terminal, 0 charge, already retried after the search fix → trust the 0.
      if (wasFetchedAfterFix) return false;
      // Terminal, 0 charge, never retried after the fix → one-time recovery.
      return true;
    })
    .map((o) => o.name);
}

export async function runScheduledRefresh(): Promise<{
  synced: number;
  toSync: number;
  fetched: number;
  skipped: number;
  aggregates: string;
}> {
  // 1. Orders changed since the last sync straight into Firestore (fast; no 15MB Mongo path).
  //    Writing them marks their days for the aggregate recompute in step 4.
  const { syncChangedOrders } = await import('./orderSyncService');
  const { written: synced } = await syncChangedOrders();
  const { getAll, getCreatedBetween } = await import('../db/ordersRepo');
  const full = await fullRebuildDue();

  // 2. Decide which orders need a shipping sync (orders from Firestore).
  const windowStart = new Date(Date.now() - SHIPPING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const orders = full ? await getAll() : await getCreatedBetween(windowStart.toISOString().slice(0, 10));
  const orderNames = orders.map((o: any) => o.name);
  const { rtoStore, idSet } = await import('../db/orderListStores');
  const [rtoSet, chargeMap] = await Promise.all([
    idSet(rtoStore),
    shiprocketService.getShippingCharges(orderNames),
  ]);
  const toSync = selectOrdersNeedingShippingSync(orders, rtoSet, chargeMap);

  // 3. One bulk shipping fetch (order-map + wallet-txn caches keep this cheap).
  let fetched = 0;
  let skipped = 0;
  if (toSync.length > 0) {
    const result = await shiprocketService.bulkFetchShippingCharges(toSync);
    fetched = result.fetched;
    skipped = result.skipped;

    // A changed charge changes that day's shipping and P&L aggregates.
    const after = await shiprocketService.getShippingCharges(toSync);
    const byName = new Map(orders.map((o: any) => [o.name, o]));
    const bare = (n: string) => String(n || '').replace(/^#/, '');
    const changed = toSync.filter(
      (name) => (chargeMap.get(bare(name))?.shippingCharge ?? 0) !== (after.get(bare(name))?.shippingCharge ?? 0)
    );
    await markDatesDirty(changed.map((name) => orderDateKey(byName.get(name))));
  }

  // 4. Recompute the daily aggregates the dashboards read. The full rebuild also refreshes
  //    the breakeven snapshot.
  let aggregates: string;
  if (full) {
    const rebuilt = await rebuildAll();
    aggregates = rebuilt ? `full rebuild (${rebuilt.dates} dates)` : 'full rebuild skipped (lease held)';
  } else {
    const n = await processDirtyDates();
    aggregates = n === null ? 'skipped (lease held)' : `${n} dirty dates`;
  }

  console.log(
    `Scheduled refresh: synced ${synced} orders, ${toSync.length} needed shipping sync ` +
      `(fetched ${fetched}, skipped ${skipped}), aggregates: ${aggregates}`
  );

  return { synced, toSync: toSync.length, fetched, skipped, aggregates };
}
