import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { AgencyCampaign } from '../models/AgencyCampaign';
import { MetaAdPerformance } from '../models/MetaAdPerformance';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/** Tolerant name key so logged names join to Meta names despite case/spacing drift. */
const norm = (n: any) => (typeof n === 'string' ? n.trim().toLowerCase().replace(/\s+/g, ' ') : '');

/**
 * GET /api/admin/agency
 * Returns every logged campaign joined with its Meta performance, plus the list of
 * campaign names seen in the uploaded data (for the add-form's autocomplete).
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [logged, metaRows] = await Promise.all([
      AgencyCampaign.find().sort({ createdDate: -1, createdAt: -1 }).lean(),
      MetaAdPerformance.find({ level: 'campaign' }, {
        name: 1, date: 1, spend: 1, roas: 1, purchases: 1,
      }).lean(),
    ]);

    // Aggregate Meta campaign rows by normalized name.
    // Revenue is derived per-day as spend x roas, then re-divided by total spend so the
    // campaign's ROAS is spend-weighted rather than a naive average of daily ROAS.
    type Agg = { spend: number; revenue: number; purchases: number; days: Set<string> };
    const byName = new Map<string, Agg>();
    for (const r of metaRows as any[]) {
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

    res.json({ success: true, campaigns, availableCampaigns });
  } catch (error) {
    console.error('Error fetching agency data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch agency data' });
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
