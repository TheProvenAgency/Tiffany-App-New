# HANDOFF.md — MSFS Dashboard → UI-Refactored Clone

Reference doc for a fresh Claude Code session working in a UI-refactored clone of
this repo. Functionally identical target, different UI. Written for an
engineer-AI, not a human — terse, exhaustive, file-path-specific. Verified
against actual code as of this writing (not from memory/notes).

---

## 1. PROJECT OVERVIEW

**What it is:** Single-tenant business command center for "Ms. Financial
Solutions" (a credit-repair business, owner "Tiffany"). Aggregates
**GoHighLevel** (clients/pipeline/SMS/conversations), **Fanbasis/Commas**
(payments), **DisputeFox** (dispute-round activity), **MyFreeScoreNow**
(affiliate-enrollment gap), and **Meta** (IG/FB follower growth) into one
dashboard, plus a separate **Deal Production** work tracker for employees.

**Tech stack:**
- Runtime: Node.js (`engines.node >= 18`), single process, `server.js` as entry.
- Framework: **Express 4.19.2 — the only runtime dependency** (`package.json`).
  Zero build step, zero bundler, zero linter, zero frontend framework.
- Frontend: vanilla JS/HTML/CSS. `public/index.html` (202KB, ~200KB of markup +
  inline `<script>`) is the shell; several `public/*.js` files self-inject as
  IIFEs (see §2).
- Persistence: **flat JSON files on disk**, no database, via `lib/store.js`.
  No ORM, no SQL anywhere in the current codebase.
- Testing: `node:test` (built-in, no framework/dep). `npm test` runs
  `node --test tests/*.test.js`. Currently **212 passing / 3 failing** (see §4).
- Deployment: Render free tier, auto-deploy on push to `main`. No
  `render.yaml`/Dockerfile — build/start/env configured directly in Render's
  dashboard. Live URL (confirmed from real deploy logs, 2026-08):
  `https://tiffany-app-new.onrender.com`. **No persistent disk is attached** —
  `DATA_DIR` is unset, so JSON files live on the container's ephemeral
  filesystem and are wiped on every restart/spin-down (free tier sleeps
  after ~15 min idle). This is why Postgres is primary for Deal Production
  (`lib/production.js`) and app config/secrets (`store.setConfigPrimary`,
  restored on boot via `store.hydrateConfigFromPostgres`) — anything still
  JSON-primary-only (notes, tasks, tickets, etc., see `lib/store.js`) does
  NOT currently survive a restart on this host.
- Git remote: `https://github.com/TheProvenAgency/Tiffany-App-New.git`.

**How pieces connect:** Express serves `public/` as static files and exposes
`/api/*` (session-authed JSON API) plus `/webhooks/*` (secret-authed public
receivers, no session). Frontend is 100% same-origin `fetch()` — no CORS, no
proxy, no separate frontend build/deploy. Session auth is one `msfs` cookie
(`HttpOnly`, `SameSite=Lax`, opaque random token) resolved server-side to a
user/role via `lib/auth.js`. GHL is the "hub" for live client data — pulled
live via `lib/ghl.js`, cached in-memory only (never written to disk). Boots in
**demo mode** with deterministic synthetic data (`lib/demo.js`) until an admin
pastes real GHL credentials into Settings, which flips `liveMode()` true.

---

## 2. FUNCTIONALITY MAP

### Auth / accounts / sessions
- `lib/auth.js` — scrypt password hashing (per-user salt), opaque random
  session tokens (role resolved server-side, **never** in the cookie), 30-day
  server-side session expiry, login throttle (10 tries → 15-min lockout, keyed
  by account + address, needs `app.set('trust proxy', ...)` for Render).
- Two roles: `admin` (everything) and `employee` (allowlisted subset, see
  `EMPLOYEE_API`/`EMPLOYEE_ASSETS`/`EMPLOYEE_FIELDS` in `lib/auth.js`).
- Routes: `POST /api/login`, `POST /api/logout`, `GET /api/me`,
  `POST /api/set-password`, `POST /api/me/password` (self-service, both
  roles), `POST /api/users/:id/invite` (signed setup link, no email sending —
  admin copies/sends the link manually).
- User management (admin-only): `GET/POST/PATCH/DELETE /api/users`. Last admin
  can't be disabled/demoted/deleted.
- **Admin "View as Employee" preview**: `POST /api/preview/start|stop` flips
  `req.effectiveRole` for that session without changing the real role — lets
  an admin QA the employee view live. `public/role.js` reads `me.previewing`/
  `me.realRole` to show/hide the toggle + a "Viewing as Employee" banner.
- **Proven Agency SSO link-out**: `GET /api/sso` — verifies an HMAC-signed,
  short-lived token minted by a separate "Proven Agency" dashboard
  (`verifySsoToken` in `lib/auth.js`), auto-provisions/reuses an admin account
  matched by email (`findOrCreateSsoUser`), starts a session. `ssoOnly`
  accounts can never log in via the password form (`authenticate()` in
  `lib/auth.js` checks `u.ssoOnly`).

