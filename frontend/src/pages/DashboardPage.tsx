import { useNavigate } from 'react-router-dom';
import { lazy, Suspense, useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import toast from 'react-hot-toast';
import { api } from '../services/api';
import type { AdminUser } from '../services/api';
import type { SalesPageProps } from './SalesPage';
import {
  Amount,
  Button,
  Card,
  DataList,
  DateField,
  DeliveryBadge,
  Dialog,
  Drawer,
  EmptyState,
  Heatmap,
  Menu,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  StatStrip,
  TextField,
  Tooltip,
} from '../components/ui/pbx';
import { formatINR } from '../components/ui/format';
import type { HeatmapDay } from '../components/ui/pbx';
import { MetaAccountSection } from './dashboard/MetaAccountSection';
import { LineSwatch } from './dashboard/LineSwatch';
import { AXIS_TICK, CURSOR_FILL, REF_LABEL, TOOLTIP_ITEM, TOOLTIP_LABEL, TOOLTIP_STYLE } from './dashboard/chartStyles';
import { ShippingChart } from './dashboard/ShippingChart';
import styles from './DashboardPage.module.css';

// The orders modal is heavy (the whole Sales page); load it only when the modal first opens.
const SalesPage = lazy(() => import('./SalesPage').then((m) => ({ default: m.SalesPage })));

const STORE_TIMEZONE = 'Asia/Kolkata';

/** ROAS chart range: the picked dates, else the last `days` days (IST). */
function roasRange(days: number, startDate: string, endDate: string): { start: string; end: string } {
  if (startDate && endDate) return { start: startDate, end: endDate };
  const now = new Date();
  const end = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const s = new Date(now);
  s.setDate(s.getDate() - (days - 1));
  return { start: s.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE }), end };
}

/** Order-distribution range: the last 30 days (IST), not before Jan 28, 2026. */
function orderStatsRange(): { start: string; end: string } {
  const now = new Date();
  const end = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const s = new Date(now);
  s.setDate(s.getDate() - 29);
  const thirtyDaysAgo = s.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  return { start: thirtyDaysAgo < '2026-01-28' ? '2026-01-28' : thirtyDaysAgo, end };
}

/** Delivery-status fills for the order-distribution bars: green delivered, orange failed, greys in between. */
const SHARE_COLORS: Record<string, string> = {
  Delivered: 'var(--positive-solid)',
  'Out for Delivery': 'var(--ink-subtle)',
  'Attempted Delivery': 'var(--chart-amber)',
  'In Transit': 'var(--chart-bar)',
  Confirmed: 'var(--tile-pending)',
  Failed: 'var(--negative-solid)',
};


