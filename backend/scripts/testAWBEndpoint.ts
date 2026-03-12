
import shiprocketService from '../src/services/shiprocketService';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

async function run() {
  // Test 1: AWB we KNOW EXISTS (PB1288S - found earlier)
  const awb1 = '19041878694105';
  
  // Test 2: random older AWB
  const awb2 = '14112352119572'; // PB1012S
  
  for (const awb of [awb1, awb2]) {
    console.log('\n--- Testing AWB:', awb, '---');
    try {
      const res: any = await (shiprocketService as any).makeRequest('/shipments?awb=' + awb);
      if (res && (res.id || res.awb)) {
        console.log('OK - id:', res.id, 'awb:', res.awb, 'status:', res.status, 'charges:', JSON.stringify(res.charges));
      } else {
        console.log('Response structure:', Object.keys(res));
        console.log('Data:', JSON.stringify(res).substring(0, 500));
      }
    } catch(e: any) {
      console.log('ERROR:', e.message.substring(0, 200));
    }
  }
  process.exit(0);
}

run();
