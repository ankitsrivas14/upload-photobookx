import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { getFreightClaim, getFreightClaims } from '../services/freightClaimsService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/** GET /api/admin/freight-claims: every failed order in the claims pipeline, newest first, with its claim stage. */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await getFreightClaims()) });
  } catch (error) {
    console.error('Error loading freight claims:', error);
    res.status(500).json({ success: false, error: 'Freight claims could not be loaded' });
  }
});

/** GET /api/admin/freight-claims/:order: one order's claim and its conversation with Shiprocket. */
router.get('/:order', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const order = String(req.params.order);
  if (!/^[A-Za-z0-9-]{3,24}$/.test(order)) {
    res.status(404).json({ success: false, error: 'No such order' });
    return;
  }
  try {
    const claim = await getFreightClaim(order);
    if (!claim) {
      res.status(404).json({ success: false, error: `${order} is not in the claims pipeline` });
      return;
    }
    res.json({ success: true, ...claim });
  } catch (error) {
    console.error(`Error loading the freight claim for ${order}:`, error);
    res.status(500).json({ success: false, error: 'The claim could not be loaded' });
  }
});

export default router;
