import express, { Response } from 'express';
import { DiscardedOrder, RTOOrder, ProfitPrediction, DailyPerformancePrediction } from '../models';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';
import aiService from '../services/aiService';

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

/**
 * GET /api/admin/sales/rto-orders
 * Get all RTO order IDs
 */
router.get('/rto-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rtoOrders = await RTOOrder.find({}, { shopifyOrderId: 1, _id: 0 });
    const orderIds = rtoOrders.map(order => order.shopifyOrderId);
    
    res.json({
      success: true,
      rtoOrderIds: orderIds,
    });
  } catch (error) {
    console.error('Error fetching RTO orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch RTO orders' });
  }
});

/**
 * POST /api/admin/sales/mark-rto
 * Bulk mark orders as RTO
 */
router.post('/mark-rto', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds, orderNames, notes } = req.body;
    
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
    const rtoOrders = orderIds.map(orderId => ({
      shopifyOrderId: orderId,
      orderName: orderNameMap.get(orderId) || `Order ${orderId}`,
      markedRTOBy: userId,
      markedRTOAt: new Date(),
      notes: notes || undefined,
    }));
    
    await RTOOrder.insertMany(rtoOrders, { ordered: false });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) marked as RTO`,
    });
  } catch (error: any) {
    // Handle duplicate key errors gracefully
    if (error.code === 11000) {
      res.json({
        success: true,
        message: 'Orders marked as RTO (some were already marked)',
      });
      return;
    }
    
    console.error('Error marking orders as RTO:', error);
    res.status(500).json({ success: false, error: 'Failed to mark orders as RTO' });
  }
});

/**
 * DELETE /api/admin/sales/mark-rto
 * Remove RTO marking from orders
 */
router.delete('/mark-rto', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, error: 'Order IDs are required' });
      return;
    }
    
    await RTOOrder.deleteMany({ shopifyOrderId: { $in: orderIds } });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) unmarked from RTO`,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to unmark RTO orders' });
  }
});

/**
 * GET /api/admin/sales/prediction/:monthYear
 */
router.get('/prediction/:monthYear', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { monthYear } = req.params;
    const prediction = await ProfitPrediction.findOne({ monthYear, status: 'active' });
    res.json({ success: true, prediction });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch prediction' });
  }
});

router.post('/predict', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { 
      monthYear, 
      daysElapsed, 
      totalDays, 
      currentOrders,
      currentPL, 
      historicalData, 
      pendingOrdersCount, 
      avgPLPerDay, 
      avgOrdersPerDay,
      ndrRate 
    } = req.body;
    
    // Call AI to predict
    const aiResult = await aiService.predictMonthEnd({
      monthYear,
      daysElapsed,
      totalDays,
      currentOrders,
      currentPL,
      historicalData,
      pendingOrdersCount,
      avgPLPerDay,
      avgOrdersPerDay,
      ndrRate
    });

    // Archive old prediction
    await ProfitPrediction.updateMany({ monthYear, status: 'active' }, { status: 'archived' });

    // Save new prediction
    const prediction = new ProfitPrediction({
      monthYear,
      predictedFinalProfit: aiResult.predictedFinalProfit,
      predictedOrders: aiResult.predictedOrders,
      predictedNDR: aiResult.predictedNDR,
      reasoning: aiResult.reasoning,
      insight: (aiResult as any).insight, // Optional field
      lastUpdated: new Date(),
      status: 'active'
    });
    await prediction.save();

    res.json({ 
      success: true, 
      prediction,
      reasoning: aiResult.reasoning,
      insight: (aiResult as any).insight
    });
  } catch (error) {
    console.error('AI Prediction Error:', error);
    res.status(500).json({ success: false, error: 'AI Prediction failed' });
  }
});
 
 /**
  * POST /api/admin/sales/predict-stock
  */
 router.post('/predict-stock', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
   try {
     const { daysToPredict, historicalData, totalBusinessDays } = req.body;
     
     const aiResult = await aiService.predictStock({
       daysToPredict,
       historicalData,
       totalBusinessDays
     });
 
     res.json({ 
       success: true, 
       predictions: aiResult.predictions 
     });
   } catch (error) {
     console.error('AI Stock Prediction Error:', error);
     res.status(500).json({ success: false, error: 'AI Stock Prediction failed' });
   }
 });

  /**
   * GET /api/admin/sales/predict-daily-performance/:dateKey
   */
  router.get('/predict-daily-performance/:dateKey', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { dateKey } = req.params;
      const prediction = await DailyPerformancePrediction.findOne({ dateKey }).sort({ createdAt: -1 });
      res.json({ success: true, prediction });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch prediction' });
    }
  });

  /**
   * POST /api/admin/sales/predict-daily-performance
   */
  router.post('/predict-daily-performance', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { dayName, expectedAdSpend, historicalSameDayData, dateKey, todayData } = req.body;
      
      const aiResult = await aiService.predictDailyPerformance({
        dayName,
        expectedAdSpend,
        historicalSameDayData,
        todayData
      });

      // Save to DB
      const dbPrediction = new DailyPerformancePrediction({
        dateKey,
        expectedAdSpend,
        predictedHourlyCumul: aiResult.predictedHourlyCumul,
        predictedHourlyRevenueCumul: aiResult.predictedHourlyRevenueCumul,
        predictedTotalOrders: aiResult.predictedTotalOrders,
        predictedTotalRevenue: aiResult.predictedTotalRevenue,
        reasoning: aiResult.reasoning
      });
      await dbPrediction.save();
  
      res.json({ 
        success: true, 
        prediction: aiResult 
      });
    } catch (error) {
      console.error('AI Daily Performance Prediction Error:', error);
      res.status(500).json({ success: false, error: 'AI Daily Performance Prediction failed' });
    }
  });

export default router;
