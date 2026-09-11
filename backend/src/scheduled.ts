import { onSchedule } from 'firebase-functions/v2/scheduler';
import { connectMongo } from './db';
import { backfillAllDates } from './services/roasService';

/**
 * Durable ROAS recompute for the Cloud Functions runtime.
 *
 * On Render/local the recompute runs in-process on the write path (see
 * `scheduleRoasRecompute`). On Cloud Functions that fire-and-forget path is disabled
 * (it can't reliably finish after the response), so this scheduled function owns freshness:
 * every 15 minutes it re-derives DailyROAS from the current order cache + ad spend. The work
 * is idempotent upserts, so overlapping/rerun is harmless; `maxInstances: 1` avoids parallel
 * runs. Only MongoDB is touched — no external APIs — so only MONGO_URI is needed.
 */
export const roasRecompute = onSchedule(
  {
    schedule: 'every 15 minutes',
    region: 'asia-south1',
    timeoutSeconds: 300,
    // 1 GiB (not 512 MiB): the container loads the whole backend module graph at
    // cold start (shared entry with `api`), and on Cloud Run memory is coupled to CPU —
    // 512 MiB starved startup and the health check failed. It also gives the recompute
    // headroom when it loads the order cache into memory.
    memory: '1GiB',
    maxInstances: 1,
    secrets: ['MONGO_URI'],
  },
  async () => {
    await connectMongo();
    const { upserted } = await backfillAllDates();
    console.log(`Scheduled ROAS recompute: ${upserted} dates refreshed`);
  }
);
