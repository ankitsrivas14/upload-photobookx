
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testCloneFetch() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB');

    const testOrders = ['#PB1288S', '#PB1270S', '#PB1107S'];
    console.log(`\nTesting fetch including clones for: ${testOrders.join(', ')}`);

    for (const orderNum of testOrders) {
      console.log(`\n--- Debugging: ${orderNum} ---`);
      
      const variants = [
        orderNum,
        orderNum.replace(/^#/, ''),
        orderNum + '-C',
        orderNum.replace(/^#/, '') + '-C'
      ];

      console.log(`Searching Shiprocket for variants: ${variants.join(', ')}`);

      // Search deeper this time - max 20 pages (1000 orders)
      let found = false;
      let page = 1;
      const perPage = 50;
      const maxPages = 20;

      outerLoop: while (page <= maxPages) {
        process.stdout.write(`Page ${page}... `);
        const response: any = await (shiprocketService as any).makeRequest(`/orders?page=${page}&per_page=${perPage}`);
        
        if (!response.data || response.data.length === 0) break;

        for (const srOrder of response.data) {
          const channelId = srOrder.channel_order_id;
          if (variants.includes(channelId)) {
            console.log(`\n✅ MATCH FOUND: ${channelId}`);
            console.log(`   Shiprocket Status: ${srOrder.shipments?.[0]?.status}`);
            console.log(`   Charges:`, JSON.stringify(srOrder.awb_data?.charges, null, 2));
            found = true;
            break outerLoop;
          }
        }
        page++;
      }

      if (!found) {
        console.log(`\n❌ None of the variants found for ${orderNum} in last 1000 Shiprocket orders.`);
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testCloneFetch();
