# n8n Sheet-Sync Webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `/webhooks/sheet-sync` endpoint that lets an n8n flow (Google Sheet
sync, ~every 6h) push client + Deal Production data into Postgres, idempotently,
with CFPB portal passwords AES-256-GCM encrypted before they ever touch the DB.

**Architecture:** Reuse, don't reinvent. `lib/sheet.js` already contains the exact
matching/diff engine (`reconcileSheet`) and status parser (`parseBureauCell`)
this data needs — it was built for a manual CSV paste of the same underlying
Google Sheet ("MSF CREDIT CLIENTS" → Credit Repair tab). The webhook's only new
code is (a) a JSON-item → sheetRow normalizer (the CSV-column-index reader in
`lib/sheet.js` doesn't apply to n8n's named-field JSON) and (b) the route itself,
which calls the existing `reconcileSheet()` → `dealProd.patchProdRecord()` /
`dealProd.appendProdRecords()` pipeline exactly as `/api/production/sheet-sync`
(server.js:2604) already does for the manual path.

**Tech Stack:** Express route in `server.js`, `lib/sheet.js` (reused, possibly
extended with a JSON normalizer), `lib/production.js` (`appendProdRecords`,
`patchProdRecord` — both already Postgres-first + CFPB encryption via
`lib/crypto.js`), `lib/crypto.js` (reused unmodified).

**Spec:** User's message in this conversation (2026-08-16) — no separate spec
doc; requirements captured verbatim in "Requirements" below.

## Global Constraints

- CFPB `pw` fields must be AES-256-GCM encrypted via `lib/crypto.js` before
  reaching Postgres. Never plaintext in any DB column.
- If `APP_ENCRYPTION_KEY` is unset, skip encrypting/storing the secret fields
  entirely — never fall back to plaintext. (See Finding 3 below: this requires
  a guard the shared `patchProdRecord`/`appendProdRecords` functions don't
  currently have.)
- Never silently merge two different people who share a name — surface as a
  collision instead (matches existing `duplicateNames` behavior in
  `reconcileSheet`).
- Re-firing an identical payload must produce zero duplicate rows in any table.
- Never crash on a malformed date or free-text field; store/flag it instead.
- Webhook is exempt from the session gate, enforces its own `?secret=`/
  `x-webhook-secret` via the existing `checkSecret()` (server.js:1948).

---

## Verified findings (payload-independent — confirmed by reading the code)

**Finding 1 — `lib/sheet.js` is directly reusable (requirement 3).**
`parseBureauCell(raw, filedRounds)` (lib/sheet.js:97) already turns free text
into `{ r, st }` and is source-format-agnostic — it takes a raw string, not a
CSV cell. `deriveStage`, `bestGhlMatch`, and — most importantly —
`reconcileSheet(sheetRows, ghlClients, prodClients)` (lib/sheet.js:195) is the
full matching/diff engine: GHL-name match → legacy first-name+last-initial
fallback → `duplicateNames` collision list (skipped, never merged) →
`unmatched` (reported, never created, since there's no email/phone to create a
GHL contact from). This is designed to consume a `sheetRows` array shaped
`{ name, pkg, tu, eq, ex, notes, cfpb }` — exactly what `normalizeSheetRows()`
produces from CSV today. **Plan: write a new normalizer for the n8n JSON shape
that outputs the same `sheetRows` shape, then call `reconcileSheet()` directly.**
Only `parseCsv`/`normalizeSheetRows` (the CSV-column-index readers) are NOT
reusable as-is; everything downstream of `sheetRows` is.

**Finding 2 — status-value handling (requirement 6): none of the listed values
are silently dropped.**
- `"-"` → short-circuits to `{ r: 0, st: 'none', raw: '-' }` (lib/sheet.js:99).
- `"Rnd 3 login"` → `/log[\s-]?in/` matches → `st: 'login'`, `r: 3` (explicit
  digit in the string wins over the filed-rounds fallback).
- `"Round 6 Done"` → `/done|resolved|completed/` matches → `st: 'done'`, `r: 6`.
- `"Resolved"` → same regex matches → `st: 'done'`, `r: Math.max(filedRounds, 1)`
  (no digit in the string, so it falls back to how many rounds have a filed
  date — this needs a JSON-equivalent of `countFiledRounds`, see Task 2).
- Anything that matches none of the three status regexes →
  `{ r: 0, st: 'none', raw: s, unrecognized: true }` — never thrown away, never
  crashes; `production_bureau_status.unrecognized`/`raw_text` columns already
  exist in Postgres for exactly this case (confirmed via `list_tables`).

