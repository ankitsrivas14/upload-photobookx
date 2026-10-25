import { app } from './app';
import config from './config';

/**
 * Local / Render server entry (`node dist/index.js`). Cloud Functions does NOT use this file
 * — it loads `functions.ts`.
 */
app.listen(config.port, () => {
  console.log(`🚀 Server running on http://localhost:${config.port}`);
  console.log(`📦 Environment: ${config.nodeEnv}`);
});
