import { app } from './app';
import { connectMongo } from './db';
import config from './config';

/**
 * Local / Render server entry (`node dist/index.js`). Cloud Functions does NOT use this file
 * — it loads `functions.ts`. We warm the Mongo connection at boot for fast first requests, but
 * the app also ensures the connection per request, so a failed initial connect isn't fatal.
 */
connectMongo()
  .then(() => console.log('📦 Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB connection error (will retry on request):', err));

app.listen(config.port, () => {
  console.log(`🚀 Server running on http://localhost:${config.port}`);
  console.log(`📦 Environment: ${config.nodeEnv}`);
});
