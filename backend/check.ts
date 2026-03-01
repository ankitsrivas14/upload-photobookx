import mongoose from 'mongoose';
import OrderDeliveryDate from './src/models/OrderDeliveryDate';

async function check() {
  await mongoose.connect('mongodb+srv://hi_db_user:wLf5r96gSN9tOYsu@cluster0.jhpjagv.mongodb.net/photobookx');
  const d = await OrderDeliveryDate.findOne({ orderNumber: /PB1142S/i });
  console.log('Lookup PB1142S:', d);
  
  const docs = await OrderDeliveryDate.find({}).limit(5);
  console.log('Sample docs:', docs);
  process.exit(0);
}
check();
