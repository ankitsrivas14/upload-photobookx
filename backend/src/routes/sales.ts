import express, { Response } from 'express';
import { DiscardedOrder } from '../models';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';

const router = express.Router();

/**
 * GET /api/admin/sales/discarded-orders
 * Get all discarded order IDs
 */
router.get('/discarded-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const discardedOrders = await DiscardedOrder.find({}, { shopifyOrderId: 1, _id: 0 });
    const orderIds = discardedOrders.map(order => order.shopifyOrderId);
    
    res.json({
      success: true,
      discardedOrderIds: orderIds,
    });
  } catch (error) {
    console.error('Error fetching discarded orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch discarded orders' });
  }
});

/**
 * POST /api/admin/sales/discard-orders
 * Bulk discard orders
 */
router.post('/discard-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds, orderNames } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, error: 'Order IDs are required' });
      return;
    }
    
    const userId = req.user!.userId;
    
    // Create a map of orderIds to orderNames
    const orderNameMap = new Map<number, string>();
    if (orderNames && Array.isArray(orderNames) && orderNames.length === orderIds.length) {
      orderIds.forEach((id, idx) => {
        orderNameMap.set(id, orderNames[idx]);
      });
    }
    
    // Bulk insert (ignore duplicates)
    const discardedOrders = orderIds.map(orderId => ({
      shopifyOrderId: orderId,
      orderName: orderNameMap.get(orderId) || `Order ${orderId}`,
      discardedBy: userId,
      discardedAt: new Date(),
    }));
    
    await DiscardedOrder.insertMany(discardedOrders, { ordered: false });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) discarded`,
    });
  } catch (error: any) {
    // Handle duplicate key errors gracefully
    if (error.code === 11000) {
      res.json({
        success: true,
        message: 'Orders discarded (some were already discarded)',
      });
      return;
    }
    
    console.error('Error discarding orders:', error);
    res.status(500).json({ success: false, error: 'Failed to discard orders' });
  }
});

/**
 * DELETE /api/admin/sales/discard-orders
 * Restore discarded orders (remove from discard list)
 */
router.delete('/discard-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, error: 'Order IDs are required' });
      return;
    }
    
    await DiscardedOrder.deleteMany({ shopifyOrderId: { $in: orderIds } });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) restored`,
    });
  } catch (error) {
    console.error('Error restoring orders:', error);
    res.status(500).json({ success: false, error: 'Failed to restore orders' });
  }
});

export default router;
