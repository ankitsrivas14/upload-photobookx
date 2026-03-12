
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function listSyncOrders() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    
    const cutoffDate = new Date('2026-01-10T00:00:00');

    const rtoOrders = await db.collection('rtoorders').find({}).toArray();
    const rtoIds = new Set(rtoOrders.map(o => o.orderId));

    const cache = await db.collection('shopifyordercaches').findOne({ cacheKey: 'all_orders_1000' });
    if (!cache || !cache.orders) {
      console.log('No order cache found.');
      return;
    }

    const syncTerminal = [];
    const syncActive = [];

    for (const order of cache.orders) {
      if (order.cancelled_at) continue;
      if (new Date(order.created_at) < cutoffDate) continue;

      let shipmentStatus = null;
      if (order.fulfillments && order.fulfillments.length > 0) {
        shipmentStatus = order.fulfillments[order.fulfillments.length - 1].shipment_status;
      }
      const deliveryStatus = shipmentStatus || order.fulfillment_status || '';
      const statusLower = deliveryStatus.toLowerCase();

      const isFailed = rtoIds.has(order.id) ||
        statusLower === 'failure' ||
        statusLower.includes('failed') ||
        statusLower.includes('rto');
      const isDelivered = statusLower === 'delivered';
      const isTerminal = isFailed || isDelivered;

      const hasCharge = (order.shippingCharge ?? 0) > 0;

      if (isTerminal && !hasCharge) {
        syncTerminal.push({ name: order.name, date: order.created_at, status: statusLower });
      } else if (!isTerminal) {
        syncActive.push({ name: order.name, date: order.created_at, status: statusLower || 'pending' });
      }
    }

    console.log(`BREAKDOWN FOR 10 JAN 2026 CUTOFF:`);
    console.log(`1. Terminal Missing Charge: ${syncTerminal.length}`);
    console.log(`2. Active/In-Transit: ${syncActive.length}`);
    console.log(`TOTAL: ${syncTerminal.length + syncActive.length}`);
    
    console.log('\n--- TERMINAL ORDER NAMES (MISSING DATA) ---');
    console.log(JSON.stringify(syncTerminal.map(o => o.name)));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Failed:', err);
  }
}

listSyncOrders();
