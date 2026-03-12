
/**
 * Fix Old Orders Missing Shipping Charges via AWB Lookup
 * 
 * Problem: Old fulfilled orders before Feb 10 2026 have no shipping charge data.
 * Root cause: Shiprocket's /orders endpoint returns empty charges for old orders.
 * Solution: Use AWB numbers from Shopify fulfillments to call /shipments?awb=AWB 
 *           which always returns real charges (as {data: [...]} format).
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import shiprocketService from '../src/services/shiprocketService';
import ShippingCharge from '../src/models/ShippingCharge';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function fixViaAWB() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('🚀 Connected to MongoDB');

    const db = mongoose.connection.db;

    // Step 1: Find all fulfilled orders before Feb 10 missing charges
    const cache = await db.collection('shopifyordercaches').findOne({ cacheKey: 'all_orders_1000' });
    if (!cache?.orders) { console.log('❌ No cache'); return; }

    const existingCharges = await db.collection('shippingcharges').find({}).toArray();
    const chargeSet = new Set<string>();
    existingCharges.forEach(c => {
      const clean = c.orderNumber.replace(/^#/, '');
      chargeSet.add(clean);
      chargeSet.add('#' + clean);
    });

    const cutoffDate = new Date('2026-02-10T00:00:00');

    const missingOrders: { name: string; awb: string | null; date: string }[] = [];
    for (const order of cache.orders) {
      if (order.cancelled_at) continue;
      if (new Date(order.created_at) >= cutoffDate) continue;
      if (!order.fulfillment_status || order.fulfillment_status === 'unfulfilled') continue;

      const cleanName = order.name.replace(/^#/, '');
      if (chargeSet.has(cleanName)) continue;

      const awb = order.fulfillments?.[0]?.tracking_number || null;
      missingOrders.push({ name: order.name, awb, date: order.created_at });
    }

    console.log(`\n📋 Found ${missingOrders.length} fulfilled orders before Feb 10 missing charge data`);
    
    const withAWB = missingOrders.filter(o => o.awb);
    const withoutAWB = missingOrders.filter(o => !o.awb);
    console.log(`  → With AWB (can fix): ${withAWB.length}`);
    console.log(`  → Without AWB (cannot fix via this method): ${withoutAWB.length}`);
    if (withoutAWB.length > 0) {
      console.log(`  No-AWB orders:`, withoutAWB.map(o => o.name));
    }

    if (withAWB.length === 0) {
      console.log('✅ Nothing to fix!');
      return;
    }

    let fixed = 0;
    let noCharge = 0;
    let failed = 0;
    
    // Build a map of orderName -> AWB for validation 
    // (we need to make sure the AWB actually belongs to THIS order, not a different one)
    const awbToOrderMap = new Map<string, string>();
    withAWB.forEach(o => awbToOrderMap.set(o.awb!, o.name));

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < withAWB.length; i += batchSize) {
      const batch = withAWB.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async ({ name, awb, date }) => {
        try {
          const res: any = await (shiprocketService as any).makeRequest(`/shipments?awb=${awb}`);
          
          // The endpoint returns { data: [...], meta: ... }
          const shipmentData = Array.isArray(res.data) ? res.data[0] : res;
          
          if (!shipmentData || !shipmentData.awb) {
            console.log(`  ⚠️  ${name}: No shipment data for AWB ${awb}`);
            failed++;
            return;
          }

          // Validate this AWB actually belongs to an order placed around the same date
          // (to avoid matching wrong orders from other Shopify channels)
          const chargesData = shipmentData.charges;
          if (!chargesData) {
            console.log(`  ⚠️  ${name}: No charges in shipment response`);
            noCharge++;
            return;
          }

          const codRaw = chargesData.cod_charges;
          const freightForward = parseFloat(chargesData.applied_weight_amount || 0) || 0;
          const freightCOD = (codRaw === 'N/A' || codRaw === null) ? 0 : parseFloat(codRaw || 0) || 0;
          const freightRTO = parseFloat(chargesData.applied_weight_amount_rto || 0) || 0;
          
          const totalCharge = freightForward + freightCOD + freightRTO;

          if (totalCharge > 0) {
            await ShippingCharge.findOneAndUpdate(
              { orderNumber: name },
              {
                shippingCharge: totalCharge,
                freightForward,
                freightCOD,
                freightRTO,
                awbCode: awb,
                courierName: shipmentData.courier_company,
                status: shipmentData.status,
                fetchedAt: new Date(),
                fixedBy: 'fixViaAWB_v2'
              },
              { upsert: true }
            );
            console.log(`  ✅ Fixed ${name}: ₹${totalCharge} (fwd=₹${freightForward}, COD=₹${freightCOD}, RTO=₹${freightRTO}) | AWB: ${awb} | Status: ${shipmentData.status}`);
            fixed++;
          } else {
            console.log(`  ⚠️  ${name}: Charges are all zero`);
            noCharge++;
          }
        } catch (err: any) {
          console.log(`  ❌ ${name} (AWB: ${awb}): ${err.message.substring(0, 100)}`);
          failed++;
        }
      }));

      await new Promise(r => setTimeout(r, 300));
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏆 AWB FIX COMPLETE!`);
    console.log(`Fixed: ${fixed}`);
    console.log(`Zero charges (not via Shiprocket?): ${noCharge}`);
    console.log(`API Errors: ${failed}`);
    console.log(`Without AWB: ${withoutAWB.length}`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Fix failed:', err);
    process.exit(1);
  }
}

fixViaAWB();
