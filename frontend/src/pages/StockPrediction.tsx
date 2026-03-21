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

interface StockPredictionResult {
  productName: string;
  variantTitle: string;
  currentAvgPerDay: number;
  requiredStock: number;
  reasoning: string;
}

export function StockPrediction() {
  const [products, setProducts] = useState<ProductStats[]>([]);
  const [predictionResults, setPredictionResults] = useState<StockPredictionResult[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPredicting, setIsPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startDate] = useState<Date>(new Date('2026-01-28'));
  const [daysSinceStart, setDaysSinceStart] = useState<number>(0);
  const [predictionDays, setPredictionDays] = useState<number>(30);

  useEffect(() => {
    loadOrdersAndCalculate();
  }, [startDate]);

  const loadOrdersAndCalculate = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setPredictionResults([]);

      // Fetch all orders
      const response = await api.getOrders(1000, true);
      
      if (!response.success || !response.orders) {
        setError('Failed to fetch orders');
        return;
      }

      // Filter: Ignore everything created before Start Date
      const filteredOrders = response.orders.filter(order => {
        const orderDate = new Date(order.createdAt);
        return orderDate >= startDate && !order.cancelledAt;
      });

      // Calculate days since start date
      const today = new Date();
      const days = Math.max(1, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
      setDaysSinceStart(days);

      // Group by product + variant and count
      const productMap = new Map<string, { title: string; variant: string; count: number; firstSeen: Date }>();
      const allowedBooks = [
        { key: 'jyotirling', label: 'Jyotirling' },
        { key: 'bharat ke dhaam', label: 'Bharat ke Dhaam' }
      ];

      filteredOrders.forEach((order: ShopifyOrder) => {
        const orderDate = new Date(order.createdAt);
        order.lineItems?.forEach(item => {
          const itemTitle = item.title.toLowerCase();
          
          // Only include specific books and find their normalized label
          const matchedBook = allowedBooks.find(book => itemTitle.includes(book.key));
          if (!matchedBook) {
            return;
          }

          const normalizedTitle = matchedBook.label;
          const variantTitle = (item.variantTitle || 'Default').trim();
          
          // Use normalized title as part of the key to merge different historical names
          const productKey = `${normalizedTitle}|||${variantTitle}`;
          const existing = productMap.get(productKey);
          
          if (existing) {
            existing.count += item.quantity;
            // Update first seen if this order is earlier
            if (orderDate < existing.firstSeen) {
              existing.firstSeen = orderDate;
            }
          } else {
            productMap.set(productKey, {
              title: normalizedTitle,
              variant: variantTitle,
              count: item.quantity,
              firstSeen: orderDate
            });
          }
        });
      });

      // Calculate average orders per day based on product-specific days active
      const now = new Date();
      const calculatedStats: ProductStats[] = Array.from(productMap.values())
        .map((product) => {
          // Calculate days since this specific product was first seen
          const productDaysActive = Math.max(1, Math.ceil((now.getTime() - product.firstSeen.getTime()) / (1000 * 60 * 60 * 24)));
          
          return {
            productName: product.title,
            variantTitle: product.variant,
            totalOrders: product.count,
            avgOrdersPerDay: product.count / productDaysActive,
            daysActive: productDaysActive
          };
        })
        .filter(p => p.avgOrdersPerDay > 0)
        .sort((a, b) => b.avgOrdersPerDay - a.avgOrdersPerDay);

      setProducts(calculatedStats);
    } catch (err) {
      console.error('Error calculating stock prediction:', err);
      setError('Failed to calculate stock prediction');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunAiPrediction = async () => {
    if (products.length === 0) return;
    
    try {
      setIsPredicting(true);
      const res = await api.predictStock({
        daysToPredict: predictionDays,
        historicalData: products,
        totalBusinessDays: daysSinceStart
      });

      if (res.success && res.predictions) {
        setPredictionResults(res.predictions);
      } else {
        alert(res.error || 'AI Prediction failed');
      }
    } catch (err) {
      alert('Error running AI stock prediction');
    } finally {
      setIsPredicting(false);
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
        <div className={styles['header-actions']}>
          <div className={styles['prediction-input-group']}>
            <label htmlFor="predict-days">Predict for</label>
            <input 
              id="predict-days"
              type="number" 
              value={predictionDays} 
              onChange={(e) => setPredictionDays(parseInt(e.target.value) || 0)}
              className={styles['days-input']}
            />
            <span>days</span>
          </div>
          <button 
            onClick={handleRunAiPrediction} 
            className={styles['ai-btn']}
            disabled={isPredicting || products.length === 0}
          >
            {isPredicting ? 'Analyzing...' : 'Predict with AI'}
          </button>
          <button onClick={loadOrdersAndCalculate} className={styles['refresh-btn']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
          </button>
        </div>
      </div>

      {predictionResults.length > 0 ? (
        <div className={styles['ai-results-container']}>
          <div className={styles['results-header']}>
            <h3>AI Prediction Results ({predictionDays} Days)</h3>
            <button className={styles['clear-btn']} onClick={() => setPredictionResults([])}>Clear</button>
          </div>
          <div className={styles['table-container']}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Variant</th>
                  <th>Avg Sales/Day</th>
                  <th className={styles['highlight-th']}>Required Stock</th>
                  <th>Reasoning</th>
                </tr>
              </thead>
              <tbody>
                {predictionResults.map((result, idx) => (
                  <tr key={idx} className={styles['ai-row']}>
                    <td className={styles['product-name']}>{result.productName}</td>
                    <td>{result.variantTitle}</td>
                    <td>{result.currentAvgPerDay.toFixed(2)}</td>
                    <td className={styles['required-stock-cell']}>
                      <span className={styles['stock-badge']}>{result.requiredStock}</span>
                    </td>
                    <td className={styles['reasoning-cell']}>{result.reasoning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
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
                        {product.avgOrdersPerDay.toFixed(2)}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {products.length > 0 && !predictionResults.length && (
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
            <div className={styles['summary-label']}>Total Avg Orders/Day</div>
            <div className={styles['summary-value']}>
              {products.reduce((sum, p) => sum + p.avgOrdersPerDay, 0).toFixed(2)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
