import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLogin } from './pages/AdminLogin';
import { AdminLayout } from './layouts/AdminLayout';
import { api } from './services/api';
import { Toaster } from './components/ui/pbx';

// Every page is its own chunk, downloaded the first time it is opened, so no page (least of all
// the public upload page) pays for the code and libraries of all the others.
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const ExpensesPage = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const UploadPage = lazy(() => import('./pages/UploadPage').then((m) => ({ default: m.UploadPage })));
const SalesManagementPage = lazy(() => import('./pages/SalesManagementPage').then((m) => ({ default: m.SalesManagementPage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((m) => ({ default: m.ToolsPage })));
const AnalysisPage = lazy(() => import('./pages/AnalysisPage').then((m) => ({ default: m.AnalysisPage })));
const AttendancePage = lazy(() => import('./pages/AttendancePage').then((m) => ({ default: m.AttendancePage })));
const BacklogPage = lazy(() => import('./pages/BacklogPage'));
const AbandonedCheckoutsPage = lazy(() => import('./pages/AbandonedCheckoutsPage'));

// The boundary sits inside each route, so the admin sidebar stays put while a page loads.
function Page({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center', color: 'var(--ink-subtle)', fontSize: '0.85rem' }}>Loading...</div>}>
      {children}
    </Suspense>
  );
}

// Protected Route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!api.isAuthenticated()) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

// The sign-in page sends anyone already signed in to the dashboard. If the stored token has
// expired, the shell's session check signs them out and brings them back here.
function SignInRoute() {
  return api.isAuthenticated() ? <Navigate to="/admin/dashboard" replace /> : <AdminLogin />;
}

// Redirect to external site
function ExternalRedirect() {
  window.location.href = 'https://photobookx.com';
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        {/* Root redirects to photobookx.com */}
        <Route path="/" element={<ExternalRedirect />} />

        {/* Admin: login at /admin, all other /admin/* use shared layout with sidebar */}
        <Route path="/admin">
          <Route index element={<SignInRoute />} />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<Page><DashboardPage /></Page>} />
            <Route path="sales-management" element={<Page><SalesManagementPage /></Page>} />
            <Route path="backlog" element={<Page><BacklogPage /></Page>} />
            <Route path="abandoned-checkouts" element={<Page><AbandonedCheckoutsPage /></Page>} />
            <Route path="expenses/*" element={<Page><ExpensesPage /></Page>} />
            <Route path="analysis/*" element={<Page><AnalysisPage /></Page>} />
            <Route path="attendance/*" element={<Page><AttendancePage /></Page>} />
            <Route path="tools/*" element={<Page><ToolsPage /></Page>} />

            {/* Redirects for moved pages */}
            <Route path="products" element={<Navigate to="/admin/tools/products" replace />} />
            <Route path="gst-reports/*" element={<Navigate to="/admin/tools/gst-reports" replace />} />
          </Route>
        </Route>

        {/* Upload page (public with magic link) */}
        <Route path="/upload/:token" element={<Page><UploadPage /></Page>} />

        {/* Fallback - redirect to photobookx */}
        <Route path="*" element={<ExternalRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
