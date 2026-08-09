# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-tenant business command center for "Ms. Financial Solutions" (a credit-repair
business), pulling together **GoHighLevel** (clients/pipeline/SMS), **Fanbasis/Commas**
(payments), **DisputeFox** (dispute rounds), **MyFreeScoreNow** (affiliate gap), and
**Meta** (IG/FB follower growth) into one dashboard. One Node process, two runtime
dependencies (Express, and `pg` for the optional Postgres mirror described below).
Vanilla-JS frontend, JSON-file persistence (source of truth), optionally mirrored to
Postgres. Deployed on Render free tier, auto-deploys on push to `main`.

It boots in **demo mode** with realistic sample data (`lib/demo.js`) and flips to
**live mode** the moment GHL keys are saved in ⚙ Settings.

## Commands

```
npm install
npm start                        # http://localhost:3000 (demo data until GHL keys are set)
npm test                         # node --test tests/*.test.js (all tests)
node --test tests/auth.test.js   # single test file
READ_ONLY=1 npm start            # run against real GHL creds without allowing live writes
```

No build step, no bundler, no linter — plain `require()`/`<script>` files served as-is.
There is no `render.yaml`/`Dockerfile`; Render is configured directly in its dashboard
(Runtime Node, Build `npm install`, Start `npm start`).

## Architecture

- **`server.js`** (~2000 lines) — every route, the auth/permission gate, dashboard
  aggregation logic, and webhook handlers. This is the entry point and the place most
  backend changes touch first.
