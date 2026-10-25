# Performance, architecture and cron plan

Audit of upload-photobooks (frontend on Vercel, Express API in one Firebase Cloud Function `api`, MongoDB Atlas + Firestore mid-migration, S3 for customer photos), October 25, 2026. Every number below was measured, not estimated, unless marked "approx".

## Measured baseline

| What | Measured | Why it matters |
|---|---|---|
| Frontend JavaScript | **one file, 2.56 MB (811 KB gzipped)** + 198 KB CSS (34 KB gzipped) | Every page, including the customer upload page `/upload/:token`, downloads and parses the whole admin app. No `React.lazy`, no chunk splitting. |
| Heavy libraries | xlsx, pdf-lib, pdfjs-dist, recharts, papaparse, react-markdown | Bundled into every page; each is used on 1–3 admin pages only. |
| `GET /magic-links/shopify/orders?all=true` | **5.1 MB, 13.1 s** (local, real data) | Loaded on open by Admin Dashboard and Stuck Orders, and by the Sales page "all" view. |
| Same, one month (May) | 804 KB, 2.6 s | Sales page also prefetches other months in the background. |
| `GET /sales/backlog-orders` | 1.45 MB | Whole backlog with full order objects. |
| `GET /magic-links/shopify/products` | 0.8–1.7 s | Calls Shopify on every request; no cache. |
| Most other page-load endpoints | 0.1–0.7 s | Fine; server compute is not the main problem. |
| API calls per page open | Dashboard ≈ 10, Sales ≈ 10+ | Each is a separate cross-origin request. |
| CORS preflight | `OPTIONS` answered without `Access-Control-Max-Age` | Browsers cache it ~5 s, so nearly every API call pays an extra round trip (~180–300 ms from India/Bangkok). |
| Response compression | none (no `compression` middleware) | The 5 MB orders payload goes out uncompressed; gzip would cut it ~85%. |
| Cold starts | `api` has no `minInstances`; every request also waits on `connectMongo()` middleware | First request after idle loads mongoose, AWS SDK, OpenAI, Shopify API and opens an Atlas connection. |
| Scheduled reads (approx) | ~5,900 orders + ~5,600 shipping docs per job run; ~1.1M Firestore reads/day | Jobs recompute everything every 15–30 min instead of the days that changed. |

## 1. Performance plan

Targets: initial JS ≤ 200 KB gzipped per page (upload page ≤ 80 KB), every list endpoint ≤ 300 KB and p95 ≤ 400 ms, repeat navigation instant from cache.

### P0: biggest wins (about a week)
1. **Split the bundle.** `React.lazy` + `Suspense` per route in `App.tsx`; `manualChunks` for react/router/recharts; dynamic `import()` for xlsx, pdf-lib, pdfjs, papaparse, react-markdown inside the click handlers that use them. Give `/upload/:token` its own entry so customers never download the admin app.
2. **Never load all orders on page open.** Add server-side pagination and filters (`status`, `month`, search) and a slim list shape (only the columns the table shows) to the orders endpoint. Admin Dashboard and Stuck Orders should ask for what they display (e.g. stuck = shipped > N days, not delivered) instead of everything. Expected: 5.1 MB → under 300 KB.
3. **Compress responses**: `app.use(compression())` in `app.ts`.
4. **Remove CORS preflights**: `cors({ maxAge: 7200 })` now; later serve the API same-origin through a Vercel rewrite (`/api/*` → the function), which removes preflights completely.
5. **Warm, light API**: `minInstances: 1` on `api`; lazy-`import()` OpenAI, AWS SDK and Shopify modules inside the routes that use them; skip `connectMongo()` for routes that only touch Firestore.

### P1: make every page feel instant (week 2)
6. **Client data cache**: TanStack Query with stale-while-revalidate and request de-duplication (`getMe` is fetched by every page today), persisted to IndexedDB so reopening a page renders immediately.
7. **One request per dashboard**: precompute a `dashboardSummary/<YYYY-MM>` doc (P&L, ROAS, shipping, order stats, breakeven) whenever orders change; the Dashboard reads one document instead of ~10 endpoints.
8. **Virtualise long tables** (Sales, Backlog, Bank transactions) with `@tanstack/react-virtual`.
9. **Cache slow upstreams**: Shopify products in Firestore (refresh hourly or on product webhooks); backlog as a slim list.
10. **Short HTTP caching** (`Cache-Control: private, max-age=30` + ETag) on aggregate endpoints.

### P2: keep it fast
11. Real-user monitoring (web-vitals → Firestore or Vercel Analytics) and per-route server timing logs; a budget check in CI that fails the build if the initial JS grows past the target.

## 2. Architecture plan

### Today
- One Express monolith in one function (`api`, 540 s timeout, 1 GiB) + three scheduled functions that load the same module graph.
- Two databases at once (Mongo Atlas + Firestore); every request waits for Mongo even when it only reads Firestore.
- Aggregates are rebuilt from the full order collection on a timer; list endpoints return raw Shopify order objects.
- Auth is opt-in per route (`requireAdmin` on each handler), so a forgotten guard means a public endpoint; six ads routes are public today (see section 4).
- Frontend: 20k lines, no data layer, very large page components (SalesPage 2,866 lines, DashboardPage 1,919).

