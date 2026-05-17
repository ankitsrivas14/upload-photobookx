import express, { Response } from 'express';
import { DiscardedOrder, RTOOrder, ProfitPrediction, ShippingCharge, OrderDeliveryDate, ShopifyOrderCache, MetaAdPerformance, MetaAdAnalysis, AcknowledgedOrder, TicketRaisedOrder, DailyROAS, DailyShipping, DailyOrderStats, DailyPnl } from '../models';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';
import aiService from '../services/aiService';
import { backfillAllDates } from '../services/roasService';
import { backfillShippingStats } from '../services/shippingStatsService';
import { backfillOrderStats } from '../services/orderStatsService';
import { backfillDailyPnl } from '../services/dailyPnlService';

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

      // 2. Search in ShopifyOrderCache for unfulfilled or new orders
      // We look for any "all_orders" cache entry which contains the most orders
      const newestCache = await ShopifyOrderCache.findOne({
        cacheKey: { $regex: /^all_orders_/ }
      }).sort({ cachedAt: -1 });

      if (newestCache && Array.isArray(newestCache.orders)) {
        for (const o of newestCache.orders) {
          if (ordersMap.size >= 50) break;
          
          const name = (o.name || '').toString();
          const cleanName = name.replace(/^#/, '');
          
          const firstName = o.customer?.first_name || '';
          const lastName = o.customer?.last_name || '';
          const custName = `${firstName} ${lastName}`.trim() || 'N/A';
          const email = (o.email || '').toLowerCase();
          
          if (
            cleanName.toLowerCase().includes(cleanNumQuery) || 
            custName.toLowerCase().includes(lowerQuery) ||
            email.includes(lowerQuery)
          ) {
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
      const message = await aiService.generateIncompleteAddressMessage({ customerName, orderNumber });
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
          outboundClicks
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

      adData = filteredAdData; // Resign back for the loop

      const latestDate = adData?.[0]?.date || new Date().toISOString().split('T')[0];

      const BATCH_SIZE = 12;
      const allRecommendations: any[] = [];
      let overallStrategies: string[] = [];

      // Process in batches to avoid OpenAI output token limits
      for (let i = 0; i < adData.length; i += BATCH_SIZE) {
        const batch = adData.slice(i, i + BATCH_SIZE);
        const batchNames = batch.map((d: any) => d.name).filter(Boolean);
        
        // Fetch history ONLY for the current batch's ad sets
        const batchHistoricalData = await MetaAdPerformance.find({
          name: { $in: batchNames },
          date: { $ne: latestDate }
        })
        .sort({ date: -1 })
        .limit(1000); // 1000 points of history for 50 adsets is plenty (~20 days each)

        console.log(`Analyzing Batch ${Math.floor(i / BATCH_SIZE) + 1}... (${batch.length} items)`);
        
        const result = await aiService.analyzeAdsData(batch, batchHistoricalData);
        if (result.recommendations) {
          allRecommendations.push(...result.recommendations);
        }
        if (result.overallStrategy) {
          overallStrategies.push(result.overallStrategy);
        }
      }

      console.log(`Total Final Recommendations: ${allRecommendations.length}`);
      
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

      // Call AI Chat
      const aiResponse = await aiService.chatWithAdsStrategist(
        userQuestion,
        adData,
        historicalData,
        analysis.chat || []
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
    const filter: Record<string, any> = {};
    if (startDate || endDate) {
      filter.dateKey = {};
      if (startDate) filter.dateKey.$gte = startDate;
      if (endDate) filter.dateKey.$lte = endDate;
    }

    const records = await DailyROAS.find(filter).sort({ dateKey: 1 }).lean();

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
    const filter: Record<string, any> = {};
    if (startDate || endDate) {
      filter.dateKey = {};
      if (startDate) filter.dateKey.$gte = startDate;
      if (endDate) filter.dateKey.$lte = endDate;
    }

    const records = await DailyShipping.find(filter).sort({ dateKey: 1 }).lean();

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
    const filter: Record<string, any> = {};
    if (startDate || endDate) {
      filter.dateKey = {};
      if (startDate) filter.dateKey.$gte = startDate;
      if (endDate) filter.dateKey.$lte = endDate;
    }

    const records = await DailyOrderStats.find(filter).sort({ dateKey: 1 }).lean();

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

    const completedDates = (records as any[]).filter((r) => r.isCompleted).map((r) => r.dateKey as string);

    res.json({ success: true, stats: agg, completedDates });
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
    const filter: Record<string, any> = {};

    if (month) {
      // YYYY-MM → match dateKey starting with that prefix
      filter.dateKey = { $gte: `${month}-01`, $lte: `${month}-31` };
    } else if (year) {
      filter.dateKey = { $gte: `${year}-01-01`, $lte: `${year}-12-31` };
    } else if (startDate || endDate) {
      filter.dateKey = {};
      if (startDate) filter.dateKey.$gte = startDate;
      if (endDate) filter.dateKey.$lte = endDate;
    }

    const records = await DailyPnl.find(filter).sort({ dateKey: 1 }).lean();

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

export default router;
