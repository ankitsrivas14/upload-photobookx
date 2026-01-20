import { Link, useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import { MetaAdsPage } from './MetaAdsPage';
import { ExpensesOverview } from './ExpensesOverview';
import { SalesPage } from './SalesPage';
import { COGSPage } from './COGSPage';
import styles from './ExpensesPage.module.css';

export function ExpensesPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const currentPath = location.pathname;
  const isOverview = currentPath === '/admin/expenses' || currentPath === '/admin/expenses/' || currentPath === '/admin/expenses/overview';
  const isMetaAds = currentPath === '/admin/expenses/meta-ads';
  const isSales = currentPath === '/admin/expenses/sales';
  const isCOGS = currentPath === '/admin/expenses/cogs';

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (isOverview) {
      navigate('/admin/expenses/overview', { replace: true });
    }
  }, [isOverview, navigate]);

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
      <div className={`${styles['expenses-page']} ${styles.loading}`}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <div className={styles['expenses-page']}>
      {/* Sidebar */}
      <aside className={`${styles.sidebar} ${sidebarCollapsed ? styles.collapsed : ''}`}>
        <div className={styles['sidebar-header']}>
          <img 
            src="https://photobookx.com/cdn/shop/files/Screenshot_2025-05-18_at_9.30.14_PM-removebg-preview.png?v=1747584052" 
            alt="PhotoBookX" 
            className={styles['sidebar-logo']}
          />
          {!sidebarCollapsed && <span className={styles['sidebar-title']}>Admin</span>}
        </div>

        <nav className={styles['sidebar-nav']}>
          <Link to="/admin/orders" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 7h-9"/>
              <path d="M14 17H5"/>
              <circle cx="17" cy="17" r="3"/>
              <circle cx="7" cy="7" r="3"/>
            </svg>
            {!sidebarCollapsed && <span>Orders & Links</span>}
          </Link>

          <Link to="/admin/magic-links" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            {!sidebarCollapsed && <span>Magic Links</span>}
          </Link>

          <Link to="/admin/products" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            {!sidebarCollapsed && <span>Products</span>}
          </Link>

          <Link to="/admin/expenses/overview" className={`${styles['nav-item']} ${isMetaAds || isOverview ? styles.active : ''}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            {!sidebarCollapsed && <span>Expenses</span>}
          </Link>

          <Link to="/admin/settings" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6m8.66-15l-5.2 3m-2.92 5.2l-5.2 3M23 12h-6m-6 0H1m20.66 7l-5.2-3m-2.92-5.2l-5.2-3"/>
            </svg>
            {!sidebarCollapsed && <span>Settings</span>}
          </Link>
        </nav>

        <button 
          className={styles['sidebar-toggle']}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points={sidebarCollapsed ? "9 18 15 12 9 6" : "15 18 9 12 15 6"}/>
          </svg>
        </button>
      </aside>

      {/* Main Content */}
      <div className={styles['main-wrapper']}>
        <header className={styles['dashboard-header']}>
          <div className={styles['header-breadcrumb']}>
            <Link to="/admin/expenses/overview" className={styles['breadcrumb-item']}>Expenses</Link>
            {isMetaAds && (
              <>
                <span className={styles['breadcrumb-separator']}>/</span>
                <span className={`${styles['breadcrumb-item']} ${styles.active}`}>Meta Ads</span>
              </>
            )}
          </div>
          <div className={styles['header-right']}>
            <div className={styles['user-menu']}>
              <div className={styles['user-avatar']}>{user?.name?.charAt(0) || 'A'}</div>
              <span className={styles['user-name']}>{user?.name}</span>
            </div>
            <button onClick={handleLogout} className={styles['logout-btn']}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              Logout
            </button>
          </div>
        </header>

        <main className={styles['dashboard-main']}>
          <div className={styles['expenses-nav']}>
            <Link 
              to="/admin/expenses/overview"
              className={`${styles['expenses-nav-item']} ${isOverview ? styles.active : ''}`}
            >
              Overview
            </Link>
            <Link 
              to="/admin/expenses/meta-ads"
              className={`${styles['expenses-nav-item']} ${isMetaAds ? styles.active : ''}`}
            >
              Meta Ads
            </Link>
            <Link 
              to="/admin/expenses/sales"
              className={`${styles['expenses-nav-item']} ${isSales ? styles.active : ''}`}
            >
              Sales
            </Link>
            <Link 
              to="/admin/expenses/cogs"
              className={`${styles['expenses-nav-item']} ${isCOGS ? styles.active : ''}`}
            >
              COGS
            </Link>
          </div>

          <Routes>
            <Route path="overview" element={<ExpensesOverview />} />
            <Route path="meta-ads" element={<MetaAdsPage />} />
            <Route path="sales" element={<SalesPage />} />
            <Route path="cogs" element={<COGSPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
