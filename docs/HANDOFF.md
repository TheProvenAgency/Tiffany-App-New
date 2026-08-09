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
