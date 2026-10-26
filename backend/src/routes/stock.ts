import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { ALERT_DAYS, getStockLevels } from '../services/stockService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/stock: each stocked book's latest shelf count, the books sold since, the pace
 * it sells at and the days of stock left. The admin warns when a book is down to ALERT_DAYS.
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, alertDays: ALERT_DAYS, items: await getStockLevels() });
  } catch (error) {
    console.error('Stock levels error:', error);
    res.status(500).json({ success: false, error: 'Failed to load the stock levels' });
  }
});

export default router;
