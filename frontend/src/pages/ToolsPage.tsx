import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { PageHeader, Skeleton } from '../components/ui/pbx';
import { findSection } from '../layouts/adminNav';
import styles from './ToolsPage.module.css';

// Each tool loads the first time it is opened (Labels alone pulls in pdf-lib and pdfjs).
const ProfitPredictionCalculator = lazy(() => import('./ProfitPredictionCalculator').then((m) => ({ default: m.ProfitPredictionCalculator })));
const StockPrediction = lazy(() => import('./StockPrediction').then((m) => ({ default: m.StockPrediction })));
const ProductsManager = lazy(() => import('./tools/ProductsManager').then((m) => ({ default: m.ProductsManager })));
const VariantPerformance = lazy(() => import('./tools/VariantPerformance').then((m) => ({ default: m.VariantPerformance })));
const Labels = lazy(() => import('./tools/Labels').then((m) => ({ default: m.Labels })));
const CodBlacklist = lazy(() => import('./tools/CodBlacklist').then((m) => ({ default: m.CodBlacklist })));
const GSTMonthlyReports = lazy(() => import('./GSTMonthlyReports').then((m) => ({ default: m.GSTMonthlyReports })));

/** Tools: one page per tool; the shell lists them in the sidebar and handles the account and sign-out. */
export function ToolsPage() {
  const { pathname } = useLocation();
  const { page } = findSection(pathname);

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Tools" title={page?.label ?? 'Tools'} />

      <Suspense fallback={<Skeleton lines={4} />}>
        <Routes>
          <Route index element={<Navigate to="profit-calculator" replace />} />
          <Route path="profit-calculator" element={<ProfitPredictionCalculator />} />
          <Route path="stock-prediction" element={<StockPrediction />} />
          <Route path="products" element={<ProductsManager />} />
          <Route path="gst-reports" element={<GSTMonthlyReports />} />
          <Route path="variant-performance" element={<VariantPerformance />} />
          <Route path="labels" element={<Labels />} />
          <Route path="cod-blacklist" element={<CodBlacklist />} />
          <Route path="*" element={<Navigate to="profit-calculator" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
