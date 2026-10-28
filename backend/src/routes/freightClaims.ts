import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { getFreightClaim, getFreightClaims, markClaimRefunded } from '../services/freightClaimsService';
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

/**
 * POST /api/admin/freight-claims/:order/refund { amount, date: YYYY-MM-DD, note? }: closes the claim as refunded,
 * with the amount and day you found the credit in the Shiprocket wallet.
 */
router.post('/:order/refund', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const order = String(req.params.order);
  const amount = Number(req.body?.amount);
  const date = String(req.body?.date ?? '');
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 500) : null;
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  if (!/^[A-Za-z0-9-]{3,24}$/.test(order)) {
    res.status(404).json({ success: false, error: 'No such order' });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
    res.status(400).json({ success: false, error: 'Enter the refunded amount in rupees' });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) {
    res.status(400).json({ success: false, error: 'Enter the day the refund was credited (not in the future)' });
    return;
  }
  try {
    const claim = await markClaimRefunded(order, { amount, date, note }, req.user?.email ?? 'admin');
    if (!claim) {
      res.status(404).json({ success: false, error: `${order} is not in the claims pipeline` });
      return;
    }
    res.json({ success: true, ...claim });
  } catch (error) {
    console.error(`Error marking ${order} refunded:`, error);
    res.status(500).json({ success: false, error: 'The refund could not be saved' });
  }
});

export default router;
