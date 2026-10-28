import type { NavItem } from '../components/ui/pbx';

const sub = (base: string, pages: Array<[string, string]>): NavItem[] =>
  pages.map(([segment, label]) => ({ id: `${base}/${segment}`, label, href: `${base}/${segment}` }));

/**
 * The admin's pages in sidebar order. `id` is the path prefix that marks an item current and
 * `href` is where it goes; a section's sub-pages are its `children`.
 */
export const ADMIN_NAV: NavItem[] = [
  { id: '/admin/dashboard', label: 'Dashboard', icon: 'layout-dashboard', href: '/admin/dashboard' },
  { id: '/admin/backlog', label: 'Backlog', icon: 'kanban', href: '/admin/backlog' },
  { id: '/admin/abandoned-checkouts', label: 'Abandoned checkouts', icon: 'user-x', href: '/admin/abandoned-checkouts' },
  { id: '/admin/sales-management', label: 'Sales management', icon: 'shopping-bag', href: '/admin/sales-management' },
  {
    id: '/admin/attendance',
    label: 'Staff attendance',
    icon: 'users',
    href: '/admin/attendance/register',
    children: sub('/admin/attendance', [
      ['register', 'Attendance register'],
      ['hourly', 'Hourly workers'],
      ['salary', 'Salary and advances'],
      ['employees', 'Manage employees'],
    ]),
  },
  {
    id: '/admin/expenses',
    label: 'Expenses',
    icon: 'wallet',
    href: '/admin/expenses/meta-ads',
    children: sub('/admin/expenses', [
      ['meta-ads', 'Meta ads'],
      ['cogs', 'COGS'],
      ['fixed-monthly', 'Fixed monthly'],
      ['bank-account', 'Bank account'],
    ]),
  },
  {
    id: '/admin/analysis',
    label: 'Analysis',
    icon: 'chart-column',
    href: '/admin/analysis/claude',
    children: sub('/admin/analysis', [
      ['claude', 'Claude analysis'],
      ['failed-orders', 'Failed orders'],
      ['failure-reasons', 'Failure reasons'],
      ['pin-codes', 'Pin codes'],
      ['stuck-orders', 'Stuck orders'],
      ['tickets', 'Tickets'],
      ['reels', 'Reels'],
      ['agency', 'Agency'],
    ]),
  },
  {
    id: '/admin/tools',
    label: 'Tools',
    icon: 'wrench',
    href: '/admin/tools/profit-calculator',
    children: sub('/admin/tools', [
      ['profit-calculator', 'Profit calculator'],
      ['stock-prediction', 'Stock prediction'],
      ['products', 'Products'],
      ['gst-reports', 'GST reports'],
      ['variant-performance', 'Variant performance'],
      ['labels', 'Labels'],
    ]),
  },
];

/** The sidebar section a path belongs to, and its sub-page when there is one. */
export function findSection(path: string): { section?: NavItem; page?: NavItem } {
  const matches = (item: NavItem) => path === item.id || path.startsWith(item.id + '/');
  const section = ADMIN_NAV.find(matches);
  return { section, page: section?.children?.find(matches) };
}

/** Every item, sub-pages included, so a sidebar click can be turned back into a route. */
export const ALL_NAV_ITEMS: NavItem[] = ADMIN_NAV.flatMap((item) => [item, ...(item.children ?? [])]);
