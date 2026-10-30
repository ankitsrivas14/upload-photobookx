import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { addToBlacklist, getBlacklist, orderName, removeFromBlacklist } from '../services/codBlacklistService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

const noteOf = (body: any) => (typeof body?.note === 'string' ? body.note.slice(0, 300) : null);

/** GET /api/admin/cod-blacklist: every blacklisted address, active and cleared, and the booking job's last sweep. */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await getBlacklist()) });
  } catch (error) {
    console.error('COD blacklist error:', error);
    res.status(500).json({ success: false, error: 'The COD blacklist could not be loaded' });
  }
});

/**
 * POST /api/admin/cod-blacklist { order, note? }: adds the order's delivery address (read from Shiprocket) by hand.
 * The booking job then holds COD orders to that address; only Remove takes it off.
 */
router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await addToBlacklist(req.body?.order, noteOf(req.body), req.user?.email ?? 'admin');
    if (result.error) {
      res.status(result.status ?? 400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, entry: result.entry });
  } catch (error) {
    console.error('COD blacklist add error:', error);
    res.status(500).json({ success: false, error: 'The order could not be added' });
  }
});

/** POST /api/admin/cod-blacklist/:order/remove { note? }: takes an address off the blacklist. */
router.post('/:order/remove', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const order = orderName(req.params.order);
  if (!order) {
    res.status(404).json({ success: false, error: 'No such order' });
    return;
  }
  try {
    const entry = await removeFromBlacklist(order, noteOf(req.body), req.user?.email ?? 'admin');
    if (!entry) {
      res.status(404).json({ success: false, error: `${order} is not on the blacklist` });
      return;
    }
    res.json({ success: true, entry });
  } catch (error) {
    console.error(`COD blacklist remove error for ${order}:`, error);
    res.status(500).json({ success: false, error: 'The address could not be removed' });
  }
});

export default router;
