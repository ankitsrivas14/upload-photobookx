import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import { dayPdf, getShippingOverview, setAutoBooking, type DayFile } from '../services/shippingService';
import type { AuthenticatedRequest } from '../types';

const router = Router();

/**
 * GET /api/admin/shipping: the 2-hourly booking job's switch and last run, the day files (latest first), and the COD
 * orders it set aside for a weak address.
 */
router.get('/', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    res.json({ success: true, ...(await getShippingOverview()) });
  } catch (error) {
    console.error('Shipping overview error:', error);
    res.status(500).json({ success: false, error: 'Failed to load the shipping days' });
  }
});

/** PUT /api/admin/shipping/auto { enabled }: turns the booking job on or off. */
router.put('/auto', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ success: false, error: 'Send enabled: true or false' });
    return;
  }
  try {
    await setAutoBooking(enabled);
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Shipping switch error:', error);
    res.status(500).json({ success: false, error: 'Failed to change the booking switch' });
  }
});

/**
 * GET /api/admin/shipping/days/:id/labels and /manifest: the day's PDF. The first download of either closes the day,
 * and bookings after it go into the next one.
 */
router.get('/days/:id/:kind', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  const { id, kind } = req.params as { id: string; kind: string };
  if (kind !== 'labels' && kind !== 'manifest') {
    res.status(404).json({ success: false, error: 'Ask for labels or manifest' });
    return;
  }
  try {
    const file = await dayPdf(id, kind as DayFile);
    if (!file) {
      res.status(404).json({ success: false, error: 'This day has nothing to download' });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(Buffer.from(file.bytes));
  } catch (error) {
    console.error('Shipping day PDF error:', error);
    res.status(500).json({ success: false, error: 'Failed to build the PDF' });
  }
});

export default router;
