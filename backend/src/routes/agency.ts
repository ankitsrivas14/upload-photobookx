import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { AgencySettings } from '../models/AgencySettings';
import { MetaAdPerformance } from '../models/MetaAdPerformance';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/** Tolerant name key so names group despite case/spacing drift. */
const norm = (n: any) => (typeof n === 'string' ? n.trim().toLowerCase().replace(/\s+/g, ' ') : '');

/** The configured agency name prefixes ([] when unset = no filtering). */
async function getNamePrefixes(): Promise<string[]> {
  const s = await AgencySettings.findOne({ key: 'default' }).lean();
  return ((s as any)?.namePrefixes ?? []).filter((p: string) => !!p && p.trim());
}

/**
 * A campaign belongs to the agency when its name starts with any configured prefix.
 * With no prefixes configured we keep everything, so the page still works before setup.
 */
function matchesPrefix(name: string, prefixes: string[]): boolean {
  if (prefixes.length === 0) return true;
  const n = norm(name);
  return prefixes.some((p) => n.startsWith(norm(p)));
}

/** Net totals for a bucket of (campaign, day) rows — used for the agency vs non-agency compare. */
function bucketTotals(rows: any[]) {
  const names = new Set<string>();
  const days = new Set<string>();
  let spend = 0;
  let revenue = 0;
  let purchases = 0;

  for (const r of rows) {
    names.add(norm(r.name));
    if (r.date) days.add(r.date);
    const s = Number(r.spend) || 0;
    spend += s;
    // Revenue per day = spend x that day's ROAS, so blended ROAS stays spend-weighted.
    revenue += s * (Number(r.roas) || 0);
    purchases += Number(r.purchases) || 0;
  }

  return {
    campaigns: names.size,
    days: days.size,
    spend: Math.round(spend),
    revenue: Math.round(revenue),
    roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
    purchases,
    cpa: purchases > 0 ? Math.round(spend / purchases) : 0,
  };
}

/** Inclusive list of YYYY-MM-DD keys from start to end. Noon-UTC anchored; IST has no DST. */
function eachDay(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  // Guard against a malformed range producing a runaway loop
  let guard = 0;
  while (cursor <= last && guard++ < 2000) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * GET /api/admin/agency
 * Campaign-by-campaign breakdown of the agency's campaigns, derived from the campaign
 * data uploaded on the Ads Analysis page. Each campaign carries a daily series running
 * from its first day to its last (or to the latest data we have, if it's still running).
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [allRows, namePrefixes] = await Promise.all([
      MetaAdPerformance.find({ level: 'campaign' }, {
        name: 1, date: 1, spend: 1, roas: 1, purchases: 1,
      }).lean(),
      getNamePrefixes(),
    ]);

    // One row per (campaign, day) — the Ads Analysis upload inserts rather than
    // upserts, so the same day can appear more than once.
    const deduped = Array.from(
      new Map(
        (allRows as any[])
          .filter((r) => r.name && r.date)
          .map((r) => [`${norm(r.name)}|${r.date}`, r])
      ).values()
    ) as any[];

    const rows = deduped.filter((r) => matchesPrefix(r.name, namePrefixes));
    const nonAgencyRows = deduped.filter((r) => !matchesPrefix(r.name, namePrefixes));

    // Latest day we have any agency data for — a campaign still reporting on it is live.
    const latestDate = rows.reduce((m: string, r: any) => (!m || r.date > m ? r.date : m), '');

    type Point = { spend: number; revenue: number; purchases: number };
    const byCampaign = new Map<string, { name: string; days: Map<string, Point> }>();

    for (const r of rows) {
      const key = norm(r.name);
      if (!byCampaign.has(key)) byCampaign.set(key, { name: r.name, days: new Map() });
      const c = byCampaign.get(key)!;
      const spend = Number(r.spend) || 0;
      c.days.set(r.date, {
        spend,
        // Revenue per day = spend x that day's ROAS, so totals stay spend-weighted.
        revenue: spend * (Number(r.roas) || 0),
        purchases: Number(r.purchases) || 0,
      });
    }

    const campaigns = Array.from(byCampaign.values()).map((c) => {
      const dates = Array.from(c.days.keys()).sort();
      const startDate = dates[0];
      const endDate = dates[dates.length - 1];

      // Continuous timeline start → end so paused days show as gaps rather than
      // collapsing the chart into a misleading straight line.
      const daily = eachDay(startDate, endDate).map((dateKey) => {
        const p = c.days.get(dateKey);
        const spend = p?.spend ?? 0;
        const revenue = p?.revenue ?? 0;
        return {
          dateKey,
          spend: Math.round(spend),
          revenue: Math.round(revenue),
          roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
          purchases: p?.purchases ?? 0,
        };
      });

      const spend = daily.reduce((s, d) => s + d.spend, 0);
      const revenue = daily.reduce((s, d) => s + d.revenue, 0);

      return {
        name: c.name,
        startDate,
        endDate,
        isRunning: endDate === latestDate,
        activeDays: dates.length,          // days it actually reported
        spanDays: daily.length,            // calendar days start → end
        spend,
        revenue,
        roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
        purchases: daily.reduce((s, d) => s + d.purchases, 0),
        daily,
      };
    }).sort((a, b) => (a.startDate < b.startDate ? 1 : a.startDate > b.startDate ? -1 : b.spend - a.spend));

    const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
    const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0);

    res.json({
      success: true,
      namePrefixes,
      latestDate,
      campaigns,
      // Agency vs everything else in the account. Meaningless until prefixes exist,
      // since without them every campaign counts as the agency's.
      comparison: {
        prefixesConfigured: namePrefixes.length > 0,
        agency: bucketTotals(rows),
        nonAgency: bucketTotals(nonAgencyRows),
      },
      totals: {
        campaigns: campaigns.length,
        running: campaigns.filter((c) => c.isRunning).length,
        spend: totalSpend,
        revenue: totalRevenue,
        roas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
        purchases: campaigns.reduce((s, c) => s + c.purchases, 0),
      },
    });
  } catch (error) {
    console.error('Error fetching agency data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agency data' });
  }
});

/**
 * PUT /api/admin/agency/settings — replace the agency's campaign name prefixes
 * Body: { namePrefixes: string[] }
 */
router.put('/settings', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { namePrefixes } = req.body as { namePrefixes?: unknown };
    if (!Array.isArray(namePrefixes) || namePrefixes.some((p) => typeof p !== 'string')) {
      return res.status(400).json({ success: false, error: 'namePrefixes must be an array of strings' });
    }
    // Trim, drop blanks, de-dupe case-insensitively while keeping the entered casing
    const cleaned = Array.from(
      new Map(
        (namePrefixes as string[])
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => [p.toLowerCase(), p])
      ).values()
    );

    const settings = await AgencySettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { key: 'default', namePrefixes: cleaned } },
      { upsert: true, new: true }
    ).lean();

    res.json({ success: true, namePrefixes: (settings as any).namePrefixes });
  } catch (error) {
    console.error('Error saving agency settings:', error);
    res.status(500).json({ success: false, error: 'Failed to save settings' });
  }
});

export default router;
