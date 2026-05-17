import ShopifyOrderCache from '../models/ShopifyOrderCache';
import RTOOrder from '../models/RTOOrder';
import ShippingCharge from '../models/ShippingCharge';
import { COGSConfiguration } from '../models/COGSConfiguration';
import { DailyOrderStats } from '../models';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-28';

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

function getDeliveryStatus(order: any): string {
  let status = '';
  if (order.fulfillments?.length > 0) {
    status = (order.fulfillments[order.fulfillments.length - 1].shipment_status ?? '').toLowerCase();
  }
  if (!status && order.fulfillment_status) status = order.fulfillment_status.toLowerCase();
  return status;
}

function isPaymentPrepaid(order: any): boolean {
  const gateway: string = (order.payment_gateway ?? order.gateway ?? '').toLowerCase();
  const tags: string = (order.tags ?? '').toLowerCase();
  const gateways: string[] = (order.payment_gateway_names ?? []).map((g: string) => g.toLowerCase());
  if (
    gateway.includes('cash on delivery') ||
    gateway.includes('cod') ||
    gateways.some((g) => g.includes('cod')) ||
    tags.includes('cod')
  ) return false;
  return true;
}

function detectVariant(order: any): 'small' | 'large' {
  const items: any[] = order.line_items ?? [];
  const hasLarge = items.some(
    (i) => i.title?.toLowerCase().includes('large') || i.variant_title?.toLowerCase().includes('large')
  );
  return hasLarge ? 'large' : 'small';
}

export interface BreakevenMetrics {
  aov: number;
  avgCOGS: number;
  avgShipping: number;
  avgTotalCost: number;
  contributionMargin: number;
  breakevenROAS: number;
  deliveredCount: number;
  failedCount: number;
  totalOrders: number;
  completedDaysCount: number;
}

export async function computeBreakevenMetrics(): Promise<BreakevenMetrics> {
  const now = new Date();
  const endKey = toDateKey(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 30);
  const startKey = toDateKey(start) < DATA_START_DATE ? DATA_START_DATE : toDateKey(start);

  // Get completed date keys from DailyOrderStats (liberal completion: prepaid assumed final)
  const completedStats = await DailyOrderStats.find(
    { dateKey: { $gte: startKey, $lte: endKey }, isCompleted: true },
    { dateKey: 1 }
  ).lean();

  const completedDateKeys = new Set((completedStats as any[]).map((d) => d.dateKey as string));
  const completedDaysCount = completedDateKeys.size;

  if (completedDaysCount === 0) {
    return { aov: 0, avgCOGS: 0, avgShipping: 0, avgTotalCost: 0, contributionMargin: 0, breakevenROAS: 0, deliveredCount: 0, failedCount: 0, totalOrders: 0, completedDaysCount: 0 };
  }

  // Load data needed to compute per-order metrics
  const [rtoSet, shippingMap, cogsConfig, cacheEntries] = await Promise.all([
    RTOOrder.find({}, { shopifyOrderId: 1 }).lean().then((docs) => new Set((docs as any[]).map((d) => d.shopifyOrderId as number))),
    ShippingCharge.find({}, { orderNumber: 1, shippingCharge: 1 }).lean().then((docs) => {
      const map = new Map<string, number>();
      for (const d of docs as any[]) {
        const base = (d.orderNumber as string).replace(/^#/, '');
        map.set(base, d.shippingCharge);
        map.set(`#${base}`, d.shippingCharge);
      }
      return map;
    }),
    COGSConfiguration.findOne().lean().then((c) => (c as any)?.fields ?? []),
    ShopifyOrderCache.find({ cacheKey: { $regex: /^all_orders_/ } }, { orders: 1 }).lean(),
  ]);

  // Collect orders belonging to completed date keys, deduplicated
  const seen = new Set<number | string>();
  const ordersByDate = new Map<string, any[]>();

  for (const entry of cacheEntries) {
    for (const order of (entry as any).orders as any[]) {
      if (order.cancelled_at) continue;
      const id = order.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      const dateKey = toDateKey(new Date(order.created_at));
      if (!completedDateKeys.has(dateKey)) continue;
      if (!ordersByDate.has(dateKey)) ordersByDate.set(dateKey, []);
      ordersByDate.get(dateKey)!.push(order);
    }
  }

  let totalRevenue = 0;
  let totalCOGS = 0;
  let totalShipping = 0;
  let deliveredCount = 0;
  let failedCount = 0;

  for (const [, orders] of ordersByDate) {
    for (const order of orders) {
      const isPrepaid = isPaymentPrepaid(order);
      const isRTO = rtoSet.has(order.id as number);
      const status = getDeliveryStatus(order);
      const isFailed =
        isRTO ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      // Liberal: prepaid assumed delivered unless RTO or explicitly failed
      const isDelivered = !isFailed && (status === 'delivered' || isPrepaid);

      const variant = detectVariant(order);
      const pm = isPrepaid ? 'Prepaid' : 'COD';
      const key = `${variant}${pm}Value`;

      if (isDelivered) {
        deliveredCount++;
        const revenue = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
        totalRevenue += revenue;

        let orderCOGS = 0;
        for (const field of (cogsConfig as any[]).filter((f: any) => f.type === 'cogs' || f.type === 'both')) {
          const value: number = field[key] ?? 0;
          if (field.calculationType === 'fixed') {
            orderCOGS += value;
          } else {
            const pct = field.percentageType || 'excluded';
            orderCOGS += pct === 'included'
              ? (value / (100 + value)) * revenue
              : (value / 100) * revenue;
          }
        }
        totalCOGS += orderCOGS;
      } else if (isFailed) {
        failedCount++;
        let orderNDR = 0;
        for (const field of (cogsConfig as any[]).filter((f: any) => f.type === 'ndr' || f.type === 'both')) {
          const value: number = field[key] ?? 0;
          if (field.calculationType === 'fixed') {
            orderNDR += value;
          } else {
            const salePrice = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
            const pct = field.percentageType || 'excluded';
            orderNDR += pct === 'included'
              ? (value / (100 + value)) * salePrice
              : (value / 100) * salePrice;
          }
        }
        totalCOGS += orderNDR;
      }

      // Shipping (from Shiprocket)
      const orderName: string = (order.name ?? '').replace(/^#/, '');
      const shipCost = shippingMap.get(orderName) ?? shippingMap.get(`#${orderName}`) ?? 0;
      if (isDelivered || isFailed) totalShipping += shipCost;
    }
  }

  const totalOrders = deliveredCount + failedCount;
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const avgCOGS = totalOrders > 0 ? totalCOGS / totalOrders : 0;
  const avgShipping = totalOrders > 0 ? totalShipping / totalOrders : 0;
  const avgTotalCost = avgCOGS + avgShipping;
  const contributionMargin = aov - avgTotalCost;
  const breakevenROAS = contributionMargin > 0 ? aov / contributionMargin : 0;

  return { aov, avgCOGS, avgShipping, avgTotalCost, contributionMargin, breakevenROAS, deliveredCount, failedCount, totalOrders, completedDaysCount };
}
