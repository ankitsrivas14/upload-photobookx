import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { PageHeader, Skeleton, Tabs, type TabItem } from '../components/ui/pbx';
import styles from './ToolsPage.module.css';

// Each tool loads the first time it is opened (Labels alone pulls in pdf-lib and pdfjs).
const ProfitPredictionCalculator = lazy(() => import('./ProfitPredictionCalculator').then((m) => ({ default: m.ProfitPredictionCalculator })));
const StockPrediction = lazy(() => import('./StockPrediction').then((m) => ({ default: m.StockPrediction })));
const ProductsManager = lazy(() => import('./tools/ProductsManager').then((m) => ({ default: m.ProductsManager })));
const VariantPerformance = lazy(() => import('./tools/VariantPerformance').then((m) => ({ default: m.VariantPerformance })));
const Labels = lazy(() => import('./tools/Labels').then((m) => ({ default: m.Labels })));
const GSTMonthlyReports = lazy(() => import('./GSTMonthlyReports').then((m) => ({ default: m.GSTMonthlyReports })));

const TOOLS: TabItem[] = [
  { id: 'profit-calculator', label: 'Profit calculator', icon: 'calculator', href: '/admin/tools/profit-calculator' },
  { id: 'stock-prediction', label: 'Stock prediction', icon: 'boxes', href: '/admin/tools/stock-prediction' },
  { id: 'products', label: 'Products', icon: 'package', href: '/admin/tools/products' },
  { id: 'gst-reports', label: 'GST reports', icon: 'receipt', href: '/admin/tools/gst-reports' },
  { id: 'variant-performance', label: 'Variant performance', icon: 'layers', href: '/admin/tools/variant-performance' },
  { id: 'labels', label: 'Labels', icon: 'printer', href: '/admin/tools/labels' },
];

/** Tools: one tab per tool under the shell's topbar, which already handles the account and sign-out. */
export function ToolsPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = pathname.split('/')[3] || TOOLS[0].id;

  return (
    <div className={styles.page}>
      <PageHeader title="Tools" description="Calculators, reports and printing for the store.">
        <Tabs label="Tools" items={TOOLS} value={current} onChange={(id) => navigate(`/admin/tools/${id}`)} />
      </PageHeader>

      <Suspense fallback={<Skeleton lines={4} />}>
        <Routes>
          <Route index element={<Navigate to="profit-calculator" replace />} />
          <Route path="profit-calculator" element={<ProfitPredictionCalculator />} />
          <Route path="stock-prediction" element={<StockPrediction />} />
          <Route path="products" element={<ProductsManager />} />
          <Route path="gst-reports" element={<GSTMonthlyReports />} />
          <Route path="variant-performance" element={<VariantPerformance />} />
          <Route path="labels" element={<Labels />} />
          <Route path="*" element={<Navigate to="profit-calculator" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
