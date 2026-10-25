import React, { useMemo } from 'react';
import { OrderRow } from './OrderRow';
import styles from '../SalesPage.module.css';
import { useVirtualRows } from '../../lib/useVirtualRows';

import { type ShopifyOrder } from '../../services/api';

interface OrdersTableBodyProps {
  hasStatusFilter: boolean;
  filteredOrders: ShopifyOrder[];
  ordersGroupedByDate: Array<{
    dateKey: string;
    dateLabel: string;
    orders: ShopifyOrder[];
    adSpend: number;
  }>;
  selectedOrders: Set<number>;
  onSelectOrder: (orderId: number) => void;
  orderProfitLoss: Map<number, number>;
  rtoOrderIds: Set<number>;
  getDelayDays: (order: ShopifyOrder) => number | null;
  getDeliveryStatusBadge: (status: string | null | undefined) => { text: string; className: string };
  handleOpenCogsModal: (order: ShopifyOrder) => void;
  formatIndianNumber: (num: number, decimals?: number) => string;
  avgPnlPerFinalOrder: number;
  globalNdrRate: number;
  onUpdateDeliveryStatus?: (orderId: number, orderName: string) => void;
  onAddCustomerTag?: (customerId: number, tag: string) => void;
  onAcknowledgeOrder?: (orderId: number, orderName: string) => void;
  acknowledgedOrderIds: Set<number>;
  onMarkTicketRaised?: (orderId: number, orderName: string) => void;
  ticketRaisedOrderIds: Set<number>;
  showAWBColumn?: boolean;
}

type DayGroup = OrdersTableBodyProps['ordersGroupedByDate'][number];

// One table row: a day header (grouped view) or an order.
type BodyItem = { kind: 'day'; group: DayGroup } | { kind: 'order'; order: ShopifyOrder };

interface DayHeaderRowProps {
  group: DayGroup;
  rtoOrderIds: Set<number>;
  orderProfitLoss: Map<number, number>;
  avgPnlPerFinalOrder: number;
  globalNdrRate: number;
  formatIndianNumber: (num: number, decimals?: number) => string;
  colSpan: number;
  rowRef?: React.Ref<HTMLTableRowElement>;
  index?: number;
}

