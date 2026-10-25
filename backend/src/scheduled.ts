import { onSchedule } from 'firebase-functions/v2/scheduler';
import { connectMongo } from './db';
import { runScheduledRefresh } from './services/refreshService';

/**
 * Keeps order + shipping data fresh without anyone pressing "Refresh" in the UI.
 *
 * Runs the same flow as the SalesPage refresh (Shopify sync → figure out which
 * orders need a Shiprocket shipping sync → one bulk fetch → recompute the daily
 * aggregates). Steady-state runs do little external work because only terminal
 * orders missing a charge are synced. `maxInstances: 1` prevents overlapping runs.
 * The first run after 02:30 IST each night rebuilds every date's aggregates (ROAS
 * included) and the breakeven snapshot; other runs recompute only the changed dates.
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
        `fetched=${result.fetched}, skipped=${result.skipped}, aggregates=${result.aggregates}`
    );
  }
);

/**
 * Fast, lightweight order freshness: every 10 minutes pull the orders that changed since the
 * last run (Shopify updated_at, any age) straight into Firestore. No Mongo — so it never
 * touches the slow ~15MB cache doc and can't time out on it. This is what keeps the
 * SalesPage (which reads Firestore) current, including late deliveries and RTOs.
 * It then recomputes the daily aggregates (order stats, shipping, P&L, ROAS) for the
 * dates whose inputs changed, so the dashboards trail Shopify by at most ~10 minutes.
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
    const { syncChangedOrders } = await import('./services/orderSyncService');
    const { processDirtyDates } = await import('./services/aggregatesService');
    const { fetched, written, since } = await syncChangedOrders();
    const dates = await processDirtyDates();
    console.log(
      `ordersSync: ${fetched} orders changed since ${since}, upserted ${written} to Firestore, ` +
        `aggregates: ${dates === null ? 'skipped' : `${dates} dates recomputed`}`
    );
  }
);

/**
 * Hourly at :15 IST: Meta ad spend for the last 7 days (today included) into dailyAdSpend,
 * so ROAS and P&L carry ad cost without anyone typing it in. Re-pulling a week picks up
 * Meta's late spend corrections. Changed days are recomputed right away (or by the next
 * ordersSync if a recompute is already running). Needs only the read-only Meta token.
 */
export const adSpendSync = onSchedule(
  {
    schedule: '15 * * * *',
    timeZone: 'Asia/Kolkata',
    region: 'asia-south1',
    timeoutSeconds: 120,
    memory: '512MiB',
    maxInstances: 1,
    secrets: ['META_ADS_READ_TOKEN'],
  },
  async () => {
    const { syncAdSpend, istToday } = await import('./services/metaAdSpendService');
    const { shiftDateKey, processDirtyDates } = await import('./services/aggregatesService');
    const today = istToday();
    const { daysWithSpend, changes } = await syncAdSpend(shiftDateKey(today, -6), today);
    const recomputed = changes.length > 0 ? await processDirtyDates() : 0;
    console.log(
      `adSpendSync: ${daysWithSpend} days with spend, ${changes.length} changed ` +
        `(${changes.map((c) => `${c.day} ${c.from ?? '-'}→${c.to ?? '-'}`).join(', ') || 'none'}), ` +
        `aggregates: ${recomputed === null ? 'left for ordersSync' : `${recomputed} dates recomputed`}`
    );
  }
);
