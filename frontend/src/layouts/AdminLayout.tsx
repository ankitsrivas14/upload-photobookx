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
    if (href === '/admin/expenses/meta-ads' || href === '/admin/expenses') return path.startsWith('/admin/expenses');
    if (href === '/admin/magic-links') return path.startsWith('/admin/magic-links');
    if (href === '/admin/analysis') return path.startsWith('/admin/analysis');
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
            to="/admin/magic-links"
            className={`${styles['nav-item']} ${isActive('/admin/magic-links') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            {!sidebarCollapsed && <span>Magic Links</span>}
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
            to="/admin/expenses/meta-ads"
            className={`${styles['nav-item']} ${isActive('/admin/expenses/meta-ads') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            {!sidebarCollapsed && <span>Expenses</span>}
          </Link>

          <Link
            to="/admin/analysis"
            className={`${styles['nav-item']} ${isActive('/admin/analysis') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            {!sidebarCollapsed && <span>Analysis</span>}
          </Link>

          <Link
            to="/admin/tools"
            className={`${styles['nav-item']} ${isActive('/admin/tools') ? styles.active : ''}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
            {!sidebarCollapsed && <span>Tools</span>}
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
