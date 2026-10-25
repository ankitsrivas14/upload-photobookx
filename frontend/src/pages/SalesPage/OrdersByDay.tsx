import React from 'react';
import { OrderRow } from './OrderRow';
import styles from '../SalesPage.module.css';
import { useVirtualRows, VIRTUALIZE_AFTER } from '../../lib/useVirtualRows';
import { Amount, Card, Checkbox, EmptyState, Tooltip } from '../../components/ui/pbx';

import { type ShopifyOrder } from '../../services/api';

export interface DayGroup {
  dateKey: string;
  dateLabel: string;
  orders: ShopifyOrder[];
  adSpend: number;
}

interface OrdersByDayProps {
  /** Days newest first. With a status filter on, only days with matching orders are shown, without day figures. */
  days: DayGroup[];
  hasStatusFilter: boolean;
  selectedOrders: Set<number>;
  onSelectOrder: (orderId: number) => void;
  onSelectDay: (orderIds: number[], select: boolean) => void;
  orderProfitLoss: Map<number, number>;
  rtoOrderIds: Set<number>;
  getDelayDays: (order: ShopifyOrder) => number | null;
  handleOpenCogsModal: (order: ShopifyOrder) => void;
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

const plural = (n: number, word: string) => `${n.toLocaleString('en-IN')} ${word}${n === 1 ? '' : 's'}`;
const weekday = (dateKey: string) => new Date(dateKey + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long' });

/** A day's revenue, P/L so far, estimated P/L once pending orders settle, and expected NDR. */
function dayFigures(
  { orders, adSpend }: DayGroup,
  rtoOrderIds: Set<number>,
  orderProfitLoss: Map<number, number>,
  avgPnlPerFinalOrder: number,
  globalNdrRate: number
) {
  const revenue = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);

  const isOrderFinalStatus = (o: ShopifyOrder) => {
    const deliveryStatus = o.deliveryStatus?.toLowerCase() || '';
    const isDelivered = deliveryStatus === 'delivered';
    const isFailed = rtoOrderIds.has(o.id) ||
      deliveryStatus === 'failure' ||
      deliveryStatus.includes('failed') ||
      deliveryStatus.includes('rto');
    return isDelivered || isFailed;
  };

  // P/L counts once an order is final (delivered or failed), or straight away when prepaid.
  const isOrderCountedInDayPnl = (o: ShopifyOrder) =>
    isOrderFinalStatus(o) || (o.paymentMethod?.toLowerCase() === 'prepaid');

  const pnl = orders.length > 0
    ? orders.reduce((s, o) => s + (isOrderCountedInDayPnl(o) ? (orderProfitLoss.get(o.id) ?? 0) : 0), 0)
    : -adSpend;

  const pendingCount = orders.filter((o) => !isOrderCountedInDayPnl(o)).length;
  const estimatedPnl = pnl + pendingCount * avgPnlPerFinalOrder;
  const expectedNdr = orders.length > 0 ? Math.ceil(orders.length * globalNdrRate / 100) : 0;

  return { revenue, pnl, pendingCount, estimatedPnl, expectedNdr };
}

/**
 * Sales management orders: one card per day, side by side with the page's other cards (not inside
 * them), with the day's figures in the card header and its own table. Long periods render only the
 * days near the viewport.
 */
export const OrdersByDay: React.FC<OrdersByDayProps> = (props) => {
  const { days: allDays, hasStatusFilter, selectedOrders, onSelectDay, showAWBColumn = false } = props;
  const days = hasStatusFilter ? allDays.filter((d) => d.orders.length > 0) : allDays;

  // Virtualise by day once the period holds more rows than the table renders comfortably.
  const totalRows = days.reduce((s, d) => s + d.orders.length + 4, 0);
  const { enabled, listRef, items, paddingTop, paddingBottom, measureRef } = useVirtualRows<HTMLDivElement>(
    days.length,
    (i) => 170 + days[i].orders.length * 64,
    (i) => days[i].dateKey,
    { enabled: totalRows > VIRTUALIZE_AFTER }
  );

  if (days.length === 0) {
    return <EmptyState icon="search" title="No orders found" description="Try another period, or clear the filters." />;
  }

  const renderDay = (group: DayGroup) => {
    const ids = group.orders.map((o) => o.id);
    const selectedHere = ids.reduce((n, id) => n + (selectedOrders.has(id) ? 1 : 0), 0);
    const allSelected = ids.length > 0 && selectedHere === ids.length;
    const f = dayFigures(group, props.rtoOrderIds, props.orderProfitLoss, props.avgPnlPerFinalOrder, props.globalNdrRate);
    const hasOrders = group.orders.length > 0;

    const figures = hasStatusFilter ? undefined : (
          <dl className={styles.dayFigures}>
            <div>
              <dt>Revenue</dt>
              <dd>{hasOrders ? <Amount value={f.revenue} /> : '—'}</dd>
            </div>
            <div>
              <dt>Ad spend</dt>
              <dd>{group.adSpend > 0 ? <Amount value={group.adSpend} /> : '—'}</dd>
            </div>
            <div>
              <dt>P/L so far</dt>
              <dd>{hasOrders || group.adSpend > 0 ? <Amount value={f.pnl} signed /> : '—'}</dd>
            </div>
            <Tooltip content={f.pendingCount > 0 ? `${plural(f.pendingCount, 'order')} still pending, counted at the average P/L` : undefined}>
              <div>
                <dt>Est. P/L</dt>
                <dd>{hasOrders ? <Amount value={f.estimatedPnl} signed /> : '—'}</dd>
              </div>
            </Tooltip>
            <div>
              <dt>Expected NDR</dt>
              <dd>{hasOrders ? f.expectedNdr.toLocaleString('en-IN') : '—'}</dd>
            </div>
          </dl>
    );

    return (
      <Card
        aria-label={`Orders of ${group.dateLabel}`}
        title={group.dateLabel}
        eyebrow={`${weekday(group.dateKey)} · ${plural(group.orders.length, hasStatusFilter ? 'matching order' : 'order')}`}
        actions={figures}
      >
        {hasOrders ? (
          <div className={`pbx-table pbx-table--comfortable ${styles.table}`}>
            <div className={styles.tableScroll}>
              <table>
                <caption className="pbx-sr">{`Orders placed on ${group.dateLabel}`}</caption>
                <thead>
                  <tr>
                    <th className="pbx-table__check">
                      <Checkbox
                        aria-label={`Select the orders of ${group.dateLabel}`}
                        checked={allSelected}
                        indeterminate={selectedHere > 0 && !allSelected}
                        onChange={() => onSelectDay(ids, !allSelected)}
                      />
                    </th>
                    <th scope="col">Order</th>
                    <th scope="col">Payment</th>
                    <th scope="col">Items</th>
                    {showAWBColumn && <th scope="col">AWB</th>}
                    <th scope="col">Status</th>
                    <th scope="col" className={styles.num}>P/L</th>
                    <th scope="col">Time</th>
                    <th scope="col"><span className="pbx-sr">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {group.orders.map((order) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      isSelected={selectedOrders.has(order.id)}
                      onSelectOrder={props.onSelectOrder}
                      orderProfitLoss={props.orderProfitLoss}
                      rtoOrderIds={props.rtoOrderIds}
                      getDelayDays={props.getDelayDays}
                      handleOpenCogsModal={props.handleOpenCogsModal}
                      onUpdateDeliveryStatus={props.onUpdateDeliveryStatus}
                      onAddCustomerTag={props.onAddCustomerTag}
                      onAcknowledgeOrder={props.onAcknowledgeOrder}
                      acknowledgedOrderIds={props.acknowledgedOrderIds}
                      onMarkTicketRaised={props.onMarkTicketRaised}
                      ticketRaisedOrderIds={props.ticketRaisedOrderIds}
                      showAWBColumn={showAWBColumn}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className={styles.noOrders}>No orders this day.</p>
        )}
      </Card>
    );
  };

  return (
    <div ref={listRef} className={styles.days}>
      {enabled ? (
        <>
          {paddingTop > 0 && <div aria-hidden="true" style={{ height: paddingTop }} />}
          {items.map((v) => (
            <div key={days[v.index].dateKey} ref={measureRef} data-index={v.index} className={styles.day}>
              {renderDay(days[v.index])}
            </div>
          ))}
          {paddingBottom > 0 && <div aria-hidden="true" style={{ height: paddingBottom }} />}
        </>
      ) : (
        days.map((d) => (
          <div key={d.dateKey} className={styles.day}>
            {renderDay(d)}
          </div>
        ))
      )}
    </div>
  );
};
