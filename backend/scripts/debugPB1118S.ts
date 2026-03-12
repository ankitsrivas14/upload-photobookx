
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function debugOrder() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB');

    const orderNum = 'PB1118S';
    const variants = [
      orderNum,
      '#' + orderNum,
      orderNum + '-C',
      '#' + orderNum + '-C'
    ];

    console.log(`\nDebugging order: ${orderNum}`);
    console.log(`Searching Shiprocket for variants: ${variants.join(', ')}`);

    // We'll use the optimized search first
    for (const variant of variants) {
      console.log(`Checking variant via direct query: ${variant}`);
      try {
        const srOrder = await shiprocketService.getOrderByChannelOrderId(variant);
        if (srOrder) {
          console.log(`✅ FOUND via direct query: ${variant}`);
          console.log(`Shiprocket Order ID: ${srOrder.id}`);
          console.log(`Status: ${srOrder.status}`);
          console.log(`Shipment Status: ${srOrder.shipments?.[0]?.status}`);
          console.log(`AWB: ${srOrder.shipments?.[0]?.awb_code}`);
          console.log(`Charges:`, JSON.stringify(srOrder.awb_data?.charges, null, 2));
          return;
        }
      } catch (e: any) {
        console.log(`   Direct query for ${variant} failed: ${e.message}`);
      }
    }

    // If direct query fails, try scanning last few pages (Shiprocket search is buggy)
    console.log(`\nDirect search failed. Scanning historical pages...`);
    let page = 1;
    const perPage = 50;
    const maxPages = 40; // 2000 orders

    while (page <= maxPages) {
      process.stdout.write(`Page ${page}... `);
      const url = `/orders?page=${page}&per_page=${perPage}&show_all=1`;
      const response: any = await (shiprocketService as any).makeRequest(url);
      
      if (!response.data || response.data.length === 0) break;

      for (const srOrder of response.data) {
        const channelId = srOrder.channel_order_id;
        if (variants.includes(channelId)) {
          console.log(`\n✅ MATCH FOUND via history scan (Page ${page}): ${channelId}`);
          console.log(`Shiprocket Order ID: ${srOrder.id}`);
          console.log(`Status: ${srOrder.status}`);
          console.log(`Charges:`, JSON.stringify(srOrder.awb_data?.charges, null, 2));
          return;
        }
      }
      page++;
    }

    console.log(`\n❌ PB1118S not found in last ${page * perPage} Shiprocket orders.`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('Debug failed:', err);
  }
}

debugOrder();
