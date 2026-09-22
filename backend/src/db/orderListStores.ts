import { keyedStore } from './keyedStore';

/**
 * Firestore stores for the small order-membership lists and delivery dates that used
 * to live in Mongo. Each is one doc per order (id = shopifyOrderId, or orderNumber
 * for delivery dates).
 */
export const rtoStore = keyedStore<any>('rtoOrders', 'shopifyOrderId');
export const discardedStore = keyedStore<any>('discardedOrders', 'shopifyOrderId');
export const ackStore = keyedStore<any>('acknowledgedOrders', 'shopifyOrderId');
export const ticketStore = keyedStore<any>('ticketRaisedOrders', 'shopifyOrderId');
export const deliveryDateStore = keyedStore<any>('orderDeliveryDates', 'orderNumber');

/** The set of shopifyOrderIds currently in a membership store. */
export async function idSet(store: { all: () => Promise<any[]> }): Promise<Set<number>> {
  const docs = await store.all();
  return new Set(docs.map((d) => Number(d.shopifyOrderId)).filter((n) => !Number.isNaN(n)));
}
