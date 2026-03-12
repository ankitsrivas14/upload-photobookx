
import shiprocketService from '../src/services/shiprocketService';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function testAwbSearch() {
  try {
    await mongoose.connect(MONGO_URI);
    
    // Tracking number for #PB1288S
    const awb = '19041878694105';
    console.log(`Deep searching for AWB: ${awb}...`);

    // 1. Try tracking endpoint
    console.log(`\nTrying /courier/track/awb/${awb}`);
    try {
        const response: any = await (shiprocketService as any).makeRequest(`/courier/track/awb/${awb}`);
        console.log('Tracking Result:', JSON.stringify(response, null, 2));
    } catch(e) {
        console.log('Tracking endpoint failed.');
    }

    // 2. Try fetching shipment details if we can find a shipment ID
    // Since we don't have shipment ID, let's try searching orders by AWB if possible
    // Shiprocket doesn't have a direct "search by AWB" for charges usually, 
    // but some endpoints might accept it.
    
    // 3. Try to find the order by listing wallet transactions with AWB filter
    console.log(`\nTrying /wallet/transactions?search=${awb}`);
    try {
        const response: any = await (shiprocketService as any).makeRequest(`/wallet/transactions?search=${awb}`);
        console.log('Wallet Results found:', response.data?.length || 0);
        if (response.data && response.data.length > 0) {
            console.log(JSON.stringify(response.data, null, 2));
        }
    } catch(e) {
        console.log('Wallet search failed.');
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error('Test failed:', err);
  }
}

testAwbSearch();
