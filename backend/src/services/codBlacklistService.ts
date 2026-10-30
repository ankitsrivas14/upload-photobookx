import { getFirestore } from '../db/firestore';
import { getDateKeyByName } from '../db/ordersRepo';
import shiprocketService from './shiprocketService';

/**
 * COD address blacklist (Tools › COD blacklist). Buyers whose COD order fails get the "no-cod" customer tag in
 * Shopify, and some come back under another name, email and phone with nearly the same address. The local booking job
 * (Claude Code, photobookx-shipping lib/blacklist.mjs) keeps the delivery addresses of orders that were returned, lost
 * or had a failed delivery attempt, and holds a NEW COD order whose address matches an active entry instead of booking
 * it. That job clears an entry when its order, or any later order to the same address, is delivered. Orders added here
 * by hand are `manual`: no delivery clears them, only Remove here.
 *
 *   codBlacklist/{order}  { order, orderId, payment, status: 'failed' | 'attempted' | 'manual', srStatus, placedAt,
 *                           knownAt, address, city, state, pincode, addedAt, clearedAt, clearedBy,
 *                           manual: { by, at, note } }
 *   meta/codBlacklist     { refreshedAt, active, total }   the booking job's last sweep of Shiprocket's orders
 */

const COLLECTION = 'codBlacklist';
const META = 'meta/codBlacklist';

const iso = (t: any): string | null =>
  t?.toDate ? t.toDate().toISOString() : t instanceof Date ? t.toISOString() : typeof t === 'string' ? t : null;

export interface BlacklistEntry {
  order: string;
  status: 'failed' | 'attempted' | 'manual';
  srStatus: string | null;
  payment: string | null;
  placedAt: string | null;
  knownAt: string | null;
  address: string[];
  city: string | null;
  state: string | null;
  pincode: string | null;
  clearedAt: string | null;
  clearedBy: string | null;
  manual: { by: string | null; at: string | null; note: string | null } | null;
}

function entryOf(e: any): BlacklistEntry {
  return {
    order: String(e.order),
    status: e.status === 'manual' || e.status === 'attempted' ? e.status : 'failed',
    srStatus: e.srStatus ?? null,
    payment: e.payment ?? null,
    placedAt: iso(e.placedAt),
    knownAt: iso(e.knownAt),
    address: Array.isArray(e.address) ? e.address.map(String) : [],
    city: e.city ?? null,
    state: e.state ?? null,
    pincode: e.pincode ?? null,
    clearedAt: iso(e.clearedAt),
    clearedBy: e.clearedBy ?? null,
    manual: e.manual ? { by: e.manual.by ?? null, at: iso(e.manual.at), note: e.manual.note ?? null } : null,
  };
}

/** Every entry, active and cleared, latest known first, and when the booking job last swept Shiprocket. */
export async function getBlacklist() {
  const db = getFirestore();
  const [snap, meta] = await Promise.all([db.collection(COLLECTION).get(), db.doc(META).get()]);
  const entries = snap.docs.map((d) => entryOf(d.data())).sort((a, b) => (b.knownAt ?? '').localeCompare(a.knownAt ?? ''));
  return { entries, refreshedAt: iso(meta.data()?.refreshedAt) };
}

/** "PB1234S" (or a Shiprocket clone, "PB1234S-C") from what was typed; null when it doesn't look like an order. */
export function orderName(input: unknown): string | null {
  const m = String(input ?? '').trim().toUpperCase().replace(/^#/, '').match(/^PB\d{3,6}S(-C)?$/);
  return m ? m[0] : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Shiprocket's "30 Oct 2026, 11:38 AM" (India time) as a Date; null when it doesn't parse. */
function srDate(s: unknown): Date | null {
  const m = String(s ?? '').match(/(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4}),? (\d{1,2}):(\d{2}) ?([AP]M)/i);
  const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
  if (!m || month < 0) return null;
  const hour = (Number(m[4]) % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1]), hour, Number(m[5])) - 5.5 * 3600e3);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The order as Shiprocket has it, delivery address included. Shiprocket's search only looks at the last 30 days
 * unless given dates, so it searches from a few days before the order was placed (from the orders Firestore keeps).
 */
async function shiprocketOrder(order: string): Promise<any | null> {
  const dateKey = await getDateKeyByName(order.replace(/-C$/, ''));
  const query: Record<string, string> = { search: order, per_page: '20' };
  if (dateKey) {
    const placed = new Date(`${dateKey}T00:00:00Z`);
    const today = new Date(Date.now() + 5.5 * 3600e3);
    const to = new Date(placed.getTime() + 31 * 86400e3);
    query.from = ymd(new Date(placed.getTime() - 3 * 86400e3));
    query.to = ymd(to < today ? to : today);
  }
  const { data } = await shiprocketService.listOrders(query);
  return data.find((o: any) => String(o.channel_order_id ?? '').replace(/^#/, '').toUpperCase() === order) ?? null;
}

/**
 * Adds an order's delivery address to the blacklist by hand. `error` (with an HTTP status) when the order number is
 * wrong, already listed, not in Shiprocket, or has no address there.
 */
export async function addToBlacklist(
  input: unknown,
  note: string | null,
  by: string,
): Promise<{ entry?: BlacklistEntry; status?: number; error?: string }> {
  const order = orderName(input);
  if (!order) return { status: 400, error: 'Enter an order number like PB1234S' };
  const ref = getFirestore().doc(`${COLLECTION}/${order}`);
  const existing = (await ref.get()).data();
  if (existing && !existing.clearedAt) return { status: 409, error: `${order} is already on the blacklist` };
  const o = await shiprocketOrder(order);
  if (!o) return { status: 404, error: `${order} was not found in Shiprocket` };
  const address = [o.customer_address, o.customer_address_2].map((s) => String(s ?? '').trim()).filter(Boolean);
  const pincode = String(o.customer_pincode ?? '').trim();
  if (!address.length || !pincode) return { status: 422, error: `Shiprocket has no delivery address for ${order}` };
  const now = new Date();
  await ref.set({
    order,
    orderId: o.id ?? null,
    payment: String(o.payment_method).toLowerCase() === 'cod' ? 'COD' : 'Prepaid',
    status: 'manual',
    srStatus: String(o.status ?? '').trim() || null,
    placedAt: srDate(o.channel_created_at) ?? srDate(o.created_at),
    knownAt: now,
    address,
    city: String(o.customer_city ?? '').trim(),
    state: String(o.customer_state ?? '').trim(),
    pincode,
    addedAt: existing?.addedAt ?? now,
    clearedAt: null,
    clearedBy: null,
    manual: { by, at: now, note: note?.trim() || null },
  });
  return { entry: entryOf((await ref.get()).data()) };
}

/** Takes an entry off the blacklist by hand; null when the order has no active entry. */
export async function removeFromBlacklist(order: string, note: string | null, by: string): Promise<BlacklistEntry | null> {
  const ref = getFirestore().doc(`${COLLECTION}/${order}`);
  const e = (await ref.get()).data();
  if (!e || e.clearedAt) return null;
  const why = note?.trim();
  await ref.update({ clearedAt: new Date(), clearedBy: `hand: ${by}${why ? ` (${why})` : ''}` });
  return entryOf((await ref.get()).data());
}