### Target
1. **One database: Firestore.** Finish the migration plan (ads data `MetaAdPerformance`/`MetaAdAnalysis`, the 15 MB `ShopifyOrderCache` path) and remove Mongo from the request path. Store orders trimmed to the fields the app uses.
2. **Event-driven data.** Shopify webhooks (`orders/create`, `orders/updated`, `fulfillments/update`, `refunds/create`) → upsert the order → recompute only the affected date's aggregates (`dailyOrderStats`, `dailyPnl`, `dailyShipping`, `dailyRoas`, `dashboardSummary`). Timers become reconciliation, not the main path.
3. **Split functions by workload**: `api` (light, warm, short timeout), `webhooks`, `jobs` (scheduled), `ai` (OpenAI, long timeout), `files` (photo zip downloads, more memory).
4. **Deny-by-default auth**: one `app.use('/api/admin', requireAdmin)` with an explicit allowlist for the login route; move the admin token from `localStorage` to an httpOnly cookie once the API is same-origin; rate-limit login and AI routes; validate inputs with zod.
5. **Shared types**: one `packages/types` used by backend and frontend so API shapes can't drift.
6. **Frontend structure**: feature folders (`features/sales`, `features/dashboard`, …), TanStack Query hooks per feature, split the 2,000+ line pages into components, an error boundary, and Sentry.
7. **Observability**: structured logs, Error Reporting alerts, an uptime check on `/api/health`, and a GCP budget alert.

## 3. Cron jobs plan

### Today

| Job | Schedule | Does | Problem |
|---|---|---|---|
| `ordersSync` | every 10 min | Shopify orders **created** in the last 14 days → Firestore | Status changes on older orders (late delivery, RTO, cancel, refund) never reach Firestore, so delivery %, RTO and breakeven drift. Rewrites ~14 days of orders 144×/day. |
| `scheduledRefresh` | every 30 min | Same 14-day pull, Shiprocket charges, then rebuild order stats, shipping stats and daily P&L for **all** dates | Full rebuild every 30 min. |
| `roasRecompute` | every 15 min | Rebuild DailyROAS for **all** dates | Full rebuild every 15 min; data only changes when orders or ad spend change. |

### Proposed (times in IST)

| Job | Schedule | Purpose |
|---|---|---|
| Shopify webhooks | real time | Order created/updated/fulfilled/refunded → upsert + recompute that day. Replaces most polling. |
| `ordersReconcile` | every 15 min | Shopify `updated_at_min = last cursor − 5 min` (cursor in `meta/ordersSync`), catches any missed webhook; no 14-day re-writes. |
| `shippingCharges` | hourly | Shiprocket charges only for orders that turned terminal without a charge. |
| `aggregatesRebuild` | daily 02:30 | Full rebuild of daily aggregates as a safety net (replaces the 15/30-min full rebuilds). |
| `metaInsights` | daily 02:00 + every 3 h | Meta Marketing API (read-only token) → `metaInsightsDaily`; re-pulls the last 7 days for late attribution. Replaces CSV uploads; feeds Ads Analysis, Agency and Claude Analysis. |
| `breakevenSnapshot` | daily 03:00 | Refresh breakeven from the last 90 settled days. |
| `photoRetention` | daily 04:00 | Delete S3 photos N days after an order is printed/delivered (or an S3 lifecycle rule); marks `imagesDeleted`. Privacy and storage cost. |
| `firestoreBackup` | daily 03:30 | Managed export of Firestore to a GCS bucket with 30-day retention (or enable point-in-time recovery). |
| `morningDigest` | daily 08:00 | Yesterday's orders, revenue, ad spend, ROAS vs breakeven, stuck orders and RTO spikes → email/WhatsApp. |

Expired magic links and caches should use Firestore TTL policies rather than a cron.

## 4. Security items found during the audit (fix with P0)
1. **Six public ads routes** in `routes/sales.ts` (`/ads-analysis/:date`, `/ads-analysis-latest`, `/ads-analysis-dates`, `/ads-performance/:date`, `/ads-performance-all`, `/ads-chat`): anyone with the API URL can read all ad data, and `/ads-chat` lets anyone spend OpenAI credit. Deny-by-default auth (2.4) closes them.
2. `express.json()` has the default 100 KB limit and the error handler turns every error into a 500, so oversized requests fail with "Internal server error".
3. The admin JWT lives in `localStorage` (readable by any injected script).

## Suggested order
- **Week 1**: P0 items 1–5, deny-by-default auth, `updated_at_min` order sync.
- **Week 2**: TanStack Query, dashboard summary doc, table virtualisation, products cache, incremental aggregates.
- **Weeks 3–4**: Shopify webhooks, function split, finish the Mongo → Firestore migration, Meta insights job, backups, photo retention, morning digest.
