
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testQueryParam() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // Test if searching by channel_order_id works
    const orderNum = 'PB1288S-C';
    console.log(`Searching Shiprocket via query param for: ${orderNum}`);

    // The code says it doesn't work, let's try /orders?channel_order_id=...
    const response: any = await (shiprocketService as any).makeRequest(`/orders?show_all=1&channel_order_id=${encodeURIComponent(orderNum)}`);
    
    console.log('Response data length:', response.data?.length || 0);
    if (response.data && response.data.length > 0) {
      console.log('FOUND via query param!');
      console.log(JSON.stringify(response.data[0], null, 2));
    } else {
        console.log('NOT FOUND via query param.');
        
        // Try searching through a lot of pages
        console.log('Falling back to deep page search...');
        let page = 1;
        while(page <= 20) {
            process.stdout.write(`p${page} `);
            const pResponse: any = await (shiprocketService as any).makeRequest(`/orders?page=${page}&per_page=50`);
            const found = pResponse.data?.find((o: any) => o.channel_order_id === orderNum || o.channel_order_id === '#'+orderNum);
            if (found) {
                console.log('\nFOUND on page', page);
                console.log(JSON.stringify(found, null, 2));
                break;
            }
            if (!pResponse.data || pResponse.data.length < 50) break;
            page++;
        }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testQueryParam();
