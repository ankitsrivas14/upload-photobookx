
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function debugSync() {
  try {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    
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
      console.log('No order cache found for key "all_orders_1000".');
      return;
    }
    const orders = cache.orders;
    console.log(`Analyzing ${orders.length} orders from cache...`);

    const sync_Active = [];
    const sync_TerminalMissingCharge = [];
    const skipped_TerminalWithCharge = [];
    const skipped_Cancelled = [];

    for (const order of orders) {
      if (order.cancelled_at) {
        skipped_Cancelled.push(order.name);
        continue;
      }

      // Map delivery status as the backend does
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
        statusLower.includes('rto');
      const isDelivered = statusLower === 'delivered';
      const isTerminal = isFailed || isDelivered;

      // Check shipping charge record
      const chargeRecord = chargeMap.get(order.name);
      const chargeValue = chargeRecord ? chargeRecord.shippingCharge : 0;
      const hasChargeData = chargeValue > 0;

      if (!isTerminal) {
        sync_Active.push({ name: order.name, status: statusLower || 'unfulfilled', date: order.created_at });
      } else if (!hasChargeData) {
        sync_TerminalMissingCharge.push({ name: order.name, status: statusLower, date: order.created_at });
      } else {
        skipped_TerminalWithCharge.push(order.name);
      }
    }

    console.log('\n--- Accurate Sync Breakdown ---');
    console.log(`1. Active/In-Progress (Waiting for Delivered/Failed status): ${sync_Active.length}`);
    console.log(`2. Terminal (Delivered/Failed) but NO Charge in DB: ${sync_TerminalMissingCharge.length}`);
    console.log(`3. Terminal and HAS Charge in DB (Skipped): ${skipped_TerminalWithCharge.length}`);
    console.log(`4. Cancelled (Skipped): ${skipped_Cancelled.length}`);
    console.log(`-----------------------------------------------`);
    console.log(`TOTAL FORECASTED SYNC COUNT: ${sync_Active.length + sync_TerminalMissingCharge.length}`);

    if (sync_TerminalMissingCharge.length > 0) {
      console.log('\n--- First 20 Terminal Orders missing Shipping Charge ---');
      console.table(sync_TerminalMissingCharge.slice(0, 20));
    }

    if (sync_Active.length > 0) {
      console.log('\n--- First 20 Active Orders needing sync ---');
      console.table(sync_Active.slice(0, 20));
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Debug failed:', err);
  }
}

debugSync();
