import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { api, errorMessage } from '../services/api';
import styles from './SalesPage.module.css';
import {
  Amount,
  Button,
  Checkbox,
  DataList,
  Dialog,
  Drawer,
  EmptyState,
  Menu,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatCard,
  StatStrip,
  Switch,
  Toast,
  Tooltip,
} from '../components/ui/pbx';
import { cx, formatINR } from '../components/ui/format';
import { OrdersByDay } from './SalesPage/OrdersByDay';

import { type ShopifyOrder } from '../services/api';

interface COGSField {
  id: string;
  name: string;
  // Old structure (deprecated)
  smallValue?: number;
  largeValue?: number;
  // New structure with payment method support
  smallPrepaidValue: number;
  smallCODValue: number;
  largePrepaidValue: number;
  largeCODValue: number;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  percentageType: 'included' | 'excluded';
}

interface COGSBreakdown {
  fieldName: string;
  type: 'cogs' | 'ndr' | 'both';
  calculationType: 'fixed' | 'percentage';
  value: number;
  calculatedCost: number;
}

interface COGSTotalOverrides {
  smallPrepaidValue?: number;
  smallCODValue?: number;
  largePrepaidValue?: number;
  largeCODValue?: number;
}

interface COGSOverrides {
  pre?: COGSTotalOverrides;
  post?: COGSTotalOverrides;
}

interface COGSVersionEntry {
  effectiveFrom: string; // YYYY-MM-DD
  fields: COGSField[];
  totalOverrides?: COGSOverrides;
}

// Store timezone for order date (match Shopify reports: India = Asia/Kolkata)
const STORE_TIMEZONE = 'Asia/Kolkata';

/** Order date as YYYY-MM-DD in store timezone so daily revenue matches Shopify (e.g. "Yesterday") */
function getOrderDateKey(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
}

/** Pick the COGS version whose effectiveFrom <= dateKey (versions must be sorted oldest-first) */
function getCogsVersionForDate(dateKey: string, versions: COGSVersionEntry[]): COGSVersionEntry | null {
  let result: COGSVersionEntry | null = null;
  for (const v of versions) {
    if (v.effectiveFrom <= dateKey) result = v;
    else break;
  }
  return result;
}

export interface SalesPageProps {
  initialFilter?: {
    type: 'status' | 'payment';
    value: string;
    period?: string;
  };
  /** Shown inside another page (the Dashboard's orders dialog): no page title. */
  embedded?: boolean;
}

