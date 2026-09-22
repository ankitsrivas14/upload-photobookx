import { keyedStore } from './keyedStore';

/**
 * Firestore stores for the pre-computed daily aggregate docs the dashboard reads,
 * keyed by dateKey ('YYYY-MM-DD'). Written by the *StatsService backfills, read by
 * the dashboard routes. Replaces the equivalent Mongo collections.
 */
export const dailyOrderStatsStore = keyedStore<any>('dailyOrderStats', 'dateKey');
export const dailyPnlStore = keyedStore<any>('dailyPnl', 'dateKey');
export const dailyShippingStore = keyedStore<any>('dailyShipping', 'dateKey');
export const dailyRoasStore = keyedStore<any>('dailyRoas', 'dateKey');

/** Breakeven snapshot singleton (doc id 'latest'). */
export const breakevenStore = keyedStore<any>('breakevenSnapshot', 'key');

/** Read a daily store over an optional [start,end] dateKey range, sorted ascending. */
export async function readDailyRange(
  store: { rangeByField: (f: 'dateKey', s?: string, e?: string) => Promise<any[]> },
  startDate?: string,
  endDate?: string
): Promise<any[]> {
  const rows = await store.rangeByField('dateKey', startDate, endDate);
  return rows.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}
