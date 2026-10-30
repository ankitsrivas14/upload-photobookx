import { getFirestore } from '../db/firestore';
import { getMany as getCharges } from '../db/shippingRepo';

/**
 * Freight claims (Analysis › Freight claims): failed Shiprocket orders we take up with Shiprocket support, to get the
 * forward and RTO freight back when the courier, not the customer, caused the failure. Every failed order outside
 * "Refused or cancelled at the door" placed on or after 1 Sept 2026 is in the pipeline, newest first (Shiprocket won't
 * act on older ones); it gets a claim doc once a ticket exists. The local claims job (Claude Code, emailing
 * support@shiprocket.com through Richpanel) writes the claims and copies each thread's messages. The only write here
 * is a refund you mark by hand after finding it in the wallet; `manual` records it, and the claims job leaves such a
 * claim alone.
 *
 *   freightClaims/{order}                { order, status, richpanel: { id, number, url }, tickets, lastMessageAt,
 *                                          lastMessageFrom, nextStep, refund: { promisedAt, promisedAmount,
 *                                          receivedAt, receivedAmount }, manual: { status, by, at, note }, notes,
 *                                          updatedAt }
 *   freightClaims/{order}/messages/{id}  { at, from: 'us' | 'shiprocket', author, text, kind: 'message' | 'survey' }
 */

const CLAIMS = 'freightClaims';
const SKIPPED_GROUP = 'Refused or cancelled at the door';
/** Orders placed before this (1 Sept 2026, India) are out of the pipeline. */
const CUTOFF = Date.parse('2026-09-01T00:00:00+05:30');

/** A claim's stage; orders without a claim doc are not_started. */
export const CLAIM_STATUSES = [
  'not_started',
  'asked_reason',
  'needs_you',
  'refund_requested',
  'refund_promised',
  'refund_received',
  'customer_fault',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const iso = (t: any): string | null => (t?.toDate ? t.toDate().toISOString() : typeof t === 'string' ? t : null);
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const rupees = (v: number) => Math.round(v * 100) / 100;
const placed = (f: any) => (f.placedAt?.toMillis ? f.placedAt.toMillis() : 0);

/** The freight we ask back: the forward leg and the RTO leg, from the Shiprocket charges the admin keeps. */
function freightOf(charge: any) {
  if (!charge) return null;
  const forward = num(charge.freightForward);
  const rto = num(charge.freightRTO);
  return { forward: rupees(forward), rto: rupees(rto), total: rupees(forward + rto) };
}

function row(f: any, claim: any, charge: any) {
  const status = CLAIM_STATUSES.includes(claim?.status) ? (claim.status as ClaimStatus) : 'not_started';
  return {
    order: String(f.order),
    placedAt: iso(f.placedAt),
    month: String(f.month),
    payment: f.payment === 'COD' ? 'COD' : 'Prepaid',
    value: num(f.value),
    courier: f.courier ?? null,
    awb: f.awb ?? null,
    shipmentStatus: String(f.status ?? ''),
    group: String(f.group),
    reason: f.reason ?? null,
    attempts: typeof f.attempts === 'number' ? f.attempts : null,
    status,
    tickets: Array.isArray(claim?.tickets) ? claim.tickets.map(String) : [],
    lastMessageAt: iso(claim?.lastMessageAt),
    lastMessageFrom: claim?.lastMessageFrom === 'us' || claim?.lastMessageFrom === 'shiprocket' ? claim.lastMessageFrom : null,
    nextStep: claim?.nextStep ?? null,
    freight: freightOf(charge),
    refund: claim?.refund
      ? {
          promisedAt: iso(claim.refund.promisedAt),
          promisedAmount: claim.refund.promisedAmount ?? null,
          receivedAt: iso(claim.refund.receivedAt),
          receivedAmount: claim.refund.receivedAmount ?? null,
        }
      : null,
    updatedAt: iso(claim?.updatedAt),
  };
}

/** Every order in the pipeline, newest first (the order the job raises tickets in), with its claim and freight. */
export async function getFreightClaims() {
  const db = getFirestore();
  const [failed, claims] = await Promise.all([db.collection('failureReasons').get(), db.collection(CLAIMS).get()]);
  const eligible = failed.docs.map((d) => d.data()).filter((f) => f.group !== SKIPPED_GROUP && placed(f) >= CUTOFF);
  const byOrder = new Map(claims.docs.map((d) => [d.id, d.data()]));
  const charges = await getCharges(eligible.map((f) => String(f.order)));
  const rows = eligible
    .sort((a, b) => placed(b) - placed(a) || String(b.order).localeCompare(String(a.order)))
    .map((f) => row(f, byOrder.get(String(f.order)), charges.get(String(f.order))));
  return {
    statuses: CLAIM_STATUSES,
    counts: Object.fromEntries(CLAIM_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])),
    claims: rows,
  };
}

/**
 * Closes a claim as refunded with what you found in the Shiprocket wallet: the amount and the day (YYYY-MM-DD, India)
 * it was credited. Returns the updated claim, or null when the order isn't in the pipeline.
 */
export async function markClaimRefunded(order: string, input: { amount: number; date: string; note?: string | null }, by: string) {
  const db = getFirestore();
  const f = await db.doc(`failureReasons/${order}`).get();
  if (!f.exists || f.data()?.group === SKIPPED_GROUP) return null;
  const now = new Date();
  await db.doc(`${CLAIMS}/${order}`).set(
    {
      order,
      status: 'refund_received',
      nextStep: null,
      refund: { receivedAmount: rupees(input.amount), receivedAt: new Date(`${input.date}T12:00:00+05:30`) },
      manual: { status: 'refund_received', by, at: now, note: input.note?.trim() || null },
      updatedAt: now,
    },
    { merge: true },
  );
  return getFreightClaim(order);
}

/** One order's claim and its conversation with Shiprocket, oldest message first; null when it isn't in the pipeline. */
export async function getFreightClaim(order: string) {
  const db = getFirestore();
  const [f, claim, messages] = await Promise.all([
    db.doc(`failureReasons/${order}`).get(),
    db.doc(`${CLAIMS}/${order}`).get(),
    db.collection(CLAIMS).doc(order).collection('messages').orderBy('at').get(),
  ]);
  if (!f.exists || f.data()?.group === SKIPPED_GROUP) return null;
  const c = claim.data();
  const charge = (await getCharges([order])).get(order);
  const manual = c?.manual ? { status: String(c.manual.status), by: c.manual.by ?? null, at: iso(c.manual.at), note: c.manual.note ?? null } : null;
  return {
    claim: { ...row(f.data(), c, charge), richpanel: c?.richpanel ?? null, notes: c?.notes ?? null, manual },
    messages: messages.docs.map((d) => {
      const m = d.data();
      return {
        id: d.id,
        at: iso(m.at),
        from: m.from === 'us' ? 'us' : 'shiprocket',
        author: m.author ?? null,
        text: String(m.text ?? ''),
        kind: m.kind === 'survey' ? 'survey' : 'message',
      };
    }),
  };
}
