
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import shiprocketService from '../src/services/shiprocketService';
import ShippingCharge from '../src/models/ShippingCharge';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function historicalSync() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('🚀 Connected to MongoDB');

    // Define time blocks to sync
    const blocks = [
      { from: '2026-03-01', to: '2026-03-12', label: 'March' },
      { from: '2026-02-15', to: '2026-02-28', label: 'Late Feb' },
      { from: '2026-02-01', to: '2026-02-14', label: 'Early Feb' },
      { from: '2026-01-10', to: '2026-01-31', label: 'January' },
    ];

    let totalFetched = 0;
    let totalUpdated = 0;

    for (const block of blocks) {
      console.log(`\n📅 Syncing Block: ${block.label} (${block.from} to ${block.to})`);
      
      let page = 1;
      const perPage = 50;
      let hasMore = true;

      while (hasMore) {
        process.stdout.write(`  Page ${page}... `);
        const url = `/orders?from=${block.from}&to=${block.to}&page=${page}&per_page=${perPage}&show_all=1`;
        
        try {
          const response: any = await (shiprocketService as any).makeRequest(url);
          
          if (!response.data || response.data.length === 0) {
            console.log('Done.');
            hasMore = false;
            break;
          }

          for (const srOrder of response.data) {
            totalFetched++;
            const channelId = srOrder.channel_order_id;
            if (!channelId) continue;

            const orderNumber = channelId.startsWith('#') ? channelId : '#' + channelId;
            const normalizedTag = (orderNumber.split('-')[0]).toUpperCase();

            // Extract Charge Data
            const shipment = srOrder.shipments?.[0];
            const awbData = srOrder.awb_data?.charges;
            
            let freightForward = 0;
            let freightCOD = 0;
            let freightRTO = 0;

            if (awbData) {
              freightForward = parseFloat(awbData.freight_charges) || 0;
              freightCOD = parseFloat(awbData.cod_charges) || 0;
              freightRTO = parseFloat(awbData.applied_weight_amount_rto) || 0;
              
              // Shiprocket often includes COD in freight_charges, so adjust
              if (freightForward > freightCOD) {
                  freightForward -= freightCOD;
              }
            } else if (shipment?.cost) {
                freightForward = parseFloat(shipment.cost) || 0;
            }

            const totalCharge = freightForward + freightCOD + freightRTO;

            if (totalCharge > 0) {
              // Update DB
              await ShippingCharge.findOneAndUpdate(
                { orderNumber: normalizedTag },
                {
                  shippingCharge: totalCharge,
                  freightForward,
                  freightCOD,
                  freightRTO,
                  shiprocketOrderId: srOrder.id,
                  awbCode: shipment?.awb_code,
                  status: shipment?.status?.toString(),
                  customerCity: srOrder.customer_city,
                  customerState: srOrder.customer_state,
                  fetchedAt: new Date()
                },
                { upsert: true }
              );
              totalUpdated++;
            }
          }

          console.log(`Fetched ${response.data.length} orders.`);
          if (response.data.length < perPage) hasMore = false;
          page++;
          
          // Safety delay
          await new Promise(r => setTimeout(r, 200));

        } catch (err: any) {
          console.error(`\n❌ Error on page ${page}:`, err.message);
          hasMore = false;
        }
      }
    }

    console.log(`\n🏆 HISTORICAL SYNC COMPLETE!`);
    console.log(`Total Shiprocket Orders Analyzed: ${totalFetched}`);
    console.log(`DB Charge Records Updated: ${totalUpdated}`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Sync failed:', err);
  }
}

historicalSync();
