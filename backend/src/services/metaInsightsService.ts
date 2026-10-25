import { getFirestore } from '../db/firestore';
import { AD_ACCOUNT_ID, GRAPH, getWithRetry, istToday } from './metaAdSpendService';
import { shiftDateKey } from './aggregatesService';

/**
 * Daily campaign insights from Meta into Firestore `metaInsightsDaily/{date}_{campaignId}`,
 * read by the Agency page and the Expenses page. Replaces the CSV uploads of the retired Ads
 * Analysis page. Purchases and their value follow Ads Manager's Purchases column
 * (omni_purchase first) under the account's attribution setting, as in the daily ad review.
 */

const COLLECTION = 'metaInsightsDaily';
// Ads Manager's "Purchases" column first, pixel-only purchases last.
const PURCHASE = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'];
// Longer insights requests time out.
const CHUNK_DAYS = 30;
const COMPARED = ['name', 'spend', 'purchases', 'purchaseValue', 'roas', 'impressions', 'reach', 'linkClicks'];

export interface CampaignDay {
  date: string; // 'YYYY-MM-DD' in the ad account's time zone (IST)
  campaignId: string;
  name: string;
  spend: number; // ₹ before GST
  purchases: number;
  purchaseValue: number;
  roas: number;
  impressions: number;
  reach: number;
  linkClicks: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function pick(list: any[] | undefined, types: string[]): number {
  for (const t of types) {
    const hit = list?.find((a) => a.action_type === t);
    if (hit) return parseFloat(hit.value) || 0;
  }
  return 0;
}

/** Meta's daily campaign rows for [since, until] (only campaigns that delivered that day). */
export async function fetchCampaignDays(since: string, until: string): Promise<CampaignDay[]> {
  const token = process.env.META_ADS_READ_TOKEN;
  if (!token) throw new Error('META_ADS_READ_TOKEN is not set');
  const out: CampaignDay[] = [];
  for (let from = since; from <= until; from = shiftDateKey(from, CHUNK_DAYS)) {
    const end = shiftDateKey(from, CHUNK_DAYS - 1);
    const to = end < until ? end : until;
    let after: string | undefined;
    do {
      const params = new URLSearchParams({
        level: 'campaign',
        fields: 'campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,actions,action_values',
        time_increment: '1',
        limit: '500',
        time_range: JSON.stringify({ since: from, until: to }),
        use_unified_attribution_setting: 'true',
        access_token: token,
      });
      if (after) params.set('after', after);
      const body = await getWithRetry(`${GRAPH}/${AD_ACCOUNT_ID}/insights?${params}`);
      for (const r of body.data ?? []) {
        const spend = round2(parseFloat(r.spend || '0'));
        const purchaseValue = round2(pick(r.action_values, PURCHASE));
        out.push({
          date: r.date_start,
          campaignId: String(r.campaign_id),
          name: r.campaign_name,
          spend,
          purchases: pick(r.actions, PURCHASE),
          purchaseValue,
          roas: spend > 0 ? round2(purchaseValue / spend) : 0,
          impressions: parseInt(r.impressions || '0', 10),
          reach: parseInt(r.reach || '0', 10),
          linkClicks: parseInt(r.inline_link_clicks || '0', 10),
        });
      }
      after = body.paging?.next ? body.paging?.cursors?.after : undefined;
    } while (after);
  }
  return out;
}

/** Stored campaign days, from `since` on when given. */
export async function campaignDays(since?: string): Promise<CampaignDay[]> {
  let q: FirebaseFirestore.Query = getFirestore().collection(COLLECTION);
  if (since) q = q.where('date', '>=', since);
  const snap = await q.get();
  return snap.docs.map((d) => d.data() as CampaignDay);
}

/** Stored spend per day across all campaigns, for [since, until]. */
export async function spendByDay(since: string, until: string): Promise<Map<string, number>> {
  const snap = await getFirestore().collection(COLLECTION).where('date', '>=', since).where('date', '<=', until).get();
  const byDay = new Map<string, number>();
  for (const d of snap.docs) {
    const r = d.data() as CampaignDay;
    byDay.set(r.date, round2((byDay.get(r.date) ?? 0) + (r.spend || 0)));
  }
  return byDay;
}

/** Bring stored campaign days for [since, until] in line with Meta, writing only changed rows. */
export async function syncCampaignInsights(
  since: string,
  until: string = istToday()
): Promise<{ rows: number; written: number }> {
  const rows = await fetchCampaignDays(since, until);
  const db = getFirestore();
  const existing = await db.collection(COLLECTION).where('date', '>=', since).where('date', '<=', until).get();
  const stored = new Map(existing.docs.map((d) => [d.id, d.data()]));
  const changed = rows.filter((r) => {
    const s = stored.get(`${r.date}_${r.campaignId}`);
    return !s || COMPARED.some((f) => s[f] !== (r as any)[f]);
  });
  for (let i = 0; i < changed.length; i += 450) {
    const batch = db.batch();
    for (const r of changed.slice(i, i + 450)) {
      batch.set(db.collection(COLLECTION).doc(`${r.date}_${r.campaignId}`), {
        ...r,
        level: 'campaign',
        syncedAt: new Date(),
      });
    }
    await batch.commit();
  }
  return { rows: rows.length, written: changed.length };
}
