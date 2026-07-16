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

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

// Matches a "<day> <month> [year]" stamp anywhere in a campaign name, e.g.
// "23 April - JL - Mothers Day Song 1" or "S | 12 Jyotirlinga Photobook | 18 June 26 | Fx Retina".
// The name itself is never modified — this only reads the launch date out of it.
const NAME_DATE_RE = /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(\d{4}|\d{2}))?/i;

/** Read a launch date out of a campaign name. Returns null when the name carries no date. */
export function parseLaunchDateFromName(name: string, reference: Date): Date | null {
  const m = NAME_DATE_RE.exec(name || '');
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = MONTHS[m[2].toLowerCase()];
  if (month === undefined || day < 1 || day > 31) return null;

  let year: number;
  if (m[3]) {
    const y = parseInt(m[3], 10);
    year = m[3].length === 2 ? 2000 + y : y;
  } else {
    // No year in the name: assume the report's year, unless that lands in the
    // future relative to the report (then it must be last year's campaign).
    year = reference.getUTCFullYear();
    const candidate = Date.UTC(year, month, day, 12);
    if (candidate > reference.getTime() + 24 * 60 * 60 * 1000) year -= 1;
  }
  const d = new Date(Date.UTC(year, month, day, 12));
  if (isNaN(d.getTime()) || d.getUTCDate() !== day || d.getUTCMonth() !== month) return null; // e.g. 31 Feb
  return d;
}

/**
 * GET /api/admin/agency
 * Returns every logged campaign joined with its Meta performance, plus the list of
 * campaign names seen in the uploaded data (for the add-form's autocomplete).
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

    // Distinct campaign names from uploaded data, for the add-form datalist
    const availableCampaigns = Array.from(
      new Map((metaRows as any[]).map((r) => [norm(r.name), r.name])).values()
    ).filter(Boolean).sort();

    res.json({ success: true, campaigns, availableCampaigns, namePrefixes });
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
 * POST /api/admin/agency/campaigns — log a campaign the agency created
 */
router.post('/campaigns', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, createdDate, notes } = req.body as { name?: string; createdDate?: string; notes?: string };
    if (!name || !name.trim() || !createdDate) {
      return res.status(400).json({ success: false, error: 'name and createdDate are required' });
    }
    const parsed = new Date(createdDate);
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid createdDate' });
    }
    const campaign = await AgencyCampaign.create({
      name: name.trim(),
      createdDate: parsed,
      notes: notes?.trim() || '',
    });
    res.status(201).json({ success: true, campaign });
  } catch (error) {
    console.error('Error logging agency campaign:', error);
    res.status(500).json({ success: false, error: 'Failed to log campaign' });
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

    // 2. Earliest reporting date per campaign, across ALL uploads (not just this file) —
    //    the fallback launch date for names that carry no date.
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

    // 3. Log campaigns we haven't logged yet. Existing entries are never overwritten,
    //    so manual date corrections survive re-imports.
    const existing = await AgencyCampaign.find({}, { name: 1 }).lean();
    const alreadyLogged = new Set((existing as any[]).map((c) => norm(c.name)));

    let imported = 0;
    let skipped = 0;
    let datedFromName = 0;
    const toCreate: any[] = [];

    for (const name of names) {
      const key = norm(name);
      if (alreadyLogged.has(key)) { skipped++; continue; }

      const seen = firstSeen.get(key);
      const reference = seen ? new Date(`${seen}T12:00:00Z`) : new Date();
      const fromName = parseLaunchDateFromName(name, reference);
      if (fromName) datedFromName++;

      toCreate.push({
        name, // stored verbatim — the date is only read out of it, never stripped
        createdDate: fromName ?? reference,
        notes: fromName ? '' : 'Launch date inferred from first reporting date (no date in campaign name)',
      });
      alreadyLogged.add(key);
      imported++;
    }

    if (toCreate.length > 0) await AgencyCampaign.insertMany(toCreate);

    res.json({
      success: true,
      imported,
      skipped,
      datedFromName,
      datedFromFirstSeen: imported - datedFromName,
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