- **`lib/`** — one module per concern, required from `server.js`:
  - `auth.js` — accounts, sessions (scrypt + opaque random tokens, role never in the
    cookie), and the **deny-by-default** permission tables (`EMPLOYEE_API`,
    `EMPLOYEE_ASSETS`) that gate both `/api/*` routes and static assets.
  - `store.js` — JSON-file persistence (no DB). Reads/writes everything under `DATA_DIR`.
  - `ghl.js` — GoHighLevel v2 API client (retries 429/5xx with backoff, 20s timeout).
  - `ghlcreds.js` — validates/normalizes pasted GHL credentials so Settings can name the
    real problem (v1 JWT vs v2 token, token pasted into Location field, etc).
  - `affiliate.js` — MyFreeScoreNow "gap" engine (which clients aren't enrolled).
  - `sheet.js` — one-time/manual reconciliation of a pasted Google Sheet CSV into Deal
    Production (sheet is source of truth for package/round status where they disagree).
  - `demo.js` — deterministic seeded demo dataset (mulberry32 PRNG) matching the real
    business's shape.
  - `meta.js` — Meta Graph API follower counts (needs Page token + IG business ID).
  - `social.js` — public-profile follower-count fallback when no Meta token is set.
  - `db.js` — optional Postgres (Supabase) connection pool. A no-op (`isEnabled()`
    false) when `DATABASE_URL` is unset; every caller in `store.js` already treats a
    failed/absent connection as non-fatal.
  - `crypto.js` — AES-256-GCM encrypt/decrypt for anything mirrored into a Postgres
    `*_encrypted` column (GHL/Meta tokens, webhook secret). No-op without
    `APP_ENCRYPTION_KEY`; secrets are simply not mirrored until it's set, never
    written to Postgres in the clear.
- **`public/`** — vanilla JS/HTML frontend, no framework, no build step.
  - `index.html` (~200KB) is the main shell: markup + inline JS for most views. Edit
    carefully and syntax-check inline `<script>` blocks before trusting changes.
  - `production.js`, `messages.js`, `team.js`, `mfsn.js`, `revenue.js`,
    `personal-finances.js` — self-injecting modules (IIFEs) that each add their own
    `<section>` + nav button and wrap `window.showView`, rather than being edited into
    `index.html` directly. Follow this pattern for new full-page views.
  - `role.js` — applies the signed-in role to the UI (presentation only — the real
    boundary is server-side in `lib/auth.js`).
  - `login.html`, `set-password.html` — public, unauthenticated pages.
  - `admina-assets/`, `admina-dashboard.html` — a separate Bootstrap-based dashboard
    template/theme, linked from `index.html`.
- **`seed/production-seed.json`** — ~3,578 real client records; seeds `production.json`
  on first run. Deliberately kept out of anything served publicly.
- **`tests/`** — `node:test`, no framework. One file per concern, mirroring `lib/`.
- **`docs/HANDOFF.md`** — running session notes: what was built, open blockers, and
  roadmap. Check it for current status before starting new work.

### Auth model

Two roles: **admin** (everything) and **employee** (Deal Production tracker only,
nothing else). The permission gate in `server.js` (the `app.use` middleware right after
`/api/sso`) resolves the session, computes `req.effectiveRole` (accounts for the
admin-only "View as Employee" preview), and checks it against `auth.canAccess` /
`auth.canAccessAsset`. **Everything is 403 by default** — a new route or asset must be
explicitly added to `EMPLOYEE_API`/`EMPLOYEE_ASSETS` in `lib/auth.js` to be reachable by
an employee. Hiding UI elements is cosmetic only; the server is the real boundary.

`READ_ONLY=1` disarms the two routes that can mutate live GHL data (status tag
write-back, sending SMS) so real credentials can be used locally without side effects.

## How frontend and backend connect

Express (`server.js`) serves `public/` as static files and exposes a JSON API under
`/api/*`, plus public webhook receivers under `/webhooks/*`. The frontend is entirely
same-origin `fetch()` calls from inline/module `<script>`s — no separate frontend build,
no proxy, no CORS. Session auth is a single `msfs` cookie (`HttpOnly`, `SameSite=Lax`)
holding an opaque token that `lib/auth.js` resolves server-side to a user/role.

## External services and APIs

| Service | Direction | Notes |
|---|---|---|
| **GoHighLevel** (v2, `services.leadconnectorhq.com`) | pulled + written | Hub for clients, pipeline, tags, SMS. Requires a `pit-` Private Integration token, not a v1 JWT. |
| **Fanbasis / Commas** | pushed in via webhook | No public API; Zapier or n8n POSTs to `/webhooks/fanbasis` or `/webhooks/commas` on each sale. Also creates/updates the GHL contact in live mode. |
| **DisputeFox** | pushed in via webhook | Zapier-only; POSTs to `/webhooks/disputefox` on round events. |
| **MyFreeScoreNow** | pushed in via webhook | POSTs to `/webhooks/mfsn` (scheduled Zap fetching the active-members list). |
| **Meta Graph API** (`graph.facebook.com`) | pulled | IG/FB follower counts via `lib/meta.js`; falls back to public-profile scraping (`lib/social.js`) if no token configured. Snapshotted every 6h. |
| **Proven Agency dashboard** | both directions | SSO link-out (`GET /api/sso`, signed token) lets Proven auto-login an admin; support tickets (`POST /api/support-tickets`) forward there via shared secret. |
| **Google Sheets** | manual paste only | No live API integration yet (roadmap item); `lib/sheet.js` reconciles a manually pasted CSV export. |
| **Lunch Money** | not connected | `public/personal-finances.js` is sample data only; a real integration would be server-proxied to keep the API key off the browser. |

All webhooks require a `?secret=` query param checked against a configured secret
(`checkSecret` in `server.js`) once one is set in Settings.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (defaults otherwise). |
| `DATA_DIR` | Where JSON state (config, sessions, production data) is persisted. Set to `/data` (a persistent disk) on Render; falls back to the repo root locally. |
| `APP_PASSWORD` | Legacy/initial login password, migrated into the first `admin` account on boot. |
| `READ_ONLY` | When `1`, disables the two live-GHL write routes (status write-back, SMS send). |
| `SSO_SHARED_SECRET` | Signs/verifies the Proven Agency SSO link-out token. |
| `PROVEN_DASHBOARD_URL` | Base URL support tickets are forwarded to (defaults to the production Proven Agency dashboard). |
| `TICKETS_SHARED_SECRET` | Auth secret for the support-ticket forward/sync with Proven Agency's dashboard. |
| `CRON_SECRET` | Auth secret for `POST /internal/cron/sync-ghl` (checked via `x-cron-secret` header, timing-safe compare) -- the automatic 12h GHL-to-Deal-Production sync, triggered by `.github/workflows/sync-ghl.yml` since Render's free tier has no always-on process to run an in-process timer reliably. Separate from `webhookSecret` (Settings-configured) so a leak of one doesn't grant the other. Must match the `CRON_SECRET` GitHub Actions repo secret. |
| `BIZ_TZ` | Business timezone used for date-range grouping/filtering. |

GHL, Meta, and webhook secrets are **not** environment variables — they're entered in
⚙ Settings and stored server-side via `lib/store.js`, masked from the UI, never sent to
the browser.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | A Postgres/Supabase connection string — use the **Transaction pooler** URI (port 6543), not the direct-connection host (port 5432); the direct host is IPv6-only on most Supabase projects and unreachable from IPv4-only networks. Optional — the app runs fully on JSON alone if unset. |
| `APP_ENCRYPTION_KEY` | Only relevant with `DATABASE_URL` set. A 64-char hex string (32 bytes) used by `lib/crypto.js` (AES-256-GCM) to encrypt GHL/Meta tokens, the webhook secret, and CFPB portal passwords before they reach Postgres. Without it, those fields are simply never mirrored/migrated (never stored in Postgres in the clear). Generate with `openssl rand -hex 32`. **The key currently in use is not in this repo or anywhere in git — it exists only as a value the human operator holds. Losing it makes the encrypted CFPB passwords permanently unrecoverable.** |

### Postgres: two different priority patterns, by design, for two different reasons

This app now has TWO distinct Postgres integration patterns, not one — know which one
a given piece of data uses before changing it:

**1. Postgres-PRIMARY, JSON-backup** — `lib/production.js` (Deal Production: clients,
production_records, and children) and the Fanbasis/Commas payment webhook's
auto-onboarding write (`ensureClientFromPayment` in `server.js`, via
`dealProd.appendProdRecords`). Every read/write here awaits Postgres FIRST; the local
JSON file (`production.json`) is refreshed as a live backup after every successful
Postgres operation, and is used as a fallback ONLY when Postgres is unreachable. This is
the pattern for "the data must actually be durable, not just locally convenient" —
Deal Production sheet-sync additions and PATCH edits land in Supabase directly, verified
live end-to-end. The full real CSV (3,641 rows: `clients`, `production_records`,
`production_bureau_status`, `production_documents`, `production_notes`, and
`production_cfpb_logins` with AES-256-GCM–encrypted passwords) has already been migrated
into the connected Supabase project — see `scripts/build-migration-sql.js` and
`scripts/run-migration.js`, run once, transactionally, not part of the running app.
`GET /api/production/:id` (the 4s drawer poller) uses a targeted single-record query,
never the full-roster read; `GET /api/production`'s full-roster read is cached 30s
(`store.cached('deal-production-full', ...)`) since reconstructing it from 5 joined
queries is measurably expensive at ~3,600 records — a PATCH/append clears just that one
cache key (`store.clearCacheKey`), not the whole cache (that would also force-expire the
unrelated 10-minute GHL client cache).

**2. JSON-PRIMARY, Postgres-mirror** — everything still routed through `lib/store.js`
(notes, tasks, notifications, tickets, dashboard layouts, affiliate overrides, MFSN
members, follower snapshots). Write functions fire an un-awaited,
best-effort mirror into Postgres after every JSON write (see the long comment at the top
of `lib/store.js`) — JSON stays authoritative for reads and return values; nothing in
`server.js` needed to change for this tier. Two real, documented limitations here:

**Exception — app config/secrets (GHL/Meta tokens, webhook secret, Location ID) are
Postgres-PRIMARY**, via `store.setConfigPrimary()`, used only by `POST /api/config` (the
Settings save route): the `app_settings` write is `await`ed *before* `config.json` is
written as the backup — same ordering as tier 1. `getConfig()` itself still reads
synchronously from JSON only (it's called un-awaited throughout `server.js`; making it
async would require touching every call site) — `store.hydrateConfigFromPostgres()`
closes that gap by restoring any missing fields from `app_settings` once at boot, before
the server starts accepting requests, which matters specifically on a host with no
persistent disk (e.g. Render's free tier): `config.json` is wiped on every
restart/spin-down, so without this a saved GHL token would silently revert to empty on
the next cold start even though it's safely sitting in Postgres. Every *other*
`setConfig()` call site (user management, SSO, invite secret) is unaffected — none of
that data is mirrored to `app_settings` in the first place, so there's no durability
gain from awaiting a Postgres round-trip on those flows.

- **JSON ids and Postgres ids don't match** (JS `Date.now()+random` strings vs. Postgres
  `bigint identity`). A successful mirror insert patches the resulting Postgres id back
  onto the JSON record as `.pgId`; later updates/deletes look for `.pgId` to mirror the
  same mutation, and skip Postgres cleanly if it's missing.
- **No `users` migration has run** — `notifications`, `ticket_views`, and per-user
  `dashboard_layouts` all need a real `users.id` foreign key with no lookup path
  available, so these three stay JSON-only for now (skip Postgres entirely, not even a
  best-effort attempt). `clients` IS populated (see tier 1 above), so anything in this
  tier that resolves a client by `ghl_contact_id` (`client_notes`, `worked_status`,
  `affiliate_overrides`) now has a real chance of succeeding once a client is linked.

Both tiers connect through `lib/db.js` (`isEnabled()`/`query()`/`withTransaction()`) —
note its `types.setTypeParser(1082, ...)` line, which exists because `pg`'s default
`DATE` parser silently shifts the calendar day on any host whose local timezone isn't
UTC (reproduced and fixed this session; don't remove it without understanding why it's
there).

## Data flow summary

1. **Clients/pipeline/SMS**: GHL is the hub. `lib/ghl.js` pulls contacts (cached 10 min);
   status/round changes and SMS sends write back to GHL live (blocked by `READ_ONLY`).
2. **Payments**: Fanbasis/Commas Zap → `/webhooks/fanbasis`(`/commas`) → recorded as a
   payment event; in live mode also upserts a GHL contact and a Deal Production row
   (idempotent — matched by GHL dedup + a Deal Production roster check). That Deal
   Production row is written Postgres-first via `dealProd.appendProdRecords` (see above).
3. **Dispute rounds**: DisputeFox Zap → `/webhooks/disputefox` for activity events; round
   *distribution* itself is read live from GHL `round:` tags, not the webhook.
4. **Affiliate gap**: MFSN Zap → `/webhooks/mfsn` → `lib/affiliate.js` diffs the member
   list against the client roster (email match, name fallback).
5. **Social growth**: `lib/meta.js`/`lib/social.js` snapshot follower counts every 6h for
   the growth chart.
6. **Deal Production** (the Employee-facing work tracker): **Postgres-primary** via
   `lib/production.js` (see above), `production.json` kept as a live backup, edited
   per-lead via `PATCH /api/production/:id` with a targeted per-row Postgres UPDATE
   (server-side deep-merge on the JSON-backup side) so concurrent edits by different
   employees don't clobber each other; an open drawer polls every 4s (targeted
   single-record query, not the full roster) to pick up a colleague's changes.