const DayHeaderRow: React.FC<DayHeaderRowProps> = ({
  group: { dateLabel, orders, adSpend },
  rtoOrderIds,
  orderProfitLoss,
  avgPnlPerFinalOrder,
  globalNdrRate,
  formatIndianNumber,
  colSpan,
  rowRef,
  index,
}) => {
  const dayRevenue = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);

  const isOrderFinalStatus = (o: ShopifyOrder) => {
    const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
    const isDelivered = deliveryStatus === 'delivered';
    const isFailed = rtoOrderIds.has(o.id) ||
      deliveryStatus === 'failure' ||
      deliveryStatus.includes('failed') ||
      deliveryStatus.includes('rto');
    return isDelivered || isFailed;
  };

  const isOrderCountedInDayPnl = (o: ShopifyOrder) =>
    isOrderFinalStatus(o) || (o.paymentMethod?.toLowerCase() === 'prepaid');

  const dayPnL = orders.length > 0
    ? orders.reduce((s, o) => s + (isOrderCountedInDayPnl(o) ? (orderProfitLoss.get(o.id) ?? 0) : 0), 0)
    : -adSpend;

  const pendingCount = orders.filter((o) => !isOrderCountedInDayPnl(o)).length;
  const estimatedDayPnl = dayPnL + pendingCount * avgPnlPerFinalOrder;
  const expectedNdr = orders.length > 0 ? Math.ceil(orders.length * globalNdrRate / 100) : 0;

  return (
    <tr className={styles['day-header-row']} ref={rowRef} data-index={index}>
      <td colSpan={colSpan} className={styles['day-header-cell']}>
        <div className={styles['day-header-inner']}>
          <span className={styles['day-header-date']}>{dateLabel}</span>
          <span className={styles['day-header-ad-spend']}>
            Ad spend: {adSpend > 0 ? `₹${formatIndianNumber(adSpend)}` : '—'}
          </span>
          <span className={styles['day-header-revenue']}>
            Revenue: {orders.length > 0 ? `₹${formatIndianNumber(dayRevenue)}` : '—'}
          </span>
          <span className={`${styles['day-header-pnl']} ${dayPnL > 0 ? styles['pnl-profit'] : dayPnL < 0 ? styles['pnl-loss'] : ''}`}>
            P/L: {orders.length > 0 || adSpend > 0 ? `${dayPnL >= 0 ? '+' : ''}₹${formatIndianNumber(dayPnL)}` : '—'}
          </span>
          {orders.length > 0 && (
            <span className={`${styles['day-header-est-pnl']} ${estimatedDayPnl > 0 ? styles['pnl-profit'] : estimatedDayPnl < 0 ? styles['pnl-loss'] : ''}`}>
              Est. P/L: {estimatedDayPnl >= 0 ? '+' : ''}₹{formatIndianNumber(estimatedDayPnl)}
            </span>
          )}
          {orders.length > 0 && (
            <span className={styles['day-header-expected-ndr']}>
              Expected NDR: {expectedNdr}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
};

/** Stands in for the rows scrolled out of view, so the page keeps its full height. */
const SpacerRow: React.FC<{ height: number; colSpan: number }> = ({ height, colSpan }) => (
  <tr aria-hidden="true">
    <td colSpan={colSpan} style={{ height, padding: 0, border: 0 }} />
  </tr>
);

export const OrdersTableBody: React.FC<OrdersTableBodyProps> = ({
  hasStatusFilter,
  filteredOrders,
  ordersGroupedByDate,
  selectedOrders,
  onSelectOrder,
  orderProfitLoss,
  rtoOrderIds,
  getDelayDays,
  getDeliveryStatusBadge,
  handleOpenCogsModal,
  formatIndianNumber,
  avgPnlPerFinalOrder,
  globalNdrRate,
  onUpdateDeliveryStatus,
  onAddCustomerTag,
  onAcknowledgeOrder,
  acknowledgedOrderIds,
  onMarkTicketRaised,
  ticketRaisedOrderIds,
  showAWBColumn = false,
}) => {
  const colSpan = showAWBColumn ? 7 : 6;

  // Filtered view: a flat list of orders, no day headers. Grouped view: each day's header,
  // then its orders.
  const items = useMemo<BodyItem[]>(
    () =>
      hasStatusFilter
        ? filteredOrders.map((order) => ({ kind: 'order', order }))
        : ordersGroupedByDate.flatMap((group): BodyItem[] => [
            { kind: 'day', group },
            ...group.orders.map((order): BodyItem => ({ kind: 'order', order })),
          ]),
    [hasStatusFilter, filteredOrders, ordersGroupedByDate]
  );

  // Long lists (a busy month, all orders) render only the rows near the viewport.
  const { enabled, listRef, items: visible, paddingTop, paddingBottom, measureRef } = useVirtualRows<HTMLTableSectionElement>(
    items.length,
    (i) => (items[i].kind === 'day' ? 52 : 84),
    (i) => {
      const item = items[i];
      return item.kind === 'day' ? `day-${item.group.dateKey}` : item.order.id;
    }
  );

  if (items.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={colSpan} className={styles['empty-state']}>
            <div className={styles['empty-icon']}>📦</div>
            <div className={styles['empty-text']}>No orders found</div>
          </td>
        </tr>
      </tbody>
    );
  }

  const renderItem = (item: BodyItem, index?: number, rowRef?: React.Ref<HTMLTableRowElement>) =>
    item.kind === 'day' ? (
      <DayHeaderRow
        key={`day-${item.group.dateKey}`}
        group={item.group}
        rtoOrderIds={rtoOrderIds}
        orderProfitLoss={orderProfitLoss}
        avgPnlPerFinalOrder={avgPnlPerFinalOrder}
        globalNdrRate={globalNdrRate}
        formatIndianNumber={formatIndianNumber}
        colSpan={colSpan}
        rowRef={rowRef}
        index={index}
      />
    ) : (
      <OrderRow
        key={item.order.id}
        order={item.order}
        isSelected={selectedOrders.has(item.order.id)}
        onSelectOrder={onSelectOrder}
        orderProfitLoss={orderProfitLoss}
        rtoOrderIds={rtoOrderIds}
        getDelayDays={getDelayDays}
        getDeliveryStatusBadge={getDeliveryStatusBadge}
        handleOpenCogsModal={handleOpenCogsModal}
        onUpdateDeliveryStatus={onUpdateDeliveryStatus}
        onAddCustomerTag={onAddCustomerTag}
        onAcknowledgeOrder={onAcknowledgeOrder}
        acknowledgedOrderIds={acknowledgedOrderIds}
        onMarkTicketRaised={onMarkTicketRaised}
        ticketRaisedOrderIds={ticketRaisedOrderIds}
        showAWBColumn={showAWBColumn}
        rowRef={rowRef}
        index={index}
      />
    );

  return (
    <tbody ref={listRef}>
      {enabled ? (
        <>
          {paddingTop > 0 && <SpacerRow height={paddingTop} colSpan={colSpan} />}
          {visible.map((v) => renderItem(items[v.index], v.index, measureRef))}
          {paddingBottom > 0 && <SpacerRow height={paddingBottom} colSpan={colSpan} />}
        </>
      ) : (
        items.map((item) => renderItem(item))
      )}
    </tbody>
  );
};
