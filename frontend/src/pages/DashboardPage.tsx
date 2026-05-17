import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
  PieChart,
  Pie,
} from 'recharts';
import { api } from '../services/api';
import type { AdminUser, ShopifyOrder } from '../services/api';
import { SalesPage, type SalesPageProps } from './SalesPage';
import styles from './DashboardPage.module.css';

const STORE_TIMEZONE = 'Asia/Kolkata';

function getOrderDateKey(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

/** Get date (YYYY-MM-DD) and hour (0-23) in store timezone for an order */
function getOrderDateAndHour(createdAt: string): { dateKey: string; hour: number } {
  const d = new Date(createdAt);
  const dateKey = d.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
  const hourStr = d.toLocaleString('en-US', { timeZone: STORE_TIMEZONE, hour: 'numeric', hour12: false });
  let hour = Number(hourStr);
  if (Number.isNaN(hour) || hour < 0) hour = 0;
  if (hour > 23) hour = 23;
  return { dateKey, hour };
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
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  // ROAS filter — uncontrolled refs for inputs (no re-render on typing)
  const roasDaysRef = useRef<HTMLInputElement>(null);
  const roasStartRef = useRef<HTMLInputElement>(null);
  const roasEndRef = useRef<HTMLInputElement>(null);
  // ROAS filter — applied state (what the chart uses, updated on Go)
  const [roasDays, setRoasDays] = useState(30);
  const [roasStartDate, setRoasStartDate] = useState('');
  const [roasEndDate, setRoasEndDate] = useState('');
  // ROAS data fetched from DB
  const [roasDbRecords, setRoasDbRecords] = useState<Array<{ dateKey: string; revenue: number; adSpend: number; roas: number | null }>>([]);
  const [roasLoading, setRoasLoading] = useState(false);
  const [dailyPnlMap, setDailyPnlMap] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);

  // Sales Modal State
  const [salesModalOpen, setSalesModalOpen] = useState(false);
  const [salesModalFilter, setSalesModalFilter] = useState<SalesPageProps['initialFilter']>();

  // Cache for ad spend by date
  const [adSpendByDate, setAdSpendByDate] = useState<Record<string, number>>({});
  const [tooltip, setTooltip] = useState<{ dateLabel: string; pnl: number | null; x: number; y: number } | null>(null);
  const [cogsFields, setCogsFields] = useState<COGSField[]>([]);
  const [rtoOrderIds, setRtoOrderIds] = useState<Set<number>>(new Set());

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
        api.getOrders(10000, true),
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
        const ndrStatuses = ['failed', 'rto', 'return'];
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

      // EXACT same calcOrderPnl logic as SalesPage's calculateOrderProfitLoss (attempted_delivery out of failed)
      const calcOrderPnl = (order: ShopifyOrder): number => {
        if (cogsFields.length === 0) return 0;
        const variant = detectVariant(order);
        const isDelivered = isOrderDelivered(order);
        const status = order.deliveryStatus?.toLowerCase() || '';
        const isFailed =
          rtoOrderIds.has(order.id) ||
          status === 'failure' ||
          status.includes('failed') ||
          status.includes('rto');
        const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';

        let revenue = 0;
        let fieldsToUse: COGSField[] = [];

        if (isDelivered) {
          revenue = order.totalPrice || 0;
          fieldsToUse = (cogsFields as COGSField[]).filter(f => f.type === 'cogs' || f.type === 'both');
        } else if (isFailed) {
          revenue = 0;
          fieldsToUse = (cogsFields as COGSField[]).filter(f => f.type === 'ndr' || f.type === 'both');
        } else {
          revenue = 0;
          fieldsToUse = (cogsFields as COGSField[]).filter(f => f.type === 'cogs' || f.type === 'both');
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

      // Count orders in daily P/L: delivered, failed, or prepaid (prepaid won't fail so count as realized)
      const isOrderCountedInDayPnl = (order: ShopifyOrder) =>
        isOrderFinalStatus(order) || (order.paymentMethod?.toLowerCase() === 'prepaid');
      orders.forEach((o) => {
        if (o.cancelledAt) return;
        const d = getOrderDateKey(o.createdAt);
        if (!isOrderCountedInDayPnl(o)) return;
        datesWithFinalOrders.add(d);
        dailyPnl[d] = (dailyPnl[d] || 0) + (orderPnlByOrderId.get(o.id) ?? 0);
      });

      // Add ad-spend-only days (days without any final-status orders)
      Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
        if (!datesWithFinalOrders.has(dateKey)) {
          dailyPnl[dateKey] = (dailyPnl[dateKey] ?? 0) - amount;
        }
      });

      setOrders(orders);
      setAdSpendByDate(adSpendByDate);
      setDailyPnlMap(dailyPnl);
      setCogsFields(cogsFields);
      setRtoOrderIds(rtoOrderIds);
    } catch (err) {
      console.error('Failed to load daily P/L:', err);
      setDailyPnlMap({});
    }
  }, []);

  const loadROAS = useCallback(async (days: number, startDate: string, endDate: string) => {
    setRoasLoading(true);
    try {
      let start: string;
      let end: string;
      if (startDate && endDate) {
        start = startDate;
        end = endDate;
      } else {
        const now = new Date();
        end = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        const s = new Date(now);
        s.setDate(s.getDate() - (days - 1));
        start = s.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
      }
      const res = await api.getDailyROAS(start, end);
      if (res.success && res.records) {
        setRoasDbRecords(res.records);
      }
    } catch (err) {
      console.error('Failed to load ROAS data:', err);
    } finally {
      setRoasLoading(false);
    }
  }, []);

  const loadShipping = useCallback(async () => {
    try {
      // Fetch all history — widget aggregates client-side by granularity
      const res = await api.getDailyShipping();
      if (res.success && res.records) {
        setShippingDbRecords(res.records);
      }
    } catch (err) {
      console.error('Failed to load shipping data:', err);
    }
  }, []);

  const loadOrderStats = useCallback(async () => {
    try {
      // Last 30 days, not before Jan 28, 2026
      const now = new Date();
      const endDate = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      const thirtyDaysAgo = s.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
      const startDate = thirtyDaysAgo < '2026-01-28' ? '2026-01-28' : thirtyDaysAgo;
      const res = await api.getDailyOrderStats(startDate, endDate);
      if (res.success && res.stats) {
        setOrderStatsDb(res.stats);
      }
    } catch (err) {
      console.error('Failed to load order stats:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadDailyPnl();
      loadROAS(roasDays, roasStartDate, roasEndDate);
      loadShipping();
      loadOrderStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, [user, loadDailyPnl, loadROAS, loadShipping, loadOrderStats]);

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

  // ROAS chart data — built from DB records fetched on Go / mount
  const roasChartData = roasDbRecords.map((r) => ({
    date: new Date(r.dateKey).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: STORE_TIMEZONE }),
    dateKey: r.dateKey,
    roas: r.roas,
    revenue: r.revenue,
    adSpend: r.adSpend,
    profit: dailyPnlMap[r.dateKey] || 0,
  }));

  // Profit Chart Data - Show Selected Month Only
  const profitChartData = (() => {
    const now = new Date();
    const startDate = new Date(selectedYear, selectedMonth, 1);
    const endDate = new Date(selectedYear, selectedMonth + 1, 0);

    const data: Array<{
      date: string;
      dateKey: string;
      bookedProfit: number;
      yetToBookProfit: number;
    }> = [];

    // Helper functions from loadDailyPnl
    const isOrderDelivered = (order: ShopifyOrder) => {
      if (rtoOrderIds.has(order.id)) return false;
      const status = order.deliveryStatus?.toLowerCase() || '';
      const ndrStatuses = ['failed', 'rto', 'return'];
      if (ndrStatuses.some(s => status.includes(s))) return false;
      if (status === 'delivered') return true;
      if (order.paymentMethod?.toLowerCase() === 'prepaid') return true;
      return false;
    };

    const isOrderFinalStatus = (order: ShopifyOrder) => {
      const status = order.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed = rtoOrderIds.has(order.id) ||
        status === 'failure' ||
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

    const calcOrderPnl = (order: ShopifyOrder, adCostForOrder: number): number => {
      if (cogsFields.length === 0) return 0;
      const variant = detectVariant(order);
      const isDelivered = isOrderDelivered(order);
      const status = order.deliveryStatus?.toLowerCase() || '';
      const isFailed = rtoOrderIds.has(order.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';

      let revenue = 0;
      let fieldsToUse: COGSField[] = [];

      if (isDelivered) {
        revenue = order.totalPrice || 0;
        fieldsToUse = cogsFields.filter(f => f.type === 'cogs' || f.type === 'both');
      } else if (isFailed) {
        revenue = 0;
        fieldsToUse = cogsFields.filter(f => f.type === 'ndr' || f.type === 'both');
      } else {
        revenue = 0;
        fieldsToUse = cogsFields.filter(f => f.type === 'cogs' || f.type === 'both');
      }

      let totalCosts = 0;
      const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
      fieldsToUse.forEach((field) => {
        let value = field[key] as number;
        if (value === undefined || value === null) value = 0;
        if (field.calculationType === 'fixed') {
          totalCosts += value;
        } else {
          const salePrice = order.totalPrice || 0;
          const pct = field.percentageType || 'excluded';
          totalCosts += pct === 'included'
            ? (value / (100 + value)) * salePrice
            : (value / 100) * salePrice;
        }
      });

      // Add shipping cost
      if (order.shippingCharge) {
        totalCosts += order.shippingCharge;
      }

      return revenue - totalCosts - adCostForOrder;
    };

    // Get ad cost per order by date
    const orderCountByDate: Record<string, number> = {};
    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const d = getOrderDateKey(o.createdAt);
      orderCountByDate[d] = (orderCountByDate[d] || 0) + 1;
    });

    const adCostPerOrderByDate: Record<string, number> = {};
    Object.keys(adSpendByDate).forEach((d) => {
      const count = orderCountByDate[d] || 0;
      if (count > 0) adCostPerOrderByDate[d] = adSpendByDate[d] / count;
    });

    // Group orders by date
    const ordersByDate: Record<string, ShopifyOrder[]> = {};
    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const d = getOrderDateKey(o.createdAt);
      if (!ordersByDate[d]) ordersByDate[d] = [];
      ordersByDate[d].push(o);
    });

    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      const dateKey = currentDate.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
      const dayOrders = ordersByDate[dateKey] || [];
      const adCostPerOrder = adCostPerOrderByDate[dateKey] || 0;
      const totalAdSpend = adSpendByDate[dateKey] || 0;

      let bookedProfit = 0;

      // If date is in future (after today), don't show data
      // We compare logic using dateKey to avoid time-of-day issues
      const todayKey = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
      const isFuture = dateKey > todayKey;

      if (isFuture) {
        bookedProfit = null as any;
      } else {
        // Check if day is complete (all orders in final status)
        const allComplete = dayOrders.length === 0 || dayOrders.every(o => isOrderFinalStatus(o));

        if (allComplete) {
          // All orders are delivered/failed - show booked profit
          dayOrders.forEach(o => {
            bookedProfit += calcOrderPnl(o, adCostPerOrder);
          });
          // Subtract ad spend if no orders
          if (dayOrders.length === 0 && totalAdSpend > 0) {
            bookedProfit -= totalAdSpend;
          }
        } else {
          // Incomplete day - leave empty (null values won't render bars)
          bookedProfit = null as any;
        }
      }

      data.push({
        date: currentDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: STORE_TIMEZONE }),
        dateKey,
        bookedProfit,
        yetToBookProfit: 0, // Never show light bars
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return data;
  })();

  // Breakeven ROAS Calculation
  const breakevenMetrics = (() => {
    // Detect variant
    const detectVariant = (order: ShopifyOrder): 'small' | 'large' => {
      if (!order.lineItems?.length) return 'small';
      const hasLarge = order.lineItems.some(
        (item) =>
          item.title?.toLowerCase().includes('large') ||
          item.variantTitle?.toLowerCase().includes('large')
      );
      return hasLarge ? 'large' : 'small';
    };

    // Filter orders to only include "Completed Days" within the last 30 days
    // A Completed Day is a day where ALL orders have a final status (Delivered, Failed, RTO).
    // This removes bias from pending orders.

    // 1. Group orders by date
    const ordersByDate: Record<string, ShopifyOrder[]> = {};
    const now = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const cutoffDate = new Date('2026-01-28');
    // Ensure we don't look back further than Jan 28
    const effectiveStartDate = cutoffDate > thirtyDaysAgo ? cutoffDate : thirtyDaysAgo;

    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const d = getOrderDateKey(o.createdAt);
      if (!ordersByDate[d]) ordersByDate[d] = [];
      ordersByDate[d].push(o);
    });

    // 2. Identify Completed Days and aggregate data
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalShipping = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let completedDaysCount = 0;
    const completedDates = new Set<string>();

    // Helper to check final status (duplicated from lower scope, but needed here)
    const isOrderFinal = (order: ShopifyOrder) => {
      const status = order.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed = rtoOrderIds.has(order.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      // Prepaid orders are often assumed delivered if not failed, but for "Completed Day" validaton
      // we should be strict. However, the existing logic assumes Prepaid = Delivered often.
      // Let's stick to the strict definition used in profitChart:
      // isOrderFinalStatus there checks Delivered OR Failed. 
      // But wait, existing isOrderFinalStatus also returns true for Prepaid.
      // Let's use the same logic as the profit chart to match "this widget".
      const isPrepaid = order.paymentMethod?.toLowerCase() === 'prepaid';
      return isDelivered || isFailed || isPrepaid;
    };

    Object.keys(ordersByDate).forEach((dateKey) => {
      // Check if date is within last 30 days AND after cutoff
      const dateObj = new Date(dateKey);
      if (dateObj < effectiveStartDate || dateObj > now) return;

      const dayOrders = ordersByDate[dateKey];
      const allComplete = dayOrders.length > 0 && dayOrders.every(isOrderFinal);

      if (allComplete) {
        completedDaysCount++;
        completedDates.add(dateKey);
        dayOrders.forEach((order) => {
          const variant = detectVariant(order);
          const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
          const status = order.deliveryStatus?.toLowerCase() || '';

          const isDelivered = status === 'delivered' || (paymentMethod === 'prepaid' && !rtoOrderIds.has(order.id));
          const isFailed = !isDelivered && (rtoOrderIds.has(order.id) || status === 'failure' || status.includes('failed') || status.includes('rto'));

          // Determine if we should count this order's financials
          // In "Completed Day", every order is either Delivered (Revenue + COGS + Ship) or Failed (0 Rev + NDR + Ship).

          if (isDelivered) {
            deliveredCount++;
            totalRevenue += order.totalPrice || 0;

            // COGS
            const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
            let orderCOGS = 0;
            cogsFields.filter(f => f.type === 'cogs' || f.type === 'both').forEach(field => {
              let value = field[key] as number || 0;
              if (field.calculationType === 'fixed') {
                orderCOGS += value;
              } else {
                const salePrice = order.totalPrice || 0;
                const pct = field.percentageType || 'excluded';
                orderCOGS += pct === 'included' ? (value / (100 + value)) * salePrice : (value / 100) * salePrice;
              }
            });
            totalCOGS += orderCOGS;

          } else if (isFailed) {
            failedCount++;
            // NDR Costs
            const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
            let orderNDR = 0;
            cogsFields.filter(f => f.type === 'ndr' || f.type === 'both').forEach(field => {
              let value = field[key] as number || 0;
              if (field.calculationType === 'fixed') {
                orderNDR += value;
              } else {
                const salePrice = order.totalPrice || 0;
                const pct = field.percentageType || 'excluded';
                orderNDR += pct === 'included' ? (value / (100 + value)) * salePrice : (value / 100) * salePrice;
              }
            });
            totalCOGS += orderNDR;
          }

          if (order.shippingCharge) {
            totalShipping += order.shippingCharge;
          }
        });
      }
    });

    const totalOrders = deliveredCount + failedCount;
    const avgRevenue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const avgCOGS = totalOrders > 0 ? totalCOGS / totalOrders : 0;
    const avgShipping = totalOrders > 0 ? totalShipping / totalOrders : 0;
    const avgTotalCost = avgCOGS + avgShipping;
    const contributionMargin = avgRevenue - avgTotalCost;

    const breakevenROAS = contributionMargin > 0 ? avgRevenue / contributionMargin : 0;

    return {
      aov: avgRevenue,
      avgCOGS,
      avgShipping,
      avgTotalCost,
      contributionMargin,
      breakevenROAS,
      deliveredCount,
      failedCount,
      totalOrders,
      completedDaysCount,
      completedDates
    };
  })();

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
        { name: 'Prepaid', value: prepaidCount, color: '#10b981' },
        { name: 'COD', value: codCount, color: '#f59e0b' },
      ],
      deliveryStatus: [
        { name: 'Delivered', value: deliveredCount, color: '#10b981' },
        { name: 'Out for Delivery', value: outForDeliveryCount, color: '#eab308' },
        { name: 'Attempted Delivery', value: attemptedDeliveryCount, color: '#f97316' },
        { name: 'In Transit', value: inTransitCount, color: '#3b82f6' },
        { name: 'Confirmed', value: confirmedCount, color: '#64748b' },
        { name: 'Failed', value: failedCount, color: '#ef4444' },
      ].filter(item => item.value > 0),
      codTotal: codDeliveredCount + codFailedCount,
      codStatus: [
        { name: 'Delivered', value: codDeliveredCount, color: '#10b981' },
        { name: 'Failed', value: codFailedCount, color: '#ef4444' },
      ].filter(item => item.value > 0),
      totalOrders: prepaidCount + codCount,
    };
  })();



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

  const handleLegendClick = (data: any) => {
    // Determine filter type and value based on clicked item
    // Data can be from Legend (has value or id) or Pie Sector (has name)
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
      <div className={styles['dashboard-loading']}>
        <div className={styles.spinner}></div>
      </div>
    );
  }

  return (
    <>
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
        <div className={styles['roas-header']}>
          <div>
            <h2 className={styles['section-title']}>
              ROAS —{' '}
              {roasStartDate && roasEndDate
                ? `${new Date(roasStartDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(roasEndDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                : `Last ${roasDays} Days`}
            </h2>
            <p className={styles['section-desc']}>
              Return on Ad Spend (ROAS) = Total Revenue ÷ Ad Spend for each day. Higher is better.
            </p>
          </div>
          <div className={styles['roas-controls']}>
            <div className={styles['roas-control-group']}>
              <label className={styles['roas-control-label']}>Last N days</label>
              <input
                ref={roasDaysRef}
                type="number"
                min={1}
                max={365}
                className={styles['roas-days-input']}
                defaultValue={30}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const days = Math.max(1, Number(roasDaysRef.current?.value) || 30);
                    setRoasDays(days);
                    setRoasStartDate('');
                    setRoasEndDate('');
                    if (roasStartRef.current) roasStartRef.current.value = '';
                    if (roasEndRef.current) roasEndRef.current.value = '';
                    loadROAS(days, '', '');
                  }
                }}
              />
            </div>
            <span className={styles['roas-divider']}>or</span>
            <div className={styles['roas-control-group']}>
              <label className={styles['roas-control-label']}>From</label>
              <input
                ref={roasStartRef}
                type="date"
                className={styles['roas-date-input']}
                defaultValue=""
              />
            </div>
            <div className={styles['roas-control-group']}>
              <label className={styles['roas-control-label']}>To</label>
              <input
                ref={roasEndRef}
                type="date"
                className={styles['roas-date-input']}
                defaultValue=""
              />
            </div>
            <button
              className={styles['roas-go-btn']}
              onClick={() => {
                const start = roasStartRef.current?.value || '';
                const end = roasEndRef.current?.value || '';
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
              Go
            </button>
            {(roasStartDate || roasEndDate) && (
              <button
                className={styles['roas-clear-btn']}
                onClick={() => {
                  setRoasStartDate('');
                  setRoasEndDate('');
                  if (roasStartRef.current) roasStartRef.current.value = '';
                  if (roasEndRef.current) roasEndRef.current.value = '';
                  loadROAS(roasDays, '', '');
                }}
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <div className={styles.chartWrap}>
          {roasLoading ? (
            <div className={styles['roas-skeleton']} />
          ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={roasChartData}
              margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-axis)' }}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v) => v.toFixed(1)}
                domain={[0, 'auto']}
              />
              <Tooltip
                contentStyle={{
                  border: 'none',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '10px 14px',
                }}
                labelStyle={{ color: 'var(--chart-muted)', fontWeight: 500, marginBottom: 4 }}
                formatter={(value, name, props) => {
                  if (name === 'ROAS') {
                    const payload = props.payload;
                    return [
                      <>
                        <div style={{ marginBottom: 4 }}>
                          <strong>ROAS: {value !== null ? Number(value).toFixed(2) : 'N/A'}</strong>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--chart-muted)' }}>
                          Revenue: ₹{payload.revenue?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--chart-muted)' }}>
                          Ad Spend: ₹{payload.adSpend?.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </>,
                      ''
                    ];
                  }
                  return [value, name];
                }}
              />
              <Legend
                wrapperStyle={{ paddingTop: 12 }}
                iconType="line"
                iconSize={10}
                formatter={(value) => <span className={styles.chartLegendText}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey="roas"
                name="ROAS"
                stroke="#8b5cf6"
                strokeWidth={2.5}
                dot={(props: any) => {
                  const { cx, cy, payload } = props;
                  const date = new Date(payload.dateKey);
                  const todayIdx = new Date().getDay();
                  const isMatchingDay = date.getDay() === todayIdx;
                  
                  if (isMatchingDay) {
                    return (
                      <g key={payload.dateKey}>
                        <circle cx={cx} cy={cy} r={5} fill="#8b5cf6" stroke="#fff" strokeWidth={2} />
                        <text 
                          x={cx} 
                          y={cy - 12} 
                          textAnchor="middle" 
                          fontSize={10} 
                          fontWeight="700" 
                          fill="#7c3aed"
                        >
                          {payload.roas !== null ? payload.roas.toFixed(1) : ''}
                        </text>
                      </g>
                    );
                  }
                  return null as any;
                }}
                activeDot={{ r: 6, strokeWidth: 0, fill: '#8b5cf6' }}
                connectNulls
              />
              {breakevenMetrics.breakevenROAS > 0 && (
                <ReferenceLine
                  y={breakevenMetrics.breakevenROAS}
                  stroke="#dc2626"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{
                    value: `Breakeven: ${breakevenMetrics.breakevenROAS.toFixed(2)}`,
                    position: 'insideTopRight',
                    fill: '#dc2626',
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
          )}
        </div>
        <div className={styles.chartStats}>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Completed Days Average ROAS</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              {(() => {
                const completedDates = breakevenMetrics.completedDates;
                const validRoas = roasChartData.filter(d => completedDates.has(d.dateKey) && d.roas !== null && d.roas > 0);
                if (validRoas.length === 0) return 'N/A';
                const avgRoas = validRoas.reduce((sum, d) => sum + (d.roas || 0), 0) / validRoas.length;
                return avgRoas.toFixed(2);
              })()}
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Breakeven ROAS</span>
            <span
              className={styles.chartStatValue}
              style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                color: breakevenMetrics.breakevenROAS > 0 ? '#dc2626' : 'inherit'
              }}
              title={`AOV: ₹${breakevenMetrics.aov.toFixed(0)} | COGS: ₹${breakevenMetrics.avgCOGS.toFixed(0)} | Shipping: ₹${breakevenMetrics.avgShipping.toFixed(0)}`}
            >
              {breakevenMetrics.breakevenROAS > 0 ? breakevenMetrics.breakevenROAS.toFixed(2) : 'N/A'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>
              ROAS must be above this to profit
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>{new Date().toLocaleDateString('en-IN', { weekday: 'long' })} Average ROAS</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600, color: '#7c3aed' }}>
              {(() => {
                const todayIdx = new Date().getDay();
                const matchingDays = roasChartData.filter(d => {
                  const date = new Date(d.dateKey);
                  return date.getDay() === todayIdx && d.roas !== null && d.roas > 0;
                });
                if (matchingDays.length === 0) return 'N/A';
                const avgRoas = matchingDays.reduce((sum, d) => sum + (d.roas || 0), 0) / matchingDays.length;
                return avgRoas.toFixed(2);
              })()}
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Completed Total Revenue</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              ₹{roasChartData.filter(d => breakevenMetrics.completedDates.has(d.dateKey)).reduce((sum, d) => sum + d.revenue, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Completed Total Ad Spend</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              ₹{roasChartData.filter(d => breakevenMetrics.completedDates.has(d.dateKey)).reduce((sum, d) => sum + d.adSpend, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        {/* Breakeven Analysis */}
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'var(--tile-empty)',
          borderRadius: '8px',
          fontSize: '0.875rem',
          color: 'var(--chart-muted)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: '#1f2937' }}>
            Breakeven Analysis (based on {breakevenMetrics.completedDaysCount} completed days in view):
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
            <div>
              <strong>Avg Revenue per Order:</strong> ₹{breakevenMetrics.aov.toFixed(2)}
              <div style={{ fontSize: '0.75rem', color: 'var(--chart-muted)' }}>
                (Includes ₹0 from failed orders)
              </div>
            </div>
            <div>
              <strong>Avg COGS per Order:</strong> ₹{breakevenMetrics.avgCOGS.toFixed(2)}
              <div style={{ fontSize: '0.75rem', color: 'var(--chart-muted)' }}>
                (Delivered: COGS, Failed: NDR)
              </div>
            </div>
            <div>
              <strong>Avg Shipping per Order:</strong> ₹{breakevenMetrics.avgShipping.toFixed(2)}
            </div>
            <div>
              <strong>Contribution Margin:</strong> ₹{breakevenMetrics.contributionMargin.toFixed(2)}
              <div style={{ fontSize: '0.75rem', color: 'var(--chart-muted)' }}>
                (Revenue - COGS - Shipping)
              </div>
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', fontStyle: 'italic' }}>
            Formula: Breakeven ROAS = Avg Revenue ÷ Contribution Margin. Based on fully completed days to avoid bias from pending orders.
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 className={styles['section-title']} style={{ marginBottom: '0.25rem', marginTop: 0 }}>
              Profit & Loss — {monthNames[selectedMonth]} {selectedYear}
            </h2>
            <p className={styles['section-desc']} style={{ marginBottom: 0 }}>
              Shows booked profit for completed days only (all orders delivered/failed). Incomplete days are left empty. Green = profit, Red = loss.
            </p>
          </div>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
            className={styles.select}
            style={{ width: 'auto' }}
          >
            {monthNames.map((month, index) => (
              <option key={index} value={index}>
                {month}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={profitChartData}
              margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
              barGap={1}
              barCategoryGap="15%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-axis)' }}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={false}
                width={50}
                tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v >= -1000 ? v : `${(v / 1000).toFixed(0)}k`}`}
              />
              <Tooltip
                contentStyle={{
                  border: 'none',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '10px 14px',
                }}
                labelStyle={{ color: 'var(--chart-muted)', fontWeight: 500, marginBottom: 4 }}
                formatter={(value, name) => [
                  `${Number(value) >= 0 ? '+' : ''}₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
                  name
                ]}
              />
              <Legend
                wrapperStyle={{ paddingTop: 12 }}
                iconType="rect"
                iconSize={10}
                formatter={(value) => <span className={styles.chartLegendText}>{value}</span>}
              />
              <ReferenceLine
                y={0}
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="3 3"
              />
              <Bar
                dataKey="bookedProfit"
                name="Booked Profit"
                maxBarSize={24}
                radius={[2, 2, 2, 2]}
              >
                {profitChartData.map((entry, index) => (
                  <Cell
                    key={`cell-booked-${index}`}
                    fill={entry.bookedProfit >= 0 ? '#10b981' : '#ef4444'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.chartStats}>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Booked Profit (this month)</span>
            <span
              className={styles.chartStatValue}
              style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                color: profitChartData.filter(d => d.bookedProfit !== null).reduce((sum, d) => sum + (d.bookedProfit || 0), 0) >= 0 ? '#10b981' : '#ef4444'
              }}
            >
              {profitChartData.filter(d => d.bookedProfit !== null).reduce((sum, d) => sum + (d.bookedProfit || 0), 0) >= 0 ? '+' : ''}₹{profitChartData.filter(d => d.bookedProfit !== null).reduce((sum, d) => sum + (d.bookedProfit || 0), 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>
              From completed days only
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Completed Days</span>
            <span
              className={styles.chartStatValue}
              style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                color: '#6366f1'
              }}
            >
              {profitChartData.filter(d => d.bookedProfit !== null).length}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>
              All orders delivered/failed
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Incomplete Days</span>
            <span
              className={styles.chartStatValue}
              style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                color: '#94a3b8'
              }}
            >
              {profitChartData.filter(d => d.bookedProfit === null).length}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>
              With in-transit orders
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Order Distribution — Last 30 Days</h2>
        <p className={styles['section-desc']}>
          Breakdown of orders by payment method and delivery status (from Jan 28, 2026 onwards).
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginTop: '1rem' }}>
          {/* Chart 1: Prepaid vs COD */}
          <div className={styles.chartWrap} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#374151' }}>Payment Method</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieChartsData.paymentMethod}
                  cx="50%"
                  cy={110}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  onClick={handleLegendClick}
                  style={{ cursor: 'pointer' }}
                >
                  {pieChartsData.paymentMethod.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} style={{ outline: 'none' }} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  height={36}
                  iconType="circle"
                  onClick={handleLegendClick}
                  wrapperStyle={{ cursor: 'pointer' }}
                  formatter={(value, entry: any) => {
                    const { payload } = entry;
                    return <span className={styles.chartLegendText}>{value}: {payload.value} ({((payload.value / (pieChartsData.totalOrders || 1)) * 100).toFixed(0)}%)</span>;
                  }}
                />
                <text x="50%" y={110} textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {(() => {
                    const cod = pieChartsData.paymentMethod.find(i => i.name === 'COD')?.value || 0;
                    const total = pieChartsData.totalOrders || 1;
                    const pct = ((cod / total) * 100).toFixed(0);
                    return (
                      <>
                        <tspan x="50%" dy="-10" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>COD</tspan>
                        <tspan x="50%" dy="22" style={{ fontSize: '16px', fill: '#0f172a', fontWeight: 700 }}>{cod} ({pct}%)</tspan>
                      </>
                    );
                  })()}
                </text>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 2: Delivered vs Failed */}
          <div className={styles.chartWrap} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#374151' }}>Overall Delivery Status</h3>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={pieChartsData.deliveryStatus}
                  cx="50%"
                  cy={110}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  onClick={handleLegendClick}
                  style={{ cursor: 'pointer' }}
                >
                  {pieChartsData.deliveryStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} style={{ outline: 'none' }} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  height={80}
                  iconType="circle"
                  onClick={handleLegendClick}
                  wrapperStyle={{ cursor: 'pointer' }}
                  formatter={(value, entry: any) => {
                    const { payload } = entry;
                    const total = pieChartsData.deliveryStatus.reduce((acc: number, curr: any) => acc + curr.value, 0);
                    const percentage = total > 0 ? ((payload.value / total) * 100).toFixed(0) : 0;
                    return <span className={styles.chartLegendText}>{value}: {payload.value} ({percentage}%)</span>;
                  }}
                />
                <text x="50%" y={110} textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {(() => {
                    const failed = pieChartsData.deliveryStatus.find(i => i.name === 'Failed')?.value || 0;
                    const total = pieChartsData.deliveryStatus.reduce((a, b: any) => a + b.value, 0) || 1;
                    const pct = ((failed / total) * 100).toFixed(0);
                    return (
                      <>
                        <tspan x="50%" dy="-10" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FAILED</tspan>
                        <tspan x="50%" dy="22" style={{ fontSize: '16px', fill: '#0f172a', fontWeight: 700 }}>{failed} ({pct}%)</tspan>
                      </>
                    );
                  })()}
                </text>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Chart 3: COD Status */}
          <div className={styles.chartWrap} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '1rem', color: '#374151' }}>COD Delivery Status</h3>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={pieChartsData.codStatus}
                  cx="50%"
                  cy={110}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  onClick={handleLegendClick}
                  style={{ cursor: 'pointer' }}
                >
                  {pieChartsData.codStatus.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} style={{ outline: 'none' }} />
                  ))}
                </Pie>
                <Legend
                  verticalAlign="bottom"
                  height={80}
                  iconType="circle"
                  onClick={handleLegendClick}
                  wrapperStyle={{ cursor: 'pointer' }}
                  formatter={(value, entry: any) => {
                    const { payload } = entry;
                    if (payload.name === 'In Progress') return null;
                    const total = pieChartsData.codTotal || 1;
                    const percentage = ((payload.value / total) * 100).toFixed(0);
                    return <span className={styles.chartLegendText}>{value}: {payload.value} ({percentage}%)</span>;
                  }}
                />
                <text x="50%" y={110} textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {(() => {
                    const failed = pieChartsData.codStatus.find(i => i.name === 'Failed')?.value || 0;
                    const total = pieChartsData.codTotal || 1;
                    const pct = ((failed / total) * 100).toFixed(0);
                    return (
                      <>
                        <tspan x="50%" dy="-10" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FAILED</tspan>
                        <tspan x="50%" dy="22" style={{ fontSize: '16px', fill: '#0f172a', fontWeight: 700 }}>{failed} ({pct}%)</tspan>
                      </>
                    );
                  })()}
                </text>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>


      {/* ─── Avg Shipping Charge on Fulfilled Orders ─── */}
      {(() => {
        type DbRecord = { dateKey: string; avgShipping: number | null; avgShippingSmall: number | null; avgShippingLarge: number | null };
        type ChartPoint = { date: string; dateKey?: string; avgShipping: number | null; avgShippingSmall: number | null; avgShippingLarge: number | null };

        const avgOfNums = (arr: (number | null)[]): number | null => {
          const valid = arr.filter((v): v is number => v !== null && v > 0);
          return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
        };

        // Filter to 30-point lookback window
        const now = new Date();
        const todayKey = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        const windowStart = new Date(now);
        if (shippingGranularity === 'day') windowStart.setDate(windowStart.getDate() - 29);
        else if (shippingGranularity === 'week') windowStart.setDate(windowStart.getDate() - 29 * 7);
        else { windowStart.setMonth(windowStart.getMonth() - 29); windowStart.setDate(1); }
        const cutoffKey = '2026-01-01';
        const windowKey = windowStart.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        const effectiveStartKey = cutoffKey > windowKey ? cutoffKey : windowKey;

        const windowedRecords = shippingDbRecords.filter(
          (r) => r.dateKey >= effectiveStartKey && r.dateKey <= todayKey
        );

        const toLabel = (dateKey: string) =>
          new Date(dateKey).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: STORE_TIMEZONE });

        let shippingData: ChartPoint[];

        if (shippingGranularity === 'day') {
          // 7-day centred rolling average
          const rollingAvg = (arr: (number | null)[], i: number, half = 3): number | null => {
            const win = arr.slice(Math.max(0, i - half), i + half + 1).filter((v): v is number => v !== null);
            return win.length ? win.reduce((s, v) => s + v, 0) / win.length : null;
          };
          const allVal   = windowedRecords.map((r) => r.avgShipping);
          const smallVal = windowedRecords.map((r) => r.avgShippingSmall);
          const largeVal = windowedRecords.map((r) => r.avgShippingLarge);
          shippingData = windowedRecords.map((r, i) => ({
            date: toLabel(r.dateKey),
            dateKey: r.dateKey,
            avgShipping:      rollingAvg(allVal,   i),
            avgShippingSmall: rollingAvg(smallVal, i),
            avgShippingLarge: rollingAvg(largeVal, i),
          }));
        } else if (shippingGranularity === 'week') {
          const weeks: DbRecord[][] = [];
          let cur: DbRecord[] = [];
          windowedRecords.forEach((r) => {
            const dow = new Date(r.dateKey).getDay();
            if (dow === 1 && cur.length > 0) { weeks.push(cur); cur = []; }
            cur.push(r);
          });
          if (cur.length) weeks.push(cur);
          shippingData = weeks.map((g) => ({
            date: `${toLabel(g[0].dateKey)} – ${toLabel(g[g.length - 1].dateKey)}`,
            avgShipping:      avgOfNums(g.map((r) => r.avgShipping)),
            avgShippingSmall: avgOfNums(g.map((r) => r.avgShippingSmall)),
            avgShippingLarge: avgOfNums(g.map((r) => r.avgShippingLarge)),
          }));
        } else {
          const months: Record<string, DbRecord[]> = {};
          windowedRecords.forEach((r) => {
            const key = r.dateKey.slice(0, 7);
            if (!months[key]) months[key] = [];
            months[key].push(r);
          });
          shippingData = Object.entries(months).map(([, g]) => ({
            date: new Date(g[0].dateKey).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: STORE_TIMEZONE }),
            avgShipping:      avgOfNums(g.map((r) => r.avgShipping)),
            avgShippingSmall: avgOfNums(g.map((r) => r.avgShippingSmall)),
            avgShippingLarge: avgOfNums(g.map((r) => r.avgShippingLarge)),
          }));
        }

        // Summary stats over last-30-day daily records
        const last30 = shippingDbRecords.filter((r) => {
          const s = new Date(now); s.setDate(s.getDate() - 29);
          return r.dateKey >= s.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        });
        const fmt = (v: number | null) => v !== null ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'N/A';
        const avg30All   = avgOfNums(last30.map((r) => r.avgShipping));
        const avg30Small = avgOfNums(last30.map((r) => r.avgShippingSmall));
        const avg30Large = avgOfNums(last30.map((r) => r.avgShippingLarge));

        const lines = [
          { key: 'all'   as const, dataKey: 'avgShipping',      name: 'All Fulfilled', color: '#0ea5e9', width: 2.5, dash: undefined },
          { key: 'small' as const, dataKey: 'avgShippingSmall', name: 'Small Variant', color: '#10b981', width: 2,   dash: '6 3' },
          { key: 'large' as const, dataKey: 'avgShippingLarge', name: 'Large Variant', color: '#f59e0b', width: 2,   dash: '6 3' },
        ];

        const toggleLine = (key: 'all' | 'small' | 'large') =>
          setActiveShippingLines((prev) => ({ ...prev, [key]: !prev[key] }));

        const shippingAvgKey = activeShippingLines.all ? 'avgShipping' : activeShippingLines.small ? 'avgShippingSmall' : 'avgShippingLarge';
        const shippingAvgValues = shippingData.map((d) => (d as any)[shippingAvgKey]).filter((v: unknown): v is number => v !== null && v !== undefined);
        const shippingAvg = shippingAvgValues.length ? shippingAvgValues.reduce((s: number, v: number) => s + v, 0) / shippingAvgValues.length : null;

        const shippingValues = shippingData.flatMap((d) => [
          activeShippingLines.all   ? (d.avgShipping      ?? null) : null,
          activeShippingLines.small ? (d.avgShippingSmall ?? null) : null,
          activeShippingLines.large ? (d.avgShippingLarge ?? null) : null,
        ]).filter((v): v is number => v !== null);
        const shippingTickMin = shippingValues.length ? Math.floor(Math.min(...shippingValues) / 30) * 30 : 0;
        const shippingTickMax = shippingValues.length ? Math.ceil(Math.max(...shippingValues)  / 30) * 30 : 120;
        const shippingTicks: number[] = [];
        for (let t = shippingTickMin; t <= shippingTickMax; t += 30) shippingTicks.push(t);

        const granularityBtns: { label: string; value: 'day' | 'week' | 'month' }[] = [
          { label: 'Day',   value: 'day'   },
          { label: 'Week',  value: 'week'  },
          { label: 'Month', value: 'month' },
        ];

        const btnBase: React.CSSProperties = {
          padding: '4px 12px', fontSize: '0.8rem', fontWeight: 500, borderRadius: 6,
          border: '1px solid #e2e8f0', cursor: 'pointer', transition: 'all 0.15s',
        };

        return (
          <section className={styles.section}>
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <div>
                <h2 className={styles['section-title']} style={{ margin: 0 }}>Avg Shipping Charge on Fulfilled Orders</h2>
                <p className={styles['section-desc']} style={{ marginBottom: 0, marginTop: '0.25rem' }}>
                  Average Shiprocket shipping charge, split by variant size.
                  Orders with both Small &amp; Large items appear only in the overall line.
                </p>
              </div>

              {/* Controls: granularity + line toggles */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                {/* Granularity */}
                <div style={{ display: 'flex', gap: '2px', background: '#f1f5f9', borderRadius: 8, padding: '3px' }}>
                  {granularityBtns.map(({ label, value }) => (
                    <button
                      key={value}
                      style={{
                        ...btnBase,
                        border: 'none',
                        background: shippingGranularity === value ? 'white' : 'transparent',
                        boxShadow: shippingGranularity === value ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
                        color: shippingGranularity === value ? '#0f172a' : '#64748b',
                      }}
                      onClick={() => setShippingGranularity(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Line toggles */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  {lines.map(({ key, name, color }) => (
                    <button
                      key={key}
                      onClick={() => toggleLine(key)}
                      style={{
                        ...btnBase,
                        background: activeShippingLines[key] ? color : 'transparent',
                        borderColor: color,
                        color: activeShippingLines[key] ? 'white' : color,
                        opacity: activeShippingLines[key] ? 1 : 0.6,
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={shippingData} margin={{ top: 12, right: 20, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--chart-axis)' }}
                    interval="preserveStartEnd"
                    minTickGap={30}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                    ticks={shippingTicks}
                    domain={[shippingTickMin, shippingTickMax]}

                  />
                  <Tooltip
                    contentStyle={{ border: 'none', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: '10px 14px' }}
                    labelStyle={{ color: 'var(--chart-muted)', fontWeight: 500, marginBottom: 4 }}
                    formatter={(value, name) => [
                      value !== null && value !== undefined
                        ? `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
                        : 'N/A',
                      name,
                    ]}
                  />
                  {lines.map(({ key, dataKey, name, color, width, dash }) =>
                    activeShippingLines[key] ? (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={dataKey}
                        name={name}
                        stroke={color}
                        strokeWidth={width}
                        strokeDasharray={dash}
                        dot={false}
                        activeDot={{ r: 5, strokeWidth: 0, fill: color }}
                        connectNulls={false}
                      />
                    ) : null
                  )}
                  {shippingAvg !== null && (
                    <ReferenceLine
                      y={shippingAvg}
                      stroke="#94a3b8"
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{ value: `Avg ₹${shippingAvg.toFixed(0)}`, position: 'insideTopRight', fontSize: 11, fill: '#94a3b8', dy: -6 }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Summary stats */}
            <div className={styles.chartStats}>
              <div className={styles.chartStatBlock}>
                <span className={styles.chartStatLabel} style={{ color: '#0ea5e9' }}>All Fulfilled — 30-day Avg</span>
                <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600, color: '#0ea5e9' }}>{fmt(avg30All)}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>Avg across all fulfilled orders</span>
              </div>
              <div className={styles.chartStatBlock}>
                <span className={styles.chartStatLabel} style={{ color: '#10b981' }}>Small Variant — 30-day Avg</span>
                <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600, color: '#10b981' }}>{fmt(avg30Small)}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>Pure small orders only (no large items)</span>
              </div>
              <div className={styles.chartStatBlock}>
                <span className={styles.chartStatLabel} style={{ color: '#f59e0b' }}>Large Variant — 30-day Avg</span>
                <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f59e0b' }}>{fmt(avg30Large)}</span>
                <span style={{ fontSize: '0.7rem', color: 'var(--chart-muted)', marginTop: '4px', display: 'block' }}>Pure large orders only (no small items)</span>
              </div>
            </div>
          </section>
        );
      })()}


      <section className={styles.section}>
        <h2 className={styles['section-title']}>Daily Profit &amp; Loss — {selectedYear}</h2>

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

      {/* Sales Modal */}
      {salesModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setSalesModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.modalCloseBtn} onClick={() => setSalesModalOpen(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <div className={styles.modalBody}>
              <SalesPage initialFilter={salesModalFilter} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
