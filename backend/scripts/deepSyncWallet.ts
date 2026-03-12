
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import shiprocketService from '../src/services/shiprocketService';
import ShippingCharge from '../src/models/ShippingCharge';

dotenv.config({ path: path.resolve('/Users/ankitsrivastava/Documents/personal/upload-photobooks/backend/.env') });

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/photobooks';

async function deepSyncWallet() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('🚀 Connected to MongoDB');

    const MAX_PAGES = 500; // Go deep to find February/January data
    const PER_PAGE = 100;
    
    // Statistics
    let totalTransactions = 0;
    let matchCount = 0;
    let updateCount = 0;

    console.log(`📡 Starting Deep Wallet Sync (Max ${MAX_PAGES} pages)...`);

    for (let page = 1; page <= MAX_PAGES; page++) {
      console.log(`\n📄 Processing Page ${page}...`);
      
      const response: any = await (shiprocketService as any).makeRequest(
        `/wallet/transactions?page=${page}&per_page=${PER_PAGE}`
      );

      if (!response.data || response.data.length === 0) {
        console.log('🏁 No more transactions found.');
        break;
      }

      for (const txn of response.data) {
        totalTransactions++;
        const amount = txn.amount; // Negative for deductions
        if (amount >= 0) continue; // Only process deductions

        const description = txn.description || '';
        const type = txn.type?.toLowerCase() || '';
        
        // Extract IDs using regex
        // Examples: Deducted for AWB 19041878694105 - Order #PB1288S
        const awbMatch = description.match(/\b\d{12,}\b/);
        const orderMatch = description.match(/#PB\d+S(-C)?/i) || description.match(/PB\d+S(-C)?/i);
        
        const awb = txn.awb || awbMatch?.[0];
        const rawOrderNum = txn.order_id || orderMatch?.[0];

        if (!rawOrderNum) continue;

        // Clean up order number
        const orderNumber = rawOrderNum.startsWith('#') ? rawOrderNum : '#' + rawOrderNum;
        const baseOrderNumber = orderNumber.split('-')[0]; // For matching clone to primary if needed
        
        matchCount++;

        // Calculate breakdown based on type
        let freightForward = 0;
        let freightCOD = 0;
        let freightRTO = 0;
        let whatsappCharges = 0;
        let otherCharges = 0;

        const absAmount = Math.abs(amount);

        if (type.includes('freight forward')) {
          freightForward = absAmount;
        } else if (type.includes('freight cod')) {
          freightCOD = absAmount;
        } else if (type.includes('freight rto') || type.includes('rto')) {
          freightRTO = absAmount;
        } else if (type.includes('whatsapp')) {
          whatsappCharges = absAmount;
        } else {
          otherCharges = absAmount;
        }

        // We want to UPDATE the existing record for the PRIMARY order
        // even if the transaction mentions the clone ID
        const targetOrder = baseOrderNumber.toUpperCase();

        // Check if we should update
        const existing = await ShippingCharge.findOne({ orderNumber: targetOrder });
        
        const updateData: any = {
          $inc: {}
        };

        if (freightForward) updateData.$inc.freightForward = freightForward;
        if (freightCOD) updateData.$inc.freightCOD = freightCOD;
        if (freightRTO) updateData.$inc.freightRTO = freightRTO;
        if (whatsappCharges) updateData.$inc.whatsappCharges = whatsappCharges;
        if (otherCharges) updateData.$inc.otherCharges = otherCharges;
        
        // Re-calculate total
        const newTotal = (existing?.shippingCharge || 0) + absAmount;
        updateData.$set = { 
            shippingCharge: newTotal,
            fetchedAt: new Date()
        };
        
        if (awb && !existing?.awbCode) updateData.$set.awbCode = awb;

        await ShippingCharge.findOneAndUpdate(
          { orderNumber: targetOrder },
          updateData,
          { upsert: true }
        );
        
        updateCount++;
      }

      console.log(`✅ Page ${page} complete. Transactions: ${totalTransactions}, Matches: ${matchCount}`);
      
      // Stop if we reach transactions before Jan 10
      const lastTxnDate = new Date(response.data[response.data.length - 1].created_at);
      if (lastTxnDate < new Date('2026-01-01')) {
          console.log('🕒 Reached January 1st data. Stopping deep sync.');
          break;
      }
      
      // Safety pause
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n🏆 DEEP SYNC COMPLETE!`);
    console.log(`Total Transactions Analyzed: ${totalTransactions}`);
    console.log(`Orders Matched: ${matchCount}`);
    console.log(`DB Updates Applied: ${updateCount}`);

    await mongoose.disconnect();
  } catch (err) {
    console.error('❌ Deep sync failed:', err);
  }
}

deepSyncWallet();
