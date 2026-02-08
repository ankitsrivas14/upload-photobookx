import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import type { AdminUser, ShopifyOrder } from '../services/api';
import styles from './DashboardPage.module.css';

const STORE_TIMEZONE = 'Asia/Kolkata';

function getOrderDateKey(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

interface COGSField {
  id: string;
  name: string;
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  percentageType?: 'included' | 'excluded';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [dailyPnlMap, setDailyPnlMap] = useState<Record<string, number>>({});
  const [tooltip, setTooltip] = useState<{ dateLabel: string; pnl: number | null; x: number; y: number } | null>(null);

  useEffect(() => {
    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

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

  const loadDailyPnl = useCallback(async () => {
    try {
      const [ordersRes, adSpendRes, cogsRes, rtoRes] = await Promise.all([
        api.getOrders(250, true),
        api.getDailyAdSpend(),
        api.getCOGSConfiguration(),
        api.getRTOOrderIds(),
      ]);

      const orders = ordersRes.success && ordersRes.orders ? ordersRes.orders : [];
      const adSpendEntries = adSpendRes.success && adSpendRes.entries ? adSpendRes.entries : [];
      const cogsFields = cogsRes?.fields ?? [];
      const rtoOrderIds = new Set(rtoRes.success ? rtoRes.rtoOrderIds : []);

      // Build ad cost per order by date - EXACT same logic as SalesPage
      const orderCountByDate: Record<string, number> = {};
      orders.forEach((o) => {
        if (o.cancelledAt) return;
        const d = getOrderDateKey(o.createdAt);
        orderCountByDate[d] = (orderCountByDate[d] || 0) + 1;
      });
      
      const adSpendByDate: Record<string, number> = {};
      adSpendEntries.forEach((e) => {
        // Use same timezone conversion as order dates (STORE_TIMEZONE)
        const d = new Date(e.date).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        adSpendByDate[d] = (adSpendByDate[d] || 0) + e.amount;
      });
      
      const adCostPerOrderByDate: Record<string, number> = {};
      Object.keys(adSpendByDate).forEach((d) => {
        const count = orderCountByDate[d] || 0;
        if (count > 0) adCostPerOrderByDate[d] = adSpendByDate[d] / count;
      });

      // EXACT same isOrderDelivered logic as SalesPage
      const isOrderDelivered = (order: ShopifyOrder) => {
        if (rtoOrderIds.has(order.id)) return false;
        const status = order.deliveryStatus?.toLowerCase() || '';
        const ndrStatuses = ['failed', 'attempted', 'rto', 'return'];
        if (ndrStatuses.some(s => status.includes(s))) return false;
        if (status === 'delivered') return true;
        if (order.paymentMethod?.toLowerCase() === 'prepaid') return true;
        return false;
      };

      // EXACT same isOrderFinalStatus logic as SalesPage  
      const isOrderFinalStatus = (order: ShopifyOrder) => {
        const status = order.deliveryStatus?.toLowerCase() || '';
        const isDelivered = status === 'delivered';
        const isFailed =
          rtoOrderIds.has(order.id) ||
          status === 'failure' ||
          status === 'attempted_delivery' ||
          status.includes('failed') ||
          status.includes('rto');
        return isDelivered || isFailed;
      };

      const detectVariant = (order: ShopifyOrder): 'small' | 'large' => {
        if (!order.lineItems?.length) return 'small';
        const hasLarge = order.lineItems.some(
          (item) =>
            item.title?.toLowerCase().includes('large') ||
            item.variantTitle?.toLowerCase().includes('large')
        );
        return hasLarge ? 'large' : 'small';
      };

      // EXACT same calcOrderPnl logic as SalesPage's calculateOrderProfitLoss
      const calcOrderPnl = (order: ShopifyOrder): number => {
        if (cogsFields.length === 0) return 0;
        const variant = detectVariant(order);
        const isDelivered = isOrderDelivered(order);
        const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
        
        let revenue = 0;
        let fieldsToUse: COGSField[] = [];
        
        if (isDelivered) {
          revenue = order.totalPrice || 0;
          fieldsToUse = (cogsFields as COGSField[]).filter(f => f.type === 'cogs' || f.type === 'both');
        } else {
          revenue = 0;
          fieldsToUse = (cogsFields as COGSField[]).filter(f => f.type === 'ndr' || f.type === 'both');
        }
        
        let totalCosts = 0;
        const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
        fieldsToUse.forEach((field) => {
          let value = field[key] as number;
          if (value === undefined || value === null) {
            value = variant === 'small' ? 0 : 0;
          }
          if (field.calculationType === 'fixed') {
            totalCosts += value;
          } else {
            const salePrice = order.totalPrice || 0;
            const pct = field.percentageType || 'excluded';
            totalCosts +=
              pct === 'included'
                ? (value / (100 + value)) * salePrice
                : (value / 100) * salePrice;
          }
        });
        const orderDateStr = getOrderDateKey(order.createdAt);
        const adCost = adCostPerOrderByDate[orderDateStr] ?? 0;
        return revenue - totalCosts - adCost;
      };

      const orderPnlByOrderId = new Map<number, number>();
      orders.forEach((o) => orderPnlByOrderId.set(o.id, calcOrderPnl(o)));

      const datesWithFinalOrders = new Set<string>();
      const dailyPnl: Record<string, number> = {};

      // Only count orders with final status (delivered or failed) - EXACT same as SalesPage
      orders.forEach((o) => {
        if (o.cancelledAt) return;
        const d = getOrderDateKey(o.createdAt);
        if (!isOrderFinalStatus(o)) return;
        datesWithFinalOrders.add(d);
        dailyPnl[d] = (dailyPnl[d] || 0) + (orderPnlByOrderId.get(o.id) ?? 0);
      });

      // Add ad-spend-only days (days without any final-status orders)
      Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
        if (!datesWithFinalOrders.has(dateKey)) {
          dailyPnl[dateKey] = (dailyPnl[dateKey] ?? 0) - amount;
        }
      });

      console.log('Daily P/L Map:', JSON.stringify(dailyPnl, null, 2));
      console.log('Dates with final orders:', Array.from(datesWithFinalOrders));
      console.log('Ad spend dates:', Object.keys(adSpendByDate));

      setDailyPnlMap(dailyPnl);
    } catch (err) {
      console.error('Failed to load daily P/L:', err);
      setDailyPnlMap({});
    }
  }, []);

  useEffect(() => {
    if (user) loadDailyPnl();
  }, [user, loadDailyPnl]);

  const weekLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Monday to Sunday
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const getPnlForDateKey = (dateKey: string): number | null => {
    const val = dailyPnlMap[dateKey];
    return val !== undefined ? val : null;
  };

  const getCellColor = (pnl: number | null): string => {
    if (pnl === null) return 'var(--tile-empty)';
    if (pnl > 0) return 'var(--tile-profit)';
    if (pnl < 0) return 'var(--tile-loss)';
    return 'var(--tile-zero)';
  };

  const getCellIntensity = (pnl: number | null): number => {
    if (pnl === null || pnl === 0) return 0;
    const abs = Math.abs(pnl);
    if (abs >= 5000) return 4;
    if (abs >= 2000) return 3;
    if (abs >= 500) return 2;
    if (abs >= 100) return 1;
    return 0;
  };

  const handleTileHover = (e: React.MouseEvent, dateKey: string | null, dateLabel: string, pnl: number | null) => {
    if (!dateKey) {
      setTooltip(null);
      return;
    }
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltip({
      dateLabel,
      pnl,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  if (isLoading) {
    return (
      <div className={styles['dashboard-page']}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <div className={`${styles['dashboard-page']} ${sidebarCollapsed ? styles['sidebar-collapsed'] : ''}`}>
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
          <Link to="/admin/dashboard" className={`${styles['nav-item']} ${styles.active}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="7" height="9"/>
              <rect x="14" y="3" width="7" height="5"/>
              <rect x="14" y="12" width="7" height="9"/>
              <rect x="3" y="16" width="7" height="5"/>
            </svg>
            {!sidebarCollapsed && <span>Dashboard</span>}
          </Link>

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

          <Link to="/admin/sales-management" className={styles['nav-item']}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18"/>
              <path d="M18 17V9"/>
              <path d="M13 17V5"/>
              <path d="M8 17v-3"/>
            </svg>
            {!sidebarCollapsed && <span>Sales Management</span>}
          </Link>

          <Link to="/admin/expenses/overview" className={styles['nav-item']}>
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
        <header className={styles.header}>
          <h1 className={styles.title}>Dashboard</h1>
          <div className={styles['year-select']}>
            <label htmlFor="year">Year:</label>
            <select
              id="year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className={styles.select}
            >
              {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className={styles.section}>
          <h2 className={styles['section-title']}>Daily Profit & Loss — {selectedYear}</h2>

          <div className={styles.legend}>
            <span className={styles['legend-label']}>Less</span>
            <span className={styles['legend-tile']} style={{ background: 'var(--tile-empty)' }} />
            <span className={styles['legend-tile']} style={{ background: 'var(--tile-zero)' }} />
            <span className={styles['legend-tile']} style={{ background: 'var(--tile-profit)' }} />
            <span className={styles['legend-tile']} style={{ background: 'var(--tile-loss)' }} />
            <span className={styles['legend-label']}>More</span>
          </div>

          <div className={styles.calendarContainer}>
            <div className={styles.weekdayLabels}>
              {weekLabels.map((label) => (
                <span key={label} className={styles.weekdayLabel}>{label}</span>
              ))}
            </div>

            <div className={styles.monthsGrid}>
              {monthNames.map((monthName, monthIndex) => {
                // getDay() returns 0-6 (Sun-Sat), convert to Monday=0, Sunday=6
                const firstDayOfMonth = (new Date(selectedYear, monthIndex, 1).getDay() + 6) % 7;
                const daysInMonth = new Date(selectedYear, monthIndex + 1, 0).getDate();
                const numWeeks = Math.ceil((daysInMonth + firstDayOfMonth) / 7);
                
                // Generate tiles column-by-column (week by week), only for valid days
                const tiles = [];
                for (let col = 0; col < numWeeks; col++) {
                  for (let row = 0; row < 7; row++) {
                    const dayOfMonth = col * 7 + row - firstDayOfMonth + 1;
                    
                    // Skip invalid days
                    if (dayOfMonth < 1 || dayOfMonth > daysInMonth) {
                      continue;
                    }
                    
                    const dateKey = `${selectedYear}-${String(monthIndex + 1).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
                    const pnl = getPnlForDateKey(dateKey);
                    const color = getCellColor(pnl);
                    const intensity = getCellIntensity(pnl);
                    const dateLabel = new Date(selectedYear, monthIndex, dayOfMonth).toLocaleDateString('en-IN', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    });

                    tiles.push(
                      <div
                        key={dateKey}
                        className={styles.tile}
                        style={{
                          background: color,
                          opacity: pnl !== null && pnl !== 0 ? 0.55 + intensity * 0.12 : 0.4,
                          gridColumn: col + 1,
                          gridRow: row + 1,
                        }}
                        onMouseEnter={(e) =>
                          handleTileHover(e, dateKey, dateLabel, pnl)
                        }
                        onMouseLeave={() => setTooltip(null)}
                      />
                    );
                  }
                }

                return (
                  <div key={monthIndex} className={styles.monthBlock}>
                    <div
                      className={styles.monthGrid}
                      style={{
                        gridTemplateColumns: `repeat(${numWeeks}, 12px)`,
                        gridTemplateRows: 'repeat(7, 12px)',
                      }}
                    >
                      {tiles}
                    </div>
                    <div className={styles.monthLabel}>{monthName.toUpperCase()}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {tooltip && (
            <div
              className={styles.tooltip}
              style={{
                left: tooltip.x,
                top: tooltip.y,
                transform: 'translate(-50%, -100%) translateY(-8px)',
              }}
            >
              <div className={styles.tooltipDate}>{tooltip.dateLabel}</div>
              <div className={styles.tooltipPnl}>
                {tooltip.pnl !== null ? (
                  <span className={tooltip.pnl >= 0 ? styles.tooltipProfit : styles.tooltipLoss}>
                    {tooltip.pnl >= 0 ? '+' : ''}₹{tooltip.pnl.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                ) : (
                  <span className={styles.tooltipNone}>No data</span>
                )}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
