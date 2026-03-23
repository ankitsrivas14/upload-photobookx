
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const MetaAdPerformanceSchema = new mongoose.Schema({
  date: String,
  name: String,
  spend: Number,
  roas: Number,
  purchases: Number
}, { strict: false });

const MetaAdPerformance = mongoose.model('MetaAdPerformance', MetaAdPerformanceSchema, 'metaadperformances');

async function check() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI not found in env');
    process.exit(1);
  }
  await mongoose.connect(uri);
  console.log('Connected to DB');

  const namesToCheck = [
    'Jyotirling Adset',
    'JL - Adset -2',
    'Jyotirling Adset w/ lookalike',
    'Jyotirling Adset - Duplicate - 1'
  ];

  for (const name of namesToCheck) {
    const records = await MetaAdPerformance.find({ name }).sort({ date: -1 });
    console.log(`\n--- Name: "${name}" ---`);
    console.log(`Total Records: ${records.length}`);
    records.forEach(r => {
      console.log(`  Date: ${r.date} | Spend: ${r.spend} | ROAS: ${r.roas}`);
    });
  }

  process.exit(0);
}

check();
