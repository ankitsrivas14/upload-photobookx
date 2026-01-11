import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AdminLogin } from './pages/AdminLogin';
import { AdminDashboard } from './pages/AdminDashboard';
import { UploadPage } from './pages/UploadPage';
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
        
        {/* Admin routes */}
        <Route path="/admin" element={<AdminLogin />} />
        <Route 
          path="/admin/dashboard" 
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />
        
        {/* Upload page (public with magic link) */}
        <Route path="/upload/:token" element={<UploadPage />} />
        
        {/* Fallback - redirect to photobookx */}
        <Route path="*" element={<ExternalRedirect />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
