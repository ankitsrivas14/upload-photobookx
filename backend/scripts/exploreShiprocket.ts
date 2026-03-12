
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testShipments() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // Test shipments endpoint
    console.log(`Testing /shipments endpoint...`);

    const endpoints = [
      '/shipments?per_page=50&page=1',
      '/orders?show_all=1&per_page=50&from=2026-02-01',
      '/settings/wallet_balance'
    ];

    for (const ep of endpoints) {
      console.log(`\nTrying: ${ep}`);
      try {
        const response: any = await (shiprocketService as any).makeRequest(ep);
        console.log('Success! Data count:', response.data?.length || 'Object returned');
        if (response.data && response.data.length > 0) {
            console.log('Sample item:', JSON.stringify(response.data[0], null, 2).substring(0, 500));
        }
      } catch(e: any) {
        console.log('Failed:', e.message);
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testShipments();
