# Handoff — MSFS Dashboard

Status as of this session. Everything below is committed to `main` and
auto-deploys to https://tiffany-app-new.onrender.com (confirmed from real
deploy logs, 2026-08 -- no persistent disk attached on this host; see the
Postgres-primary tiers in CLAUDE.md). **107 tests, all passing**
(`npm test`). Working tree clean, nothing unpushed.

## What this app is

A single-tenant business command center for "Ms. Financial Solutions" (a credit-
repair business). One Node process, one dependency (Express). Vanilla-JS
frontend, JSON-file persistence, deployed on Render free tier (auto-deploys on
push to `main`).

- **Boots in DEMO mode** with realistic sample data until GoHighLevel keys are
  entered in ⚙ Settings, then flips to LIVE.
- **`DATA_DIR`** holds runtime state (config, sessions, production.json). Set to
  `/data` on Render; **unset locally it falls back to the repo root**, so
  `sessions.json` and `production.json` are gitignored.
- Run locally: `npm install && npm start` (port 3000). Tests: `npm test`
  (built-in `node:test`, no framework).
- `READ_ONLY=1` disarms the two live-GHL write paths (status write-back, SMS)
  for safe local development against real keys.

## Architecture notes for editing

- **`server.js`** — all routes + the auth/permission middleware.
- **`lib/`** — `auth.js` (accounts, sessions, permission tables),
  `ghl.js` (GoHighLevel v2 client with retry), `ghlcreds.js` (credential
  validation), `affiliate.js` (MFSN gap engine), `store.js` (file persistence),
  `demo.js`, `meta.js`, `social.js`.
- **`public/index.html`** — a 55KB single file (markup + inline JS). Edit
  carefully; syntax-check inline scripts before trusting. `production.js` and
  `role.js` self-inject their own nav/views rather than living in index.html.
- **The auth boundary is server-side and deny-by-default.** Employees reach an
  explicit allowlist of routes/assets; everything else is 403. Hiding UI is
  cosmetic only.

## Built this session (16 commits)

**Role-based access (the original ask):**
- Two roles: **admin** (everything) and **employee** (Deal Production tracker
  only). Individual accounts, `scrypt` + per-user salt, opaque random session
  tokens (role held server-side, never in the cookie). Existing shared password
  migrated to an `admin` account on first boot.
- Deny-by-default over both API routes AND static assets
  (`personal-finances.js` has balances in its source — gated from employees).
- Team management panel in Settings (add/enable/disable users; last admin can't
  be locked out). Login now needs **username + password**.

**Deal Production made multi-user:**
- `PATCH /api/production/:id` saves one lead at a time (was: POST all 3,578,
  which silently clobbered concurrent edits). Server deep-merges sub-objects so
  same-lead edits don't collide.
- Notes are append-only via a `note` field; author stamped from the session.
- Live refresh: an open drawer polls `GET /api/production/:id` every 4s and
  adopts a colleague's change without reload (skips while mid-edit / on own
  writes). Verified with two sessions.

**Security hardening:**
- Login throttle (10 tries → 15-min lockout), keyed by account AND address;
  `trust proxy` so it works behind Render's edge.
- Sessions expire server-side at 30 days.
- `production-seed.json` (3,578 real client records) moved out of the
  browser-servable `public/` dir; now seeds `production.json` on first run.
- `READ_ONLY` guard on the two live-GHL write routes.

**GoHighLevel connection hardening + diagnostics:**
- `ghl.js` retries 429/5xx with backoff (honors Retry-After), 20s timeout,
  classified error messages.
- `ghlcreds.js` + Settings: catches a v1 JWT in the token field, a token in the
  Location field, a truncated token, and extracts the Location ID from a pasted
  sub-account URL. "Test GHL" saves first, then tests, and shows GHL's own
  error.

**MyFreeScoreNow affiliate gap (new feature — backend + UI):**
- `POST /webhooks/mfsn` ingests enrolled members from a scheduled Zapier "Fetch
  Active Members List" Zap (snapshot-replace or single upsert; secret-protected
  like Fanbasis/DisputeFox).
- `lib/affiliate.js` computes clients-not-enrolled (email match, name fallback).
- `GET /api/affiliate-gap` (admin-only) + a dashboard card. Verified in-browser.

## Open blockers (need the human)

1. **GHL `contacts.readonly` scope.** The connection is fully diagnosed and one
   step from working. The token is valid (reads locations) but the Private
   Integration lacks `contacts.readonly`, so `/contacts/search` returns 401
   "not authorized for this scope". The real Location ID is
   **`PKDfPdV5gIlwMi5G8XW1`** (auto-discovered; already set in the local 4300
   config). Once the scope is added in GHL, the connection works. NOTE: the
   token surfaced in a diagnostic log — regenerate it after confirming.
   GHL setup gotchas are in `README.md`.
