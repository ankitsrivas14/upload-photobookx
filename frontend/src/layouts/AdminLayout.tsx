import { Link, Outlet, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import styles from './AdminLayout.module.css';

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

function getInitialCollapsed(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored === 'true';
  } catch {
    return false;
  }
}

export function AdminLayout() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  const path = location.pathname;

  const isActive = (href: string) => {
    if (href === '/admin/dashboard') return path === '/admin/dashboard';
    if (href === '/admin/sales-management') return path === '/admin/sales-management';
    if (href === '/admin/expenses/overview' || href === '/admin/expenses') return path.startsWith('/admin/expenses');
    if (href === '/admin/gst-reports') return path.startsWith('/admin/gst-reports');
    if (href === '/admin/tools') return path.startsWith('/admin/tools');
    if (href.startsWith('/admin/')) return path === href || (href !== '/admin' && path.startsWith(href + '/'));
    return path === href;
  };

  return (
    <div className={`${styles.layout} ${sidebarCollapsed ? styles['sidebar-collapsed'] : ''}`}>
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
          <Link
            to="/admin/dashboard"
            className={`${styles['nav-item']} ${isActive('/admin/dashboard') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="9" />
              <rect x="14" y="3" width="7" height="5" />
              <rect x="14" y="12" width="7" height="9" />
              <rect x="3" y="16" width="7" height="5" />
            </svg>
            {!sidebarCollapsed && <span>Dashboard</span>}
          </Link>

          <Link
            to="/admin/orders"
            className={`${styles['nav-item']} ${path === '/admin/orders' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 7h-9" />
              <path d="M14 17H5" />
              <circle cx="17" cy="17" r="3" />
              <circle cx="7" cy="7" r="3" />
            </svg>
            {!sidebarCollapsed && <span>Orders & Links</span>}
          </Link>

          <Link
            to="/admin/magic-links"
            className={`${styles['nav-item']} ${path === '/admin/magic-links' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {!sidebarCollapsed && <span>Magic Links</span>}
          </Link>

          <Link
            to="/admin/products"
            className={`${styles['nav-item']} ${path === '/admin/products' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
            {!sidebarCollapsed && <span>Products</span>}
          </Link>

          <Link
            to="/admin/sales-management"
            className={`${styles['nav-item']} ${isActive('/admin/sales-management') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="M18 17V9" />
              <path d="M13 17V5" />
              <path d="M8 17v-3" />
            </svg>
            {!sidebarCollapsed && <span>Sales Management</span>}
          </Link>

          <Link
            to="/admin/expenses/overview"
            className={`${styles['nav-item']} ${path.startsWith('/admin/expenses') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            {!sidebarCollapsed && <span>Expenses</span>}
          </Link>

          <Link
            to="/admin/gst-reports"
            className={`${styles['nav-item']} ${path.startsWith('/admin/gst-reports') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            {!sidebarCollapsed && <span>GST Reports</span>}
          </Link>

          <Link
            to="/admin/tools"
            className={`${styles['nav-item']} ${path.startsWith('/admin/tools') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            {!sidebarCollapsed && <span>Tools</span>}
          </Link>

          <Link
            to="/admin/settings"
            className={`${styles['nav-item']} ${path === '/admin/settings' ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v6m0 6v6m8.66-15l-5.2 3m-2.92 5.2l-5.2 3M23 12h-6m-6 0H1m20.66 7l-5.2-3m-2.92-5.2l-5.2-3" />
            </svg>
            {!sidebarCollapsed && <span>Settings</span>}
          </Link>
        </nav>

        <button
          type="button"
          className={styles['sidebar-toggle']}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points={sidebarCollapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6'} />
          </svg>
        </button>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
