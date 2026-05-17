import ShopifyOrderCache from '../models/ShopifyOrderCache';
import RTOOrder from '../models/RTOOrder';
import { DailyOrderStats } from '../models/DailyOrderStats';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-28';

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

/** Build set of shopifyOrderIds that are marked as RTO */
async function buildRtoSet(): Promise<Set<number>> {
  const rtos = await RTOOrder.find({}, { shopifyOrderId: 1 }).lean();
  return new Set((rtos as any[]).map((r) => r.shopifyOrderId as number));
}

/** Build a map of dateKey → orders (non-cancelled) from ShopifyOrderCache */
async function buildOrdersByDate(): Promise<Map<string, any[]>> {
  const cacheEntries = await ShopifyOrderCache.find(
    { cacheKey: { $regex: /^all_orders_/ } },
    { orders: 1 }
  ).lean();

  const seenIds = new Set<number | string>();
  const byDate = new Map<string, any[]>();

  for (const entry of cacheEntries) {
    for (const order of (entry as any).orders as any[]) {
      if (order.cancelled_at) continue;
      const id = order.id;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);

      const dateKey = toDateKey(new Date(order.created_at));
      if (dateKey < DATA_START_DATE) continue;

      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(order);
    }
  }

  return byDate;
}

function classifyPaymentMethod(order: any): 'prepaid' | 'cod' {
  const gateway: string = (order.payment_gateway ?? '').toLowerCase();
  const tags: string = (order.tags ?? '').toLowerCase();
  const paymentGateways: string[] = (order.payment_gateway_names ?? []).map((g: string) => g.toLowerCase());

  if (
    gateway.includes('cash on delivery') ||
    gateway.includes('cod') ||
    paymentGateways.some((g) => g.includes('cod')) ||
    tags.includes('cod')
  ) {
    return 'cod';
  }
  return 'prepaid';
}

function classifyDeliveryStatus(order: any, rtoSet: Set<number>): string {
  if (rtoSet.has(order.id)) return 'failed';

  // Match the frontend: get status from latest fulfillment's shipment_status
  let status = '';
  if (order.fulfillments && order.fulfillments.length > 0) {
    status = (order.fulfillments[order.fulfillments.length - 1].shipment_status ?? '').toLowerCase();
  }
  if (!status && order.fulfillment_status) {
    status = order.fulfillment_status.toLowerCase();
  }

  if (status === 'failure' || status.includes('failed') || status.includes('rto')) return 'failed';
  if (status === 'delivered') return 'delivered';
  if (status.includes('out for delivery') || status.includes('out_for_delivery')) return 'out_for_delivery';
  if (status.includes('attempt')) return 'attempted';
  if (status.includes('transit') || status.includes('shipped') || status.includes('picked') || status.includes('pickup')) return 'in_transit';
  return 'confirmed';
}

export async function recomputeOrderStatsForDate(
  dateKey: string,
  ordersByDate?: Map<string, any[]>,
  rtoSet?: Set<number>
): Promise<void> {
  const orders = ordersByDate
    ? (ordersByDate.get(dateKey) ?? [])
    : await (async () => { const m = await buildOrdersByDate(); return m.get(dateKey) ?? []; })();

  const rto = rtoSet ?? (await buildRtoSet());

  let prepaidCount = 0;
  let codCount = 0;
  let deliveredCount = 0;
  let failedCount = 0;
  let inTransitCount = 0;
  let outForDeliveryCount = 0;
  let attemptedDeliveryCount = 0;
  let confirmedCount = 0;
  let codDeliveredCount = 0;
  let codFailedCount = 0;
  let nonFinalCount = 0; // orders not in a final state (mirrors frontend isOrderFinal logic)

  for (const order of orders) {
    const paymentMethod = classifyPaymentMethod(order);
    const deliveryStatus = classifyDeliveryStatus(order, rto);

    // Mirror frontend: prepaid is always "final"; COD only final when delivered/failed
    const isFinal = paymentMethod === 'prepaid' || deliveryStatus === 'delivered' || deliveryStatus === 'failed';
    if (!isFinal) nonFinalCount++;

    if (paymentMethod === 'prepaid') prepaidCount++;
    else codCount++;

    if (deliveryStatus === 'failed') {
      failedCount++;
    } else if (deliveryStatus === 'delivered') {
      deliveredCount++;
    } else if (deliveryStatus === 'out_for_delivery') {
      outForDeliveryCount++;
    } else if (deliveryStatus === 'attempted') {
      attemptedDeliveryCount++;
    } else if (deliveryStatus === 'in_transit') {
      inTransitCount++;
    } else {
      // confirmed / no status
      if (paymentMethod === 'prepaid') {
        deliveredCount++;
      } else {
        confirmedCount++;
      }
    }

    if (paymentMethod === 'cod') {
      if (deliveryStatus === 'delivered') codDeliveredCount++;
      else if (deliveryStatus === 'failed') codFailedCount++;
    }
  }

  const isCompleted = orders.length > 0 && nonFinalCount === 0;

  await DailyOrderStats.findOneAndUpdate(
    { dateKey },
    {
      $set: {
        prepaidCount,
        codCount,
        deliveredCount,
        failedCount,
        inTransitCount,
        outForDeliveryCount,
        attemptedDeliveryCount,
        confirmedCount,
        codDeliveredCount,
        codFailedCount,
        isCompleted,
      },
    },
    { upsert: true, new: true }
  );
}

export async function backfillOrderStats(): Promise<{ upserted: number }> {
  const [ordersByDate, rtoSet] = await Promise.all([buildOrdersByDate(), buildRtoSet()]);

  let upserted = 0;
  for (const dateKey of ordersByDate.keys()) {
    await recomputeOrderStatsForDate(dateKey, ordersByDate, rtoSet);
    upserted++;
  }

  return { upserted };
}
