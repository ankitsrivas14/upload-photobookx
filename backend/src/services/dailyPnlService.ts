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

type ValueKey = 'smallPrepaidValue' | 'smallCODValue' | 'largePrepaidValue' | 'largeCODValue';

interface TotalOverrides {
  smallPrepaidValue?: number;
  smallCODValue?: number;
  largePrepaidValue?: number;
  largeCODValue?: number;
}

interface CogsVersion {
  effectiveFrom: string; // YYYY-MM-DD
  fields: any[];
  totalOverrides?: { pre?: TotalOverrides; post?: TotalOverrides };
}

async function loadCogsVersions(): Promise<CogsVersion[]> {
  const docs = await COGSConfiguration.find().sort({ effectiveFrom: 1 }).lean();
  return (docs as any[]).map((d) => ({
    effectiveFrom: toDateKey(new Date(d.effectiveFrom)),
    fields: d.fields ?? [],
    totalOverrides: d.totalOverrides,
  }));
}

function getCogsVersionForDate(dateKey: string, versions: CogsVersion[]): CogsVersion | null {
  let version: CogsVersion | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= dateKey) version = v;
    else break;
  }
  return version;
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

function sumCategoryFields(
  fields: any[],
  category: 'pre' | 'post',
  key: ValueKey,
  revenue: number
): number {
  let total = 0;
  for (const field of fields.filter((f) => (f.category ?? 'pre') === category)) {
    const value: number = field[key] ?? 0;
    if (field.calculationType === 'fixed') {
      total += value;
    } else {
      const pct = field.percentageType || 'excluded';
      total += pct === 'included'
        ? (value / (100 + value)) * revenue
        : (value / 100) * revenue;
    }
  }
  return total;
}

interface OrderPnlBreakdown {
  revenue: number;
  cogs: number; // COGS fields + shipping, excludes ad spend
  pnl: number;  // revenue - cogs - adCostPerOrder
}

/**
 * Compute the historical RTO rate for COD orders.
 * Uses only finalized COD orders (delivered or failed/RTO) to avoid bias from pending orders.
 * Falls back to 20% if fewer than 20 finalized COD orders are available.
 */
function computeHistoricalRtoRate(
  ordersByDate: Map<string, any[]>,
  rtoSet: Set<number>
): number {
  let finalCodCount = 0;
  let rtoCount = 0;

  for (const [, dayOrders] of ordersByDate) {
    for (const order of dayOrders) {
      if (isPaymentPrepaid(order)) continue;
      if (!orderIsFinalStatus(order, rtoSet)) continue;
      finalCodCount++;
      if (!orderIsDelivered(order, rtoSet)) rtoCount++;
    }
  }

  if (finalCodCount < 20) return 0.20; // not enough data — default 20%
  return rtoCount / finalCodCount;
}

