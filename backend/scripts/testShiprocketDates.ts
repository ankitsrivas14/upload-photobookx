
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testDateSearch() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // We are looking for an order from early Feb
    const orderNum = 'PB1288S';
    console.log(`Deep searching for: ${orderNum} using date filters...`);

    // Try various query combinations
    const queries = [
      `/orders?from=2026-02-01&to=2026-02-15&channel_order_id=${encodeURIComponent(orderNum)}`,
      `/orders?from=2026-01-10&to=2026-03-12&channel_order_id=${encodeURIComponent(orderNum)}`,
      `/orders?per_page=100&channel_order_id=${encodeURIComponent(orderNum)}`
    ];

    for (const q of queries) {
      console.log(`\nTrying URL: ${q}`);
      const response: any = await (shiprocketService as any).makeRequest(q);
      
      console.log('Results found:', response.data?.length || 0);
      const match = response.data?.find((o: any) => 
        (o.channel_order_id || '').includes(orderNum)
      );

      if (match) {
        console.log('✅ FOUND!');
        console.log('Shiprocket ID:', match.id);
        console.log('Channel Order ID:', match.channel_order_id);
        break;
      } else {
        console.log('❌ Not found with this query.');
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testDateSearch();
