
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testShipmentId() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // Shipment ID for #PB1288S (found from tracking output)
    const shipmentId = '1121081703';
    console.log(`Fetching detailed shipment record for ID: ${shipmentId}...`);

    const endpoints = [
      `/shipments/${shipmentId}`,
      `/courier/track/shipment/${shipmentId}`
    ];

    for (const ep of endpoints) {
      console.log(`\nTrying: ${ep}`);
      try {
        const response: any = await (shiprocketService as any).makeRequest(ep);
        console.log('Success!');
        console.log(JSON.stringify(response, null, 2));
      } catch(e: any) {
        console.log('Failed:', e.message);
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testShipmentId();
