import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { UploadPage } from './pages/UploadPage';
import { SalesManagementPage } from './pages/SalesManagementPage';
import { GSTReportsPage } from './pages/GSTReportsPage';
import { ProfitPredictionCalculator } from './pages/ProfitPredictionCalculator';
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
            <Route path="gst-reports/*" element={<GSTReportsPage />} />
            <Route path="calculator/profit-prediction" element={<ProfitPredictionCalculator />} />
            <Route path=":view" element={<AdminDashboard />} />
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
