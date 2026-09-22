# MongoDB Atlas → Firestore migration plan

## Why

Every performance wall we've hit traces to one thing: order data lives in a single
~15 MB `ShopifyOrderCache` document, and the current Atlas tier reads it at ~230 KB/s
(~60 s per read). That single fact causes:

- slow SalesPage / dashboard order reads (60–134 s),
- the `scheduledRefresh` job doing several 15 MB reads back-to-back and **timing out**
  (>540 s) → **orders stop syncing → stale data** (e.g. app at #PB6737S while Shopify
  is at #PB6749S),
- stale month partitions (the band-aid we added).

Moving to **Firestore** (same GCP project `photobookx-management`, region `asia-south1`,
no separate cluster) fixes the root cause: orders become **one document per order**,
queried by an index, so a month load reads ~500 small docs instead of one 15 MB blob.
Reads are fast and same-region to the functions.

## Current state

- **40 Mongoose models**, ~14 route groups, all DB access through Mongoose.
- Query patterns that don't map 1:1 to Firestore:
  - **7 aggregation pipelines** (`sales.ts`: monthly-order-counts, monthly-revenue,
    daily-order-stats). Firestore has no group-by pipeline.
  - **Regex** — mostly the internal `cacheKey: /^all_orders_/` (disappears with the
    redesign); the one user-facing use is `search-orders` (order-no / customer-name).
  - **Large `$in`** — the orders endpoint looks up shipping/delivery for thousands of
    order numbers at once. Firestore `in` is capped (≤30 values).
  - `findOneAndUpdate` upserts (18), `insertMany`/`bulkWrite`, `countDocuments`.
- Good news: the dashboard already reads **pre-aggregated daily tables**
  (`DailyOrderStats`, `DailyPnl`, `DailyShipping`, `DailyROAS`, `BreakevenSnapshot`),
  not raw orders. Those are small and map cleanly to Firestore.

## Firestore data-model decisions

| Concern | Mongo today | Firestore |
| --- | --- | --- |
| **Orders** (the hot path) | one 15 MB `ShopifyOrderCache` doc | `orders/{orderId}` — one doc per order, fields incl. `createdAtIST` (Timestamp) and `monthKey` ('YYYY-MM', indexed). Month load = `where('monthKey','==',m)`. |
| Daily rollups | `DailyOrderStats` etc. (~240 docs/yr) | same, `dailyOrderStats/{dateKey}` — tiny, cheap. |
| Shipping/delivery per order | separate collections, joined by `$in` | keep as `shippingCharges/{orderNumber}`, `deliveryDates/{orderNumber}`; look up by **document id** (batched `getAll`), not `$in` query. |
| Config singletons (COGS, breakeven snapshot) | one doc | same. |
| Lists (discarded/RTO/ack/ticket order ids) | collection of ids | `Set`-style collections; membership = doc get, not `$in`. |

**Key principle:** never scan the whole orders collection on a request. Bound every
read — a month (`monthKey`), a day, or a set of ids. The daily rollup docs already
serve the dashboards, so orders are read only for the SalesPage table (one month).

## Query-gap resolutions

- **Aggregations (monthly counts/revenue):** read the small `dailyOrderStats` docs for
  the range and sum in JS (already how the data flows) — no pipeline needed.
- **`search-orders`:** Firestore prefix query on order number
  (`orderByKey ≥ q AND < q+`); customer-name contains-search moves to a
  `nameLower` prefix field, or (if needed later) a search add-on. Minor feature.
- **Large `$in` (shipping/delivery join):** batch `getAll(ids)` by document id
  (chunks of 300 via `Promise.all`), which is fast and indexed in Firestore.
- **Upserts:** `set(..., {merge:true})`. **Atomicity:** Firestore transactions /
  batched writes (≤500 ops/batch).

## Strategy: a thin data-access layer + phased cutover

1. **Introduce a repository layer** (e.g. `backend/src/db/orders.ts`, `dailyStats.ts`,
   …) so routes call `ordersRepo.getMonth(m)` instead of Mongoose directly. This lets
   us swap the backing store per collection without touching route logic.
2. **Migrate collection-group by collection-group behind the repo**, verifying each.
3. Keep Mongo and Firestore **dual-readable during transition** (feature flag per
   repo) so we can roll back instantly.

## Phases

### Phase 1 — Orders hot path (delivers ~all the value)
- Enable Firestore (Native mode) in `photobookx-management`, region `asia-south1`.
- Add `orders/{id}` collection + composite index on `monthKey`.
- Write the `ordersRepo`: `getMonth`, `getById`, `search`, `upsertMany`, `patchStatus`.
- Repoint `syncOrders` to **upsert per-order into Firestore** (no 15 MB doc).
- Repoint the `/shopify/orders`, `search-orders`, `incomplete-day-orders` reads to the repo.
- One-time backfill: copy existing orders from the Mongo cache → Firestore.
- **Outcome:** order reads and the sync job stop touching the 15 MB blob → fast reads,
  sync no longer times out, data stays fresh. **Most of the pain gone here.**

### Phase 2 — Daily rollups + snapshots
- Move `DailyOrderStats`, `DailyPnl`, `DailyShipping`, `DailyROAS`, `BreakevenSnapshot`
  to Firestore; point the backfill writers and dashboard reads at the repos.
- Backfills read orders from Firestore (bounded) instead of the cache.

### Phase 3 — Everything else, group by group
- Expenses, COGS, attendance, bank, magic links, pincodes, abandoned checkouts, reels,
  agency, auth/SuperUser, etc. Each: repo + backfill/migrate + verify + cut over.

### Phase 4 — Decommission Mongo
- Remove Mongoose + `MONGO_URI`; drop the Atlas cluster after a verification window.

## Migration mechanics
- **Backfill script per collection**: read from Atlas, transform, `bulkWrite`/batch into
  Firestore; idempotent (keyed by natural id) so it can re-run.
- **Verification**: counts + spot-diff a sample per collection before flipping its read flag.
- **Cutover**: flip the repo's read source; keep writing both for a short window; then
  stop Mongo writes.
- **Rollback**: flip the flag back (both stores still populated during transition).

## Risks
- **Firestore query limits** (no `!=` chains, one range field, `in` ≤30) — the model
  above avoids them, but each ported query needs checking.
- **Read cost** — Firestore bills per doc read; the bounded-read design (month/day/ids +
  daily rollups) keeps volume low. Avoid full-collection scans.
- **Behavioral parity** — port query semantics carefully (timezone `monthKey`, `#`-prefix
  order-number handling) and verify with the diff step.

## Recommendation
Do **Phase 1 first and stop to evaluate.** It removes the 15 MB doc from the hot path
and the sync job — which is the entire current problem — at a fraction of the risk of a
full 40-collection migration. Phases 2–4 can follow if we still want to fully retire
Atlas.
