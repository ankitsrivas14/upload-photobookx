import {
  detectVariant,
  getCogsVersionForDate,
  isPaymentPrepaid,
  loadCogsVersions,
  orderIsDelivered,
  orderIsFailed,
  sumCategoryFields,
  type CogsVersion,
  type ValueKey,
} from './dailyPnlService';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-28';
/**
 * Settled orders from this many days back set the breakeven: a long enough run of orders that an
 * ad pause or a quiet month doesn't swing it (30 days once left it on 24 orders).
 */
const WINDOW_DAYS = 90;

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

export interface BreakevenMetrics {
  /** Delivered revenue per settled order: a failed order counts ₹0. */
  aov: number;
  /** Every settled order at its own price, per settled order, as Meta's ROAS counts revenue. */
  orderValue: number;
  avgCOGS: number;
  avgShipping: number;
  avgTotalCost: number;
  contributionMargin: number;
  /** ROAS on delivered revenue at which ads break even: the basis of the Dashboard's ROAS. */
  breakevenROAS: number;
  /** ROAS on every order's value at which ads break even: the basis of Ads Manager's ROAS. */
  breakevenMetaROAS: number;
  deliveredCount: number;
  failedCount: number;
  totalOrders: number;
  windowDays: number;
  /** First order date in the window (YYYY-MM-DD). */
  since: string;
}

const price = (order: any) => parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;

/**
 * What a settled order costs before ads, as the daily P&L costs it. A delivered order takes its
 * COGS fields, or the COGS page's total override for a category, from the version in force on its
 * date. A failed order takes its NDR fields only, without any override: a returned book is resold,
 * so its production cost isn't lost. Shipping (forward, COD and RTO freight) is counted apart.
 */
function orderCost(
  order: any,
  dateKey: string,
  delivered: boolean,
  versions: CogsVersion[],
  shippingMap: Map<string, number>
): { cogs: number; shipping: number } {
  const version = getCogsVersionForDate(dateKey, versions);
  const fields: any[] = version?.fields ?? [];
  const key = `${detectVariant(order)}${isPaymentPrepaid(order) ? 'Prepaid' : 'COD'}Value` as ValueKey;
  let cogs = 0;
  if (delivered) {
    const cogsFields = fields.filter((f) => f.type === 'cogs' || f.type === 'both');
    for (const cat of ['pre', 'post'] as const) {
      cogs += version?.totalOverrides?.[cat]?.[key] ?? sumCategoryFields(cogsFields, cat, key, price(order));
    }
  } else {
    const ndrFields = fields.filter((f) => f.type === 'ndr' || f.type === 'both');
    for (const cat of ['pre', 'post'] as const) cogs += sumCategoryFields(ndrFields, cat, key, 0);
  }
  const name: string = (order.name ?? '').replace(/^#/, '');
  return { cogs, shipping: shippingMap.get(name) ?? shippingMap.get(`#${name}`) ?? 0 };
}

/**
 * The ad-free economics of an order and the ROAS at which ads break even, from the settled orders
 * (delivered or failed) of the last WINDOW_DAYS. Two breakevens, one per way of counting revenue:
 * breakevenROAS on delivered revenue (the Dashboard's ROAS), breakevenMetaROAS on every order's
 * value (Ads Manager's ROAS, which also counts the purchases that later fail).
 */
export async function computeBreakevenMetrics(now = new Date()): Promise<BreakevenMetrics> {
  const endKey = toDateKey(now);
  const start = new Date(now);
  start.setDate(start.getDate() - WINDOW_DAYS);
  const since = toDateKey(start) < DATA_START_DATE ? DATA_START_DATE : toDateKey(start);

  const { getAll } = await import('../db/ordersRepo');
  const { getAllAsMap } = await import('../db/shippingRepo');
  const { rtoStore, idSet } = await import('../db/orderListStores');
  const [rtoSet, shippingMap, versions, allOrders] = await Promise.all([
    idSet(rtoStore),
    getAllAsMap(),
    loadCogsVersions(),
    getAll(),
  ]);

  let revenue = 0;
  let value = 0;
  let totalCOGS = 0;
  let totalShipping = 0;
  let deliveredCount = 0;
  let failedCount = 0;

  for (const order of allOrders) {
    if (order.cancelled_at) continue;
    const dateKey = toDateKey(new Date(order.created_at));
    if (dateKey < since || dateKey > endKey) continue;
    const delivered = orderIsDelivered(order, rtoSet);
    // Orders still on their way aren't settled yet; they join once delivered or failed.
    if (!delivered && !orderIsFailed(order, rtoSet)) continue;

    if (delivered) {
      deliveredCount++;
      revenue += price(order);
    } else {
      failedCount++;
    }
    value += price(order);
    const cost = orderCost(order, dateKey, delivered, versions, shippingMap);
    totalCOGS += cost.cogs;
    totalShipping += cost.shipping;
  }

  const totalOrders = deliveredCount + failedCount;
  const per = (n: number) => (totalOrders > 0 ? n / totalOrders : 0);
  const aov = per(revenue);
  const orderValue = per(value);
  const avgCOGS = per(totalCOGS);
  const avgShipping = per(totalShipping);
  const avgTotalCost = avgCOGS + avgShipping;
  const contributionMargin = aov - avgTotalCost;
  const breakevenROAS = contributionMargin > 0 ? aov / contributionMargin : 0;
  const breakevenMetaROAS = contributionMargin > 0 ? orderValue / contributionMargin : 0;

  return {
    aov,
    orderValue,
    avgCOGS,
    avgShipping,
    avgTotalCost,
    contributionMargin,
    breakevenROAS,
    breakevenMetaROAS,
    deliveredCount,
    failedCount,
    totalOrders,
    windowDays: WINDOW_DAYS,
    since,
  };
}

/**
 * Compute the breakeven metrics (scans the order cache — off the request path) and
 * store them in the singleton snapshot the dashboard endpoint reads.
 */
export async function refreshBreakevenSnapshot(): Promise<BreakevenMetrics> {
  const metrics = await computeBreakevenMetrics();
  const { breakevenStore } = await import('../db/dailyStores');
  await breakevenStore.set({ key: 'latest', metrics });
  return metrics;
}
