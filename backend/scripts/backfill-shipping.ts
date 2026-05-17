import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { backfillShippingStats } from '../src/services/shippingStatsService';

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) { console.error('MONGO_URI not set'); process.exit(1); }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  console.log('Starting shipping stats backfill...');
  const result = await backfillShippingStats();
  console.log(`Done. Upserted ${result.upserted} date(s).`);

  await mongoose.disconnect();
}

main().catch((err) => { console.error('Backfill failed:', err); process.exit(1); });
