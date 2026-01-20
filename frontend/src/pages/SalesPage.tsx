import { useState, useEffect } from 'react';
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
  lineItems?: Array<{
    title: string;
    quantity: number;
    variantTitle?: string;
  }>;
}

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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [ordersResponse, discardedResponse, rtoResponse] = await Promise.all([
        api.getOrders(250, true), // Fetch all orders (not filtered)
        api.getDiscardedOrderIds(),
        api.getRTOOrderIds(),
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
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setIsLoading(false);
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
    let filtered = orders.filter(order => !discardedOrderIds.has(order.id));
    
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

  const handleRestoreOrders = async () => {
    if (selectedOrders.size === 0) return;
    
    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const response = await api.restoreOrders(orderIds);
      if (response.success) {
        // Update local state
        const newDiscarded = new Set(discardedOrderIds);
        orderIds.forEach(id => newDiscarded.delete(id));
        setDiscardedOrderIds(newDiscarded);
        setSelectedOrders(new Set());
        setSelectAll(false);
        setShowBulkMenu(false);
      }
    } catch (err) {
      console.error('Failed to restore orders:', err);
      alert('Failed to restore orders');
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
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles['empty-state']}>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
