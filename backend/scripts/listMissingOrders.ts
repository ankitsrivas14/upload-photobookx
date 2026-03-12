
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function listMissingChargeOrders() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    
    // Cutoff date: 10 Jan 2026
    const cutoffDate = new Date('2026-01-10T00:00:00');

    // 1. Get RTO Order IDs
    const rtoOrders = await db.collection('rtoorders').find({}).toArray();
    const rtoOrderIds = new Set(rtoOrders.map(o => o.orderId));

    // 2. Get Shipping Charges
    const charges = await db.collection('shippingcharges').find({}).toArray();
    const chargeMap = new Map();
    charges.forEach(c => chargeMap.set(c.orderNumber, c));

    // 3. Get the latest Orders Cache
    const cache = await db.collection('shopifyordercaches').findOne({ cacheKey: 'all_orders_1000' });
    if (!cache || !cache.orders) {
      console.log('No order cache found.');
      return;
    }
    const orders = cache.orders;

    const missingChargeOrders: any[] = [];

    for (const order of orders) {
      if (order.cancelled_at) continue;

      // Filter by date
      const createdAt = new Date(order.created_at);
      if (createdAt < cutoffDate) continue;

      let deliveryStatus = null;
      if (order.fulfillments && order.fulfillments.length > 0) {
        const latestFulfillment = order.fulfillments[order.fulfillments.length - 1];
        deliveryStatus = latestFulfillment.shipment_status;
      }
      if (!deliveryStatus && order.fulfillment_status) {
        deliveryStatus = order.fulfillment_status;
      }

      const statusLower = (deliveryStatus || '').toLowerCase();
      
      const isFailed = rtoOrderIds.has(order.id) ||
        statusLower === 'failure' ||
        statusLower.includes('failed') ||
        statusLower.includes('rto') ||
        statusLower.includes('restocked');
      const isDelivered = statusLower === 'delivered';
      const isTerminal = isFailed || isDelivered;

      const chargeRecord = chargeMap.get(order.name);
      const hasChargeData = (chargeRecord?.shippingCharge ?? 0) > 0;

      if (isTerminal && !hasChargeData) {
        missingChargeOrders.push({
          name: order.name,
          date: order.created_at,
          status: statusLower
        });
      }
    }

    console.log(`FOUND ${missingChargeOrders.length} TERMINAL ORDERS (CREATED ON/AFTER 10 JAN 2026) MISSING SHIPPING CHARGE DATA:`);
    console.table(missingChargeOrders);
    console.log('\nOrder names only:');
    console.log(JSON.stringify(missingChargeOrders.map(o => o.name)));

    await mongoose.disconnect();
  } catch (err) {
    console.error('List failed:', err);
  }
}

listMissingChargeOrders();