**Finding 3 — encryption-path gap when `APP_ENCRYPTION_KEY` is unset (relevant
to the "skip, never plaintext-fallback" requirement).**
Both `dealProd.patchProdRecord` (lib/production.js:298) and
`dealProd.appendProdRecords` (lib/production.js:177) call
`appCrypto.encrypt(c.pw)` unconditionally whenever a cfpb entry has a truthy
`pw` — and `crypto.js`'s `encrypt()` *throws* if the key isn't configured
(lib/crypto.js:22), it doesn't return null. That throw is inside
`appendProdRecords`'s single transaction (aborts the whole insert, not just
the cfpb row) and inside `patchProdRecord`'s per-record try/catch (aborts the
remaining fields in that patch — stage/pkg/ghl-linking included). This is
pre-existing behavior in the already-shipped CSV sheet-sync path too, not
something introduced today — not touching it, per the instruction to reuse
the existing machinery rather than rewrite it. **Plan: guard in the new
webhook handler only** — before calling into `patchProdRecord`/
`appendProdRecords`, check `appCrypto.isEnabled()`; if false, strip `pw` from
every cfpb entry in the batch (keep `date`/`email`), log a warning with the
affected count, and proceed. Confirmed via `production_cfpb_logins` row count
(8,376) that the key is currently configured in this Supabase project, so
this guard is a safety net, not something expected to fire in practice.

**Finding 4 — id scheme for new records must not collide with existing
prefixes.** `production_records.legacy_id` is UNIQUE (confirmed via
`list_tables`). Existing prefixes in use: `'G' + ghlId` (GHL reconcile,
server.js:2576), `'S' + ghlId` (CSV sheet-sync creates, server.js:2636),
`'manual-' + Date.now().toString(36)` (POST /api/production/add,
server.js:2469). None of these fit a name-keyed record with no GHL id.
**Plan: `'SS' + <slug>'`** where slug is deterministically derived from the
matched sheet row (so a re-fired payload for the same person computes the
same legacy_id, giving idempotency a second independent guarantee beyond
`reconcileSheet`'s own existing-record lookup) — exact slug function to be
finalized once the payload shows what a stable per-row key looks like (name
alone, given the known ~0.5% duplicate-name rate, is NOT safe as the sole
key — this is why `reconcileSheet`'s GHL-match + duplicate-detection is
being reused rather than a bare name lookup).

**Finding 5 — the ~1% duplicate-name concern is real and already measured.**
`scripts/build-migration-sql.js` documents "20 duplicate names" across the
~3,600-row original migration (≈0.55%, in the ballpark of the user's "~1%"
recollection) and HANDOFF.md flags name-based matching as inherently
ambiguous with no email field in the source data. `reconcileSheet`'s
`duplicateNames` output (rows whose normalized name collides with another row
in the *same* payload) plus its `unmatched` output (rows matching neither a
GHL client nor an existing Deal Production record) together are the existing,
tested answer to "surface collisions, never silently merge" — reusing them
directly satisfies requirement 4 without new collision logic.

**Finding 6 — `checkSecret()` pattern (requirement 1).**
`function checkSecret(req, res)` (server.js:1948) is source-agnostic — it just
checks `req.query.secret` / `req.headers['x-webhook-secret']` against
`store.getConfig().webhookSecret` (same secret every other webhook shares) and
writes the 401 itself. `/webhooks/mfsn` (server.js:2068) is the smallest
correct example of the call pattern: `if (!checkSecret(req, res)) return;` as
the first line, before touching `req.body`.

---

## Open — blocked on the real payload

- [ ] **Task 1: Field→column map.** Cannot be written until the real n8n
  request body is pasted (per user instruction: never invent field names).
  This becomes Hard Stop #1.
- [ ] **Task 2: JSON-shape normalizer** (`normalizeSheetJsonRow` or similar,
  likely added to `lib/sheet.js` alongside `normalizeSheetRows`). Must
  produce the same `{ name, pkg, tu, eq, ex, notes, cfpb }` shape, including
  a JSON-equivalent of `countFiledRounds` (count non-blank round-date fields)
  so `parseBureauCell`'s no-explicit-digit fallback (e.g. `"Resolved"`) still
  resolves to a real round number instead of always defaulting to 1.
- [ ] **Task 3: Date sanitizer.** Real payload has malformed dates
  (`"12/22 antonette"`, `"07/15.2025"`, `"01/30/2026 Mber"`, trailing `\r`).
  Needs a permissive parser that extracts a usable date where possible and
  otherwise stores the raw string untouched (matches the existing
  `filed_date_raw` TEXT column pattern already in `production_cfpb_logins`
  — `filed_date` DATE is nullable, so a garbage string can go to
  `filed_date_raw` only, leaving `filed_date` null rather than crashing on
  an invalid date literal).
- [ ] **Task 4: Identity-matching rule finalized against real field names**
  (which field is the stable key — name only, given no GHL id per the user;
  exact `reconcileSheet` call signature). This becomes Hard Stop #2.
- [ ] **Task 5: The route itself** (`POST /webhooks/sheet-sync` in server.js,
  modeled on `/webhooks/mfsn` for the secret check, on
  `/api/production/sheet-sync`'s `apply` block for the write path).
- [ ] **Task 6: Encryption guard** (Finding 3) implemented in the route
  handler before calling into `dealProd`.
- [ ] **Task 7: Self-test + Supabase MCP verification** — fire a real test
  call, confirm rows in `clients`/`production_records`/
  `production_bureau_status`/`production_cfpb_logins`/`production_notes`,
  confirm CFPB passwords decrypt correctly via `appCrypto.decrypt`, confirm a
  byte-identical re-fired payload produces zero new/duplicate rows.
- [ ] **Task 8: Update CLAUDE.md** (per user's opening instruction) —
  document the new webhook alongside the other four in the "External
  services" table and the auth-model webhook list, once the endpoint name
  and behavior are final.