7. Everything else is persisted as flat JSON files under `DATA_DIR` via `lib/store.js` —
   JSON remains the source of truth for every read there. Optionally, when
   `DATABASE_URL` is set, every write is also best-effort mirrored into Postgres (see
   `docs/postgres-schema-design.sql` and the two-tier note above) as a live backup; the
   app is unaffected if that mirror is unreachable or unconfigured. `sessions.json` is
   gitignored (live session tokens); `production.json` is gitignored (real client PII —
   now a backup copy of Supabase, not the primary copy).

## Deployment

Render (free tier), auto-deploy on push to `main`. No `render.yaml`/Dockerfile in the
repo — build/start commands and env vars are configured in the Render dashboard:
Runtime **Node**, Build `npm install`, Start `npm start`. **No persistent disk is
attached** (confirmed 2026-08) — `DATA_DIR` is unset, so JSON files live on the
container's ephemeral filesystem and are wiped on every restart/spin-down (free tier
sleeps after ~15 min idle). This is exactly why Deal Production (`lib/production.js`)
and app config/secrets (`store.setConfigPrimary`, restored via
`store.hydrateConfigFromPostgres` on boot) are Postgres-primary — anything still
JSON-primary-only in `lib/store.js` (notes, tasks, tickets, dashboard layouts, etc.)
does NOT currently survive a restart on this host. Railway/Fly.io work the same way
(unverified — README only documents Render). Live URL (confirmed from real deploy
logs): https://tiffany-app-new.onrender.com.

## Conventions (from docs/HANDOFF.md)

- TDD: write a failing test first (`node:test`), watch it fail, then implement.
- Every webhook must call `checkSecret`.
- Every new employee-reachable route or static asset must be added explicitly to the
  allowlists in `lib/auth.js` — the default is 403.
- After changing inline JS in `index.html`, syntax-check it before trusting it (it's not
  covered by any bundler/linter that would otherwise catch a typo).
- Never commit `sessions.json`, `production.json`, or `data/` (secrets & PII) — already
  gitignored.