2. **MFSN Zap** not yet created — the affiliate-gap card is empty until a Zap
   posts to `/webhooks/mfsn` (URL shown in Settings).

## Roadmap / not yet built

- **Google Sheet bridge** — DESIGN AGREED, not built. One-way, read-only,
  **sheet → dashboard** (a migration bridge; the dashboard is meant to replace
  the sheet but must capture sheet edits during transition). Access decided:
  **private + Google service account** (view-only share, no changes to the
  sheet's content). Blocked on: the sheet's **column headers** and a **match
  key** (unique id/email vs. name) — needed before writing the spec. Recommended
  read path: Sheets API v4 with a service-account JWT (hand-rolled, no new dep,
  to fit the zero-dependency ethos) polling on an interval; merge rule TBD from
  the columns (dashboard-owned work fields must survive a sync).
- **MFSN income** — she wants her affiliate income shown. NO data path found:
  MFSN's Zapier integration carries member lists but no commission/payment data.
  Next step is the human checking whether her MFSN affiliate portal exposes a
  commission total or export. Likely manual entry.
- **Personal-finances income figure** — `public/personal-finances.js` has real
  business figures (e.g. `income:47900`) hardcoded in client source. Gated from
  employees, but should move server-side behind an admin endpoint. (The rest of
  that file is Lunch Money SAMPLE data — placeholders, not real.)

## Conventions to keep

- TDD: failing test first, watch it fail, then implement (`node:test`).
- Never commit `sessions.json` / `production.json` / `data/` (secrets & PII).
- Every webhook uses `checkSecret`. Every new employee-reachable route/asset
  must be added to the allowlists in `lib/auth.js` — otherwise it's 403 by
  default (which is the safe direction).
- After changing inline JS in `index.html`, syntax-check it before trusting.

---

## 2026-08-10 — capabilities, dispute desk, range-aware package revenue

**Permissions are now per-feature, not per-role.** `lib/auth.js` exports
`CAPABILITIES`, `ROLE_CAPS`, `capsFor()`, `has()`. A role is only a named
preset; the gate checks the capability. A user row may carry an explicit
`capabilities` array that overrides its preset entirely (settable via
POST/PATCH `/api/users`; `null` clears it and returns the account to the
preset). Presets:

| role | capabilities |
|---|---|
| `admin` | all |
| `employee` | production, messages, clients, pipeline, followups, tickets |
| `va` | production, messages, clients, followups, tickets |
| `disputer` | disputes, tickets |

`employee`'s preset is exactly the old employee surface, so no existing
account changed on this deploy. Deny-by-default still holds. `req.actor` and
`req.capabilities` are set by the gate; `/api/me` returns `capabilities` so
the UI gates on the same list the server does.

Static assets are tied to the capability they serve (`ASSET_CAPS`) rather
than a flat allowlist. **`team.js` is deliberately in `COMMON_ASSETS`, not
behind `admin`** — `role.js`'s `gateNav()` polls for the `#teamNavBtn` it
injects, so denying the file stalls nav gating ~3s for every non-admin (§6).

**Dispute desk** (`lib/disputes.js`, `public/disputes.js`,
`GET /api/disputes/queue`, `GET|PATCH /api/disputes/:id`). A projection over
Deal Production, not a second store — the bureau columns, round, CFPB login
and document checklist already live on that row. Rows are built field by
field, so a money column added to Deal Production later cannot leak into a
disputer's surface by default. Queue ranks ready-to-file above
blocked-on-monitoring, then longest-waiting. Writable fields for a disputer
are `DISPUTE_FIELDS` (tu/eq/ex/cfpb/note) — not `stage`, not `docs`.

**Revenue by package now follows the date filter.** It previously always read
`byProductAllTime`. The pre-webhook Commas block
(`HISTORICAL_PRODUCT_SALES`) is a dateless snapshot, so it is only attributed
to All Time; narrower ranges use `byProduct` (live Fanbasis events) and the
subtitle states which is on screen.

Tests: **282 total, 279 passing.** The 3 failures are still the pre-existing
`tests/messages-reply.test.js` ones (READ_ONLY 500-vs-403, a sendMessage mock
mismatch, and `'EMAIL'` vs `'Email'` casing) — untouched by this work.

### Still open after this session
1. The 3 messages-reply failures.
2. **Tier-2 Postgres durability.** Only config, events and MFSN members
   hydrate on boot. notes/tasks/taskNotes/worked/affiliate_overrides mirror
   into Postgres but are never read back, and notifications/ticket_views/
   dashboard_layouts/tickets/snapshots are not mirrored at all. On a host with
   no persistent disk this is live data loss on every spin-down.
3. `users` table migration — blocks the three stores that need a real
   `users.id` FK.
4. Revenue view still needs the reference chart set rebuilt against the
   Admina tokens (donut with source split, affiliate report, half-donut
   package gauge, active-by-round bars, enrolled/actives/upgraded rings).
5. `personal-finances.js` still ships a real income figure in client source.
6. `mfsn_old_status` is still a manual snapshot with no re-audit path.

### Later the same day (2026-08-10, continued)

- **All 287 tests pass, 0 failing.** The three messages-reply failures are
  fixed: READ_ONLY is read at call time (was captured at module load, so
  setting it after require() did nothing), and the other two were the test's
  own fetch-stub capturing its own request -- req() now always uses the real
  fetch. The route was correct all along.
- **Postgres boot-restore extended** to tasks, task notes, client notes,
  worked-marks and affiliate overrides (restore-only-when-empty, .pgId
  re-linked). Still JSON-only: notifications, ticket_views,
  dashboard_layouts, tickets, snapshots -- blocked on a users migration.
- **Dispute PATCH persists without Postgres**: both PATCH routes now share
  applyProdPatchToJson(). Before, the dispute route answered 200 with the
  unmodified record in a Postgres-less environment (found end-to-end, not by
  unit tests).
- **Total income KPI tile follows the date picker** via a postMessage
  handshake between index.html and the admina-dashboard.html iframe
  (parent broadcasts on every loadDashboard; frame requests on load because
  the first broadcast usually beats iframe load).
- End-to-end verified against a locally-running server: disputer role
  isolation (403s on production/dashboard/messages + asset gating), queue,
  record drawer, bureau PATCH, stage rejection; dashboard range coherence
  at 30D/90D/All.

### Real data + durability pass (2026-08-10, evening)

**Revenue is real on both sides now, no estimates.**
- `seed/commas-payments-seed.json` -- 5,133 succeeded Commas/Fanbasis sales
  with exact per-sale timestamps, Apr 2025 to Jul 2026, $834,491.75. Seeded at
  boot, idempotent by Commas payment id. This is what the "$50 total income"
  actually needed: the webhook only started carrying a product field in late
  July, so nearly the whole history was invisible.
- `MFSN_MONTHLY_INCOME` in server.js -- all 37 months of real payouts, Jul
  2023 to Jul 2026, $244,194.34, which matches the portal's own lifetime
  figure. An earlier hand-copied version had 10 months; anything reaching
  further back under-reported silently.
- `HISTORICAL_PRODUCT_SALES` is no longer merged into the package breakdown
  (it would double-count now that the same sales are dated). Kept only as the
  provenance record of the 2026-07-30 hand-pull.

**The dashboard no longer dies when GoHighLevel does.** `getClients()` was
awaited bare in `/api/dashboard`, so a rejected GHL token took the whole page
down -- $0 income, blank Client base. Each source is caught independently now
and the failure is reported in `ghlError`. Regression test:
`tests/dashboard-degrades.test.js`.

**Every store now survives a restart.** `lib/migrate.js` is an additive,
idempotent boot migration (users + notifications + ticket_views +
dashboard_layouts, and it relaxes the old users_role_check that only allowed
admin/employee). Boot-time because the Supabase URL only exists as a Render
env var. `bootstrap()` in server.js states the ordering: schema, restore,
accounts, then user-scoped stores, then the Commas seed.

**306 tests, 0 failing.**

### Corrections to earlier notes in this file
- Item 5 ("personal-finances.js ships a real income figure") is **stale** --
  the file is entirely Lunch Money placeholder data (Ally/Fidelity/Vanguard).
  Verified by inspection; there is no real figure to move server-side.
- Item 2 (tier-2 Postgres durability) and item 3 (users migration) are
  **done**, above.

### Genuinely still open
1. **The GHL token.** Client-count cards stay empty until it's fixed --
   Settings -> Test GHL connection names the exact error. Per README the
   `contacts.readonly` scope must be ticked at Private Integration *creation*
   time; GHL does not reliably let you add it afterwards.
2. **Zapier feeds** (Fanbasis / DisputeFox / MFSN) still point at the old app.
   Repoint to `https://tiffany-app-new.onrender.com/webhooks/...` with
   `?secret=` from Settings. Until then new sales arrive only in the backfill,
   which is a point-in-time export.
3. **August MFSN payout** posts in early September and needs adding to both
   `MFSN_MONTHLY_INCOME` and `public/mfsn.js` -- `tests/mfsn-frontend-sync.test.js`
   fails loudly if they drift apart. Worth automating off the portal export.
4. `mfsn_old_status` remains a manual audit with no re-audit mechanism.