function calcOrderPnl(
  order: any,
  adCostPerOrder: number,
  rtoSet: Set<number>,
  shippingMap: Map<string, number>,
  cogsFields: any[],
  overrides?: { pre?: TotalOverrides; post?: TotalOverrides },
  rtoRate?: number  // historical COD RTO rate for expected-value estimation of pending orders
): OrderPnlBreakdown {
  if (cogsFields.length === 0 && !overrides) return { revenue: 0, cogs: 0, pnl: 0 };

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
    // Pending order
    if (!isPaymentPrepaid(order) && rtoRate !== undefined) {
      // Expected-value model for pending COD orders:
      //   With probability (1 − rtoRate) → will be delivered: full revenue + delivery COGS
      //   With probability rtoRate        → will be RTO:       zero revenue + NDR COGS
      const orderValue = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
      const deliverProb = 1 - rtoRate;
      const rtoProb     = rtoRate;
      const k = `${variant}${pm}Value` as ValueKey;

      const deliverFields = cogsFields.filter((f) => f.type === 'cogs' || f.type === 'both');
      const rtoFields     = cogsFields.filter((f) => f.type === 'ndr'  || f.type === 'both');

      let dCogs = 0; // COGS if delivered
      let rCogs = 0; // COGS if RTO
      for (const cat of ['pre', 'post'] as const) {
        const ov = overrides?.[cat]?.[k];
        if (ov !== undefined) {
          dCogs += ov;
          rCogs += ov;
        } else {
          dCogs += sumCategoryFields(deliverFields, cat, k, orderValue);
          rCogs += sumCategoryFields(rtoFields,     cat, k, 0);
        }
      }

      const oName    = (order.name ?? '').replace(/^#/, '');
      const shipCost = shippingMap.get(oName) ?? shippingMap.get(`#${oName}`) ?? 0;

      const expRevenue = orderValue * deliverProb;
      const expCogs    = dCogs * deliverProb + rCogs * rtoProb + shipCost;
      return { revenue: expRevenue, cogs: expCogs, pnl: expRevenue - expCogs - adCostPerOrder };
    }
    // Pending prepaid (or no rtoRate available): treat as 0 revenue
    revenue = 0;
    fieldsToUse = cogsFields.filter((f) => f.type === 'cogs' || f.type === 'both');
  }

  const key = `${variant}${pm}Value` as ValueKey;

  let totalCogs = 0;
  for (const cat of ['pre', 'post'] as const) {
    const override = overrides?.[cat]?.[key];
    if (override !== undefined) {
      totalCogs += override;
    } else {
      totalCogs += sumCategoryFields(fieldsToUse, cat, key, revenue);
    }
  }

  // Shipping charge from Shiprocket data
  const orderName: string = (order.name ?? '').replace(/^#/, '');
  const shipCost = shippingMap.get(orderName) ?? shippingMap.get(`#${orderName}`) ?? 0;
  totalCogs += shipCost;

  return { revenue, cogs: totalCogs, pnl: revenue - totalCogs - adCostPerOrder };
}

// ─── variant performance ─────────────────────────────────────────────────────

export interface VariantBucket {
  variant: 'small' | 'large';
  payment: 'prepaid' | 'cod';
  orders: number;
  delivered: number;
  rto: number;
  pending: number;
  revenue: number;
  cogs: number;
  adSpend: number;
  profit: number;
}

export async function getVariantPerformance(days: number): Promise<VariantBucket[]> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);
  const startKey = startDate.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });

  const [ordersByDate, rtoSet, shippingMap, adSpendByDate, cogsVersions] = await Promise.all([
    loadOrdersByDate(),
    loadRtoSet(),
    loadShippingMap(),
    loadAdSpendByDate(),
    loadCogsVersions(),
  ]);

  const buckets: Record<string, VariantBucket> = {
    smallPrepaid: { variant: 'small', payment: 'prepaid', orders: 0, delivered: 0, rto: 0, pending: 0, revenue: 0, cogs: 0, adSpend: 0, profit: 0 },
    smallCod:     { variant: 'small', payment: 'cod',     orders: 0, delivered: 0, rto: 0, pending: 0, revenue: 0, cogs: 0, adSpend: 0, profit: 0 },
    largePrepaid: { variant: 'large', payment: 'prepaid', orders: 0, delivered: 0, rto: 0, pending: 0, revenue: 0, cogs: 0, adSpend: 0, profit: 0 },
    largeCod:     { variant: 'large', payment: 'cod',     orders: 0, delivered: 0, rto: 0, pending: 0, revenue: 0, cogs: 0, adSpend: 0, profit: 0 },
  };

  for (const [dateKey, orders] of ordersByDate) {
    if (dateKey < startKey) continue;

    const version = getCogsVersionForDate(dateKey, cogsVersions);
    const cogsFields = version?.fields ?? [];
    const overrides = version?.totalOverrides;
    const adSpend = adSpendByDate.get(dateKey) ?? 0;
    const adCostPerOrder = orders.length > 0 ? adSpend / orders.length : 0;

    for (const order of orders) {
      const variant = detectVariant(order);
      const payment = isPaymentPrepaid(order) ? 'prepaid' : 'cod';
      const key = `${variant}${payment.charAt(0).toUpperCase()}${payment.slice(1)}`;
      const bucket = buckets[key];

      const isFinal = orderIsFinalStatus(order, rtoSet);
      if (!isFinal) {
        bucket.pending++;
        continue;
      }

      const delivered = orderIsDelivered(order, rtoSet);
      const failed = !delivered;

      const { revenue, cogs, pnl } = calcOrderPnl(order, adCostPerOrder, rtoSet, shippingMap, cogsFields, overrides);

      bucket.orders++;
      if (delivered) bucket.delivered++;
      else if (failed) bucket.rto++;

      bucket.revenue += revenue;
      bucket.cogs += cogs;
      bucket.adSpend += adCostPerOrder;
      bucket.profit += pnl;
    }
  }

  return Object.values(buckets);
}

