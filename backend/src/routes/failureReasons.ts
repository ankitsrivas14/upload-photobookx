import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { getFailureReasonsMonth, getFailureReasonsOverview } from '../services/failureReasonsService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/failure-reasons: every month of failed Shiprocket orders (latest first) with its counts and reason
 * groups, and each group's courier wordings across all months.
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await getFailureReasonsOverview()) });
  } catch (error) {
    console.error('Error loading failure reasons:', error);
    res.status(500).json({ success: false, error: 'Failure reasons could not be loaded' });
  }
});

/** GET /api/admin/failure-reasons/:month (YYYY-MM): that month's counts and its failed orders with reasons. */
router.get('/:month', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const month = String(req.params.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(404).json({ success: false, error: 'No such month' });
    return;
  }
  try {
    res.json({ success: true, ...(await getFailureReasonsMonth(month)) });
  } catch (error) {
    console.error(`Error loading failure reasons for ${month}:`, error);
    res.status(500).json({ success: false, error: 'Failure reasons could not be loaded' });
  }
});

export default router;
