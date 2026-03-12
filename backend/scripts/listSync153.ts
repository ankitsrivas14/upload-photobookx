
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

    // Get all orders from cache
    const cache = await db.collection('shopifyordercaches').findOne({ cacheKey: 'all_orders_1000' });
    if (!cache || !cache.orders) {
      console.log('No order cache found.');
      return;
    }

    // Get all ShippingCharges to check who has data
    const charges = await db.collection('shippingcharges').find({}).toArray();
    const chargeMap = new Map();
    charges.forEach(c => {
        chargeMap.set(c.orderNumber, (c.shippingCharge ?? 0) > 0);
        const clean = c.orderNumber.replace(/^#/, '');
        chargeMap.set(clean, (c.shippingCharge ?? 0) > 0);
        chargeMap.set('#'+clean, (c.shippingCharge ?? 0) > 0);
    });

    const rtoOrders = await db.collection('rtoorders').find({}).toArray();
    const rtoIds = new Set(rtoOrders.map(o => o.orderId));

    const syncList = [];

    for (const order of cache.orders) {
      if (order.cancelled_at) continue;
      if (new Date(order.created_at) < cutoffDate) continue;

      // New constraint: Ignore unfulfilled orders
      const fulfillmentStatus = order.fulfillment_status;
      const isUnfulfilled = !fulfillmentStatus || fulfillmentStatus === 'unfulfilled';
      
      let shipmentStatus = null;
      if (order.fulfillments && order.fulfillments.length > 0) {
        shipmentStatus = order.fulfillments[order.fulfillments.length - 1].shipment_status;
      }
      const deliveryStatus = shipmentStatus || fulfillmentStatus || '';
      const statusLower = deliveryStatus.toLowerCase();

      const isFailed = rtoIds.has(order.id) ||
        statusLower === 'failure' ||
        statusLower.includes('failed') ||
        statusLower.includes('rto');
      const isDelivered = statusLower === 'delivered';
      const isTerminal = isFailed || isDelivered;

      const hasCharge = chargeMap.get(order.name) || false;

      // If it's unfulfilled, we don't sync charges
      if (isUnfulfilled) continue;

      // Needs sync if:
      // 1. Not in a terminal state (needs status update from Shiprocket)
      // 2. IS in a terminal state but missing charge data
      if (!isTerminal || !hasCharge) {
        syncList.push({ 
          name: order.name, 
          status: deliveryStatus || 'fulfilled', 
          hasCharge, 
          isTerminal,
          orderDate: order.created_at
        });
      }
    }

    console.log(`TOTAL ORDERS MATCHING SYNC CRITERIA: ${syncList.length}`);
    console.log(`\nBREAKDOWN:`);
    const active = syncList.filter(o => !o.isTerminal);
    const terminalMissingCharge = syncList.filter(o => o.isTerminal && !o.hasCharge);
    
    console.log(`- Active/In-Transit (needs status update): ${active.length}`);
    console.log(`- Terminal but Missing Charge (needs financial data): ${terminalMissingCharge.length}`);

    console.log('\n--- SAMPLES OF TERMINAL MISSING CHARGE ---');
    console.log(JSON.stringify(terminalMissingCharge.slice(0, 10).map(o => o.name)));
    
    console.log('\n--- SAMPLES OF ACTIVE/IN-TRANSIT ---');
    console.log(JSON.stringify(active.slice(0, 10).map(o => o.name)));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Failed:', err);
  }
}

listSyncOrders();
