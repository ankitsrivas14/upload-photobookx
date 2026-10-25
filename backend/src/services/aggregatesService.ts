import {
  orderDateKey,
  readState,
  releaseLease,
  restoreDirty,
  takeDirty,
  writeState,
  isFullRebuildRequested,
  type DirtyTake,
} from '../db/aggregatesDirty';
import {
  DATA_START_DATE as STATS_START,
  buildOrdersByDate as statsOrdersByDate,
  computeOrderStats,
  backfillOrderStats,
} from './orderStatsService';
import {
  DATA_START_DATE as SHIPPING_START,
  buildOrdersByDate as shippingOrdersByDate,
  computeShipping,
  backfillShippingStats,
} from './shippingStatsService';
import {
  DATA_START_DATE as PNL_START,
  loadOrdersByDate as pnlOrdersByDate,
  loadRtoSet,
  loadAdSpendByDate,
  loadCogsVersions,
  computeHistoricalRtoRate,
  computePnl,
  backfillDailyPnl,
} from './dailyPnlService';
import { DATA_START_DATE as ROAS_START, buildRevenueByDate, roasDoc, backfillAllDates } from './roasService';
import { refreshBreakevenSnapshot } from './breakevenService';

/**
 * Daily aggregates (dailyOrderStats, dailyShipping, dailyPnl, dailyRoas) without rebuilding
 * every date on every run.
 *
 * Writers mark the IST dates whose inputs changed (see db/aggregatesDirty.ts); the scheduled
 * jobs recompute only those dates from only those dates' orders. A full rebuild still runs
 * once a night after 02:30 IST, on the first run after this ships, and when a writer that
 * touches every date (COGS edits, imports) asks for one.
 */

const STORE_TZ = 'Asia/Kolkata';
const INCREMENTAL_LEASE_MS = 100 * 1000; // ordersSync times out at 120 s
const FULL_LEASE_MS = 8 * 60 * 1000; // scheduledRefresh times out at 540 s
const NIGHTLY_REBUILD_AFTER = '02:30'; // IST
// Dirty dates closer than this share one created_at range read.
const MAX_RANGE_GAP_DAYS = 3;

function istDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TZ });
}

function istTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: STORE_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** 'YYYY-MM-DD' shifted by whole days. */
export function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Group sorted dates into [from, to] ranges, starting a new range after a gap > maxGapDays. */
export function dateRanges(dateKeys: string[], maxGapDays = MAX_RANGE_GAP_DAYS): Array<[string, string]> {
  const ranges: Array<[string, string]> = [];
  for (const dk of [...new Set(dateKeys)].sort()) {
    const last = ranges[ranges.length - 1];
    if (last && shiftDateKey(last[1], maxGapDays) >= dk) last[1] = dk;
    else ranges.push([dk, dk]);
  }
  return ranges;
}

/**
 * Orders created on the given IST dates (any status; each aggregate applies its own
 * filters), read as a few created_at ranges instead of the whole collection. Each range is
 * padded a day on both sides, since created_at carries an offset, then cut to the exact days.
 */
async function ordersForDates(dateKeys: string[]): Promise<any[]> {
  const { getCreatedBetween } = await import('../db/ordersRepo');
  const wanted = new Set(dateKeys);
  const chunks = await Promise.all(
    dateRanges(dateKeys).map(([from, to]) => getCreatedBetween(shiftDateKey(from, -1), shiftDateKey(to, 2)))
  );
  const byId = new Map<string, any>();
  for (const o of chunks.flat()) {
    const key = orderDateKey(o);
    if (key && wanted.has(key)) byId.set(String(o.id), o);
  }
  return [...byId.values()];
}

