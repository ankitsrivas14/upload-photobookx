# Firebase Migration Plan

Goal: retire the standalone Express backend (Render) and the Vercel frontend host, and run
everything on Firebase / Google Cloud — Firebase Hosting + Cloud Functions, with Firebase
Storage, and (optionally) Firestore and Firebase Auth.

This is a living plan. Phases are ordered so that each one ships independently and is
reversible. Phases 1–3 are the core "get off Render/S3" work; 4–6 are optional and can be
deferred or skipped.

---

## 1. What exists today (as-studied, 2026-09-11)

**Frontend** — Vite + React 19 SPA (`frontend/`), deployed on Vercel.
- All API calls go through `frontend/src/services/api.ts` → `VITE_API_URL` (99 endpoints).
  Only one other direct `fetch` (`GSTMonthlyReports.tsx`) and it uses the same env var.
- SPA routing via `vercel.json` rewrite (`/(.*) → /index.html`).
- No Firebase, no server components, no websockets. Cutover is essentially one env var.

**Backend** — Express 5 + TypeScript (`backend/`), ~9,900 LOC, deployed on Render.
- 14 route groups under `/api/admin/*` plus public `/api/upload/*`. Health at `/api/health`.
- **Auth**: custom JWT (`jsonwebtoken`) + bcrypt over a `SuperUser` Mongo collection;
  `requireAdmin` middleware (`routes/adminAuth.ts`). 7-day tokens, stored in `localStorage`.
  Magic-link upload tokens are a *separate* token system (not user auth).
- **Database**: MongoDB (Mongoose 9), **38 models**, on MongoDB Atlas. Heavy use of
  aggregation, `$in`, date-range scans, and one very large document pattern
  (`ShopifyOrderCache` holds whole order batches as arrays).
- **Storage**: AWS S3 — customer photo uploads (`multer` memory → `PutObject`), image
  view (`GetObject` piped to response), delete/replace, and a per-order **zip download**
  (`archiver` streamed to response). Only 3 files touch S3: `routes/upload.ts`,
  `routes/magicLinks.ts`, `routes/deliveryDates.ts`.
  - S3 credentials: explicit keys when present, else `fromInstanceMetadata()` (EC2 IMDS) —
    the IMDS path will not work on GCP, so this must change during the Storage migration.
- **External integrations**: Shopify Admin API (order cache in Mongo), Shiprocket, Delhivery,
  Meta Ads, OpenAI (`gpt-5.6`), all keyed via `.env`.
- **Background work**: `scheduleRoasRecompute()` — an in-process, coalesced, fire-and-forget
  recompute triggered from `shopifyService.updateCache()`. **No cron / no setInterval.**
  (`CRON_SECRET` is present in `.env` but unused in code.)
- **Boot behavior that must change for Functions**: `mongoose.connect(...)` runs at module
  top level and `process.exit(1)` on failure; the server then `app.listen`s. Cloud Functions
  must not `listen` or `exit`, and must reuse the Mongo connection across invocations.

**Env surface** (`backend/.env`): `PORT, NODE_ENV, MONGO_URI, JWT_SECRET, FRONTEND_URL,
ADMIN_REGISTRATION_SECRET, PRINTED_PHOTOS_PRODUCT_ID, SHOPIFY_*, AWS_* (S3), SHIPROCKET_*,
OPENAI_API_KEY, DELHIVERY_*, META_*, ANTHROPIC_API_KEY (dead — code is OpenAI-only), CRON_SECRET (unused)`.

**Local run confirmed**: `cd backend && yarn build && node dist/index.js` boots, connects to
Atlas, and `GET /api/health` returns ok. Frontend dev defaults to `http://localhost:3001`.

---

## Decision (2026-09-11): keep Mongo, just replace Render

Confirmed scope: **retire the Render Express backend by moving it to Cloud Functions, and
keep MongoDB Atlas.** Firestore migration (Phase 5) and Firebase Auth (Phase 4) are **out of
scope** for now. Firebase Storage (Phase 2) is **not required** to leave Render, but a small
S3-credentials fix **is** mandatory (see Phase 1) because the current EC2/IMDS credential path
does not work on Cloud Functions — S3 stays as the bucket, only how we authenticate to it changes.

Active phases: **0 → 1 → 3.** Everything else deferred.

