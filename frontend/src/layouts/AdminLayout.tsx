import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Sidebar, Topbar, ThemeSwitch, type Crumb, type NavGroup } from '../components/ui/pbx';
import { ADMIN_NAV, ALL_NAV_ITEMS, findSection } from './adminNav';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import styles from './AdminLayout.module.css';

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

const NAV: NavGroup[] = [{ items: ADMIN_NAV }];

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<AdminUser | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // ignore
    }
  }, [collapsed]);

  // The signed-in user is loaded once here, for every admin page.
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          api.logout();
          navigate('/admin');
          return;
        }
        setUser(res.user || null);
      })
      .catch(() => {
        if (cancelled) return;
        api.logout();
        navigate('/admin');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Close the narrow-screen menu after navigating.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const { section, page } = findSection(location.pathname);
  const crumbs: Crumb[] = [];
  if (section) {
    crumbs.push(page ? { label: section.label, href: section.href } : { label: section.label });
    if (page) crumbs.push({ label: page.label });
  }

  const handleLogout = () => {
    api.logout();
    navigate('/admin');
  };

  return (
    <div className={styles.shell}>
      <Sidebar
        className={`${styles.sidebar} ${mobileOpen ? styles.open : ''}`}
        groups={NAV}
        activeId={page?.id ?? section?.id}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onNavigate={(id) => {
          const item = ALL_NAV_ITEMS.find((i) => i.id === id);
          if (item?.href) navigate(item.href);
        }}
      />
      <div className={`${styles.scrim} ${mobileOpen ? styles.open : ''}`} onClick={() => setMobileOpen(false)} aria-hidden="true" />
      <div className={styles.main}>
        <Topbar
          className={styles.topbar}
          breadcrumbs={crumbs}
          user={user ? { name: user.name, email: user.email } : undefined}
          onLogout={handleLogout}
          onMenu={() => setMobileOpen(true)}
          actions={<ThemeSwitch size="sm" />}
        />
        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
