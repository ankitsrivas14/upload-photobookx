import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { claudeDecisionStore } from '../db/dailyStores';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/claude-analysis/dates
 * Dates that have a Claude ad set review, newest first.
 */
router.get('/dates', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const reviews = await claudeDecisionStore.all();
    const dates = reviews.map((r) => String(r.date)).filter(Boolean).sort().reverse();
    res.json({ success: true, dates });
  } catch (error) {
    console.error('Error fetching Claude analysis dates:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch Claude analysis dates' });
  }
});

/**
 * GET /api/admin/claude-analysis/:date
 * One day's review: each ad set's decision, the reason, the numbers behind it and what was applied.
 */
router.get('/:date', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const date = String(req.params.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Date must be YYYY-MM-DD' });
  }
  try {
    const review = await claudeDecisionStore.get(date);
    if (!review) {
      return res.status(404).json({ success: false, error: `No Claude analysis for ${date}` });
    }
    res.json({ success: true, review });
  } catch (error) {
    console.error('Error fetching Claude analysis:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch Claude analysis' });
  }
});

export default router;
