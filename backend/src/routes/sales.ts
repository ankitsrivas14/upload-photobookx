import express, { Response } from 'express';
import { profitPredictionStore, reelStore, reelStrategyStore } from '../db/featureStores';
import { requireAdmin } from './adminAuth';
import { AuthenticatedRequest } from '../types';
import aiService from '../services/aiService';
import { backfillAllDates } from '../services/roasService';
import { backfillShippingStats } from '../services/shippingStatsService';
import { backfillOrderStats } from '../services/orderStatsService';
import { backfillDailyPnl, getVariantPerformance } from '../services/dailyPnlService';
import { computeBreakevenMetrics, refreshBreakevenSnapshot } from '../services/breakevenService';
import { dailyOrderStatsStore, dailyPnlStore, dailyShippingStore, dailyRoasStore, breakevenStore, readDailyRange } from '../db/dailyStores';
import { rtoStore, discardedStore, ackStore, ticketStore } from '../db/orderListStores';
import shopifyService from '../services/shopifyService';
import { recomputeDates } from '../services/aggregatesService';
import { markDatesDirty, orderDateKey } from '../db/aggregatesDirty';

const router = express.Router();

/** Mark the creation days of these orders for an aggregate recompute; returns those days. */
async function markOrderDatesDirty(orderIds: Array<string | number>): Promise<string[]> {
  const { getByIds } = await import('../db/ordersRepo');
  const orders = await getByIds(orderIds);
  const dates = [...new Set(orders.map(orderDateKey).filter((d): d is string => !!d))];
  await markDatesDirty(dates);
  return dates;
}

/**
 * GET /api/admin/sales/discarded-orders
 * Get all discarded order IDs
 */
