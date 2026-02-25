import { Link, useNavigate, useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import { ProfitPredictionCalculator } from './ProfitPredictionCalculator';
import { StockPrediction } from './StockPrediction';
import { ProductsManager } from './tools/ProductsManager';
import { GSTMonthlyReports } from './GSTMonthlyReports';
import styles from './ToolsPage.module.css';

export function ToolsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const currentPath = location.pathname;
  const isProfitCalculator = currentPath.includes('/admin/tools/profit-calculator');
  const isStockPrediction = currentPath.includes('/admin/tools/stock-prediction');
  const isProducts = currentPath.includes('/admin/tools/products');
  const isGSTReports = currentPath.includes('/admin/tools/gst-reports');

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  useEffect(() => {
    if (currentPath === '/admin/tools' || currentPath === '/admin/tools/') {
      navigate('/admin/tools/profit-calculator', { replace: true });
    }
  }, [currentPath, navigate]);

  const loadUser = async () => {
    try {
      const meRes = await api.getMe();
      if (!meRes.success) {
        api.logout();
        navigate('/admin');
        return;
      }
      setUser(meRes.user || null);
    } catch (err) {
      console.error('Failed to load user:', err);
      api.logout();
      navigate('/admin');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    api.logout();
    navigate('/admin');
  };

  if (isLoading) {
    return (
      <div className={`${styles['tools-page']} ${styles.loading}`}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <div className={styles['main-wrapper']}>
      <header className={styles['dashboard-header']}>
        <div className={styles['header-breadcrumb']}>
          <span className={`${styles['breadcrumb-item']} ${styles.active}`}>
            Tools
          </span>
        </div>
        <div className={styles['header-right']}>
          <div className={styles['user-menu']}>
            <div className={styles['user-avatar']}>{user?.name?.charAt(0) || 'A'}</div>
            <span className={styles['user-name']}>{user?.name}</span>
          </div>
          <button onClick={handleLogout} className={styles['logout-btn']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Logout
          </button>
        </div>
      </header>

      <main className={styles['dashboard-main']}>
        <div className={styles['tools-nav']}>
          <Link
            to="/admin/tools/profit-calculator"
            className={`${styles['tools-nav-item']} ${isProfitCalculator ? styles.active : ''}`}
          >
            Profit Calculator
          </Link>
          <Link
            to="/admin/tools/stock-prediction"
            className={`${styles['tools-nav-item']} ${isStockPrediction ? styles.active : ''}`}
          >
            Stock Prediction
          </Link>
          <Link
            to="/admin/tools/products"
            className={`${styles['tools-nav-item']} ${isProducts ? styles.active : ''}`}
          >
            Products
          </Link>
          <Link
            to="/admin/tools/gst-reports"
            className={`${styles['tools-nav-item']} ${isGSTReports ? styles.active : ''}`}
          >
            GST Reports
          </Link>
        </div>

        <Routes>
          <Route path="profit-calculator" element={<ProfitPredictionCalculator />} />
          <Route path="stock-prediction" element={<StockPrediction />} />
          <Route path="products" element={<ProductsManager />} />
          <Route path="gst-reports" element={<GSTMonthlyReports />} />
          <Route path="*" element={<Navigate to="profit-calculator" replace />} />
        </Routes>
      </main>
    </div>
  );
}
