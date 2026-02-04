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
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>('all'); // 'all', 'current', or 'YYYY-MM'
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
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

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [ordersResponse, discardedResponse, rtoResponse, cogsConfigResponse] = await Promise.all([
        api.getOrders(250, true), // Fetch all orders (not filtered)
        api.getDiscardedOrderIds(),
        api.getRTOOrderIds(),
        api.getCOGSConfiguration(),
      ]);
      
      if (ordersResponse.success && ordersResponse.orders) {
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

  // Filter orders based on selected month and exclude discarded orders
  const getFilteredOrders = () => {
    const filtered = orders.filter(order => !discardedOrderIds.has(order.id));
    
    if (selectedMonthFilter === 'all') {
      return filtered;
    }
    
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
    
    return filtered.filter(order => {
      const orderDate = new Date(order.createdAt);
      return orderDate.getMonth() === targetMonth && orderDate.getFullYear() === targetYear;
    });
  };

  const filteredOrders = getFilteredOrders();

  // Calculate stats from filtered orders
  const calculateStats = () => {
    const totalOrders = filteredOrders.length;
    let netProfitLoss = 0;
    let totalRevenue = 0;
    let ndrCount = 0;
    let deliveredCount = 0;
    let prepaidCount = 0;
    let codCount = 0;

    filteredOrders.forEach(order => {
      const pl = orderProfitLoss.get(order.id) || 0;
      netProfitLoss += pl;

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

      if (isNDR) {
        ndrCount++;
      } else if (order.paymentMethod === 'Prepaid' || order.deliveryStatus?.toLowerCase() === 'delivered') {
        deliveredCount++;
        totalRevenue += order.totalPrice || 0;
      }
    });

    const ndrRate = totalOrders > 0 ? (ndrCount / totalOrders) * 100 : 0;

    return {
      totalOrders,
      netProfitLoss,
      totalRevenue,
      ndrCount,
      deliveredCount,
      ndrRate,
      prepaidCount,
      codCount,
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
            <div className={styles['stat-label']}>Net P/L</div>
            <div className={`${styles['stat-value']} ${stats.netProfitLoss >= 0 ? styles.profit : styles.loss}`}>
              {stats.netProfitLoss >= 0 ? '+' : ''}₹{formatIndianNumber(Math.abs(stats.netProfitLoss))}
            </div>
          </div>
          
          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>Total Revenue</div>
            <div className={styles['stat-value']}>₹{formatIndianNumber(stats.totalRevenue)}</div>
          </div>
          
          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>NDR Rate</div>
            <div className={`${styles['stat-value']} ${stats.ndrRate > 15 ? styles['ndr-high'] : styles['ndr-normal']}`}>
              {formatIndianNumber(stats.ndrRate, 1)}%
            </div>
            <div className={styles['stat-subtext']}>{formatIndianNumber(stats.ndrCount, 0)} / {formatIndianNumber(stats.totalOrders, 0)} orders</div>
          </div>
          
          <div className={styles['stat-card']}>
            <div className={styles['stat-label']}>Delivered</div>
            <div className={styles['stat-value']}>{formatIndianNumber(stats.deliveredCount, 0)}</div>
            <div className={styles['stat-subtext']}>
              {formatIndianNumber(stats.prepaidCount, 0)} prepaid · {formatIndianNumber(stats.codCount, 0)} COD
            </div>
          </div>
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
                <th className={styles['pl-header']}>P/L</th>
                <th className={styles['actions-header']}>Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className={styles['empty-state']}>
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
                    <td className={styles['pl-cell']}>
                      {(() => {
                        const pl = orderProfitLoss.get(order.id);
                        if (pl === undefined) return '—';
                        const isProfit = pl >= 0;
                        return (
                          <span className={`${styles['pl-value']} ${isProfit ? styles.profit : styles.loss}`}>
                            {isProfit ? '+' : ''}₹{formatIndianNumber(Math.abs(pl))}
                          </span>
                        );
                      })()}
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
