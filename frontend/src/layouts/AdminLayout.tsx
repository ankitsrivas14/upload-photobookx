import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Sidebar, Topbar, ThemeSwitch, type Crumb, type NavGroup } from '../components/ui/pbx';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import styles from './AdminLayout.module.css';

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

// Today's pages, in today's order. `id` is the path prefix that marks the item current; `href` is where it goes.
const NAV_ITEMS = [
  { id: '/admin/dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: '/admin/dashboard' },
  { id: '/admin/backlog', label: 'Backlog', icon: 'kanban', href: '/admin/backlog' },
  { id: '/admin/abandoned-checkouts', label: 'Abandoned checkouts', icon: 'user-x', href: '/admin/abandoned-checkouts' },
  { id: '/admin/sales-management', label: 'Sales management', icon: 'shopping-bag', href: '/admin/sales-management' },
  { id: '/admin/attendance', label: 'Staff attendance', icon: 'users', href: '/admin/attendance' },
  { id: '/admin/expenses', label: 'Expenses', icon: 'wallet', href: '/admin/expenses/meta-ads' },
  { id: '/admin/analysis', label: 'Analysis', icon: 'chart-column', href: '/admin/analysis/claude' },
  { id: '/admin/tools', label: 'Tools', icon: 'wrench', href: '/admin/tools' },
] as const;

const NAV: NavGroup[] = [{ items: NAV_ITEMS.map((item) => ({ ...item })) }];

// Sub-page names that are not just the URL segment in sentence case.
const SUB_LABELS: Record<string, string> = {
  cogs: 'COGS',
  'gst-reports': 'GST reports',
  'meta-ads': 'Meta ads',
  claude: 'Claude analysis',
  ads: 'Ads analysis',
  'pin-codes': 'Pin codes',
  'profit-calculator': 'Profit calculator',
};

function subLabel(segment: string): string {
  if (SUB_LABELS[segment]) return SUB_LABELS[segment];
  const words = segment.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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

  const path = location.pathname;
  const active = NAV_ITEMS.find((item) => path === item.id || path.startsWith(item.id + '/'));
  const crumbs: Crumb[] = [];
  if (active) {
    const rest = path.slice(active.id.length).split('/').filter(Boolean);
    crumbs.push(rest.length ? { label: active.label, href: active.href } : { label: active.label });
    if (rest.length) crumbs.push({ label: subLabel(rest[0]) });
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
        activeId={active?.id}
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        onNavigate={(id) => {
          const item = NAV_ITEMS.find((i) => i.id === id);
          if (item) navigate(item.href);
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
