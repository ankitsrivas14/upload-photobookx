import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { PageHeader, Skeleton } from '../components/ui/pbx';
import { findSection } from '../layouts/adminNav';
import styles from './ExpensesPage.module.css';

// Each section loads the first time it is opened (Bank Account alone pulls in xlsx).
const MetaAdsPage = lazy(() => import('./MetaAdsPage').then((m) => ({ default: m.MetaAdsPage })));
const COGSPage = lazy(() => import('./COGSPage').then((m) => ({ default: m.COGSPage })));
const FixedMonthlyPage = lazy(() => import('./FixedMonthlyPage').then((m) => ({ default: m.FixedMonthlyPage })));
const BankAccountPage = lazy(() => import('./BankAccountPage').then((m) => ({ default: m.BankAccountPage })));

// The admin shell loads the signed-in user, draws the topbar and lists the sections in the sidebar.
export function ExpensesPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname;
  const isOverview = currentPath === '/admin/expenses' || currentPath === '/admin/expenses/';
  const { page } = findSection(currentPath);

  useEffect(() => {
    if (isOverview) {
      navigate('/admin/expenses/meta-ads', { replace: true });
    }
  }, [isOverview, navigate]);

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Expenses" title={page?.label ?? 'Expenses'} />

      <Suspense fallback={<Skeleton lines={6} />}>
        <Routes>
          <Route path="meta-ads" element={<MetaAdsPage />} />
          <Route path="cogs" element={<COGSPage />} />
          <Route path="fixed-monthly" element={<FixedMonthlyPage />} />
          <Route path="bank-account" element={<BankAccountPage />} />
        </Routes>
      </Suspense>
    </div>
  );
}
