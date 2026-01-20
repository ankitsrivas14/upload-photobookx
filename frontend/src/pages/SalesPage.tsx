import { useState, useEffect } from 'react';
import { api } from '../services/api';
import './SalesPage.css';

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
      const [ordersResponse, discardedResponse] = await Promise.all([
        api.getOrders(250, true), // Fetch all orders (not filtered)
        api.getDiscardedOrderIds(),
      ]);
      
      if (ordersResponse.success && ordersResponse.orders) {
        setOrders(ordersResponse.orders);
      }
      
      if (discardedResponse.success) {
        setDiscardedOrderIds(new Set(discardedResponse.discardedOrderIds));
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
      <div className="loading-section">
        <div className="spinner"></div>
        <p>Loading orders...</p>
      </div>
    );
  }

  return (
    <div className="sales-page">
      <div className="content-section">
        <div className="section-header">
          <div className="header-content">
            <div>
              <h2>Sales</h2>
              <p>Shopify orders • {filteredOrders.length} orders</p>
            </div>
            <div className="header-actions">
              <div className="month-filter">
                <label htmlFor="month-select">Period:</label>
                <select 
                  id="month-select"
                  value={selectedMonthFilter} 
                  onChange={(e) => {
                    setSelectedMonthFilter(e.target.value);
                    setSelectedOrders(new Set());
                    setSelectAll(false);
                  }}
                  className="filter-select"
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
                <div className="bulk-actions">
                  <span className="selected-count">{selectedOrders.size} selected</span>
                  <div className="bulk-action-dropdown">
                    <button 
                      className="bulk-action-btn"
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
                      <div className="bulk-menu">
                        <button 
                          className="bulk-menu-item discard"
                          onClick={handleDiscardOrders}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18"/>
                            <path d="M6 6l12 12"/>
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
        <div className="orders-table-container">
          <table className="orders-table">
            <thead>
              <tr>
                <th className="checkbox-cell">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={handleSelectAll}
                    className="table-checkbox"
                  />
                </th>
                <th>Order</th>
                <th>Items</th>
                <th>Payment</th>
                <th>Delivery Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    <div className="empty-icon">📦</div>
                    <div className="empty-text">No orders found</div>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className={selectedOrders.has(order.id) ? 'selected' : ''}
                  >
                    <td className="checkbox-cell">
                      <input
                        type="checkbox"
                        checked={selectedOrders.has(order.id)}
                        onChange={() => handleSelectOrder(order.id)}
                        className="table-checkbox"
                      />
                    </td>
                    <td className="order-name">{order.name}</td>
                    <td className="line-items">
                      {order.lineItems && order.lineItems.length > 0 ? (
                        <div className="items-list">
                          {order.lineItems.map((item, idx) => (
                            <div key={idx} className="item">
                              {item.quantity}x {item.title}
                              {item.variantTitle && ` (${item.variantTitle})`}
                            </div>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="payment-method">
                      <span className={`payment-badge ${order.paymentMethod?.toLowerCase() || 'prepaid'}`}>
                        {order.paymentMethod || 'Prepaid'}
                      </span>
                    </td>
                    <td className="delivery-status">
                      {(() => {
                        const badge = getDeliveryStatusBadge(order.deliveryStatus);
                        return badge.text === '—' ? (
                          <span className="status-empty">—</span>
                        ) : (
                          <span className={`status-badge ${badge.className}`}>
                            {badge.text}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="order-date">
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
