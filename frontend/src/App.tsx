import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLogin } from './pages/AdminLogin';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { UploadPage } from './pages/UploadPage';
import { SalesManagementPage } from './pages/SalesManagementPage';
import { ToolsPage } from './pages/ToolsPage';
import { MagicLinksPage } from './pages/MagicLinksPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { AdminLayout } from './layouts/AdminLayout';
import { api } from './services/api';

// Protected Route component
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!api.isAuthenticated()) {
    return <Navigate to="/admin" replace />;
  }
  return <>{children}</>;
}

// Redirect to external site
function ExternalRedirect() {
  window.location.href = 'https://photobookx.com';
  return null;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Root redirects to photobookx.com */}
        <Route path="/" element={<ExternalRedirect />} />

        {/* Admin: login at /admin, all other /admin/* use shared layout with sidebar */}
        <Route path="/admin">
          <Route index element={<AdminLogin />} />
          <Route
            path="*"
            element={
              <ProtectedRoute>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="sales-management" element={<SalesManagementPage />} />
            <Route path="expenses/*" element={<ExpensesPage />} />
            <Route path="analysis/*" element={<AnalysisPage />} />
            <Route path="tools/*" element={<ToolsPage />} />
            <Route path="magic-links/*" element={<MagicLinksPage />} />

            {/* Redirects for moved pages */}
            <Route path="orders" element={<Navigate to="magic-links/orders" replace />} />
            <Route path="products" element={<Navigate to="tools/products" replace />} />
            <Route path="gst-reports/*" element={<Navigate to="tools/gst-reports" replace />} />
          </Route>
        </Route>

        {/* Upload page (public with magic link) */}
        <Route path="/upload/:token" element={<UploadPage />} />

        {/* Fallback - redirect to photobookx */}
        <Route path="*" element={<ExternalRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
