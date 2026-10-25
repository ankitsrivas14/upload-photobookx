import { useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { PageHeader, Skeleton, Tabs } from '../components/ui/pbx';
import styles from './ExpensesPage.module.css';

// Each section loads the first time it is opened (Bank Account alone pulls in xlsx).
const MetaAdsPage = lazy(() => import('./MetaAdsPage').then((m) => ({ default: m.MetaAdsPage })));
const COGSPage = lazy(() => import('./COGSPage').then((m) => ({ default: m.COGSPage })));
const FixedMonthlyPage = lazy(() => import('./FixedMonthlyPage').then((m) => ({ default: m.FixedMonthlyPage })));
const BankAccountPage = lazy(() => import('./BankAccountPage').then((m) => ({ default: m.BankAccountPage })));

const SECTIONS = [
  { id: 'meta-ads', label: 'Meta ads', href: '/admin/expenses/meta-ads' },
  { id: 'cogs', label: 'COGS', href: '/admin/expenses/cogs' },
  { id: 'fixed-monthly', label: 'Fixed monthly', href: '/admin/expenses/fixed-monthly' },
  { id: 'bank-account', label: 'Bank account', href: '/admin/expenses/bank-account' },
];

// The admin shell loads the signed-in user and draws the topbar; this page is the sections.
export function ExpensesPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const currentPath = location.pathname;
  const isOverview = currentPath === '/admin/expenses' || currentPath === '/admin/expenses/';
  const active = SECTIONS.find((s) => currentPath.startsWith(s.href))?.id ?? 'meta-ads';

  useEffect(() => {
    if (isOverview) {
      navigate('/admin/expenses/meta-ads', { replace: true });
    }
  }, [isOverview, navigate]);

  return (
    <div className={styles.page}>
      <PageHeader title="Expenses" description="Ad spend, cost of goods, fixed monthly costs and the bank account.">
        <Tabs
          label="Expenses sections"
          items={SECTIONS}
          value={active}
          onChange={(id) => navigate(SECTIONS.find((s) => s.id === id)!.href)}
        />
      </PageHeader>

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
