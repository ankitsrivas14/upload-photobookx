import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { ShopifyOrder } from '../services/api';
import styles from './StockPrediction.module.css';

interface ProductStats {
  productName: string;
  variantTitle: string;
  totalOrders: number;
  avgOrdersPerDay: number;
}

export function StockPrediction() {
  const [products, setProducts] = useState<ProductStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate] = useState<Date>(new Date('2026-01-28'));
  const [daysSinceStart, setDaysSinceStart] = useState<number>(0);

  useEffect(() => {
    loadOrdersAndCalculate();
  }, []);

  const loadOrdersAndCalculate = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch all orders
      const response = await api.getOrders(1000, true, '2026-01-28');
      
      if (!response.success || !response.orders) {
        setError('Failed to fetch orders');
        return;
      }

      // Filter orders from Jan 28, 2026 onwards
      const filteredOrders = response.orders.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= startDate && !order.cancelledAt;
      });

      // Calculate days since start date
      const today = new Date();
      const days = Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
      setDaysSinceStart(days);

      // Group by product + variant and count
      const productMap = new Map<string, { title: string; variant: string; count: number }>();

      filteredOrders.forEach((order: ShopifyOrder) => {
        order.lineItems?.forEach(item => {
          const variantTitle = item.variantTitle || 'Default';
          const productKey = `${item.title}|||${variantTitle}`;
          const existing = productMap.get(productKey);
          
          if (existing) {
            existing.count += item.quantity;
          } else {
            productMap.set(productKey, {
              title: item.title,
              variant: variantTitle,
              count: item.quantity,
            });
          }
        });
      });

      // Calculate average orders per day and prepare data
      const productStats: ProductStats[] = Array.from(productMap.values())
        .map((product) => ({
          productName: product.title,
          variantTitle: product.variant,
          totalOrders: product.count,
          avgOrdersPerDay: Math.floor(product.count / days),
        }))
        .filter(p => p.avgOrdersPerDay > 0) // Remove products with 0 avg orders per day
        .sort((a, b) => b.avgOrdersPerDay - a.avgOrdersPerDay);

      setProducts(productStats);
    } catch (err) {
      console.error('Error calculating stock prediction:', err);
      setError('Failed to calculate stock prediction');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles['stock-prediction']}>
        <div className={styles['loading-header']}>
          <div className={styles['loading-title']} />
          <div className={styles['loading-subtitle']} />
        </div>
        <div className={styles['table-container']}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Variant</th>
                <th>Total Orders</th>
                <th>Avg Orders/Day</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <tr key={i}>
                  <td><span className={`${styles['skeleton']} ${styles['skeleton-wide']}`} /></td>
                  <td><span className={`${styles['skeleton']} ${styles['skeleton-narrow']}`} /></td>
                  <td><span className={styles['skeleton']} /></td>
                  <td><span className={styles['skeleton']} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles['loading-hint']}>
          Analyzing orders…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles['stock-prediction']}>
        <div className={styles.error}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p>{error}</p>
          <button onClick={loadOrdersAndCalculate} className={styles['retry-btn']}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles['stock-prediction']}>
      <div className={styles.header}>
        <div className={styles['header-info']}>
          <h2>Stock Prediction</h2>
          <p className={styles.subtitle}>
            Based on orders from {startDate.toLocaleDateString()} onwards ({daysSinceStart} days)
          </p>
        </div>
        <button onClick={loadOrdersAndCalculate} className={styles['refresh-btn']}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2v6h-6" />
            <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" />
            <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          Refresh
        </button>
      </div>

      <div className={styles['table-container']}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Variant</th>
              <th>Total Orders</th>
              <th>Avg Orders/Day</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={4} className={styles['no-data']}>
                  No orders found from {startDate.toLocaleDateString()}
                </td>
              </tr>
            ) : (
              products.map((product, index) => (
                <tr key={index}>
                  <td className={styles['product-name']}>{product.productName}</td>
                  <td className={styles['variant-title']}>{product.variantTitle}</td>
                  <td className={styles['total-orders']}>{product.totalOrders}</td>
                  <td className={styles['avg-orders']}>
                    <span className={styles['avg-badge']}>
                      {product.avgOrdersPerDay}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {products.length > 0 && (
        <div className={styles.summary}>
          <div className={styles['summary-card']}>
            <div className={styles['summary-label']}>Total Products</div>
            <div className={styles['summary-value']}>{products.length}</div>
          </div>
          <div className={styles['summary-card']}>
            <div className={styles['summary-label']}>Total Orders</div>
            <div className={styles['summary-value']}>
              {products.reduce((sum, p) => sum + p.totalOrders, 0)}
            </div>
          </div>
          <div className={styles['summary-card']}>
            <div className={styles['summary-label']}>Avg Orders/Day</div>
            <div className={styles['summary-value']}>
              {Math.floor(products.reduce((sum, p) => sum + p.avgOrdersPerDay, 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