router.get('/acknowledged-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const acknowledgedOrders = await ackStore.all();
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
    
    await ackStore.bulkSet(acknowledgedOrders);
    
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
    
    await ackStore.deleteMany(orderIds.map(String));
    
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
    const ticketOrders = await ticketStore.all();
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
    
    await ticketStore.bulkSet(ticketOrders);
    
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
    
    await ticketStore.deleteMany(orderIds.map(String));
    
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
    const discardedOrders = await discardedStore.all();
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
    
    await discardedStore.bulkSet(discardedOrders);
    
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
    
    await discardedStore.deleteMany(orderIds.map(String));
    
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
    const rtoOrders = await rtoStore.all();
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
    
    await rtoStore.bulkSet(rtoOrders);
    const rtoDates = await markOrderDatesDirty(orderIds);

    res.json({
      success: true,
      message: `${orderIds.length} order(s) marked as RTO`,
    });

    // RTO changes flip order delivery status — recompute those days' aggregates async
    recomputeDates(rtoDates).catch(console.error);
  } catch (error: any) {
    // Handle duplicate key errors gracefully
    if (error.code === 11000) {
      res.json({
        success: true,
        message: 'Orders marked as RTO (some were already marked)',
      });
      markOrderDatesDirty(req.body?.orderIds ?? []).then(recomputeDates).catch(console.error);
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
    
    await rtoStore.deleteMany(orderIds.map(String));
    const rtoDates = await markOrderDatesDirty(orderIds);

    res.json({
      success: true,
      message: `${orderIds.length} order(s) unmarked from RTO`,
    });

    recomputeDates(rtoDates).catch(console.error);
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
    const [prediction] = await profitPredictionStore.query([
      ['monthYear', '==', monthYear],
      ['status', '==', 'active'],
    ]);
    res.json({ success: true, prediction: prediction ?? null });
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
    await profitPredictionStore.updateWhere(
      [['monthYear', '==', monthYear], ['status', '==', 'active']],
      { status: 'archived', updatedAt: new Date() }
    );

    // Save new prediction
    const now = new Date();
    const prediction = await profitPredictionStore.create({
      monthYear,
      predictedFinalProfit: aiResult.predictedFinalProfit,
      predictedOrders: aiResult.predictedOrders ?? 0,
      predictedNDR: aiResult.predictedNDR ?? 0,
      reasoning: aiResult.reasoning,
      insight: (aiResult as any).insight, // Optional field
      lastUpdated: now,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });

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

      // 1. Search the shipping charges (fulfilled orders with Shiprocket customer data)
      const { searchByOrderOrCustomer, getMany: getCharges } = await import('../db/shippingRepo');
      const shippingMatches = await searchByOrderOrCustomer(query, 30);

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

      // 3. For orders found above that are missing a phone, take it from their shipping charge
      const currentOrders = Array.from(ordersMap.values());
      const namesMissingPhone = currentOrders
        .filter(o => !o.customerPhone)
        .map(o => o.name);

      if (namesMissingPhone.length > 0) {
        const extraShippingInfo = [...(await getCharges(namesMissingPhone)).values()];

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

// ─── Dashboard payloads ──────────────────────────────────────────────────────
// Built from the pre-computed daily docs. Shared by the per-widget routes below and by
// /dashboard-summary, which serves everything the Dashboard shows on open in one request.

// The monthly charts start after the partial January.
const MONTHLY_FROM = '2026-02-01';

const roasRecordsOf = (records: any[]) =>
  records.map((r) => ({
    dateKey: r.dateKey,
    revenue: r.revenue,
    adSpend: r.adSpend,
    roas: r.roas,
    updatedAt: r.updatedAt,
  }));

const shippingRecordsOf = (records: any[]) =>
  records.map((r) => ({
    dateKey: r.dateKey,
    avgShipping: r.avgShipping,
    avgShippingSmall: r.avgShippingSmall,
    avgShippingLarge: r.avgShippingLarge,
    orderCount: r.orderCount,
    smallCount: r.smallCount,
    largeCount: r.largeCount,
    updatedAt: r.updatedAt,
  }));

const pnlRecordsOf = (records: any[]) =>
  records.map((r) => ({
    dateKey: r.dateKey,
    isCompleted: r.isCompleted,
    barChartProfit: r.barChartProfit,
    heatmapProfit: r.heatmapProfit,
    orderCount: r.orderCount,
    adSpend: r.adSpend,
  }));

/** Order-distribution totals across the given days, plus the days already complete. */
function orderStatsTotals(records: any[]) {
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
  for (const r of records) {
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
  const completedDates = records.filter((r) => r.isCompleted).map((r) => r.dateKey as string);
  return { stats: agg, completedDates };
}

/**
 * Per-month totals of `valueOf` (oldest first), plus a "pace" benchmark: the average
 * accumulated by today's day-of-month across past complete months (excludes the current
 * month and the partial Jan).
 */
function monthlyTotals(stats: any[], valueOf: (s: any) => number) {
  const byMonth = new Map<string, number>();
  for (const s of stats) {
    const month = String(s.dateKey).substring(0, 7);
    byMonth.set(month, (byMonth.get(month) || 0) + valueOf(s));
  }
  const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const currentMonth = todayIST.substring(0, 7);
  const dayOfMonth = todayIST.substring(8, 10); // zero-padded 'DD'
  const paceByMonth = new Map<string, number>();
  for (const s of stats) {
    if (String(s.dateKey).substring(8, 10) > dayOfMonth) continue;
    const month = String(s.dateKey).substring(0, 7);
    if (month >= currentMonth) continue;
    paceByMonth.set(month, (paceByMonth.get(month) || 0) + valueOf(s));
  }
  const paceVals = [...paceByMonth.values()];
  const paceAverage = paceVals.length ? Math.round(paceVals.reduce((a, b) => a + b, 0) / paceVals.length) : 0;
  const entries = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return { entries, paceAverage, paceDay: Number(dayOfMonth) };
}

function monthlyOrderCountsOf(stats: any[]) {
  const t = monthlyTotals(stats, (s) => (s.prepaidCount || 0) + (s.codCount || 0));
  return { months: t.entries.map(([month, orders]) => ({ month, orders })), paceAverage: t.paceAverage, paceDay: t.paceDay };
}

function monthlyRevenueOf(stats: any[]) {
  const t = monthlyTotals(stats, (s) => s.grossRevenue || 0);
  return {
    months: t.entries.map(([month, revenue]) => ({ month, revenue: Math.round(revenue) })),
    paceAverage: t.paceAverage,
    paceDay: t.paceDay,
  };
}

/**
 * The breakeven snapshot the scheduled job keeps fresh. On a cold snapshot, seed it in the
 * background (the compute scans every order and is slow) and return zeros now, so the
 * request stays fast. The next load is real.
 */
async function breakevenMetrics(): Promise<Record<string, any>> {
  const snap = await breakevenStore.get('latest');
  if (snap && (snap as any).metrics) return (snap as any).metrics;
  refreshBreakevenSnapshot().catch((e) => console.error('breakeven snapshot seed:', e));
  return {
    aov: 0, avgCOGS: 0, avgShipping: 0, avgTotalCost: 0,
    contributionMargin: 0, breakevenROAS: 0, deliveredCount: 0, failedCount: 0,
    totalOrders: 0, completedDaysCount: 0, computing: true,
  };
}

/**
 * GET /api/admin/sales/dashboard-summary?month=YYYY-MM&year=YYYY&roasStart=&roasEnd=&statsStart=&statsEnd=
 * Everything the Dashboard shows on open, in one request: breakeven, ROAS, shipping, order
 * distribution, P&L (month and year) and monthly orders/revenue, each shaped like its own
 * route's response. Reads each daily collection once (the per-widget routes re-read the same
 * docs) and skips the Shopify sessions call, which the Dashboard doesn't use.
 */
router.get('/dashboard-summary', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = req.query as Record<string, string | undefined>;
    const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const month = q.month && /^\d{4}-\d{2}$/.test(q.month) ? q.month : todayIST.substring(0, 7);
    const year = q.year && /^\d{4}$/.test(q.year) ? q.year : todayIST.substring(0, 4);
    const statsStart = day(q.statsStart);
    const statsEnd = day(q.statsEnd);
    const statsFrom = statsStart && statsStart < MONTHLY_FROM ? statsStart : MONTHLY_FROM;

    const [statsDocs, pnlYearDocs, pnlMonthDocs, shippingDocs, roasDocs, breakeven] = await Promise.all([
      readDailyRange(dailyOrderStatsStore, statsFrom),
      readDailyRange(dailyPnlStore, `${year}-01-01`, `${year}-12-31`),
      // The month is normally inside the year; read it separately only when it isn't.
      month.startsWith(year) ? Promise.resolve(null) : readDailyRange(dailyPnlStore, `${month}-01`, `${month}-31`),
      readDailyRange(dailyShippingStore),
      readDailyRange(dailyRoasStore, day(q.roasStart), day(q.roasEnd)),
      breakevenMetrics(),
    ]);
    const statsInRange = statsDocs.filter(
      (r: any) => (!statsStart || r.dateKey >= statsStart) && (!statsEnd || r.dateKey <= statsEnd)
    );
    const monthlyStats = statsDocs.filter((r: any) => r.dateKey >= MONTHLY_FROM);
    const pnlMonth = pnlMonthDocs ?? pnlYearDocs.filter((r: any) => String(r.dateKey).startsWith(month));

    res.json({
      success: true,
      breakeven: { success: true, ...breakeven },
      roas: { success: true, records: roasRecordsOf(roasDocs) },
      shipping: { success: true, records: shippingRecordsOf(shippingDocs) },
      orderStats: { success: true, ...orderStatsTotals(statsInRange) },
      pnlMonth: { success: true, records: pnlRecordsOf(pnlMonth) },
      pnlYear: { success: true, records: pnlRecordsOf(pnlYearDocs) },
      monthlyOrderCounts: { success: true, ...monthlyOrderCountsOf(monthlyStats) },
      monthlyRevenue: { success: true, ...monthlyRevenueOf(monthlyStats) },
    });
  } catch (error) {
    console.error('Error building dashboard summary:', error);
    res.status(500).json({ success: false, error: 'Failed to build dashboard summary' });
  }
});

/**
 * GET /api/admin/sales/daily-roas
 * Fetch stored daily ROAS records. Optional query params: startDate, endDate (YYYY-MM-DD).
 */
router.get('/daily-roas', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

    // Pure read — DailyROAS is kept up to date on the WRITE paths instead: order and
    // ad-spend writes mark their days, and the scheduled jobs recompute those days
    // (see aggregatesService), so recomputing here on every FE load would be wasted work.
    const records = await readDailyRange(dailyRoasStore, startDate, endDate);

    res.json({ success: true, records: roasRecordsOf(records) });
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

    res.json({ success: true, records: shippingRecordsOf(records) });
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
    const { stats: agg, completedDates } = orderStatsTotals(records as any[]);

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
 * POST /api/admin/sales/firestore-sync-orders
 * Fast freshness: upsert the orders that changed in Shopify since the last sync (any age,
 * so late deliveries and RTOs land too) into Firestore — no 15MB Mongo round-trip.
 * `?days=N` instead re-pulls every order created in the last N days (manual backfill).
 */
router.post('/firestore-sync-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.query.days) {
      const { syncChangedOrders } = await import('../services/orderSyncService');
      const { fetched, written, since } = await syncChangedOrders();
      return res.json({ success: true, fetched, written, since });
    }
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
    // Read the daily docs from Feb 2026 and group by month in JS
    // (Firestore has no aggregation pipeline; the collection is tiny).
    const stats = await dailyOrderStatsStore.rangeByField('dateKey', MONTHLY_FROM);
    res.json({ success: true, ...monthlyOrderCountsOf(stats) });
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
    const stats = await dailyOrderStatsStore.rangeByField('dateKey', MONTHLY_FROM);
    res.json({ success: true, ...monthlyRevenueOf(stats) });
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
      rtoStore.all(),
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

    res.json({ success: true, records: pnlRecordsOf(records) });
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
    res.json({ success: true, ...(await breakevenMetrics()) });
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
 * Reads Firestore orders, applies server-side filters (Jan 2026+, non-cancelled), and
 * returns only the 7 fields the mosaic needs. No delivery-date lookups; the shipping
 * charges are read only for customer names.
 */
router.get('/backlog-orders', requireAdmin, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Shopify created_at strings are ISO-8601 and sort lexicographically, so a
    // string prefix comparison ">=2026-01-01" correctly excludes pre-2026 orders.
    const BACKLOG_START_STR = '2026-01-01';

    // Orders come from Firestore: the Mongo order cache this used to aggregate stopped
    // updating on 2026-09-22, when order sync moved to Firestore. Firestore keeps orders
    // trimmed (no customer names), so names come from the Shiprocket charges, as on the
    // Sales page. Only the fields the mosaic needs go over the wire.
    const { getCreatedBetween } = await import('../db/ordersRepo');
    const { getMany } = await import('../db/shippingRepo');
    const orders = (await getCreatedBetween(BACKLOG_START_STR)).filter((o: any) => !o.cancelled_at);
    const charges = await getMany(orders.map((o: any) => o.name));

    const result = orders.map((o: any) => {
      const fulfillments: any[] = Array.isArray(o.fulfillments) ? o.fulfillments : [];
      const lastShipmentStatus = fulfillments[fulfillments.length - 1]?.shipment_status;
      const customerName =
        charges.get(String(o.name || '').replace(/^#/, ''))?.customerName ||
        o.shipping_address?.name ||
        `${o.customer?.first_name ?? ''} ${o.customer?.last_name ?? ''}`.trim();
      return {
        id: o.id,
        name: o.name,
        createdAt: o.created_at,
        fulfillmentStatus: o.fulfillment_status || null,
        deliveryStatus: lastShipmentStatus || o.fulfillment_status || null,
        customerName: customerName || null,
        lineItems: ((o.line_items as any[]) ?? []).map((li) => ({
          title: li.title,
          quantity: li.quantity,
          variantTitle: li.variant_title ?? null,
        })),
      };
    });

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

    // Load all support data from Firestore in parallel
    const { getAll } = await import('../db/ordersRepo');
    const { getAllDocs: getAllShipping } = await import('../db/shippingRepo');
    const [rtoRows, discardedRows, shippingRows, allOrders] = await Promise.all([
      rtoStore.all(),
      discardedStore.all(),
      getAllShipping(),
      getAll(),
    ]);

    const rtoSet = new Set((rtoRows as any[]).map(r => r.shopifyOrderId as number));
    const discardedSet = new Set((discardedRows as any[]).map(d => Number(d.shopifyOrderId)));

    // Build shipping map: normalise order number → { courierName, pickupDate, firstAttemptDate, city }
    const shipMap = new Map<string, { courierName: string | null; pickupDate: string | null; firstAttemptDate: string | null; city: string | null }>();
    for (const s of shippingRows as any[]) {
      const base = (s.orderNumber as string).replace(/^#/, '');
      const val = { courierName: s.courierName ?? null, pickupDate: s.pickupDate ?? null, firstAttemptDate: s.firstAttemptDate ?? null, city: s.customerCity ?? null };
      shipMap.set(base, val);
      shipMap.set(`#${base}`, val);
    }

    // Slim the Firestore orders to the shape this analysis needs.
    const orders = (allOrders as any[])
      .filter((o) => o.id && !o.cancelled_at && (o.created_at ?? '') >= DATA_START)
      .map((o) => ({
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        fulfillment_status: o.fulfillment_status ?? null,
        shipment_status: o.fulfillments?.length
          ? (o.fulfillments[o.fulfillments.length - 1].shipment_status ?? null)
          : null,
      }));

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
