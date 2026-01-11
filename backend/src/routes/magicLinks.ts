import { Router, Response } from 'express';
import { requireAdmin } from './adminAuth';
import magicLinkService from '../services/magicLinkService';
import shopifyService from '../services/shopifyService';
import type { AuthenticatedRequest } from '../types';
import config from '../config';

const router = Router();

/**
 * GET /api/admin/magic-links
 * Get all magic links (paginated)
 */
router.get('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const pageParam = req.query.page;
    const limitParam = req.query.limit;
    const page = parseInt(typeof pageParam === 'string' ? pageParam : '1', 10) || 1;
    const limit = parseInt(typeof limitParam === 'string' ? limitParam : '20', 10) || 20;
    
    const { links, total } = await magicLinkService.getAllLinks(page, limit);
    
    res.json({
      success: true,
      links: links.map(link => ({
        id: link._id,
        token: link.token,
        orderNumber: link.orderNumber,
        customerName: link.customerName,
        customerEmail: link.customerEmail,
        customerPhone: link.customerPhone,
        maxUploads: link.maxUploads,
        currentUploads: link.currentUploads,
        expiresAt: link.expiresAt,
        isActive: link.isActive,
        createdAt: link.createdAt,
        uploadUrl: `${config.frontendUrl}/upload/${link.token}`,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching magic links:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch magic links' });
  }
});

/**
 * POST /api/admin/magic-links
 * Create a new magic link
 */
router.post('/', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderNumber, customerName, customerEmail, customerPhone, maxUploads, expiresInDays } = req.body;

    if (!orderNumber || !customerName) {
      res.status(400).json({ success: false, error: 'Order number and customer name are required' });
      return;
    }

    // Optionally verify order exists in Shopify
    let orderId: string | undefined;
    try {
      const order = await shopifyService.findOrderByNumber(orderNumber);
      if (order) {
        orderId = String(order.id);
      }
    } catch (e) {
      console.warn('Could not verify order in Shopify:', e);
    }

    const magicLink = await magicLinkService.createMagicLink({
      orderNumber,
      orderId,
      customerName,
      customerEmail,
      customerPhone,
      maxUploads: maxUploads || 50,
      expiresInDays: expiresInDays || 30,
      createdBy: req.user!.userId,
    });

    res.status(201).json({
      success: true,
      magicLink: {
        id: magicLink._id,
        token: magicLink.token,
        orderNumber: magicLink.orderNumber,
        customerName: magicLink.customerName,
        maxUploads: magicLink.maxUploads,
        expiresAt: magicLink.expiresAt,
        uploadUrl: `${config.frontendUrl}/upload/${magicLink.token}`,
      },
    });
  } catch (error) {
    console.error('Error creating magic link:', error);
    res.status(500).json({ success: false, error: 'Failed to create magic link' });
  }
});

/**
 * GET /api/admin/magic-links/:token
 * Get a specific magic link
 */
router.get('/:token', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.params.token as string;
    const magicLink = await magicLinkService.findByToken(token);

    if (!magicLink) {
      res.status(404).json({ success: false, error: 'Magic link not found' });
      return;
    }

    res.json({
      success: true,
      magicLink: {
        id: magicLink._id,
        token: magicLink.token,
        orderNumber: magicLink.orderNumber,
        customerName: magicLink.customerName,
        customerEmail: magicLink.customerEmail,
        customerPhone: magicLink.customerPhone,
        maxUploads: magicLink.maxUploads,
        currentUploads: magicLink.currentUploads,
        expiresAt: magicLink.expiresAt,
        isActive: magicLink.isActive,
        createdAt: magicLink.createdAt,
        uploadUrl: `${config.frontendUrl}/upload/${magicLink.token}`,
      },
    });
  } catch (error) {
    console.error('Error fetching magic link:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch magic link' });
  }
});

/**
 * DELETE /api/admin/magic-links/:token
 * Deactivate a magic link
 */
router.delete('/:token', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const token = req.params.token as string;
    await magicLinkService.deactivate(token);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deactivating magic link:', error);
    res.status(500).json({ success: false, error: 'Failed to deactivate magic link' });
  }
});

/**
 * GET /api/admin/shopify/orders
 * Get recent orders from Shopify
 */
router.get('/shopify/orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limitParam = req.query.limit;
    const limit = parseInt(typeof limitParam === 'string' ? limitParam : '50', 10) || 50;
    const orders = await shopifyService.getRecentOrders(limit);
    
    res.json({
      success: true,
      orders: orders.map(order => ({
        id: order.id,
        name: order.name,
        email: order.email,
        createdAt: order.created_at,
        lineItems: order.line_items?.map(item => ({
          title: item.title,
          quantity: item.quantity,
        })),
      })),
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders' });
  }
});

/**
 * GET /api/admin/shopify/orders/:orderNumber
 * Search for a specific order
 */
router.get('/shopify/orders/:orderNumber', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orderNumber = req.params.orderNumber as string;
    const order = await shopifyService.findOrderByNumber(orderNumber);

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    res.json({
      success: true,
      order: {
        id: order.id,
        name: order.name,
        email: order.email,
        createdAt: order.created_at,
        lineItems: order.line_items?.map(item => ({
          title: item.title,
          quantity: item.quantity,
        })),
      },
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order' });
  }
});

export default router;
