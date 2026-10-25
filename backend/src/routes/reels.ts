import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { reelStore, reelStrategyStore } from '../db/featureStores';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/reels
 * Returns everything needed to render the Reels × Strategies matrix.
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const time = (v: any) => new Date(v || 0).getTime();
    const [reels, strategies] = await Promise.all([
      reelStore.all().then((rs) => rs.sort((a, b) => time(b.date) - time(a.date) || time(b.createdAt) - time(a.createdAt))),
      reelStrategyStore.all().then((ss) => ss.sort((a, b) => time(a.createdAt) - time(b.createdAt))),
    ]);
    res.json({ success: true, reels, strategies });
  } catch (error) {
    console.error('Error fetching reels data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch reels data' });
  }
});

/**
 * POST /api/admin/reels/reels  — create a reel
 */
router.post('/reels', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, url, date } = req.body as { name?: string; url?: string; date?: string };
    if (!name || !name.trim() || !url || !url.trim() || !date) {
      return res.status(400).json({ success: false, error: 'name, url and date are required' });
    }
    const parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date' });
    }
    const now = new Date();
    const reel = await reelStore.create({
      name: name.trim(),
      url: url.trim(),
      date: parsedDate,
      strategyIds: [],
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, reel });
  } catch (error) {
    console.error('Error creating reel:', error);
    res.status(500).json({ success: false, error: 'Failed to create reel' });
  }
});

/**
 * DELETE /api/admin/reels/reels/:id  — delete a reel
 */
router.delete('/reels/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await reelStore.deleteById(String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting reel:', error);
    res.status(500).json({ success: false, error: 'Failed to delete reel' });
  }
});

/**
 * POST /api/admin/reels/strategies  — create a strategy (column)
 */
router.post('/strategies', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name } = req.body as { name?: string };
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }
    const now = new Date();
    const strategy = await reelStrategyStore.create({ name: name.trim(), createdAt: now, updatedAt: now });
    res.status(201).json({ success: true, strategy });
  } catch (error) {
    console.error('Error creating strategy:', error);
    res.status(500).json({ success: false, error: 'Failed to create strategy' });
  }
});

/**
 * DELETE /api/admin/reels/strategies/:id  — delete a strategy and clear it from every reel
 */
router.delete('/strategies/:id', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    await reelStrategyStore.deleteById(String(id));
    await reelStore.removeFromArrays('strategyIds', String(id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting strategy:', error);
    res.status(500).json({ success: false, error: 'Failed to delete strategy' });
  }
});

/**
 * PUT /api/admin/reels/reels/:reelId/strategies/:strategyId  — tick/untick a cell
 * Body: { marked: boolean }
 */
router.put('/reels/:reelId/strategies/:strategyId', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { reelId, strategyId } = req.params;
    const { marked } = req.body as { marked?: boolean };
    const reel = await reelStore.updateArray(String(reelId), 'strategyIds', String(strategyId), marked ? 'add' : 'remove');
    if (!reel) {
      return res.status(404).json({ success: false, error: 'Reel not found' });
    }
    res.json({ success: true, reel });
  } catch (error) {
    console.error('Error toggling reel strategy:', error);
    res.status(500).json({ success: false, error: 'Failed to update cell' });
  }
});

export default router;
