import mongoose from 'mongoose';
import TaggingJobLog from './src/models/TaggingJobLog';

async function testQuery() {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/upload-photobooks');

    console.log("Finding success:");
    const s = await TaggingJobLog.find({ outcome: 'success' });
    console.log(s.length);

    console.log("Finding error:");
    const e = await TaggingJobLog.find({ outcome: 'error' });
    console.log(e.length);

    console.log("Finding all:");
    const a = await TaggingJobLog.find({});
    console.log(a.length);

    mongoose.disconnect();
}
testQuery();
