import ShopifyOrderCache from '../models/ShopifyOrderCache';
import { DailyAdSpend } from '../models/DailyAdSpend';
import { DailyROAS } from '../models/DailyROAS';

const STORE_TIMEZONE = 'Asia/Kolkata';
const DATA_START_DATE = '2026-01-28';

function toDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

/** Aggregate all Firestore orders into a revenue map keyed by dateKey */
async function buildRevenueByDate(): Promise<Record<string, number>> {
  const { getAll } = await import('../db/ordersRepo');
  const orders = await getAll();
  const revenueByDate: Record<string, number> = {};
  for (const order of orders) {
    if (order.cancelled_at) continue;
    const dateKey = toDateKey(new Date(order.created_at));
    if (dateKey < DATA_START_DATE) continue;
    // current_total_price (reflects edits/discounts) falling back to total_price
    const price = parseFloat(order.current_total_price ?? order.total_price ?? '0') || 0;
    revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + price;
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

  const { dailyRoasStore } = await import('../db/dailyStores');
  await dailyRoasStore.set({ dateKey, revenue, adSpend, roas });
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
 *
 * On Cloud Functions (Cloud Run sets `K_SERVICE`) this is a no-op: background work
 * kicked off after the HTTP response isn't guaranteed to finish, so freshness there is
 * owned by the scheduled `roasRecompute` function (see scheduled.ts), which runs the same
 * `backfillAllDates()` on a fixed interval. On the local/Render server (`K_SERVICE` unset)
 * this in-process fast path still runs and keeps ROAS near-instant.
 */
export function scheduleRoasRecompute(reason: string): void {
  if (process.env.K_SERVICE) return; // handled by the scheduled function on Cloud Functions
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
