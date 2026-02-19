import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
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
        api.getOrders(1000, true, '2026-01-28'),
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

  // Today vs same day last week: order counts by hour (store timezone)
  const orderCountChartData = (() => {
    const now = new Date();
    const todayDateKey = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
    const lastWeekSameDay = new Date(now);
    lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);
    const lastWeekDateKey = lastWeekSameDay.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });

    const todayByHour = new Array(24).fill(0);
    const lastWeekByHour = new Array(24).fill(0);

    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const { dateKey, hour } = getOrderDateAndHour(o.createdAt);
      if (dateKey === todayDateKey && hour >= 0 && hour < 24) todayByHour[hour]++;
      if (dateKey === lastWeekDateKey && hour >= 0 && hour < 24) lastWeekByHour[hour]++;
    });

    // Cumulative counts up to each hour
    const todayCumul: number[] = [];
    const lastWeekCumul: number[] = [];
    let t = 0;
    let l = 0;
    for (let h = 0; h < 24; h++) {
      t += todayByHour[h];
      l += lastWeekByHour[h];
      todayCumul.push(t);
      lastWeekCumul.push(l);
    }

    const currentHour = Number(
      now.toLocaleString('en-US', { timeZone: STORE_TIMEZONE, hour: 'numeric', hour12: false })
    );
    const currentHourClamped = Math.min(23, Math.max(0, Number.isNaN(currentHour) ? 0 : currentHour));

    const dayLabel = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: STORE_TIMEZONE });
    const chartData = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`,
      today: h <= currentHourClamped ? todayCumul[h] : null,
      lastWeek: lastWeekCumul[h],
    }));

    return {
      chartData,
      dayLabel,
      todayDateKey,
      lastWeekDateKey,
      currentHourClamped,
    };
  })();

  // Revenue by hour (same two days) and summary stats
  const revenueChartData = (() => {
    const now = new Date();
    const todayDateKey = now.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
    const lastWeekSameDay = new Date(now);
    lastWeekSameDay.setDate(lastWeekSameDay.getDate() - 7);
    const lastWeekDateKey = lastWeekSameDay.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
    const currentHour = Number(
      now.toLocaleString('en-US', { timeZone: STORE_TIMEZONE, hour: 'numeric', hour12: false })
    );
    const currentHourClamped = Math.min(23, Math.max(0, Number.isNaN(currentHour) ? 0 : currentHour));

    const todayRevenueByHour = new Array(24).fill(0);
    const lastWeekRevenueByHour = new Array(24).fill(0);
    let totalRevenueToday = 0;
    let totalRevenueLastWeek = 0;

    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const { dateKey, hour } = getOrderDateAndHour(o.createdAt);
      const amount = o.totalPrice ?? 0;
      if (dateKey === todayDateKey && hour >= 0 && hour < 24) {
        todayRevenueByHour[hour] += amount;
        totalRevenueToday += amount;
      }
      if (dateKey === lastWeekDateKey && hour >= 0 && hour < 24) {
        lastWeekRevenueByHour[hour] += amount;
        totalRevenueLastWeek += amount;
      }
    });

    let t = 0;
    let l = 0;
    const todayCumul: number[] = [];
    const lastWeekCumul: number[] = [];
    for (let h = 0; h < 24; h++) {
      t += todayRevenueByHour[h];
      l += lastWeekRevenueByHour[h];
      todayCumul.push(t);
      lastWeekCumul.push(l);
    }

    const dayLabel = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: STORE_TIMEZONE });
    const chartData = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: h === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`,
      today: h <= currentHourClamped ? todayCumul[h] : null,
      lastWeek: lastWeekCumul[h],
    }));

    return {
      chartData,
      dayLabel,
      totalRevenueToday,
      totalRevenueLastWeek,
    };
  })();

  const todayDateKey = orderCountChartData.todayDateKey;
  const lastWeekDateKey = orderCountChartData.lastWeekDateKey;
  const adSpendToday = adSpendByDate[todayDateKey] ?? 0;
  const adSpendLastWeek = adSpendByDate[lastWeekDateKey] ?? 0;

  // ROAS (Return on Ad Spend) for last 30 days
  const roasChartData = (() => {
    const now = new Date();
    const data: Array<{ date: string; dateKey: string; roas: number | null; revenue: number; adSpend: number; profit: number }> = [];

    // Build daily revenue from orders
    const revenueByDate: Record<string, number> = {};
    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const dateKey = getOrderDateKey(o.createdAt);
      revenueByDate[dateKey] = (revenueByDate[dateKey] || 0) + (o.totalPrice || 0);
    });

    // Build daily profit from dailyPnlMap (which already includes all costs)
    const profitByDate: Record<string, number> = dailyPnlMap;

    // Generate last 30 days
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
      const revenue = revenueByDate[dateKey] || 0;
      const adSpend = adSpendByDate[dateKey] || 0;
      const profit = profitByDate[dateKey] || 0;
      const roas = adSpend > 0 ? revenue / adSpend : null;

      data.push({
        date: date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: STORE_TIMEZONE }),
        dateKey,
        roas,
        revenue,
        adSpend,
        profit,
      });
    }

    return data;
  })();

  // Profit Chart Data - Show Current Month Only
  const profitChartData = (() => {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1); // 1st of current month
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Last day of current month

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

    // Calculate average costs per order from delivered AND failed orders
    let totalRevenue = 0;
    let totalCOGS = 0;
    let totalShipping = 0;
    let deliveredCount = 0;
    let failedCount = 0;

    orders.forEach((order) => {
      if (order.cancelledAt) return;

      const variant = detectVariant(order);
      const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
      const status = order.deliveryStatus?.toLowerCase() || '';

      const isDelivered = status === 'delivered' ||
        (paymentMethod === 'prepaid' && !rtoOrderIds.has(order.id));
      const isFailed = rtoOrderIds.has(order.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');

      // Only count delivered or failed orders for breakeven calculation
      if (!isDelivered && !isFailed) return;

      if (isDelivered) {
        deliveredCount++;
        totalRevenue += order.totalPrice || 0;

        // Calculate COGS from configuration (delivered = COGS type)
        const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
        let orderCOGS = 0;

        const fieldsToUse = cogsFields.filter(f => f.type === 'cogs' || f.type === 'both');
        fieldsToUse.forEach((field) => {
          let value = field[key] as number;
          if (value === undefined || value === null) value = 0;

          if (field.calculationType === 'fixed') {
            orderCOGS += value;
          } else {
            const salePrice = order.totalPrice || 0;
            const pct = field.percentageType || 'excluded';
            orderCOGS += pct === 'included'
              ? (value / (100 + value)) * salePrice
              : (value / 100) * salePrice;
          }
        });

        totalCOGS += orderCOGS;
      } else if (isFailed) {
        failedCount++;
        // Failed orders: no revenue, but have NDR costs

        const key = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
        let orderNDRCost = 0;

        const fieldsToUse = cogsFields.filter(f => f.type === 'ndr' || f.type === 'both');
        fieldsToUse.forEach((field) => {
          let value = field[key] as number;
          if (value === undefined || value === null) value = 0;

          if (field.calculationType === 'fixed') {
            orderNDRCost += value;
          } else {
            // For NDR, percentage is typically 0 or based on original sale price
            const salePrice = order.totalPrice || 0;
            const pct = field.percentageType || 'excluded';
            orderNDRCost += pct === 'included'
              ? (value / (100 + value)) * salePrice
              : (value / 100) * salePrice;
          }
        });

        totalCOGS += orderNDRCost;
      }

      // Add shipping cost for both delivered and failed
      if (order.shippingCharge) {
        totalShipping += order.shippingCharge;
      }
    });

    const totalOrders = deliveredCount + failedCount;
    const avgRevenue = totalOrders > 0 ? totalRevenue / totalOrders : 0; // Avg revenue per order (including failed)
    const avgCOGS = totalOrders > 0 ? totalCOGS / totalOrders : 0;
    const avgShipping = totalOrders > 0 ? totalShipping / totalOrders : 0;
    const avgTotalCost = avgCOGS + avgShipping;
    const contributionMargin = avgRevenue - avgTotalCost;

    // Breakeven ROAS = AOV / Contribution Margin
    // Since failed orders reduce avg revenue but add costs, this gives realistic breakeven
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
    };
  })();

  // Pie Charts data (Last 30 days, not before Jan 28, 2026)
  const pieChartsData = (() => {
    const now = new Date();
    const startDate = new Date('2026-01-28');
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const effectiveStartDate = startDate > thirtyDaysAgo ? startDate : thirtyDaysAgo;

    let prepaidCount = 0;
    let codCount = 0;

    let deliveredCount = 0;
    let failedCount = 0;
    let confirmedCount = 0;
    let inTransitCount = 0;
    let outForDeliveryCount = 0;
    let attemptedDeliveryCount = 0;

    let codDeliveredCount = 0;
    let codFailedCount = 0;

    orders.forEach((order) => {
      if (order.cancelledAt) return;
      const orderDate = new Date(order.createdAt);
      if (orderDate < effectiveStartDate) return;

      const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
      const status = order.deliveryStatus?.toLowerCase() || '';
      const isFailed = rtoOrderIds.has(order.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');

      const isDelivered = status === 'delivered' ||
        (paymentMethod === 'prepaid' && !isFailed); // Prepaid are assumed delivered if not failed/RTO

      // Chart 1: Prepaid vs COD
      if (paymentMethod === 'prepaid') prepaidCount++;
      else codCount++;

      // Chart 2: Delivered vs Failed vs Granular Statuses
      if (isDelivered) {
        deliveredCount++;
      } else if (isFailed) {
        failedCount++;
      } else {
        if (status.includes('out for delivery')) {
          outForDeliveryCount++;
        } else if (status.includes('attempt')) {
          attemptedDeliveryCount++;
        } else if (status.includes('transit') || status.includes('shipped') || status.includes('picked')) {
          inTransitCount++;
        } else {
          confirmedCount++;
        }
      }

      // Chart 3: COD Delivered vs Failed (Final status only)
      if (paymentMethod === 'cod') {
        if (isDelivered) codDeliveredCount++;
        else if (isFailed) codFailedCount++;
      }
    });

    return {
      paymentMethod: [
        { name: 'Prepaid', value: prepaidCount, color: '#10b981' }, // Green
        { name: 'COD', value: codCount, color: '#f59e0b' },       // Amber
      ],
      deliveryStatus: [
        { name: 'Delivered', value: deliveredCount, color: '#10b981' }, // Green
        { name: 'Out for Delivery', value: outForDeliveryCount, color: '#eab308' }, // Yellow-500
        { name: 'Attempted Delivery', value: attemptedDeliveryCount, color: '#f97316' }, // Orange-500
        { name: 'In Transit', value: inTransitCount, color: '#3b82f6' }, // Blue
        { name: 'Confirmed', value: confirmedCount, color: '#64748b' }, // Slate
        { name: 'Failed', value: failedCount, color: '#ef4444' },     // Red
      ].filter(item => item.value > 0), // Filter out zero values to keep chart clean
      codStatus: [
        { name: 'Delivered', value: codDeliveredCount, color: '#10b981' },
        { name: 'Failed', value: codFailedCount, color: '#ef4444' },
      ],
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
        <h2 className={styles['section-title']}>Orders today vs last {orderCountChartData.dayLabel}</h2>
        <p className={styles['section-desc']}>
          Cumulative order count by hour (store time: {STORE_TIMEZONE}).
        </p>
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={orderCountChartData.chartData}
              margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-axis)' }}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip
                contentStyle={{
                  border: 'none',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '10px 14px',
                }}
                labelStyle={{ color: 'var(--chart-muted)', fontWeight: 500, marginBottom: 4 }}
              />
              <Legend
                wrapperStyle={{ paddingTop: 12 }}
                iconType="line"
                iconSize={10}
                formatter={(value) => <span className={styles.chartLegendText}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey="today"
                name="Today"
                stroke="var(--chart-today)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-today)' }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="lastWeek"
                name={`Last ${orderCountChartData.dayLabel}`}
                stroke="var(--chart-lastweek)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-lastweek)' }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className={styles.chartStats}>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Ad spend</span>
            <span className={styles.chartStatRow}>
              <span>Today</span>
              <span className={styles.chartStatValue}>₹{adSpendToday.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </span>
            <span className={styles.chartStatRow}>
              <span>Last {orderCountChartData.dayLabel}</span>
              <span className={styles.chartStatValue}>₹{adSpendLastWeek.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Revenue</span>
            <span className={styles.chartStatRow}>
              <span>Today</span>
              <span className={styles.chartStatValue}>₹{revenueChartData.totalRevenueToday.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </span>
            <span className={styles.chartStatRow}>
              <span>Last {revenueChartData.dayLabel}</span>
              <span className={styles.chartStatValue}>₹{revenueChartData.totalRevenueLastWeek.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </span>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Revenue today vs last {revenueChartData.dayLabel}</h2>
        <p className={styles['section-desc']}>
          Cumulative revenue by hour (store time: {STORE_TIMEZONE}). Solid = today, dotted = last {revenueChartData.dayLabel}.
        </p>
        <div className={styles.chartWrap}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={revenueChartData.chartData}
              margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--chart-axis)' }}
                interval={2}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--chart-muted)' }}
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
              />
              <Tooltip
                contentStyle={{
                  border: 'none',
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  padding: '10px 14px',
                }}
                labelStyle={{ color: 'var(--chart-muted)', fontWeight: 500, marginBottom: 4 }}
                formatter={(value, name) => [`₹${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`, name]}
              />
              <Legend
                wrapperStyle={{ paddingTop: 12 }}
                iconType="line"
                iconSize={10}
                formatter={(value) => <span className={styles.chartLegendText}>{value}</span>}
              />
              <Line
                type="monotone"
                dataKey="today"
                name="Today"
                stroke="var(--chart-today)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-today)' }}
                connectNulls={false}
              />
              <Line
                type="monotone"
                dataKey="lastWeek"
                name={`Last ${revenueChartData.dayLabel}`}
                stroke="var(--chart-lastweek)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-lastweek)' }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>ROAS — Last 30 Days</h2>
        <p className={styles['section-desc']}>
          Return on Ad Spend (ROAS) = Total Revenue ÷ Ad Spend for each day. Higher is better.
        </p>
        <div className={styles.chartWrap}>
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
                dot={false}
                activeDot={{ r: 5, strokeWidth: 0, fill: '#8b5cf6' }}
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
        </div>
        <div className={styles.chartStats}>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>30-Day Average ROAS</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              {(() => {
                const validRoas = roasChartData.filter(d => d.roas !== null && d.roas > 0);
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
            <span className={styles.chartStatLabel}>Total Revenue (30 days)</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              ₹{roasChartData.reduce((sum, d) => sum + d.revenue, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </span>
          </div>
          <div className={styles.chartStatBlock}>
            <span className={styles.chartStatLabel}>Total Ad Spend (30 days)</span>
            <span className={styles.chartStatValue} style={{ fontSize: '1.5rem', fontWeight: 600 }}>
              ₹{roasChartData.reduce((sum, d) => sum + d.adSpend, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
            Breakeven Analysis (based on {breakevenMetrics.totalOrders} orders: {breakevenMetrics.deliveredCount} delivered + {breakevenMetrics.failedCount} failed):
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
            Formula: Breakeven ROAS = Avg Revenue ÷ Contribution Margin. Failed orders reduce avg revenue and increase avg costs, giving a realistic breakeven target.
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles['section-title']}>Profit & Loss — {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</h2>
        <p className={styles['section-desc']}>
          Shows booked profit for completed days only (all orders delivered/failed). Incomplete days are left empty. Green = profit, Red = loss.
        </p>
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
            <ResponsiveContainer width="100%" height={250}>
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
                  height={36}
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
            <ResponsiveContainer width="100%" height={250}>
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
                  height={36}
                  iconType="circle"
                  onClick={handleLegendClick}
                  wrapperStyle={{ cursor: 'pointer' }}
                  formatter={(value, entry: any) => {
                    const { payload } = entry;
                    const total = pieChartsData.codStatus.reduce((acc: number, curr: any) => acc + curr.value, 0);
                    const percentage = total > 0 ? ((payload.value / total) * 100).toFixed(0) : 0;
                    return <span className={styles.chartLegendText}>{value}: {payload.value} ({percentage}%)</span>;
                  }}
                />
                <text x="50%" y={110} textAnchor="middle" dominantBaseline="middle" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {(() => {
                    const failed = pieChartsData.codStatus.find(i => i.name === 'Failed')?.value || 0;
                    const total = pieChartsData.codStatus.reduce((a, b: any) => a + b.value, 0) || 1;
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
