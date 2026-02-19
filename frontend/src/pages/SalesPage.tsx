import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import styles from './SalesPage.module.css';
import { OrdersTableBody } from './SalesPage/OrdersTableBody';

interface ShippingChargeBreakdown {
  freightForward: number;
  freightCOD: number;
  freightRTO: number;
  whatsappCharges: number;
  otherCharges: number;
}

interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  createdAt: string;
  fulfillmentStatus?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  trackingUrl?: string | null;
  paymentMethod?: string;
  maxUploads: number;
  totalPrice?: number;
  shippingCharge?: number;
  shippingBreakdown?: ShippingChargeBreakdown;
  cancelledAt?: string | null;
  lineItems?: Array<{
    title: string;
    quantity: number;
    variantTitle?: string;
  }>;
}

interface COGSField {
  id: string;
  name: string;
  // Old structure (deprecated)
  smallValue?: number;
  largeValue?: number;
  // New structure with payment method support
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  percentageType: 'included' | 'excluded';
}

interface COGSBreakdown {
  fieldName: string;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  value: number;
  calculatedCost: number;
}

// Store timezone for order date (match Shopify reports: India = Asia/Kolkata)
const STORE_TIMEZONE = 'Asia/Kolkata';

/** Order date as YYYY-MM-DD in store timezone so daily revenue matches Shopify (e.g. "Yesterday") */
function getOrderDateKey(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

// Helper function to format numbers with Indian comma notation
const formatIndianNumber = (num: number, decimals: number = 2): string => {
  const [integerPart, decimalPart] = num.toFixed(decimals).split('.');
  
  // Indian numbering system: First 3 digits, then groups of 2
  let lastThree = integerPart.substring(integerPart.length - 3);
  const otherNumbers = integerPart.substring(0, integerPart.length - 3);
  
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  
  let result = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
  
  if (decimals > 0 && decimalPart) {
    result += '.' + decimalPart;
  }
  
  return result;
};

export function SalesPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [discardedOrderIds, setDiscardedOrderIds] = useState<Set<number>>(new Set());
  const [rtoOrderIds, setRTOOrderIds] = useState<Set<number>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('current'); // 'all', 'current', or 'YYYY-MM' - Default to current month
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Status filters (AND filters)
  const [showUnfulfilled, setShowUnfulfilled] = useState(false);
  const [showDelivered, setShowDelivered] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const [showAttemptedDelivery, setShowAttemptedDelivery] = useState(false);
  const [showInTransit, setShowInTransit] = useState(false);
  const [showOutForDelivery, setShowOutForDelivery] = useState(false);
  
  // Pending drawer
  const [showPendingDrawer, setShowPendingDrawer] = useState(false);
  const [pendingFilterCOD, setPendingFilterCOD] = useState(false);
  const [pendingFilterPaid, setPendingFilterPaid] = useState(false);
  const [pendingFilterDelayDays, setPendingFilterDelayDays] = useState<Set<number>>(new Set());
  const [showDelayDropdown, setShowDelayDropdown] = useState(false);
  
  // COGS Calculator Modal State
  const [showCogsModal, setShowCogsModal] = useState(false);
  const [selectedOrderForCogs, setSelectedOrderForCogs] = useState<ShopifyOrder | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<'small' | 'large'>('small');
  const [cogsConfig, setCogsConfig] = useState<COGSField[]>([]);
  const [cogsBreakdown, setCogsBreakdown] = useState<COGSBreakdown[]>([]);
  
  // Delivery Status Update Modal State
  const [showDeliveryStatusModal, setShowDeliveryStatusModal] = useState(false);
  const [selectedOrderForStatus, setSelectedOrderForStatus] = useState<{id: number; name: string} | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  
  // Per-order P/L cache (orderId -> profit/loss)
  const [orderProfitLoss, setOrderProfitLoss] = useState<Map<number, number>>(new Map());

  // Ad cost per order by date (YYYY-MM-DD -> cost). Used to deduct Meta ad cost from P/L.
  const [adCostPerOrderByDate, setAdCostPerOrderByDate] = useState<Record<string, number>>({});
  // Ad spend by date (YYYY-MM-DD -> total amount). Used to show "Ad spend" in day header row.
  const [adSpendByDate, setAdSpendByDate] = useState<Record<string, number>>({});

  useEffect(() => {
    loadData();
  }, []);

  // Close delay dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showDelayDropdown && !target.closest(`.${styles['dropdown-container']}`)) {
        setShowDelayDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDelayDropdown]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [ordersResponse, discardedResponse, rtoResponse, cogsConfigResponse, adSpendResponse] = await Promise.all([
        api.getOrders(1000, true), // Fetch ALL orders (no date filter)
        api.getDiscardedOrderIds(),
        api.getRTOOrderIds(),
        api.getCOGSConfiguration(),
        api.getDailyAdSpend(),
      ]);
      
      if (ordersResponse.success && ordersResponse.orders) {
        console.log(`Loaded ${ordersResponse.orders.length} orders from API`);
        
        // Debug: Check date range of fetched orders
        if (ordersResponse.orders.length > 0) {
          const dates = ordersResponse.orders.map(o => new Date(o.createdAt).toISOString().split('T')[0]);
          const uniqueDates = [...new Set(dates)].sort();
          console.log(`Frontend: Order dates range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`);
          
          // Count orders per date
          const dateCounts: Record<string, number> = {};
          dates.forEach(d => {
            dateCounts[d] = (dateCounts[d] || 0) + 1;
          });
          console.log('Frontend: Orders per date:', dateCounts);
        }
        
        // Debug: Log delivery statuses to understand what we're getting
        const deliveryStatusCounts: Record<string, number> = {};
        const fulfillmentStatusCounts: Record<string, number> = {};
        let unfulfilledCount = 0;
        let deliveredCount = 0;
        let failedCount = 0;
        
        let cancelledCount = 0;
        
        ordersResponse.orders.forEach(order => {
          // Skip cancelled orders in categorization
          if (order.cancelledAt) {
            cancelledCount++;
            return;
          }
          
          const deliveryStatus = order.deliveryStatus || 'no_delivery_status';
          const fulfillmentStatus = order.fulfillmentStatus || 'no_fulfillment_status';
          
          deliveryStatusCounts[deliveryStatus] = (deliveryStatusCounts[deliveryStatus] || 0) + 1;
          fulfillmentStatusCounts[fulfillmentStatus] = (fulfillmentStatusCounts[fulfillmentStatus] || 0) + 1;
          
          // Categorize
          const deliveryStatusLower = order.deliveryStatus?.toLowerCase() || '';
          const fulfillmentStatusLower = order.fulfillmentStatus?.toLowerCase() || '';
          
          if (deliveryStatusLower === 'delivered') {
            deliveredCount++;
          } else if (deliveryStatusLower === 'failure') {
            failedCount++;
          } else if (!fulfillmentStatusLower || fulfillmentStatusLower === '' || fulfillmentStatusLower === 'unfulfilled') {
            unfulfilledCount++;
          }
        });
        
        console.log('Delivery status breakdown:', deliveryStatusCounts);
        console.log('Fulfillment status breakdown:', fulfillmentStatusCounts);
        console.log('Filter categories:', {
          unfulfilled: unfulfilledCount,
          delivered: deliveredCount,
          failed: failedCount,
          cancelled: cancelledCount,
          other: ordersResponse.orders.length - unfulfilledCount - deliveredCount - failedCount - cancelledCount
        });
        
        // Orders already include shipping breakdown from AWB data
        // (Wallet transactions API not available for this account)
        setOrders(ordersResponse.orders);
      }
      
      if (discardedResponse.success) {
        setDiscardedOrderIds(new Set(discardedResponse.discardedOrderIds));
      }
      
      if (rtoResponse.success) {
        setRTOOrderIds(new Set(rtoResponse.rtoOrderIds));
      }
      
      if (cogsConfigResponse && cogsConfigResponse.fields) {
        setCogsConfig(cogsConfigResponse.fields);
      }

      // Build ad cost per order by date (for P/L deduction)
      const ordersList = ordersResponse.success && ordersResponse.orders ? ordersResponse.orders : [];
      const adSpendEntries = adSpendResponse.success && adSpendResponse.entries ? adSpendResponse.entries : [];
      const orderCountByDate: Record<string, number> = {};
      ordersList.forEach((o) => {
        if (o.cancelledAt) return;
        const d = getOrderDateKey(o.createdAt);
        orderCountByDate[d] = (orderCountByDate[d] || 0) + 1;
      });
      const adSpendByDate: Record<string, number> = {};
      adSpendEntries.forEach((e) => {
        const d = new Date(e.date).toISOString().split('T')[0];
        adSpendByDate[d] = (adSpendByDate[d] || 0) + e.amount;
      });
      const adCostPerOrder: Record<string, number> = {};
      Object.keys(adSpendByDate).forEach((d) => {
        const count = orderCountByDate[d] || 0;
        if (count > 0) adCostPerOrder[d] = adSpendByDate[d] / count;
      });
      console.log('Ad spend by date:', adSpendByDate);
      console.log('Order count by date:', orderCountByDate);
      setAdCostPerOrderByDate(adCostPerOrder);
      setAdSpendByDate(adSpendByDate);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Step 1: Clear both caches
      await Promise.all([
        api.clearOrdersCache(),
        api.clearShippingChargesCache()
      ]);
      
      // Step 2: Load fresh orders (ALL orders, no date filter)
      const response = await api.getOrders(1000, true);
      
      // Step 3: Bulk sync shipping charges (fast - fetches all Shiprocket orders once)
      if (response.success && response.orders) {
        const orderNumbers = response.orders.map((o: any) => o.name);
        await api.syncShippingCharges(orderNumbers);
      }
      
      // Step 4: Reload to get updated data with shipping breakdown
      await loadData();
    } catch (err) {
      console.error('Failed to refresh data:', err);
      alert('Failed to refresh data. Please try again.');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
    setSelectAll(!selectAll);
  };

  const handleSelectOrder = (orderId: number) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
    setSelectAll(newSelected.size === filteredOrders.length);
  };

  // Get available months from orders (store timezone)
  const getAvailableMonths = () => {
    const monthsSet = new Set<string>();
    orders.forEach(order => {
      const dateKey = getOrderDateKey(order.createdAt);
      monthsSet.add(dateKey.substring(0, 7)); // YYYY-MM
    });
    return Array.from(monthsSet).sort().reverse();
  };

  const availableMonths = getAvailableMonths();

  // Helper function to check order status
  const getOrderStatus = (order: ShopifyOrder) => {
    const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
    
    // Failed statuses: failure, RTO-related (attempted_delivery excluded)
    const isFailed = rtoOrderIds.has(order.id) ||
                     deliveryStatus === 'failure' ||
                     deliveryStatus.includes('failed') ||
                     deliveryStatus.includes('rto');
    
    // Delivered statuses: delivered only
    const isDelivered = deliveryStatus === 'delivered';
    
    // Attempted delivery: delivery was attempted but not completed
    const isAttemptedDelivery = deliveryStatus === 'attempted_delivery';
    
    // Out for delivery: explicitly out_for_delivery status
    const isOutForDelivery = deliveryStatus === 'out_for_delivery';
    
    // Unfulfilled: Check fulfillmentStatus first (null, '', or 'unfulfilled' means not fulfilled)
    const isUnfulfilled = !fulfillmentStatus ||
                          fulfillmentStatus === '' ||
                          fulfillmentStatus === 'unfulfilled';
    
    // In transit: fulfilled but not delivered, failed, attempted_delivery, or out_for_delivery
    const isInTransit = !isUnfulfilled && !isDelivered && !isFailed && !isAttemptedDelivery && !isOutForDelivery;
    
    return { isFailed, isDelivered, isUnfulfilled, isAttemptedDelivery, isInTransit, isOutForDelivery };
  };

  // Orders for stats: month filter + exclude discarded/cancelled only (no status filter). Header stats never change when status filters are applied.
  const getOrdersForStats = () => {
    let filtered = orders.filter(order =>
      !discardedOrderIds.has(order.id) && !order.cancelledAt
    );
    if (selectedMonthFilter !== 'all') {
      let targetMonth: number;
      let targetYear: number;
      if (selectedMonthFilter === 'current') {
        targetMonth = new Date().getMonth();
        targetYear = new Date().getFullYear();
      } else {
        const [year, month] = selectedMonthFilter.split('-');
        targetYear = parseInt(year);
        targetMonth = parseInt(month) - 1;
      }
      filtered = filtered.filter(order => {
        const [y, m] = getOrderDateKey(order.createdAt).split('-').map(Number);
        return y === targetYear && m - 1 === targetMonth;
      });
    }
    return filtered;
  };

  const ordersForStats = getOrdersForStats();

  // Filter orders based on selected month, status filters, and exclude discarded/cancelled orders
  const getFilteredOrders = () => {
    let filtered = ordersForStats;
    // Apply status filters (works with month filter via AND, multiple status filters use OR)
    if (showUnfulfilled || showDelivered || showFailed || showAttemptedDelivery || showInTransit || showOutForDelivery) {
      filtered = filtered.filter(order => {
        const { isFailed, isDelivered, isUnfulfilled, isAttemptedDelivery, isInTransit, isOutForDelivery } = getOrderStatus(order);
        const matchesUnfulfilled = showUnfulfilled && isUnfulfilled;
        const matchesDelivered = showDelivered && isDelivered;
        const matchesFailed = showFailed && isFailed;
        const matchesAttemptedDelivery = showAttemptedDelivery && isAttemptedDelivery;
        const matchesInTransit = showInTransit && isInTransit;
        const matchesOutForDelivery = showOutForDelivery && isOutForDelivery;
        return matchesUnfulfilled || matchesDelivered || matchesFailed || matchesAttemptedDelivery || matchesInTransit || matchesOutForDelivery;
      });
    }
    return filtered;
  };

  const filteredOrders = getFilteredOrders();

  const hasStatusFilter =
    showUnfulfilled || showDelivered || showFailed || showAttemptedDelivery || showInTransit || showOutForDelivery;

  // Whether a date (YYYY-MM-DD) falls within the selected month filter
  const isDateInSelectedMonth = (dateKey: string): boolean => {
    if (selectedMonthFilter === 'all') return true;
    let targetMonth: number;
    let targetYear: number;
    if (selectedMonthFilter === 'current') {
      targetMonth = new Date().getMonth();
      targetYear = new Date().getFullYear();
    } else {
      const [y, m] = selectedMonthFilter.split('-');
      targetYear = parseInt(y);
      targetMonth = parseInt(m) - 1;
    }
    const [y, m] = dateKey.split('-').map(Number);
    return y === targetYear && m - 1 === targetMonth;
  };

  // Group filtered orders by date; include ad-spend-only dates only when they're in the selected month
  // Global NDR rate from ALL orders (not filtered by month) — for expected NDR per day
  const globalNdrRate = (() => {
    let delivered = 0;
    let failed = 0;
    orders.forEach((o) => {
      if (o.cancelledAt || discardedOrderIds.has(o.id)) return;
      const status = o.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed =
        rtoOrderIds.has(o.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      if (isDelivered) delivered++;
      else if (isFailed) failed++;
    });
    const finalCount = delivered + failed;
    return finalCount > 0 ? (failed / finalCount) * 100 : 0;
  })();

  // Average P/L per final-status order (all orders) — for estimated P/L per day
  const avgPnlPerFinalOrder = (() => {
    let totalPnl = 0;
    let count = 0;
    orders.forEach((o) => {
      if (o.cancelledAt || discardedOrderIds.has(o.id)) return;
      const status = o.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed =
        rtoOrderIds.has(o.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      if (isDelivered || isFailed) {
        totalPnl += orderProfitLoss.get(o.id) ?? 0;
        count++;
      }
    });
    return count > 0 ? totalPnl / count : 0;
  })();

  const ordersGroupedByDate = (() => {
    const byDate: Record<string, ShopifyOrder[]> = {};
    filteredOrders.forEach((order) => {
      const dateKey = getOrderDateKey(order.createdAt);
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(order);
    });
    Object.keys(adSpendByDate).forEach((dateKey) => {
      if (!isDateInSelectedMonth(dateKey)) return;
      if (!byDate[dateKey]) byDate[dateKey] = [];
    });
    
    const grouped = Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, orders]) => ({
        dateKey,
        dateLabel: new Date(dateKey + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        orders,
        adSpend: adSpendByDate[dateKey] ?? 0,
      }));
    
    // Debug logging
    console.log('Orders grouped by date:', grouped.map(g => ({ date: g.dateKey, orderCount: g.orders.length, adSpend: g.adSpend })));
    console.log('Total ordersForStats:', ordersForStats.length);
    console.log('Filtered orders:', filteredOrders.length);
    
    // Log ordersForStats date breakdown
    if (ordersForStats.length > 0) {
      const statsDateCounts: Record<string, number> = {};
      ordersForStats.forEach(o => {
        const d = getOrderDateKey(o.createdAt);
        statsDateCounts[d] = (statsDateCounts[d] || 0) + 1;
      });
      console.log('OrdersForStats by date (after month filter):', statsDateCounts);
    }
    
    return grouped;
  })();

  // Clear selections when filters change
  useEffect(() => {
    setSelectedOrders(new Set());
    setSelectAll(false);
  }, [selectedMonthFilter, showUnfulfilled, showDelivered, showFailed, showAttemptedDelivery, showInTransit, showOutForDelivery]);

  // Calculate pending products from unfulfilled orders
  const getPendingProducts = () => {
    // Products to ignore (accessories/add-ons)
    const ignoredProducts = [
      'printed photos - ready to paste',
      'pocket to keep your souvenirs',
      'gift wrap'
    ];

    // Get unfulfilled orders (not cancelled, not discarded, fulfillmentStatus is null/unfulfilled)
    let unfulfilledOrders = orders.filter(order => 
      !order.cancelledAt && 
      !discardedOrderIds.has(order.id) &&
      (!order.fulfillmentStatus || order.fulfillmentStatus.toLowerCase() === 'unfulfilled')
    );

    // Apply payment method filters
    if (pendingFilterCOD || pendingFilterPaid) {
      unfulfilledOrders = unfulfilledOrders.filter(order => {
        if (pendingFilterCOD && order.paymentMethod === 'COD') return true;
        if (pendingFilterPaid && order.paymentMethod === 'Prepaid') return true;
        return false;
      });
    }

    // Apply delay days filter
    if (pendingFilterDelayDays.size > 0) {
      unfulfilledOrders = unfulfilledOrders.filter(order => {
        const delayDays = getDelayDaysIncludingZero(order);
        return delayDays !== null && pendingFilterDelayDays.has(delayDays);
      });
    }

    // Helper to extract numeric part from order name (e.g., "#PB1123S" -> "1123")
    const extractOrderNumber = (orderName: string | undefined): string => {
      if (!orderName) return 'N/A';
      // Remove # prefix if present, then extract numbers
      const cleanName = orderName.replace('#', '');
      const match = cleanName.match(/\d+/);
      return match ? match[0] : cleanName;
    };

    // Aggregate products by variant
    const productCounts: Record<string, { 
      title: string; 
      variantTitle: string; 
      count: number; 
      orderNumbers: string[] 
    }> = {};

    unfulfilledOrders.forEach(order => {
      order.lineItems?.forEach(item => {
        // Skip ignored products
        if (ignoredProducts.includes(item.title.toLowerCase())) {
          return;
        }

        const key = `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ''}`;
        const orderNum = extractOrderNumber(order.name);
        
        if (productCounts[key]) {
          productCounts[key].count += item.quantity;
          if (!productCounts[key].orderNumbers.includes(orderNum)) {
            productCounts[key].orderNumbers.push(orderNum);
          }
        } else {
          productCounts[key] = {
            title: item.title,
            variantTitle: item.variantTitle || '',
            count: item.quantity,
            orderNumbers: [orderNum],
          };
        }
      });
    });

    // Convert to array and sort by count (descending)
    return Object.values(productCounts).sort((a, b) => b.count - a.count);
  };

  // Calculate stats from ordersForStats (month only, no status filter) so header stats don't change when filters are applied
  const calculateStats = () => {
    const totalOrders = ordersForStats.length;
    let ndrCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let attemptedDeliveryCount = 0;
    let inTransitCount = 0;
    let outForDeliveryCount = 0;
    let unfulfilledCount = 0;
    let prepaidCount = 0;
    let codCount = 0;
    let deliveredPrepaidCount = 0;
    let deliveredCODCount = 0;
    let failedPrepaidCount = 0;
    let failedCODCount = 0;
    let attemptedDeliveryPrepaidCount = 0;
    let attemptedDeliveryCODCount = 0;
    let inTransitPrepaidCount = 0;
    let inTransitCODCount = 0;
    let outForDeliveryPrepaidCount = 0;
    let outForDeliveryCODCount = 0;
    let unfulfilledPrepaidCount = 0;
    let unfulfilledCODCount = 0;
    let fulfilledCount = 0;

    ordersForStats.forEach(order => {
      // Count prepaid vs COD (total)
      if (order.paymentMethod === 'Prepaid') {
        prepaidCount++;
      } else {
        codCount++;
      }

      // Check delivery status
      const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
      
      // Check if failed/NDR
      const isFailed = rtoOrderIds.has(order.id) ||
                      deliveryStatus === 'failure' ||
                      deliveryStatus.includes('failed') ||
                      deliveryStatus.includes('rto');

      // Check if order has been fulfilled (shipped)
      // Use fulfillment_status - if it's 'fulfilled' or 'partial', the order has been fulfilled
      const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
      const isFulfilledStatus = fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'partial';

      if (isFulfilledStatus) {
        fulfilledCount++;
      }

      // Determine delivery status category
      const isDelivered = deliveryStatus === 'delivered';
      
      // Count orders by delivery status
      if (isFailed) {
        // Failed/NDR orders
        ndrCount++;
        failedCount++;
        if (order.paymentMethod === 'Prepaid') {
          failedPrepaidCount++;
        } else {
          failedCODCount++;
        }
      } else if (isDelivered) {
        // Successfully delivered orders
        deliveredCount++;
        if (order.paymentMethod === 'Prepaid') {
          deliveredPrepaidCount++;
        } else {
          deliveredCODCount++;
        }
      } else if (deliveryStatus === 'attempted_delivery') {
        // Attempted delivery (fulfilled, delivery attempted but not completed)
        attemptedDeliveryCount++;
        if (order.paymentMethod === 'Prepaid') {
          attemptedDeliveryPrepaidCount++;
        } else {
          attemptedDeliveryCODCount++;
        }
      } else if (deliveryStatus === 'out_for_delivery') {
        // Out for delivery (fulfilled and on the way to customer)
        outForDeliveryCount++;
        if (order.paymentMethod === 'Prepaid') {
          outForDeliveryPrepaidCount++;
        } else {
          outForDeliveryCODCount++;
        }
      } else if (isFulfilledStatus) {
        // In transit (fulfilled but not delivered, failed, attempted_delivery, or out_for_delivery)
        inTransitCount++;
        if (order.paymentMethod === 'Prepaid') {
          inTransitPrepaidCount++;
        } else {
          inTransitCODCount++;
        }
      } else {
        // Unfulfilled orders (not yet shipped)
        unfulfilledCount++;
        if (order.paymentMethod === 'Prepaid') {
          unfulfilledPrepaidCount++;
        } else {
          unfulfilledCODCount++;
        }
      }
    });

    // Calculate NDR Rate based on delivered + failed orders (final status only)
    const finalStatusCount = deliveredCount + failedCount;
    const ndrRate = finalStatusCount > 0 ? (ndrCount / finalStatusCount) * 100 : 0;

    return {
      totalOrders,
      ndrCount,
      deliveredCount,
      failedCount,
      attemptedDeliveryCount,
      inTransitCount,
      outForDeliveryCount,
      unfulfilledCount,
      ndrRate,
      finalStatusCount, // Delivered + Failed
      prepaidCount,
      codCount,
      deliveredPrepaidCount,
      deliveredCODCount,
      failedPrepaidCount,
      failedCODCount,
      attemptedDeliveryPrepaidCount,
      attemptedDeliveryCODCount,
      inTransitPrepaidCount,
      inTransitCODCount,
      outForDeliveryPrepaidCount,
      outForDeliveryCODCount,
      unfulfilledPrepaidCount,
      unfulfilledCODCount,
      fulfilledCount,
    };
  };

  const stats = calculateStats();

  // Calculate Expected Profit for current month
  const calculateExpectedProfit = () => {
    // Only calculate for current month or specific month selection
    if (selectedMonthFilter === 'all') {
      return null;
    }

    let targetMonth: number;
    let targetYear: number;
    if (selectedMonthFilter === 'current') {
      targetMonth = new Date().getMonth();
      targetYear = new Date().getFullYear();
    } else {
      const [year, month] = selectedMonthFilter.split('-');
      targetYear = parseInt(year);
      targetMonth = parseInt(month) - 1;
    }

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // Check if selected month is current month
    const isCurrentMonth = targetYear === currentYear && targetMonth === currentMonth;

    // If it's not the current month and the month is in the past, return null (show actual P/L only)
    if (!isCurrentMonth && (targetYear < currentYear || (targetYear === currentYear && targetMonth < currentMonth))) {
      return null;
    }

    // Calculate total days in the selected month
    const totalDaysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

    // If current month, calculate based on days elapsed
    const daysElapsed = isCurrentMonth ? currentDay : totalDaysInMonth;
    const remainingDays = totalDaysInMonth - daysElapsed;

    // Calculate CURRENT P/L for the month (same logic as Total P/L stat)
    const ordersCountedInPnl = ordersForStats.filter(o => {
      const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
      const isDelivered = deliveryStatus === 'delivered';
      const isFailed = rtoOrderIds.has(o.id) ||
                      deliveryStatus === 'failure' ||
                      deliveryStatus.includes('failed') ||
                      deliveryStatus.includes('rto');
      return isDelivered || isFailed || (o.paymentMethod?.toLowerCase() === 'prepaid');
    });

    let currentPL = Array.from(orderProfitLoss.entries())
      .filter(([orderId]) => ordersCountedInPnl.some(o => o.id === orderId))
      .reduce((sum, [, pl]) => sum + pl, 0);

    // Add ad spend for dates in the selected month
    const datesWithOrders = new Set(ordersForStats.map(o => getOrderDateKey(o.createdAt)));
    Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
      if (!isDateInSelectedMonth(dateKey)) return;
      if (!datesWithOrders.has(dateKey)) currentPL -= amount;
    });

    // Count pending orders (not yet delivered/failed, EXCLUDING prepaid which are already counted)
    const pendingOrders = ordersForStats.filter(o => {
      const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
      const isFailed = rtoOrderIds.has(o.id) ||
                      deliveryStatus === 'failure' ||
                      deliveryStatus.includes('failed') ||
                      deliveryStatus.includes('rto');
      const isDelivered = deliveryStatus === 'delivered';
      const isPrepaid = o.paymentMethod?.toLowerCase() === 'prepaid';
      
      // Include pending orders only (prepaid already counted in current P/L)
      return !isDelivered && !isFailed && !isPrepaid;
    });

    // Calculate average P/L per delivered order from historical data
    // Note: Using all available orders for historical calculation
    const historicalStartDate = new Date('2020-01-01'); // Far past date to include all orders
    const historicalDeliveredOrders = orders.filter(o => {
      const orderDate = new Date(o.createdAt);
      const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
      return orderDate >= historicalStartDate && 
             !o.cancelledAt && 
             !discardedOrderIds.has(o.id) &&
             deliveryStatus === 'delivered';
    });

    const totalHistoricalPL = Array.from(orderProfitLoss.entries())
      .filter(([orderId]) => historicalDeliveredOrders.some(o => o.id === orderId))
      .reduce((sum, [, pl]) => sum + pl, 0);

    const avgPLPerDeliveredOrder = historicalDeliveredOrders.length > 0 
      ? totalHistoricalPL / historicalDeliveredOrders.length 
      : 0;

    // Expected P/L from pending orders (adjusted for NDR rate)
    const deliveryRate = 1 - (globalNdrRate / 100);
    const expectedPendingPL = pendingOrders.length * avgPLPerDeliveredOrder * deliveryRate;

    // Linear projection for future orders (from remaining days)
    const avgPLPerDay = daysElapsed > 0 ? currentPL / daysElapsed : 0;
    const expectedFuturePL = avgPLPerDay * remainingDays;

    // Total expected month-end P/L = Current P/L + Pending Orders P/L + Future Orders P/L
    const expectedMonthEndPL = currentPL + expectedPendingPL + expectedFuturePL;

    return {
      expectedPL: expectedMonthEndPL,
      currentPL,
      expectedPendingPL,
      expectedFuturePL,
      avgPLPerDay,
      avgPLPerDeliveredOrder,
      pendingOrdersCount: pendingOrders.length,
      daysElapsed,
      totalDays: totalDaysInMonth,
      remainingDays,
      isCurrentMonth,
    };
  };

  const expectedProfit = calculateExpectedProfit();

  const handleDiscardOrders = async () => {
    if (selectedOrders.size === 0) return;
    
    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const orderNames = orderIds.map(id => {
        const order = orders.find(o => o.id === id);
        return order?.name || '';
      });
      
      const response = await api.discardOrders(orderIds, orderNames);
      if (response.success) {
        // Update local state
        setDiscardedOrderIds(new Set([...discardedOrderIds, ...orderIds]));
        setSelectedOrders(new Set());
        setSelectAll(false);
        setShowBulkMenu(false);
      }
    } catch (err) {
      console.error('Failed to discard orders:', err);
      alert('Failed to discard orders');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkAsRTO = async () => {
    if (selectedOrders.size === 0) return;
    
    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const orderNames = orderIds.map(id => {
        const order = orders.find(o => o.id === id);
        return order?.name || '';
      });
      
      const response = await api.markOrdersAsRTO(orderIds, orderNames);
      if (response.success) {
        // Update local state
        setRTOOrderIds(new Set([...rtoOrderIds, ...orderIds]));
        setSelectedOrders(new Set());
        setSelectAll(false);
        setShowBulkMenu(false);
      }
    } catch (err) {
      console.error('Failed to mark orders as RTO:', err);
      alert('Failed to mark orders as RTO');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnmarkRTO = async () => {
    if (selectedOrders.size === 0) return;
    
    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const response = await api.unmarkOrdersAsRTO(orderIds);
      if (response.success) {
        // Update local state
        const newRTO = new Set(rtoOrderIds);
        orderIds.forEach(id => newRTO.delete(id));
        setRTOOrderIds(newRTO);
        setSelectedOrders(new Set());
        setSelectAll(false);
        setShowBulkMenu(false);
      }
    } catch (err) {
      console.error('Failed to unmark RTO orders:', err);
      alert('Failed to unmark RTO orders');
    } finally {
      setIsProcessing(false);
    }
  };

  const getMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  const getDeliveryStatusBadge = (status?: string | null) => {
    if (!status) {
      return { text: '—', className: 'none' };
    }
    
    switch (status.toLowerCase()) {
      case 'delivered':
        return { text: 'Delivered', className: 'delivered' };
      case 'in_transit':
        return { text: 'In transit', className: 'in-transit' };
      case 'out_for_delivery':
        return { text: 'Out for delivery', className: 'out-for-delivery' };
      case 'attempted_delivery':
        return { text: 'Attempted delivery', className: 'attempted' };
      case 'ready_for_pickup':
        return { text: 'Ready for pickup', className: 'ready-pickup' };
      case 'confirmed':
        return { text: 'Confirmed', className: 'confirmed' };
      case 'label_printed':
      case 'label_purchased':
        return { text: 'Label created', className: 'label-created' };
      case 'failure':
        return { text: 'Failed', className: 'failed' };
      default:
        return { text: status.replace(/_/g, ' '), className: 'default' };
    }
  };

  // Calculate delay days for unfulfilled orders
  const getDelayDays = (order: ShopifyOrder): number | null => {
    // Only calculate for unfulfilled orders
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
    const isUnfulfilled = !fulfillmentStatus || fulfillmentStatus === '' || fulfillmentStatus === 'unfulfilled';
    
    if (!isUnfulfilled) return null;

    const orderDate = new Date(order.createdAt);
    const today = new Date();
    
    // Reset time parts to compare dates only
    orderDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - orderDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // Return null for 0 days (same day orders - no delay)
    return diffDays > 0 ? diffDays : null;
  };

  // Calculate delay days including 0 (for dropdown filter)
  const getDelayDaysIncludingZero = (order: ShopifyOrder): number | null => {
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
    const isUnfulfilled = !fulfillmentStatus || fulfillmentStatus === '' || fulfillmentStatus === 'unfulfilled';
    
    if (!isUnfulfilled) return null;

    const orderDate = new Date(order.createdAt);
    const today = new Date();
    
    orderDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    
    const diffTime = today.getTime() - orderDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  // Get available delay days from unfulfilled orders
  const getAvailableDelayDays = (): number[] => {
    const unfulfilledOrders = orders.filter(order => 
      !order.cancelledAt && 
      !discardedOrderIds.has(order.id) &&
      (!order.fulfillmentStatus || order.fulfillmentStatus.toLowerCase() === 'unfulfilled')
    );

    const delayDaysSet = new Set<number>();
    unfulfilledOrders.forEach(order => {
      const days = getDelayDaysIncludingZero(order);
      if (days !== null) {
        delayDaysSet.add(days);
      }
    });

    return Array.from(delayDaysSet).sort((a, b) => a - b);
  };

  // Auto-detect variant from order line items
  const detectVariant = (order: ShopifyOrder): 'small' | 'large' => {
    if (!order.lineItems || order.lineItems.length === 0) {
      return 'small'; // Default to small
    }
    
    // Check if any line item contains "Large" in title or variant
    const hasLarge = order.lineItems.some(item => 
      item.title?.toLowerCase().includes('large') || 
      item.variantTitle?.toLowerCase().includes('large')
    );
    
    return hasLarge ? 'large' : 'small';
  };

  // Determine if order is delivered (got money) or NDR (no money)
  const isOrderDelivered = useCallback((order: ShopifyOrder): boolean => {
    // Check if order is in RTO list (Return to Origin = NDR)
    if (rtoOrderIds.has(order.id)) {
      return false;
    }
    
    // Check delivery status
    const status = order.deliveryStatus?.toLowerCase() || '';
    
    // NDR statuses: failed, RTO-related (attempted_delivery excluded from failed)
    const ndrStatuses = ['failed', 'rto', 'return'];
    if (ndrStatuses.some(s => status.includes(s))) {
      return false;
    }
    
    // Delivered status means we got the money
    if (status === 'delivered') {
      return true;
    }
    
    // Prepaid orders = already got the money, so treat as delivered for P/L calculation
    if (order.paymentMethod?.toLowerCase() === 'prepaid') {
      return true;
    }
    
    // In transit, confirmed, etc. are considered as not yet delivered (but not NDR either)
    // For P/L calculation, we'll treat these as "not delivered" = no revenue yet
    // But we won't apply NDR costs, just show 0 P/L
    return false;
  }, [rtoOrderIds]);

  // Calculate actual shipping charge with proper RTO COD handling
  const calculateActualShippingCharge = useCallback((order: ShopifyOrder): number => {
    if (!order.shippingBreakdown) {
      return order.shippingCharge || 0;
    }
    
    const { freightForward, freightCOD, freightRTO, whatsappCharges, otherCharges } = order.shippingBreakdown;
    
    // Check if this is an RTO COD order
    const isRTO = rtoOrderIds.has(order.id) || 
                  order.deliveryStatus?.toLowerCase().includes('rto') ||
                  order.deliveryStatus?.toLowerCase().includes('failed') ||
                  freightRTO > 0;
    const isCODPayment = order.paymentMethod?.toLowerCase() === 'cod';
    
    // For RTO COD orders: COD is charged then reversed (net = 0)
    // So we don't include COD in the total for RTO COD orders
    if (isRTO && isCODPayment) {
      return freightForward + freightRTO + whatsappCharges + otherCharges;
    }
    
    // For all other orders: include COD normally
    return freightForward + freightCOD + freightRTO + whatsappCharges + otherCharges;
  }, [rtoOrderIds]);

  // Calculate profit/loss for an order based on delivery status and payment method
  const calculateOrderProfitLoss = useCallback((order: ShopifyOrder): number => {
    if (cogsConfig.length === 0) {
      return 0;
    }
    
    const variant = detectVariant(order);
    const isDelivered = isOrderDelivered(order);
    const status = order.deliveryStatus?.toLowerCase() || '';
    const isFailed = rtoOrderIds.has(order.id) ||
      status === 'failure' ||
      status.includes('failed') ||
      status.includes('rto');
    const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
    
    // Determine revenue and which fields to use
    let revenue = 0;
    let fieldsToUse: COGSField[] = [];
    
    if (isDelivered) {
      // Delivered = Got money
      revenue = order.totalPrice || 0;
      // Use COGS only + Both fields
      fieldsToUse = cogsConfig.filter(f => f.type === 'cogs' || f.type === 'both');
    } else if (isFailed) {
      // NDR/RTO/Failed = No money, apply NDR cost (attempted_delivery excluded)
      revenue = 0;
      fieldsToUse = cogsConfig.filter(f => f.type === 'ndr' || f.type === 'both');
    } else {
      // Pending (e.g. attempted_delivery, in_transit): no revenue, COGS only
      revenue = 0;
      fieldsToUse = cogsConfig.filter(f => f.type === 'cogs' || f.type === 'both');
    }
    
    // Calculate total costs using variant + payment method
    let totalCosts = 0;
    fieldsToUse.forEach(field => {
      // Get the correct value based on variant and payment method
      const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
      let value = field[key] as number;
      
      // Fallback to old structure if new structure not available
      if (value === undefined || value === null) {
        value = variant === 'small' ? (field.smallValue || 0) : (field.largeValue || 0);
      }
      
      if (field.calculationType === 'fixed') {
        totalCosts += value;
      } else {
        // Percentage calculation based on type
        const salePrice = order.totalPrice || 0;
        const percentageType = field.percentageType || 'excluded'; // Default to excluded for backwards compatibility
        
        if (percentageType === 'included') {
          // Included: percentage is part of total amount
          // Formula: amount × (percentage / (100 + percentage))
          // Example: ₹100 with 12% included = ₹100 × (12/112) = ₹10.71
          totalCosts += (value / (100 + value)) * salePrice;
        } else {
          // Excluded: percentage is added on top
          // Formula: amount × (percentage / 100)
          // Example: ₹100 with 12% excluded = ₹100 × 0.12 = ₹12
          totalCosts += (value / 100) * salePrice;
        }
      }
    });

    const orderDateStr = getOrderDateKey(order.createdAt);
    const adCost = adCostPerOrderByDate[orderDateStr] ?? 0;
    const shippingCharge = calculateActualShippingCharge(order);
    
    return revenue - totalCosts - adCost - shippingCharge;
  }, [cogsConfig, isOrderDelivered, adCostPerOrderByDate, rtoOrderIds, calculateActualShippingCharge]);

  // Calculate P/L for all orders when config loads
  useEffect(() => {
    if (cogsConfig.length > 0 && orders.length > 0) {
      const profitLossMap = new Map<number, number>();
      orders.forEach(order => {
        const profitLoss = calculateOrderProfitLoss(order);
        profitLossMap.set(order.id, profitLoss);
      });
      setOrderProfitLoss(profitLossMap);
    }
  }, [cogsConfig, orders, calculateOrderProfitLoss]);

  const handleOpenCogsModal = (order: ShopifyOrder) => {
    setSelectedOrderForCogs(order);
    const variant = detectVariant(order);
    const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
    const orderDateStr = getOrderDateKey(order.createdAt);
    const adCost = adCostPerOrderByDate[orderDateStr] ?? 0;

    // Determine config type based on delivery status
    const configType = isOrderDelivered(order) ? 'cogs' : 'ndr';

    setSelectedVariant(variant);
    calculateCogsBreakdown(cogsConfig, order.totalPrice || 0, variant, paymentMethod, configType, adCost);
    setShowCogsModal(true);
  };

  const handleUpdateDeliveryStatus = (orderId: number, orderName: string) => {
    setSelectedOrderForStatus({ id: orderId, name: orderName });
    setShowDeliveryStatusModal(true);
  };

  const handleMarkDeliveryStatus = async (status: 'Delivered' | 'Failed') => {
    if (!selectedOrderForStatus) return;
    
    setUpdatingStatus(true);
    try {
      const response = await api.updateOrderDeliveryStatus(selectedOrderForStatus.name, status);
      
      if (response.success) {
        // Reload data to reflect the change
        await loadData();
        setShowDeliveryStatusModal(false);
        setSelectedOrderForStatus(null);
      } else {
        alert(`Failed to update delivery status: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating delivery status:', error);
      alert('An error occurred while updating delivery status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const calculateCogsBreakdown = (
    fields: COGSField[],
    salePrice: number,
    variant: 'small' | 'large',
    paymentMethod: 'prepaid' | 'cod',
    configType: 'cogs' | 'ndr' | 'both',
    adCost?: number
  ) => {
    const breakdown: COGSBreakdown[] = [];

    // Filter fields based on config type
    const fieldsToUse: COGSField[] =
      configType === 'cogs' ? fields.filter(f => f.type === 'cogs' || f.type === 'both') :
      configType === 'ndr' ? fields.filter(f => f.type === 'ndr' || f.type === 'both') :
      fields; // 'both' uses all fields

    fieldsToUse.forEach(field => {
      // Get the correct value based on variant and payment method
      const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
      let value = field[key] as number;

      // Fallback to old structure if new structure not available
      if (value === undefined || value === null) {
        value = variant === 'small' ? (field.smallValue || 0) : (field.largeValue || 0);
      }

      let calculatedCost = 0;

      if (field.calculationType === 'fixed') {
        calculatedCost = value;
      } else {
        // Percentage calculation based on type
        const percentageType = field.percentageType || 'excluded';

        if (percentageType === 'included') {
          calculatedCost = (value / (100 + value)) * salePrice;
        } else {
          calculatedCost = (value / 100) * salePrice;
        }
      }

      breakdown.push({
        fieldName: field.name,
        type: field.type,
        calculationType: field.calculationType,
        value: value,
        calculatedCost: calculatedCost,
      });
    });

    if (adCost !== undefined && adCost > 0) {
      breakdown.push({
        fieldName: 'Ad cost (Meta)',
        type: 'cogs',
        calculationType: 'fixed',
        value: adCost,
        calculatedCost: adCost,
      });
    }

    setCogsBreakdown(breakdown);
  };

  const calculateTotalCogs = () => {
    // Sum COGS items only (exclude Ad Cost which is shown separately)
    return cogsBreakdown
      .filter(item => item.fieldName !== 'Ad cost (Meta)')
      .reduce((sum, item) => sum + item.calculatedCost, 0);
  };
  
  const getAdCost = () => {
    return adCostPerOrderByDate[getOrderDateKey(selectedOrderForCogs?.createdAt || '')] ?? 0;
  };

  const calculateProfit = () => {
    if (!selectedOrderForCogs) return 0;
    const profitLoss = orderProfitLoss.get(selectedOrderForCogs.id);
    return profitLoss !== undefined ? profitLoss : 0;
  };

  if (isLoading) {
    return (
      <div className={styles['sales-page']}>
        <div className={styles['content-section']}>
          <div className={styles['section-header']}>
            <div className={styles['header-content']}>
              <div />
              <div className={styles['header-actions']}>
                <span className={styles['loading-skeleton']} style={{ width: 110 }} />
                <span className={styles['loading-skeleton']} style={{ width: 90 }} />
                <span className={styles['loading-skeleton']} style={{ width: 180 }} />
              </div>
            </div>
          </div>

          <div className={styles['stats-section']}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={styles['stat-card']}>
                <div className={`${styles['loading-skeleton']} ${styles['skeleton-label']}`} />
                <div className={`${styles['loading-skeleton']} ${styles['skeleton-value']}`} />
              </div>
            ))}
            <div className={styles['stat-card-combined']}>
              <div className={`${styles['loading-skeleton']} ${styles['skeleton-label']}`} />
              <div className={styles['status-row']}>
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className={`${styles['loading-skeleton']} ${styles['skeleton-chip']}`} />
                ))}
              </div>
            </div>
          </div>

          <div className={styles['loading-filters']}>
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`${styles['loading-skeleton']} ${styles['skeleton-filter']}`} />
            ))}
          </div>

          <div className={styles['orders-table-container']}>
            <table className={styles['orders-table']}>
              <thead>
                <tr>
                  <th className={styles['checkbox-cell']} />
                  <th>Order</th>
                  <th>Items</th>
                  <th>Tags</th>
                  <th>P/L</th>
                  <th>Date</th>
                  <th className={styles['actions-header']}>Details</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <tr key={i}>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-check']}`} /></td>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-order']}`} /></td>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-items']}`} /></td>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-tags']}`} /></td>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-pl']}`} /></td>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-date']}`} /></td>
                    <td><span className={`${styles['loading-skeleton']} ${styles['skeleton-details']}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles['loading-hint']}>Loading orders…</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles['sales-page']}>
      <div className={styles['content-section']}>
        <div className={styles['section-header']}>
          <div className={styles['header-content']}>
            <div>
            </div>
            <div className={styles['header-actions']}>
              <button
                onClick={() => setShowPendingDrawer(true)}
                className={styles['pending-btn']}
                title="Show pending products to fulfill"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
                  <path d="M9 12h6m-6 4h6"/>
                </svg>
                Show Pending
              </button>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className={styles['refresh-btn']}
                title="Refresh orders from Shopify"
              >
                <svg 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  className={isRefreshing ? styles.spinning : ''}
                >
                  <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
                </svg>
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <div className={styles['month-filter']}>
                <label htmlFor="month-select">Period:</label>
                <select 
                  id="month-select"
                  value={selectedMonthFilter} 
                  onChange={(e) => {
                    setSelectedMonthFilter(e.target.value);
                    setSelectedOrders(new Set());
                    setSelectAll(false);
                  }}
                  className={styles['filter-select']}
                >
                  <option value="all">All Time</option>
                  <option value="current">This Month</option>
                  {availableMonths.length > 0 && <option disabled>───────────</option>}
                  {availableMonths.map(monthKey => (
                    <option key={monthKey} value={monthKey}>
                      {getMonthLabel(monthKey)}
                    </option>
                  ))}
                </select>
              </div>
              {selectedOrders.size > 0 && (
                <div className={styles['bulk-actions']}>
                  <span className={styles['selected-count']}>{selectedOrders.size} selected</span>
                  <div className={styles['bulk-action-dropdown']}>
                    <button 
                      className={styles['bulk-action-btn']}
                      onClick={() => setShowBulkMenu(!showBulkMenu)}
                      disabled={isProcessing}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14"/>
                        <path d="M19 12l-7 7-7-7"/>
                      </svg>
                      {isProcessing ? 'Processing...' : 'Actions'}
                    </button>
                    {showBulkMenu && (
                      <div className={styles['bulk-menu']}>
                        <button 
                          className={`${styles['bulk-menu-item']} ${styles.rto}`}
                          onClick={handleMarkAsRTO}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 11l-6 6v-6h6z"/>
                            <path d="M20 12h-8"/>
                            <path d="M20 12l-4-4"/>
                            <path d="M20 12l-4 4"/>
                          </svg>
                          Mark as RTO
                        </button>
                        <button 
                          className={`${styles['bulk-menu-item']} ${styles['unmark-rto']}`}
                          onClick={handleUnmarkRTO}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18"/>
                            <path d="M6 6l12 12"/>
                          </svg>
                          Unmark RTO
                        </button>
                        <div className={styles['menu-divider']}></div>
                        <button 
                          className={`${styles['bulk-menu-item']} ${styles.discard}`}
                          onClick={handleDiscardOrders}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M15 9l-6 6"/>
                            <path d="M9 9l6 6"/>
                          </svg>
                          Discard Orders
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Section - Line 1: Total Orders, NDR Rate, Total P/L, Expected Profit | Line 2: Order Status */}
        <div className={styles['stats-section']}>
          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>Total Orders</div>
            <div className={styles['stat-value']}>{formatIndianNumber(stats.totalOrders, 0)}</div>
          </div>

          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>NDR Rate</div>
            <div className={`${styles['stat-value']} ${stats.ndrRate > 15 ? styles['ndr-high'] : styles['ndr-normal']}`}>
              {formatIndianNumber(stats.ndrRate, 1)}%
            </div>
            <div className={styles['stat-subtext']}>{formatIndianNumber(stats.ndrCount, 0)} / {formatIndianNumber(stats.finalStatusCount, 0)} final status</div>
          </div>

          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>Total P/L</div>
            <div className={`${styles['stat-value']} ${(() => {
              const ordersCountedInPnl = ordersForStats.filter(o => {
                const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
                const isDelivered = deliveryStatus === 'delivered';
                const isFailed = rtoOrderIds.has(o.id) ||
                                deliveryStatus === 'failure' ||
                                deliveryStatus.includes('failed') ||
                                deliveryStatus.includes('rto');
                return isDelivered || isFailed || (o.paymentMethod?.toLowerCase() === 'prepaid');
              });
              let totalPL = Array.from(orderProfitLoss.entries())
                .filter(([orderId]) => ordersCountedInPnl.some(o => o.id === orderId))
                .reduce((sum, [, pl]) => sum + pl, 0);
              const datesWithOrders = new Set(ordersForStats.map(o => getOrderDateKey(o.createdAt)));
              Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
                if (!isDateInSelectedMonth(dateKey)) return;
                if (!datesWithOrders.has(dateKey)) totalPL -= amount;
              });
              return totalPL > 0 ? styles.profit : totalPL < 0 ? styles.loss : '';
            })()}`}>
              {(() => {
                const ordersCountedInPnl = ordersForStats.filter(o => {
                  const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
                  const isDelivered = deliveryStatus === 'delivered';
                  const isFailed = rtoOrderIds.has(o.id) ||
                                  deliveryStatus === 'failure' ||
                                  deliveryStatus.includes('failed') ||
                                  deliveryStatus.includes('rto');
                  return isDelivered || isFailed || (o.paymentMethod?.toLowerCase() === 'prepaid');
                });
                let totalPL = Array.from(orderProfitLoss.entries())
                  .filter(([orderId]) => ordersCountedInPnl.some(o => o.id === orderId))
                  .reduce((sum, [, pl]) => sum + pl, 0);
                const datesWithOrders = new Set(ordersForStats.map(o => getOrderDateKey(o.createdAt)));
                Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
                  if (!isDateInSelectedMonth(dateKey)) return;
                  if (!datesWithOrders.has(dateKey)) totalPL -= amount;
                });
                return `${totalPL > 0 ? '+' : ''}₹${formatIndianNumber(totalPL, 0)}`;
              })()}
            </div>
            <div className={styles['stat-subtext']}>
              {cogsConfig.length > 0 ? 'Delivered, failed & prepaid orders + ad-spend-only days' : 'Configure COGS to calculate'}
            </div>
          </div>

          {expectedProfit && (
            <div className={styles['stat-card']}>
              <div className={styles['stat-label']}>
                {expectedProfit.isCurrentMonth ? 'Expected Profit' : 'Projected Profit'}
              </div>
              <div className={`${styles['stat-value']} ${expectedProfit.expectedPL > 0 ? styles.profit : expectedProfit.expectedPL < 0 ? styles.loss : ''}`}>
                {expectedProfit.expectedPL > 0 ? '+' : ''}₹{formatIndianNumber(expectedProfit.expectedPL, 0)}
              </div>
              <div className={styles['stat-subtext']} title={`Current P/L: ₹${formatIndianNumber(expectedProfit.currentPL, 0)} | Pending (${expectedProfit.pendingOrdersCount} orders): +₹${formatIndianNumber(expectedProfit.expectedPendingPL, 0)} | Future (${expectedProfit.remainingDays}d): +₹${formatIndianNumber(expectedProfit.expectedFuturePL, 0)} | Avg per order: ₹${formatIndianNumber(expectedProfit.avgPLPerDeliveredOrder, 0)}`}>
                {expectedProfit.isCurrentMonth 
                  ? `Day ${expectedProfit.daysElapsed}/${expectedProfit.totalDays} • ${formatIndianNumber(expectedProfit.pendingOrdersCount, 0)} pending`
                  : `${formatIndianNumber(expectedProfit.pendingOrdersCount, 0)} pending orders`
                }
              </div>
            </div>
          )}

          <div className={styles['stat-card-combined']}>
            <div className={styles['stat-label']}>Order Status</div>
            <div className={styles['status-breakdown']}>
              <div className={styles['status-row']}>
                <div className={styles['status-item']}>
                  <span className={styles['status-label']}>Delivered</span>
                  <span className={styles['status-value']}>{formatIndianNumber(stats.deliveredCount, 0)}</span>
                  <span className={styles['status-detail']}>
                    {formatIndianNumber(stats.deliveredPrepaidCount, 0)}p · {formatIndianNumber(stats.deliveredCODCount, 0)}c
                  </span>
                </div>
                <div className={styles['status-item']}>
                  <span className={styles['status-label']}>Failed</span>
                  <span className={styles['status-value']}>{formatIndianNumber(stats.failedCount, 0)}</span>
                  <span className={styles['status-detail']}>
                    {formatIndianNumber(stats.failedPrepaidCount, 0)}p · {formatIndianNumber(stats.failedCODCount, 0)}c
                  </span>
                </div>
                <div className={styles['status-item']}>
                  <span className={styles['status-label']}>Attempted Delivery</span>
                  <span className={styles['status-value']}>{formatIndianNumber(stats.attemptedDeliveryCount, 0)}</span>
                  <span className={styles['status-detail']}>
                    {formatIndianNumber(stats.attemptedDeliveryPrepaidCount, 0)}p · {formatIndianNumber(stats.attemptedDeliveryCODCount, 0)}c
                  </span>
                </div>
                <div className={styles['status-item']}>
                  <span className={styles['status-label']}>In Transit</span>
                  <span className={styles['status-value']}>{formatIndianNumber(stats.inTransitCount, 0)}</span>
                  <span className={styles['status-detail']}>
                    {formatIndianNumber(stats.inTransitPrepaidCount, 0)}p · {formatIndianNumber(stats.inTransitCODCount, 0)}c
                  </span>
                </div>
                <div className={styles['status-item']}>
                  <span className={styles['status-label']}>Out for Delivery</span>
                  <span className={styles['status-value']}>{formatIndianNumber(stats.outForDeliveryCount, 0)}</span>
                  <span className={styles['status-detail']}>
                    {formatIndianNumber(stats.outForDeliveryPrepaidCount, 0)}p · {formatIndianNumber(stats.outForDeliveryCODCount, 0)}c
                  </span>
                </div>
                <div className={styles['status-item']}>
                  <span className={styles['status-label']}>Unfulfilled</span>
                  <span className={styles['status-value']}>{formatIndianNumber(stats.unfulfilledCount, 0)}</span>
                  <span className={styles['status-detail']}>
                    {formatIndianNumber(stats.unfulfilledPrepaidCount, 0)}p · {formatIndianNumber(stats.unfulfilledCODCount, 0)}c
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Status Filters */}
        <div className={styles['status-filters']}>
          <span className={styles['filters-label']}>Filter by status:</span>
          <button
            onClick={() => setShowUnfulfilled(!showUnfulfilled)}
            className={`${styles['filter-chip']} ${showUnfulfilled ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            Unfulfilled
          </button>
          <button
            onClick={() => setShowDelivered(!showDelivered)}
            className={`${styles['filter-chip']} ${showDelivered ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            Delivered
          </button>
          <button
            onClick={() => setShowFailed(!showFailed)}
            className={`${styles['filter-chip']} ${showFailed ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            Failed
          </button>
          <button
            onClick={() => setShowAttemptedDelivery(!showAttemptedDelivery)}
            className={`${styles['filter-chip']} ${showAttemptedDelivery ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Attempted Delivery
          </button>
          <button
            onClick={() => setShowInTransit(!showInTransit)}
            className={`${styles['filter-chip']} ${showInTransit ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="3" width="15" height="13"/>
              <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/>
              <circle cx="5.5" cy="18.5" r="2.5"/>
              <circle cx="18.5" cy="18.5" r="2.5"/>
            </svg>
            In Transit
          </button>
          <button
            onClick={() => setShowOutForDelivery(!showOutForDelivery)}
            className={`${styles['filter-chip']} ${showOutForDelivery ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
            </svg>
            Out for Delivery
          </button>
          {(showUnfulfilled || showDelivered || showFailed || showAttemptedDelivery || showInTransit || showOutForDelivery) && (
            <button
              onClick={() => {
                setShowUnfulfilled(false);
                setShowDelivered(false);
                setShowFailed(false);
                setShowAttemptedDelivery(false);
                setShowInTransit(false);
                setShowOutForDelivery(false);
              }}
              className={styles['clear-filters-btn']}
            >
              Clear filters
            </button>
          )}
        </div>

        {/* Filtered Order Count */}
        {hasStatusFilter && (
          <div className={styles['filtered-count']}>
            {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
          </div>
        )}

        {/* Orders Table */}
        <div className={styles['orders-table-container']}>
          <table className={styles['orders-table']}>
            <thead>
              <tr>
                <th className={styles['checkbox-cell']}>
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    className={styles['table-checkbox']}
                  />
                </th>
                <th>Order</th>
                <th>Items</th>
                <th>Tags</th>
                <th>P/L</th>
                <th>Date</th>
                <th className={styles['actions-header']}>Details</th>
              </tr>
            </thead>
            <OrdersTableBody
              hasStatusFilter={hasStatusFilter}
              filteredOrders={filteredOrders}
              ordersGroupedByDate={ordersGroupedByDate}
              selectedOrders={selectedOrders}
              onSelectOrder={handleSelectOrder}
              orderProfitLoss={orderProfitLoss}
              rtoOrderIds={rtoOrderIds}
              getDelayDays={getDelayDays}
              getDeliveryStatusBadge={getDeliveryStatusBadge}
              handleOpenCogsModal={handleOpenCogsModal}
              formatIndianNumber={formatIndianNumber}
              avgPnlPerFinalOrder={avgPnlPerFinalOrder}
              globalNdrRate={globalNdrRate}
              onUpdateDeliveryStatus={handleUpdateDeliveryStatus}
            />
          </table>
        </div>
      </div>

      {/* Pending Products Drawer */}
      {showPendingDrawer && (
        <div className={styles['drawer-overlay']} onClick={() => setShowPendingDrawer(false)}>
          <div className={styles['drawer']} onClick={(e) => e.stopPropagation()}>
            <div className={styles['drawer-header']}>
              <h3>Pending Products to Fulfill</h3>
              <button 
                className={styles['drawer-close']} 
                onClick={() => setShowPendingDrawer(false)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className={styles['drawer-filters']}>
              <div className={styles['drawer-filters-row']}>
                <span className={styles['drawer-filters-label']}>Payment:</span>
                <button
                  onClick={() => setPendingFilterCOD(!pendingFilterCOD)}
                  className={`${styles['drawer-filter-chip']} ${pendingFilterCOD ? styles.active : ''}`}
                >
                  COD
                </button>
                <button
                  onClick={() => setPendingFilterPaid(!pendingFilterPaid)}
                  className={`${styles['drawer-filter-chip']} ${pendingFilterPaid ? styles.active : ''}`}
                >
                  Paid
                </button>
              </div>

              <div className={styles['drawer-filters-row']}>
                <span className={styles['drawer-filters-label']}>Delayed:</span>
                <div className={styles['dropdown-container']}>
                  <button
                    onClick={() => setShowDelayDropdown(!showDelayDropdown)}
                    className={`${styles['dropdown-trigger']} ${pendingFilterDelayDays.size > 0 ? styles.active : ''}`}
                  >
                    {pendingFilterDelayDays.size > 0 
                      ? `${pendingFilterDelayDays.size} selected` 
                      : 'Select delay days'}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  
                  {showDelayDropdown && (
                    <div className={styles['dropdown-menu']}>
                      {getAvailableDelayDays().map(days => (
                        <label key={days} className={styles['dropdown-item']}>
                          <input
                            type="checkbox"
                            checked={pendingFilterDelayDays.has(days)}
                            onChange={(e) => {
                              const newSet = new Set(pendingFilterDelayDays);
                              if (e.target.checked) {
                                newSet.add(days);
                              } else {
                                newSet.delete(days);
                              }
                              setPendingFilterDelayDays(newSet);
                            }}
                          />
                          <span>{days === 0 ? 'No Delay' : `${days} day${days > 1 ? 's' : ''} delay`}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {(pendingFilterCOD || pendingFilterPaid || pendingFilterDelayDays.size > 0) && (
                <button
                  onClick={() => {
                    setPendingFilterCOD(false);
                    setPendingFilterPaid(false);
                    setPendingFilterDelayDays(new Set());
                  }}
                  className={styles['drawer-clear-filters']}
                >
                  Clear All
                </button>
              )}
            </div>

            <div className={styles['drawer-body']}>
              {getPendingProducts().length === 0 ? (
                <div className={styles['drawer-empty']}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <p>No pending products</p>
                  <span>All orders are fulfilled!</span>
                </div>
              ) : (
                <div className={styles['pending-products-list']}>
                  {getPendingProducts().map((product, idx) => (
                    <div key={idx} className={styles['pending-product-item']}>
                      <div className={styles['product-info']}>
                        <div className={styles['product-title']}>{product.title}</div>
                        {product.variantTitle && (
                          <div className={styles['product-variant']}>{product.variantTitle}</div>
                        )}
                        <div className={styles['product-orders']}>
                          Orders: {product.orderNumbers.join(', ')}
                        </div>
                      </div>
                      <div className={styles['product-count']}>
                        <span className={styles['count-badge']}>{product.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* COGS Calculator Modal */}
      {showCogsModal && selectedOrderForCogs && (
        <div className={styles['modal-overlay']} onClick={() => setShowCogsModal(false)}>
          <div className={styles['modal-content']} onClick={(e) => e.stopPropagation()}>
            <div className={styles['modal-header']}>
              <h3>Profit/Loss Calculator</h3>
              <button 
                className={styles['modal-close']} 
                onClick={() => setShowCogsModal(false)}
              >
                ×
              </button>
            </div>

            <div className={styles['modal-body']}>
              {/* Section 1: Order Details */}
              <div className={styles['cost-section']}>
                <h3 className={styles['section-title']}>Order Details</h3>
                <div className={styles['order-info']}>
                  <div className={styles['info-row']}>
                    <span className={styles['info-label']}>Order:</span>
                    <span className={styles['info-value']}>{selectedOrderForCogs.name}</span>
                  </div>
                  <div className={styles['info-row']}>
                    <span className={styles['info-label']}>Sale Price:</span>
                    <span className={styles['info-value']}>
                      ₹{formatIndianNumber(selectedOrderForCogs.totalPrice || 0)}
                    </span>
                  </div>
                  <div className={styles['info-row']}>
                    <span className={styles['info-label']}>Variant:</span>
                    <span className={styles['info-value']}>
                      {selectedVariant === 'small' ? 'Small Book' : 'Large Book'}
                    </span>
                  </div>
                  <div className={styles['info-row']}>
                    <span className={styles['info-label']}>Config Type:</span>
                    <span className={styles['info-value']}>
                      {isOrderDelivered(selectedOrderForCogs) ? 'COGS' : 'NDR'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 2: COGS Config Charges */}
              <div className={styles['cost-section']}>
                <h3 className={styles['section-title']}>COGS Configuration</h3>
                <div className={styles['breakdown-list']}>
                  {cogsBreakdown.length === 0 ? (
                    <p className={styles['no-data']}>No COGS configuration available</p>
                  ) : (
                    cogsBreakdown
                      .filter(item => item.fieldName !== 'Ad cost (Meta)') // Exclude Ad Cost, shown separately
                      .map((item, idx) => (
                        <div key={idx} className={styles['breakdown-item']}>
                          <div className={styles['breakdown-info']}>
                            <span className={styles['breakdown-name']}>{item.fieldName}</span>
                            <span className={styles['breakdown-type']}>
                            {item.calculationType === 'percentage' 
                              ? `${formatIndianNumber(item.value, 1)}%` 
                              : `₹${formatIndianNumber(item.value)}`}
                            </span>
                          </div>
                          <span className={styles['breakdown-cost']}>
                            ₹{formatIndianNumber(item.calculatedCost)}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Section 3: Ad Cost */}
              <div className={styles['cost-section']}>
                <h3 className={styles['section-title']}>Advertisement Cost</h3>
                <div className={styles['breakdown-list']}>
                  <div className={styles['breakdown-item']}>
                    <div className={styles['breakdown-info']}>
                      <span className={styles['breakdown-name']}>Ad Cost (Meta)</span>
                      <span className={styles['breakdown-type']}>Per Order</span>
                    </div>
                    <span className={styles['breakdown-cost']}>
                      ₹{formatIndianNumber(adCostPerOrderByDate[getOrderDateKey(selectedOrderForCogs.createdAt)] ?? 0)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 4: Shipping Charges */}
              <div className={styles['cost-section']}>
                <h3 className={styles['section-title']}>Shipping Charges</h3>
                <div className={styles['breakdown-list']}>
                  {selectedOrderForCogs.shippingCharge && selectedOrderForCogs.shippingCharge > 0 ? (
                        <>
                          {selectedOrderForCogs.shippingBreakdown ? (
                            <>
                              {/* Detailed breakdown if available */}
                              {selectedOrderForCogs.shippingBreakdown.freightForward > 0 && (
                                <div className={styles['breakdown-item']}>
                                  <div className={styles['breakdown-info']}>
                                    <span className={styles['breakdown-name']}>Base Freight</span>
                                    <span className={styles['breakdown-type']}>Shiprocket</span>
                                  </div>
                                  <span className={styles['breakdown-cost']}>
                                    ₹{formatIndianNumber(selectedOrderForCogs.shippingBreakdown.freightForward)}
                                  </span>
                                </div>
                              )}
                              {selectedOrderForCogs.shippingBreakdown.freightCOD !== 0 && (() => {
                                // COD is only reversed when: order is RTO AND payment method is COD
                                // Check for RTO: in RTO list, status contains RTO/failed, OR has RTO charges
                                const isRTO = rtoOrderIds.has(selectedOrderForCogs.id) || 
                                              selectedOrderForCogs.deliveryStatus?.toLowerCase().includes('rto') ||
                                              selectedOrderForCogs.deliveryStatus?.toLowerCase().includes('failed') ||
                                              (selectedOrderForCogs.shippingBreakdown.freightRTO || 0) > 0; // Has RTO charges
                                const isCODPayment = selectedOrderForCogs.paymentMethod?.toLowerCase() === 'cod';
                                const shouldReverse = isRTO && isCODPayment && selectedOrderForCogs.shippingBreakdown.freightCOD > 0;
                                
                                // For RTO orders, show both charge and reversal
                                if (shouldReverse) {
                                  return (
                                    <>
                                      {/* Initial COD charge */}
                                      <div className={styles['breakdown-item']}>
                                        <div className={styles['breakdown-info']}>
                                          <span className={styles['breakdown-name']}>Freight COD</span>
                                          <span className={styles['breakdown-type']}>Applied</span>
                                        </div>
                                        <span className={styles['breakdown-cost']}>
                                          ₹{formatIndianNumber(Math.abs(selectedOrderForCogs.shippingBreakdown.freightCOD))}
                                        </span>
                                      </div>
                                      {/* COD reversal */}
                                      <div className={styles['breakdown-item']}>
                                        <div className={styles['breakdown-info']}>
                                          <span className={styles['breakdown-name']}>Freight COD Reversal</span>
                                          <span className={styles['breakdown-type']}>RTO Refund</span>
                                        </div>
                                        <span className={styles['breakdown-cost']} style={{ color: '#10b981' }}>
                                          -₹{formatIndianNumber(Math.abs(selectedOrderForCogs.shippingBreakdown.freightCOD))}
                                        </span>
                                      </div>
                                    </>
                                  );
                                }
                                
                                // For non-RTO orders, show single line
                                return (
                                  <div className={styles['breakdown-item']}>
                                    <div className={styles['breakdown-info']}>
                                      <span className={styles['breakdown-name']}>Freight COD</span>
                                      <span className={styles['breakdown-type']}>Applied</span>
                                    </div>
                                    <span className={styles['breakdown-cost']}>
                                      ₹{formatIndianNumber(Math.abs(selectedOrderForCogs.shippingBreakdown.freightCOD))}
                                    </span>
                                  </div>
                                );
                              })()}
                              {selectedOrderForCogs.shippingBreakdown.freightRTO > 0 && (
                                <div className={styles['breakdown-item']}>
                                  <div className={styles['breakdown-info']}>
                                    <span className={styles['breakdown-name']}>Freight RTO</span>
                                    <span className={styles['breakdown-type']}>Return</span>
                                  </div>
                                  <span className={styles['breakdown-cost']}>
                                    ₹{formatIndianNumber(selectedOrderForCogs.shippingBreakdown.freightRTO)}
                                  </span>
                                </div>
                              )}
                              {selectedOrderForCogs.shippingBreakdown.whatsappCharges > 0 && (
                                <div className={styles['breakdown-item']}>
                                  <div className={styles['breakdown-info']}>
                                    <span className={styles['breakdown-name']}>WhatsApp Charges</span>
                                    <span className={styles['breakdown-type']}>Communication</span>
                                  </div>
                                  <span className={styles['breakdown-cost']}>
                                    ₹{formatIndianNumber(selectedOrderForCogs.shippingBreakdown.whatsappCharges)}
                                  </span>
                                </div>
                              )}
                              {selectedOrderForCogs.shippingBreakdown.otherCharges > 0 && (
                                <div className={styles['breakdown-item']}>
                                  <div className={styles['breakdown-info']}>
                                    <span className={styles['breakdown-name']}>Other Charges</span>
                                    <span className={styles['breakdown-type']}>Misc</span>
                                  </div>
                                  <span className={styles['breakdown-cost']}>
                                    ₹{formatIndianNumber(selectedOrderForCogs.shippingBreakdown.otherCharges)}
                                  </span>
                                </div>
                              )}
                            </>
                          ) : (
                            /* Simple total if no breakdown */
                            <div className={styles['breakdown-item']}>
                              <div className={styles['breakdown-info']}>
                                <span className={styles['breakdown-name']}>Shipping Charge</span>
                                <span className={styles['breakdown-type']}>Shiprocket</span>
                              </div>
                              <span className={styles['breakdown-cost']}>
                                ₹{formatIndianNumber(selectedOrderForCogs.shippingCharge)}
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className={styles['no-data']}>No shipping charges available</p>
                      )}
                    </div>
                  </div>

              {/* Section 5: Total Costs Summary */}
              <div className={styles['cost-section']}>
                <h3 className={styles['section-title']}>Cost Summary</h3>
                <div className={styles['breakdown-list']}>
                  <div className={styles['breakdown-item']}>
                    <div className={styles['breakdown-info']}>
                      <span className={styles['breakdown-name']}>Total COGS</span>
                      <span className={styles['breakdown-type']}>From Configuration</span>
                    </div>
                    <span className={styles['breakdown-cost']}>
                      ₹{formatIndianNumber(calculateTotalCogs())}
                    </span>
                  </div>
                  <div className={styles['breakdown-item']}>
                    <div className={styles['breakdown-info']}>
                      <span className={styles['breakdown-name']}>Ad Cost</span>
                      <span className={styles['breakdown-type']}>Meta Ads</span>
                    </div>
                    <span className={styles['breakdown-cost']}>
                      ₹{formatIndianNumber(adCostPerOrderByDate[getOrderDateKey(selectedOrderForCogs.createdAt)] ?? 0)}
                    </span>
                  </div>
                  <div className={styles['breakdown-item']}>
                    <div className={styles['breakdown-info']}>
                      <span className={styles['breakdown-name']}>Shipping Charge</span>
                      <span className={styles['breakdown-type']}>Shiprocket</span>
                    </div>
                    <span className={styles['breakdown-cost']}>
                      ₹{formatIndianNumber(calculateActualShippingCharge(selectedOrderForCogs))}
                    </span>
                  </div>
                  <div className={styles['breakdown-item']} style={{ borderTop: '2px solid #cbd5e1', paddingTop: '1rem', marginTop: '0.5rem' }}>
                    <div className={styles['breakdown-info']}>
                      <span className={styles['breakdown-name']} style={{ fontSize: '1.125rem', fontWeight: '700' }}>Total Costs</span>
                      <span className={styles['breakdown-type']}>Sum of All Costs</span>
                    </div>
                    <span className={styles['breakdown-cost']} style={{ fontSize: '1.125rem' }}>
                      ₹{formatIndianNumber(calculateTotalCogs() + (adCostPerOrderByDate[getOrderDateKey(selectedOrderForCogs.createdAt)] ?? 0) + calculateActualShippingCharge(selectedOrderForCogs))}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section 6: Net Profit/Loss */}
              <div className={styles['cost-section']}>
                <h3 className={styles['section-title']}>Net Result</h3>
                <div className={styles['cogs-summary']}>
                  <div className={styles['summary-row']}>
                    <span className={styles['summary-label']}>Sale Price:</span>
                    <span className={styles['summary-value']}>
                      ₹{formatIndianNumber(selectedOrderForCogs.totalPrice || 0)}
                    </span>
                  </div>
                  <div className={styles['summary-row']}>
                    <span className={styles['summary-label']}>Total Costs:</span>
                    <span className={styles['summary-value']}>
                      ₹{formatIndianNumber(calculateTotalCogs() + (adCostPerOrderByDate[getOrderDateKey(selectedOrderForCogs.createdAt)] ?? 0) + calculateActualShippingCharge(selectedOrderForCogs))}
                    </span>
                  </div>
                  <div className={`${styles['summary-row']} ${styles['profit-row']}`}>
                    {(() => {
                      const totalCosts = calculateTotalCogs() + (adCostPerOrderByDate[getOrderDateKey(selectedOrderForCogs.createdAt)] ?? 0) + calculateActualShippingCharge(selectedOrderForCogs);
                      const profit = (selectedOrderForCogs.totalPrice || 0) - totalCosts;
                      return (
                        <>
                          <span className={styles['summary-label']}>
                            {profit >= 0 ? 'Profit' : 'Loss'}:
                          </span>
                          <span className={`${styles['summary-value']} ${profit >= 0 ? styles.profit : styles.loss}`}>
                            {profit >= 0 ? '+' : ''}₹{formatIndianNumber(Math.abs(profit))}
                          </span>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delivery Status Update Modal */}
      {showDeliveryStatusModal && selectedOrderForStatus && (
        <div className={styles['modal-overlay']} onClick={() => !updatingStatus && setShowDeliveryStatusModal(false)}>
          <div className={styles['modal-content']} style={{ width: '500px', maxWidth: '90vw', height: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className={styles['modal-header']}>
              <h3>Mark Delivery Status</h3>
              <button
                onClick={() => !updatingStatus && setShowDeliveryStatusModal(false)}
                className={styles['modal-close']}
                disabled={updatingStatus}
              >
                ×
              </button>
            </div>
            <div className={styles['modal-body']} style={{ padding: '2rem' }}>
              <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
                Update delivery status for order <strong>{selectedOrderForStatus.name}</strong>
              </p>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  onClick={() => handleMarkDeliveryStatus('Delivered')}
                  disabled={updatingStatus}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: updatingStatus ? 'not-allowed' : 'pointer',
                    opacity: updatingStatus ? 0.6 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  {updatingStatus ? 'Updating...' : 'Mark as Delivered'}
                </button>
                <button
                  onClick={() => handleMarkDeliveryStatus('Failed')}
                  disabled={updatingStatus}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    background: '#ef4444',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: updatingStatus ? 'not-allowed' : 'pointer',
                    opacity: updatingStatus ? 0.6 : 1,
                    transition: 'all 0.2s',
                  }}
                >
                  {updatingStatus ? 'Updating...' : 'Mark as Failed'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
