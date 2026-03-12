
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testHistory() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // Request specifically for February
    const url = `/orders?from=2026-02-01&to=2026-02-28&per_page=100`;
    console.log(`Fetching orders for February: ${url}`);

    const response: any = await (shiprocketService as any).makeRequest(url);
    
    console.log('Results found:', response.data?.length || 0);
    if (response.data && response.data.length > 0) {
        console.log('Sample order dates:');
        response.data.slice(0, 5).forEach((o: any) => {
            console.log(`- ${o.channel_order_id}: ${o.created_at}`);
        });
        
        const target = response.data.find((o: any) => o.channel_order_id.includes('1288'));
        if (target) {
            console.log('✅ FOUND PB1288S!');
            console.log(JSON.stringify(target, null, 2).substring(0, 1000));
        }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testHistory();
