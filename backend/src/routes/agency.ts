import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { AgencyCampaign } from '../models/AgencyCampaign';
import { AgencySettings } from '../models/AgencySettings';
import { MetaAdPerformance } from '../models/MetaAdPerformance';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/** Tolerant name key so logged names join to Meta names despite case/spacing drift. */
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
 * Returns every logged campaign joined with its Meta performance, plus the configured
 * agency name prefixes.
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [logged, metaRows, namePrefixes] = await Promise.all([
      AgencyCampaign.find().sort({ createdDate: -1, createdAt: -1 }).lean(),
      MetaAdPerformance.find({ level: 'campaign' }, {
        name: 1, date: 1, spend: 1, roas: 1, purchases: 1,
      }).lean(),
      getNamePrefixes(),
    ]);

    // One row per (campaign, day). The same campaign CSV can be uploaded from both the
    // Ads Analysis and Agency pages, which would otherwise double-count that day's spend.
    const uniqueRows = Array.from(
      new Map((metaRows as any[]).map((r) => [`${norm(r.name)}|${r.date}`, r])).values()
    );

    // Aggregate Meta campaign rows by normalized name.
    // Revenue is derived per-day as spend x roas, then re-divided by total spend so the
    // campaign's ROAS is spend-weighted rather than a naive average of daily ROAS.
    type Agg = { spend: number; revenue: number; purchases: number; days: Set<string> };
    const byName = new Map<string, Agg>();
    for (const r of uniqueRows as any[]) {
      const key = norm(r.name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, { spend: 0, revenue: 0, purchases: 0, days: new Set() });
      const a = byName.get(key)!;
      const spend = Number(r.spend) || 0;
      a.spend += spend;
      a.revenue += spend * (Number(r.roas) || 0);
      a.purchases += Number(r.purchases) || 0;
      if (r.date) a.days.add(r.date);
    }

    const campaigns = (logged as any[]).map((c) => {
      const agg = byName.get(norm(c.name));
      const spend = agg?.spend ?? 0;
      const revenue = agg?.revenue ?? 0;
      return {
        _id: c._id,
        name: c.name,
        createdDate: c.createdDate,
        notes: c.notes || '',
        matched: !!agg,
        // Logged before the prefixes were configured / prefixes changed since
        matchesPrefix: matchesPrefix(c.name, namePrefixes),
        spend: Math.round(spend),
        revenue: Math.round(revenue),
        roas: spend > 0 ? Number((revenue / spend).toFixed(2)) : 0,
        purchases: agg?.purchases ?? 0,
        activeDays: agg ? agg.days.size : 0,
      };
    });

    res.json({ success: true, campaigns, namePrefixes });
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
 * POST /api/admin/agency/prune
 * Remove logged campaigns whose name doesn't start with any configured prefix —
 * for cleaning up campaigns imported before the prefixes were set.
 */
router.post('/prune', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const prefixes = await getNamePrefixes();
    if (prefixes.length === 0) {
      return res.status(400).json({ success: false, error: 'Add at least one campaign name prefix first' });
    }
    const logged = await AgencyCampaign.find({}, { name: 1 }).lean();
    const strayIds = (logged as any[])
      .filter((c) => !matchesPrefix(c.name, prefixes))
      .map((c) => c._id);

    if (strayIds.length > 0) await AgencyCampaign.deleteMany({ _id: { $in: strayIds } });
    res.json({ success: true, removed: strayIds.length });
  } catch (error) {
    console.error('Error pruning agency campaigns:', error);
    res.status(500).json({ success: false, error: 'Failed to remove non-matching campaigns' });
  }
});

/**
 * POST /api/admin/agency/import
 * Import a Meta Campaigns CSV (parsed client-side) — logs any new campaigns and stores
 * their performance. Idempotent: performance rows are upserted per (date, campaign) and
 * already-logged campaigns are left untouched, so re-uploading the same file is safe.
 *
 * Body: { campaigns: [{ name, date, spend, roas, purchases, status?, ... }] }
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
    const discardedNames = new Set(
      allRows.filter((r) => !matchesPrefix(r.name, prefixes)).map((r) => r.name.trim())
    );
    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: prefixes.length
          ? `No campaign in this CSV starts with any of your agency prefixes (${prefixes.join(', ')})`
          : 'CSV had no usable campaign rows',
      });
    }

    // 1. Upsert this file's performance rows (idempotent per campaign+day).
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

    // 2. Launch date = the earliest reporting date the campaign appears on, across ALL
    //    uploads (not just this file). With day-wise CSVs, the first day a campaign shows
    //    up in a report is the day it launched.
    const names = Array.from(new Set(rows.map((r) => r.name.trim())));
    const history = await MetaAdPerformance.find(
      { level: 'campaign', name: { $in: names } },
      { name: 1, date: 1 }
    ).lean();
    const firstSeen = new Map<string, string>();
    for (const h of history as any[]) {
      const k = norm(h.name);
      const prev = firstSeen.get(k);
      if (!prev || h.date < prev) firstSeen.set(k, h.date);
    }

    // 3. Log campaigns we haven't logged yet. Existing entries are never re-dated, so a
    //    campaign keeps the launch date from the first report it ever appeared in.
    const existing = await AgencyCampaign.find({}, { name: 1 }).lean();
    const alreadyLogged = new Set((existing as any[]).map((c) => norm(c.name)));

    let imported = 0;
    let skipped = 0;
    const toCreate: any[] = [];

    for (const name of names) {
      const key = norm(name);
      if (alreadyLogged.has(key)) { skipped++; continue; }

      const seen = firstSeen.get(key);
      toCreate.push({
        name, // stored verbatim
        createdDate: seen ? new Date(`${seen}T12:00:00Z`) : new Date(),
      });
      alreadyLogged.add(key);
      imported++;
    }

    if (toCreate.length > 0) await AgencyCampaign.insertMany(toCreate);

    res.json({
      success: true,
      imported,
      skipped,
      rows: rows.length,
      discarded: discardedNames.size,
    });
  } catch (error) {
    console.error('Error importing agency campaigns:', error);
    res.status(500).json({ success: false, error: 'Failed to import campaigns CSV' });
  }
});

/**
 * DELETE /api/admin/agency/campaigns/:id
 */
router.delete('/campaigns/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await AgencyCampaign.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting agency campaign:', error);
    res.status(500).json({ success: false, error: 'Failed to delete campaign' });
  }
});

export default router;