## 2. The one big decision: Firestore vs. keep MongoDB Atlas
> **Resolved:** keep Atlas (option A). Section retained for background.

This dominates cost, risk, and timeline, so decide it early.

- **Keep MongoDB Atlas, connect from Cloud Functions** (recommended for Phases 1–3).
  Functions dial Atlas over the internet. Near-zero data-layer rewrite. Keeps aggregations
  and the `ShopifyOrderCache` pattern working as-is. Downside: still paying Atlas, still a
  non-Firebase dependency.
- **Migrate to Firestore** (Phase 5, optional, largest effort). Firestore has no server-side
  joins or aggregation pipeline, different query semantics (`$in` ≤ 30, no `$ne`/negation,
  composite-index requirements), 1 MiB document cap (breaks `ShopifyOrderCache` big docs),
  and every Mongoose model + query must be rewritten. Analytics (ROAS/P&L/breakeven,
  agency) rely heavily on aggregation — those become app-side aggregation or precomputed
  documents.

**Recommendation**: do the compute/host/storage moves first on Atlas (Phases 1–3), then
decide Firestore per-collection. Simple key/value-ish collections (settings, prefixes,
uploaded-image records, magic links) port easily; the analytics + order-cache collections
are the hard 20% — migrate those last, or leave them on Atlas indefinitely.

---

## 3. Target architecture

- **Firebase Hosting** serves the built SPA and rewrites `/api/**` → the API function,
  `**` → `/index.html` (replaces `vercel.json`).
- **Cloud Functions v2** (Cloud Run under the hood — required for long timeouts, bigger
  memory, and the 32 MB request bodies). Phase 1 runs the **whole Express app inside one
  HTTPS function** (`onRequest`); heavy endpoints can be split out later (Phase 6).
- **Firebase Storage (GCS)** replaces S3.
- **MongoDB Atlas** retained initially; **Firestore** optional later.
- **Secret Manager** (Functions params/secrets) replaces `.env`.
- **Custom JWT auth retained** initially; **Firebase Auth** optional later.

---

## Phase 0 — Foundations & decisions
**Scope**: Firebase project + tooling; no app changes.
- Create/choose the Firebase project; enable Hosting, Functions (Blaze plan), Storage,
  Secret Manager. `firebase init` (hosting + functions, TypeScript).
- Load every secret from `backend/.env` into Secret Manager (drop the two dead ones:
  `ANTHROPIC_API_KEY`, `CRON_SECRET`).
- Decide the DB strategy from §2 (recommended: keep Atlas for now).
- Add Atlas network access for Cloud Functions egress (Atlas IP allowlist / `0.0.0.0/0`
  with strong auth, or VPC egress + peering if hardening later).
**Done when**: `firebase deploy` of a hello-world function + Hosting works in the project.
**Risk**: low.

## Phase 1 — Lift-and-shift the API to Cloud Functions + Hosting
**Scope**: run the existing Express app on Firebase, unchanged in behavior. Still Atlas, still S3.
- Restructure so the Express `app` is **exported** (not `listen`-ed). Wrap:
  `export const api = onRequest({ region, timeoutSeconds: 540, memory: '1GiB', secrets: [...] }, app)`.
- **Mongo connection reuse**: replace top-level `mongoose.connect` + `process.exit` with a
  cached lazy connector (connect once per warm instance; `await` it in a small middleware or
  at first use; never `process.exit`). Set `serverSelectionTimeoutMS` low so cold Atlas
  failures return 5xx instead of hanging.
- Config: read from `process.env` populated by Secret Manager; keep `config/index.ts` shape.
- CORS: allow the new Hosting domain(s) + `upload.photobookx.com`; keep behavior.
- Hosting `rewrites`: `/api/** → function:api`, `** → /index.html`. Deploy SPA to Hosting.
- Frontend cutover: point `VITE_API_URL` at the Hosting origin (same-origin `/api`, so it can
  be empty/relative). One build-time env change.
- Interim S3: since IMDS won't work on GCP, force explicit-key S3 credentials via env until
  Phase 2 replaces S3 entirely.
- **Verify the long/streaming endpoints** under Functions: AI ads analysis (multi-batch
  OpenAI — needs the 540s timeout), the order-image **zip** (`archive.pipe(res)`), and image
  `GetObject` streaming. Bump memory if zips are large.
