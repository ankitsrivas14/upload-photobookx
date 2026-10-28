import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../services/api';
import type { ShopifyOrder } from '../services/api';
import { Alert, Button, Card, DataTable, EmptyState, StatCard, StatStrip, TextField, type Column } from '../components/ui/pbx';
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

const rowId = (r: { productName: string; variantTitle: string }) => `${r.productName}|||${r.variantTitle}`;

const SALES_COLUMNS: Column<ProductStats>[] = [
  { key: 'productName', header: 'Product', render: (r) => <span className={styles.product}>{r.productName}</span> },
  { key: 'variantTitle', header: 'Variant' },
  { key: 'totalOrders', header: 'Copies sold', numeric: true, render: (r) => r.totalOrders.toLocaleString('en-IN') },
  { key: 'avgOrdersPerDay', header: 'Per day', numeric: true, render: (r) => r.avgOrdersPerDay.toFixed(2) },
];

const PREDICTION_COLUMNS: Column<StockPredictionResult>[] = [
  { key: 'productName', header: 'Product', render: (r) => <span className={styles.product}>{r.productName}</span> },
  { key: 'variantTitle', header: 'Variant' },
  { key: 'currentAvgPerDay', header: 'Per day', numeric: true, render: (r) => r.currentAvgPerDay.toFixed(2) },
  { key: 'requiredStock', header: 'Stock needed', numeric: true, render: (r) => <strong>{r.requiredStock.toLocaleString('en-IN')}</strong> },
  { key: 'reasoning', header: 'Reasoning', render: (r) => <span className={styles.reasoning}>{r.reasoning}</span> },
];

/** Stock prediction: copies sold per book variant since launch, and an AI estimate of the stock to hold. */
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
      const response = await api.getOrders(10000, true);

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
        toast.error(res.error || 'AI prediction failed');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not run the AI stock prediction'));
    } finally {
      setIsPredicting(false);
    }
  };

  const refresh = () => {
    api.invalidateCache();
    loadOrdersAndCalculate();
  };

  const since = startDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const totalSold = products.reduce((sum, p) => sum + p.totalOrders, 0);
  const totalPerDay = products.reduce((sum, p) => sum + p.avgOrdersPerDay, 0);

  return (
    <div className={styles.stock}>
      <div className={styles.toolbar}>
        <p className={styles.note}>
          Jyotirling and Bharat ke Dhaam orders since {since}
          {daysSinceStart > 0 ? ` · ${daysSinceStart} days` : ''}. Cancelled orders are left out.
        </p>
        <Button size="sm" icon="refresh-cw" onClick={refresh} disabled={isLoading}>
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert tone="negative" title={error} action={<Button size="sm" onClick={loadOrdersAndCalculate}>Try again</Button>}>
          The orders could not be loaded.
        </Alert>
      ) : (
        <>
          <StatStrip label="Sales since launch" minWidth={140}>
            <StatCard label="Variants" loading={isLoading} value={products.length.toLocaleString('en-IN')} />
            <StatCard label="Copies sold" loading={isLoading} value={totalSold.toLocaleString('en-IN')} />
            <StatCard label="Copies per day" loading={isLoading} value={totalPerDay.toFixed(2)} sub="all variants together" />
          </StatStrip>

          <Card
            title="AI stock prediction"
            description="How much stock to hold for the coming days, from the sales below."
            actions={
              <>
                {predictionResults.length > 0 ? (
                  <Button size="sm" variant="ghost" onClick={() => setPredictionResults([])}>
                    Clear
                  </Button>
                ) : null}
                <TextField
                  className={styles.days}
                  size="sm"
                  type="number"
                  min="1"
                  aria-label="Days to predict"
                  suffix="days"
                  value={predictionDays}
                  onChange={(e) => setPredictionDays(parseInt(e.target.value) || 0)}
                />
                <Button size="sm" variant="primary" icon="sparkles" loading={isPredicting} disabled={isLoading || products.length === 0} onClick={handleRunAiPrediction}>
                  {isPredicting ? 'Predicting…' : 'Predict with AI'}
                </Button>
              </>
            }
            padding={predictionResults.length > 0 ? 'none' : 'md'}
          >
            {predictionResults.length > 0 ? (
              <DataTable
                columns={PREDICTION_COLUMNS}
                rows={predictionResults}
                getRowId={rowId}
                caption={`Stock needed for ${predictionDays} days`}
              />
            ) : (
              <p className={styles.note}>Choose how many days to cover, then predict.</p>
            )}
          </Card>

          <Card title="Sales per variant" eyebrow={`Since ${since}`} padding="none">
            <DataTable
              columns={SALES_COLUMNS}
              rows={products}
              getRowId={rowId}
              loading={isLoading}
              caption="Copies sold per book variant"
              empty={<EmptyState size="sm" icon="package" title="No orders yet" description={`No book orders since ${since}.`} />}
            />
          </Card>
        </>
      )}
    </div>
  );
}
