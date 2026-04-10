import React from 'react';
import { OrderRow } from './OrderRow';
import styles from '../SalesPage.module.css';

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
  if (hasStatusFilter) {
    // Filtered view: flat list, no day headers
    if (filteredOrders.length === 0) {
      return (
        <tbody>
          <tr>
            <td colSpan={showAWBColumn ? 7 : 6} className={styles['empty-state']}>
              <div className={styles['empty-icon']}>📦</div>
              <div className={styles['empty-text']}>No orders found</div>
            </td>
          </tr>
        </tbody>
      );
    }

    return (
      <tbody>
        {filteredOrders.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            isSelected={selectedOrders.has(order.id)}
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
          />
        ))}
      </tbody>
    );
  }

  // Grouped view: orders grouped by date with day headers
  if (ordersGroupedByDate.length === 0) {
    return (
      <tbody>
        <tr>
          <td colSpan={showAWBColumn ? 7 : 6} className={styles['empty-state']}>
            <div className={styles['empty-icon']}>📦</div>
            <div className={styles['empty-text']}>No orders found</div>
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody>
      {ordersGroupedByDate.map(({ dateKey, dateLabel, orders, adSpend }) => {
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
          <React.Fragment key={`day-${dateKey}`}>
            <tr className={styles['day-header-row']}>
              <td colSpan={showAWBColumn ? 7 : 6} className={styles['day-header-cell']}>
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
            {orders.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                isSelected={selectedOrders.has(order.id)}
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
              />
            ))}
          </React.Fragment>
        );
      })}
    </tbody>
  );
};
