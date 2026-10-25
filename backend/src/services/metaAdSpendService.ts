import { markDatesDirty } from '../db/aggregatesDirty';

/**
 * Daily Meta ad spend into `dailyAdSpend`, the ad-cost input of ROAS and P&L, so nobody has
 * to type it in.
 *
 * Pulls account-level spend per day (the ad account runs on IST, so Meta's days are the
 * dashboard's days) and keeps one `meta-YYYY-MM-DD` row per day with spend. Amounts are
 * Meta's reported spend before GST, the same figure the hand-entered rows used. A day that
 * already has a hand-entered row is left alone, so nothing is counted twice. Uses a
 * read-only (ads_read) system-user token.
 */

export const GRAPH = 'https://graph.facebook.com/v23.0';
export const AD_ACCOUNT_ID = process.env.META_ADS_ACCOUNT_ID || 'act_1300540326624566';
const SOURCE = 'meta-api';
const STORE_TZ = 'Asia/Kolkata';

export function istToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: STORE_TZ });
}

function istDateKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: STORE_TZ });
}

/** 'YYYY-MM-DD' shifted by whole days. */
function shift(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(since: string, until: string): string[] {
  const out: string[] = [];
  for (let d = since; d <= until; d = shift(d, 1)) out.push(d);
  return out;
}

export async function getWithRetry(url: string, attempts = 3): Promise<any> {
  for (let i = 1; ; i++) {
    const res = await fetch(url);
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) return body;
    const err = body?.error;
    // Temporary errors (code 2, 5xx) are worth a retry; a bad token or permission is not.
    const transient = res.status >= 500 || err?.code === 2 || err?.is_transient === true;
    if (!transient || i >= attempts) {
      throw new Error(`Meta insights HTTP ${res.status}: ${err?.message ?? 'unknown error'} (code ${err?.code ?? '-'})`);
    }
    await new Promise((r) => setTimeout(r, 2000 * i));
  }
}

/** Meta spend per IST day (₹, before GST), inclusive range. Days without spend are absent. */
export async function fetchDailySpend(since: string, until: string): Promise<Map<string, number>> {
  const token = process.env.META_ADS_READ_TOKEN;
  if (!token) throw new Error('META_ADS_READ_TOKEN is not set');
  const spend = new Map<string, number>();
  let after: string | undefined;
  do {
    const params = new URLSearchParams({
      level: 'account',
      fields: 'spend',
      time_increment: '1',
      limit: '500',
      time_range: JSON.stringify({ since, until }),
      access_token: token,
    });
    if (after) params.set('after', after);
    const body = await getWithRetry(`${GRAPH}/${AD_ACCOUNT_ID}/insights?${params}`);
    for (const row of body.data ?? []) {
      spend.set(row.date_start, Math.round(parseFloat(row.spend || '0') * 100) / 100);
    }
    after = body.paging?.next ? body.paging?.cursors?.after : undefined;
  } while (after);
  return spend;
}

export interface AdSpendChange {
  day: string;
  from: number | null; // our row's amount before, null when there was none
  to: number | null; // null when our row is removed
  reason: 'meta' | 'hand-entered row' | 'no spend';
}

/**
 * Bring our rows for [since, until] in line with Meta and mark the changed days for the
 * aggregate recompute. With `dryRun`, report the changes without writing anything.
 */
export async function syncAdSpend(
  since: string,
  until: string = istToday(),
  opts: { dryRun?: boolean } = {}
): Promise<{ daysWithSpend: number; changes: AdSpendChange[] }> {
  const spend = await fetchDailySpend(since, until);
  const { dailyAdSpendStore } = await import('../db/featureStores');

  // Rows are stored at UTC midnight of their day; read a day of slack on both sides and
  // group by IST day, the way the aggregates read them.
  const existing = await dailyAdSpendStore.query([
    ['date', '>=', new Date(`${shift(since, -1)}T00:00:00.000Z`)],
    ['date', '<', new Date(`${shift(until, 2)}T00:00:00.000Z`)],
  ]);
  const byDay = new Map<string, any[]>();
  for (const row of existing) {
    const day = istDateKey(new Date(row.date));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(row);
  }

  const changes: AdSpendChange[] = [];
  for (const day of daysBetween(since, until)) {
    const rows = byDay.get(day) ?? [];
    const ours = rows.find((r) => r.source === SOURCE);
    const handEntered = rows.some((r) => r.source !== SOURCE);
    const amount = spend.get(day) ?? 0;

    if (handEntered || amount <= 0) {
      if (ours) {
        changes.push({ day, from: ours.amount ?? 0, to: null, reason: handEntered ? 'hand-entered row' : 'no spend' });
        if (!opts.dryRun) await dailyAdSpendStore.deleteById(ours._id);
      }
      continue;
    }
    if (ours && ours.amount === amount) continue;

    changes.push({ day, from: ours ? ours.amount ?? 0 : null, to: amount, reason: 'meta' });
    if (!opts.dryRun) {
      const now = new Date();
      await dailyAdSpendStore.setById(`meta-${day}`, {
        date: new Date(`${day}T00:00:00.000Z`),
        amount,
        dailyAmountSpent: amount,
        notes: 'Meta Ads spend (synced automatically)',
        source: SOURCE,
        syncedAt: now,
        updatedAt: now,
        ...(ours ? {} : { createdAt: now }),
      });
    }
  }

  if (!opts.dryRun) await markDatesDirty(changes.map((c) => c.day));
  return { daysWithSpend: spend.size, changes };
}