### Deny-by-default permission gate
- `server.js` — the `app.use` middleware right after the `/api/sso` route
  resolves the session, computes `req.effectiveRole`, checks
  `auth.canAccess(role, method, path)` for `/api/*` and
  `auth.canAccessAsset(role, path)` for static files. **Everything is 403
  unless explicitly allowlisted** in `lib/auth.js`'s `EMPLOYEE_API` array /
  `EMPLOYEE_ASSETS` Set. Field-level: `EMPLOYEE_FIELDS` gates which keys of a
  Deal Production PATCH an employee may write (`filterEditable()`);
  `EMPLOYEE_HIDDEN_CLIENT_FIELDS` (currently just `mfsnCommission`) is
  stripped server-side from client records regardless of role checks
  (`redactClient()`).
- **This boundary is server-side and authoritative.** `public/role.js` only
  hides UI chrome (buttons/nav) cosmetically for employees — never trust or
  reimplement permissions client-side.

### Dashboard (main aggregation view)
- `GET /api/dashboard` (`server.js:696`) — the big aggregation endpoint: KPIs
  (revenue in range, avg payment, lifetime collected, active/inactive/new
  clients, SMS in/out, IG/FB followers + growth, disputes sent), and chart
  series (revenue over time, payments & new clients, SMS in/out, follower
  growth, lifetime revenue by package, active clients by round, churn
  recency, active-vs-inactive donut). Supports named ranges (Today/Yesterday/
  7 Days/This Week/30 Days/This Month/90 Days/YTD/This Year/Last Year/All
  Time) and custom ranges, grouped by day/week/month/year. Auto-refreshes
  client-side every 5 min; GHL pulls cached 10 min server-side
  (`store.cached('clients', 10*60*1000, ...)`).
- Per-user customizable layout: `GET/POST/DELETE /api/dashboard-layout`
  (both roles, own layout only), `POST/DELETE /api/dashboard-layout/default`
  (admin-only — sets/clears the site-wide default everyone-without-an-
  override sees). Backed by `store.js`'s `dashboardLayouts.json`
  (`{ userId: {order, sizes} }`, reserved key `__default__`). Cards use a
  gridstack-style layout (`gs-w`/`gs-h`/`gs-x`/`gs-y` attributes in
  `index.html` are the shipped fallback when no default/personal layout
  exists).

### Clients (GHL-backed)
- `GET /api/clients`, `GET /api/clients/:id` — live-pulled + decorated GHL
  contacts (`getClients()`/`decorateClients()` in `server.js`), cached 10 min.
  `redactClient()` strips `mfsnCommission` for employees.
