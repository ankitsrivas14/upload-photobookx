import express, { Response } from 'express';
import { DiscardedOrder, RTOOrder, ProfitPrediction, ShippingCharge, OrderDeliveryDate, ShopifyOrderCache, MetaAdPerformance, MetaAdAnalysis, AcknowledgedOrder, TicketRaisedOrder, DailyROAS, DailyShipping, DailyOrderStats, DailyPnl, BreakevenSnapshot, Reel, ReelStrategy } from '../models';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';
import aiService from '../services/aiService';
import { backfillAllDates } from '../services/roasService';
import { backfillShippingStats } from '../services/shippingStatsService';
import { backfillOrderStats } from '../services/orderStatsService';
import { backfillDailyPnl, getVariantPerformance } from '../services/dailyPnlService';
import { computeBreakevenMetrics, refreshBreakevenSnapshot } from '../services/breakevenService';
import { dailyOrderStatsStore, dailyPnlStore, dailyShippingStore, dailyRoasStore, breakevenStore, readDailyRange } from '../db/dailyStores';
import shopifyService from '../services/shopifyService';

const router = express.Router();

/**
 * GET /api/admin/sales/discarded-orders
 * Get all discarded order IDs
 */
router.get('/acknowledged-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const acknowledgedOrders = await AcknowledgedOrder.find({}, { shopifyOrderId: 1, _id: 0 });
    const orderIds = acknowledgedOrders.map((order: any) => order.shopifyOrderId);
    
    res.json({
      success: true,
      acknowledgedOrderIds: orderIds,
    });
  } catch (error) {
    console.error('Error fetching acknowledged orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch acknowledged orders' });
  }
});

/**
 * POST /api/admin/sales/acknowledge-orders
 * Bulk acknowledge orders
 */
router.post('/acknowledge-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
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
    const acknowledgedOrders = orderIds.map(orderId => ({
      shopifyOrderId: orderId,
      orderName: orderNameMap.get(orderId) || `Order ${orderId}`,
      acknowledgedBy: userId,
      acknowledgedAt: new Date(),
    }));
    
    await AcknowledgedOrder.insertMany(acknowledgedOrders, { ordered: false });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) acknowledged`,
    });
  } catch (error: any) {
    // Handle duplicate key errors gracefully
    if (error.code === 11000) {
      res.json({
        success: true,
        message: 'Orders acknowledged (some were already acknowledged)',
      });
      return;
    }
    
    console.error('Error acknowledging orders:', error);
    res.status(500).json({ success: false, error: 'Failed to acknowledge orders' });
  }
});

/**
 * DELETE /api/admin/sales/acknowledge-orders
 * Unacknowledge orders
 */
router.delete('/acknowledge-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, error: 'Order IDs are required' });
      return;
    }
    
    await AcknowledgedOrder.deleteMany({ shopifyOrderId: { $in: orderIds } });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) unacknowledged`,
    });
  } catch (error) {
    console.error('Error unacknowledging orders:', error);
    res.status(500).json({ success: false, error: 'Failed to unacknowledge orders' });
  }
});

router.get('/ticket-raised-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const ticketOrders = await TicketRaisedOrder.find({}, { shopifyOrderId: 1, _id: 0 });
    const orderIds = ticketOrders.map((order: any) => order.shopifyOrderId);
    
    res.json({
      success: true,
      ticketRaisedOrderIds: orderIds,
    });
  } catch (error) {
    console.error('Error fetching ticket orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ticket orders' });
  }
});

router.post('/ticket-raised-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds, orderNames } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, error: 'Order IDs are required' });
      return;
    }
    
    const userId = req.user!.userId;
    
    const orderNameMap = new Map<number, string>();
    if (orderNames && Array.isArray(orderNames) && orderNames.length === orderIds.length) {
      orderIds.forEach((id, idx) => {
        orderNameMap.set(id, orderNames[idx]);
      });
    }
    
    const ticketOrders = orderIds.map(orderId => ({
      shopifyOrderId: orderId,
      orderName: orderNameMap.get(orderId) || `Order ${orderId}`,
      markedBy: userId,
      markedAt: new Date(),
    }));
    
    await TicketRaisedOrder.insertMany(ticketOrders, { ordered: false });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) marked as ticket raised`,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      res.json({
        success: true,
        message: 'Orders marked as ticket raised (some were already marked)',
      });
      return;
    }
    
    console.error('Error marking orders as ticket raised:', error);
    res.status(500).json({ success: false, error: 'Failed to mark orders as ticket' });
  }
});

router.delete('/ticket-raised-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderIds } = req.body;
    
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(400).json({ success: false, error: 'Order IDs are required' });
      return;
    }
    
    await TicketRaisedOrder.deleteMany({ shopifyOrderId: { $in: orderIds } });
    
    res.json({
      success: true,
      message: `${orderIds.length} order(s) unmarked as ticket raised`,
    });
  } catch (error) {
    console.error('Error unmarking orders as ticket raised:', error);
    res.status(500).json({ success: false, error: 'Failed to unmark orders as ticket raised' });
  }
});

/**
 * GET /api/admin/sales/discarded-orders
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

    // RTO changes flip order delivery status — recompute P&L and order stats async
    backfillDailyPnl().catch(console.error);
    backfillOrderStats().catch(console.error);
  } catch (error: any) {
    // Handle duplicate key errors gracefully
    if (error.code === 11000) {
      res.json({
        success: true,
        message: 'Orders marked as RTO (some were already marked)',
      });
      backfillDailyPnl().catch(console.error);
      backfillOrderStats().catch(console.error);
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

    backfillDailyPnl().catch(console.error);
    backfillOrderStats().catch(console.error);
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
      sixMonthsStats, 
      sixMonthsDailyData,
      pendingOrdersCount, 
      avgPLPerDay, 
      avgOrdersPerDay,
      ndrRate,
      stats
    } = req.body;
    
    // Call AI to predict
    const aiResult = await aiService.predictMonthEnd({
      monthYear,
      daysElapsed,
      totalDays,
      currentOrders,
      currentPL,
      sixMonthsStats,
      sixMonthsDailyData,
      pendingOrdersCount,
      avgPLPerDay,
      avgOrdersPerDay,
      ndrRate,
      stats
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
   * GET /api/admin/sales/search-orders
   * Search orders in database by name or order number
   */
  router.get('/search-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query.query as string;
      if (!query || query.length < 2) {
        return res.json({ success: true, orders: [] });
      }

      const ordersMap = new Map();
      const lowerQuery = query.toLowerCase();
      const cleanNumQuery = lowerQuery.replace(/^#/, '');

      // 1. Search in ShippingCharge collection (contains fulfilled orders with shiprocket data)
      const shippingMatches = await ShippingCharge.find({
        $or: [
          { orderNumber: { $regex: query.replace(/^#/, ''), $options: 'i' } },
          { customerName: { $regex: query, $options: 'i' } }
        ]
      }).limit(30);

      shippingMatches.forEach(m => {
        const name = m.orderNumber.startsWith('#') ? m.orderNumber : `#${m.orderNumber}`;
        ordersMap.set(name, {
          name,
          customerName: m.customerName || 'N/A',
          customerPhone: m.customerPhone || '',
          shopifyOrderId: m.shopifyOrderId
        });
      });

      // 2. Search orders in Firestore (prefix on order number / customer name).
      const { search: searchOrders } = await import('../db/ordersRepo');
      const matches = await searchOrders(query, 50);
      for (const o of matches) {
        if (ordersMap.size >= 50) break;
        const name = (o.name || '').toString();
        const firstName = o.customer?.first_name || '';
        const lastName = o.customer?.last_name || '';
        const custName = `${firstName} ${lastName}`.trim() || 'N/A';
        const finalName = name.startsWith('#') ? name : `#${name}`;
        if (!ordersMap.has(finalName)) {
          ordersMap.set(finalName, {
            name: finalName,
            customerName: custName,
            customerPhone: o.customer?.phone || o.shipping_address?.phone || '',
            shopifyOrderId: o.id
          });
        }
      }

      // 3. For orders found in cache that are missing phone, check if we have them in ShippingCharge 
      const currentOrders = Array.from(ordersMap.values());
      const namesMissingPhone = currentOrders
        .filter(o => !o.customerPhone)
        .map(o => o.name);

      if (namesMissingPhone.length > 0) {
        const cleanNames = namesMissingPhone.map(n => n.replace(/^#/, ''));
        const extraShippingInfo = await ShippingCharge.find({
          orderNumber: { $in: [...namesMissingPhone, ...cleanNames] }
        });

        extraShippingInfo.forEach(si => {
          const nameWithHash = si.orderNumber.startsWith('#') ? si.orderNumber : `#${si.orderNumber}`;
          const nameNoHash = si.orderNumber.replace(/^#/, '');
          
          [nameWithHash, nameNoHash].forEach(n => {
            if (ordersMap.has(n)) {
              const existing = ordersMap.get(n);
              if (!existing.customerPhone) {
                existing.customerPhone = si.customerPhone || '';
              }
              if (existing.customerName === 'N/A' || !existing.customerName) {
                existing.customerName = si.customerName || 'N/A';
              }
            }
          });
        });
      }

      res.json({ success: true, orders: Array.from(ordersMap.values()) });
    } catch (error) {
      console.error('Order search error:', error);
      res.status(500).json({ success: false, error: 'Order search failed' });
    }
  });

  router.post('/generate-incomplete-address-message', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerName, orderNumber } = req.body;
      // Templated (no AI): the message only needs the first name and order number,
      // so a fixed template is instant, free, and never hallucinates.
      const firstName = String(customerName || '').trim().split(/\s+/)[0] || 'there';
      const message =
        `Hi ${firstName},\n\n` +
        `Thank you for your order ${orderNumber}. Could you please share your complete delivery address — ` +
        `including House No., Area, Landmark, and Pincode — so we can make sure your photobook reaches you safely and quickly?\n\n` +
        `Thank you,\n- PhotobookX team`;
      res.json({ success: true, message });
    } catch (error) {
      console.error('Generate Incomplete Address Message Error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate message' });
    }
  });

  router.post('/generate-multiple-orders-message', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { customerName, orderNumber } = req.body;
      const message = await aiService.generateMultipleOrdersMessage({ customerName, orderNumber });
      res.json({ success: true, message });
    } catch (error) {
      console.error('Generate Multiple Orders Message Error:', error);
      res.status(500).json({ success: false, error: 'Failed to generate message' });
    }
  });

  /**
   * GET /api/admin/sales/ads-performance/status
   * Check if any historical ad data exists
   */
  router.get('/ads-performance/status', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const count = await MetaAdPerformance.countDocuments();
      const latest = await MetaAdPerformance.findOne({}).sort({ date: -1 });
      const archivedDates = await MetaAdPerformance.distinct('date');
      res.json({ success: true, count, latestDate: latest?.date || null, archivedDates });
    } catch (error) {
      console.error('Check Ads Status Error:', error);
      res.status(500).json({ success: false, error: 'Failed' });
    }
  });

  /**
   * GET /api/admin/sales/ads-performance/daily
   * Aggregate data by date for charts
   */
  router.get('/ads-performance/daily', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const dailyData = await MetaAdPerformance.aggregate([
        {
          $group: {
            _id: '$date',
            spend: { $sum: '$spend' },
            revenue: { $sum: { $multiply: ['$spend', '$roas'] } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      res.json({ success: true, data: dailyData });
    } catch (error) {
      console.error('Daily Ads Performance Error:', error);
      res.status(500).json({ success: false, error: 'Failed' });
    }
  });

  /**
   * DELETE /api/admin/sales/ads-performance/:date
   * Delete ad performance data and analysis for a specific date
   */
  router.delete('/ads-performance/:date', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { date } = req.params;
      if (!date) {
        return res.status(400).json({ success: false, error: 'Date is required' });
      }

      await Promise.all([
        MetaAdPerformance.deleteMany({ date }),
        MetaAdAnalysis.deleteMany({ date })
      ]);

      res.json({ success: true, message: `Ad performance data for ${date} cleared` });
    } catch (error) {
      console.error('Delete Ads Performance Date Error:', error);
      res.status(500).json({ success: false, error: 'Failed' });
    }
  });

  /**
   * DELETE /api/admin/sales/ads-performance
   * Clear all archived data to start from scratch
   */
  router.delete('/ads-performance', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      await Promise.all([
        MetaAdPerformance.deleteMany({}),
        MetaAdAnalysis.deleteMany({})
      ]);
      res.json({ success: true, message: 'All ad performance data cleared' });
    } catch (error) {
      console.error('Clear Ads Performance Error:', error);
      res.status(500).json({ success: false, error: 'Failed' });
    }
  });
