import mongoose from 'mongoose';
import config from './config';
import shiprocketService from './services/shiprocketService';

async function run() {
  try {
    const orderNumber = '#PB1487S'; // A delivered order
    const orderNumber2 = '#PB1502S'; // A failed or RTO order or out for delivery
    
    const [order1, order2] = await Promise.all([
        shiprocketService['getOrderByChannelOrderId'](orderNumber) as any,
        shiprocketService['getOrderByChannelOrderId'](orderNumber2) as any
    ]);
    
    console.log("Order 1 Dates:", {
      status: order1?.shipments?.[0]?.status,
      delivered_date: order1?.delivered_date,
      first_out_for_delivery_date: order1?.first_out_for_delivery_date,
      out_for_delivery_date: order1?.out_for_delivery_date,
    });
    
    console.log("Order 2 Dates:", {
      status: order2?.shipments?.[0]?.status,
      delivered_date: order2?.delivered_date,
      first_out_for_delivery_date: order2?.first_out_for_delivery_date,
      out_for_delivery_date: order2?.out_for_delivery_date,
    });
    
  } catch (err) {
    console.error(err);
  }
}

run();
