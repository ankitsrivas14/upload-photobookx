import { Link, useNavigate, useLocation, Routes, Route } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import { GSTMonthlyReports } from './GSTMonthlyReports';
import styles from './GSTReportsPage.module.css';

export function GSTReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const currentPath = location.pathname;
  const isMonthly = currentPath === '/admin/gst-reports' || currentPath === '/admin/gst-reports/' || currentPath === '/admin/gst-reports/monthly';

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (currentPath === '/admin/gst-reports' || currentPath === '/admin/gst-reports/') {
      navigate('/admin/gst-reports/monthly', { replace: true });
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
      <div className={`${styles['gst-reports-page']} ${styles.loading}`}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <div className={styles['gst-reports-page']}>
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

          <Link to="/admin/sales-management" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18"/>
              <path d="M18 17V9"/>
              <path d="M13 17V5"/>
              <path d="M8 17v-3"/>
            </svg>
            {!sidebarCollapsed && <span>Sales Management</span>}
          </Link>

          <Link to="/admin/expenses" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23"/>
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            {!sidebarCollapsed && <span>Expenses</span>}
          </Link>

          <Link to="/admin/gst-reports" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            {!sidebarCollapsed && <span>GST Reports</span>}
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
            <span className={`${styles['breadcrumb-item']} ${styles.active}`}>
              GST Reports
            </span>
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
              to="/admin/gst-reports/monthly" 
              className={`${styles['expenses-nav-item']} ${isMonthly ? styles.active : ''}`}
            >
              Monthly Reports
            </Link>
          </div>

          <Routes>
            <Route path="/monthly" element={<GSTMonthlyReports />} />
            <Route path="/" element={<GSTMonthlyReports />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
