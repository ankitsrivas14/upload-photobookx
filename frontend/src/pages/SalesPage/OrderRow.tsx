import React from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Amount, Badge, Button, Checkbox, DeliveryBadge, Icon, Menu } from '../../components/ui/pbx';
import type { MenuItem } from '../../components/ui/pbx';
import styles from '../SalesPage.module.css';

import { type ShopifyOrder } from '../../services/api';

const STORE_TIMEZONE = 'Asia/Kolkata';

interface OrderRowProps {
  order: ShopifyOrder;
  isSelected: boolean;
  onSelectOrder: (orderId: number) => void;
  orderProfitLoss: Map<number, number>;
  rtoOrderIds: Set<number>;
  getDelayDays: (order: ShopifyOrder) => number | null;
  handleOpenCogsModal: (order: ShopifyOrder) => void;
  onUpdateDeliveryStatus?: (orderId: number, orderName: string) => void;
  onAddCustomerTag?: (customerId: number, tag: string) => void;
  onAcknowledgeOrder?: (orderId: number, orderName: string) => void;
  acknowledgedOrderIds: Set<number>;
  onMarkTicketRaised?: (orderId: number, orderName: string) => void;
  ticketRaisedOrderIds: Set<number>;
  showAWBColumn?: boolean;
  /** Set when the table is virtualised, so the row's real height can be measured. */
  rowRef?: React.Ref<HTMLTableRowElement>;
  index?: number;
}

