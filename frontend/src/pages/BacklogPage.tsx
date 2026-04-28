import { useState, useEffect, useMemo } from 'react';
import { api, type ShopifyOrder } from '../services/api';
import styles from './BacklogPage.module.css';
import toast from 'react-hot-toast';

type ViewMode = 'all' | 'default';

export default function BacklogPage() {
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('default');

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const response = await api.getOrders(10000, true);
      if (response.success && response.orders) {
        const startDate = new Date(2026, 0, 1);
        const filtered = response.orders.filter(o => 
          new Date(o.createdAt) >= startDate && !o.cancelledAt
        );
        setOrders(filtered);
      } else {
        toast.error(response.error || 'Failed to load orders');
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
      toast.error('An error occurred while loading orders');
    } finally {
      setLoading(false);
    }
  };

  const monthsRange = useMemo(() => {
    const months = [];
    const startDate = new Date(2026, 0, 1); // Jan 2026
    const endDate = new Date();

    let current = new Date(startDate);
    while (current <= endDate) {
      months.push({
        label: current.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        key: `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`
      });
      current.setMonth(current.getMonth() + 1);
    }
    return months;
  }, []);

  const getOrderMonthKey = (createdAt: string) => {
    const d = new Date(createdAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  const getStatusClass = (order: ShopifyOrder) => {
    const status = order.deliveryStatus?.toLowerCase() || '';
    const fulfillment = order.fulfillmentStatus || '';

    if (status === 'delivered') return styles.delivered;
    if (status.includes('fail') || status.includes('rto')) return styles.failed;
    if (status.includes('transit') || status.includes('shipped')) return styles.transit;
    if (status === 'out_for_delivery') return styles.outForDelivery;
    if (!fulfillment || fulfillment === 'unfulfilled') return styles.unfulfilled;
    return styles.confirmed;
  };

  const filteredOrdersByView = useMemo(() => {
    if (viewMode === 'all') return orders;
    
    return orders.filter(order => {
      const status = order.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed = status.includes('fail') || status.includes('rto');
      const isAttempted = status === 'attempted_delivery';
      
      return !isDelivered && !isFailed && !isAttempted;
    });
  }, [orders, viewMode]);

  const ordersByMonth = useMemo(() => {
    return monthsRange.map(month => {
      const monthOrders = filteredOrdersByView
        .filter(o => getOrderMonthKey(o.createdAt) === month.key)
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        
      return {
        ...month,
        orders: monthOrders
      };
    }).filter(m => m.orders.length > 0 || m.key === getOrderMonthKey(new Date().toISOString()));
  }, [filteredOrdersByView, monthsRange]);

  return (
    <div className={styles['backlog-page']}>
      <header className={styles['header']}>
        <div className={styles['header-left']}>
          <div className={styles['titles']}>
            <h1>Backlog Mosaic</h1>
            <p className={styles['subtitle']}>Orders history from Jan 2026</p>
          </div>
        </div>
        <div className={styles['header-actions']}>
          <div className={styles['legend']}>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.unfulfilled}`}></span> Unfulfilled</div>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.transit}`}></span> In Transit</div>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.delivered}`}></span> Delivered</div>
            <div className={styles['legend-item']}><span className={`${styles['box-preview']} ${styles.failed}`}></span> Failed</div>
          </div>
          <div className={styles['view-selector']}>
            <label htmlFor="view-mode">View Mode</label>
            <select 
              id="view-mode"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className={styles['select-input']}
            >
              <option value="default">Default (Actionable)</option>
              <option value="all">All Orders</option>
            </select>
          </div>
          <button className={styles['refresh-btn']} onClick={loadOrders} disabled={loading}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? styles.spinning : ''}>
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
            {loading ? '...' : 'Refresh'}
          </button>
        </div>
      </header>

      <div className={styles['content']}>
        {loading ? (
          <div className={styles['loading-state']}>
            <div className={styles['spinner']}></div>
            <p>Scanning orders...</p>
          </div>
        ) : orders.length === 0 ? (
          <div className={styles['empty-state']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <h3>No results</h3>
            <p>No orders matched your current view criteria.</p>
          </div>
        ) : (
          <div className={styles['month-sections']}>
            {ordersByMonth.map(section => (
              <section key={section.key} className={styles['month-section']}>
                <div className={styles['section-header']}>
                  <h2 className={styles['month-title']}>{section.label}</h2>
                  <span className={styles['month-count']}>{section.orders.length}</span>
                </div>
                <div className={styles['orders-grid']}>
                  {section.orders.map(order => (
                    <div 
                      key={order.id} 
                      className={`${styles['order-box']} ${getStatusClass(order)}`}
                    >
                      <div className={styles['box-hover-card']}>
                         <div className={styles['card-name']}>{order.name}</div>
                         <div className={styles['card-customer']}>{order.customerName}</div>
                         <div className={styles['card-status']}>{order.deliveryStatus || order.fulfillmentStatus || 'Pending'}</div>
                         <div className={styles['card-items']}>
                           {order.lineItems && order.lineItems.length > 0 ? (
                             order.lineItems.map((item, idx) => (
                               <div key={idx} className={styles['item-row']}>
                                 <span className={styles['item-qty']}>{item.quantity}x</span>
                                 <div className={styles['item-details']}>
                                   <span className={styles['item-title']}>{item.title}</span>
                                   {item.variantTitle && (
                                     <span className={styles['item-variant']}>{item.variantTitle}</span>
                                   )}
                                 </div>
                               </div>
                             ))
                           ) : (
                             <div className={styles['item-row']}>No items listed</div>
                           )}
                         </div>
                         <div className={styles['card-date']}>{new Date(order.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