- **Background work caveat**: `scheduleRoasRecompute` fire-and-forget will be **killed after
  the response** on Functions. Acceptable stopgap: `await` it inline on the triggering
  request; proper fix in Phase 3.
**Done when**: the app works end-to-end on `*.web.app` with Render turned off (keep Render as
instant rollback for a week).
**Risk**: medium — connection reuse, timeouts, and the fire-and-forget change are the traps.
**Rollback**: repoint DNS/`VITE_API_URL` back to Render.

### Phase 1 execution checklist (keep-Mongo scope)

Two sub-options for where the frontend lives:
- **1a (minimal, recommended first):** leave the frontend on Vercel, point `VITE_API_URL` at
  the new Functions URL. Cross-origin, so CORS must allow the Vercel domain. Nothing else moves.
- **1b (nicer, later):** also move the SPA to Firebase Hosting with `/api/**` rewrites so the
  API is same-origin (no CORS). Do this only after 1a is proven.

Work split —

**In-repo, no Firebase account needed (I can do these now):**
1. Export the Express `app` without `listen()`; add a `functions/` entry that wraps it in a v2
   `onRequest` (region, `timeoutSeconds: 540`, `memory: '1GiB'`, declared `secrets`).
2. Replace top-level `mongoose.connect` + `process.exit` with a cached lazy connector
   (connect once per warm instance, `await` before handling, low `serverSelectionTimeoutMS`,
   never exit). Keep `dist/index.js` working for local `node` runs too.
3. Force explicit-key S3 credentials (drop the `fromInstanceMetadata()` fallback) in
   `routes/upload.ts` + `routes/magicLinks.ts`; keys come from Secret Manager env.
4. Make `scheduleRoasRecompute` awaited inline on its trigger request (interim; Phase 3
   replaces it). Nothing else relies on post-response execution.
5. Add `firebase.json` (functions + optional hosting rewrites) and `.firebaserc`; wire a build
   so `backend/` compiles into the functions package.
6. CORS: add the Functions/Hosting origins alongside `upload.photobookx.com`.

**Needs your Firebase account / hands:**
7. Create the Firebase project on the **Blaze** plan; `firebase login`; set `.firebaserc`.
8. Put every `.env` secret into Secret Manager (skip dead `ANTHROPIC_API_KEY`, `CRON_SECRET`).
9. Atlas: allow Cloud Functions egress in the IP allowlist.
10. `firebase deploy --only functions`; smoke-test `/api/health` + a few real endpoints.
11. Point `VITE_API_URL` at the Functions URL; redeploy the frontend.
12. Keep Render running for ~a week as instant rollback, then decommission.

## Phase 2 — S3 → Firebase Storage (GCS)  *(deferred — not needed to leave Render)*
**Scope**: replace S3 in the 3 files that use it; migrate existing objects.
- Swap `@aws-sdk/client-s3` calls for the Firebase Admin Storage SDK:
  `PutObject`→`file.save()`, `GetObject`+pipe→`file.createReadStream()`, `DeleteObject`→
  `file.delete()`, zip stays `archiver` piped from read streams, signed view URLs via
  `getSignedUrl`.
- Keep the same object key scheme so `UploadedImage` records (which store keys) still resolve.
- One-time copy of existing S3 objects → GCS bucket (`gsutil rsync` / Storage Transfer).
- Cut over, then decommission the S3 bucket + AWS keys after a verification window.
**Done when**: upload, view, replace, delete, and zip-download all work off GCS; no S3 refs
remain. **Risk**: medium (data copy + key-scheme parity). **Rollback**: flip the storage
client back; objects still in S3 during the window.

## Implementation status (branch `main-firebase`)
- **Phase 1 code: done.** `app.ts` (listen-free app), `db.ts` (cached lazy Mongo), thin
  `index.ts`, `functions.ts` (`api` gen2 function), `services/s3.ts` (explicit-key S3, IMDS
  removed), `firebase.json`/`.firebaserc`. Local `node dist/index.js` still boots unchanged.
- **Phase 3 code: done.** `scheduled.ts` exports a `roasRecompute` `onSchedule` function
  (every 15 min, `maxInstances: 1`, MONGO_URI only). `scheduleRoasRecompute` now no-ops when
  `K_SERVICE` is set (Cloud Functions), deferring freshness to the scheduled function; on
  Render/local the in-process fast path is unchanged. Requires `firebase-admin` (peer of
  `firebase-functions`) — installed.
