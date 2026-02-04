import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import styles from './SalesPage.module.css';

interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  createdAt: string;
  fulfillmentStatus?: string | null;
  deliveryStatus?: string | null;
  paymentMethod?: string;
  maxUploads: number;
  totalPrice?: number;
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
  smallValue: number;
  largeValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
}

interface COGSBreakdown {
  fieldName: string;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  value: number;
  calculatedCost: number;
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
  
  // Per-order P/L cache (orderId -> profit/loss)
  const [orderProfitLoss, setOrderProfitLoss] = useState<Map<number, number>>(new Map());

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
      const [ordersResponse, discardedResponse, rtoResponse, cogsConfigResponse] = await Promise.all([
        api.getOrders(250, true), // Fetch all orders (not filtered) - Shopify max per request is 250
        api.getDiscardedOrderIds(),
        api.getRTOOrderIds(),
        api.getCOGSConfiguration(),
      ]);
      
      if (ordersResponse.success && ordersResponse.orders) {
        console.log(`Loaded ${ordersResponse.orders.length} orders from API`);
        
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
          } else if (deliveryStatusLower === 'failure' || deliveryStatusLower === 'attempted_delivery') {
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
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Clear the cache first
      await api.clearOrdersCache();
      // Then reload the data
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

  // Get available months from orders
  const getAvailableMonths = () => {
    const monthsSet = new Set<string>();
    orders.forEach(order => {
      const orderDate = new Date(order.createdAt);
      const monthKey = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}`;
      monthsSet.add(monthKey);
    });
    return Array.from(monthsSet).sort().reverse();
  };

  const availableMonths = getAvailableMonths();

  // Helper function to check order status
  const getOrderStatus = (order: ShopifyOrder) => {
    const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
    
    // Failed statuses: failure, attempted_delivery
    const isFailed = deliveryStatus === 'failure' || 
                     deliveryStatus === 'attempted_delivery' ||
                     deliveryStatus.includes('failed') || 
                     deliveryStatus.includes('attempted') || 
                     deliveryStatus.includes('delayed');
    
    // Delivered statuses: delivered only
    const isDelivered = deliveryStatus === 'delivered';
    
    // Unfulfilled: Check fulfillmentStatus first (null, '', or 'unfulfilled' means not fulfilled)
    // If fulfillmentStatus is null/empty/unfulfilled, the order is truly unfulfilled
    const isUnfulfilled = !fulfillmentStatus || 
                          fulfillmentStatus === '' || 
                          fulfillmentStatus === 'unfulfilled';
    
    return { isFailed, isDelivered, isUnfulfilled };
  };

  // Filter orders based on selected month, status filters, and exclude discarded/cancelled orders
  const getFilteredOrders = () => {
    // Exclude discarded orders and cancelled orders
    let filtered = orders.filter(order => 
      !discardedOrderIds.has(order.id) && !order.cancelledAt
    );
    
    // Apply month filter
    if (selectedMonthFilter !== 'all') {
      let targetMonth: number;
      let targetYear: number;
      
      if (selectedMonthFilter === 'current') {
        targetMonth = new Date().getMonth();
        targetYear = new Date().getFullYear();
      } else {
        // Format: YYYY-MM
        const [year, month] = selectedMonthFilter.split('-');
        targetYear = parseInt(year);
        targetMonth = parseInt(month) - 1;
      }
      
      filtered = filtered.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate.getMonth() === targetMonth && orderDate.getFullYear() === targetYear;
      });
    }
    
    // Apply status filters (works with month filter via AND, multiple status filters use OR)
    if (showUnfulfilled || showDelivered || showFailed) {
      filtered = filtered.filter(order => {
        const { isFailed, isDelivered, isUnfulfilled } = getOrderStatus(order);
        
        // If multiple status filters are active, order must match at least one (OR logic)
        const matchesUnfulfilled = showUnfulfilled && isUnfulfilled;
        const matchesDelivered = showDelivered && isDelivered;
        const matchesFailed = showFailed && isFailed;
        
        return matchesUnfulfilled || matchesDelivered || matchesFailed;
      });
    }
    
    return filtered;
  };

  const filteredOrders = getFilteredOrders();

  // Clear selections when filters change
  useEffect(() => {
    setSelectedOrders(new Set());
    setSelectAll(false);
  }, [selectedMonthFilter, showUnfulfilled, showDelivered, showFailed]);

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

  // Calculate stats from filtered orders (already excludes cancelled orders)
  const calculateStats = () => {
    const totalOrders = filteredOrders.length;
    let ndrCount = 0;
    let deliveredCount = 0;
    let prepaidCount = 0;
    let codCount = 0;
    let fulfilledCount = 0; // Orders that have been fulfilled (delivered or attempted)

    filteredOrders.forEach(order => {
      // Count prepaid vs COD
      if (order.paymentMethod === 'Prepaid') {
        prepaidCount++;
      } else {
        codCount++;
      }

      // Check if NDR (RTO, Failed, etc.)
      const isNDR = rtoOrderIds.has(order.id) || 
                    (order.deliveryStatus && (
                      order.deliveryStatus.toLowerCase().includes('rto') ||
                      order.deliveryStatus.toLowerCase().includes('failed') ||
                      order.deliveryStatus.toLowerCase().includes('undelivered')
                    ));

      // Check if order has been fulfilled (shipped)
      // Use fulfillment_status - if it's 'fulfilled' or 'partial', the order has been fulfilled
      const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
      const isFulfilled = fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'partial';

      if (isFulfilled) {
        fulfilledCount++;
      }

      if (isNDR) {
        ndrCount++;
      } else if (order.paymentMethod === 'Prepaid' || order.deliveryStatus?.toLowerCase() === 'delivered') {
        deliveredCount++;
      }
    });

    // Calculate NDR Rate based on fulfilled orders only
    const ndrRate = fulfilledCount > 0 ? (ndrCount / fulfilledCount) * 100 : 0;

    return {
      totalOrders,
      ndrCount,
      deliveredCount,
      ndrRate,
      prepaidCount,
      codCount,
      fulfilledCount,
    };
  };

  const stats = calculateStats();

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
    
    // NDR statuses: failed, attempted delivery, RTO-related
    const ndrStatuses = ['failed', 'attempted', 'rto', 'return'];
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

  // Calculate profit/loss for an order based on delivery status
  const calculateOrderProfitLoss = useCallback((order: ShopifyOrder): number => {
    if (cogsConfig.length === 0) {
      return 0;
    }
    
    const variant = detectVariant(order);
    const isDelivered = isOrderDelivered(order);
    
    // Determine revenue and which fields to use
    let revenue = 0;
    let fieldsToUse: COGSField[] = [];
    
    if (isDelivered) {
      // Delivered = Got money
      revenue = order.totalPrice || 0;
      // Use COGS only + Both fields
      fieldsToUse = cogsConfig.filter(f => f.type === 'cogs' || f.type === 'both');
    } else {
      // NDR/RTO/Failed = No money
      revenue = 0;
      // Use NDR only + Both fields
      fieldsToUse = cogsConfig.filter(f => f.type === 'ndr' || f.type === 'both');
    }
    
    // Calculate total costs
    let totalCosts = 0;
    fieldsToUse.forEach(field => {
      const value = variant === 'small' ? field.smallValue : field.largeValue;
      
      if (field.calculationType === 'fixed') {
        totalCosts += value;
      } else {
        // Percentage of sale price (use original sale price even for NDR)
        totalCosts += (value / 100) * (order.totalPrice || 0);
      }
    });
    
    return revenue - totalCosts;
  }, [cogsConfig, isOrderDelivered]);

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
    
    // Determine config type based on delivery status
    const configType = isOrderDelivered(order) ? 'cogs' : 'ndr';
    
    setSelectedVariant(variant);
    calculateCogsBreakdown(cogsConfig, order.totalPrice || 0, variant, configType);
    setShowCogsModal(true);
  };

  const calculateCogsBreakdown = (fields: COGSField[], salePrice: number, variant: 'small' | 'large', configType: 'cogs' | 'ndr' | 'both') => {
    const breakdown: COGSBreakdown[] = [];
    
    // Filter fields based on config type
    const fieldsToUse: COGSField[] = 
      configType === 'cogs' ? fields.filter(f => f.type === 'cogs' || f.type === 'both') :
      configType === 'ndr' ? fields.filter(f => f.type === 'ndr' || f.type === 'both') :
      fields; // 'both' uses all fields
    
    fieldsToUse.forEach(field => {
      const value = variant === 'small' ? field.smallValue : field.largeValue;
      let calculatedCost = 0;
      
      if (field.calculationType === 'fixed') {
        calculatedCost = value;
      } else {
        // Percentage of sale price
        calculatedCost = (value / 100) * salePrice;
      }
      
      breakdown.push({
        fieldName: field.name,
        type: field.type,
        calculationType: field.calculationType,
        value: value,
        calculatedCost: calculatedCost,
      });
    });
    
    setCogsBreakdown(breakdown);
  };

  const calculateTotalCogs = () => {
    return cogsBreakdown.reduce((sum, item) => sum + item.calculatedCost, 0);
  };

  const calculateProfit = () => {
    if (!selectedOrderForCogs) return 0;
    const profitLoss = orderProfitLoss.get(selectedOrderForCogs.id);
    return profitLoss !== undefined ? profitLoss : 0;
  };

  if (isLoading) {
    return (
      <div className={styles['loading-section']}>
        <div className={styles.spinner}></div>
        <p>Loading orders...</p>
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

        {/* Stats Section */}
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
            <div className={styles['stat-subtext']}>{formatIndianNumber(stats.ndrCount, 0)} / {formatIndianNumber(stats.fulfilledCount, 0)} fulfilled</div>
          </div>
          
          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>Delivered</div>
            <div className={styles['stat-value']}>{formatIndianNumber(stats.deliveredCount, 0)}</div>
            <div className={styles['stat-subtext']}>
              {formatIndianNumber(stats.prepaidCount, 0)} prepaid · {formatIndianNumber(stats.codCount, 0)} COD
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
          {(showUnfulfilled || showDelivered || showFailed) && (
            <button
              onClick={() => {
                setShowUnfulfilled(false);
                setShowDelivered(false);
                setShowFailed(false);
              }}
              className={styles['clear-filters-btn']}
            >
              Clear filters
            </button>
          )}
        </div>

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
                <th>Date</th>
                <th className={styles['actions-header']}>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className={styles['empty-state']}>
                    <div className={styles['empty-icon']}>📦</div>
                    <div className={styles['empty-text']}>No orders found</div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className={selectedOrders.has(order.id) ? styles.selected : ''}
                  >
                    <td className={styles['checkbox-cell']}>
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(order.id)}
                        onChange={() => handleSelectOrder(order.id)}
                        className={styles['table-checkbox']}
                      />
                    </td>
                    <td className={styles['order-name']}>
                      <div className={styles['order-name-wrapper']}>
                        <span className={`${styles['payment-dot']} ${styles[order.paymentMethod?.toLowerCase() || 'prepaid']}`}></span>
                        <span className={styles['order-number']}>{order.name}</span>
                      </div>
                    </td>
                    <td className={styles['line-items']}>
                      {order.lineItems && order.lineItems.length > 0 ? (
                        <div className={styles['items-list']}>
                          {order.lineItems.map((item, idx) => (
                            <div key={idx} className={styles.item}>
                              {item.quantity}x {item.title}
                              {item.variantTitle && ` (${item.variantTitle})`}
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={styles['order-tags']}>
                      <div className={styles['tags-wrapper']}>
                        {(() => {
                          const delayDays = getDelayDays(order);
                          if (delayDays) {
                            return (
                              <span className={`${styles['tag-badge']} ${styles['delay-tag']}`}>
                                {delayDays} day{delayDays > 1 ? 's' : ''} delay
                              </span>
                            );
                          }
                          return null;
                        })()}
                        {(() => {
                          const deliveryBadge = getDeliveryStatusBadge(order.deliveryStatus);
                          return deliveryBadge.text !== '—' && (
                            <span className={`${styles['tag-badge']} ${styles[`delivery-${deliveryBadge.className}`]}`}>
                              {deliveryBadge.text}
                            </span>
                          );
                        })()}
                        {rtoOrderIds.has(order.id) && (
                          <span className={`${styles['tag-badge']} ${styles.rto}`}>RTO</span>
                        )}
                      </div>
                    </td>
                    <td className={styles['order-date']}>
                      {new Date(order.createdAt).toLocaleDateString('en-IN', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </td>
                    <td className={styles['actions-cell']}>
                      <button
                        onClick={() => handleOpenCogsModal(order)}
                        className={styles['action-btn']}
                        title="View Breakdown"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
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

              <div className={styles['cogs-breakdown']}>
                    <h4>COGS Breakdown</h4>
                    <div className={styles['breakdown-list']}>
                      {cogsBreakdown.length === 0 ? (
                        <p className={styles['no-data']}>No COGS configuration available</p>
                      ) : (
                        cogsBreakdown.map((item, idx) => (
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

                  <div className={styles['cogs-summary']}>
                    <div className={styles['summary-row']}>
                      <span className={styles['summary-label']}>Total COGS:</span>
                      <span className={styles['summary-value']}>
                        ₹{formatIndianNumber(calculateTotalCogs())}
                      </span>
                    </div>
                    <div className={styles['summary-row']}>
                      <span className={styles['summary-label']}>Sale Price:</span>
                      <span className={styles['summary-value']}>
                        ₹{formatIndianNumber(selectedOrderForCogs.totalPrice || 0)}
                      </span>
                    </div>
                    <div className={`${styles['summary-row']} ${styles['profit-row']}`}>
                      <span className={styles['summary-label']}>
                        {calculateProfit() >= 0 ? 'Profit' : 'Loss'}:
                      </span>
                      <span className={`${styles['summary-value']} ${calculateProfit() >= 0 ? styles.profit : styles.loss}`}>
                        ₹{formatIndianNumber(Math.abs(calculateProfit()))}
                      </span>
                    </div>
                  </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
