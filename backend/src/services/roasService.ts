import ShopifyOrderCache from '../models/ShopifyOrderCache';
import { DailyAdSpend } from '../models/DailyAdSpend';
import { DailyROAS } from '../models/DailyROAS';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-28';

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

/** Aggregate all orders from all ShopifyOrderCache entries into a revenue map keyed by dateKey */
async function buildRevenueByDate(): Promise<Record<string, number>> {
  const cacheEntries = await ShopifyOrderCache.find(
    { cacheKey: { $regex: /^all_orders_/ } },
    { orders: 1 }
  ).lean();

  const revenueByDate: Record<string, number> = {};

  // Merge orders from all matching cache entries (deduplicate by order id)
  const seenIds = new Set<number | string>();
  for (const entry of cacheEntries) {
    for (const order of entry.orders as any[]) {
      if (order.cancelled_at) continue;
      const id = order.id;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);

      const dateKey = toDateKey(new Date(order.created_at));
      if (dateKey < DATA_START_DATE) continue;
      // Use current_total_price (reflects edits/discounts) falling back to total_price — same as dailyPnlService
      const price = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
      revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + price;
    }
  }

  return revenueByDate;
}

/** Aggregate DailyAdSpend into a map keyed by dateKey */
async function buildAdSpendByDate(): Promise<Record<string, number>> {
  const entries = await DailyAdSpend.find({}, { date: 1, amount: 1 }).lean();
  const adSpendByDate: Record<string, number> = {};
  for (const entry of entries as any[]) {
    const dateKey = toDateKey(new Date(entry.date));
    adSpendByDate[dateKey] = (adSpendByDate[dateKey] || 0) + entry.amount;
  }
  return adSpendByDate;
}

/**
 * Recompute and upsert the DailyROAS record for a single dateKey.
 * Pass in pre-built maps to avoid N+1 DB fetches when backfilling.
 */
export async function recomputeForDate(
  dateKey: string,
  revenueByDate?: Record<string, number>,
  adSpendByDate?: Record<string, number>
): Promise<void> {
  const revenue = revenueByDate
    ? (revenueByDate[dateKey] || 0)
    : await getSingleDayRevenue(dateKey);

  const adSpend = adSpendByDate
    ? (adSpendByDate[dateKey] || 0)
    : await getSingleDayAdSpend(dateKey);

  const roas = adSpend > 0 ? revenue / adSpend : null;

  await DailyROAS.findOneAndUpdate(
    { dateKey },
    { $set: { revenue, adSpend, roas } },
    { upsert: true, new: true }
  );
}

async function getSingleDayRevenue(dateKey: string): Promise<number> {
  const revenueByDate = await buildRevenueByDate();
  return revenueByDate[dateKey] || 0;
}

async function getSingleDayAdSpend(dateKey: string): Promise<number> {
  const adSpendByDate = await buildAdSpendByDate();
  return adSpendByDate[dateKey] || 0;
}

// ─── write-path trigger ──────────────────────────────────────────────────────
// DailyROAS has exactly two inputs: the all_orders_* Shopify cache (revenue) and
// DailyAdSpend (spend). Reads never recompute; instead the writers of those two
// inputs call the hooks below, keeping the stored records permanently fresh.

let roasRecomputeInFlight = false;
let roasRecomputeQueued = false;

/**
 * Fire-and-forget full recompute, coalesced: if one is already running, remember
 * to run once more when it finishes (the re-run sees the newest data) instead of
 * stacking parallel recomputes.
 */
export function scheduleRoasRecompute(reason: string): void {
  if (roasRecomputeInFlight) {
    roasRecomputeQueued = true;
    return;
  }
  roasRecomputeInFlight = true;
  (async () => {
    do {
      roasRecomputeQueued = false;
      try {
        const { upserted } = await backfillAllDates();
        console.log(`ROAS recompute (${reason}): ${upserted} dates refreshed`);
      } catch (err) {
        console.error(`ROAS recompute (${reason}) failed:`, err);
      }
    } while (roasRecomputeQueued);
    roasRecomputeInFlight = false;
  })();
}

/**
 * Backfill DailyROAS for all dates that have either ad spend or order revenue.
 * Safe to run multiple times (upserts).
 */
export async function backfillAllDates(): Promise<{ upserted: number }> {
  const [revenueByDate, adSpendByDate] = await Promise.all([
    buildRevenueByDate(),
    buildAdSpendByDate(),
  ]);

  const allDateKeys = new Set([
    ...Object.keys(revenueByDate),
    ...Object.keys(adSpendByDate),
  ]);

  let upserted = 0;
  for (const dateKey of allDateKeys) {
    if (dateKey < DATA_START_DATE) continue;
    await recomputeForDate(dateKey, revenueByDate, adSpendByDate);
    upserted++;
  }

  return { upserted };
}