/** Every aggregate doc for the given dates, without writing them (the parity check uses this). */
export async function computeDates(dateKeys: string[], opts: { rtoRate?: number } = {}) {
  const dates = [...new Set(dateKeys.filter(Boolean))].sort();
  const orders = await ordersForDates(dates);
  const { getMany } = await import('../db/shippingRepo');
  const [rtoSet, chargeDocs, adSpendMap, cogsVersions] = await Promise.all([
    loadRtoSet(),
    getMany(orders.map((o) => o.name)),
    loadAdSpendByDate(),
    loadCogsVersions(),
  ]);
  const charges = new Map<string, number>();
  for (const [id, doc] of chargeDocs) {
    const charge = doc.shippingCharge ?? 0;
    charges.set(id, charge);
    charges.set(`#${id}`, charge);
  }
  // Before the first full rebuild there is no saved rate: derive it from every order.
  const rtoRate = opts.rtoRate ?? computeHistoricalRtoRate(await pnlOrdersByDate(), rtoSet);

  const [statsByDate, shippingByDate, pnlByDate, revenueByDate] = await Promise.all([
    statsOrdersByDate(orders),
    shippingOrdersByDate(orders),
    pnlOrdersByDate(orders),
    buildRevenueByDate(orders),
  ]);

  return {
    stats: dates
      .filter((d) => d >= STATS_START)
      .map((d) => computeOrderStats(d, statsByDate.get(d) ?? [], rtoSet)),
    // Like the full backfill, only days with fulfilled orders get a shipping doc.
    shipping: dates
      .filter((d) => d >= SHIPPING_START && shippingByDate.has(d))
      .map((d) => computeShipping(d, shippingByDate.get(d) ?? [], charges)),
    pnl: dates
      .filter((d) => d >= PNL_START)
      .map((d) => computePnl(d, pnlByDate.get(d) ?? [], rtoSet, charges, adSpendMap, cogsVersions, rtoRate)),
    roas: dates
      .filter((d) => d >= ROAS_START)
      .map((d) => roasDoc(d, revenueByDate[d] || 0, adSpendMap.get(d) ?? 0)),
  };
}

/**
 * Recompute every daily aggregate for the given IST dates, reading only those dates' orders
 * and charges. P&L reuses the RTO rate saved by the last full rebuild.
 */
export async function recomputeDates(dateKeys: string[], opts: { rtoRate?: number } = {}): Promise<number> {
  const dates = [...new Set(dateKeys.filter(Boolean))];
  if (dates.length === 0) return 0;
  const rtoRate = opts.rtoRate ?? (await readState()).rtoRate;
  const docs = await computeDates(dates, { rtoRate });
  const { dailyOrderStatsStore, dailyShippingStore, dailyPnlStore, dailyRoasStore } = await import(
    '../db/dailyStores'
  );
  await Promise.all([
    dailyOrderStatsStore.bulkSet(docs.stats),
    dailyShippingStore.bulkSet(docs.shipping),
    dailyPnlStore.bulkSet(docs.pnl),
    dailyRoasStore.bulkSet(docs.roas),
  ]);
  return dates.length;
}

async function putBack(take: DirtyTake, reason: string): Promise<void> {
  try {
    await restoreDirty(take, reason);
  } catch (err) {
    console.error(`aggregates: could not restore dirty dates after "${reason}":`, err);
  }
}

/**
 * Recompute the dates marked dirty since the last run. Returns null when it skipped: before
 * the first full rebuild, or while another run holds the lease (the marks stay for later).
 */
export async function processDirtyDates(): Promise<number | null> {
  const state = await readState();
  if (!state.lastFullRebuildDay) return null;
  const take = await takeDirty({ leaseMs: INCREMENTAL_LEASE_MS, full: false });
  if (!take) return null;
  if (take.dates.length === 0) return 0;
  try {
    return await recomputeDates(take.dates, { rtoRate: state.rtoRate });
  } catch (err) {
    await putBack(take, 'incremental recompute failed');
    throw err;
  } finally {
    await releaseLease(take.leaseId);
  }
}

/** True once a night after 02:30 IST, before the first full rebuild, or when one was requested. */
export async function fullRebuildDue(now = new Date()): Promise<boolean> {
  const [state, requested] = await Promise.all([readState(), isFullRebuildRequested()]);
  if (!state.lastFullRebuildDay || requested) return true;
  return state.lastFullRebuildDay < istDateKey(now) && istTime(now) >= NIGHTLY_REBUILD_AFTER;
}

/**
 * Rebuild every date's aggregates from all orders, refresh the breakeven snapshot, and save
 * the RTO rate for incremental runs. Takes the pending marks first, so changes that land
 * mid-rebuild stay marked. Returns null while another run holds the lease.
 */
export async function rebuildAll(now = new Date()): Promise<{ dates: number } | null> {
  const take = await takeDirty({ leaseMs: FULL_LEASE_MS, full: true });
  if (!take) return null;
  try {
    const { upserted } = await backfillOrderStats();
    await backfillShippingStats();
    const { rtoRate } = await backfillDailyPnl();
    await backfillAllDates();
    await refreshBreakevenSnapshot();
    await writeState({ lastFullRebuildAt: now.toISOString(), lastFullRebuildDay: istDateKey(now), rtoRate });
    return { dates: upserted };
  } catch (err) {
    await putBack(take, 'full rebuild failed');
    throw err;
  } finally {
    await releaseLease(take.leaseId);
  }
}
