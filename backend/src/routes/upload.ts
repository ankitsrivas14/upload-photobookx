import { Router, Request, Response } from 'express';
import magicLinkService from '../services/magicLinkService';
import config from '../config';

const router = Router();

/**
 * GET /api/upload/:token
 * Validate magic link and get upload info (public - no auth required)
 */
router.get('/:token', async (req: Request<{ token: string }>, res: Response) => {
  try {
    const { token } = req.params;
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    const magicLink = result.magicLink;

    res.json({
      success: true,
      orderNumber: magicLink.orderNumber,
      customerName: magicLink.customerName,
      maxUploads: magicLink.maxUploads,
      currentUploads: magicLink.currentUploads,
      remainingUploads: magicLink.maxUploads - magicLink.currentUploads,
      expiresAt: magicLink.expiresAt,
    });
  } catch (error) {
    console.error('Error validating upload link:', error);
    res.status(500).json({ success: false, error: 'Failed to validate link' });
  }
});

/**
 * POST /api/upload/:token
 * Upload images (public - no auth required, just valid magic link)
 * TODO: Implement actual S3 upload
 */
router.post('/:token', async (req: Request<{ token: string }>, res: Response) => {
  try {
    const { token } = req.params;
    const result = await magicLinkService.validateToken(token);

    if (!result.valid || !result.magicLink) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    // TODO: Handle file upload to S3
    // For now, just return a placeholder response
    res.json({
      success: true,
      message: 'Upload endpoint ready - S3 integration pending',
      orderNumber: result.magicLink.orderNumber,
    });
  } catch (error) {
    console.error('Error handling upload:', error);
    res.status(500).json({ success: false, error: 'Upload failed' });
  }
});

export default router;
