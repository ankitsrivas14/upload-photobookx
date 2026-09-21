import shopifyService from './shopifyService';
import shiprocketService from './shiprocketService';
import { backfillOrderStats } from './orderStatsService';
import { backfillDailyPnl } from './dailyPnlService';
import { backfillShippingStats } from './shippingStatsService';
import { refreshBreakevenSnapshot } from './breakevenService';
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
 *   4. Recompute the daily aggregates the dashboards read.
 *
 * Only-terminal orders that already have a charge are skipped, so steady-state runs
 * do very little external work.
 */

// Orders created before this were a one-off backfill and are intentionally ignored.
const SYNC_CUTOFF_DATE = new Date('2026-01-10T00:00:00');
// Shipping-charge search fix date: terminal orders with a 0 charge fetched before this
// get one more attempt with the corrected Shiprocket search; after it we trust the 0.
const FIX_DATE = new Date('2026-03-21T00:00:00Z');

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
}> {
  // 1. Latest order changes from Shopify.
  const synced = await shopifyService.syncOrders(10000);

  // 2. Decide which orders need a shipping sync.
  const orders = await shopifyService.getAllOrders(10000);
  const orderNames = orders.map((o: any) => o.name);
  const [rtoRows, chargeMap] = await Promise.all([
    RTOOrder.find({}, { shopifyOrderId: 1, _id: 0 }).lean(),
    shiprocketService.getShippingCharges(orderNames),
  ]);
  const rtoSet = new Set((rtoRows as any[]).map((r) => r.shopifyOrderId as number));
  const toSync = selectOrdersNeedingShippingSync(orders, rtoSet, chargeMap);

  // 3. One bulk shipping fetch (order-map + wallet-txn caches keep this cheap).
  let fetched = 0;
  let skipped = 0;
  if (toSync.length > 0) {
    const result = await shiprocketService.bulkFetchShippingCharges(toSync);
    fetched = result.fetched;
    skipped = result.skipped;
  }

  // 4. Recompute the daily aggregates the dashboards read.
  await backfillOrderStats();
  await backfillShippingStats();
  await backfillDailyPnl();
  // 5. Refresh the breakeven snapshot the dashboard reads (off the request path).
  await refreshBreakevenSnapshot();

  console.log(
    `Scheduled refresh: synced ${synced} orders, ${toSync.length} needed shipping sync ` +
      `(fetched ${fetched}, skipped ${skipped})`
  );

  return { synced, toSync: toSync.length, fetched, skipped };
}
