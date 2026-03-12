
/**
 * Fix Old Failed Orders Missing Shipping Charges
 * 
 * Problem: Failed/RTO orders before Feb 10 2026 show 0 shipping charges.
 * Root cause: These orders exist in Shiprocket but their awb_data.charges 
 * are all empty strings (Shiprocket never backfilled them). The actual 
 * charge data lives in wallet transactions and date-range historical scans.
 * 
 * Strategy:
 * 1. Find all fulfilled orders before Feb 10 missing shipping charge data
 * 2. Scan Shiprocket date-range API (which DOES return charges) for that period
 * 3. Match and upsert charges
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import shiprocketService from '../src/services/shiprocketService';
import ShippingCharge from '../src/models/ShippingCharge';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function fixOldFailedOrders() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('🚀 Connected to MongoDB');

    const db = mongoose.connection.db;

    // Step 1: Find all fulfilled orders before Feb 10 that are missing charges
    const cache = await db.collection('shopifyordercaches').findOne({ cacheKey: 'all_orders_1000' });
    if (!cache || !cache.orders) {
      console.log('❌ No order cache found');
      return;
    }

    const existingCharges = await db.collection('shippingcharges').find({}).toArray();
    const chargeSet = new Set<string>();
    existingCharges.forEach(c => {
      chargeSet.add(c.orderNumber);
      chargeSet.add(c.orderNumber.replace(/^#/, ''));
      chargeSet.add('#' + c.orderNumber.replace(/^#/, ''));
    });

    const cutoffDate = new Date('2026-02-10T00:00:00');

    const missingOrders: string[] = [];
    for (const order of cache.orders) {
      if (order.cancelled_at) continue;
      if (new Date(order.created_at) >= cutoffDate) continue;
      if (!order.fulfillment_status || order.fulfillment_status === 'unfulfilled') continue;
      if (chargeSet.has(order.name) || chargeSet.has(order.name.replace(/^#/, ''))) continue;
      missingOrders.push(order.name);
    }

    console.log(`\n📋 Found ${missingOrders.length} fulfilled orders before Feb 10 with no charge data`);
    if (missingOrders.length === 0) {
      console.log('✅ All orders already have charge data!');
      return;
    }
    console.log('Sample missing:', missingOrders.slice(0, 10));

    // Build a lookup set for faster matching
    const missingSet = new Set<string>();
    missingOrders.forEach(name => {
      const clean = name.replace(/^#/, '');
      missingSet.add(clean);
      missingSet.add('#' + clean);
      missingSet.add(clean + '-C');
      missingSet.add('#' + clean + '-C');
    });

    // Step 2: Scan Shiprocket date-range endpoint for Jan & early Feb
    // This endpoint DOES return charges unlike the channel_order_id lookup
    const blocks = [
      { from: '2026-02-01', to: '2026-02-09', label: 'Early Feb' },
      { from: '2026-01-10', to: '2026-01-31', label: 'January' },
      { from: '2025-12-01', to: '2026-01-09', label: 'Pre-Jan' },
    ];

    let totalFetched = 0;
    let totalFixed = 0;

    for (const block of blocks) {
      console.log(`\n📅 Scanning: ${block.label} (${block.from} → ${block.to})`);

      let page = 1;
      const perPage = 50;

      while (true) {
        process.stdout.write(`  Page ${page}... `);
        const url = `/orders?from=${block.from}&to=${block.to}&page=${page}&per_page=${perPage}&show_all=1`;

        try {
          const response: any = await (shiprocketService as any).makeRequest(url);

          if (!response.data || response.data.length === 0) {
            console.log('Done.');
            break;
          }

          for (const srOrder of response.data) {
            totalFetched++;
            const channelId = srOrder.channel_order_id;
            if (!channelId || !missingSet.has(channelId)) continue;

            // This order is in our missing list!
            const cleanId = channelId.replace(/^#/, '').replace(/-C$/, '');
            const dbOrderName = '#' + cleanId; // Always store as primary

            const awbData = srOrder.awb_data?.charges;
            const shipment = srOrder.shipments?.[0];

            let freightForward = 0;
            let freightCOD = 0;
            let freightRTO = 0;

            if (awbData && (awbData.freight_charges || awbData.applied_weight_amount)) {
              freightForward = parseFloat(awbData.freight_charges || awbData.applied_weight_amount) || 0;
              freightCOD = parseFloat(awbData.cod_charges) || 0;
              freightRTO = parseFloat(awbData.applied_weight_amount_rto) || 0;

              // freight_charges includes COD; extract base freight
              if (freightForward > freightCOD && freightCOD > 0) {
                freightForward -= freightCOD;
              }
            } else if (shipment?.cost) {
              freightForward = parseFloat(shipment.cost) || 0;
            }

            const totalCharge = freightForward + freightCOD + freightRTO;

            if (totalCharge > 0) {
              await ShippingCharge.findOneAndUpdate(
                { orderNumber: dbOrderName },
                {
                  shippingCharge: totalCharge,
                  freightForward,
                  freightCOD,
                  freightRTO,
                  shiprocketOrderId: srOrder.id,
                  awbCode: shipment?.awb_code,
                  courierName: shipment?.courier_name || shipment?.courier,
                  status: shipment?.status?.toString(),
                  customerCity: srOrder.customer_city,
                  customerState: srOrder.customer_state,
                  fetchedAt: new Date(),
                  fixedBy: 'fixOldFailedOrders'
                },
                { upsert: true }
              );
              totalFixed++;
              console.log(`\n  ✅ Fixed ${dbOrderName}: ₹${totalCharge} (fwd=${freightForward}, COD=${freightCOD}, RTO=${freightRTO})`);
              missingSet.delete(channelId);
            } else {
              console.log(`\n  ⚠️  Found ${channelId} but charges are empty (AWB data not populated yet)`);
            }
          }

          console.log(`Done (${response.data.length} scanned)`);
          if (response.data.length < perPage) break;
          page++;

          await new Promise(r => setTimeout(r, 200));
        } catch (err: any) {
          console.error(`\n❌ Error on page ${page}:`, err.message);
          break;
        }
      }
    }

    console.log(`\n${'='.repeat(50)}`);
    console.log(`🏆 FIX COMPLETE!`);
    console.log(`Shiprocket orders scanned: ${totalFetched}`);
    console.log(`Orders fixed: ${totalFixed}`);
    const stillMissing = missingOrders.length - totalFixed;
    console.log(`Still missing (no Shiprocket data found): ${stillMissing}`);

    if (stillMissing > 0) {
      // Show what's still missing
      const remainingMissing: string[] = [];
      for (const name of missingOrders) {
        const clean = name.replace(/^#/, '');
        const still = missingSet.has(clean) || missingSet.has('#' + clean) || missingSet.has(clean + '-C');
        if (still) remainingMissing.push(name);
      }
      console.log(`Still missing orders:`, remainingMissing.slice(0, 20));
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Fix failed:', err);
    process.exit(1);
  }
}

fixOldFailedOrders();
