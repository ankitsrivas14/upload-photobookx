import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { backfillAllDates } from '../src/services/roasService';

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('MONGO_URI not set in .env');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.');

  console.log('Starting ROAS backfill...');
  const result = await backfillAllDates();
  console.log(`Done. Upserted ${result.upserted} date(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
