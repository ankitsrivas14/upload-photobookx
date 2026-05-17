import ShopifyOrderCache from '../models/ShopifyOrderCache';
import RTOOrder from '../models/RTOOrder';
import ShippingCharge from '../models/ShippingCharge';
import { DailyAdSpend } from '../models/DailyAdSpend';
import { COGSConfiguration } from '../models/COGSConfiguration';
import { DailyPnl } from '../models/DailyPnl';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-28';

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

// ─── data loaders ────────────────────────────────────────────────────────────

async function loadOrdersByDate(): Promise<Map<string, any[]>> {
  const entries = await ShopifyOrderCache.find(
    { cacheKey: { $regex: /^all_orders_/ } },
    { orders: 1 }
  ).lean();

  const seen = new Set<number | string>();
  const byDate = new Map<string, any[]>();

  for (const entry of entries) {
    for (const order of (entry as any).orders as any[]) {
      if (order.cancelled_at) continue;
      const id = order.id;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);

      const dateKey = toDateKey(new Date(order.created_at));
      if (dateKey < DATA_START_DATE) continue;

      if (!byDate.has(dateKey)) byDate.set(dateKey, []);
      byDate.get(dateKey)!.push(order);
    }
  }
  return byDate;
}

async function loadRtoSet(): Promise<Set<number>> {
  const docs = await RTOOrder.find({}, { shopifyOrderId: 1 }).lean();
  return new Set((docs as any[]).map((d) => d.shopifyOrderId as number));
}