router.post('/ads-performance', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { adData, level, date } = req.body;
      if (!adData || !Array.isArray(adData) || adData.length === 0) {
        return res.status(400).json({ success: false, error: 'Ad data is required' });
      }

      // Log first row keys for debugging column names
      if (adData[0]) {
        console.log('Sample Ad Data Headers:', Object.keys(adData[0]));
      }

      // Robust key matcher
      const findValue = (row: any, aliases: string[]) => {
        const keys = Object.keys(row);
        const lowerAliases = aliases.map(a => a.toLowerCase());
        
        const cleanValue = (val: any) => {
          if (val === undefined || val === null) return null;
          const s = String(val).trim();
          return s === '' ? null : val;
        };

        // 1. Try exact match (case-insensitive)
        for (const alias of lowerAliases) {
          const exactMatch = keys.find(k => k.toLowerCase() === alias);
          if (exactMatch !== undefined) {
            const v = cleanValue(row[exactMatch]);
            if (v !== null) return v;
          }
        }
        
        // 2. Try substring match
        for (const alias of lowerAliases) {
          const partialMatch = keys.find(k => k.toLowerCase().includes(alias));
          if (partialMatch !== undefined) {
             const v = cleanValue(row[partialMatch]);
             if (v !== null) return v;
          }
        }
        
        return null;
      };

      const parseNumber = (val: any) => {
        if (val === null || val === undefined || val === '') return 0;
        if (typeof val === 'number') return val;
        // Strip everything except numbers and dots
        const sanitized = String(val).replace(/[^0-9.]/g, '');
        return parseFloat(sanitized) || 0;
      };

      const entries = adData.map(d => {
        const spend = parseNumber(findValue(d, ['Amount Spent', 'Spend', 'Cost']));
        const purchases = parseNumber(findValue(d, ['Results', 'Purchases', 'Returns']));
        const roas = parseNumber(findValue(d, ['ROAS', 'Return on Ad Spend']));
        const reach = parseNumber(findValue(d, ['Reach']));
        const impressions = parseNumber(findValue(d, ['Impressions']));
        const cpc = parseNumber(findValue(d, ['cpc', 'cost per link click']));
        const ctr = parseNumber(findValue(d, ['ctr', 'link click-through rate']));
        let cpa = parseNumber(findValue(d, ['cost per result', 'cost per purchase', 'cpa']));
        if (!cpa && purchases > 0) cpa = spend / purchases;
        const clicks = parseNumber(findValue(d, ['link clicks', 'clicks (all)', 'clicks']));
        const cpm = parseNumber(findValue(d, ['cost per 1,000 impressions', 'cpm']));
        const frequency = parseNumber(findValue(d, ['frequency']));
        const addsToCart = parseNumber(findValue(d, ['adds to cart', 'addToCart', 'addsToCart']));
        const outboundClicks = parseNumber(findValue(d, ['outbound clicks', 'outboundClicks']));
        const dailyBudget = parseNumber(findValue(d, ['dailyBudget', 'ad set budget']));
        const videoPlays25 = parseNumber(findValue(d, ['videoPlays25', 'video plays at 25%']));
        const videoPlays50 = parseNumber(findValue(d, ['videoPlays50', 'video plays at 50%']));
        const videoPlays75 = parseNumber(findValue(d, ['videoPlays75', 'video plays at 75%']));
        const videoPlays95 = parseNumber(findValue(d, ['videoPlays95', 'video plays at 95%']));
        const videoPlays100 = parseNumber(findValue(d, ['videoPlays100', 'video plays at 100%']));
        const videoAvgPlayTime = parseNumber(findValue(d, ['videoAvgPlayTime', 'video average play time']));
        // 'videoPlays' must be matched AFTER the percentage variants would fail —
        // exact-match pass runs first, so the bare key/column is picked correctly.
        const videoPlays = parseNumber(findValue(d, ['videoPlays', 'video plays']));
        const name = (findValue(d, ['Ad Set Name', 'Campaign Name', 'Ad Name', 'Name']) || 'Unknown').trim();
        const status = findValue(d, ['Delivery Status', 'Delivery', 'Status']) || 'active';
        
        // Try to find a date in the row, default to provided date or today
        let rawRowDate = findValue(d, ['Reporting starts', 'Reporting ends', 'Day', 'Date', 'Month', 'Starts', 'Ends']);
        let finalDate = date || new Date().toISOString().split('T')[0];
        
        if (rawRowDate) {
          try {
            // Meta reports often have ranges like "Mar 1, 2026 - Mar 1, 2026" or "2026-03-01 to 2026-03-01"
            const firstDatePart = String(rawRowDate).split(/ [-–to] /)[0].trim();
            const dObj = new Date(firstDatePart);
            if (!isNaN(dObj.getTime())) {
              finalDate = dObj.toISOString().split('T')[0];
            }
          } catch (e) { /* fallback to finalDate */ }
        }

        return {
          date: finalDate,
          level: level || (findValue(d, ['Ad Name']) ? 'ad' : findValue(d, ['Ad Set Name']) ? 'adset' : 'campaign'),
          name,
          status,
          spend,
          purchases,
          roas,
          reach,
          impressions,
          cpc,
          ctr,
          cpa,
          clicks,
          cpm,
          frequency,
          addsToCart,
          outboundClicks,
          dailyBudget,
          videoPlays,
          videoAvgPlayTime,
          videoPlays25,
          videoPlays50,
          videoPlays75,
          videoPlays95,
          videoPlays100
        };
      });

      // Filter out 'Unknown' if valid data exists, or just keep as is
      await MetaAdPerformance.insertMany(entries);

      res.json({ success: true, count: entries.length });
    } catch (error) {
      console.error('Save Ads Performance Error:', error);
      res.status(500).json({ success: false, error: 'Failed to save ads performance' });
    }
  });

  /**
   * POST /api/admin/sales/analyze-ads
   */
  router.post('/analyze-ads', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      let { adData } = req.body;
      
      // If no data is provided (e.g., after refresh), fetch the most recent data from DB
      if (!adData || !Array.isArray(adData) || adData.length === 0) {
        const latestEntry = await MetaAdPerformance.findOne({}).sort({ date: -1 });
        if (latestEntry) {
          adData = await MetaAdPerformance.find({ date: latestEntry.date });
        }
      }

      if (!adData || adData.length === 0) {
        return res.status(400).json({ success: false, error: 'No ad data available for analysis. Please upload first.' });
      }

      let filteredAdData = adData;
      const adsetOnly = adData.filter((d: any) => d.level === 'adset');
      
      // If we have mixed data, prioritize adsets if that's the dominant set requested
      if (adsetOnly.length > 0) {
        filteredAdData = adsetOnly;
      }

      // Clean up names in current adData and define date
      filteredAdData = filteredAdData.map((d: any) => ({
        ...d,
        name: (typeof d.name === 'string' ? d.name.trim() : d.name || 'Unknown')
      }));
      
      // Remove true duplicates by checking level, name, AND stats
      const seenNames = new Set();
      filteredAdData = filteredAdData.filter((d: any) => {
        const key = `${d.level}:${d.name}:${d.spend}:${d.reach}`;
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });

      // Only analyze LIVE ad sets. Closed/paused/inactive ad sets with no spend today
      // are dead inventory — sending them to the AI just burns tokens to produce a canned
      // CLOSE. "Live" = spent today OR the ad set's delivery status is active.
      const isLive = (d: any) => {
        const status = String(d.status || '').toLowerCase().trim();
        const activelyDelivering = status === 'active'; // exact — avoids matching "inactive"
        return (Number(d.spend) || 0) > 0 || activelyDelivering;
      };
      const liveAdData = filteredAdData.filter(isLive);
      // Safety net: if nothing looks live (e.g. an all-zero-spend export), fall back to the
      // full set rather than returning an empty analysis.
      if (liveAdData.length > 0) {
        console.log(`analyze-ads: ${liveAdData.length} live ad sets (skipped ${filteredAdData.length - liveAdData.length} closed/zero-spend)`);
        filteredAdData = liveAdData;
      }

      adData = filteredAdData; // Resign back for the loop

      const latestDate = adData?.[0]?.date || new Date().toISOString().split('T')[0];

      // ─── Business + portfolio context for the AI (best-effort; analysis proceeds without it) ───
      const analysisContext: any = {};
      try {
        // Real unit economics: breakeven ROAS, contribution margin, delivery-failure (NDR) rate
        const be = await computeBreakevenMetrics();
        const settled = (be.deliveredCount || 0) + (be.failedCount || 0);
        analysisContext.business = {
          aov: Math.round(be.aov),
          contributionMargin: Math.round(be.contributionMargin),
          breakevenROAS: Number(be.breakevenROAS.toFixed(2)),
          deliveryFailureRatePct: settled > 0 ? Number(((be.failedCount / settled) * 100).toFixed(1)) : null,
        };
      } catch (err) { console.error('analyze-ads: breakeven context failed', err); }

      try {
        // Yesterday's calls, so the model can grade and correct its own prior decisions
        const prev = await MetaAdAnalysis.findOne({ date: { $lt: latestDate } }).sort({ date: -1 }).lean();
        if (prev?.recommendations?.length) {
          analysisContext.previousRecommendations = {
            date: prev.date,
            calls: prev.recommendations.map((r: any) => ({
              name: r.name, decision: r.decision, targetSpend: r.targetSpend,
            })),
          };
        }
      } catch (err) { console.error('analyze-ads: previous analysis context failed', err); }

      try {
        // Creative strategy matrix from the Reels page — lets the AI correlate winning
        // ad sets with the creative strategies behind their reels
        const [reels, strategies] = await Promise.all([
          Reel.find().sort({ date: -1 }).limit(100).lean(),
          ReelStrategy.find().lean(),
        ]);
        if (reels.length && strategies.length) {
          const stratName = new Map(strategies.map((s: any) => [String(s._id), s.name]));
          analysisContext.reelStrategies = reels.map((r: any) => ({
            reel: r.name,
            date: new Date(r.date).toISOString().slice(0, 10),
            strategies: (r.strategyIds || []).map((id: any) => stratName.get(String(id))).filter(Boolean),
          }));
        }
      } catch (err) { console.error('analyze-ads: reels context failed', err); }

      // Whole-account snapshot: every batch sees the full portfolio even though
      // recommendations are generated in batches
      analysisContext.accountSnapshot = adData.map((d: any) =>
        `${d.name} | budget ₹${d.dailyBudget || '?'} | spend ₹${d.spend} | ROAS ${d.roas} | ${d.purchases || 0} purchases`
      );

      const weekday = new Date(`${latestDate}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
      analysisContext.calendar = { date: latestDate, weekday };

      const BATCH_SIZE = 10;
      const allRecommendations: any[] = [];
      let overallStrategies: string[] = [];

      // Normalize a name for matching (tolerant of case / whitespace differences the AI may introduce)
      const norm = (n: any) =>
        (typeof n === 'string' ? n.trim().toLowerCase().replace(/\s+/g, ' ') : '');

      // Override an AI recommendation with the authoritative stats from the uploaded data,
      // so the table never shows numbers the model may have hallucinated or omitted.
      const attachRealStats = (rec: any, d: any) => ({
        ...rec,
        name: d.name,
        level: d.level,
        stats: {
          spend: d.spend || 0, roas: d.roas || 0, purchases: d.purchases || 0,
          cpa: d.cpa || 0, cpc: d.cpc || 0, ctr: d.ctr || 0,
          clicks: d.clicks || 0, cpm: d.cpm || 0, addsToCart: d.addsToCart || 0
        }
      });

      // Safety net for an ad set the AI failed to return even after a retry: surface it
      // (flagged for manual review) rather than letting it silently disappear from the table.
      const buildFallback = (d: any) => attachRealStats({
        name: d.name,
        decision: 'MONITOR',
        rationale: 'The AI did not return a recommendation for this ad set, so it has been flagged for manual review. Current-day stats are shown as reported.',
        targetSpend: (typeof d.spend === 'number' && d.spend > 0) ? Math.round(d.spend) : 'N/A'
      }, d);

      // Index a batch of AI recommendations by normalized name. Duplicate names map to a
      // queue so distinct ad sets that share a name each consume their own recommendation.
      const indexByName = (recs: any[]) => {
        const map = new Map<string, any[]>();
        (recs || []).forEach((rec: any) => {
          const k = norm(rec.name);
          if (!k) return;
          if (!map.has(k)) map.set(k, []);
          map.get(k)!.push(rec);
        });
        return map;
      };

      const fetchHistoryFor = (names: string[]) =>
        MetaAdPerformance.find({
          name: { $in: names.filter(Boolean) },
          date: { $ne: latestDate }
        })
        .sort({ date: -1 })
        .limit(1000); // 1000 points of history for 50 adsets is plenty (~20 days each)

      // Distinguish "the AI provider itself failed" (quota exhausted, bad key, rate limit)
      // from "the model dropped a few items". The former should surface honestly instead of
      // masquerading as a table full of "manual review" fallbacks.
      const readAiError = (err: any): string => err?.error?.message || err?.message || 'Unknown AI provider error';
      const isHardAiError = (err: any): boolean => {
        const status = err?.status;
        const code = err?.code || err?.error?.code;
        return status === 401 || status === 429 || code === 'insufficient_quota' || code === 'invalid_api_key';
      };
      let aiProviderError: string | null = null;
      let aiProducedAny = false;

      // Process in batches to avoid OpenAI output token limits
      for (let i = 0; i < adData.length; i += BATCH_SIZE) {
        const batch = adData.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        // Fetch history ONLY for the current batch's ad sets
        const batchHistoricalData = await fetchHistoryFor(batch.map((d: any) => d.name));

        console.log(`Analyzing Batch ${batchNum}... (${batch.length} items)`);

        // A failed batch (e.g. truncated JSON) must not kill the whole analysis: leave its
        // recommendations empty so every item flows into the retry/fallback path below.
        let result: any = { recommendations: [], overallStrategy: '' };
        try {
          result = await aiService.analyzeAdsData(batch, batchHistoricalData, analysisContext);
          if (result.recommendations?.length) aiProducedAny = true;
        } catch (batchErr: any) {
          console.error(`Batch ${batchNum} analysis failed; recovering each item via retry/fallback.`, batchErr);
          // A quota/auth error won't recover on the next batch — stop and report it.
          if (isHardAiError(batchErr)) {
            aiProviderError = readAiError(batchErr);
            break;
          }
        }
        if (result.overallStrategy) {
          overallStrategies.push(result.overallStrategy);
        }

        // Reconcile: every entity in this batch MUST end up with exactly one recommendation.
        const recsByName = indexByName(result.recommendations);
        const missing: any[] = [];
        const reconciled: any[] = batch.map((d: any) => {
          const queue = recsByName.get(norm(d.name));
          const rec = queue && queue.length ? queue.shift() : null;
          if (rec) return attachRealStats(rec, d);
          missing.push(d);
          return null;
        });

        // One targeted retry for any ad sets the AI skipped in this batch.
        if (missing.length > 0) {
          console.warn(`Batch ${batchNum}: AI skipped ${missing.length} ad set(s); retrying just those.`);
          try {
            const retryHistory = await fetchHistoryFor(missing.map((d: any) => d.name));
            const retryResult = await aiService.analyzeAdsData(missing, retryHistory, analysisContext);
            const retryByName = indexByName(retryResult.recommendations);
            missing.forEach((d: any) => {
              const idx = batch.indexOf(d);
              const queue = retryByName.get(norm(d.name));
              const rec = queue && queue.length ? queue.shift() : null;
              reconciled[idx] = rec ? attachRealStats(rec, d) : buildFallback(d);
            });
          } catch (retryErr) {
            console.error('Retry for skipped ad sets failed:', retryErr);
            missing.forEach((d: any) => { reconciled[batch.indexOf(d)] = buildFallback(d); });
          }
        }

        allRecommendations.push(...reconciled.filter(Boolean));
      }

      console.log(`Total Final Recommendations: ${allRecommendations.length} (expected ${adData.length})`);

      // If the AI never produced a single real recommendation and the provider errored,
      // surface the actual reason instead of persisting a table of "manual review" rows.
      if (!aiProducedAny && aiProviderError) {
        const quota = /quota|billing|insufficient/i.test(aiProviderError);
        return res.status(502).json({
          success: false,
          error: quota
            ? `AI provider quota exceeded — add credits or raise the spending limit on the OpenAI account for OPENAI_API_KEY. (${aiProviderError})`
            : `AI provider error: ${aiProviderError}`,
        });
      }

      // PERSIST the analysis: Overwrite existing one for this date
      if (allRecommendations.length > 0) {
        await MetaAdAnalysis.findOneAndUpdate(
          { date: latestDate },
          { 
            date: latestDate,
            recommendations: allRecommendations,
            overallStrategy: Array.from(new Set(overallStrategies)).join(' | ') 
          },
          { upsert: true, new: true }
        );
      }

      res.json({ 
        success: true, 
        recommendations: allRecommendations,
        overallStrategy: Array.from(new Set(overallStrategies)).join(' | ') 
      });
    } catch (error: any) {
      console.error('AI Ads Analysis Error Stack:', error);
      res.status(500).json({ success: false, error: `AI Ads Analysis failed: ${error.message || 'Unknown error'}` });
    }
  });

  // Fetch a saved analysis by date
  router.get('/ads-analysis/:date', async (req, res) => {
    try {
      const { date } = req.params;
      const analysis = await MetaAdAnalysis.findOne({ date });
      res.json({ success: true, data: analysis });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch analysis' });
    }
  });

  // Fetch the LATEST saved analysis
  router.get('/ads-analysis-latest', async (req, res) => {
    try {
      const latest = await MetaAdAnalysis.findOne({}).sort({ date: -1 });
      res.json({ success: true, data: latest });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch latest analysis' });
    }
  });

  // Get all dates that have an analysis/chat
  router.get('/ads-analysis-dates', async (req, res) => {
    try {
      const dates = await MetaAdAnalysis.find({}, { date: 1 }).sort({ date: -1 });
      res.json({ success: true, dates: dates.map(d => d.date) });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch analysis dates' });
    }
  });

  // Fetch raw performance data for a date
  router.get('/ads-performance/:date', async (req, res) => {
    try {
      const { date } = req.params;
      const performanceData = await MetaAdPerformance.find({ date });
      res.json({ success: true, count: performanceData.length, data: performanceData });
    } catch (error) {
       res.status(500).json({ success: false, error: 'Failed' });
    }
  });

  // Fetch ALL historic performance data across all dates
  router.get('/ads-performance-all', async (req, res) => {
    try {
      const performanceData = await MetaAdPerformance.find({}).sort({ date: -1 });
      res.json({ success: true, count: performanceData.length, data: performanceData });
    } catch (error) {
       res.status(500).json({ success: false, error: 'Failed to fetch all-time performance data' });
    }
  });

  // Chat about ads strategy
  router.post('/ads-chat', async (req, res) => {
    try {
      const { userQuestion, date } = req.body;
      if (!userQuestion || !date) {
        return res.status(400).json({ success: false, error: 'Question and date are required' });
      }

      // Fetch the analysis for this date
      let analysis = await MetaAdAnalysis.findOne({ date });
      if (!analysis) {
        // Create an empty one if it doesn't exist
         analysis = new MetaAdAnalysis({ date, recommendations: [], overallStrategy: 'Chat-initiated session' });
      }

      // Fetch ad data for context
      const adData = await MetaAdPerformance.find({ date });
      const adSetNames = adData.filter(d => d.level === 'adset').map(d => d.name);
      
      // Fetch history for those adsets
      const historicalData = await MetaAdPerformance.find({
        name: { $in: adSetNames },
        date: { $lt: date }
      }).limit(500);

      // Business economics context (best-effort)
      let chatBusinessContext: any = null;
      try {
        const be = await computeBreakevenMetrics();
        const settled = (be.deliveredCount || 0) + (be.failedCount || 0);
        chatBusinessContext = {
          aov: Math.round(be.aov),
          contributionMargin: Math.round(be.contributionMargin),
          breakevenROAS: Number(be.breakevenROAS.toFixed(2)),
          deliveryFailureRatePct: settled > 0 ? Number(((be.failedCount / settled) * 100).toFixed(1)) : null,
        };
      } catch (err) { console.error('ads-chat: breakeven context failed', err); }

      // Call AI Chat
      const aiResponse = await aiService.chatWithAdsStrategist(
        userQuestion,
        adData,
        historicalData,
        analysis.chat || [],
        chatBusinessContext
      );

      // Persist the messages
      if (!analysis.chat) analysis.chat = [];
      analysis.chat.push({ role: 'user', content: userQuestion, timestamp: new Date() });
      analysis.chat.push({ role: 'assistant', content: aiResponse, timestamp: new Date() });
      
      await analysis.save();

      res.json({ success: true, aiResponse, chat: analysis.chat });
    } catch (error: any) {
      console.error('Ads Chat Error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

/**
 * GET /api/admin/sales/daily-roas
 * Fetch stored daily ROAS records. Optional query params: startDate, endDate (YYYY-MM-DD).
 */
router.get('/daily-roas', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    // Pure read — DailyROAS is kept up to date on the WRITE paths instead:
    //  • ad-spend create/delete → recomputeForDate(dateKey)      (expenses.ts)
    //  • order-cache refresh    → scheduleRoasRecompute()        (shopifyService.updateCache)
    // Revenue and ad spend can only change through those two writers, so
    // recomputing here on every FE load was pure wasted work.
    const records = await readDailyRange(dailyRoasStore, startDate, endDate);

    res.json({
      success: true,
      records: records.map((r: any) => ({
        dateKey: r.dateKey,
        revenue: r.revenue,
        adSpend: r.adSpend,
        roas: r.roas,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching daily ROAS:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch daily ROAS' });
  }
});

/**
 * POST /api/admin/sales/daily-roas/backfill
 * Recompute and store DailyROAS for all dates with order or ad-spend data.
 */
router.post('/daily-roas/backfill', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await backfillAllDates();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error backfilling daily ROAS:', error);
    res.status(500).json({ success: false, error: 'Backfill failed' });
  }
});

/**
 * GET /api/admin/sales/daily-shipping
 * Fetch stored daily shipping stats. Optional query params: startDate, endDate (YYYY-MM-DD).
 */
router.get('/daily-shipping', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const records = await readDailyRange(dailyShippingStore, startDate, endDate);

    res.json({
      success: true,
      records: records.map((r: any) => ({
        dateKey: r.dateKey,
        avgShipping: r.avgShipping,
        avgShippingSmall: r.avgShippingSmall,
        avgShippingLarge: r.avgShippingLarge,
        orderCount: r.orderCount,
        smallCount: r.smallCount,
        largeCount: r.largeCount,
        updatedAt: r.updatedAt,
      })),
    });
  } catch (error) {
    console.error('Error fetching daily shipping:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch daily shipping stats' });
  }
});

/**
 * POST /api/admin/sales/daily-shipping/backfill
 * Recompute and store DailyShipping for all dates with fulfilled order + shipping charge data.
 */
router.post('/daily-shipping/backfill', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await backfillShippingStats();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error backfilling daily shipping:', error);
    res.status(500).json({ success: false, error: 'Backfill failed' });
  }
});

/**
 * GET /api/admin/sales/daily-order-stats
 * Fetch stored daily order stats for pie charts. Optional query: startDate, endDate (YYYY-MM-DD).
 */
router.get('/daily-order-stats', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const records = await readDailyRange(dailyOrderStatsStore, startDate, endDate);

    // Aggregate across all returned dates
    const agg = {
      prepaidCount: 0,
      codCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      inTransitCount: 0,
      outForDeliveryCount: 0,
      attemptedDeliveryCount: 0,
      confirmedCount: 0,
      codDeliveredCount: 0,
      codFailedCount: 0,
    };

    for (const r of records as any[]) {
      agg.prepaidCount += r.prepaidCount ?? 0;
      agg.codCount += r.codCount ?? 0;
      agg.deliveredCount += r.deliveredCount ?? 0;
      agg.failedCount += r.failedCount ?? 0;
      agg.inTransitCount += r.inTransitCount ?? 0;
      agg.outForDeliveryCount += r.outForDeliveryCount ?? 0;
      agg.attemptedDeliveryCount += r.attemptedDeliveryCount ?? 0;
      agg.confirmedCount += r.confirmedCount ?? 0;
      agg.codDeliveredCount += r.codDeliveredCount ?? 0;
      agg.codFailedCount += r.codFailedCount ?? 0;
    }

    let finalStartDate = startDate;
    let finalEndDate = endDate;

    if (records.length > 0) {
      if (!finalStartDate) finalStartDate = records[0].dateKey;
      if (!finalEndDate) finalEndDate = records[records.length - 1].dateKey;
    }

    let sessionsMap: Record<string, number> = {};
    if (finalStartDate && finalEndDate) {
      sessionsMap = await shopifyService.getDailySessions(finalStartDate, finalEndDate);
    }

    const completedDates = (records as any[]).filter((r) => r.isCompleted).map((r) => r.dateKey as string);

    res.json({
      success: true,
      stats: agg,
      completedDates,
      records: records.map((r: any) => ({
        dateKey: r.dateKey,
        prepaidCount: r.prepaidCount,
        codCount: r.codCount,
        deliveredCount: r.deliveredCount,
        failedCount: r.failedCount,
        inTransitCount: r.inTransitCount,
        outForDeliveryCount: r.outForDeliveryCount,
        attemptedDeliveryCount: r.attemptedDeliveryCount,
        confirmedCount: r.confirmedCount,
        codDeliveredCount: r.codDeliveredCount,
        codFailedCount: r.codFailedCount,
        isCompleted: r.isCompleted,
        sessions: sessionsMap[r.dateKey] ?? 0,
      })),
    });
  } catch (error) {
    console.error('Error fetching daily order stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order stats' });
  }
});

/**
 * POST /api/admin/sales/daily-order-stats/backfill
 * Recompute DailyOrderStats for all dates.
 */
router.post('/daily-order-stats/backfill', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await backfillOrderStats();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error backfilling order stats:', error);
    res.status(500).json({ success: false, error: 'Backfill failed' });
  }
});

/**
 * POST /api/admin/sales/firestore-backfill-orders
 * Phase 1: copy the current Mongo order cache into Firestore (one doc per order).
 * Idempotent — safe to re-run. Seeds Firestore without waiting on the scheduled sync.
 */
router.post('/firestore-backfill-orders', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const orders = await shopifyService.getAllOrders(10000);
    const { saveAll } = await import('../db/ordersRepo');
    const written = await saveAll(orders);
    res.json({ success: true, written, total: orders.length });
  } catch (error) {
    console.error('Firestore orders backfill failed:', error);
    res.status(500).json({ success: false, error: String((error as any)?.message || error) });
  }
});

/**
 * POST /api/admin/sales/refresh-aggregates
 * Recompute every dashboard aggregate from the current Firestore data (order stats,
 * shipping stats, daily P&L, ROAS, breakeven). Fast now that reads are on Firestore.
 */
router.post('/refresh-aggregates', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { backfillAllDates } = await import('../services/roasService');
    await backfillOrderStats();
    await backfillShippingStats();
    await backfillDailyPnl();
    await refreshBreakevenSnapshot();
    await backfillAllDates();
    res.json({ success: true });
  } catch (error) {
    console.error('refresh-aggregates failed:', error);
    res.status(500).json({ success: false, error: String((error as any)?.message || error) });
  }
});

/**
 * POST /api/admin/sales/firestore-backfill-shipping
 * Copy all Mongo ShippingCharge docs into Firestore (one-time seed). Idempotent.
 */
router.post('/firestore-backfill-shipping', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await ShippingCharge.find({}).lean();
    const { upsertMany } = await import('../db/shippingRepo');
    const written = await upsertMany(rows as any[]);
    res.json({ success: true, written, total: rows.length });
  } catch (error) {
    console.error('Firestore shipping backfill failed:', error);
    res.status(500).json({ success: false, error: String((error as any)?.message || error) });
  }
});

/**
 * POST /api/admin/sales/firestore-sync-orders
 * Fast freshness: fetch recent orders straight from Shopify (last N days) and upsert
 * into Firestore — no 15MB Mongo round-trip. This is what keeps orders current.
 */
router.post('/firestore-sync-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.max(1, Math.min(60, Number(req.query.days) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const recent = await shopifyService.fetchRecentOrders(since);
    const { saveAll } = await import('../db/ordersRepo');
    const written = await saveAll(recent);
    res.json({ success: true, fetched: recent.length, written, since });
  } catch (error) {
    console.error('Firestore orders sync failed:', error);
    res.status(500).json({ success: false, error: String((error as any)?.message || error) });
  }
});

/**
 * GET /api/admin/sales/monthly-order-counts
 * Total orders (prepaid + COD) grouped by month, oldest first — for the
 * dashboard's "Orders per month" bar chart. Aggregated in the DB.
 */
router.get('/monthly-order-counts', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    // Read the daily docs from 'YYYY-MM' >= Feb 2026 and group by month in JS
    // (Firestore has no aggregation pipeline; the collection is tiny).
    const stats = await dailyOrderStatsStore.rangeByField('dateKey', '2026-02-01');
    const byMonth = new Map<string, number>();
    for (const s of stats) {
      const month = String(s.dateKey).substring(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + (s.prepaidCount || 0) + (s.codCount || 0));
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, orders]) => ({ month, orders }));

    // "Pace" benchmark: average orders accumulated by today's day-of-month across
    // past complete months (excludes the current month and the partial Jan).
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const currentMonth = todayIST.substring(0, 7);
    const dayOfMonth = todayIST.substring(8, 10); // zero-padded 'DD'
    const paceByMonth = new Map<string, number>();
    for (const s of stats) {
      if (String(s.dateKey).substring(8, 10) > dayOfMonth) continue;
      const month = String(s.dateKey).substring(0, 7);
      if (month >= currentMonth) continue;
      paceByMonth.set(month, (paceByMonth.get(month) || 0) + (s.prepaidCount || 0) + (s.codCount || 0));
    }
    const paceVals = [...paceByMonth.values()];
    const paceAverage = paceVals.length ? Math.round(paceVals.reduce((a, b) => a + b, 0) / paceVals.length) : 0;

    res.json({
      success: true,
      months,
      paceAverage,
      paceDay: Number(dayOfMonth),
    });
  } catch (error) {
    console.error('Error fetching monthly order counts:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch monthly order counts' });
  }
});

/**
 * GET /api/admin/sales/monthly-revenue
 * Gross order value (sum of order totals) grouped by month, oldest first — for the
 * dashboard's "Revenue per month" bar chart. Uses the same basis as the order-count
 * chart: non-cancelled orders, by IST creation date, from the data start date.
 */
router.get('/monthly-revenue', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    // Grouped from the pre-computed DailyOrderStats.grossRevenue in JS (tiny collection).
    const stats = await dailyOrderStatsStore.rangeByField('dateKey', '2026-02-01');
    const byMonth = new Map<string, number>();
    for (const s of stats) {
      const month = String(s.dateKey).substring(0, 7);
      byMonth.set(month, (byMonth.get(month) || 0) + (s.grossRevenue || 0));
    }
    const months = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }));

    // "Pace" benchmark: avg revenue accumulated by today's day-of-month across past
    // complete months (excludes the current month and the partial Jan).
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const currentMonth = todayIST.substring(0, 7);
    const dayOfMonth = todayIST.substring(8, 10); // zero-padded 'DD'
    const paceByMonth = new Map<string, number>();
    for (const s of stats) {
      if (String(s.dateKey).substring(8, 10) > dayOfMonth) continue;
      const month = String(s.dateKey).substring(0, 7);
      if (month >= currentMonth) continue;
      paceByMonth.set(month, (paceByMonth.get(month) || 0) + (s.grossRevenue || 0));
    }
    const paceVals = [...paceByMonth.values()];
    const paceAverage = paceVals.length ? Math.round(paceVals.reduce((a, b) => a + b, 0) / paceVals.length) : 0;

    res.json({
      success: true,
      months,
      paceAverage,
      paceDay: Number(dayOfMonth),
    });
  } catch (error) {
    console.error('Error fetching monthly revenue:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch monthly revenue' });
  }
});

/**
 * GET /api/admin/sales/incomplete-day-orders?date=YYYY-MM-DD
 * The orders that keep a P&L day "incomplete" (grey bar): non-cancelled orders on
 * that day (IST creation) that are NOT yet in a final state (delivered/failed/RTO).
 * Returns order number, amount and tracking link for the dashboard drawer.
 */
router.get('/incomplete-day-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: 'date (YYYY-MM-DD) is required' });
    }

    const STORE_TIMEZONE = 'Asia/Kolkata';
    const { getMonth } = await import('../db/ordersRepo');
    const [orders, rtoRows] = await Promise.all([
      getMonth(date.substring(0, 7)), // only that month's orders from Firestore
      RTOOrder.find({}, { shopifyOrderId: 1, _id: 0 }).lean(),
    ]);
    const rtoSet = new Set((rtoRows as any[]).map((r) => r.shopifyOrderId as number));

    // Mirrors dailyPnlService: latest fulfillment status, then order-level status.
    const deliveryStatus = (o: any): string => {
      let s = '';
      if (o.fulfillments?.length) s = (o.fulfillments[o.fulfillments.length - 1].shipment_status ?? '').toLowerCase();
      if (!s && o.fulfillment_status) s = String(o.fulfillment_status).toLowerCase();
      return s;
    };
    const isFinal = (o: any): boolean => {
      if (rtoSet.has(o.id)) return true;
      const s = deliveryStatus(o);
      return s === 'delivered' || s === 'failure' || s.includes('failed') || s.includes('rto');
    };

    const pending = (orders as any[])
      .filter((o) => {
        if (o.cancelled_at || !o.created_at) return false;
        const dk = new Date(o.created_at).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        return dk === date && !isFinal(o);
      })
      .map((o) => ({
        orderNumber: o.name,
        amount: o.current_total_price ? parseFloat(o.current_total_price) : 0,
        deliveryStatus: deliveryStatus(o) || 'unfulfilled',
        trackingUrl: o.fulfillments?.length ? (o.fulfillments[o.fulfillments.length - 1].tracking_url || null) : null,
      }));

    res.json({ success: true, date, orders: pending });
  } catch (error) {
    console.error('Error fetching incomplete-day orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch incomplete-day orders' });
  }
});

/**
 * GET /api/admin/sales/daily-pnl
 * Returns per-day P&L records.
 * Query params:
 *   month=YYYY-MM  → returns all days in that month (bar chart)
 *   year=YYYY      → returns all days in that year  (heatmap)
 *   startDate / endDate (YYYY-MM-DD) for arbitrary ranges
 */
router.get('/daily-pnl', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { month, year, startDate, endDate } = req.query as Record<string, string | undefined>;

    // Read straight from the pre-computed DailyPnl table — no full order-cache scan
    // on the request path. Freshness is maintained by the scheduled refresh (every
    // 30 min) and by an immediate recompute whenever an order's status is marked.

    let start: string | undefined;
    let end: string | undefined;
    if (month) {
      start = `${month}-01`; end = `${month}-31`;
    } else if (year) {
      start = `${year}-01-01`; end = `${year}-12-31`;
    } else {
      start = startDate; end = endDate;
    }

    const records = await readDailyRange(dailyPnlStore, start, end);

    res.json({
      success: true,
      records: (records as any[]).map((r) => ({
        dateKey: r.dateKey,
        isCompleted: r.isCompleted,
        barChartProfit: r.barChartProfit,
        heatmapProfit: r.heatmapProfit,
        orderCount: r.orderCount,
        adSpend: r.adSpend,
      })),
    });
  } catch (error) {
    console.error('Error fetching daily P&L:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch daily P&L' });
  }
});

/**
 * POST /api/admin/sales/daily-pnl/backfill
 * Recompute DailyPnl for all dates.
 */
router.post('/daily-pnl/backfill', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await backfillDailyPnl();
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error backfilling daily P&L:', error);
    res.status(500).json({ success: false, error: 'Backfill failed' });
  }
});

/**
 * GET /api/admin/sales/breakeven-metrics
 * Compute breakeven ROAS metrics from completed days (last 30 days, DailyOrderStats + raw orders)
 */
router.get('/breakeven-metrics', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    // Read the pre-computed snapshot (refreshed by the scheduled job) — no order-cache
    // scan on the request path. Compute once on a cold snapshot to seed it.
    const snap = await breakevenStore.get('latest');
    if (snap && (snap as any).metrics) {
      return res.json({ success: true, ...(snap as any).metrics });
    }
    // Cold snapshot: seed it in the background (the compute scans the order cache and
    // is slow) and return zeros now, so this request stays fast. The next load is real.
    refreshBreakevenSnapshot().catch((e) => console.error('breakeven snapshot seed:', e));
    res.json({
      success: true, aov: 0, avgCOGS: 0, avgShipping: 0, avgTotalCost: 0,
      contributionMargin: 0, breakevenROAS: 0, deliveredCount: 0, failedCount: 0,
      totalOrders: 0, completedDaysCount: 0, computing: true,
    });
  } catch (error) {
    console.error('Error computing breakeven metrics:', error);
    res.status(500).json({ success: false, error: 'Failed to compute breakeven metrics' });
  }
});

/**
 * GET /api/admin/sales/ai-prediction-data?startDate=YYYY-MM-DD
 * Returns pre-computed sixMonthsStats and sixMonthsDailyData for AI profit prediction,
 * sourced from DailyOrderStats + DailyPnl — no raw order scan needed.
 */
router.get('/ai-prediction-data', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const startDate = (req.query.startDate as string) || '2026-02-01';

    const [orderStatsDocs, pnlDocs] = await Promise.all([
      readDailyRange(dailyOrderStatsStore, startDate),
      readDailyRange(dailyPnlStore, startDate),
    ]);

    // Build a pnl lookup by dateKey
    const pnlByDate = new Map<string, number>();
    for (const p of pnlDocs as any[]) {
      pnlByDate.set(p.dateKey as string, (p.heatmapProfit as number) ?? 0);
    }

    // Per-day data for AI context
    const sixMonthsDailyData = (orderStatsDocs as any[]).map((r) => ({
      date: r.dateKey as string,
      placed: (r.prepaidCount ?? 0) + (r.codCount ?? 0),
      delivered: r.deliveredCount ?? 0,
      failed: r.failedCount ?? 0,
    }));

    // Monthly aggregates
    const monthlyMap = new Map<string, {
      totalOrders: number;
      codOrders: number; prepaidOrders: number;
      codFailed: number; prepaidFailed: number;
      codDelivered: number; prepaidDelivered: number;
      totalPL: number;
    }>();

    for (const r of orderStatsDocs as any[]) {
      const monthKey = (r.dateKey as string).substring(0, 7);
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { totalOrders: 0, codOrders: 0, prepaidOrders: 0, codFailed: 0, prepaidFailed: 0, codDelivered: 0, prepaidDelivered: 0, totalPL: 0 });
      }
      const m = monthlyMap.get(monthKey)!;
      const prepaid = r.prepaidCount ?? 0;
      const cod = r.codCount ?? 0;
      m.totalOrders += prepaid + cod;
      m.prepaidOrders += prepaid;
      m.codOrders += cod;
      m.codDelivered += r.codDeliveredCount ?? 0;
      m.codFailed += r.codFailedCount ?? 0;
      // prepaid delivered/failed = total minus COD
      m.prepaidDelivered += Math.max(0, (r.deliveredCount ?? 0) - (r.codDeliveredCount ?? 0));
      m.prepaidFailed += Math.max(0, (r.failedCount ?? 0) - (r.codFailedCount ?? 0));
      m.totalPL += pnlByDate.get(r.dateKey as string) ?? 0;
    }

    const sixMonthsStats = Array.from(monthlyMap.entries()).map(([month, s]) => {
      const codFinal = s.codDelivered + s.codFailed;
      const prepaidFinal = s.prepaidDelivered + s.prepaidFailed;
      const totalFinal = codFinal + prepaidFinal;
      return {
        month,
        totalOrders: s.totalOrders,
        ndrRateTotal: totalFinal > 0 ? parseFloat(((s.codFailed + s.prepaidFailed) / totalFinal * 100).toFixed(1)) : 0,
        ndrRateCOD: codFinal > 0 ? parseFloat((s.codFailed / codFinal * 100).toFixed(1)) : 0,
        ndrRatePrepaid: prepaidFinal > 0 ? parseFloat((s.prepaidFailed / prepaidFinal * 100).toFixed(1)) : 0,
        totalPL: Math.round(s.totalPL),
      };
    }).sort((a, b) => a.month.localeCompare(b.month));

    res.json({ success: true, sixMonthsStats, sixMonthsDailyData });
  } catch (error) {
    console.error('Error fetching AI prediction data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch AI prediction data' });
  }
});

/**
 * GET /api/admin/sales/daily-averages?days=30
 * Returns per-day averages (revenue, COGS, ad spend, profit) and a rolled-up
 * summary for the requested window. Used by the Profit Prediction Calculator.
 * Source: DailyPnl — same numbers shown in the Sales page bar chart.
 */
router.get('/daily-averages', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);
    const startKey = startDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    const docs = await readDailyRange(dailyPnlStore, startKey);

    const daily = (docs as any[]).map((d) => {
      const orders = d.orderCount ?? 0;
      const revenue = d.totalRevenue ?? 0;
      const cogs = d.totalCogs ?? 0;
      const adSpend = d.adSpend ?? 0;
      const profit = d.barChartProfit ?? 0;
      const isCompleted = d.isCompleted ?? false;
      return {
        date: d.dateKey as string,
        orders,
        revenue,
        cogs,
        adSpend,
        profit,
        isCompleted,
        avgRevenuePerOrder: orders > 0 ? revenue / orders : 0,
        avgCogsPerOrder: orders > 0 ? (cogs + adSpend) / orders : 0,
        avgProfitPerOrder: orders > 0 ? profit / orders : 0,
        roas: adSpend > 0 ? revenue / adSpend : 0,
      };
    });

    // Summary averages use only completed days (isCompleted=true) — days where every
    // order has an explicit delivered/failed outcome, so the P&L is final and accurate.
    // Pending/in-transit orders have unknown final status and would skew the averages.
    const completedDays = daily.filter((d) => d.isCompleted);
    let totOrders = 0, totRevenue = 0, totCogs = 0, totAdSpend = 0, totProfit = 0;
    for (const d of completedDays) {
      totOrders += d.orders;
      totRevenue += d.revenue;
      totCogs += d.cogs;
      totAdSpend += d.adSpend;
      totProfit += d.profit;
    }

    const summary = {
      days,
      completedDays: completedDays.length,
      orders: totOrders,
      revenue: totRevenue,
      cogs: totCogs,
      adSpend: totAdSpend,
      profit: totProfit,
      avgRevenuePerOrder: totOrders > 0 ? totRevenue / totOrders : 0,
      avgCogsPerOrder: totOrders > 0 ? (totCogs + totAdSpend) / totOrders : 0,
      avgProfitPerOrder: totOrders > 0 ? totProfit / totOrders : 0,
      profitMargin: totRevenue > 0 ? (totProfit / totRevenue) * 100 : 0,
      roas: totAdSpend > 0 ? totRevenue / totAdSpend : 0,
    };

    res.json({ success: true, summary, daily });
  } catch (error) {
    console.error('Error fetching daily averages:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch daily averages' });
  }
});

/**
 * GET /api/admin/sales/backlog-orders
 * Lightweight endpoint for the Backlog Mosaic page.
 * Reads directly from ShopifyOrderCache, applies server-side filters (Jan 2026+,
 * non-cancelled), and returns only the 7 fields the mosaic needs.
 * No shipping charge lookups, no delivery-date lookups — ~20x smaller payload.
 */
router.get('/backlog-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Shopify created_at strings are ISO-8601 and sort lexicographically, so a
    // string prefix comparison ">=2026-01-01" correctly excludes pre-2026 orders.
    const BACKLOG_START_STR = '2026-01-01';

    // Aggregation pipeline: all heavy work (filter + field projection) runs inside
    // MongoDB so only the 7 needed fields for post-2026 non-cancelled orders are
    // transferred to Node.js — typically 10-20x less data than loading raw orders.
    const cacheEntries = await ShopifyOrderCache.aggregate([
      { $match: { cacheKey: { $regex: /^all_orders_/ } } },
      {
        $project: {
          _id: 0,
          orders: {
            $map: {
              // Filter to Jan 2026+ non-cancelled orders inside MongoDB
              input: {
                $filter: {
                  input: '$orders',
                  as: 'o',
                  cond: {
                    $and: [
                      { $not: [{ $ifNull: ['$$o.cancelled_at', false] }] },
                      { $gte: ['$$o.created_at', BACKLOG_START_STR] },
                    ],
                  },
                },
              },
              as: 'o',
              // Project only the 7 fields the mosaic needs
              in: {
                id: '$$o.id',
                name: '$$o.name',
                created_at: '$$o.created_at',
                fulfillment_status: '$$o.fulfillment_status',
                // Extract just the last fulfillment's shipment_status
                last_shipment_status: {
                  $getField: {
                    field: 'shipment_status',
                    input: { $arrayElemAt: [{ $ifNull: ['$$o.fulfillments', []] }, -1] },
                  },
                },
                // Customer name: prefer shipping_address.name, fallback to customer fields
                customer_name: {
                  $ifNull: [
                    '$$o.shipping_address.name',
                    {
                      $trim: {
                        input: {
                          $concat: [
                            { $ifNull: ['$$o.customer.first_name', ''] },
                            ' ',
                            { $ifNull: ['$$o.customer.last_name', ''] },
                          ],
                        },
                      },
                    },
                  ],
                },
                line_items: {
                  $map: {
                    input: { $ifNull: ['$$o.line_items', []] },
                    as: 'li',
                    in: {
                      title: '$$li.title',
                      quantity: '$$li.quantity',
                      variant_title: '$$li.variant_title',
                    },
                  },
                },
              },
            },
          },
        },
      },
    ]);

    // Deduplicate across cache chunks (there may be multiple all_orders_* entries)
    const seen = new Set<number | string>();
    const result: any[] = [];

    for (const entry of cacheEntries) {
      for (const o of (entry.orders ?? []) as any[]) {
        if (!o.id || seen.has(o.id)) continue;
        seen.add(o.id);

        const deliveryStatus: string | null =
          o.last_shipment_status || o.fulfillment_status || null;

        result.push({
          id: o.id,
          name: o.name,
          createdAt: o.created_at,
          fulfillmentStatus: o.fulfillment_status || null,
          deliveryStatus,
          customerName: o.customer_name || null,
          lineItems: (o.line_items as any[]) ?? [],
        });
      }
    }

    res.json({ success: true, orders: result });
  } catch (error) {
    console.error('Error fetching backlog orders:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch backlog orders' });
  }
});

/**
 * GET /api/admin/sales/failed-orders-analysis
 * Returns pre-aggregated stats for the Failed Orders analysis page.
 * All heavy computation (joining RTOOrder, DiscardedOrder, ShippingCharge,
 * bucketing into courier/city/delay categories) happens here on the server.
 * The frontend receives only 4 small stat objects instead of ~10k raw orders.
 */
router.get('/failed-orders-analysis', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const DATA_START = '2026-01-28';

    // Load all support data in parallel
    const [rtoRows, discardedRows, shippingRows, cacheEntries] = await Promise.all([
      RTOOrder.find({}, { shopifyOrderId: 1 }).lean(),
      DiscardedOrder.find({}, { orderId: 1 }).lean(),
      ShippingCharge.find({}, { orderNumber: 1, courierName: 1, pickupDate: 1, firstAttemptDate: 1, customerCity: 1 }).lean(),
      ShopifyOrderCache.aggregate([
        { $match: { cacheKey: { $regex: /^all_orders_/ } } },
        { $project: {
          orders: {
            $map: {
              input: { $filter: {
                input: '$orders', as: 'o',
                cond: { $and: [
                  { $not: [{ $ifNull: ['$$o.cancelled_at', false] }] },
                  { $gte: ['$$o.created_at', DATA_START] },
                ]},
              }},
              as: 'o',
              in: {
                id: '$$o.id',
                name: '$$o.name',
                created_at: '$$o.created_at',
                fulfillment_status: '$$o.fulfillment_status',
                shipment_status: { $ifNull: [
                  { $getField: { field: 'shipment_status', input: { $arrayElemAt: [{ $ifNull: ['$$o.fulfillments', []] }, -1] } } },
                  null,
                ]},
              },
            },
          },
        }},
      ]),
    ]);

    const rtoSet = new Set((rtoRows as any[]).map(r => r.shopifyOrderId as number));
    const discardedSet = new Set((discardedRows as any[]).map(d => d.orderId as number));

    // Build shipping map: normalise order number → { courierName, pickupDate, firstAttemptDate, city }
    const shipMap = new Map<string, { courierName: string | null; pickupDate: string | null; firstAttemptDate: string | null; city: string | null }>();
    for (const s of shippingRows as any[]) {
      const base = (s.orderNumber as string).replace(/^#/, '');
      const val = { courierName: s.courierName ?? null, pickupDate: s.pickupDate ?? null, firstAttemptDate: s.firstAttemptDate ?? null, city: s.customerCity ?? null };
      shipMap.set(base, val);
      shipMap.set(`#${base}`, val);
    }

    // Deduplicate orders across cache entries
    const seen = new Set<number>();
    const orders: Array<{ id: number; name: string; created_at: string; fulfillment_status: string | null; shipment_status: string | null }> = [];
    for (const entry of cacheEntries as any[]) {
      for (const o of (entry.orders ?? []) as any[]) {
        if (!o.id || seen.has(o.id)) continue;
        seen.add(o.id);
        orders.push(o);
      }
    }

    // Courier name normalisation
    const groupCourier = (name: string | null | undefined): string => {
      if (!name) return 'Unknown';
      const n = name.toLowerCase();
      if (n.includes('xpressbees')) return 'Xpressbees';
      if (n.includes('shadowfax'))  return 'Shadowfax';
      if (n.includes('amazon'))     return 'Amazon';
      if (n.includes('delhivery'))  return 'Delhivery';
      if (n.includes('blue dart') || n.includes('bluedart')) return 'Blue Dart';
      if (n.includes('ekart'))      return 'Ekart';
      if (n.includes('ecom'))       return 'Ecom Express';
      if (n.includes('dtdc'))       return 'DTDC';
      return name;
    };

    const diffDays = (a: string, b: string) => {
      const da = new Date(a); da.setHours(0, 0, 0, 0);
      const db = new Date(b); db.setHours(0, 0, 0, 0);
      return Math.max(0, Math.floor((db.getTime() - da.getTime()) / 86400000));
    };

    const pickupCat = (createdAt: string, pickupDate: string | null): string => {
      if (!pickupDate) return 'Not Picked Up';
      const d = diffDays(createdAt, pickupDate);
      if (d === 0) return '0 days (Same Day)';
      if (d === 1) return '1 day';
      if (d >= 5)  return '5+ days';
      return `${d} days`;
    };

    const attemptCat = (createdAt: string, firstAttemptDate: string | null): string => {
      if (!firstAttemptDate) return 'No Attempt Data';
      const d = diffDays(createdAt, firstAttemptDate);
      if (d === 0)  return '0 days (Same Day)';
      if (d >= 10)  return '10+ days';
      return `${d} days`;
    };

    type Stat = Record<string, { failed: number; total: number }>;
    const courierStats: Stat = {};
    const cityStats: Stat = {};
    const delayStats: Stat = {};
    const attemptStats: Stat = {};
    let failedCount = 0;

    for (const order of orders) {
      if (discardedSet.has(order.id)) continue;

      const shipInfo = shipMap.get(order.name) ?? shipMap.get(order.name.replace(/^#/, '')) ?? null;
      const deliveryStatus = (order.shipment_status || order.fulfillment_status || '').toLowerCase();
      const isFailed = rtoSet.has(order.id) || deliveryStatus === 'failure' || deliveryStatus.includes('failed') || deliveryStatus.includes('rto');

      const courier = groupCourier(shipInfo?.courierName);
      const city = (shipInfo?.city || 'Unknown').trim().toLowerCase();
      const pCat = pickupCat(order.created_at, shipInfo?.pickupDate ?? null);
      const aCat = attemptCat(order.created_at, shipInfo?.firstAttemptDate ?? null);

      if (!courierStats[courier]) courierStats[courier] = { failed: 0, total: 0 };
      courierStats[courier].total++;

      if (!cityStats[city]) cityStats[city] = { failed: 0, total: 0 };
      cityStats[city].total++;

      if (!delayStats[pCat]) delayStats[pCat] = { failed: 0, total: 0 };
      delayStats[pCat].total++;

      if (!attemptStats[aCat]) attemptStats[aCat] = { failed: 0, total: 0 };
      attemptStats[aCat].total++;

      if (isFailed) {
        courierStats[courier].failed++;
        cityStats[city].failed++;
        delayStats[pCat].failed++;
        attemptStats[aCat].failed++;
        failedCount++;
      }
    }

    res.json({ success: true, failedCount, courierStats, cityStats, delayStats, attemptStats });
  } catch (error) {
    console.error('Error fetching failed orders analysis:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch failed orders analysis' });
  }
});

/**
 * GET /api/admin/sales/variant-performance?days=30
 * Returns P&L broken down by variant (small/large) × payment (prepaid/COD).
 */
router.get('/variant-performance', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
    const buckets = await getVariantPerformance(days);

    const result = buckets.map(b => ({
      variant: b.variant,
      payment: b.payment,
      orders: b.orders,
      delivered: b.delivered,
      rto: b.rto,
      pending: b.pending,
      deliveryRate: b.orders > 0 ? (b.delivered / b.orders) * 100 : 0,
      rtoRate: b.orders > 0 ? (b.rto / b.orders) * 100 : 0,
      revenue: b.revenue,
      cogs: b.cogs,
      adSpend: b.adSpend,
      profit: b.profit,
      avgRevenuePerOrder: b.delivered > 0 ? b.revenue / b.delivered : 0,
      avgProfitPerOrder: b.orders > 0 ? b.profit / b.orders : 0,
      profitMargin: b.revenue > 0 ? (b.profit / b.revenue) * 100 : 0,
    }));

    res.json({ success: true, days, buckets: result });
  } catch (error) {
    console.error('Error fetching variant performance:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch variant performance' });
  }
});


export default router;