- **Deployed & verified (2026-09-11).** Both functions are live in `photobookx-management`
  (asia-south1, nodejs22): `api` (HTTPS) and `roasRecompute` (scheduled, every 15 min). All
  19 secrets are in Secret Manager. `GET /api/api/health` → 200; `POST /api/api/admin/auth/login`
  with bogus creds → 401 in ~0.24s, proving Mongo connectivity from the function. api base URL:
  `https://asia-south1-photobookx-management.cloudfunctions.net/api` (the app mounts under
  `/api`, so paths read `…/api/api/...`).
- **Remaining to retire Render:** set the frontend `VITE_API_URL` to the api base URL and
  redeploy the frontend; confirm CORS `FRONTEND_URL` matches the real frontend origin; verify
  the app in-browser; then decommission Render. Also rotate the Atlas password exposed during
  setup and update the `MONGO_URI` secret + `.env.local`.

## Phase 3 — Background & scheduled work
**Scope**: make ROAS recompute (and any future jobs) durable on Functions.
- Replace in-process `scheduleRoasRecompute` with a real trigger: enqueue to **Cloud Tasks**
  (or publish to **Pub/Sub**) from the write path; a separate function does the recompute.
  Keep the existing coalescing semantics. Alternatively a **Cloud Scheduler** every-N-min
  recompute if near-real-time isn't required.
- Audit for any other "after response" work assumed to run in-process.
**Done when**: ROAS stays fresh after order-cache updates with no reliance on post-response
execution. **Risk**: low–medium.

## Phase 4 — Auth (optional)
**Scope**: decide custom JWT vs Firebase Auth for **admin** users only.
- Cheapest: keep custom JWT verified inside the function (no user-facing change).
- If moving to Firebase Auth: migrate `SuperUser` accounts, swap `requireAdmin` for
  Firebase ID-token verification, update the frontend login to the Firebase SDK.
- **Magic-link upload tokens stay as-is regardless** — they are not user auth.
**Done when**: admin login + `requireAdmin` work via the chosen mechanism.
**Risk**: low if keeping JWT; medium if switching.

## Phase 5 — Data layer → Firestore (optional, largest)
**Scope**: migrate MongoDB collections to Firestore, collection-by-collection.
- Start with simple collections (settings/prefixes, `UploadedImage`, `MagicLink`,
  employees/attendance) using dual-write + backfill, then read cutover, then stop dual-write.
- Hard cases, do last or leave on Atlas: everything analytics (`DailyROAS`, `DailyPnl`,
  `DailyOrderStats`, `DailyShipping`, `MetaAdPerformance`, agency/breakeven) and
  **`ShopifyOrderCache`** (1 MiB Firestore doc cap breaks the big-array pattern — re-shape to
  one doc per order, or keep on Atlas / move to GCS JSON).
- Rewrite aggregations as precomputed documents or app-side reduction.
**Done when**: chosen collections read/write from Firestore and Atlas is removed (or
intentionally retained for the analytics subset). **Risk**: high. **Rollback**: per-collection
dual-write windows.

## Phase 6 — Decompose & harden (optional)
- Split long/heavy endpoints into their own functions with tuned memory/timeout/concurrency:
  the **AI ads analysis** (long, bursty, expensive) and the **zip download** (memory-heavy).
- Right-size min instances (cold starts) vs cost; set per-function concurrency.
- Decommission Vercel and Render; move DNS fully to Firebase Hosting.
- Observability: Cloud Logging/Error Reporting dashboards; budget alerts (the AI path already
  bit us once on quota).

---

## Cross-cutting gotchas (carry through every phase)
- **No `process.exit`, no `app.listen`** inside Functions; reuse Mongo connection per instance.
- **Cloud Functions v2 only** (long timeouts, memory, 32 MB HTTP body — 20 MB uploads fit).
- **Streaming**: `stream.pipe(res)` and `archive.pipe(res)` work on Cloud Run but watch
  memory and the response deadline; very large zips may be better as signed-URL downloads.
- **Frontend cutover is one env var** (`VITE_API_URL`), plus the single hardcoded fallback in
  `GSTMonthlyReports.tsx`.
- **Secrets** live in Secret Manager, injected per-function; never commit them.
- **Keep Render + Vercel as rollback** until each phase is verified in production.