- `POST /api/clients` — creates a client (admin-only; also creates a real GHL
  contact, blocked from employees since it'd only fail otherwise).
- `POST /api/clients/:id/notes`, `DELETE /api/notes/:id` — per-client notes
  (`store.js` `notes.json`), support `@mention` → notification.
- `POST /api/clients/:id/status` — active/inactive, writes `status:` tag back
  to GHL live (**blocked by `READ_ONLY=1`**).
- `POST /api/clients/:id/affiliate` — manual MFSN affiliate-status override
  (`affiliate_overrides.json`), both roles.
- `POST /api/clients/:id/contact`, `POST /api/clients/:id/tags` — admin-only
  (contact-field edits, generic tag mutation).
- `POST /api/clients/:id/round` — moves a client between dispute rounds
  (narrow tag swap, distinct from the generic `/tags` route), both roles as
  of 2026-08-05.
- `POST /api/clients/:id/sms` — sends a real SMS via GHL (**blocked by
  `READ_ONLY=1`**), both roles.

### Pipeline
- `GET /api/pipeline` (`server.js:1415`) — revenue-by-round board (mirrors
  GHL's "Credit Repair Delivery" pipeline), per-client lifetime spend,
  Onboarding + Completed merged into the board. Read-only, both roles
  identical/unredacted (explicit 2026-08-05 decision).
- Frontend: chevron-style stage nav (click to jump/highlight), persistent
  contact panel showing real Deal Production process status, custom-built
  horizontal scrollbar pinned to viewport bottom (native scrollbar styling
  replaced — see commit history, this was iterated on heavily and is
  UI-specific, see §8).

### Reactivation queue
- `GET /api/reactivation` — lapsed clients sorted hottest-first (fewest days
  lapsed). `POST /api/reactivation/:id/worked` — marks worked
  (`worked.json`, `{clientId: {workedAt, by, outcome}}`).

### Follow-Ups (tasks)
- `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id` — shared team to-do
  list (not per-user scoped), both roles. `assignedTo`/`createdBy`/
  `mentions` drive notifications.
- `GET/POST /api/tasks/:id/notes`, `DELETE /api/task-notes/:id` — a thread on
  a task, separate from the task's own `notes` description field, both roles.

### Notifications (in-app bell)
- `GET /api/notifications`, `POST /api/notifications/:id/read`,
  `POST /api/notifications/read-all` — both roles, own userId only. Created on
  task assignment or `@mention` in a note/task (`notifications.json`).

### Support tickets
- `POST /api/support-tickets` — both roles; forwards to an **external**
  "Proven Agency" dashboard (`PROVEN_DASHBOARD_URL` + `TICKETS_SHARED_SECRET`)
  and also keeps a local audit copy (`tickets.json`) in case the forward
  fails.
- `GET /api/support-tickets` — both roles; syncs **live** from Proven's
  dashboard (not the local audit copy) — the shared team queue.
- `POST /api/support-tickets/:id/view` — marks read (`ticket_views.json`,
  keyed by our own userId + Proven's ticket uuid — unread badge logic).
- `POST /api/support-tickets/:id/notes` — reply inside a ticket thread.

### Messages (unified inbox)
- `GET /api/messages`, `GET /api/messages/:id`, `POST /api/messages/:id/reply`
  — SMS/Email/FB/IG via GHL Conversations API (`lib/ghl.js`
  `fetchAllConversations`/`fetchMessages`/`sendMessage`). Both roles, read
  and reply. Implemented in `server.js:1835-1925` + `public/messages.js`
  (self-injecting module, own nav button + view).
- **Known-broken**: 3 of `tests/messages-reply.test.js`'s assertions
  currently fail — see §4.

### Deal Production (employee work tracker)
- Its own JSON store, `production.json`, seeded once from
  `seed/production-seed.json` (3,578 real client records) on first read if the
  file doesn't exist (`readProd()` in `server.js:1705-1724`).
- `GET /api/production` (all), `GET /api/production/:id` (one, polled every
  4s by an open drawer to pick up a colleague's edit without reload — skips
  while the current user is mid-edit or just wrote it themselves).
- `PATCH /api/production/:id` (`server.js:2001+`) — **the current pattern**:
  saves one lead at a time, server-side deep-merges sub-objects (`tu`, `eq`,
  `ex`, `docs`, etc.) so concurrent edits by different employees on different
  fields of the same lead don't clobber each other. Notes are append-only via
  a `note` field (not a rewritable `notes` array — an employee must not be
  able to delete/forge a colleague's note; attribution is stamped
  server-side from the session).
- `POST /api/production` still exists (legacy: replaces the whole
  3,578-record array) — **do not use for per-lead edits**, it silently
  clobbers concurrent writes; this is exactly the bug `PATCH` was built to fix.
- Implemented in `public/production.js` (587 lines, self-injecting IIFE, own
  nav + view — follow this pattern for new full-page views, don't edit
  `index.html` directly for this class of feature).
- `EMPLOYEE_FIELDS` (writable by employees): `tu, eq, ex, docs, note, cfpb,
  stage`. `va` (ownership reassignment) stays admin-only.

### Google Sheet reconciliation (one-time/manual, not a live integration)
- `lib/sheet.js` — hand-rolled CSV parser (no npm dep), handles quoted
  fields/embedded commas/newlines. `POST /api/production/sheet-sync` (paste a
  CSV export, dry-run returns `{updates, toCreate, unmatched, duplicateNames}`,
  `apply:true` applies them). `POST /api/production/reconcile` — adds GHL
  clients missing from Deal Production.
- **Identity is name-only** — neither the CSV nor `production.json` carries an
  email field. `bestGhlMatch()` refuses to guess when multiple real GHL
  contacts share a normalized name (returns `null` rather than picking
  wrong). Sheet wins on conflict with the JSON store.
- The CSV also carries **plaintext CFPB portal passwords** per dispute round
  (`CFPB_ROUND_COLS` in `lib/sheet.js`) — sensitive, currently unencrypted at
  rest if ingested. Flag this in any future schema/storage work.

### Webhooks (public, secret-gated)
- `checkSecret()` (`server.js:1539-1545`) — **open/unauthenticated by
  default** until an admin sets `webhookSecret` in Settings (`if
  (!cfg.webhookSecret) return true`). Every webhook route calls it.
- `POST /webhooks/fanbasis`, `POST /webhooks/commas` — same handler
  (`handlePaymentWebhook`), payment events. In live mode, also
  upserts a GHL contact + creates a Deal Production "Onboarding" row,
  idempotent (GHL dedup + Deal Production roster check).
- `POST /webhooks/disputefox` — dispute-round activity events.
- `POST /webhooks/sms` — inbound/outbound SMS events.
- `POST /webhooks/mfsn` — MyFreeScoreNow enrolled-member list
  (snapshot-replace or single upsert) → `mfsn_members.json`.
- `POST /api/events/cleanup` — prunes `events.json` (capped at 100,000
  entries anyway, `addEvent()` in `lib/store.js`).

### Affiliate gap (MyFreeScoreNow)
- `lib/affiliate.js` — `affiliateGap()` computes clients not enrolled in
  MFSN (email match, name fallback via `normFirstLastInitial`). Also
  `commissionForMember()`/`PLAN_AMOUNT_COMMISSION` for per-member commission
  math ($12.80–$13.80 on the $29.90 tier, real figures from a manual audit).
- `GET /api/affiliate-gap` (admin-only) + dashboard card.
- `GET /api/mfsn-gap`, `POST /api/mfsn-old-status` — a **manually-audited**
  snapshot (MFSN's own feed doesn't expose "Old vs New member" type at all;
  someone has to re-check the myfreescorenow.com UI by hand and POST updated
  counts). Seeded with real counts from 2026-07-31 in `lib/store.js`
  `getMfsnOldStatus()` — this will silently go stale if nobody re-audits.
- `public/mfsn.js` (319 lines, self-injecting module).

### Social / follower growth
- `lib/meta.js` (`getFollowers`) — Meta Graph API, needs Page token + IG
  business ID.
- `lib/social.js` (`publicCounts`) — **fallback**, scrapes public profile
  pages when no Meta token is configured. No credentials required.
- `takeSnapshot()` (`server.js:1677-1702`) runs automatically ~15s after boot
  and every 6h thereafter (`setInterval(..., 6*60*60*1000).unref()`),
  regardless of whether GHL/Meta are configured — writes to
  `snapshots.json` via `store.upsertSnapshot()`.
- `GET /api/social`, `POST /api/social/refresh`, `POST /api/social/seed`.

### Revenue / historical data
- `HISTORICAL_PRODUCT_SALES` and `HISTORICAL_MENTORSHIP_BUYERS`
  (`server.js:~1-80`) — **hardcoded real dollar figures and real names**,
  explicitly commented "pulled ... on 2026-07-30". `getProductBreakdownAllTime()`
  merges this static snapshot with live Fanbasis webhook events. This is a
  point-in-time backfill, not a live pull — will not include anything sold
  before the webhook was wired up unless someone manually updates the
  constant.
- `public/revenue.js` (710 lines, self-injecting module).

### Personal finances
- `public/personal-finances.js` (404 lines) — **sample/demo data only**
  (Lunch Money placeholder), EXCEPT one real hardcoded figure noted in prior
  session docs (`income:47900`-style value) that should move server-side
  behind an admin endpoint rather than living in client-servable JS source.
  Gated from employees both by `EMPLOYEE_ASSETS` (not in the allowlist) and
  by `public/role.js` only injecting the `<script>` tag for `me.role ===
  'admin'`.

### Team management
- `public/team.js` (157 lines, self-injecting) — Settings → Team panel
  (add/enable/disable users, invite links), injects `teamNavBtn` which
  `role.js`'s `gateNav()` polls for (`retry()`, up to ~3s) before it can
  finish gating the Employee nav — a real ordering dependency, see §6.

### GHL client + credential diagnostics
- `lib/ghl.js` — v2 API client (`services.leadconnectorhq.com`), retries
  429/5xx with backoff (honors `Retry-After`), 20s timeout. Exports:
  `fetchAllContacts, smsByDay, testConnection, addTags, removeTags,
  setStatus, sendSMS, sendMessage, createContact, updateContact,
  fetchConversations, fetchMessages, fetchAllConversations,
  normalizeConversation, normalizeMessage, ghlFetch, _setRetry`.
- `lib/ghlcreds.js` — `extractLocationId, classifyToken, classifyLocationId`
  — catches: v1 JWT pasted as token, token pasted into Location field,
  truncated token, extracts Location ID from a full sub-account URL. Powers
  the Settings "Test GHL connection" button's specific error messages.
- `POST /api/test/ghl`, `POST /api/test/meta` — connection test endpoints.
- `POST /api/refresh` — `store.clearCache()`, forces a re-pull.

---

## 3. ARCHITECTURE DECISIONS

**Role held server-side, never in the cookie.** Session tokens are random and
opaque (`crypto.randomBytes(32)`); the role lives in the server's session map,
looked up on every request. *Why:* a role the client holds is a role the
client can forge — this is stated verbatim as the guiding comment at the top
of `lib/auth.js`. Don't "optimize" by putting role/claims in a JWT or cookie.

**Deny-by-default permission model, not allow-by-default.** New routes/assets
are 403 until explicitly added to `EMPLOYEE_API`/`EMPLOYEE_ASSETS`. *Why:*
safest failure direction for a single-tenant app with real financial/PII data
and only two roles — a forgotten allowlist entry fails closed, not open. When
building the UI clone: **do not infer permissions from what's visually shown**
in the reference UI — always check the actual allowlist in `lib/auth.js`.

**GHL data is cached in-memory only, never persisted to disk.**
`store.cached(key, ttlMs, fn)` (`lib/store.js:312-320`) is a plain JS object
(`memCache`), not a file. *Why:* GHL is treated as the live source of truth
for contacts/pipeline/SMS; persisting a stale local copy would create a second
source of truth to reconcile. Consequence: restarting the process (including
every Render redeploy) drops the cache; nothing is lost because nothing
authoritative lived there.

**Deal Production is its own separate JSON store, not derived from GHL.**
`production.json`, seeded once from a real CSV-derived snapshot
(`seed/production-seed.json`), then live-edited independently. *Why:* it's a
work-tracking surface (dispute-round status, document checklist, notes) that
needs to survive independently of whatever GHL currently says, and needs
fine-grained field-level permissions (`EMPLOYEE_FIELDS`) that don't map onto
GHL's tag-based model.

**PATCH-single-record instead of POST-whole-array for Deal Production.**
Originally the frontend POSTed the entire 3,578-record array on every save;
this silently clobbered concurrent edits from other employees. Replaced with
`PATCH /api/production/:id` doing a server-side deep-merge. *Why:* explicit
bug fix for real data loss in production use — don't reintroduce the
whole-array POST pattern for any multi-user editable resource.

**Notes are append-only (`note` field), never a replaceable array.** A
writable `notes` array would let one employee delete or forge a colleague's
note. *Why:* server-side attribution (who actually wrote what) would become
meaningless otherwise. Applies to client notes, task notes, and Deal
Production notes alike.

**No database — flat JSON files via `lib/store.js`.** Each concern gets one
file (`config.json`, `events.json`, `snapshots.json`, `notes.json`,
`tasks.json`, `taskNotes.json`, `notifications.json`, `dashboardLayouts.json`,
`worked.json`, `tickets.json`, `ticket_views.json`, `affiliate_overrides.json`,
`mfsn_members.json`, `mfsn_meta.json`, `mfsn_old_status.json`) plus
`production.json` and `sessions.json` outside `store.js`'s management. Atomic
writes via `.tmp` + `fs.renameSync`. *Why:* zero-dependency ethos (the repo's
only runtime dep is Express) and Render's free-tier persistent disk is enough
for this data volume. **A Postgres/Supabase migration was scoped in an earlier
session (schema design for all these entities) but explicitly paused by the
user before any DDL was written or any Supabase MCP tool was called — nothing
in Supabase has been created.** If resuming that work: the two real,
on-disk-verified data sources are `MSF CREDIT CLIENTS - Credit Repair.csv`
(repo root, untracked, git-ignored — treat as 1st source of truth) and
`seed/production-seed.json`; every other `store.js`-managed file's shape is
inferred from the code comments above each function, not from sampled real
data (they don't reliably exist on a fresh checkout — see §4).

**Identity is name-based, not email-based, for the CSV/production data.**
Neither the Google Sheet CSV nor `production.json` has an email field —
verified by direct inspection, not assumed. `bestGhlMatch()` in `lib/sheet.js`
prefers a GHL contact with a real (non-placeholder) email/phone, and
deliberately returns `null` (refuses to guess) when multiple real GHL contacts
share a normalized name. **Do not assume email is a reliable join key** across
these two sources; GHL contact matching is the only real identity resolver
that exists.

**Webhooks are open by default, not secret-gated by default.**
`checkSecret()` returns `true` when no `webhookSecret` is configured yet.
*Why:* lets a fresh deploy start receiving Zapier/n8n traffic immediately
during setup, before an admin has had a chance to visit Settings — trades a
small window of being open for not silently dropping real sales data during
onboarding. An admin is expected to set the secret promptly after deploy.

**Self-injecting IIFE modules for full-page views**
(`production.js`, `messages.js`, `team.js`, `mfsn.js`, `revenue.js`,
`personal-finances.js`) instead of editing `index.html` directly. *Why:* keeps
`index.html` (already 200KB) from growing further, and lets each feature be
added/removed/gated independently (e.g. `personal-finances.js` is only
injected for a real, non-previewing admin — see `role.js:137-144`). **Follow
this pattern for new full-page views in the UI-refactored clone.**

**Client-side UI hiding is cosmetic; server is the real boundary — stated
explicitly and repeatedly in the code.** `public/role.js`'s own top comment:
"This is presentation only." Any UI refactor can freely change how/where
elements are hidden, but must not remove or weaken the corresponding
server-side check, and must not assume a hidden button = a blocked action
(always re-verify against `lib/auth.js`).

**`READ_ONLY=1` disarms exactly two routes**, not a blanket read-only mode:
GHL status write-back (`POST /api/clients/:id/status`) and SMS send
(`POST /api/clients/:id/sms` and message reply). *Why:* lets a developer run
against real GHL credentials locally without risking a real text sent to a
real client or a real status tag changed, while still exercising the read
paths fully.

---

## 4. WORK COMPLETED

**Done and verified working (this session, direct verification):**
- `npm install` succeeds cleanly (68 packages, only dep tree is Express +
  test-time nothing — `node:test` is built in).
- `npm test`: **212 passing / 3 failing** (fresh run, see below for the
  failures — do NOT trust any test count mentioned in `docs/HANDOFF.md` or
  `README.md`, both are stale snapshots from earlier sessions).
- All 69 `/api/*` and `/webhooks/*` routes enumerated directly from
  `server.js` (see §2) — this list is exhaustive as of this file's writing.
- `lib/auth.js`'s allowlists (`EMPLOYEE_API`, `EMPLOYEE_ASSETS`,
  `EMPLOYEE_FIELDS`, `EMPLOYEE_HIDDEN_CLIENT_FIELDS`) read in full and
  reflected accurately in §2/§3 above.
- `lib/store.js` read in full — every JSON file it manages, its shape, and
  its access functions are accurately documented above (not inferred).

**Known-broken (verified failing right now, `npm test` output):**
- `tests/messages-reply.test.js` — 3 assertion failures:
  1. "READ_ONLY refuses a reply against live GoHighLevel" — expected HTTP 403,
     got 500 (the `READ_ONLY` guard on message-reply is throwing instead of
     cleanly rejecting).
  2. "a live reply calls ghl.sendMessage with the right channel and records
     the event" — expected `true`, got `undefined` (a mock/assertion mismatch
     on whether `sendMessage` was actually invoked with the right args).
  3. "an Email reply includes a subject and html body" — expected the string
     `'Email'`, got `'EMAIL'` (case mismatch — either the test or the route's
     channel-normalization logic needs to agree on casing).
  These are pre-existing and were not introduced by this session — they
  reproduce on a clean checkout + `npm install` + `npm test`. **Fix before
  relying on the Messages reply feature in the clone.**

**Done but not independently re-verified this session (carried from prior
session notes / `docs/HANDOFF.md` — treat as probably-true, not confirmed):**
- Login throttle behavior, SSO flow, MFSN webhook ingestion, sheet-sync
  reconcile logic, production PATCH deep-merge/4s-poll live-refresh — all
  have dedicated passing tests in the current 212, but were not manually
  exercised in-browser this session.
- Deployment to Render — the live URL and Render config are documented in
  `README.md`/`CLAUDE.md` but not reachable/verified from this session
  (no browser check performed).

**Explicitly paused, not done:** Postgres/Supabase schema migration (see §3
and §5) — design only, partially scoped, zero implementation, zero Supabase
MCP calls made.

---

## 5. OPEN ITEMS / TODOs

1. **Fix `tests/messages-reply.test.js`'s 3 failures** (see §4) before
   trusting the Messages reply feature.
2. **CFPB plaintext passwords** (`CFPB_ROUND_COLS` data in the CSV) — no
   encryption-at-rest strategy decided yet. Flagged, not resolved, in the
   paused schema-design thread.
3. **Identity/PK strategy for a future DB schema** — no email field exists in
   either real data source (CSV or `production-seed.json`); name-based
   matching is ambiguous (duplicate names exist in both). Open question,
   unresolved, from the paused schema-design thread.
4. **Postgres/Supabase migration** — paused by explicit user instruction
   ("pause on all that for now"). A `.mcp.json` registering a Supabase MCP
   server IS already connected/approved (tools like `mcp__supabase__
   apply_migration`, `execute_sql`, `list_tables`, etc. are available) but
   **nothing has been created in the Supabase project**. Do not resume this
   without the user explicitly re-opening it; when resumed, the user
   required: full DDL presented for approval BEFORE any `mcp__supabase__*`
   write call, phased migration plan (JSON+Sheet → schema, with validation),
   then `lib/store.js` updated to read/write Postgres while **keeping
   identical function signatures** so `server.js` doesn't need rewriting.
5. **MFSN affiliate income** — no data path exists yet (MFSN's Zapier
   integration carries member lists, not commission/payment data). Per prior
   session notes, likely needs manual entry from the MFSN affiliate portal;
   unresolved.
6. **`personal-finances.js`'s real income figure** — hardcoded in
   client-servable JS source (gated from employees via asset allowlist +
   role.js, but still shipped to any admin's browser as plain source). Should
   move server-side behind an admin-only endpoint. Not done.
7. **`mfsn_old_status` staleness** — the "Old vs New member" audit
   (`getMfsnOldStatus()` in `lib/store.js`) is a manual, point-in-time snapshot
   (dated 2026-07-31 in the seeded default) with no automatic re-audit
   mechanism. Will silently go stale.
8. **Google Sheet live integration** — per `README.md`/`docs/HANDOFF.md`,
   design was agreed (one-way, read-only, sheet → dashboard, private +
   Google-service-account access) but never built; currently only a manual
   CSV-paste flow (`POST /api/production/sheet-sync`) exists.
9. Untracked, git-ignored-by-content-not-by-rule files currently sitting in
   the working tree: `MSF CREDIT CLIENTS - Credit Repair.csv` (repo root,
   **not actually covered by `.gitignore`** — verify before any push whether
   this should be committed, since `.gitignore` currently only excludes
   `node_modules/`, `data/`, `.env`, `sessions.json`, `production.json`), plus
   `.agents/`, `.claude/`, `.mcp.json`, `skills-lock.json` (tool-generated,
   from `npx skills add supabase/agent-skills` and Supabase MCP registration
   — decide gitignore-vs-commit at push time per standing user instruction,
   don't ask).

---

## 6. GOTCHAS

**Environment variables** (`CLAUDE.md`, verified against `server.js`/
`lib/store.js` usage):

| Variable | Purpose | Breaks silently if wrong? |
|---|---|---|
| `PORT` | HTTP port | No — Express default kicks in |
| `DATA_DIR` | Where all JSON state lives | **Yes** — see next gotcha |
| `APP_PASSWORD` | Legacy password, migrated into first `admin` account on boot | No, but only applies once (first boot) |
| `READ_ONLY` | `1` disables GHL status write-back + SMS send | No — fails loudly (visible refusal + log), by design |
| `SSO_SHARED_SECRET` | Signs/verifies Proven Agency SSO tokens | Yes — SSO silently fails closed with no secret (`verifySsoToken` returns null) |
| `PROVEN_DASHBOARD_URL` | Where support tickets forward to | Defaults to production Proven URL if unset — **local dev will hit the real external dashboard unless overridden** |
| `TICKETS_SHARED_SECRET` | Auth for the ticket forward/sync | Forward silently fails/errors without it |
| `BIZ_TZ` | Timezone for date-range grouping | Wrong business timezone → all dashboard date buckets shift |

**`DATA_DIR` inconsistency between `server.js` and `lib/store.js`** — both
default to *somewhere under the repo* when unset, but not the same somewhere:
`lib/store.js` defaults to `<repo>/data/` (`path.join(__dirname, '..',
'data')`); `server.js`'s own `SESSION_FILE`/`PROD_FILE` paths default to the
repo root directly (`__dirname`) when `DATA_DIR` is unset. **On Render,
`DATA_DIR=/data` is always set, so this never surfaces in production** — but
a local dev session with `DATA_DIR` unset gets `sessions.json`/
`production.json` at the repo root while `config.json`/`events.json`/etc. land
in `./data/`. Don't "fix" this by assuming they should be unified without
checking both call sites — just be aware of it when debugging "why isn't my
data where I expected."

**Webhook secret is opt-in, not opt-out** — a fresh deploy accepts
unauthenticated webhook POSTs until someone visits Settings and sets one. Not
a bug, but don't assume webhooks are secured just because the code has
`checkSecret()` calls everywhere — check whether `cfg.webhookSecret` is
actually set.

**GHL v2 vs v1 credentials** — the app only works with a `pit-` Private
Integration token (v2, `services.leadconnectorhq.com`). A v1 API key (a long
`eyJ…` JWT from Business Profile) fails with "Invalid JWT" — `lib/ghlcreds.js`
exists specifically to catch this and other common paste mistakes (token in
Location field, truncated token, whole sub-account URL pasted as Location ID)
and surface GHL's real error instead of a generic failure.

**`contacts.readonly` scope must be ticked at Private Integration *creation*
time** — per `README.md`, GHL doesn't reliably let you add it after the fact.
Missing this scope is the single most common "connection test fails" cause
(`"not authorized for this scope"`).

**`teamNavBtn` ordering dependency** — `public/role.js`'s `gateNav()` polls
(`retry()`, ~50ms × up to 60 tries ≈ 3s) waiting for `team.js` to
asynchronously inject `#teamNavBtn` before it can finish hiding
non-allowlisted nav items for an employee. If a UI refactor changes when/how
`team.js` injects its button, or renames the id, the employee nav gating
silently breaks (nav items stay visible that shouldn't, or gating just never
completes within the 3s window).

**`dashboardLayouts.json`'s `__default__` key can go stale** — per a comment
in `lib/store.js` (`clearDefaultDashboardLayout`), this exact clone's
`dashboardLayouts.json` shipped once with a pre-existing `__default__` entry
"from before the Admina-matching pass," which caused every fresh login and
every "Reset to default" click to silently revert to a stale layout instead
of picking up the current HTML's shipped `gs-w/gs-h/gs-x/gs-y` attributes.
**If dashboard cards look wrong/stale after a UI refactor changes the
default grid, check for a leftover `__default__` entry in
`dashboardLayouts.json` before debugging the frontend.**

**Inline `<script>` in `index.html` is unchecked by any tool** — no
bundler/linter/typechecker runs over it. `CLAUDE.md`'s stated convention:
**syntax-check inline JS by hand after editing it, before trusting the
change.** Doubly true in a UI-refactor context where large chunks of markup
+ inline script get restructured together.

**Never commit `sessions.json`, `production.json`, or `data/`** — contain
live session tokens and real client PII. Gitignored already; don't override.

**`npm install` is required before `npm test` will even load** — on a fresh
checkout, `node_modules` doesn't exist and every test file fails at
`require('express')` inside `server.js` with `MODULE_NOT_FOUND` (looks like
every test file is broken; it's actually just missing deps). Verified this
exact failure mode this session.

---

## 7. CONVENTIONS

From `CLAUDE.md` (checked into repo, authoritative) + verified against actual
code:

- **TDD**: write a failing `node:test` first, watch it fail, then implement.
- **Every webhook route must call `checkSecret(req, res)`** — verified all 5
  webhook routes do this (`server.js`).
- **Every new employee-reachable route or static asset must be added
  explicitly** to `EMPLOYEE_API`/`EMPLOYEE_ASSETS` in `lib/auth.js` — default
  is 403. This is the single most important convention to preserve in a UI
  refactor: **a new UI element that calls an existing API route needs no
  server change; a UI element that calls a NEW route does.**
- **After changing inline JS in `index.html`, syntax-check it before trusting
  it** — no bundler/linter covers it.
- **No comments explaining WHAT code does** (well-named identifiers should
  already do that) — but this codebase is unusually generous with WHY
  comments explaining non-obvious business decisions (e.g. why notes are
  append-only, why a field is admin-only, exact dates of scope changes like
  "as of 2026-08-05"). **Preserve this commenting style** when touching
  `lib/auth.js`, `lib/store.js`, `server.js` — the WHY comments there are
  load-bearing institutional memory (e.g. explaining exactly which nav items
  employees can see and why, or why `mfsnCommission` alone stays hidden).
- **Self-injecting IIFE modules, not edits to `index.html`**, for new
  full-page views (see §2/§3, `production.js`/`messages.js`/`team.js`/
  `mfsn.js`/`revenue.js`/`personal-finances.js` as the pattern to follow).
- **Naming**: camelCase for JS identifiers throughout; JSON store files are
  lowerCamelCase or snake_ish (`taskNotes.json`, `ticket_views.json`,
  `mfsn_old_status.json` — inconsistent casing across store files, not worth
  "fixing" as part of a UI refactor since it'd touch `lib/store.js`'s file()
  helper and every existing JSON file on disk).
- **Folder structure**: `server.js` (routes) → `lib/*.js` (one module per
  concern, required from `server.js`) → `public/*` (frontend, static). Tests
  mirror `lib/` one-file-per-concern in `tests/`. This structure should be
  preserved by the UI clone even if `public/`'s internals change
  substantially — `lib/` and `server.js` are the parts that must stay
  functionally identical.

---

## 8. UI DIFFERENCE NOTE

**The current repo is itself mid-way through a UI reskin** — recent commit
history (`git log`) shows an extensive, ongoing effort to match a Bootstrap
template called **"Admina"** (shipped as reference material at
`public/admina-dashboard.html` + `public/admina-assets/{css,js,fonts}`):
green color scheme, KPI card sizing/fonts, sidebar nav pill styling, dark
mode, gridstack-style dashboard cards, chevron pipeline nav, custom scrollbar
on the Pipeline board, segmented-bar Client-base widget, Sales-Overview chart
styling, Delivery-Status styling, etc. **If the target UI-refactored clone is
a continuation or completion of this same Admina-matching effort, the commit
history in this repo (30+ commits, all with descriptive messages) is
directly relevant prior art — read it before redoing work.**

**Functionality tightly coupled to specific UI structure/DOM (verify these
survive a refactor, don't just restyle blindly):**

- **`public/role.js`'s nav-gating logic is DOM-structure-dependent, not just
  CSS-dependent.** It walks `.navgroup button` elements, `.sec[data-g]`
  headings, and `.railbtn[data-g]` icon-rail buttons by specific `id`s
  (`teamNavBtn`, `pipelineNavBtn`, `pvNewClientsBtn`, `clientsNavBtn`,
  `fuNavBtn`, `msgNavBtn`, `changePwNavBtn`, `signOutNavBtn`) and `data-g`
  group codes (`ov`, `cl`, `pr`, `ac`). **A UI refactor that renames these
  ids/attributes or restructures the sidebar's two-tier icon-rail-+-panel
  layout will silently break employee nav gating** (cosmetically — the
  server-side 403 boundary still holds — but employees would see broken/
  wrong nav). Update `role.js`'s selectors to match new markup; do not skip
  this file when refactoring the sidebar.
- **`data-role` attribute on `<body>`** — set by `role.js` to the *effective*
  role, and at least one CSS rule is keyed off it directly
  (`body[data-role="employee"] #dStage{pointer-events:none;opacity:.55}` —
  locks the Deal Production stage control for employees since the server
  rejects that write). Any refactor must preserve `body[data-role]` as a
  hook, or reimplement that specific lock some other way that's actually
  wired to a real permission check (not just visual).
- **`#dStage`, `#viewAsEmployeeBtn`, `#previewBanner`, `#exitPreviewBtn`,
  `#backToProvenBtn`, `#globalSearch`, `#addClientBtn`, `#sources`,
  `.filters`** — all referenced by specific `id`/class/attribute from
  `role.js`. Renaming these in a refactor requires updating `role.js` in
  lockstep or these features silently stop being hidden/shown correctly for
  the right role/context.
- **`openClient()`'s `moneyVisible` gating** (referenced in `lib/auth.js`
  comments as the client-side mechanism gating the Payment history list and
  totalSpent/numberOfPayments stat tiles) — this is a UI-side visibility
  concept layered on top of already-redacted server data
  (`mfsnCommission` is stripped server-side; totalSpent/numberOfPayments are
  NOT stripped server-side, they're just hidden by this client-side flag).
  **If the clone's UI restructures the client drawer, re-verify this
  gating is still applied** — it's the one place where "hidden in the UI"
  is the actual intended boundary (by explicit prior request: "actions
  [...], not numbers"), not just cosmetic redundancy over a server check.
- **Pipeline board's custom horizontal scrollbar** (heavily iterated per
  commit history: `157b97f`, `7a563b5`, `99a3dcb`, `b6cf754`, `843e9a4`) —
  purely visual/UX, safe to reimplement differently in the clone, but note
  the iteration history reflects real usability lessons (native scrollbar
  didn't reach the last column past an open drawer, buttons were removed in
  favor of just the scrollbar) — don't reintroduce the same UX issues.
- **Gridstack `gs-w`/`gs-h`/`gs-x`/`gs-y` attributes** on dashboard card
  markup are the shipped-HTML fallback layout, read by
  `getDefaultDashboardLayout()`/the frontend when no `__default__` or
  per-user layout exists in `dashboardLayouts.json`. A UI refactor that
  restructures dashboard cards must either keep equivalent attributes or
  update whatever reads them — otherwise first-ever logins (no saved
  layout yet) get a broken/default grid.
- **Self-injecting module pattern's nav-button injection is what `role.js`
  depends on being present/timed correctly** (see `teamNavBtn` gotcha in
  §6) — any refactor of `production.js`/`messages.js`/`team.js`/`mfsn.js`/
  `revenue.js` must preserve *that they inject a real nav button with a
  stable, known id* even if the button's visual styling changes completely.

**Safe to restyle freely (no functional coupling found):** KPI card visual
sizing/fonts, chart color schemes, dark-mode token values, sidebar accent
colors, individual card layouts within the dashboard grid (as long as the
gs-* fallback + saved-layout system above is respected), the
`admina-dashboard.html`/`admina-assets` reference files themselves (not
served/linked into the live app's actual functionality — reference/theme
material only, confirmed via grep — `admina-dashboard.html` is linked *from*
`index.html` as a separate template reference page, not load-bearing for any
API flow).
