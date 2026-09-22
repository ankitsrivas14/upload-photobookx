import { onSchedule } from 'firebase-functions/v2/scheduler';
import { connectMongo } from './db';
import { backfillAllDates } from './services/roasService';
import { runScheduledRefresh } from './services/refreshService';
import shopifyService from './services/shopifyService';

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

/**
 * Keeps order + shipping data fresh without anyone pressing "Refresh" in the UI.
 *
 * Runs the same flow as the SalesPage refresh (Shopify sync → figure out which
 * orders need a Shiprocket shipping sync → one bulk fetch → recompute the daily
 * aggregates). Steady-state runs do little external work because only terminal
 * orders missing a charge are synced. `maxInstances: 1` prevents overlapping runs.
 * Needs Shopify + Shiprocket credentials in addition to MongoDB.
 */
export const scheduledRefresh = onSchedule(
  {
    schedule: 'every 30 minutes',
    region: 'asia-south1',
    timeoutSeconds: 540,
    memory: '1GiB',
    maxInstances: 1,
    secrets: [
      'MONGO_URI',
      'SHOPIFY_STORE_DOMAIN',
      'SHOPIFY_ACCESS_TOKEN',
      'PRINTED_PHOTOS_PRODUCT_ID',
      'SHIPROCKET_API_EMAIL',
      'SHIPROCKET_API_PASSWORD',
    ],
  },
  async () => {
    await connectMongo();
    const result = await runScheduledRefresh();
    console.log(
      `Scheduled refresh done: synced=${result.synced}, toSync=${result.toSync}, ` +
        `fetched=${result.fetched}, skipped=${result.skipped}`
    );
  }
);

/**
 * Fast, lightweight order freshness: every 10 minutes pull recent orders straight from
 * Shopify into Firestore. No Mongo — so it never touches the slow ~15MB cache doc and
 * can't time out on it. This is what keeps the SalesPage (which reads Firestore) current.
 */
export const ordersSync = onSchedule(
  {
    schedule: 'every 10 minutes',
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 1,
    secrets: ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'PRINTED_PHOTOS_PRODUCT_ID'],
  },
  async () => {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const recent = await shopifyService.fetchRecentOrders(since);
    const { saveAll } = await import('./db/ordersRepo');
    const written = await saveAll(recent);
    console.log(`ordersSync: fetched ${recent.length}, upserted ${written} recent orders to Firestore`);
  }
);
