import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { AgencySettings } from '../models/AgencySettings';
import { MetaAdPerformance } from '../models/MetaAdPerformance';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/** Tolerant name key so CSV names join to stored names despite case/spacing drift. */
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

/**
 * GET /api/admin/agency
 * Day-by-day performance of the agency's campaigns, straight from the reporting data:
 * for each reporting day, that day's spend / revenue / ROAS per campaign, with campaigns
 * flagged as launched on the first day they appear.
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [allRows, namePrefixes] = await Promise.all([
      MetaAdPerformance.find({ level: 'campaign' }, {
        name: 1, date: 1, spend: 1, roas: 1, purchases: 1,
      }).lean(),
      getNamePrefixes(),
    ]);

    // Only the agency's campaigns, one row per (campaign, day). The same CSV can be
    // uploaded from both the Ads Analysis and Agency pages, which would otherwise
    // double-count that day's spend.
    const rows = Array.from(
      new Map(
        (allRows as any[])
          .filter((r) => r.name && r.date && matchesPrefix(r.name, namePrefixes))
          .map((r) => [`${norm(r.name)}|${r.date}`, r])
      ).values()
    );

    // First day each campaign appears = the day it launched.
    const firstSeen = new Map<string, string>();
    for (const r of rows as any[]) {
      const k = norm(r.name);
      const prev = firstSeen.get(k);
      if (!prev || r.date < prev) firstSeen.set(k, r.date);
    }

    // Group by reporting day. Revenue is derived per row as spend x roas, so a day's
    // blended ROAS is spend-weighted rather than an average of campaign ROAS.
    type DayAgg = {
      dateKey: string; spend: number; revenue: number; purchases: number;
      campaigns: { name: string; spend: number; revenue: number; roas: number; purchases: number; isNew: boolean }[];
    };
    const byDate = new Map<string, DayAgg>();

    for (const r of rows as any[]) {
      if (!byDate.has(r.date)) {
        byDate.set(r.date, { dateKey: r.date, spend: 0, revenue: 0, purchases: 0, campaigns: [] });
      }
      const day = byDate.get(r.date)!;
      const spend = Number(r.spend) || 0;
      const revenue = spend * (Number(r.roas) || 0);
      const purchases = Number(r.purchases) || 0;

      day.spend += spend;
      day.revenue += revenue;
      day.purchases += purchases;
      day.campaigns.push({
        name: r.name,
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: spend > 0 ? Number(((revenue) / spend).toFixed(2)) : 0,
        purchases,
        isNew: firstSeen.get(norm(r.name)) === r.date,
      });
    }

    const days = Array.from(byDate.values())
      .map((d) => ({
        dateKey: d.dateKey,
        spend: Math.round(d.spend),
        revenue: Math.round(d.revenue),
        roas: d.spend > 0 ? Number((d.revenue / d.spend).toFixed(2)) : 0,
        purchases: d.purchases,
        launched: d.campaigns.filter((c) => c.isNew).length,
        campaigns: d.campaigns.sort((a, b) => b.spend - a.spend),
      }))
      .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)); // newest first for the table

    const totalSpend = days.reduce((s, d) => s + d.spend, 0);
    const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);

    res.json({
      success: true,
      namePrefixes,
      days,
      totals: {
        spend: totalSpend,
        revenue: totalRevenue,
        roas: totalSpend > 0 ? Number((totalRevenue / totalSpend).toFixed(2)) : 0,
        purchases: days.reduce((s, d) => s + d.purchases, 0),
        campaigns: firstSeen.size,
        days: days.length,
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

/**
 * POST /api/admin/agency/import
 * Import a day's Meta Campaigns CSV (parsed client-side). Stores that day's performance
 * for the agency's campaigns only. Idempotent: rows upsert per (date, campaign), so
 * re-uploading the same file never double-counts.
 *
 * Body: { campaigns: [{ name, date, spend, roas, purchases, ... }] }
 */
router.post('/import', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { campaigns } = req.body as { campaigns?: any[] };
    if (!Array.isArray(campaigns) || campaigns.length === 0) {
      return res.status(400).json({ success: false, error: 'No campaign rows found in the CSV' });
    }

    const allRows = campaigns.filter((r) => r && typeof r.name === 'string' && r.name.trim() && r.date);
    if (allRows.length === 0) {
      return res.status(400).json({ success: false, error: 'CSV had no rows with a campaign name and date' });
    }

    // The export covers the whole account — keep only the agency's campaigns.
    const prefixes = await getNamePrefixes();
    const rows = allRows.filter((r) => matchesPrefix(r.name, prefixes));
    const discarded = new Set(
      allRows.filter((r) => !matchesPrefix(r.name, prefixes)).map((r) => r.name.trim())
    ).size;

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: prefixes.length
          ? `No campaign in this CSV starts with any of your agency prefixes (${prefixes.join(', ')})`
          : 'CSV had no usable campaign rows',
      });
    }

    // Which campaigns are new to us (i.e. launched on this report's day)?
    const names = Array.from(new Set(rows.map((r) => r.name.trim())));
    const known = await MetaAdPerformance.find(
      { level: 'campaign', name: { $in: names } },
      { name: 1 }
    ).lean();
    const knownNames = new Set((known as any[]).map((k) => norm(k.name)));
    const newCampaigns = names.filter((n) => !knownNames.has(norm(n))).length;

    await Promise.all(rows.map((r) =>
      MetaAdPerformance.findOneAndUpdate(
        { date: r.date, level: 'campaign', name: r.name.trim() },
        {
          $set: {
            date: r.date, level: 'campaign', name: r.name.trim(),
            status: r.status || 'active',
            spend: Number(r.spend) || 0,
            purchases: Number(r.purchases) || 0,
            roas: Number(r.roas) || 0,
            impressions: Number(r.impressions) || 0,
            clicks: Number(r.clicks) || 0,
            ctr: Number(r.ctr) || 0,
            cpc: Number(r.cpc) || 0,
            frequency: Number(r.frequency) || 0,
            addsToCart: Number(r.addsToCart) || 0,
          },
        },
        { upsert: true }
      )
    ));

    const dates = Array.from(new Set(rows.map((r) => r.date))).sort();
    res.json({
      success: true,
      rows: rows.length,
      campaigns: names.length,
      newCampaigns,
      discarded,
      dates,
    });
  } catch (error) {
    console.error('Error importing agency campaigns:', error);
    res.status(500).json({ success: false, error: 'Failed to import campaigns CSV' });
  }
});

export default router;