async function loadShippingMap(): Promise<Map<string, number>> {
  const docs = await ShippingCharge.find({}, { orderNumber: 1, shippingCharge: 1 }).lean();
  const map = new Map<string, number>();
  for (const d of docs as any[]) {
    const base = (d.orderNumber as string).replace(/^#/, '');
    map.set(base, d.shippingCharge);
    map.set(`#${base}`, d.shippingCharge);
  }
  return map;
}

async function loadAdSpendByDate(): Promise<Map<string, number>> {
  const docs = await DailyAdSpend.find({}, { date: 1, amount: 1 }).lean();
  const map = new Map<string, number>();
  for (const d of docs as any[]) {
    const key = toDateKey(new Date(d.date));
    map.set(key, (map.get(key) ?? 0) + (d.amount as number));
  }
  return map;
}

async function loadCogsFields(): Promise<any[]> {
  const config = await COGSConfiguration.findOne().lean();
  return (config as any)?.fields ?? [];
}

// ─── per-order helpers ────────────────────────────────────────────────────────

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

function isRto(order: any, rtoSet: Set<number>): boolean {
  return rtoSet.has(order.id as number);
}

// Mirrors frontend isOrderDelivered (prepaid assumed delivered if not failed)
function orderIsDelivered(order: any, rtoSet: Set<number>): boolean {
  if (isRto(order, rtoSet)) return false;
  const status = getDeliveryStatus(order);
  if (status.includes('failed') || status.includes('rto') || status.includes('return') || status === 'failure') return false;
  if (status === 'delivered') return true;
  if (isPaymentPrepaid(order)) return true;
  return false;
}

// Mirrors frontend isOrderFinalStatus (explicit delivered/failed only — no prepaid assumption)
function orderIsFinalStatus(order: any, rtoSet: Set<number>): boolean {
  if (isRto(order, rtoSet)) return true;
  const status = getDeliveryStatus(order);
  const isFailed = status === 'failure' || status.includes('failed') || status.includes('rto');
  return status === 'delivered' || isFailed;
}

function detectVariant(order: any): 'small' | 'large' {
  const items: any[] = order.line_items ?? [];
  const hasLarge = items.some(
    (i) => i.title?.toLowerCase().includes('large') || i.variant_title?.toLowerCase().includes('large')
  );
  return hasLarge ? 'large' : 'small';
}

function calcOrderPnl(
  order: any,
  adCostPerOrder: number,
  rtoSet: Set<number>,
  shippingMap: Map<string, number>,
  cogsFields: any[]
): number {
  if (cogsFields.length === 0) return 0;

  const variant = detectVariant(order);
  const delivered = orderIsDelivered(order, rtoSet);
  const status = getDeliveryStatus(order);
  const failed =
    isRto(order, rtoSet) ||
    status === 'failure' ||
    status.includes('failed') ||
    status.includes('rto');
  const pm = isPaymentPrepaid(order) ? 'Prepaid' : 'COD';

  let revenue = 0;
  let fieldsToUse: any[] = [];

  if (delivered) {
    revenue = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
    fieldsToUse = cogsFields.filter((f) => f.type === 'cogs' || f.type === 'both');
  } else if (failed) {
    revenue = 0;
    fieldsToUse = cogsFields.filter((f) => f.type === 'ndr' || f.type === 'both');
  } else {
    revenue = 0;
    fieldsToUse = cogsFields.filter((f) => f.type === 'cogs' || f.type === 'both');
  }

  let totalCosts = 0;
  const key = `${variant}${pm}Value`;
  for (const field of fieldsToUse) {
    const value: number = field[key] ?? 0;
    if (field.calculationType === 'fixed') {
      totalCosts += value;
    } else {
      const salePrice = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
      const pct = field.percentageType || 'excluded';
      totalCosts += pct === 'included'
        ? (value / (100 + value)) * salePrice
        : (value / 100) * salePrice;
    }
  }

  // Shipping charge from Shiprocket data
  const orderName: string = (order.name ?? '').replace(/^#/, '');
  const shipCost = shippingMap.get(orderName) ?? shippingMap.get(`#${orderName}`) ?? 0;
  totalCosts += shipCost;

  return revenue - totalCosts - adCostPerOrder;
}

// ─── recompute ────────────────────────────────────────────────────────────────

export async function recomputePnlForDate(
  dateKey: string,
  ordersByDate?: Map<string, any[]>,
  rtoSet?: Set<number>,
  shippingMap?: Map<string, number>,
  adSpendByDate?: Map<string, number>,
  cogsFields?: any[]
): Promise<void> {
  const orders = ordersByDate
    ? (ordersByDate.get(dateKey) ?? [])
    : await (async () => { const m = await loadOrdersByDate(); return m.get(dateKey) ?? []; })();

  const rto = rtoSet ?? (await loadRtoSet());
  const shipMap = shippingMap ?? (await loadShippingMap());
  const adSpendMap = adSpendByDate ?? (await loadAdSpendByDate());
  const cogs = cogsFields ?? (await loadCogsFields());

  const adSpend = adSpendMap.get(dateKey) ?? 0;
  const orderCount = orders.length;
  const adCostPerOrder = orderCount > 0 ? adSpend / orderCount : 0;

  // Bar-chart completion: all orders explicitly delivered/failed (or no orders)
  const isCompleted = orderCount === 0 || orders.every((o) => orderIsFinalStatus(o, rto));

  let barChartProfit = 0;
  let heatmapProfit = 0;
  let hasHeatmapOrders = false;

  for (const order of orders) {
    const pnl = calcOrderPnl(order, adCostPerOrder, rto, shipMap, cogs);

    // Bar chart: all orders contribute when completed
    barChartProfit += pnl;

    // Heatmap: only final (explicit) or prepaid orders
    const isFinal = orderIsFinalStatus(order, rto) || isPaymentPrepaid(order);
    if (isFinal) {
      heatmapProfit += pnl;
      hasHeatmapOrders = true;
    }
  }

  // Ad-spend-only day: no orders but has ad spend
  if (orderCount === 0 && adSpend > 0) {
    barChartProfit = -adSpend;
    heatmapProfit = -adSpend;
  } else if (!hasHeatmapOrders && adSpend > 0) {
    // Has orders but none final — heatmap shows -adSpend for the unattributed cost
    heatmapProfit = -adSpend;
  }

  await DailyPnl.findOneAndUpdate(
    { dateKey },
    {
      $set: {
        isCompleted,
        barChartProfit,
        heatmapProfit,
        orderCount,
        adSpend,
      },
    },
    { upsert: true, new: true }
  );
}

export async function backfillDailyPnl(): Promise<{ upserted: number }> {
  const [ordersByDate, rtoSet, shippingMap, adSpendByDate, cogsFields] = await Promise.all([
    loadOrdersByDate(),
    loadRtoSet(),
    loadShippingMap(),
    loadAdSpendByDate(),
    loadCogsFields(),
  ]);

  // Include both order dates and ad-spend dates
  const allDates = new Set([...ordersByDate.keys(), ...adSpendByDate.keys()]);

  let upserted = 0;
  for (const dateKey of allDates) {
    await recomputePnlForDate(dateKey, ordersByDate, rtoSet, shippingMap, adSpendByDate, cogsFields);
    upserted++;
  }

  return { upserted };
}
