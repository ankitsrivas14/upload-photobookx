import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { campaignDays } from '../services/metaInsightsService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/** The whole ad account over one week or one month. */
export interface CpaPeriod {
  /** The period's first day: a Monday, or the 1st of the month (YYYY-MM-DD). */
  start: string;
  spend: number;
  purchases: number;
  /** Spend per purchase in rupees; null when the period has no spend or no purchases. */
  cpa: number | null;
}

const DAY_MS = 86_400_000;
const toKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const keyMs = (key: string) => Date.parse(key + 'T00:00:00Z');

/** The Monday on or before a date. */
export const weekOf = (key: string) => toKey(keyMs(key) - ((new Date(keyMs(key)).getUTCDay() + 6) % 7) * DAY_MS);
const monthOf = (key: string) => key.slice(0, 7) + '-01';
const nextWeek = (start: string) => toKey(keyMs(start) + 7 * DAY_MS);
const nextMonth = (start: string) => {
  const d = new Date(keyMs(start));
  return toKey(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
};

/**
 * Spend, purchases and CPA per period from the first day with data to the last. Periods without
 * spend stay in (a paused stretch shows as a gap), so a chart's time axis runs evenly.
 */
export function cpaByPeriod(
  days: Array<{ date: string; spend: number; purchases: number }>,
  periodOf: (key: string) => string,
  next: (start: string) => string
): CpaPeriod[] {
  if (!days.length) return [];
  const totals = new Map<string, { spend: number; purchases: number }>();
  let first = days[0].date;
  let last = days[0].date;
  for (const d of days) {
    const p = periodOf(d.date);
    const t = totals.get(p) ?? { spend: 0, purchases: 0 };
    t.spend += d.spend || 0;
    t.purchases += d.purchases || 0;
    totals.set(p, t);
    if (d.date < first) first = d.date;
    if (d.date > last) last = d.date;
  }
  const out: CpaPeriod[] = [];
  for (let p = periodOf(first); p <= periodOf(last); p = next(p)) {
    const t = totals.get(p) ?? { spend: 0, purchases: 0 };
    const spend = Math.round(t.spend);
    out.push({
      start: p,
      spend,
      purchases: t.purchases,
      // A purchase Meta attributes late to a day without spend has no cost to divide.
      cpa: spend > 0 && t.purchases > 0 ? Math.round(t.spend / t.purchases) : null,
    });
  }
  return out;
}

/**
 * GET /api/admin/meta/cpa: the ad account's cost per purchase by Monday-to-Sunday week and by
 * calendar month, across all campaigns. It reads the insights the hourly adSpendSync keeps in
 * metaInsightsDaily (purchases as Ads Manager's Purchases column counts them), so it makes no call
 * to Meta.
 */
router.get('/cpa', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const days = await campaignDays();
    const dates = days.map((d) => d.date).sort();
    res.json({
      success: true,
      firstDate: dates[0] ?? null,
      latestDate: dates[dates.length - 1] ?? null,
      weeks: cpaByPeriod(days, weekOf, nextWeek),
      months: cpaByPeriod(days, monthOf, nextMonth),
    });
  } catch (error) {
    console.error('Meta CPA error:', error);
    res.status(500).json({ success: false, error: 'Failed to load the Meta CPA figures' });
  }
});

export default router;
