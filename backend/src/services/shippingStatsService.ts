import ShopifyOrderCache from '../models/ShopifyOrderCache';
import ShippingCharge from '../models/ShippingCharge';
import { DailyShipping } from '../models/DailyShipping';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-01';

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

function classifyVariant(lineItems: any[]): 'small' | 'large' | 'mixed' {
  const items = lineItems ?? [];
  const hasLarge = items.some(
    (i: any) => i.title?.toLowerCase().includes('large') || i.variant_title?.toLowerCase().includes('large')
  );
  const hasSmall = items.some(
    (i: any) => !i.title?.toLowerCase().includes('large') && !i.variant_title?.toLowerCase().includes('large')
  );
  if (hasLarge && hasSmall) return 'mixed';
  if (hasLarge) return 'large';
  return 'small';
}

function avgOf(amounts: number[]): number | null {
  const valid = amounts.filter((v) => v > 0);
  if (valid.length === 0) return null;
  return valid.reduce((s, v) => s + v, 0) / valid.length;
}

/** Build a map of orderNumber → shippingCharge from ShippingCharge collection */
async function buildShippingChargeMap(): Promise<Map<string, number>> {
  const charges = await ShippingCharge.find({}, { orderNumber: 1, shippingCharge: 1 }).lean();
  const map = new Map<string, number>();
  for (const c of charges as any[]) {
    // Store both with and without # prefix for flexible lookup
    const base = c.orderNumber.replace(/^#/, '');
    map.set(base, c.shippingCharge);
    map.set(`#${base}`, c.shippingCharge);
  }
  return map;
}

/** Build a map of dateKey → fulfilled orders (non-cancelled) from ShopifyOrderCache */
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
      if (order.fulfillment_status !== 'fulfilled') continue;
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

/**
 * Recompute DailyShipping for a single date.
 * Pass in pre-built maps to avoid N+1 fetches when backfilling.
 */
export async function recomputeShippingForDate(
  dateKey: string,
  ordersByDate?: Map<string, any[]>,
  chargeMap?: Map<string, number>
): Promise<void> {
  const orders = ordersByDate
    ? (ordersByDate.get(dateKey) ?? [])
    : await getSingleDayOrders(dateKey);

  const charges = chargeMap ?? (await buildShippingChargeMap());

  const allAmounts: number[] = [];
  const smallAmounts: number[] = [];
  const largeAmounts: number[] = [];

  for (const order of orders) {
    const orderName: string = order.name ?? '';
    const base = orderName.replace(/^#/, '');
    const charge = charges.get(base) ?? charges.get(`#${base}`) ?? 0;
    if (charge <= 0) continue;

    const variant = classifyVariant(order.line_items ?? []);
    allAmounts.push(charge);
    if (variant === 'small') smallAmounts.push(charge);
    if (variant === 'large') largeAmounts.push(charge);
  }

  await DailyShipping.findOneAndUpdate(
    { dateKey },
    {
      $set: {
        avgShipping: avgOf(allAmounts),
        avgShippingSmall: avgOf(smallAmounts),
        avgShippingLarge: avgOf(largeAmounts),
        orderCount: allAmounts.length,
        smallCount: smallAmounts.length,
        largeCount: largeAmounts.length,
      },
    },
    { upsert: true, new: true }
  );
}

async function getSingleDayOrders(dateKey: string): Promise<any[]> {
  const byDate = await buildOrdersByDate();
  return byDate.get(dateKey) ?? [];
}

/**
 * Given a Shopify order name, return its dateKey from the cache.
 */
export async function getOrderDateKey(orderName: string): Promise<string | null> {
  const cacheEntries = await ShopifyOrderCache.find(
    { cacheKey: { $regex: /^all_orders_/ } },
    { orders: 1 }
  ).lean();

  const base = orderName.replace(/^#/, '');
  for (const entry of cacheEntries) {
    for (const order of (entry as any).orders as any[]) {
      const name: string = (order.name ?? '').replace(/^#/, '');
      if (name === base) {
        return toDateKey(new Date(order.created_at));
      }
    }
  }
  return null;
}

/**
 * Backfill DailyShipping for all dates that have fulfilled orders with shipping charges.
 */
export async function backfillShippingStats(): Promise<{ upserted: number }> {
  const [ordersByDate, chargeMap] = await Promise.all([
    buildOrdersByDate(),
    buildShippingChargeMap(),
  ]);

  let upserted = 0;
  for (const dateKey of ordersByDate.keys()) {
    await recomputeShippingForDate(dateKey, ordersByDate, chargeMap);
    upserted++;
  }

  return { upserted };
}