export function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  // ROAS filter — the days field stays uncontrolled (no re-render on typing); From and To are picks waiting for Apply
  const roasDaysRef = useRef<HTMLInputElement>(null);
  const [roasFrom, setRoasFrom] = useState('');
  const [roasTo, setRoasTo] = useState('');
  // ROAS filter — applied state (what the chart uses, updated on Go)
  const [roasDays, setRoasDays] = useState(30);
  const [roasStartDate, setRoasStartDate] = useState('');
  const [roasEndDate, setRoasEndDate] = useState('');
  // ROAS data fetched from DB
  const [roasDbRecords, setRoasDbRecords] = useState<Array<{ dateKey: string; revenue: number; adSpend: number; roas: number | null }>>([]);
  const [roasLoading, setRoasLoading] = useState(false);

  // Right drawer listing the pending orders that keep a P&L day grey (incomplete)
  const [pnlDrawer, setPnlDrawer] = useState<{
    open: boolean;
    date: string;
    loading: boolean;
    orders: Array<{ orderNumber: string; amount: number; deliveryStatus: string; trackingUrl: string | null }>;
  }>({ open: false, date: '', loading: false, orders: [] });
  // Which drawer order is being marked delivered/failed
  const [markingOrder, setMarkingOrder] = useState<string | null>(null);
  // Orders per month (prepaid + COD), oldest first — for the bar chart
  const [monthlyOrderCounts, setMonthlyOrderCounts] = useState<Array<{ month: string; orders: number }>>([]);
  // Avg orders accumulated by today's day-of-month across past months (pace benchmark)
  const [orderPace, setOrderPace] = useState<{ average: number; day: number }>({ average: 0, day: 0 });
  // Gross revenue per month, oldest first — for the bar chart
  const [monthlyRevenue, setMonthlyRevenue] = useState<Array<{ month: string; revenue: number }>>([]);
  // Avg revenue accumulated by today's day-of-month across past months (pace benchmark)
  const [revenuePace, setRevenuePace] = useState<{ average: number; day: number }>({ average: 0, day: 0 });
  // Heatmap P&L from DB — keyed by dateKey
  const [heatmapByDate, setHeatmapByDate] = useState<Record<string, number>>({});
  // Full yearly daily records — used for monthly profit aggregation
  const [yearlyPnlRecords, setYearlyPnlRecords] = useState<Array<{
    dateKey: string; isCompleted: boolean; barChartProfit: number;
  }>>([]);
  // Monthly bar chart records from DB
  const [pnlChartRecords, setPnlChartRecords] = useState<Array<{
    dateKey: string; isCompleted: boolean; barChartProfit: number;
  }>>([]);
  // Breakeven metrics from DB
  const [breakevenDbMetrics, setBreakevenDbMetrics] = useState<{
    aov: number; avgCOGS: number; avgShipping: number; avgTotalCost: number;
    contributionMargin: number; breakevenROAS: number;
    breakevenMetaROAS: number; deliveredCount: number; failedCount: number; totalOrders: number; since: string | null;
  } | null>(null);

  // Sales Modal State
  const [salesModalOpen, setSalesModalOpen] = useState(false);
  const [salesModalFilter, setSalesModalFilter] = useState<SalesPageProps['initialFilter']>();

  // Shipping chart controls
  const [shippingGranularity, setShippingGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [activeShippingLines, setActiveShippingLines] = useState({
    all: true,
    small: false,
    large: false,
  });
  const [shippingDbRecords, setShippingDbRecords] = useState<Array<{
    dateKey: string;
    avgShipping: number | null;
    avgShippingSmall: number | null;
    avgShippingLarge: number | null;
  }>>([]);

  // Order Distribution DB state
  const [orderStatsDb, setOrderStatsDb] = useState<{
    prepaidCount: number; codCount: number;
    deliveredCount: number; failedCount: number; inTransitCount: number;
    outForDeliveryCount: number; attemptedDeliveryCount: number; confirmedCount: number;
    codDeliveredCount: number; codFailedCount: number;
  } | null>(null);
  // Completed dates from DB — days where every order is in a final state
  const [completedDatesDb, setCompletedDatesDb] = useState<Set<string>>(new Set());


  useEffect(() => {
    loadUser();
    loadSummary();
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

  // Each widget's data comes either from its own route or from the one-request dashboard
  // summary (same response shapes); these apply a response to state.
  const applyBreakevenMetrics = useCallback((res: Awaited<ReturnType<typeof api.getBreakevenMetrics>>) => {
    if (res.success) {
      setBreakevenDbMetrics({
        aov: res.aov ?? 0,
        avgCOGS: res.avgCOGS ?? 0,
        avgShipping: res.avgShipping ?? 0,
        avgTotalCost: res.avgTotalCost ?? 0,
        contributionMargin: res.contributionMargin ?? 0,
        breakevenROAS: res.breakevenROAS ?? 0,
        deliveredCount: res.deliveredCount ?? 0,
        failedCount: res.failedCount ?? 0,
        totalOrders: res.totalOrders ?? 0,
        breakevenMetaROAS: res.breakevenMetaROAS ?? 0,
        since: res.since ?? null,
      });
    }
  }, []);

  const applyRoas = useCallback((res: Awaited<ReturnType<typeof api.getDailyROAS>>) => {
    if (res.success && res.records) {
      setRoasDbRecords(res.records);
    }
  }, []);

  const applyShipping = useCallback((res: Awaited<ReturnType<typeof api.getDailyShipping>>) => {
    if (res.success && res.records) {
      setShippingDbRecords(res.records);
    }
  }, []);

  const applyOrderStats = useCallback((res: Awaited<ReturnType<typeof api.getDailyOrderStats>>) => {
    if (res.success && res.stats) {
      setOrderStatsDb(res.stats);
    }
    if (res.success && res.completedDates) {
      setCompletedDatesDb(new Set(res.completedDates));
    }
  }, []);

  const applyPnlChart = useCallback((res: Awaited<ReturnType<typeof api.getDailyPnl>>) => {
    if (res.success && res.records) {
      setPnlChartRecords(res.records.map((r) => ({
        dateKey: r.dateKey,
        isCompleted: r.isCompleted,
        barChartProfit: r.barChartProfit,
      })));
    }
  }, []);

  const applyMonthlyOrderCounts = useCallback((res: Awaited<ReturnType<typeof api.getMonthlyOrderCounts>>) => {
    if (res.success) {
      setMonthlyOrderCounts(res.months);
      setOrderPace({ average: res.paceAverage, day: res.paceDay });
    }
  }, []);

  const applyMonthlyRevenue = useCallback((res: Awaited<ReturnType<typeof api.getMonthlyRevenue>>) => {
    if (res.success) {
      setMonthlyRevenue(res.months);
      setRevenuePace({ average: res.paceAverage, day: res.paceDay });
    }
  }, []);

  const applyHeatmap = useCallback((res: Awaited<ReturnType<typeof api.getDailyPnl>>) => {
    if (res.success && res.records) {
      const map: Record<string, number> = {};
      res.records.forEach((r) => { map[r.dateKey] = r.heatmapProfit; });
      setHeatmapByDate(map);
      setYearlyPnlRecords(res.records.map((r) => ({
        dateKey: r.dateKey,
        isCompleted: r.isCompleted,
        barChartProfit: r.barChartProfit,
      })));
    }
  }, []);

  const loadBreakevenMetrics = useCallback(async () => {
    try {
      applyBreakevenMetrics(await api.getBreakevenMetrics());
    } catch (err) {
      console.error('Failed to load breakeven metrics:', err);
    }
  }, [applyBreakevenMetrics]);

  const loadROAS = useCallback(async (days: number, startDate: string, endDate: string) => {
    setRoasLoading(true);
    try {
      const { start, end } = roasRange(days, startDate, endDate);
      applyRoas(await api.getDailyROAS(start, end));
    } catch (err) {
      console.error('Failed to load ROAS data:', err);
    } finally {
      setRoasLoading(false);
    }
  }, [applyRoas]);

  const loadShipping = useCallback(async () => {
    try {
      // Fetch all history — widget aggregates client-side by granularity
      applyShipping(await api.getDailyShipping());
    } catch (err) {
      console.error('Failed to load shipping data:', err);
    }
  }, [applyShipping]);

  const loadOrderStats = useCallback(async () => {
    try {
      const { start, end } = orderStatsRange();
      applyOrderStats(await api.getDailyOrderStats(start, end));
    } catch (err) {
      console.error('Failed to load order stats:', err);
    }
  }, [applyOrderStats]);

  const loadPnlChart = useCallback(async (year: number, month: number) => {
    try {
      const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
      applyPnlChart(await api.getDailyPnl({ month: monthStr }));
    } catch (err) {
      console.error('Failed to load P&L chart data:', err);
    }
  }, [applyPnlChart]);

  const loadMonthlyOrderCounts = useCallback(async () => {
    try {
      applyMonthlyOrderCounts(await api.getMonthlyOrderCounts());
    } catch (err) {
      console.error('Failed to load monthly order counts:', err);
    }
  }, [applyMonthlyOrderCounts]);

  const loadMonthlyRevenue = useCallback(async () => {
    try {
      applyMonthlyRevenue(await api.getMonthlyRevenue());
    } catch (err) {
      console.error('Failed to load monthly revenue:', err);
    }
  }, [applyMonthlyRevenue]);

  const loadHeatmap = useCallback(async (year: number) => {
    try {
      applyHeatmap(await api.getDailyPnl({ year: String(year) }));
    } catch (err) {
      console.error('Failed to load heatmap data:', err);
    }
  }, [applyHeatmap]);

  // Everything the Dashboard shows on open comes in one request, sent alongside getMe (the
  // route checks the token itself). If it fails, each widget loads on its own once the user
  // is known.
  const [summaryFailed, setSummaryFailed] = useState(false);
  const loadSummary = useCallback(async () => {
    setRoasLoading(true);
    try {
      const roas = roasRange(roasDays, roasStartDate, roasEndDate);
      const stats = orderStatsRange();
      const res = await api.getDashboardSummary({
        month: `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`,
        year: String(selectedYear),
        roasStart: roas.start,
        roasEnd: roas.end,
        statsStart: stats.start,
        statsEnd: stats.end,
      });
      if (!res.success) throw new Error(res.error || 'Dashboard summary failed');
      applyBreakevenMetrics(res.breakeven);
      applyRoas(res.roas);
      applyShipping(res.shipping);
      applyOrderStats(res.orderStats);
      applyPnlChart(res.pnlMonth);
      applyHeatmap(res.pnlYear);
      applyMonthlyOrderCounts(res.monthlyOrderCounts);
      applyMonthlyRevenue(res.monthlyRevenue);
    } catch (err) {
      console.error('Failed to load the dashboard summary; loading widgets one by one:', err);
      setSummaryFailed(true);
    } finally {
      setRoasLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads the initial filters once, on mount
  }, []);

  useEffect(() => {
    if (user && summaryFailed) {
      loadBreakevenMetrics();
      loadROAS(roasDays, roasStartDate, roasEndDate);
      loadShipping();
      loadOrderStats();
      loadMonthlyOrderCounts();
      loadMonthlyRevenue();
      loadPnlChart(selectedYear, selectedMonth);
      loadHeatmap(selectedYear);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after a failed summary
  }, [user, summaryFailed]);

  // Re-fetch bar chart when selected month/year changes
  useEffect(() => {
    if (user) loadPnlChart(selectedYear, selectedMonth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, selectedMonth]);

  // Re-fetch heatmap when selected year changes
  useEffect(() => {
    if (user) loadHeatmap(selectedYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // A grey bar = incomplete day (has orders not yet delivered/failed). Clicking one
  // opens the drawer with the pending orders responsible.
  const isGreyDay = (entry: any): boolean =>
    !!entry && entry.unrealizedProfit !== null && entry.bookedProfit === null;

  const openIncompleteDrawer = async (entry: any) => {
    const e = entry?.payload ?? entry;
    if (!isGreyDay(e) || !e.dateKey) return;
    setPnlDrawer({ open: true, date: e.dateKey, loading: true, orders: [] });
    try {
      const res = await api.getIncompleteDayOrders(e.dateKey);
      setPnlDrawer({ open: true, date: e.dateKey, loading: false, orders: res.success ? res.orders : [] });
    } catch (err) {
      console.error('Failed to load incomplete-day orders:', err);
      setPnlDrawer({ open: true, date: e.dateKey, loading: false, orders: [] });
    }
  };

  const markDrawerOrder = async (orderNumber: string, status: 'Delivered' | 'Failed') => {
    setMarkingOrder(orderNumber);
    const toastId = toast.loading(`Marking ${orderNumber} as ${status}…`);
    try {
      const res = await api.updateOrderDeliveryStatus(orderNumber, status);
      if (res.success) {
        toast.success(`${orderNumber} marked as ${status}`, { id: toastId });
        // Drop it from the drawer — it's no longer pending.
        setPnlDrawer((p) => ({ ...p, orders: p.orders.filter((o) => o.orderNumber !== orderNumber) }));
        // The endpoint already recomputed the day, so refresh the chart now.
        loadPnlChart(selectedYear, selectedMonth);
        loadHeatmap(selectedYear);
        loadOrderStats();
      } else {
        toast.error(res.error || 'Failed to update status', { id: toastId });
      }
    } catch (err) {
      console.error('Failed to mark order status:', err);
      toast.error('Failed to update status', { id: toastId });
    } finally {
      setMarkingOrder(null);
    }
  };

  // Orders-per-month bar chart data (oldest → newest)
  const monthLabel = (ym: string) => {
    const [y, mo] = ym.split('-').map(Number);
    // "Dec ’25", so a month never reads like a date
    return `${new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short' })} ’${String(y).slice(2)}`;
  };
  const ordinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  };
  const monthlyOrderChartData = monthlyOrderCounts.map((m) => ({
    label: monthLabel(m.month),
    month: m.month,
    orders: m.orders,
  }));

  // Revenue-per-month bar chart data (oldest → newest)
  const monthlyRevenueChartData = monthlyRevenue.map((m) => ({
    label: monthLabel(m.month),
    month: m.month,
    revenue: m.revenue,
  }));

  // Averages across the shown months, for the reference lines
  const avgMonthlyOrders = monthlyOrderChartData.length
    ? monthlyOrderChartData.reduce((s, d) => s + d.orders, 0) / monthlyOrderChartData.length
    : 0;
  const avgMonthlyRevenue = monthlyRevenueChartData.length
    ? monthlyRevenueChartData.reduce((s, d) => s + d.revenue, 0) / monthlyRevenueChartData.length
    : 0;

  // ROAS chart data — built from DB records fetched on Go / mount
  const roasChartData = roasDbRecords.map((r) => ({
    date: new Date(r.dateKey).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: STORE_TIMEZONE }),
    dateKey: r.dateKey,
    roas: r.roas,
    revenue: r.revenue,
    adSpend: r.adSpend,
    profit: heatmapByDate[r.dateKey] || 0,
  }));

  // Profit Chart Data — built from DB records (no orders array needed)
  const profitChartData = (() => {
    const now = new Date();
    const todayKey = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
    // Number of days in the selected month (day 0 of next month = last day of this one).
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();

    // Build a quick lookup from DB records
    const dbMap = new Map(pnlChartRecords.map((r) => [r.dateKey, r]));

    const data: Array<{ date: string; dateKey: string; bookedProfit: number | null; unrealizedProfit: number | null; displayProfit: number | null; yetToBookProfit: number }> = [];

    for (let day = 1; day <= daysInMonth; day++) {
      // Build the dateKey straight from the calendar numbers so it never shifts
      // with the machine timezone (dateKeys are store-local calendar days).
      const dateKey = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const rec = dbMap.get(dateKey);
      const isFuture = dateKey > todayKey;

      let bookedProfit: number | null = null;
      let unrealizedProfit: number | null = null;

      if (!isFuture && rec?.isCompleted) {
        bookedProfit = rec.barChartProfit;
      } else if (!isFuture && rec && !rec.isCompleted) {
        unrealizedProfit = rec.barChartProfit;
      }

      data.push({
        date: new Date(selectedYear, selectedMonth, day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        dateKey,
        bookedProfit,
        unrealizedProfit,
        displayProfit: bookedProfit ?? unrealizedProfit,
        yetToBookProfit: 0,
      });
    }

    return data;
  })();

  // Monthly profit line chart — sum of barChartProfit for completed days, grouped by month
  const monthlyProfitData = (() => {
    const now = new Date();
    const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthMap: Record<number, number> = {};
    for (const rec of yearlyPnlRecords) {
      if (!rec.isCompleted) continue;
      const month = new Date(rec.dateKey + 'T00:00:00').getMonth();
      monthMap[month] = (monthMap[month] ?? 0) + rec.barChartProfit;
    }
    const lastMonth = now.getFullYear() === selectedYear ? now.getMonth() : 11;
    return shortMonths.slice(0, lastMonth + 1).map((name, i) => ({
      month: name,
      profit: monthMap[i] !== undefined ? Math.round(monthMap[i]) : null,
    }));
  })();

  // Breakeven metrics from DB (null while loading)
  const breakevenMetrics = breakevenDbMetrics ?? {
    aov: 0, avgCOGS: 0, avgShipping: 0, avgTotalCost: 0,
    contributionMargin: 0, breakevenROAS: 0,
    breakevenMetaROAS: 0, deliveredCount: 0, failedCount: 0, totalOrders: 0, since: null,
  };

  // Pie Charts data — sourced from DB (pre-computed daily stats)
  const pieChartsData = (() => {
    const s = orderStatsDb;
    const prepaidCount = s?.prepaidCount ?? 0;
    const codCount = s?.codCount ?? 0;
    const deliveredCount = s?.deliveredCount ?? 0;
    const failedCount = s?.failedCount ?? 0;
    const inTransitCount = s?.inTransitCount ?? 0;
    const outForDeliveryCount = s?.outForDeliveryCount ?? 0;
    const attemptedDeliveryCount = s?.attemptedDeliveryCount ?? 0;
    const confirmedCount = s?.confirmedCount ?? 0;
    const codDeliveredCount = s?.codDeliveredCount ?? 0;
    const codFailedCount = s?.codFailedCount ?? 0;

    return {
      paymentMethod: [
        { name: 'Prepaid', value: prepaidCount, color: 'var(--positive)' },
        { name: 'COD', value: codCount, color: 'var(--chart-amber)' },
      ],
      deliveryStatus: [
        { name: 'Delivered', value: deliveredCount, color: 'var(--positive)' },
        { name: 'Out for Delivery', value: outForDeliveryCount, color: 'var(--info)' },
        { name: 'Attempted Delivery', value: attemptedDeliveryCount, color: 'var(--chart-amber)' },
        { name: 'In Transit', value: inTransitCount, color: 'var(--chart-bar)' },
        { name: 'Confirmed', value: confirmedCount, color: 'var(--line)' },
        { name: 'Failed', value: failedCount, color: 'var(--negative)' },
      ].filter(item => item.value > 0),
      codTotal: codDeliveredCount + codFailedCount,
      codStatus: [
        { name: 'Delivered', value: codDeliveredCount, color: 'var(--positive)' },
        { name: 'Failed', value: codFailedCount, color: 'var(--negative)' },
      ].filter(item => item.value > 0),
      totalOrders: prepaidCount + codCount,
    };
  })();

  const handleLegendClick = (data: any) => {
    // Determine filter type and value based on clicked item
    // Data comes from an order-distribution legend button ({ name })
    const name = data.value || data.name || data.id;

    if (!name) return;

    let filter: SalesPageProps['initialFilter'];

    // Map chart names to filter values
    if (['Prepaid', 'COD'].includes(name)) {
      filter = { type: 'payment', value: name, period: 'last30' };
    } else {
      // Status filters
      filter = { type: 'status', value: name, period: 'last30' };
    }

    setSalesModalFilter(filter);
    setSalesModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className={styles.page} aria-busy="true">
        <Skeleton height={26} width={200} />
        <Skeleton height={64} />
        <Skeleton height={240} />
      </div>
    );
  }

  // ── Figures for the strip ────────────────────────────────────────────────
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const currentMonth = todayKey.slice(0, 7);
  const ordersNow = monthlyOrderChartData.find((m) => m.month === currentMonth);
  const revenueNow = monthlyRevenueChartData.find((m) => m.month === currentMonth);
  const vsPace = (value: number | undefined, average: number) =>
    value !== undefined && average > 0 ? ((value - average) / average) * 100 : null;
  const ordersVsPace = vsPace(ordersNow?.orders, orderPace.average);
  const revenueVsPace = vsPace(revenueNow?.revenue, revenuePace.average);
  const mean = (values: number[]) => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null);
  // ROAS figures count only completed days (every order delivered or failed), as before
  const completedRoasDays = roasChartData.filter((d) => completedDatesDb.has(d.dateKey));
  const avgRoas = mean(completedRoasDays.map((d) => d.roas).filter((v): v is number => v !== null && v > 0));
  const completedRevenue = completedRoasDays.reduce((s, d) => s + d.revenue, 0);
  const completedAdSpend = completedRoasDays.reduce((s, d) => s + d.adSpend, 0);
  const weekdayName = new Date().toLocaleDateString('en-IN', { weekday: 'long' });
  const weekdayRoas = mean(
    roasChartData
      .filter((d) => new Date(d.dateKey).getDay() === new Date().getDay())
      .map((d) => d.roas)
      .filter((v): v is number => v !== null && v > 0),
  );
  const bookedPnl = profitChartData.reduce((s, d) => s + (d.bookedProfit ?? 0), 0);
  const pendingPnl = profitChartData.reduce((s, d) => s + (d.unrealizedProfit ?? 0), 0);
  const completedDays = profitChartData.filter((d) => d.bookedProfit !== null).length;
  const greyDays = profitChartData.filter(isGreyDay).length;
  const profitMonths = monthlyProfitData.filter((d): d is { month: string; profit: number } => d.profit !== null);
  const bestMonth = profitMonths.reduce<(typeof profitMonths)[number] | null>((a, b) => (!a || b.profit > a.profit ? b : a), null);
  const worstMonth = profitMonths.reduce<(typeof profitMonths)[number] | null>((a, b) => (!a || b.profit < a.profit ? b : a), null);
  const yearProfit = profitMonths.reduce((s, d) => s + d.profit, 0);
  const currentMonthShort = new Date().toLocaleDateString('en-IN', { month: 'short' });
  const finalOrders = breakevenMetrics.deliveredCount + breakevenMetrics.failedCount;
  const failRate = finalOrders > 0 ? (breakevenMetrics.failedCount / finalOrders) * 100 : null;
  const roasRangeLabel =
    roasStartDate && roasEndDate
      ? `${new Date(roasStartDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(roasEndDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : `last ${roasDays} days`;
  const selectedMonthLabel = new Date(selectedYear, selectedMonth, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

  // ── Heatmap: daily P/L keyed by IST date; a day stays grey until all its orders are final ──
  const heatData: Record<string, HeatmapDay> = {};
  for (const rec of yearlyPnlRecords) {
    heatData[rec.dateKey] = { value: heatmapByDate[rec.dateKey] ?? null, pending: !rec.isCompleted };
  }

  // ── Order distribution as stacked shares ────────────────────────────────
  const shareRows = [
    {
      label: 'Payment method',
      total: `${pieChartsData.totalOrders.toLocaleString('en-IN')} orders`,
      segs: [
        { name: 'Prepaid', value: pieChartsData.paymentMethod[0].value, color: 'var(--chart-line)' },
        { name: 'COD', value: pieChartsData.paymentMethod[1].value, color: 'var(--chart-bar)' },
      ],
    },
    {
      label: 'Delivery status',
      total: `${pieChartsData.deliveryStatus.reduce((s, d) => s + d.value, 0).toLocaleString('en-IN')} orders`,
      segs: pieChartsData.deliveryStatus.map((d) => ({ name: d.name, value: d.value, color: SHARE_COLORS[d.name] ?? 'var(--chart-bar)' })),
    },
    {
      label: 'COD delivery status',
      total: `${pieChartsData.codTotal.toLocaleString('en-IN')} final COD orders`,
      segs: pieChartsData.codStatus.map((d) => ({ name: d.name, value: d.value, color: SHARE_COLORS[d.name] ?? 'var(--chart-bar)' })),
    },
  ];

  const lastOrdersIndex = monthlyOrderChartData.length - 1;
  const lastRevenueIndex = monthlyRevenueChartData.length - 1;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Dashboard"
        description={`${new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · all days in IST`}
        actions={
          <Select
            label="Year"
            inlineLabel
            size="sm"
            value={String(selectedYear)}
            onChange={(v) => setSelectedYear(Number(v))}
            options={[0, 1, 2].map((back) => {
              const y = new Date().getFullYear() - back;
              return { value: String(y), label: String(y) };
            })}
          />
        }
      />

      <StatStrip>
        <StatCard
          label="Orders this month"
          value={ordersNow ? ordersNow.orders.toLocaleString('en-IN') : '—'}
          spark={monthlyOrderChartData.map((m) => m.orders)}
          trend={ordersVsPace !== null ? { label: `${Math.abs(ordersVsPace).toFixed(1)}%`, direction: ordersVsPace >= 0 ? 'up' : 'down', good: ordersVsPace >= 0 } : undefined}
          sub={orderPace.day > 0 ? `vs avg ${orderPace.average.toLocaleString('en-IN')} by the ${ordinal(orderPace.day)}` : undefined}
        />
        <StatCard
          label="Revenue this month"
          value={revenueNow ? formatINR(revenueNow.revenue) : '—'}
          spark={monthlyRevenueChartData.map((m) => m.revenue)}
          trend={revenueVsPace !== null ? { label: `${Math.abs(revenueVsPace).toFixed(1)}%`, direction: revenueVsPace >= 0 ? 'up' : 'down', good: revenueVsPace >= 0 } : undefined}
          sub={revenuePace.day > 0 ? `vs avg ${formatINR(revenuePace.average)} by the ${ordinal(revenuePace.day)}` : undefined}
        />
        <StatCard
          label={`Booked profit · ${selectedMonthLabel}`}
          value={formatINR(bookedPnl, { signed: true })}
          tone={bookedPnl > 0 ? 'positive' : bookedPnl < 0 ? 'negative' : 'neutral'}
          spark={profitChartData.filter((d) => d.displayProfit !== null).map((d) => d.displayProfit as number)}
          sub={`completed days · ${formatINR(pendingPnl, { signed: true })} not final yet`}
        />
        <StatCard
          label={`Avg ROAS · ${roasRangeLabel}`}
          value={avgRoas !== null ? `${avgRoas.toFixed(2)}×` : '—'}
          tone={avgRoas !== null && breakevenMetrics.breakevenROAS > 0 && avgRoas < breakevenMetrics.breakevenROAS ? 'negative' : 'neutral'}
          spark={roasChartData.filter((d) => d.roas !== null).map((d) => d.roas as number)}
          sub={`completed days${breakevenMetrics.breakevenROAS > 0 ? ` · breakeven ${breakevenMetrics.breakevenROAS.toFixed(2)}×` : ''}`}
        />
        <StatCard
          label={`Ad spend · ${roasRangeLabel}`}
          value={formatINR(completedAdSpend)}
          spark={roasChartData.map((d) => d.adSpend || 0)}
          sub={`completed days · revenue ${formatINR(completedRevenue, { compact: true })}`}
        />
        <StatCard
          label="Failed orders"
          value={failRate !== null ? `${failRate.toFixed(1)}%` : '—'}
          tone={failRate !== null && failRate > 15 ? 'negative' : 'neutral'}
          sub={finalOrders > 0 ? `${breakevenMetrics.failedCount.toLocaleString('en-IN')} of ${finalOrders.toLocaleString('en-IN')} final` : undefined}
        />
      </StatStrip>

      <div className={styles.row}>
        <Card
          className={styles.wide}
          title="Return on ad spend · daily"
          eyebrow={roasRangeLabel}
          footer={
            <>
              <span>{`${weekdayName} average ${weekdayRoas !== null ? `${weekdayRoas.toFixed(2)}×` : '—'}`}</span>
              <span>ROAS = revenue ÷ ad spend, per day</span>
            </>
          }
          actions={
            <div className={styles.controls}>
              <div className={styles.ctl}>
                <span>Last</span>
                <TextField
                  ref={roasDaysRef}
                  size="sm"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={30}
                  aria-label="Last N days"
                  style={{ width: 44 }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const days = Math.max(1, Number(roasDaysRef.current?.value) || 30);
                    setRoasDays(days);
                    setRoasStartDate('');
                    setRoasEndDate('');
                    setRoasFrom('');
                    setRoasTo('');
                    loadROAS(days, '', '');
                  }}
                />
                <span>days</span>
              </div>
              <span className={styles.or}>or</span>
              <DateField size="sm" aria-label="From" placeholder="From" max={roasTo || undefined} value={roasFrom} onChange={setRoasFrom} />
              <DateField size="sm" aria-label="To" placeholder="To" min={roasFrom || undefined} value={roasTo} onChange={setRoasTo} />
              <Button
                size="sm"
                onClick={() => {
                  const start = roasFrom;
                  const end = roasTo;
                  const days = Math.max(1, Number(roasDaysRef.current?.value) || 30);
                  if (start && end) {
                    setRoasStartDate(start);
                    setRoasEndDate(end);
                    loadROAS(days, start, end);
                  } else {
                    setRoasDays(days);
                    setRoasStartDate('');
                    setRoasEndDate('');
                    loadROAS(days, '', '');
                  }
                }}
              >
                Apply
              </Button>
              {(roasStartDate || roasEndDate) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRoasStartDate('');
                    setRoasEndDate('');
                    setRoasFrom('');
                    setRoasTo('');
                    loadROAS(roasDays, '', '');
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          }
        >
          {roasLoading ? (
            <Skeleton height={220} />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={roasChartData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} minTickGap={24} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}×`} width={40} />
                <ChartTooltip contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} formatter={(v) => [`${Number(v).toFixed(2)}×`, 'ROAS']} />
                {breakevenMetrics.breakevenROAS > 0 && (
                  <ReferenceLine
                    y={breakevenMetrics.breakevenROAS}
                    stroke="var(--negative-solid)"
                    strokeDasharray="4 3"
                    label={{ ...REF_LABEL, value: `breakeven ${breakevenMetrics.breakevenROAS.toFixed(2)}×`, position: 'insideTopRight' }}
                  />
                )}
                <Line type="linear" dataKey="roas" stroke="var(--chart-line)" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: 'var(--chart-highlight)', stroke: 'none' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card
          title="Breakeven"
          eyebrow={
            breakevenMetrics.since
              ? `${breakevenMetrics.totalOrders.toLocaleString('en-IN')} settled orders since ${new Date(breakevenMetrics.since + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
              : undefined
          }
          footer="Breakeven ROAS is on delivered revenue, like the ROAS on this page. Ads Manager's ROAS also counts the purchases that later fail, so hold it to the Meta breakeven."
        >
          <DataList
            items={[
              { label: 'Avg revenue per order', sub: 'delivered revenue; a failed order counts ₹0', value: formatINR(breakevenMetrics.aov, { decimals: 2 }) },
              { label: 'Avg COGS per order', sub: 'delivered: COGS · failed: NDR (returned books are resold)', value: formatINR(-breakevenMetrics.avgCOGS, { decimals: 2 }) },
              { label: 'Avg shipping per order', sub: 'forward, COD and RTO freight', value: formatINR(-breakevenMetrics.avgShipping, { decimals: 2 }) },
              { label: 'Contribution margin', sub: 'revenue − COGS − shipping', value: formatINR(breakevenMetrics.contributionMargin, { decimals: 2 }) },
              {
                label: 'Meta breakeven ROAS',
                sub: "for Ads Manager's ROAS: every order at its value ÷ margin",
                value: breakevenMetrics.breakevenMetaROAS > 0 ? `${breakevenMetrics.breakevenMetaROAS.toFixed(2)}×` : '—',
              },
            ]}
            total={{ label: 'Breakeven ROAS', value: breakevenMetrics.breakevenROAS > 0 ? `${breakevenMetrics.breakevenROAS.toFixed(2)}×` : '—' }}
          />
        </Card>
      </div>

      <div className={styles.row}>
        <Card
          title="Orders per month"
          eyebrow={ordersNow ? `${currentMonthShort} to date ${ordersNow.orders.toLocaleString('en-IN')}` : undefined}
          footer={
            <>
              <span className={styles.key}><LineSwatch color="var(--ink-subtle)" />{`avg ${Math.round(avgMonthlyOrders).toLocaleString('en-IN')} a month`}</span>
              {orderPace.day > 0 && (
                <span className={styles.key}><LineSwatch color="var(--chart-amber)" />{`avg ${orderPace.average.toLocaleString('en-IN')} by the ${ordinal(orderPace.day)}`}</span>
              )}
            </>
          }
        >
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={monthlyOrderChartData} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
              <ChartTooltip cursor={CURSOR_FILL} contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} formatter={(v) => [Number(v).toLocaleString('en-IN'), 'Orders']} />
              {avgMonthlyOrders > 0 && (
                <ReferenceLine
                  y={avgMonthlyOrders}
                  stroke="var(--ink-subtle)"
                  strokeDasharray="4 3"
                />
              )}
              {orderPace.day > 0 && (
                <ReferenceLine
                  y={orderPace.average}
                  stroke="var(--chart-amber)"
                  strokeDasharray="4 3"
                />
              )}
              <Bar dataKey="orders" isAnimationActive={false}>
                {monthlyOrderChartData.map((d, i) => (
                  <Cell key={d.month} fill={i === lastOrdersIndex ? 'var(--chart-highlight)' : 'var(--chart-bar)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card
          title="Revenue per month"
          eyebrow={revenueNow ? `${currentMonthShort} to date ${formatINR(revenueNow.revenue, { compact: true })}` : undefined}
          footer={
            <>
              <span className={styles.key}><LineSwatch color="var(--ink-subtle)" />{`avg ${formatINR(avgMonthlyRevenue, { compact: true })} a month`}</span>
              {revenuePace.day > 0 && (
                <span className={styles.key}><LineSwatch color="var(--chart-amber)" />{`avg ${formatINR(revenuePace.average, { compact: true })} by the ${ordinal(revenuePace.day)}`}</span>
              )}
            </>
          }
        >
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={monthlyRevenueChartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--rule)' }} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatINR(v, { compact: true })} />
              <ChartTooltip cursor={CURSOR_FILL} contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} formatter={(v) => [formatINR(Number(v)), 'Revenue']} />
              {avgMonthlyRevenue > 0 && (
                <ReferenceLine
                  y={avgMonthlyRevenue}
                  stroke="var(--ink-subtle)"
                  strokeDasharray="4 3"
                />
              )}
              {revenuePace.day > 0 && (
                <ReferenceLine
                  y={revenuePace.average}
                  stroke="var(--chart-amber)"
                  strokeDasharray="4 3"
                />
              )}
              <Bar dataKey="revenue" isAnimationActive={false}>
                {monthlyRevenueChartData.map((d, i) => (
                  <Cell key={d.month} fill={i === lastRevenueIndex ? 'var(--chart-highlight)' : 'var(--chart-bar)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card
          title="Monthly profit"
          eyebrow={`${selectedYear} · final days only`}
          footer={
            <>
              <span>
                {bestMonth ? `best ${bestMonth.month} ${formatINR(bestMonth.profit, { signed: true, compact: true })}` : 'best —'}
                {worstMonth ? ` · worst ${worstMonth.month} ${formatINR(worstMonth.profit, { signed: true, compact: true })}` : ''}
              </span>
              <span>{`year ${formatINR(yearProfit, { signed: true })}`}</span>
            </>
          }
        >
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={monthlyProfitData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatINR(v, { compact: true })} />
              <ChartTooltip cursor={CURSOR_FILL} contentStyle={TOOLTIP_STYLE} labelStyle={TOOLTIP_LABEL} itemStyle={TOOLTIP_ITEM} formatter={(v) => [formatINR(Number(v), { signed: true }), 'Profit']} />
              <ReferenceLine y={0} stroke="var(--rule)" />
              <Bar dataKey="profit" isAnimationActive={false}>
                {monthlyProfitData.map((d) => (
                  <Cell key={d.month} fill={(d.profit ?? 0) < 0 ? 'var(--negative-solid)' : 'var(--positive-solid)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className={styles.row}>
        <Card
          className={styles.wide}
          title={`Profit and loss · ${monthNames[selectedMonth]} ${selectedYear}`}
          eyebrow="grey days still have orders in transit — click one to see them"
          footer={
            <>
              <span>{`${completedDays} completed days · ${greyDays} with orders in transit`}</span>
              <span>{`booked ${formatINR(bookedPnl, { signed: true })}`}</span>
            </>
          }
          actions={
            <Select
              label="Month"
              inlineLabel
              size="sm"
              value={String(selectedMonth)}
              onChange={(v) => setSelectedMonth(Number(v))}
              options={monthNames.map((name, i) => ({ value: String(i), label: name }))}
            />
          }
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={profitChartData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatINR(v, { compact: true })} />
              <ChartTooltip
                cursor={CURSOR_FILL}
                contentStyle={TOOLTIP_STYLE}
                labelStyle={TOOLTIP_LABEL}
                itemStyle={TOOLTIP_ITEM}
                formatter={(v, _name, item) => [formatINR(Number(v), { signed: true }), isGreyDay(item?.payload) ? 'Not final yet' : 'Profit']}
              />
              <ReferenceLine y={0} stroke="var(--rule)" />
              <Bar dataKey="displayProfit" isAnimationActive={false} onClick={(entry) => openIncompleteDrawer(entry)}>
                {profitChartData.map((d) => (
                  <Cell
                    key={d.dateKey}
                    cursor={isGreyDay(d) ? 'pointer' : 'default'}
                    fill={isGreyDay(d) ? 'var(--tile-pending)' : (d.displayProfit ?? 0) < 0 ? 'var(--negative-solid)' : 'var(--positive-solid)'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Order distribution" eyebrow="last 30 days · click a status to see its orders">
          <div className={styles.dist}>
            {shareRows.map((row) => {
              const total = row.segs.reduce((s, x) => s + x.value, 0);
              return (
                <div key={row.label}>
                  <div className={styles.distHead}>
                    <span>{row.label}</span>
                    <span>{row.total}</span>
                  </div>
                  <div className={styles.stack}>
                    {row.segs.map((x) => (
                      <Tooltip content={`${x.name}: ${x.value}`} key={x.name}>
                        <span style={{ width: total ? `${(x.value / total) * 100}%` : 0, background: x.color }} />
                      </Tooltip>
                    ))}
                  </div>
                  <div className={styles.legend}>
                    {row.segs.map((x) => (
                      <button key={x.name} type="button" className={styles.legendBtn} onClick={() => handleLegendClick({ name: x.name })}>
                        <b style={{ background: x.color }} />
                        {x.name}
                        <em>{`${x.value.toLocaleString('en-IN')} · ${total ? Math.round((x.value / total) * 100) : 0}%`}</em>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className={styles.heat} title={`Daily profit and loss · ${selectedYear}`} eyebrow="hover a day for its value · click a grey day for its pending orders">
        <Heatmap
          year={selectedYear}
          data={heatData}
          onDayClick={(dateKey, day) => {
            if (day.pending) openIncompleteDrawer({ dateKey, unrealizedProfit: day.value, bookedProfit: null });
          }}
        />
      </Card>

      <div className={styles.row}>
        <ShippingChart
          records={shippingDbRecords}
          granularity={shippingGranularity}
          onGranularity={setShippingGranularity}
          active={activeShippingLines}
          onToggle={(key) => setActiveShippingLines((prev) => ({ ...prev, [key]: !prev[key] }))}
        />
      </div>

      <MetaAccountSection />

      <Drawer
        open={pnlDrawer.open}
        onClose={() => setPnlDrawer((p) => ({ ...p, open: false }))}
        title="Pending orders"
        description={pnlDrawer.date ? `${new Date(pnlDrawer.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} — not final until these are delivered or failed` : undefined}
        footer={
          !pnlDrawer.loading && pnlDrawer.orders.length > 0 ? (
            <>
              <span>{pnlDrawer.orders.length} pending order{pnlDrawer.orders.length > 1 ? 's' : ''}</span>
              <Amount value={pnlDrawer.orders.reduce((s, o) => s + o.amount, 0)} />
            </>
          ) : undefined
        }
      >
        {pnlDrawer.loading ? (
          <Skeleton lines={4} />
        ) : pnlDrawer.orders.length === 0 ? (
          <EmptyState size="sm" icon="circle-check" title="No pending orders" description="Every order from this day is delivered or failed." />
        ) : (
          <div className={styles.pending}>
            {pnlDrawer.orders.map((o) => (
              <div key={o.orderNumber} className={styles.pendingRow} style={{ opacity: markingOrder === o.orderNumber ? 0.5 : 1 }}>
                <span className="pbx-mono">{o.orderNumber}</span>
                <DeliveryBadge status={o.deliveryStatus} size="sm" />
                <Amount value={o.amount} />
                {o.trackingUrl ? (
                  <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer" className={styles.track}>Track</a>
                ) : (
                  <span className={styles.track}>—</span>
                )}
                <Menu
                  label={`Actions for ${o.orderNumber}`}
                  trigger={<Button size="sm" variant="ghost" iconOnly icon="ellipsis-vertical" disabled={markingOrder === o.orderNumber}>{`Actions for ${o.orderNumber}`}</Button>}
                  items={[
                    { label: 'Mark as delivered', icon: 'circle-check', tone: 'positive', onSelect: () => markDrawerOrder(o.orderNumber, 'Delivered') },
                    { label: 'Mark as failed', icon: 'circle-x', tone: 'negative', onSelect: () => markDrawerOrder(o.orderNumber, 'Failed') },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </Drawer>

      <Dialog
        open={salesModalOpen}
        onClose={() => setSalesModalOpen(false)}
        size="full"
        title={salesModalFilter ? `${salesModalFilter.value} orders` : 'Orders'}
        description="Last 30 days, from the order distribution"
      >
        <Suspense fallback={<Skeleton lines={6} />}>
          <SalesPage initialFilter={salesModalFilter} embedded />
        </Suspense>
      </Dialog>
    </div>
  );
}

