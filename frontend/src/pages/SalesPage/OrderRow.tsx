import React from 'react';
import { MoreVertical, CheckCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import styles from '../SalesPage.module.css';

interface ShippingChargeBreakdown {
  freightForward: number;
  freightCOD: number;
  freightRTO: number;
  whatsappCharges: number;
  otherCharges: number;
}

interface ShopifyOrder {
  id: number;
  name: string;
  email?: string;
  createdAt: string;
  fulfillmentStatus?: string | null;
  deliveryStatus?: string | null;
  deliveredAt?: string | null;
  trackingUrl?: string | null;
  paymentMethod?: string;
  maxUploads: number;
  totalPrice?: number;
  shippingCharge?: number;
  shippingBreakdown?: ShippingChargeBreakdown;
  cancelledAt?: string | null;
  lineItems?: Array<{
    title: string;
    quantity: number;
    variantTitle?: string;
  }>;
}

interface OrderRowProps {
  order: ShopifyOrder;
  isSelected: boolean;
  onSelectOrder: (orderId: number) => void;
  orderProfitLoss: Map<number, number>;
  rtoOrderIds: Set<number>;
  getDelayDays: (order: ShopifyOrder) => number | null;
  getDeliveryStatusBadge: (status: string | null | undefined) => { text: string; className: string };
  handleOpenCogsModal: (order: ShopifyOrder) => void;
  onUpdateDeliveryStatus?: (orderId: number, orderName: string) => void;
}

export const OrderRow: React.FC<OrderRowProps> = ({
  order,
  isSelected,
  onSelectOrder,
  orderProfitLoss,
  rtoOrderIds,
  getDelayDays,
  getDeliveryStatusBadge,
  handleOpenCogsModal,
  onUpdateDeliveryStatus,
}) => {
  const handleMarkDeliveryStatus = () => {
    if (onUpdateDeliveryStatus) {
      onUpdateDeliveryStatus(order.id, order.name);
    }
  };

  return (
    <tr
      key={order.id}
      className={isSelected ? styles.selected : ''}
    >
      <td className={styles['checkbox-cell']}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onSelectOrder(order.id)}
          className={styles['table-checkbox']}
        />
      </td>
      <td className={styles['order-name']}>
        <div className={styles['order-name-wrapper']}>
          <span className={`${styles['payment-dot']} ${styles[order.paymentMethod?.toLowerCase() || 'prepaid']}`}></span>
          <span className={styles['order-number']}>{order.name}</span>
        </div>
      </td>
      <td className={styles['line-items']}>
        {order.lineItems && order.lineItems.length > 0 ? (
          <div className={styles['items-list']}>
            {order.lineItems.map((item, idx) => (
              <div key={idx} className={styles.item}>
                {item.quantity}x {item.title}
                {item.variantTitle && ` (${item.variantTitle})`}
              </div>
            ))}
          </div>
        ) : (
          '—'
        )}
      </td>
      <td className={styles['order-tags']}>
        <div className={styles['tags-wrapper']}>
          {(() => {
            const delayDays = getDelayDays(order);
            if (delayDays) {
              return (
                <span className={`${styles['tag-badge']} ${styles['delay-tag']}`}>
                  {delayDays} day{delayDays > 1 ? 's' : ''} delay
                </span>
              );
            }
            return null;
          })()}
          {(() => {
            const deliveryBadge = getDeliveryStatusBadge(order.deliveryStatus);
            return deliveryBadge.text !== '—' && (
              <span className={`${styles['tag-badge']} ${styles[`delivery-${deliveryBadge.className}`]}`}>
                {deliveryBadge.text}
              </span>
            );
          })()}
          {rtoOrderIds.has(order.id) && (
            <span className={`${styles['tag-badge']} ${styles.rto}`}>RTO</span>
          )}
        </div>
      </td>
      <td className={styles['profit-loss-cell']}>
        {(() => {
          const deliveryStatus = order.deliveryStatus?.toLowerCase() || '';
          const isDelivered = deliveryStatus === 'delivered';
          const isFailed = rtoOrderIds.has(order.id) ||
            deliveryStatus === 'failure' ||
            deliveryStatus.includes('failed') ||
            deliveryStatus.includes('rto');
          const isPrepaid = order.paymentMethod?.toLowerCase() === 'prepaid';
          if (!isDelivered && !isFailed && !isPrepaid) {
            return <span className={styles['profit-loss-pending']}>—</span>;
          }
          const profitLoss = orderProfitLoss.get(order.id) || 0;
          const isProfit = profitLoss > 0;
          const isLoss = profitLoss < 0;
          return (
            <span className={`${styles['profit-loss-value']} ${isProfit ? styles.profit : isLoss ? styles.loss : styles.neutral}`}>
              {isProfit ? '+' : ''}₹{profitLoss.toFixed(0)}
            </span>
          );
        })()}
      </td>
      <td className={styles['order-date']}>
        {new Date(order.createdAt).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })}
      </td>
      <td className={styles['actions-cell']}>
        <div className={styles['action-buttons']}>
          {order.trackingUrl && (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles['action-btn']}
              title="Open tracking link"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          )}
          <button
            onClick={() => handleOpenCogsModal(order)}
            className={styles['action-btn']}
            title="View Breakdown"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={styles['action-btn']}
                title="More actions"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <MoreVertical style={{ width: '18px', height: '18px' }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="font-sans">
              <DropdownMenuItem onClick={handleMarkDeliveryStatus} className={styles['action-dropdown-item']}>
                <CheckCircle />
                <span>Mark Delivery Status</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </td>
    </tr>
  );
};