export const OrderRow: React.FC<OrderRowProps> = ({
  order,
  isSelected,
  onSelectOrder,
  orderProfitLoss,
  rtoOrderIds,
  getDelayDays,
  handleOpenCogsModal,
  onUpdateDeliveryStatus,
  onAddCustomerTag,
  onAcknowledgeOrder,
  acknowledgedOrderIds,
  onMarkTicketRaised,
  ticketRaisedOrderIds,
  showAWBColumn = false,
  rowRef,
  index,
}) => {
  const navigate = useNavigate();
  const handleMarkDeliveryStatus = () => {
    if (onUpdateDeliveryStatus) {
      onUpdateDeliveryStatus(order.id, order.name);
    }
  };
  const handleMarkNoCOD = () => {
    if (onAddCustomerTag && order.customerId) {
      onAddCustomerTag(order.customerId, 'no-cod');
    } else if (!order.customerId) {
      toast.error('Customer ID not found for this order');
    }
  };
  const handleAcknowledge = () => {
    if (onAcknowledgeOrder) {
      onAcknowledgeOrder(order.id, order.name);
    }
  };
  const handleMarkTicket = () => {
    if (onMarkTicketRaised) {
      onMarkTicketRaised(order.id, order.name);
    }
  };

  const isPrepaid = order.paymentMethod?.toLowerCase() === 'prepaid';
  const isUnfulfilled = !order.fulfillmentStatus || order.fulfillmentStatus.toLowerCase() === 'unfulfilled';
  // Fulfilled, but Shiprocket has sent neither a status nor a charge. (A valid status like
  // 'failure' means Shiprocket answered, and a zero charge is then real.)
  const isMissingData = !isUnfulfilled && !order.cancelledAt && (order.shippingCharge ?? 0) === 0 && !order.deliveryStatus;
  const delayDays = getDelayDays(order);
  const isRTO = rtoOrderIds.has(order.id);
  const hasTicket = order.hasTicket || ticketRaisedOrderIds.has(order.id);
  const isAcknowledged = acknowledgedOrderIds.has(order.id);
  const awb = order.awbCode || (order.trackingUrl ? order.trackingUrl.split('/').filter(Boolean).pop() : null);

  // P/L counts once the order is final (delivered or failed), or straight away when prepaid.
  const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
  const isFinal = deliveryStatus === 'delivered' || isRTO ||
    deliveryStatus === 'failure' ||
    deliveryStatus.includes('failed') ||
    deliveryStatus.includes('rto');

  const placedAt = new Date(order.createdAt).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: STORE_TIMEZONE,
  });

  const menuItems: MenuItem[] = [
    { label: 'Mark delivery status', icon: 'circle-check', onSelect: handleMarkDeliveryStatus },
    { label: 'Tag customer no-COD', icon: 'tag', onSelect: handleMarkNoCOD },
  ];
  if (!hasTicket) menuItems.push({ label: 'Mark ticket raised', icon: 'life-buoy', onSelect: handleMarkTicket });
  if (!isAcknowledged) menuItems.push({ label: 'Acknowledge', icon: 'bookmark', onSelect: handleAcknowledge });

  return (
    <tr ref={rowRef} data-index={index} className={isSelected ? 'is-selected' : undefined}>
      <td className="pbx-table__check">
        <Checkbox aria-label={`Select ${order.name}`} checked={isSelected} onChange={() => onSelectOrder(order.id)} />
      </td>
      <td>
        <div className={styles.orderCell}>
          <span className={styles.orderName}>{order.name}</span>
          <Badge size="sm" dot={false} tone={isPrepaid ? 'info' : 'neutral'}>{isPrepaid ? 'Prepaid' : 'COD'}</Badge>
        </div>
      </td>
      <td className={styles.items}>
        {order.lineItems && order.lineItems.length > 0
          ? order.lineItems.map((item, idx) => (
              <div key={idx}>
                {item.quantity}× {item.title}
                {item.variantTitle ? <span className={styles.variant}> · {item.variantTitle}</span> : null}
              </div>
            ))
          : '—'}
      </td>
      {showAWBColumn && <td className="pbx-mono">{awb || '—'}</td>}
      <td>
        <div className={styles.badges}>
          {order.deliveryStatus ? (
            <DeliveryBadge status={order.deliveryStatus} size="sm" />
          ) : isUnfulfilled ? (
            <Badge size="sm">Unfulfilled</Badge>
          ) : null}
          {delayDays ? (
            <Badge size="sm" tone="caution" dot={false}>{delayDays} day{delayDays > 1 ? 's' : ''} delay</Badge>
          ) : null}
          {isMissingData && <Badge size="sm" tone="caution" dot={false} icon="triangle-alert">No tracking data</Badge>}
          {isRTO && <Badge size="sm" tone="negative" dot={false}>RTO</Badge>}
          {hasTicket && (
            <button type="button" className={styles.badgeLink} onClick={() => navigate('/admin/analysis/tickets')} title="Open tickets">
              <Badge size="sm" tone="info" dot={false} icon="life-buoy">Ticket</Badge>
            </button>
          )}
          {isAcknowledged && <Badge size="sm" dot={false} icon="check">Acknowledged</Badge>}
        </div>
      </td>
      <td className="pbx-num" style={{ textAlign: 'right' }}>
        {isFinal || isPrepaid ? <Amount value={orderProfitLoss.get(order.id) || 0} signed pill /> : <span className="pbx-amount--none">—</span>}
      </td>
      <td className={styles.date}>{placedAt}</td>
      <td>
        <div className={styles.rowActions}>
          {order.trackingUrl ? (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="pbx-btn pbx-btn--ghost pbx-btn--sm pbx-btn--icon"
              title="Track shipment"
              aria-label={`Track ${order.name}`}
            >
              <Icon name="external-link" size={14} />
            </a>
          ) : (
            <span className={styles.actionGap} aria-hidden="true" />
          )}
          <Button size="sm" variant="ghost" iconOnly icon="file-text" title="P/L breakdown" onClick={() => handleOpenCogsModal(order)}>
            {`P/L breakdown for ${order.name}`}
          </Button>
          <Menu
            label={`Actions for ${order.name}`}
            trigger={<Button size="sm" variant="ghost" iconOnly icon="ellipsis-vertical" title="More actions">{`More actions for ${order.name}`}</Button>}
            items={menuItems}
          />
        </div>
      </td>
    </tr>
  );
};
