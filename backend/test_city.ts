import mongoose from 'mongoose';
import ShopifyOrderCache from './src/models/ShopifyOrderCache';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGO_URI as string).then(async () => {
    const doc = await ShopifyOrderCache.findOne();
    if (doc && doc.orders) {
        let cityCount = 0;
        for (const order of doc.orders) {
            if (order.shipping_address && order.shipping_address.city) {
                console.log('Found city:', order.shipping_address.city, 'for order:', order.name);
                cityCount++;
                if (cityCount > 3) break;
            }
            if (order.customer && order.customer.default_address && order.customer.default_address.city) {
                console.log('Found customer city:', order.customer.default_address.city, 'for order:', order.name);
                cityCount++;
                if (cityCount > 3) break;
            }
        }
        console.log('Total orders with city:', cityCount, 'out of', doc.orders.length);
    } else {
        console.log('No orders found');
    }
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
