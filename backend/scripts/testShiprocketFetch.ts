
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testFetch() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB');

    const testOrders = ['#PB1695S', '#PB1288S', '#PB1670S'];
    console.log(`\nTesting fetch for: ${testOrders.join(', ')}`);

    for (const orderNum of testOrders) {
      console.log(`\n--- Debugging Order: ${orderNum} ---`);
      
      const order = await (shiprocketService as any).getOrderByChannelOrderId(orderNum);
      
      if (!order) {
        console.log(`❌ Order ${orderNum} NOT FOUND via Shiprocket API.`);
      } else {
        console.log(`✅ Order ${orderNum} MATCHED Shiprocket Order!`);
        console.log(`   Expected ID: ${orderNum} (or variant)`);
        console.log(`   Actual Shiprocket Channel Order ID: ${order.channel_order_id}`);
        console.log(`   Shiprocket ID: ${order.id}`);
        console.log(`   Shipment Status: ${order.shipments?.[0]?.status || 'No shipment'}`);
        console.log(`   AWB: ${order.shipments?.[0]?.awb_code || 'No AWB'}`);
        
        const hasAwbCharges = !!order.awb_data?.charges;
        console.log(`   Has AWB Charges Data: ${hasAwbCharges}`);
        if (hasAwbCharges) {
          console.log(`   Charges:`, JSON.stringify(order.awb_data.charges, null, 2));
        }
      }
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testFetch();