// ─── recompute ────────────────────────────────────────────────────────────────

export async function recomputePnlForDate(
  dateKey: string,
  ordersByDate?: Map<string, any[]>,
  rtoSet?: Set<number>,
  shippingMap?: Map<string, number>,
  adSpendByDate?: Map<string, number>,
  cogsVersions?: CogsVersion[],
  rtoRate?: number  // pre-computed historical COD RTO rate; derived from data when omitted
): Promise<void> {
  // Keep the full map so we can compute the historical RTO rate when not pre-supplied
  let allOrdersByDate = ordersByDate;
  if (!allOrdersByDate) {
    allOrdersByDate = await loadOrdersByDate();
  }
  const orders = allOrdersByDate.get(dateKey) ?? [];

  const rto = rtoSet ?? (await loadRtoSet());
  const shipMap = shippingMap ?? (await loadShippingMap());
  const adSpendMap = adSpendByDate ?? (await loadAdSpendByDate());
  const versions = cogsVersions ?? (await loadCogsVersions());
  const version = getCogsVersionForDate(dateKey, versions);
  const cogs = version?.fields ?? [];
  const overrides = version?.totalOverrides;

  const adSpend = adSpendMap.get(dateKey) ?? 0;
  const orderCount = orders.length;
  const adCostPerOrder = orderCount > 0 ? adSpend / orderCount : 0;

  // Bar-chart completion: all orders explicitly delivered/failed (or no orders)
  const isCompleted = orderCount === 0 || orders.every((o) => orderIsFinalStatus(o, rto));

  // Effective RTO rate: use pre-supplied value, or compute from full order history
  const effectiveRtoRate = rtoRate ?? computeHistoricalRtoRate(allOrdersByDate, rto);

  let barChartProfit = 0;
  let heatmapProfit = 0;
  let hasHeatmapOrders = false;
  let totalRevenue = 0;
  let totalCogs = 0;

  for (const order of orders) {
    // Pass rtoRate only for incomplete days — completed days have no pending orders anyway
    const { revenue, cogs: orderCogs, pnl } = calcOrderPnl(
      order, adCostPerOrder, rto, shipMap, cogs, overrides,
      isCompleted ? undefined : effectiveRtoRate
    );

    totalRevenue += revenue;
    totalCogs += orderCogs;
    barChartProfit += pnl;

    const isFinal = orderIsFinalStatus(order, rto) || isPaymentPrepaid(order);
    if (isFinal) {
      heatmapProfit += pnl;
      hasHeatmapOrders = true;
    }
  }

  if (orderCount === 0 && adSpend > 0) {
    barChartProfit = -adSpend;
    heatmapProfit = -adSpend;
  } else if (!hasHeatmapOrders && adSpend > 0) {
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
        totalRevenue,
        totalCogs,
      },
    },
    { upsert: true, new: true }
  );
}

export async function backfillDailyPnl(): Promise<{ upserted: number }> {
  const [ordersByDate, rtoSet, shippingMap, adSpendByDate, cogsVersions] = await Promise.all([
    loadOrdersByDate(),
    loadRtoSet(),
    loadShippingMap(),
    loadAdSpendByDate(),
    loadCogsVersions(),
  ]);

  // Compute RTO rate once from full history; reused for every date
  const rtoRate = computeHistoricalRtoRate(ordersByDate, rtoSet);

  // Include both order dates and ad-spend dates
  const allDates = new Set([...ordersByDate.keys(), ...adSpendByDate.keys()]);

  let upserted = 0;
  for (const dateKey of allDates) {
    await recomputePnlForDate(dateKey, ordersByDate, rtoSet, shippingMap, adSpendByDate, cogsVersions, rtoRate);
    upserted++;
  }

  return { upserted };
}