export function SalesPage({ initialFilter, embedded = false }: SalesPageProps = {}) {
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<ShopifyOrder[]>([]);
  const [discardedOrderIds, setDiscardedOrderIds] = useState<Set<number>>(new Set());
  const [rtoOrderIds, setRTOOrderIds] = useState<Set<number>>(new Set());
  const [acknowledgedOrderIds, setAcknowledgedOrderIds] = useState<Set<number>>(new Set());
  const [ticketRaisedOrderIds, setTicketRaisedOrderIds] = useState<Set<number>>(new Set());
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
  const [selectAll, setSelectAll] = useState(false);
  const [selectedMonthFilter, setSelectedMonthFilter] = useState<string>(initialFilter?.period || 'current'); // 'all', 'current', 'last30', or 'YYYY-MM'
  const [availableMonthsList, setAvailableMonthsList] = useState<string[]>([]);
  // Client-side cache of orders per month filter, so prefetched months switch instantly.
  const monthOrdersCache = useRef<Map<string, ShopifyOrder[]>>(new Map());
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [showAWBColumn, setShowAWBColumn] = useState(false);

  // Status filters (AND filters)
  const [showUnfulfilled, setShowUnfulfilled] = useState(false);
  const [showDelivered, setShowDelivered] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const [showAttemptedDelivery, setShowAttemptedDelivery] = useState(false);
  const [showInTransit, setShowInTransit] = useState(false);
  const [showOutForDelivery, setShowOutForDelivery] = useState(false);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [showNotAcknowledged, setShowNotAcknowledged] = useState(false);
  const [showTicketRaised, setShowTicketRaised] = useState(false);
  const [filterOperator, setFilterOperator] = useState<'AND' | 'OR'>('OR');

  // Payment filters
  const [showPrepaid, setShowPrepaid] = useState(false);
  const [showCOD, setShowCOD] = useState(false);

  // Apply initial filters if provided
  useEffect(() => {
    if (initialFilter) {
      // Reset all first
      setShowUnfulfilled(false);
      setShowDelivered(false);
      setShowFailed(false);
      setShowAttemptedDelivery(false);
      setShowInTransit(false);
      setShowOutForDelivery(false);
      setShowConfirmed(false);
      setShowNotAcknowledged(false);
      setShowTicketRaised(false);
      setShowPrepaid(false);
      setShowCOD(false);

      if (initialFilter.period) {
        setSelectedMonthFilter(initialFilter.period);
      }

      if (initialFilter.type === 'status') {
        switch (initialFilter.value) {
          case 'Delivered': setShowDelivered(true); break;
          case 'Failed': setShowFailed(true); break;
          case 'Attempted Delivery': setShowAttemptedDelivery(true); break;
          case 'Out for Delivery': setShowOutForDelivery(true); break;
          case 'In Transit': setShowInTransit(true); break;
          case 'Confirmed': setShowConfirmed(true); break;
          case 'In Progress': setShowInTransit(true); break;
        }
      } else if (initialFilter.type === 'payment') {
        switch (initialFilter.value) {
          case 'Prepaid': setShowPrepaid(true); break;
          case 'COD': setShowCOD(true); break;
        }
      }
    }
  }, [initialFilter]);

  // Pending drawer
  const [showPendingDrawer, setShowPendingDrawer] = useState(false);
  const [pendingFilterCOD, setPendingFilterCOD] = useState(false);
  const [pendingFilterPaid, setPendingFilterPaid] = useState(false);
  const [pendingFilterDelayDays, setPendingFilterDelayDays] = useState<Set<number>>(new Set());

  // COGS Calculator Modal State
  const [showCogsModal, setShowCogsModal] = useState(false);
  const [selectedOrderForCogs, setSelectedOrderForCogs] = useState<ShopifyOrder | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<'small' | 'large'>('small');
  const [cogsVersions, setCogsVersions] = useState<COGSVersionEntry[]>([]);
  const [cogsBreakdown, setCogsBreakdown] = useState<COGSBreakdown[]>([]);

  // Delivery Status Update Modal State
  const [showDeliveryStatusModal, setShowDeliveryStatusModal] = useState(false);
  const [selectedOrderForStatus, setSelectedOrderForStatus] = useState<{ id: number; name: string } | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [statusChoice, setStatusChoice] = useState<'Delivered' | 'Failed'>('Delivered');

  // A confirmation waiting in a Dialog (discard orders, tag customers, acknowledge)
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
  } | null>(null);

  // Per-order P/L cache (orderId -> profit/loss)
  const [orderProfitLoss, setOrderProfitLoss] = useState<Map<number, number>>(new Map());

  // Fixed monthly expenses total for the selected month (deducted from Total P/L)
  const [fixedMonthlyTotal, setFixedMonthlyTotal] = useState(0);

  // Ad spend by date (YYYY-MM-DD -> total amount). Used to show "Ad spend" in day header row.
  const [adSpendByDate, setAdSpendByDate] = useState<Record<string, number>>({});

  // Derived: ad cost per order per day — depends on orders + adSpendByDate, no fetch needed
  // id → order lookup, so bulk handlers don't linearly scan `orders` per selected id.
  const ordersById = useMemo(() => {
    const map = new Map<number, ShopifyOrder>();
    orders.forEach((o) => map.set(o.id, o));
    return map;
  }, [orders]);

  const adCostPerOrderByDate = useMemo(() => {
    const orderCountByDate: Record<string, number> = {};
    orders.forEach((o) => {
      if (o.cancelledAt) return;
      const d = getOrderDateKey(o.createdAt);
      orderCountByDate[d] = (orderCountByDate[d] || 0) + 1;
    });
    const result: Record<string, number> = {};
    Object.keys(adSpendByDate).forEach((d) => {
      const count = orderCountByDate[d] || 0;
      if (count > 0) result[d] = adSpendByDate[d] / count;
    });
    return result;
  }, [orders, adSpendByDate]);

  const loadStaticData = async () => {
    try {
      const [discardedResponse, rtoResponse, cogsVersionsResponse, adSpendResponse, acknowledgedResponse, ticketRaisedResponse] = await Promise.all([
        api.getDiscardedOrderIds(),
        api.getRTOOrderIds(),
        api.getCOGSVersions(),
        api.getDailyAdSpend(),
        api.getAcknowledgedOrderIds(),
        api.getTicketRaisedOrderIds(),
      ]);

      if (discardedResponse.success) {
        setDiscardedOrderIds(new Set(discardedResponse.discardedOrderIds));
      }
      if (rtoResponse.success) {
        setRTOOrderIds(new Set(rtoResponse.rtoOrderIds));
      }
      if (acknowledgedResponse.success) {
        setAcknowledgedOrderIds(new Set(acknowledgedResponse.acknowledgedOrderIds));
      }
      if (ticketRaisedResponse?.success) {
        setTicketRaisedOrderIds(new Set(ticketRaisedResponse.ticketRaisedOrderIds));
      }
      if (cogsVersionsResponse?.success && cogsVersionsResponse.versions?.length > 0) {
        // Sort oldest-first so getCogsVersionForDate can pick correct version per order date
        const sorted = [...cogsVersionsResponse.versions]
          .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
          .map(v => ({
            effectiveFrom: new Date(v.effectiveFrom).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE }),
            fields: v.fields as COGSField[],
            totalOverrides: v.totalOverrides as COGSOverrides | undefined,
          }));
        setCogsVersions(sorted);
      }
      const adSpendEntries = adSpendResponse.success && adSpendResponse.entries ? adSpendResponse.entries : [];
      const adSpend: Record<string, number> = {};
      adSpendEntries.forEach((e) => {
        const d = new Date(e.date).toLocaleDateString('en-CA', { timeZone: STORE_TIMEZONE });
        adSpend[d] = (adSpend[d] || 0) + e.amount;
      });
      setAdSpendByDate(adSpend);
    } catch (err) {
      console.error('Failed to load static data:', err);
    }
  };

  const loadOrders = async (monthArg?: string, force = false) => {
    const targetMonth = monthArg || selectedMonthFilter;
    // Instant switch if we already prefetched this month.
    if (!force) {
      const cached = monthOrdersCache.current.get(targetMonth);
      if (cached) {
        setOrders(cached);
        return;
      }
    }
    setIsLoading(true);
    try {
      const ordersResponse = await api.getOrders(10000, true, undefined, targetMonth);
      if (ordersResponse.success && ordersResponse.orders) {
        monthOrdersCache.current.set(targetMonth, ordersResponse.orders);
        setOrders(ordersResponse.orders);
        if (ordersResponse.availableMonths) {
          setAvailableMonthsList(ordersResponse.availableMonths);
        }
      }
    } catch (err) {
      console.error('Failed to load orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadStaticData();
  }, []);

  useEffect(() => {
    loadOrders(selectedMonthFilter);
  }, [selectedMonthFilter]);

  // Once the current month is loaded and we know the available months, prefetch the
  // other months in the background so switching to them is instant. Each is a small
  // per-month read on the backend.
  useEffect(() => {
    if (availableMonthsList.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const m of availableMonthsList) {
        if (cancelled) break;
        if (monthOrdersCache.current.has(m)) continue;
        try {
          const res = await api.getOrders(10000, true, undefined, m);
          if (res.success && res.orders) monthOrdersCache.current.set(m, res.orders);
        } catch {
          /* background prefetch — ignore errors */
        }
      }
    })();
    return () => { cancelled = true; };
  }, [availableMonthsList]);

  // Fetch fixed monthly expenses total whenever the selected month changes
  useEffect(() => {
    const getMonthKey = () => {
      if (selectedMonthFilter === 'all' || selectedMonthFilter === 'last30') return null;
      if (selectedMonthFilter === 'current') {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
      }
      return selectedMonthFilter; // already YYYY-MM
    };
    const monthKey = getMonthKey();
    if (!monthKey) { setFixedMonthlyTotal(0); return; }
    api.getFixedMonthlyExpenses(monthKey)
      .then(res => {
        if (res.success) {
          setFixedMonthlyTotal(res.entries.reduce((sum, e) => sum + e.amount, 0));
        }
      })
      .catch(() => setFixedMonthlyTotal(0));
  }, [selectedMonthFilter]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // Step 1a: Clear Shiprocket shipping charges cache
      setRefreshStatus('Clearing shipping cache...');
      await api.clearShippingChargesCache();

      // Step 1b: Sync latest orders from Shopify into Firestore (fast; no 15MB Mongo path)
      setRefreshStatus('Syncing new orders from Shopify...');
      const shopifySyncResponse = await api.firestoreSyncOrders();
      const syncedCount = (shopifySyncResponse as any).written || 0;
      monthOrdersCache.current.clear(); // fresh orders — drop the client prefetch cache

      // Step 2: Load ALL fresh orders from DB/cache to find any pending syncs across all months
      setRefreshStatus(syncedCount > 0 ? `Found ${syncedCount} updated orders. Loading all orders...` : 'No new orders. Loading order list...');
      const response = await api.getOrders(10000, true, undefined, 'all');

      // Step 3: Bulk sync shipping charges in chunks to show exactly how much progress is made
      if (response.success && response.orders) {
        // Filter: Ignore everything created before 10 Jan 2026.
        // For orders on/after that date, only sync if they aren't in a terminal state
        // or if terminal but missing shipping charges.
        const SYNC_CUTOFF_DATE = new Date('2026-01-10T00:00:00');
        
        const orderNumbersToSync = response.orders
          .filter((o: any) => {
            if (o.cancelledAt) return false;
            
            // Ignore unfulfilled orders only if they don't have a Shiprocket status yet
            const isUnfulfilled = !o.fulfillmentStatus || o.fulfillmentStatus === 'unfulfilled';
            if (isUnfulfilled && !o.deliveryStatus) return false;

            // Date cutoff per user request
            if (new Date(o.createdAt) < SYNC_CUTOFF_DATE) return false;

            const { isFailed, isDelivered } = getOrderStatus(o);
            
            // Needs sync if:
            // 1. Not in a terminal state (In Transit, Attempted, Out for Delivery, etc.)
            // 2. IS in a terminal state but we have NO deliveryStatus at all (newly fulfilled)
            // 3. IS terminal with status, charge is 0, AND shipping was never fetched after our search fix
            //    (i.e. needs one-time charge recovery with the corrected Shiprocket search)
            const isTerminal = isFailed || isDelivered;
            const hasStatusData = !!o.deliveryStatus;
            const hasChargeData = (o.shippingCharge ?? 0) > 0;
            const FIX_DATE = new Date('2026-03-21T00:00:00Z');
            const wasFetchedAfterFix = o.shippingFetchedAt && new Date(o.shippingFetchedAt) >= FIX_DATE;
            
            // Non-terminal → always sync (status may have changed)
            if (!isTerminal) return true;
            // Terminal with no delivery status → sync to get initial data
            if (!hasStatusData) return true;
            // Terminal with good charge → skip
            if (hasChargeData) return false;
            // Terminal with 0 charge but already fetched after fix → skip (genuinely 0 or not found)
            if (wasFetchedAfterFix) return false;
            // Terminal with 0 charge, never fetched after fix → sync (one-time recovery)
            return true;
          })
          .map((o: any) => o.name);

        // Count breakdown for display
        const fulfilledOrders = response.orders.filter((o: any) => o.fulfillmentStatus && o.fulfillmentStatus !== 'unfulfilled').length;

        if (orderNumbersToSync.length === 0) {
          setRefreshStatus(`All ${fulfilledOrders} deliveries up to date!`);
          await new Promise(resolve => setTimeout(resolve, 800)); // Brief pause for UX
        } else {
          setRefreshStatus(`Syncing ${orderNumbersToSync.length} deliveries from Shiprocket...`);
          const chunkSize = 50;
          let processed = 0;
          let totalFetched = 0;
          let totalSkipped = 0;

          for (let i = 0; i < orderNumbersToSync.length; i += chunkSize) {
            const chunk = orderNumbersToSync.slice(i, i + chunkSize);
            setRefreshStatus(`Syncing deliveries... (${processed}/${orderNumbersToSync.length})`);
            const result = await api.syncShippingCharges(chunk);
            processed += chunk.length;
            totalFetched += result.fetched || 0;
            totalSkipped += (result as any).skipped || 0;
          }
          setRefreshStatus(`Synced ${totalFetched} orders, ${totalSkipped} skipped`);
          await new Promise(resolve => setTimeout(resolve, 600));
        }
      }

      // Step 4: Recompute DailyPnl (updates totalRevenue/totalCogs for averages page)
      setRefreshStatus('Recomputing daily P&L...');
      await api.backfillDailyPnl();

      // Step 5: Reload to get updated data with shipping breakdown
      setRefreshStatus('Refreshing display...');
      monthOrdersCache.current.clear(); // data changed across months — drop the prefetch cache
      await loadOrders(selectedMonthFilter, true);
    } catch (err) {
      console.error('Failed to refresh data:', err);
      toast.error(errorMessage(err, 'Failed to refresh data. Please try again.'));
    } finally {
      setIsRefreshing(false);
      setRefreshStatus(null);
    }
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
    setSelectAll(!selectAll);
  };

  const handleSelectOrder = (orderId: number) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
    setSelectAll(newSelected.size === filteredOrders.length);
  };

  // Selects or clears every order of one day (the checkbox in that day's table header).
  const handleSelectDay = (orderIds: number[], select: boolean) => {
    const newSelected = new Set(selectedOrders);
    orderIds.forEach((id) => (select ? newSelected.add(id) : newSelected.delete(id)));
    setSelectedOrders(newSelected);
    setSelectAll(filteredOrders.length > 0 && newSelected.size === filteredOrders.length);
  };

  // Get available months from orders (store timezone)
  const availableMonths = availableMonthsList;

  // Helper function to check order status
  const getOrderStatus = (order: ShopifyOrder) => {
    const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';

    // terminal numeric statuses: 
    // 12: Lost, 13: Canceled, 15: RTO Delivered, 16: RTO Acknowledged, 
    // 17: RTO Initiated, 18: RTO In Transit, 19: RTO Out for Delivery, 
    // 20: RTO Undelivered, 42: RTO Something, 46: RTO Acknowledged
    const terminalNumericStatuses = ['12', '13', '15', '16', '17', '18', '19', '20', '42', '46', '10'];

    // Failed statuses: failure, RTO-related (attempted_delivery excluded)
    const isFailed = rtoOrderIds.has(order.id) ||
      deliveryStatus === 'failure' ||
      deliveryStatus.includes('failed') ||
      deliveryStatus.includes('rto') ||
      terminalNumericStatuses.includes(deliveryStatus);

    // Delivered statuses: delivered only
    const isDelivered = deliveryStatus === 'delivered';

    // Attempted delivery: delivery was attempted but not completed
    const isAttemptedDelivery = deliveryStatus === 'attempted_delivery';

    // Out for delivery: explicitly out_for_delivery status
    const isOutForDelivery = deliveryStatus === 'out_for_delivery';

    // Unfulfilled: Check fulfillmentStatus first, BUT override if Shiprocket gave us a status!
    const isUnfulfilled = (!fulfillmentStatus ||
      fulfillmentStatus === '' ||
      fulfillmentStatus === 'unfulfilled') && !deliveryStatus;

    // In transit: explicit keywords check
    const isInTransit = !isUnfulfilled && !isDelivered && !isFailed &&
      (deliveryStatus.includes('transit') || deliveryStatus.includes('shipped') || deliveryStatus.includes('picked'));

    // Confirmed: Active but not yet moving (and not Unfulfilled in strict sense, though often overlaps or is Label Created)
    // Captures "Ready to Ship", "Label Created", or just empty status if not caught by Unfulfilled
    const isConfirmed = !isUnfulfilled && !isDelivered && !isFailed && !isAttemptedDelivery && !isOutForDelivery && !isInTransit;

    return { isFailed, isDelivered, isUnfulfilled, isAttemptedDelivery, isInTransit, isOutForDelivery, isConfirmed };
  };

  // Orders for stats: month filter + exclude discarded/cancelled only (no status filter). Header stats never change when status filters are applied.
  const ordersForStats = useMemo(() => {
    let filtered = orders.filter(order =>
      !discardedOrderIds.has(order.id) && !order.cancelledAt
    );
    if (selectedMonthFilter !== 'all') {
      if (selectedMonthFilter === 'last30') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        thirtyDaysAgo.setHours(0, 0, 0, 0);
        filtered = filtered.filter(order => new Date(order.createdAt) >= thirtyDaysAgo);
      } else if (selectedMonthFilter === 'current') {
        const now = new Date();
        const targetMonth = now.getMonth();
        const targetYear = now.getFullYear();
        filtered = filtered.filter(order => {
          const [y, m] = getOrderDateKey(order.createdAt).split('-').map(Number);
          return y === targetYear && m - 1 === targetMonth;
        });
      } else {
        const [year, month] = selectedMonthFilter.split('-');
        const targetYear = parseInt(year);
        const targetMonth = parseInt(month) - 1;
        filtered = filtered.filter(order => {
          const [y, m] = getOrderDateKey(order.createdAt).split('-').map(Number);
          return y === targetYear && m - 1 === targetMonth;
        });
      }
    }
    return filtered;
  }, [orders, discardedOrderIds, selectedMonthFilter]);

  // Filter orders based on selected month, status filters, and exclude discarded/cancelled orders
  const filteredOrders = useMemo(() => {
    let filtered = ordersForStats;

    // Apply Payment Method filters
    if (showPrepaid || showCOD) {
      filtered = filtered.filter(order => {
        const isPrepaid = order.paymentMethod?.toLowerCase() === 'prepaid';
        const isCOD = order.paymentMethod?.toLowerCase() === 'cod';
        return (showPrepaid && isPrepaid) || (showCOD && isCOD);
      });
    }

    // Apply status filters (works with month filter via AND, multiple status filters use OR)
    if (showUnfulfilled || showDelivered || showFailed || showAttemptedDelivery || showInTransit || showOutForDelivery || showConfirmed || showNotAcknowledged || showTicketRaised) {
      filtered = filtered.filter(order => {
        const { isFailed, isDelivered, isUnfulfilled, isAttemptedDelivery, isInTransit, isOutForDelivery, isConfirmed } = getOrderStatus(order);
        const conditions = [];

        if (showUnfulfilled) conditions.push(isUnfulfilled);
        if (showDelivered) conditions.push(isDelivered);
        if (showFailed) conditions.push(isFailed);
        if (showAttemptedDelivery) conditions.push(isAttemptedDelivery);
        if (showInTransit) conditions.push(isInTransit);
        if (showOutForDelivery) conditions.push(isOutForDelivery);
        if (showConfirmed) conditions.push(isConfirmed);
        if (showNotAcknowledged) conditions.push(!acknowledgedOrderIds.has(order.id));
        if (showTicketRaised) conditions.push(ticketRaisedOrderIds.has(order.id) || order.hasTicket);

        if (conditions.length === 0) return true;

        return filterOperator === 'AND'
          ? conditions.every(c => c)
          : conditions.some(c => c);
      });
    }
    return filtered;
  }, [ordersForStats, showPrepaid, showCOD, showUnfulfilled, showDelivered, showFailed,
      showAttemptedDelivery, showInTransit, showOutForDelivery, showConfirmed,
      showNotAcknowledged, showTicketRaised, acknowledgedOrderIds, ticketRaisedOrderIds,
      rtoOrderIds, filterOperator]);

  const hasStatusFilter =
    showUnfulfilled || showDelivered || showFailed || showAttemptedDelivery || showInTransit || showOutForDelivery || showConfirmed || showNotAcknowledged || showTicketRaised;

  // How many orders in the period each filter would match, with the prepaid/COD split
  const filterCounts = useMemo(() => {
    const blank = () => ({ total: 0, prepaid: 0, cod: 0 });
    const counts = {
      unfulfilled: blank(), confirmed: blank(), inTransit: blank(), outForDelivery: blank(), attempted: blank(),
      delivered: blank(), failed: blank(), notAcknowledged: blank(), ticket: blank(), prepaid: blank(), cod: blank(),
    };
    for (const order of ordersForStats) {
      const s = getOrderStatus(order);
      const isPrepaid = order.paymentMethod?.toLowerCase() === 'prepaid';
      const add = (c: { total: number; prepaid: number; cod: number }) => {
        c.total++;
        if (isPrepaid) c.prepaid++;
        else c.cod++;
      };
      if (s.isUnfulfilled) add(counts.unfulfilled);
      if (s.isConfirmed) add(counts.confirmed);
      if (s.isInTransit) add(counts.inTransit);
      if (s.isOutForDelivery) add(counts.outForDelivery);
      if (s.isAttemptedDelivery) add(counts.attempted);
      if (s.isDelivered) add(counts.delivered);
      if (s.isFailed) add(counts.failed);
      if (!acknowledgedOrderIds.has(order.id)) add(counts.notAcknowledged);
      if (ticketRaisedOrderIds.has(order.id) || order.hasTicket) add(counts.ticket);
      if (isPrepaid) add(counts.prepaid);
      else if (order.paymentMethod?.toLowerCase() === 'cod') add(counts.cod);
    }
    return counts;
  }, [ordersForStats, acknowledgedOrderIds, ticketRaisedOrderIds, rtoOrderIds]);

  // Whether a date (YYYY-MM-DD) falls within the selected month filter
  const isDateInSelectedMonth = (dateKey: string): boolean => {
    if (selectedMonthFilter === 'all') return true;
    let targetMonth: number;
    let targetYear: number;
    if (selectedMonthFilter === 'current') {
      targetMonth = new Date().getMonth();
      targetYear = new Date().getFullYear();
    } else {
      const [y, m] = selectedMonthFilter.split('-');
      targetYear = parseInt(y);
      targetMonth = parseInt(m) - 1;
    }
    const [y, m] = dateKey.split('-').map(Number);
    return y === targetYear && m - 1 === targetMonth;
  };

  // Group filtered orders by date; include ad-spend-only dates only when they're in the selected month
  // Global NDR rate from ALL orders (not filtered by month) — for expected NDR per day
  const globalNdrRate = useMemo(() => {
    let delivered = 0;
    let failed = 0;
    orders.forEach((o) => {
      if (o.cancelledAt || discardedOrderIds.has(o.id)) return;
      const status = o.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed =
        rtoOrderIds.has(o.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      if (isDelivered) delivered++;
      else if (isFailed) failed++;
    });
    const finalCount = delivered + failed;
    return finalCount > 0 ? (failed / finalCount) * 100 : 0;
  }, [orders, discardedOrderIds, rtoOrderIds]);

  // Average P/L per final-status order (all orders) — for estimated P/L per day
  const avgPnlPerFinalOrder = useMemo(() => {
    let totalPnl = 0;
    let count = 0;
    orders.forEach((o) => {
      if (o.cancelledAt || discardedOrderIds.has(o.id)) return;
      const status = o.deliveryStatus?.toLowerCase() || '';
      const isDelivered = status === 'delivered';
      const isFailed =
        rtoOrderIds.has(o.id) ||
        status === 'failure' ||
        status.includes('failed') ||
        status.includes('rto');
      if (isDelivered || isFailed) {
        totalPnl += orderProfitLoss.get(o.id) ?? 0;
        count++;
      }
    });
    return count > 0 ? totalPnl / count : 0;
  }, [orders, discardedOrderIds, rtoOrderIds, orderProfitLoss]);

  const ordersGroupedByDate = useMemo(() => {
    const byDate: Record<string, ShopifyOrder[]> = {};
    filteredOrders.forEach((order) => {
      const dateKey = getOrderDateKey(order.createdAt);
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(order);
    });
    Object.keys(adSpendByDate).forEach((dateKey) => {
      if (!isDateInSelectedMonth(dateKey)) return;
      if (!byDate[dateKey]) byDate[dateKey] = [];
    });

    return Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dateKey, orders]) => ({
        dateKey,
        dateLabel: new Date(dateKey + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        orders,
        adSpend: adSpendByDate[dateKey] ?? 0,
      }));
  }, [filteredOrders, adSpendByDate, selectedMonthFilter]);

  // Clear selections when filters change
  useEffect(() => {
    setSelectedOrders(new Set());
    setSelectAll(false);
  }, [selectedMonthFilter, showUnfulfilled, showDelivered, showFailed, showAttemptedDelivery, showInTransit, showOutForDelivery, showConfirmed, showNotAcknowledged, showPrepaid, showCOD, filterOperator]);

  // Calculate pending products from unfulfilled orders
  const getPendingProducts = () => {
    // Products to ignore (accessories/add-ons)
    const ignoredProducts = [
      'printed photos - ready to paste',
      'pocket to keep your souvenirs',
      'gift wrap'
    ];

    // Get unfulfilled orders (not cancelled, not discarded, fulfillmentStatus is null/unfulfilled)
    let unfulfilledOrders = orders.filter(order =>
      !order.cancelledAt &&
      !discardedOrderIds.has(order.id) &&
      (!order.fulfillmentStatus || order.fulfillmentStatus.toLowerCase() === 'unfulfilled')
    );

    // Apply payment method filters
    if (pendingFilterCOD || pendingFilterPaid) {
      unfulfilledOrders = unfulfilledOrders.filter(order => {
        if (pendingFilterCOD && order.paymentMethod === 'COD') return true;
        if (pendingFilterPaid && order.paymentMethod === 'Prepaid') return true;
        return false;
      });
    }

    // Apply delay days filter
    if (pendingFilterDelayDays.size > 0) {
      unfulfilledOrders = unfulfilledOrders.filter(order => {
        const delayDays = getDelayDaysIncludingZero(order);
        return delayDays !== null && pendingFilterDelayDays.has(delayDays);
      });
    }

    // Helper to extract numeric part from order name (e.g., "#PB1123S" -> "1123")
    const extractOrderNumber = (orderName: string | undefined): string => {
      if (!orderName) return 'N/A';
      // Remove # prefix if present, then extract numbers
      const cleanName = orderName.replace('#', '');
      const match = cleanName.match(/\d+/);
      return match ? match[0] : cleanName;
    };

    // Aggregate products by variant
    const productCounts: Record<string, {
      title: string;
      variantTitle: string;
      count: number;
      orderNumbers: string[]
    }> = {};

    unfulfilledOrders.forEach(order => {
      order.lineItems?.forEach(item => {
        // Skip ignored products
        if (ignoredProducts.includes(item.title.toLowerCase())) {
          return;
        }

        const key = `${item.title}${item.variantTitle ? ` - ${item.variantTitle}` : ''}`;
        const orderNum = extractOrderNumber(order.name);

        if (productCounts[key]) {
          productCounts[key].count += item.quantity;
          if (!productCounts[key].orderNumbers.includes(orderNum)) {
            productCounts[key].orderNumbers.push(orderNum);
          }
        } else {
          productCounts[key] = {
            title: item.title,
            variantTitle: item.variantTitle || '',
            count: item.quantity,
            orderNumbers: [orderNum],
          };
        }
      });
    });

    // Convert to array and sort by count (descending)
    return Object.values(productCounts).sort((a, b) => b.count - a.count);
  };

  // Calculate stats from ordersForStats (month only, no status filter) so header stats don't change when filters are applied
  const stats = useMemo(() => {
    const calculateStats = () => {
    const totalOrders = ordersForStats.length;
    let ndrCount = 0;
    let deliveredCount = 0;
    let failedCount = 0;
    let attemptedDeliveryCount = 0;
    let inTransitCount = 0;
    let outForDeliveryCount = 0;
    let unfulfilledCount = 0;
    let prepaidCount = 0;
    let codCount = 0;
    let deliveredPrepaidCount = 0;
    let deliveredCODCount = 0;
    let failedPrepaidCount = 0;
    let failedCODCount = 0;
    let attemptedDeliveryPrepaidCount = 0;
    let attemptedDeliveryCODCount = 0;
    let inTransitPrepaidCount = 0;
    let inTransitCODCount = 0;
    let outForDeliveryPrepaidCount = 0;
    let outForDeliveryCODCount = 0;
    let unfulfilledPrepaidCount = 0;
    let unfulfilledCODCount = 0;
    let fulfilledCount = 0;

    ordersForStats.forEach(order => {
      // Count prepaid vs COD (total)
      if (order.paymentMethod === 'Prepaid') {
        prepaidCount++;
      } else {
        codCount++;
      }

      // Check delivery status
      const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';

      // Check if failed/NDR
      const isFailed = rtoOrderIds.has(order.id) ||
        deliveryStatus === 'failure' ||
        deliveryStatus.includes('failed') ||
        deliveryStatus.includes('rto');

      // Check if order has been fulfilled (shipped)
      // Use fulfillment_status OR if we have any valid delivery status from Shiprocket
      const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
      const isFulfilledStatus = fulfillmentStatus === 'fulfilled' || fulfillmentStatus === 'partial' || !!deliveryStatus;

      if (isFulfilledStatus) {
        fulfilledCount++;
      }

      // Determine delivery status category
      const isDelivered = deliveryStatus === 'delivered';

      // Count orders by delivery status
      if (isFailed) {
        // Failed/NDR orders
        ndrCount++;
        failedCount++;
        if (order.paymentMethod === 'Prepaid') {
          failedPrepaidCount++;
        } else {
          failedCODCount++;
        }
      } else if (isDelivered) {
        // Successfully delivered orders
        deliveredCount++;
        if (order.paymentMethod === 'Prepaid') {
          deliveredPrepaidCount++;
        } else {
          deliveredCODCount++;
        }
      } else if (deliveryStatus === 'attempted_delivery') {
        // Attempted delivery (fulfilled, delivery attempted but not completed)
        attemptedDeliveryCount++;
        if (order.paymentMethod === 'Prepaid') {
          attemptedDeliveryPrepaidCount++;
        } else {
          attemptedDeliveryCODCount++;
        }
      } else if (deliveryStatus === 'out_for_delivery') {
        // Out for delivery (fulfilled and on the way to customer)
        outForDeliveryCount++;
        if (order.paymentMethod === 'Prepaid') {
          outForDeliveryPrepaidCount++;
        } else {
          outForDeliveryCODCount++;
        }
      } else if (isFulfilledStatus) {
        // In transit (fulfilled but not delivered, failed, attempted_delivery, or out_for_delivery)
        inTransitCount++;
        if (order.paymentMethod === 'Prepaid') {
          inTransitPrepaidCount++;
        } else {
          inTransitCODCount++;
        }
      } else {
        // Unfulfilled orders (not yet shipped)
        unfulfilledCount++;
        if (order.paymentMethod === 'Prepaid') {
          unfulfilledPrepaidCount++;
        } else {
          unfulfilledCODCount++;
        }
      }
    });

    // Calculate NDR Rate based on delivered + failed orders (final status only)
    const finalStatusCount = deliveredCount + failedCount;
    const ndrRate = finalStatusCount > 0 ? (ndrCount / finalStatusCount) * 100 : 0;

    return {
      totalOrders,
      ndrCount,
      deliveredCount,
      failedCount,
      attemptedDeliveryCount,
      inTransitCount,
      outForDeliveryCount,
      unfulfilledCount,
      ndrRate,
      finalStatusCount, // Delivered + Failed
      prepaidCount,
      codCount,
      deliveredPrepaidCount,
      deliveredCODCount,
      failedPrepaidCount,
      failedCODCount,
      attemptedDeliveryPrepaidCount,
      attemptedDeliveryCODCount,
      inTransitPrepaidCount,
      inTransitCODCount,
      outForDeliveryPrepaidCount,
      outForDeliveryCODCount,
      unfulfilledPrepaidCount,
      unfulfilledCODCount,
      fulfilledCount,
    };
    };
    return calculateStats();
  }, [ordersForStats, rtoOrderIds]);

  // Calculate Expected Profit for current month
  const expectedProfit = useMemo(() => {
    const calculateExpectedProfit = () => {
    // Only calculate for current month, specific month or the rolling 30 days
    if (selectedMonthFilter === 'all') {
      return null;
    }

    const today = new Date();
    const currentDay = today.getDate();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();

    // 'last30' is a rolling window, not a YYYY-MM month: it ends today, so all 30 of its days
    // have passed and the projection only adds what its pending orders should bring
    const isRollingWindow = selectedMonthFilter === 'last30';
    let isCurrentMonth = false;
    let totalDaysInMonth: number;
    let daysElapsed: number;

    if (isRollingWindow) {
      totalDaysInMonth = 30;
      daysElapsed = 30;
    } else {
      let targetMonth: number;
      let targetYear: number;
      if (selectedMonthFilter === 'current') {
        targetMonth = new Date().getMonth();
        targetYear = new Date().getFullYear();
      } else {
        const [year, month] = selectedMonthFilter.split('-');
        targetYear = parseInt(year);
        targetMonth = parseInt(month) - 1;
      }

      // Check if selected month is current month
      isCurrentMonth = targetYear === currentYear && targetMonth === currentMonth;

      // If it's not the current month and the month is in the past, return null (show actual P/L only)
      if (!isCurrentMonth && (targetYear < currentYear || (targetYear === currentYear && targetMonth < currentMonth))) {
        return null;
      }

      // Calculate total days in the selected month
      totalDaysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();

      // If current month, calculate based on days elapsed
      daysElapsed = isCurrentMonth ? currentDay : totalDaysInMonth;
    }
    const remainingDays = totalDaysInMonth - daysElapsed;

    // Calculate CURRENT P/L for the month (same logic as Total P/L stat)
    const ordersCountedInPnl = ordersForStats.filter(o => {
      const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
      const isDelivered = deliveryStatus === 'delivered';
      const isFailed = rtoOrderIds.has(o.id) ||
        deliveryStatus === 'failure' ||
        deliveryStatus.includes('failed') ||
        deliveryStatus.includes('rto');
      return isDelivered || isFailed || (o.paymentMethod?.toLowerCase() === 'prepaid');
    });

    // Sum P/L by looking each order's id up in the map (O(N)), instead of
    // scanning the counted-orders array for every map entry (O(N²)).
    let currentPL = ordersCountedInPnl.reduce((sum, o) => sum + (orderProfitLoss.get(o.id) ?? 0), 0);

    // Add ad spend for dates in the selected month
    const datesWithOrders = new Set(ordersForStats.map(o => getOrderDateKey(o.createdAt)));
    Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
      if (!isDateInSelectedMonth(dateKey)) return;
      if (!datesWithOrders.has(dateKey)) currentPL -= amount;
    });

    // Deduct fixed monthly expenses
    currentPL -= fixedMonthlyTotal;

    // Count pending orders (not yet delivered/failed, EXCLUDING prepaid which are already counted)
    const pendingOrders = ordersForStats.filter(o => {
      const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
      const isFailed = rtoOrderIds.has(o.id) ||
        deliveryStatus === 'failure' ||
        deliveryStatus.includes('failed') ||
        deliveryStatus.includes('rto');
      const isDelivered = deliveryStatus === 'delivered';
      const isPrepaid = o.paymentMethod?.toLowerCase() === 'prepaid';

      // Include pending orders only (prepaid already counted in current P/L)
      return !isDelivered && !isFailed && !isPrepaid;
    });

    // Calculate average P/L per delivered order using CURRENT month data first
    // This reflects current ad costs and margins.
    // Fallback to broader range only if insufficient data.

    let historicalDeliveredOrders = ordersForStats.filter(o =>
      !o.cancelledAt &&
      !discardedOrderIds.has(o.id) &&
      o.deliveryStatus?.toLowerCase() === 'delivered'
    );

    // If we don't have enough data in current month (e.g. start of month), fallback to last 30 days
    if (historicalDeliveredOrders.length < 10) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      historicalDeliveredOrders = orders.filter(o => {
        const orderDate = new Date(o.createdAt);
        return orderDate >= thirtyDaysAgo &&
          !o.cancelledAt &&
          !discardedOrderIds.has(o.id) &&
          o.deliveryStatus?.toLowerCase() === 'delivered';
      });
    }

    const totalHistoricalPL = historicalDeliveredOrders
      .reduce((sum, o) => sum + (orderProfitLoss.get(o.id) ?? 0), 0);

    const avgPLPerDeliveredOrder = historicalDeliveredOrders.length > 0
      ? totalHistoricalPL / historicalDeliveredOrders.length
      : 0;

    // Calculate average LOSS per failed order (NDR costs + shipping)
    // Same logic as for delivered: use current month, fallback to last 30 days
    let historicalFailedOrders = ordersForStats.filter(o => {
      const status = o.deliveryStatus?.toLowerCase() || '';
      const isFailed = rtoOrderIds.has(o.id) || status === 'failure' || status.includes('failed') || status.includes('rto');
      return !o.cancelledAt && !discardedOrderIds.has(o.id) && isFailed;
    });

    if (historicalFailedOrders.length < 5) { // Lower threshold for failures as they are fewer
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      historicalFailedOrders = orders.filter(o => {
        const orderDate = new Date(o.createdAt);
        const status = o.deliveryStatus?.toLowerCase() || '';
        const isFailed = rtoOrderIds.has(o.id) || status === 'failure' || status.includes('failed') || status.includes('rto');
        return orderDate >= thirtyDaysAgo && !o.cancelledAt && !discardedOrderIds.has(o.id) && isFailed;
      });
    }

    const totalHistoricalLoss = historicalFailedOrders
      .reduce((sum, o) => sum + Math.abs(orderProfitLoss.get(o.id) ?? 0), 0); // Sum absolute losses

    const avgLossPerFailedOrder = historicalFailedOrders.length > 0
      ? totalHistoricalLoss / historicalFailedOrders.length
      : 0;

    // Expected P/L from pending orders (adjusted for NDR rate)
    // Pending orders here are ONLY those not yet accounted for in currentPL (i.e. COD pending)
    // Formula: (Expected Successes * Avg Profit) - (Expected Failures * Avg Loss)
    const deliveryRate = 1 - (globalNdrRate / 100);
    const failureRate = globalNdrRate / 100;

    const expectedRevenue = pendingOrders.length * deliveryRate * avgPLPerDeliveredOrder;
    const expectedLoss = pendingOrders.length * failureRate * avgLossPerFailedOrder;

    const expectedPendingPL = expectedRevenue - expectedLoss;

    // Total expected profit from orders ALREADY placed (Realized + Pending Potential)
    const totalProfitBooked = currentPL + expectedPendingPL;

    // Simple Projection: Average per day based on what we have booked so far (Realized + Pending)
    // Formula: (Total Booked / Days Elapsed) * Total Days in Month

    const avgPLPerDay = daysElapsed > 0 ? totalProfitBooked / daysElapsed : 0;
    // A rolling window has no days left to run, so it projects exactly what is booked (rest ₹0)
    const expectedMonthEndPL = isRollingWindow ? totalProfitBooked : avgPLPerDay * totalDaysInMonth;

    // Calculate the 'future' portion just for display/breakdown consistency if needed
    // Future = Expected Month End - Total Booked Already
    const expectedFuturePL = expectedMonthEndPL - totalProfitBooked;

    return {
      expectedPL: expectedMonthEndPL,
      currentPL,
      expectedPendingPL,
      expectedFuturePL,
      avgPLPerDay,
      avgPLPerDeliveredOrder,
      pendingOrdersCount: pendingOrders.length,
      daysElapsed,
      totalDays: totalDaysInMonth,
      remainingDays,
      isCurrentMonth,
    };
    };
    return calculateExpectedProfit();
  }, [ordersForStats, orders, selectedMonthFilter, rtoOrderIds, discardedOrderIds,
      orderProfitLoss, adSpendByDate, globalNdrRate, fixedMonthlyTotal]);

  const handleDiscardOrders = async () => {
    if (selectedOrders.size === 0) return;

    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const orderNames = orderIds.map(id => {
        const order = ordersById.get(id);
        return order?.name || '';
      });

      const response = await api.discardOrders(orderIds, orderNames);
      if (response.success) {
        // Update local state
        setDiscardedOrderIds(new Set([...discardedOrderIds, ...orderIds]));
        setSelectedOrders(new Set());
        setSelectAll(false);
      }
    } catch (err) {
      console.error('Failed to discard orders:', err);
      toast.error(errorMessage(err, 'Failed to discard orders'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkAsRTO = async () => {
    if (selectedOrders.size === 0) return;

    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const orderNames = orderIds.map(id => {
        const order = ordersById.get(id);
        return order?.name || '';
      });

      const response = await api.markOrdersAsRTO(orderIds, orderNames);
      if (response.success) {
        // Update local state
        setRTOOrderIds(new Set([...rtoOrderIds, ...orderIds]));
        setSelectedOrders(new Set());
        setSelectAll(false);
      }
    } catch (err) {
      console.error('Failed to mark orders as RTO:', err);
      toast.error(errorMessage(err, 'Failed to mark orders as RTO'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnmarkRTO = async () => {
    if (selectedOrders.size === 0) return;

    setIsProcessing(true);
    try {
      const orderIds = Array.from(selectedOrders);
      const response = await api.unmarkOrdersAsRTO(orderIds);
      if (response.success) {
        // Update local state
        const newRTO = new Set(rtoOrderIds);
        orderIds.forEach(id => newRTO.delete(id));
        setRTOOrderIds(newRTO);
        setSelectedOrders(new Set());
        setSelectAll(false);
      }
    } catch (err) {
      console.error('Failed to unmark RTO orders:', err);
      toast.error(errorMessage(err, 'Failed to unmark RTO orders'));
    } finally {
      setIsProcessing(false);
    }
  };

  const getMonthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  };

  // Calculate delay days for unfulfilled orders
  const getDelayDays = (order: ShopifyOrder): number | null => {
    // Only calculate for unfulfilled orders
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
    const isUnfulfilled = !fulfillmentStatus || fulfillmentStatus === '' || fulfillmentStatus === 'unfulfilled';

    if (!isUnfulfilled) return null;

    const orderDate = new Date(order.createdAt);
    const today = new Date();

    // Reset time parts to compare dates only
    orderDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - orderDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Return null for 0 days (same day orders - no delay)
    return diffDays > 0 ? diffDays : null;
  };

  // Calculate delay days including 0 (for dropdown filter)
  const getDelayDaysIncludingZero = (order: ShopifyOrder): number | null => {
    const fulfillmentStatus = order.fulfillmentStatus?.toLowerCase() || '';
    const isUnfulfilled = !fulfillmentStatus || fulfillmentStatus === '' || fulfillmentStatus === 'unfulfilled';

    if (!isUnfulfilled) return null;

    const orderDate = new Date(order.createdAt);
    const today = new Date();

    orderDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - orderDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  // Get available delay days from unfulfilled orders
  const getAvailableDelayDays = (): number[] => {
    const unfulfilledOrders = orders.filter(order =>
      !order.cancelledAt &&
      !discardedOrderIds.has(order.id) &&
      (!order.fulfillmentStatus || order.fulfillmentStatus.toLowerCase() === 'unfulfilled')
    );

    const delayDaysSet = new Set<number>();
    unfulfilledOrders.forEach(order => {
      const days = getDelayDaysIncludingZero(order);
      if (days !== null) {
        delayDaysSet.add(days);
      }
    });

    return Array.from(delayDaysSet).sort((a, b) => a - b);
  };

  // Auto-detect variant from order line items
  const detectVariant = (order: ShopifyOrder): 'small' | 'large' => {
    if (!order.lineItems || order.lineItems.length === 0) {
      return 'small'; // Default to small
    }

    // Check if any line item contains "Large" in title or variant
    const hasLarge = order.lineItems.some(item =>
      item.title?.toLowerCase().includes('large') ||
      item.variantTitle?.toLowerCase().includes('large')
    );

    return hasLarge ? 'large' : 'small';
  };

  // Determine if order is delivered (got money) or NDR (no money)
  const isOrderDelivered = useCallback((order: ShopifyOrder): boolean => {
    // Check if order is in RTO list (Return to Origin = NDR)
    if (rtoOrderIds.has(order.id)) {
      return false;
    }

    // Check delivery status
    const status = order.deliveryStatus?.toLowerCase() || '';

    // NDR statuses: failed, RTO-related (attempted_delivery excluded from failed)
    const ndrStatuses = ['failed', 'rto', 'return'];
    if (ndrStatuses.some(s => status.includes(s))) {
      return false;
    }

    // Delivered status means we got the money
    if (status === 'delivered') {
      return true;
    }

    // Prepaid orders = already got the money, so treat as delivered for P/L calculation
    if (order.paymentMethod?.toLowerCase() === 'prepaid') {
      return true;
    }

    // In transit, confirmed, etc. are considered as not yet delivered (but not NDR either)
    // For P/L calculation, we'll treat these as "not delivered" = no revenue yet
    // But we won't apply NDR costs, just show 0 P/L
    return false;
  }, [rtoOrderIds]);

  // Calculate actual shipping charge with proper RTO COD handling
  const calculateActualShippingCharge = useCallback((order: ShopifyOrder): number => {
    if (!order.shippingBreakdown) {
      return order.shippingCharge || 0;
    }

    const { freightForward, freightCOD, freightRTO, whatsappCharges, otherCharges } = order.shippingBreakdown;

    // Check if this is an RTO COD order
    const isRTO = rtoOrderIds.has(order.id) ||
      order.deliveryStatus?.toLowerCase().includes('rto') ||
      order.deliveryStatus?.toLowerCase().includes('failed') ||
      freightRTO > 0;
    const isCODPayment = order.paymentMethod?.toLowerCase() === 'cod';

    // For RTO COD orders: COD is charged then reversed (net = 0)
    // So we don't include COD in the total for RTO COD orders
    if (isRTO && isCODPayment) {
      return freightForward + freightRTO + whatsappCharges + otherCharges;
    }

    // For all other orders: include COD normally
    return freightForward + freightCOD + freightRTO + whatsappCharges + otherCharges;
  }, [rtoOrderIds]);

  // Calculate profit/loss for an order based on delivery status and payment method
  const calculateOrderProfitLoss = useCallback((order: ShopifyOrder): number => {
    if (cogsVersions.length === 0) return 0;

    const orderDateStr = getOrderDateKey(order.createdAt);
    const version = getCogsVersionForDate(orderDateStr, cogsVersions);
    if (!version || version.fields.length === 0) return 0;

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
      fieldsToUse = version.fields.filter(f => f.type === 'cogs' || f.type === 'both');
    } else if (isFailed) {
      revenue = 0;
      fieldsToUse = version.fields.filter(f => f.type === 'ndr' || f.type === 'both');
    } else {
      revenue = 0;
      fieldsToUse = version.fields.filter(f => f.type === 'cogs' || f.type === 'both');
    }

    const valueKey = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;
    const salePrice = order.totalPrice || 0;

    const sumFields = (fields: COGSField[]) => {
      let sum = 0;
      fields.forEach(field => {
        let value = field[valueKey] as number;
        if (value === undefined || value === null) {
          value = variant === 'small' ? (field.smallValue || 0) : (field.largeValue || 0);
        }
        if (field.calculationType === 'fixed') {
          sum += value;
        } else {
          const pct = field.percentageType || 'excluded';
          sum += pct === 'included' ? (value / (100 + value)) * salePrice : (value / 100) * salePrice;
        }
      });
      return sum;
    };

    let totalCosts = 0;
    for (const cat of ['pre', 'post'] as const) {
      const override = version.totalOverrides?.[cat]?.[valueKey as keyof COGSTotalOverrides];
      if (override !== undefined) {
        totalCosts += override;
      } else {
        totalCosts += sumFields(fieldsToUse.filter(f => (f as any).category === cat || (cat === 'pre' && !(f as any).category)));
      }
    }

    const adCost = adCostPerOrderByDate[orderDateStr] ?? 0;
    const shippingCharge = calculateActualShippingCharge(order);

    return revenue - totalCosts - adCost - shippingCharge;
  }, [cogsVersions, isOrderDelivered, adCostPerOrderByDate, rtoOrderIds, calculateActualShippingCharge]);

  // Calculate P/L for all orders when config loads
  useEffect(() => {
    if (cogsVersions.length > 0 && orders.length > 0) {
      const profitLossMap = new Map<number, number>();
      orders.forEach(order => {
        const profitLoss = calculateOrderProfitLoss(order);
        profitLossMap.set(order.id, profitLoss);
      });
      setOrderProfitLoss(profitLossMap);
    }
  }, [cogsVersions, orders, calculateOrderProfitLoss]);

  const handleOpenCogsModal = (order: ShopifyOrder) => {
    setSelectedOrderForCogs(order);
    const variant = detectVariant(order);
    const paymentMethod = order.paymentMethod?.toLowerCase() === 'prepaid' ? 'prepaid' : 'cod';
    const orderDateStr = getOrderDateKey(order.createdAt);
    const adCost = adCostPerOrderByDate[orderDateStr] ?? 0;
    const version = getCogsVersionForDate(orderDateStr, cogsVersions);

    // Determine config type based on delivery status
    const configType = isOrderDelivered(order) ? 'cogs' : 'ndr';

    setSelectedVariant(variant);
    calculateCogsBreakdown(version?.fields ?? [], order.totalPrice || 0, variant, paymentMethod, configType, adCost, version?.totalOverrides);
    setShowCogsModal(true);
  };

  const handleUpdateDeliveryStatus = (orderId: number, orderName: string) => {
    setSelectedOrderForStatus({ id: orderId, name: orderName });
    setStatusChoice('Delivered');
    setShowDeliveryStatusModal(true);
  };

  const handleMarkDeliveryStatus = async (status: 'Delivered' | 'Failed') => {
    if (!selectedOrderForStatus) return;

    setUpdatingStatus(true);
    try {
      const response = await api.updateOrderDeliveryStatus(selectedOrderForStatus.name, status);

      if (response.success) {
        // Reload data to reflect the change
        await loadOrders(selectedMonthFilter, true);
        setShowDeliveryStatusModal(false);
        setSelectedOrderForStatus(null);
        toast.success('Delivery status updated successfully');
      } else {
        toast.error(`Failed to update delivery status: ${response.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating delivery status:', error);
      toast.error(errorMessage(error, 'An error occurred while updating delivery status'));
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddCustomerTag = (customerId: number, tag: string) => {
    setConfirmAction({
      title: `Add the "${tag}" tag to this customer?`,
      description: 'The tag goes on the customer of this order.',
      confirmLabel: 'Add tag',
      run: async () => {
        try {
          const response = await api.addCustomerTag(customerId, tag);
          if (response.success) {
            await api.clearOrdersCache();
            await loadOrders(selectedMonthFilter, true);
            toast.success('Tag added successfully');
          } else {
            toast.error(`Error: ${response.error || 'Failed to add tag'}`);
          }
        } catch (error) {
          console.error('Error adding customer tag:', error);
          toast.error(errorMessage(error, 'Failed to add tag'));
        }
      },
    });
  };

  const handleAcknowledgeOrder = async (orderId: number, orderName: string) => {
    try {
      const response = await api.acknowledgeOrders([orderId], [orderName]);
      if (response.success) {
        setAcknowledgedOrderIds(new Set([...acknowledgedOrderIds, orderId]));
        toast.success(`Order ${orderName} acknowledged`);
      } else {
        toast.error(`Error: ${response.error || 'Failed to acknowledge order'}`);
      }
    } catch (error) {
      console.error('Error acknowledging order:', error);
      toast.error(errorMessage(error, 'Failed to acknowledge order'));
    }
  };

  const handleMarkTicketRaised = async (orderId: number, orderName: string) => {
    try {
      const response = await api.markTicketRaisedOrders([orderId], [orderName]);
      if (response.success) {
        setTicketRaisedOrderIds(new Set([...ticketRaisedOrderIds, orderId]));
        toast.success(`Order ${orderName} marked as Ticket Raised`);
      } else {
        toast.error(`Error: ${response.error || 'Failed to mark ticket raised'}`);
      }
    } catch (error) {
      console.error('Error marking order as ticket raised:', error);
      toast.error(errorMessage(error, 'Failed to mark ticket raised'));
    }
  };

  const handleBulkAddNoCOD = async () => {
    if (selectedOrders.size === 0) return;

    // Get unique customer IDs from selected orders
    const selectedOrderIds = Array.from(selectedOrders);
    const customerIds = Array.from(new Set(
      selectedOrderIds
        .map(id => ordersById.get(id)?.customerId)
        .filter((id): id is number => !!id)
    ));

    if (customerIds.length === 0) {
      toast.error('Selected orders do not have associated customer IDs');
      return;
    }

    setConfirmAction({
      title: `Add the "no-cod" tag to ${customerIds.length} ${customerIds.length === 1 ? 'customer' : 'customers'}?`,
      description: 'The tag goes on the customers of the selected orders.',
      confirmLabel: 'Add tag',
      run: async () => {
        setIsProcessing(true);
        try {
          const response = await api.bulkAddCustomerTags(customerIds, 'no-cod');
          if (response.success) {
            await api.clearOrdersCache();
            await loadOrders(selectedMonthFilter, true);
            setSelectedOrders(new Set());
            setSelectAll(false);
            if (response.summary) {
              toast.success(`Successfully updated ${response.summary.successful} customers. Failed: ${response.summary.failed}.`);
            } else {
              toast.success('Customers updated successfully');
            }
          } else {
            toast.error(`Error: ${response.error || 'Failed to update customers'}`);
          }
        } catch (err) {
          console.error('Failed to add bulk customer tags:', err);
          toast.error(errorMessage(err, 'An error occurred during bulk operation'));
        } finally {
          setIsProcessing(false);
        }
      },
    });
  };

  const handleBulkAcknowledge = async () => {
    if (selectedOrders.size === 0) return;

    const selectedOrderIds = Array.from(selectedOrders);
    const selectedOrdersData = selectedOrderIds
      .map(id => ordersById.get(id))
      .filter((o): o is ShopifyOrder => !!o);
      
    const orderNames = selectedOrdersData.map(o => o.name);

    setConfirmAction({
      title: `Acknowledge ${selectedOrderIds.length} ${selectedOrderIds.length === 1 ? 'order' : 'orders'}?`,
      description: 'Acknowledged orders drop out of the Not acknowledged filter.',
      confirmLabel: 'Acknowledge',
      run: async () => {
        setIsProcessing(true);
        try {
          const response = await api.acknowledgeOrders(selectedOrderIds, orderNames);
          if (response.success) {
            setAcknowledgedOrderIds(new Set([...Array.from(acknowledgedOrderIds), ...selectedOrderIds]));
            setSelectedOrders(new Set());
            setSelectAll(false);
            toast.success(`Successfully acknowledged ${selectedOrderIds.length} orders`);
          } else {
            toast.error(`Error: ${response.error || 'Failed to acknowledge orders'}`);
          }
        } catch (err) {
          console.error('Failed to acknowledge orders:', err);
          toast.error(errorMessage(err, 'An error occurred during bulk operation'));
        } finally {
          setIsProcessing(false);
        }
      },
    });
  };

  const calculateCogsBreakdown = (
    fields: COGSField[],
    salePrice: number,
    variant: 'small' | 'large',
    paymentMethod: 'prepaid' | 'cod',
    configType: 'cogs' | 'ndr' | 'both',
    adCost?: number,
    overrides?: COGSOverrides
  ) => {
    const breakdown: COGSBreakdown[] = [];

    const fieldsToUse: COGSField[] =
      configType === 'cogs' ? fields.filter(f => f.type === 'cogs' || f.type === 'both') :
        configType === 'ndr' ? fields.filter(f => f.type === 'ndr' || f.type === 'both') :
          fields;

    const valueKey = `${variant}${paymentMethod === 'prepaid' ? 'Prepaid' : 'COD'}Value` as keyof COGSField;

    const calcField = (field: COGSField) => {
      let value = field[valueKey] as number;
      if (value === undefined || value === null) {
        value = variant === 'small' ? (field.smallValue || 0) : (field.largeValue || 0);
      }
      let calculatedCost = 0;
      if (field.calculationType === 'fixed') {
        calculatedCost = value;
      } else {
        const pct = field.percentageType || 'excluded';
        calculatedCost = pct === 'included' ? (value / (100 + value)) * salePrice : (value / 100) * salePrice;
      }
      return { value, calculatedCost };
    };

    for (const cat of ['pre', 'post'] as const) {
      const catFields = fieldsToUse.filter(f => (f as any).category === cat || (cat === 'pre' && !(f as any).category));
      const override = overrides?.[cat]?.[valueKey as keyof COGSTotalOverrides];
      if (override !== undefined) {
        const catLabel = cat === 'pre' ? 'Pre-cost total' : 'Post-cost total';
        breakdown.push({
          fieldName: `${catLabel} (override)`,
          type: 'cogs',
          calculationType: 'fixed',
          value: override,
          calculatedCost: override,
        });
      } else {
        catFields.forEach(field => {
          const { value, calculatedCost } = calcField(field);
          breakdown.push({
            fieldName: field.name,
            type: field.type,
            calculationType: field.calculationType,
            value,
            calculatedCost,
          });
        });
      }
    }

    if (adCost !== undefined && adCost > 0) {
      breakdown.push({
        fieldName: 'Ad cost (Meta)',
        type: 'cogs',
        calculationType: 'fixed',
        value: adCost,
        calculatedCost: adCost,
      });
    }

    setCogsBreakdown(breakdown);
  };

  const calculateTotalCogs = () => {
    // Sum COGS items only (exclude Ad Cost which is shown separately)
    return cogsBreakdown
      .filter(item => item.fieldName !== 'Ad cost (Meta)')
      .reduce((sum, item) => sum + item.calculatedCost, 0);
  };

  const periodOptions = [
    { value: 'current', label: 'This month' },
    { value: 'last30', label: 'Last 30 days' },
    { value: 'all', label: 'All time' },
    ...(availableMonths.length > 0 ? [{ divider: true as const }] : []),
    ...availableMonths.map((monthKey) => ({ value: monthKey, label: getMonthLabel(monthKey) })),
  ];

  const headerActions = (
    <>
      <Select
        label="Period"
        inlineLabel
        size="sm"
        value={selectedMonthFilter}
        onChange={(v) => {
          setSelectedMonthFilter(v);
          setSelectedOrders(new Set());
          setSelectAll(false);
        }}
        options={periodOptions}
        disabled={isLoading}
      />
      <Button size="sm" variant="secondary" icon="clipboard-list" onClick={() => setShowPendingDrawer(true)} disabled={isLoading}>
        Pending products
      </Button>
      <Button size="sm" variant="primary" icon="refresh-cw" onClick={handleRefresh} loading={isRefreshing} disabled={isLoading}>
        {isRefreshing ? 'Syncing…' : 'Sync from Shopify'}
      </Button>
    </>
  );

  const header = embedded ? (
    <div className={styles.embeddedBar}>{headerActions}</div>
  ) : (
    <PageHeader title="Sales management" description="Every order with its delivery status and profit or loss." actions={headerActions} />
  );

  if (isLoading) {
    return (
      <div className={embedded ? styles.embedded : styles.page} aria-busy="true">
        {header}
        <StatStrip>
          {[1, 2, 3, 4].map((i) => <StatCard key={i} label="" value="" loading />)}
        </StatStrip>
        <Skeleton height={56} />
        <Skeleton lines={8} />
      </div>
    );
  }

  // Total P/L: final and prepaid orders, ad spend on days without orders, then fixed costs
  const ordersCountedInPnl = ordersForStats.filter(o => {
    const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
    const isDelivered = deliveryStatus === 'delivered';
    const isFailed = rtoOrderIds.has(o.id) ||
      deliveryStatus === 'failure' ||
      deliveryStatus.includes('failed') ||
      deliveryStatus.includes('rto');
    return isDelivered || isFailed || (o.paymentMethod?.toLowerCase() === 'prepaid');
  });
  let totalPL = ordersCountedInPnl.reduce((sum, o) => sum + (orderProfitLoss.get(o.id) ?? 0), 0);
  const datesWithOrders = new Set(ordersForStats.map(o => getOrderDateKey(o.createdAt)));
  Object.entries(adSpendByDate).forEach(([dateKey, amount]) => {
    if (!isDateInSelectedMonth(dateKey)) return;
    if (!datesWithOrders.has(dateKey)) totalPL -= amount;
  });
  totalPL -= fixedMonthlyTotal;

  const toneOf = (v: number) => (v > 0 ? 'positive' : v < 0 ? 'negative' : 'neutral');

  // Status buttons double as the period's status breakdown; flags and payment narrow further.
  const statusFilters = [
    { key: 'unfulfilled', label: 'Unfulfilled', on: showUnfulfilled, set: setShowUnfulfilled, count: filterCounts.unfulfilled },
    { key: 'confirmed', label: 'Confirmed', on: showConfirmed, set: setShowConfirmed, count: filterCounts.confirmed },
    { key: 'inTransit', label: 'In transit', on: showInTransit, set: setShowInTransit, count: filterCounts.inTransit },
    { key: 'outForDelivery', label: 'Out for delivery', on: showOutForDelivery, set: setShowOutForDelivery, count: filterCounts.outForDelivery },
    { key: 'attempted', label: 'Attempted delivery', on: showAttemptedDelivery, set: setShowAttemptedDelivery, count: filterCounts.attempted },
    { key: 'delivered', label: 'Delivered', on: showDelivered, set: setShowDelivered, count: filterCounts.delivered },
    { key: 'failed', label: 'Failed', on: showFailed, set: setShowFailed, count: filterCounts.failed },
  ];
  const otherFilters = [
    { key: 'notAcknowledged', label: 'Not acknowledged', on: showNotAcknowledged, set: setShowNotAcknowledged, count: filterCounts.notAcknowledged.total },
    { key: 'ticket', label: 'Ticket raised', on: showTicketRaised, set: setShowTicketRaised, count: filterCounts.ticket.total },
  ];
  const paymentFilters = [
    { key: 'prepaid', label: 'Prepaid', on: showPrepaid, set: setShowPrepaid, count: filterCounts.prepaid.total },
    { key: 'cod', label: 'COD', on: showCOD, set: setShowCOD, count: filterCounts.cod.total },
  ];
  const matchedConditions = [...statusFilters, ...otherFilters].filter((f) => f.on).length;
  const anyFilter = hasStatusFilter || showPrepaid || showCOD;
  const clearFilters = () => {
    [...statusFilters, ...otherFilters, ...paymentFilters].forEach((f) => f.set(false));
  };

  const order = selectedOrderForCogs;
  const orderAdCost = order ? (adCostPerOrderByDate[getOrderDateKey(order.createdAt)] ?? 0) : 0;
  const orderTotalCosts = order ? calculateTotalCogs() + orderAdCost + calculateActualShippingCharge(order) : 0;
  const orderProfit = order ? (order.totalPrice || 0) - orderTotalCosts : 0;
  const shippingItems = (() => {
    if (!order || !order.shippingCharge || order.shippingCharge <= 0) return [];
    const b = order.shippingBreakdown;
    if (!b) return [{ label: 'Shipping charge', sub: 'Shiprocket', value: formatINR(order.shippingCharge, { decimals: 2 }) }];
    const rows: Array<{ label: string; sub: string; value: string; tone?: 'positive' }> = [];
    if (b.freightForward > 0) rows.push({ label: 'Base freight', sub: 'Shiprocket', value: formatINR(b.freightForward, { decimals: 2 }) });
    if (b.freightCOD !== 0) {
      // COD is only reversed when the order is RTO (listed, RTO/failed status, or RTO charges) and paid by COD
      const isRTO = rtoOrderIds.has(order.id) ||
        order.deliveryStatus?.toLowerCase().includes('rto') ||
        order.deliveryStatus?.toLowerCase().includes('failed') ||
        (b.freightRTO || 0) > 0;
      const isCODPayment = order.paymentMethod?.toLowerCase() === 'cod';
      rows.push({ label: 'Freight COD', sub: 'applied', value: formatINR(Math.abs(b.freightCOD), { decimals: 2 }) });
      if (isRTO && isCODPayment && b.freightCOD > 0) {
        rows.push({ label: 'Freight COD reversal', sub: 'RTO refund', value: formatINR(-Math.abs(b.freightCOD), { decimals: 2 }), tone: 'positive' });
      }
    }
    if (b.freightRTO > 0) rows.push({ label: 'Freight RTO', sub: 'return', value: formatINR(b.freightRTO, { decimals: 2 }) });
    if (b.whatsappCharges > 0) rows.push({ label: 'WhatsApp charges', sub: 'communication', value: formatINR(b.whatsappCharges, { decimals: 2 }) });
    if (b.otherCharges > 0) rows.push({ label: 'Other charges', sub: 'misc', value: formatINR(b.otherCharges, { decimals: 2 }) });
    return rows;
  })();
  const pendingProducts = getPendingProducts();
  const delayDayOptions = getAvailableDelayDays();

  return (
    <div className={embedded ? styles.embedded : styles.page}>
      {header}

      <StatStrip>
        <StatCard
          label="Total orders"
          value={stats.totalOrders.toLocaleString('en-IN')}
          sub={`${stats.prepaidCount.toLocaleString('en-IN')} prepaid · ${stats.codCount.toLocaleString('en-IN')} COD`}
        />
        <StatCard
          label="NDR rate"
          value={`${stats.ndrRate.toFixed(1)}%`}
          tone={stats.ndrRate > 15 ? 'caution' : 'neutral'}
          sub={`${stats.ndrCount.toLocaleString('en-IN')} of ${stats.finalStatusCount.toLocaleString('en-IN')} final`}
        />
        <StatCard
          label="Total P/L"
          value={formatINR(totalPL, { signed: true })}
          tone={toneOf(totalPL)}
          sub={cogsVersions.length > 0
            ? fixedMonthlyTotal > 0
              ? `incl. ${formatINR(fixedMonthlyTotal)} fixed costs`
              : 'delivered, failed and prepaid orders + ad-only days'
            : 'configure COGS to calculate'}
        />
        {expectedProfit && (
          <StatCard
            label={expectedProfit.isCurrentMonth ? 'Expected month-end P/L' : 'Projected P/L'}
            value={formatINR(expectedProfit.expectedPL, { signed: true })}
            tone={toneOf(expectedProfit.expectedPL)}
            sub={expectedProfit.isCurrentMonth
              ? `day ${expectedProfit.daysElapsed} of ${expectedProfit.totalDays} · ${expectedProfit.pendingOrdersCount.toLocaleString('en-IN')} pending`
              : `${expectedProfit.pendingOrdersCount.toLocaleString('en-IN')} pending orders`}
          >
            {/* "Now" is the Total P/L beside it, so the note keeps to the two parts still to come */}
            <Tooltip content={`Now ${formatINR(expectedProfit.currentPL, { signed: true })} · average per delivered order ${formatINR(expectedProfit.avgPLPerDeliveredOrder)}`}>
              <span className={styles.statNote}>
                {`pending ${formatINR(expectedProfit.expectedPendingPL, { signed: true, compact: true })} · rest ${formatINR(expectedProfit.expectedFuturePL, { signed: true, compact: true })}`}
              </span>
            </Tooltip>
          </StatCard>
        )}
      </StatStrip>

      <section className={styles.orders} aria-label="Order filters">
        <div className={styles.statusStrip} role="group" aria-label="Filter by delivery status">
          {statusFilters.map((f) => (
            <button key={f.key} type="button" className={styles.statusCell} aria-pressed={f.on} onClick={() => f.set(!f.on)}>
              <span className={styles.statusLabel}>{f.label}</span>
              <span className={styles.statusCount}>{f.count.total.toLocaleString('en-IN')}</span>
              <span className={styles.statusSplit}>{`${f.count.prepaid.toLocaleString('en-IN')} prepaid · ${f.count.cod.toLocaleString('en-IN')} COD`}</span>
            </button>
          ))}
        </div>

        <div className={styles.toolbar}>
          <div className={styles.chips} role="group" aria-label="More filters">
            {otherFilters.map((f) => (
              <button key={f.key} type="button" className={styles.chip} aria-pressed={f.on} onClick={() => f.set(!f.on)}>
                {f.label}<span className={styles.chipCount}>{f.count.toLocaleString('en-IN')}</span>
              </button>
            ))}
            <span className={styles.chipRule} aria-hidden="true" />
            {paymentFilters.map((f) => (
              <button key={f.key} type="button" className={styles.chip} aria-pressed={f.on} onClick={() => f.set(!f.on)}>
                {f.label}<span className={styles.chipCount}>{f.count.toLocaleString('en-IN')}</span>
              </button>
            ))}
          </div>
          {matchedConditions >= 2 && (
            <SegmentedControl
              size="sm"
              label="Match"
              value={filterOperator}
              onChange={(v) => setFilterOperator(v as 'AND' | 'OR')}
              options={[{ value: 'OR', label: 'Match any' }, { value: 'AND', label: 'Match all' }]}
            />
          )}
          {anyFilter && <Button size="sm" variant="ghost" icon="x" onClick={clearFilters}>Clear filters</Button>}
          <span className={styles.toolbarEnd}>
            <span className={styles.count}>{`${filteredOrders.length.toLocaleString('en-IN')} ${filteredOrders.length === 1 ? 'order' : 'orders'}`}</span>
            <Checkbox
              label="Select all"
              checked={selectAll}
              indeterminate={selectedOrders.size > 0 && !selectAll}
              onChange={handleSelectAll}
              disabled={filteredOrders.length === 0}
            />
            <Switch label="AWB column" checked={showAWBColumn} onChange={(e) => setShowAWBColumn(e.target.checked)} />
          </span>
        </div>
      </section>

      {selectedOrders.size > 0 && (
        <div className={cx('pbx-table__bulk', styles.bulk)} role="region" aria-label="Selection">
          <span><strong>{selectedOrders.size.toLocaleString('en-IN')}</strong> selected</span>
          <div className="pbx-table__bulk-actions">
            <Button size="sm" variant="secondary" icon="bookmark" onClick={handleBulkAcknowledge} disabled={isProcessing}>Acknowledge</Button>
            <Button size="sm" variant="secondary" icon="truck" onClick={handleMarkAsRTO} disabled={isProcessing}>Mark RTO</Button>
            <Menu
              label="More bulk actions"
              trigger={<Button size="sm" variant="secondary" iconRight="chevron-down" loading={isProcessing}>More</Button>}
              items={[
                { label: 'Unmark RTO', icon: 'x', onSelect: handleUnmarkRTO },
                { label: 'Tag customers no-COD', icon: 'tag', onSelect: handleBulkAddNoCOD },
                { divider: true },
                {
                  label: 'Discard orders',
                  icon: 'trash-2',
                  tone: 'negative',
                  onSelect: () => setConfirmAction({
                    title: `Discard ${selectedOrders.size} ${selectedOrders.size === 1 ? 'order' : 'orders'}?`,
                    description: 'They leave the orders list and every figure on this page.',
                    confirmLabel: 'Discard',
                    danger: true,
                    run: handleDiscardOrders,
                  }),
                },
              ]}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setSelectedOrders(new Set()); setSelectAll(false); }}>Clear</Button>
        </div>
      )}
      <OrdersByDay
        days={ordersGroupedByDate}
        hasStatusFilter={hasStatusFilter}
        selectedOrders={selectedOrders}
        onSelectOrder={handleSelectOrder}
        onSelectDay={handleSelectDay}
        orderProfitLoss={orderProfitLoss}
        rtoOrderIds={rtoOrderIds}
        getDelayDays={getDelayDays}
        handleOpenCogsModal={handleOpenCogsModal}
        avgPnlPerFinalOrder={avgPnlPerFinalOrder}
        globalNdrRate={globalNdrRate}
        onUpdateDeliveryStatus={handleUpdateDeliveryStatus}
        onAddCustomerTag={handleAddCustomerTag}
        onAcknowledgeOrder={handleAcknowledgeOrder}
        acknowledgedOrderIds={acknowledgedOrderIds}
        onMarkTicketRaised={handleMarkTicketRaised}
        ticketRaisedOrderIds={ticketRaisedOrderIds}
        showAWBColumn={showAWBColumn}
      />

      <Drawer
        open={showPendingDrawer}
        onClose={() => setShowPendingDrawer(false)}
        title="Pending products"
        description="Unfulfilled orders, counted by product and variant"
        footer={pendingProducts.length > 0 ? (
          <>
            <span>{`${pendingProducts.length} ${pendingProducts.length === 1 ? 'product' : 'products'}`}</span>
            <span className="pbx-num">{`${pendingProducts.reduce((s, p) => s + p.count, 0).toLocaleString('en-IN')} to fulfil`}</span>
          </>
        ) : undefined}
      >
        <div className={styles.pendingFilters}>
          <div className={styles.filterRow}>
            <span className={styles.filterLabel}>Payment</span>
            <button type="button" className={styles.chip} aria-pressed={pendingFilterCOD} onClick={() => setPendingFilterCOD(!pendingFilterCOD)}>COD</button>
            <button type="button" className={styles.chip} aria-pressed={pendingFilterPaid} onClick={() => setPendingFilterPaid(!pendingFilterPaid)}>Paid</button>
          </div>
          {delayDayOptions.length > 0 && (
            <div className={styles.filterRow}>
              <span className={styles.filterLabel}>Waiting</span>
              {delayDayOptions.map((days) => (
                <button
                  key={days}
                  type="button"
                  className={styles.chip}
                  aria-pressed={pendingFilterDelayDays.has(days)}
                  onClick={() => {
                    const next = new Set(pendingFilterDelayDays);
                    if (next.has(days)) next.delete(days);
                    else next.add(days);
                    setPendingFilterDelayDays(next);
                  }}
                >
                  {days === 0 ? 'Today' : `${days} day${days > 1 ? 's' : ''}`}
                </button>
              ))}
            </div>
          )}
          {(pendingFilterCOD || pendingFilterPaid || pendingFilterDelayDays.size > 0) && (
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={() => {
                setPendingFilterCOD(false);
                setPendingFilterPaid(false);
                setPendingFilterDelayDays(new Set());
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
        {pendingProducts.length === 0 ? (
          <EmptyState size="sm" icon="circle-check" title="No pending products" description="Every order here is fulfilled." />
        ) : (
          <ul className={styles.pendingList}>
            {pendingProducts.map((product, idx) => (
              <li key={idx} className={styles.pendingItem}>
                <div className={styles.pendingText}>
                  <span className={styles.pendingTitle}>{product.title}</span>
                  {product.variantTitle && <span className={styles.pendingVariant}>{product.variantTitle}</span>}
                  <span className={styles.pendingOrders}>{product.orderNumbers.join(', ')}</span>
                </div>
                <span className={styles.pendingCount}>{product.count}</span>
              </li>
            ))}
          </ul>
        )}
      </Drawer>

      <Dialog
        open={showCogsModal && !!order}
        onClose={() => setShowCogsModal(false)}
        size="lg"
        title={order ? `P/L breakdown · ${order.name}` : 'P/L breakdown'}
        description={order ? `${selectedVariant === 'small' ? 'Small' : 'Large'} book · ${isOrderDelivered(order) ? 'COGS' : 'NDR'} configuration` : undefined}
      >
        {order && (
          <div className={styles.breakdown}>
            <div className={styles.breakdownCol}>
              <DataList
                title="Order details"
                items={[
                  { label: 'Order', value: order.name },
                  { label: 'Sale price', value: formatINR(order.totalPrice || 0, { decimals: 2 }) },
                  { label: 'Variant', value: selectedVariant === 'small' ? 'Small book' : 'Large book' },
                  { label: 'Configuration', value: isOrderDelivered(order) ? 'COGS' : 'NDR' },
                ]}
              />
              {cogsBreakdown.length === 0 ? (
                <DataList title="COGS configuration" items={[{ label: 'No COGS configuration available', value: '—', tone: 'muted' }]} />
              ) : (
                <DataList
                  title="COGS configuration"
                  items={cogsBreakdown
                    .filter((item) => item.fieldName !== 'Ad cost (Meta)') // ad cost is shown on its own
                    .map((item) => ({
                      label: item.fieldName,
                      sub: item.calculationType === 'percentage' ? `${item.value.toFixed(1)}%` : formatINR(item.value, { decimals: 2 }),
                      value: formatINR(item.calculatedCost, { decimals: 2 }),
                    }))}
                />
              )}
              <DataList title="Advertisement cost" items={[{ label: 'Ad cost (Meta)', sub: 'per order', value: formatINR(orderAdCost, { decimals: 2 }) }]} />
            </div>
            <div className={styles.breakdownCol}>
              <DataList
                title="Shipping charges"
                items={shippingItems.length > 0 ? shippingItems : [{ label: 'No shipping charges available', value: '—', tone: 'muted' }]}
              />
              <DataList
                title="Cost summary"
                items={[
                  { label: 'Total COGS', sub: 'from configuration', value: formatINR(calculateTotalCogs(), { decimals: 2 }) },
                  { label: 'Ad cost', sub: 'Meta ads', value: formatINR(orderAdCost, { decimals: 2 }) },
                  { label: 'Shipping charge', sub: 'Shiprocket', value: formatINR(calculateActualShippingCharge(order), { decimals: 2 }) },
                ]}
                total={{ label: 'Total costs', value: formatINR(orderTotalCosts, { decimals: 2 }) }}
              />
              <DataList
                title="Net result"
                items={[
                  { label: 'Sale price', value: formatINR(order.totalPrice || 0, { decimals: 2 }) },
                  { label: 'Total costs', value: formatINR(-orderTotalCosts, { decimals: 2 }) },
                ]}
                total={{ label: orderProfit >= 0 ? 'Profit' : 'Loss', value: <Amount value={orderProfit} signed decimals={2} /> }}
              />
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={showDeliveryStatusModal && !!selectedOrderForStatus}
        onClose={() => !updatingStatus && setShowDeliveryStatusModal(false)}
        size="sm"
        title="Mark delivery status"
        description={selectedOrderForStatus ? `Order ${selectedOrderForStatus.name}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeliveryStatusModal(false)} disabled={updatingStatus}>Cancel</Button>
            <Button variant={statusChoice === 'Failed' ? 'danger' : 'primary'} loading={updatingStatus} onClick={() => handleMarkDeliveryStatus(statusChoice)}>
              {`Mark as ${statusChoice.toLowerCase()}`}
            </Button>
          </>
        }
      >
        <SegmentedControl
          label="Delivery status"
          value={statusChoice}
          onChange={(v) => setStatusChoice(v as 'Delivered' | 'Failed')}
          options={[{ value: 'Delivered', label: 'Delivered', icon: 'circle-check' }, { value: 'Failed', label: 'Failed', icon: 'circle-x' }]}
        />
      </Dialog>

      <Dialog
        open={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        size="sm"
        title={confirmAction?.title ?? ''}
        description={confirmAction?.description}
        icon={confirmAction?.danger ? 'triangle-alert' : undefined}
        tone={confirmAction?.danger ? 'negative' : 'neutral'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              variant={confirmAction?.danger ? 'danger' : 'primary'}
              onClick={() => {
                const run = confirmAction?.run;
                setConfirmAction(null);
                run?.();
              }}
            >
              {confirmAction?.confirmLabel}
            </Button>
          </>
        }
      />

      {refreshStatus && (
        <div className={styles.syncToast}>
          <Toast tone="info" title={refreshStatus} />
        </div>
      )}
    </div>
  );
}
