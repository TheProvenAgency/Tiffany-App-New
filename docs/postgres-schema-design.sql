-- =============================================================================
-- MSFS Dashboard — Postgres/Supabase schema
-- =============================================================================
-- STATUS: APPLIED to the connected Supabase project via 13 sequential
-- mcp__supabase__apply_migration calls (migration names: extensions_and_helpers,
-- users_and_clients, app_settings, payments_disputes_sms, production_core,
-- client_notes, tasks_and_notes, notifications, dashboard_layouts_and_worked_status,
-- support_tickets, affiliate_and_mfsn, follower_snapshots, advisor_fixes).
-- All 27 tables verified present via list_tables; get_advisors (security +
-- performance) run after and came back clean of every non-INFO finding after
-- the advisor_fixes migration (fixed: mutable search_path on set_updated_at,
-- and 3 FK columns that were missed on the first pass -- see that migration).
-- Remaining INFO-level advisor notices are expected and by design: RLS-enabled-
-- with-no-policy on every table (intentional -- see decision 6 below) and
-- unused-index (every table has 0 rows so far, nothing has queried them yet).
--
-- lib/store.js has NOT been rewritten yet -- the app still reads/writes the
-- flat JSON files. This file is now the live schema definition; the migration
-- + lib/store.js rewrite are the next phase, not yet started.
--
-- This file was kept in sync with two fixes made live but not in the
-- original draft:
--   - payments: added `sale_local_date date not null` (app-supplied, mirrors
--     server.js's localDay() helper) because the original design's
--     `(sale_at::date)` functional index failed at apply time -- Postgres
--     rejected it with "functions in index expression must be marked
--     IMMUTABLE" (a timestamptz->date cast depends on session timezone, so
--     it can't back an index directly). A plain stored column sidesteps
--     that entirely and is arguably more correct anyway, since "same day"
--     for this business means BIZ_TZ-local day, not a UTC or session-TZ cast.
--   - set_updated_at(): pinned `search_path = pg_catalog, public` per the
--     Supabase security advisor (function_search_path_mutable) -- prevents
--     the function's unqualified `now()` call from being hijacked by a
--     session-level search_path change.
--   - 3 missed FK indexes added: affiliate_overrides.set_by_user_id,
--     notifications.client_id, task_notes.author_user_id.
--
-- Grounded in real, freshly-sampled data (not memory/assumption) as of this
-- session:
--   - MSF CREDIT CLIENTS - Credit Repair.csv, re-parsed with lib/sheet.js's own
--     parser: 3,641 normalized rows, 20 duplicate names (40 rows), bureau
--     status enum confirmed as exactly {done, login, none, ready}, CFPB rounds
--     per row range 0-11, 8,285 non-blank CFPB password cells, 310 distinct
--     package strings, one CFPB "email" cell confirmed to sometimes hold a
--     free-text status note instead of an email ("confirmed disputes and
--     portal message") -- that column cannot be typed/validated as email.
--   - seed/production-seed.json: 3,578 records, stage enum confirmed as
--     exactly {Completed, In rounds, Onboarding, Ready}, docs checklist
--     confirmed as a fixed 8-key set on every record, ids are 'C1000'..'C4577'
--     but NOT guaranteed to stay that shape going forward (server.js's sheet
--     sync creates new records as 'S' + ghlId -- legacy_id must be free text).
--   - 5 real webhook payloads supplied by the user: 2 match the app's actual
--     /webhooks/fanbasis parser field-for-field; 1 matches /webhooks/disputefox
--     field-for-field (and proved `round` really is null in practice, not just
--     theoretically); 1 is Fanbasis's native raw shape (proved DIFFERENT field
--     names than what /webhooks/fanbasis reads today -- total_amount vs
--     amount, product_title vs product -- confirming this payload is bound for
--     the separate Fanbasis->GHL Zap, not this app, today); 1 is a raw GHL task
--     object, out of scope until GHL access exists per the user's instruction.
--   - lib/store.js read in full: every JSON file's real shape, read/write
--     functions, and the WHY comments already in the code.
--
-- GHL fields are deliberately NOT modeled beyond a placeholder linkage column
-- (clients.ghl_contact_id) -- to be filled in once GHL API access exists, per
-- explicit instruction to defer that.
-- =============================================================================

create extension if not exists citext;   -- case-insensitive email comparisons without lower() everywhere
create extension if not exists pgcrypto; -- gen_random_uuid() where used below

-- -----------------------------------------------------------------------------
-- Cross-cutting decisions (apply throughout, not repeated per table):
--
-- 1. PRIMARY KEYS: `bigint generated always as identity`, not random uuid v4
--    (avoids index fragmentation on a single-writer, single-database app --
--    see schema-primary-keys best practice) and not `serial` (identity is the
--    SQL-standard form). Where the CURRENT app already hands out a public-ish
--    id (production.json's "C1000" style), that's preserved as a separate
--    `legacy_id text unique` column, not repurposed as the primary key --
--    those ids are not guaranteed unique/stable going forward (see above).
--
-- 2. TEXT vs VARCHAR: `text` everywhere, no arbitrary length caps -- matches
--    the real data (e.g. 310 distinct free-text package strings of varying
--    length; imposing a length limit here would be a made-up constraint with
--    no basis in the source data).
--
-- 3. TIMESTAMPTZ, not TIMESTAMP: every point-in-time column. The one
--    exception is follower_snapshots.snapshot_date, which really is a bare
--    calendar date in the source (store.js: `date: 'YYYY-MM-DD'`).
--
-- 4. MONEY: `numeric(10,2)`, never float -- exact decimal arithmetic for
--    real dollar amounts.
--
-- 5. ENUMS AS CHECK CONSTRAINTS, not native Postgres ENUM types: every enum
--    below (stage, bureau status, role, etc.) is backed by real, fully-
--    enumerated values from the sampled data. CHECK is used instead of
--    CREATE TYPE ... AS ENUM specifically because this business's own values
--    already drifted once (285 unrecognized bureau-status free-text values
--    exist in the CSV, per an earlier pass) -- a CHECK constraint can be
--    altered in one DDL statement if a new legitimate value shows up; a
--    native enum type requires more ceremony (ALTER TYPE ... ADD VALUE
--    outside a transaction block, in older Postgres).
--
-- 6. ROW LEVEL SECURITY: this is a single-tenant internal app, not a
--    multi-tenant SaaS product -- the real access boundary is (and stays)
--    server-side in lib/auth.js's deny-by-default role gate, enforced by the
--    Node process, not per-row Postgres policies keyed to a Supabase Auth
--    user. lib/store.js's eventual Postgres client should connect as a
--    dedicated, non-superuser app role (see security-privileges best
--    practice) that is granted BYPASSRLS -- equivalent in spirit to
--    Supabase's own `service_role`. Every table below still gets
--    `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` with zero
--    policies defined: this is a defense-in-depth backstop so that if
--    PostgREST/the Supabase Data API is ever turned on for this project
--    (accidentally or later, on purpose), the default-exposed `anon` and
--    `authenticated` roles see ZERO rows in ANY table, full stop, unless
--    someone deliberately adds a policy later. The app's own role bypasses
--    this entirely and is unaffected.
--
-- 7. FOREIGN KEYS: every FK column below is explicitly indexed (Postgres
--    does not do this automatically) -- see the CREATE INDEX statements
--    grouped at the end of each table's block.
-- -----------------------------------------------------------------------------

-- generic "touch updated_at on write" trigger, reused by the few tables where
-- rows are genuinely mutated in place after creation (not append-only logs)
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
alter function set_updated_at() set search_path = pg_catalog, public; -- Supabase advisor: function_search_path_mutable


-- =============================================================================
-- 1. USERS
-- =============================================================================
-- Currently `cfg.users`, an array embedded inside config.json. Pulled out to
-- its own table because nearly everything else below (notes, tasks, tickets,
-- notifications, dashboard layouts) foreign-keys to a user as author/assignee
-- -- that's not expressible against a JSON blob.
create table users (
  id                  bigint generated always as identity primary key,
  username            citext not null unique,       -- login is case-insensitive today (lib/auth.js authenticate() does an exact find; citext makes that safe against case drift)
  name                text not null,
  role                text not null check (role in ('admin', 'employee')),
  password_hash       text not null,                 -- scrypt hex digest, as produced by lib/auth.js hashPassword() -- unchanged, just relocated
  password_salt       text not null,
  must_set_password   boolean not null default false, -- true for an admin-invited user who hasn't picked their own password yet
  disabled            boolean not null default false,
  sso_only            boolean not null default false, -- provisioned via Proven Agency SSO; never authenticates via the password form (lib/auth.js authenticate())
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_users_updated_at before update on users
  for each row execute function set_updated_at();
alter table users enable row level security;
alter table users force row level security;


-- =============================================================================
-- 2. CLIENTS -- the stable internal identity anchor
-- =============================================================================
-- THE central open question from Step 3: neither the CSV nor
-- production-seed.json carries an email at all, and 20 real names repeat
-- across 40 CSV rows -- name alone is not a safe unique key. Meanwhile the
-- REAL webhook payloads supplied this session DO carry a reliable email
-- (Fanbasis, DisputeFox both send `email`). So: email becomes the join key
-- for anything that arrives via webhook; CSV/production-only clients get a
-- client row with primary_email left null and are linked by best-effort name
-- match (exactly what lib/sheet.js's bestGhlMatch() already does at the
-- application layer today, and continues to do at migration time -- this
-- schema does not silently invent a match constraint that the app's own
-- matching logic doesn't actually guarantee).
--
-- ghl_contact_id is a placeholder for when GHL access exists (explicitly
-- deferred by the user this session) -- nullable, unique when present, no
-- other column depends on it, so backfilling it later needs zero schema
-- changes.
create table clients (
  id                  bigint generated always as identity primary key,
  ghl_contact_id      text unique,                    -- null until GHL is wired in; deferred per instruction
  primary_email       citext,                          -- null for CSV-only clients with no known email yet
  display_name        text not null,                   -- explicitly NOT unique -- 20 real duplicate names confirmed in the CSV
  phone               text,
  status              text check (status in ('active', 'inactive')), -- null = unknown until a GHL `status:` tag or a payment/status event establishes it
  source               text not null check (source in ('csv_import', 'webhook', 'manual')), -- how this row first came to exist; 'ghl' added once that integration lands
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_clients_updated_at before update on clients
  for each row execute function set_updated_at();
-- email is a real, enforceable unique key ONLY when known -- a partial index
-- (not a plain UNIQUE column constraint) is what lets many null-email rows
-- coexist while still rejecting two rows claiming the same real email.
create unique index clients_primary_email_uidx on clients (primary_email) where primary_email is not null;
create index clients_display_name_idx on clients (display_name); -- best-effort name matching during migration/reconciliation
alter table clients enable row level security;
alter table clients force row level security;


-- =============================================================================
-- 3. APP SETTINGS -- config.json, minus the users array (see table 1) and
--    minus anything that's a real credential (see the flag below)
-- =============================================================================
-- FLAGGED, not just migrated as-is: config.json today stores the GHL token,
-- Meta token, and webhook secret in the clear, on disk. Moving that same
-- plaintext into a Postgres table is not actually a security improvement --
-- it just changes which flat store the secret sits in. Two real fixes exist:
-- (a) keep credentials out of Postgres entirely and use Render/host env vars
-- or a secrets manager (Supabase Vault), with this table holding only the
-- genuinely non-secret settings; or (b) keep them here but encrypted at the
-- application layer before the INSERT (same pattern recommended below for
-- CFPB passwords) so Postgres only ever holds ciphertext. This DDL ships
-- with (b) so a straight migration from config.json is still possible
-- without inventing a new deployment step, but (a) is the stronger fix if
-- there's room to also update how Render is configured.
create table app_settings (
  id                     boolean primary key default true check (id), -- singleton-table pattern: exactly one row, enforced by the PK
  ghl_token_encrypted    bytea,                        -- app-layer AES-GCM ciphertext; see appPassword note below for why encryption lives in the app, not pgcrypto
  ghl_location_id        text,                          -- not a secret -- an account identifier, same treatment as today's UI (server.js mask() only masks the token, not the Location ID)
  meta_page_token_encrypted bytea,
  fb_page_id             text,
  ig_user_id             text,
  ig_handle              text not null default 'msfinancialsolutions_',
  fb_page_url            text not null default 'https://www.facebook.com/tiffany.kiara.9',
  webhook_secret_encrypted bytea,
  updated_at             timestamptz not null default now()
);
create trigger trg_app_settings_updated_at before update on app_settings
  for each row execute function set_updated_at();
alter table app_settings enable row level security;
alter table app_settings force row level security;


-- =============================================================================
-- 4. PAYMENTS -- Fanbasis / Commas
-- =============================================================================
-- Superset schema per your call: required columns match exactly what
-- /webhooks/fanbasis reads today (server.js handlePaymentWebhook); the rich
-- columns are nullable and populated only if/when the raw native-Fanbasis
-- Zap (payload 5's shape) ever gets pointed at this app directly instead of
-- (or in addition to) the GHL-bound one.
create table payments (
  id                  bigint generated always as identity primary key,
  client_id           bigint references clients (id), -- null until matched; matching by email happens at ingest time, same as today's ensureClientFromPayment()
  webhook_route       text not null check (webhook_route in ('fanbasis', 'commas')), -- which URL actually received this call; the two are one handler in code today but the source is worth keeping
  email                citext not null,                -- always present on every real sample; the raw fact, independent of whether client matching succeeded
  name                text not null default '',
  phone               text,
  amount              numeric(10,2) not null,
  product             text,
  sale_at             timestamptz not null,
  sale_local_date     date not null,                   -- app-supplied business-local day (mirrors server.js localDay()) -- see status note at top of file for why this exists instead of a functional index on sale_at::date
  -- -- superset / rich fields, nullable, from the raw native-Fanbasis shape --
  fanbasis_sale_id    text,                            -- payload 5's `sale_id` -- a real, strong dedup key when present; far better than the email+amount+day heuristic used below
  product_id          text,
  discount_code       text,
  payment_method      text,                             -- e.g. 'apple_pay'
  payment_mode        text,                             -- e.g. 'Payment Link'
  creator_earnings    numeric(10,2),                    -- net payout, distinct from `amount`
  received_at         timestamptz not null default now()
);
create index payments_client_id_idx on payments (client_id);
create index payments_sale_at_idx on payments (sale_at);         -- the dashboard's whole KPI system is date-range filtering
create index payments_email_idx on payments (email);
-- strong dedup key when Fanbasis's own id is available
create unique index payments_fanbasis_sale_id_uidx on payments (fanbasis_sale_id) where fanbasis_sale_id is not null;
-- fallback dedup, matching today's actual in-code heuristic (email + amount + same calendar day) for rows with no sale_id
create index payments_dedupe_fallback_idx on payments (email, amount, sale_local_date) where fanbasis_sale_id is null;
alter table payments enable row level security;
alter table payments force row level security;


-- =============================================================================
-- 5. DISPUTES -- DisputeFox activity events
-- =============================================================================
-- Deliberately its own typed table, not folded into a generic `events` blob
-- like today's single events.json -- amount/round only make sense for
-- specific event types, and the whole Dashboard's KPI/chart logic already
-- queries this data by type; a normalized table is the one place this DDL
-- actively diverges from a literal 1:1 JSON-file mapping.
create table disputes (
  id                  bigint generated always as identity primary key,
  client_id           bigint references clients (id),
  email                citext not null,
  name                text not null default '',
  round_number        integer,                          -- confirmed nullable by a real sample (action=report_imported, no round at all)
  action              text not null default 'dispute_sent',
  event_at            timestamptz not null,              -- falls back to received_at's value at ingest when the payload has no date, same as today's code
  received_at         timestamptz not null default now()
);
create index disputes_client_id_idx on disputes (client_id);
create index disputes_event_at_idx on disputes (event_at);
create index disputes_email_idx on disputes (email);
alter table disputes enable row level security;
alter table disputes force row level security;


-- =============================================================================
-- 6. SMS EVENTS -- /webhooks/sms
-- =============================================================================
create table sms_events (
  id                  bigint generated always as identity primary key,
  client_id           bigint references clients (id),   -- no email/name in this webhook's payload today (server.js: only direction + phone) -- matched by phone if ever, left null otherwise
  direction           text not null check (direction in ('in', 'out')),
  phone               text,
  event_at            timestamptz not null,
  received_at         timestamptz not null default now()
);
create index sms_events_client_id_idx on sms_events (client_id);
create index sms_events_event_at_idx on sms_events (event_at);
alter table sms_events enable row level security;
alter table sms_events force row level security;


-- =============================================================================
-- 7. PRODUCTION RECORDS -- Deal Production (production.json / seed)
-- =============================================================================
create table production_records (
  id                  bigint generated always as identity primary key,
  legacy_id           text not null unique,             -- preserves today's "C1000" / "S<ghlId>" ids -- free text, NOT assumed numeric-suffix (sheet-sync already creates the second shape)
  client_id           bigint references clients (id),   -- nullable: bestGhlMatch() already refuses to guess on an ambiguous name match, and this schema must not force a guess either
  stage               text not null check (stage in ('Onboarding', 'Ready', 'In rounds', 'Completed')),
  package             text,                              -- 310 distinct free-text values in the real data -- not an enum
  days_in_program     integer,
  ownership            text,                              -- "va" in today's JSON; admin-only reassignment field
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_production_records_updated_at before update on production_records
  for each row execute function set_updated_at();
create index production_records_client_id_idx on production_records (client_id);
create index production_records_stage_idx on production_records (stage);
alter table production_records enable row level security;
alter table production_records force row level security;

-- One row per (production record, bureau) instead of three JSON blobs --
-- makes "how many clients have TU done" a real indexed query, and matches
-- the app's own access pattern of patching tu/eq/ex independently.
create table production_bureau_status (
  id                  bigint generated always as identity primary key,
  production_record_id bigint not null references production_records (id) on delete cascade,
  bureau              text not null check (bureau in ('TU', 'EQ', 'EX')),
  round_number        integer,                           -- which round last touched this bureau; confirmed nullable/varies (sample values 4, 6, ...)
  status              text not null check (status in ('done', 'login', 'none', 'ready')), -- confirmed exhaustive across the real CSV; 'done'=resolved/completed, 'ready'=filed & awaiting, 'login'=ready to log in to the portal, 'none'=not started or unrecognized text
  raw_text            text,                              -- original free-text cell (e.g. "Resolved") -- preserved for audit/re-parse if the mapping rules ever change
  unrecognized         boolean not null default false,    -- true when raw_text didn't match any known pattern and was defaulted to 'none' (285 such rows exist in the current CSV)
  updated_at          timestamptz not null default now()
);
create unique index production_bureau_status_uidx on production_bureau_status (production_record_id, bureau);
create index production_bureau_status_record_idx on production_bureau_status (production_record_id);
alter table production_bureau_status enable row level security;
alter table production_bureau_status force row level security;

-- The 8-key document checklist. Kept as fixed boolean columns, not a
-- key-value child table: the real data confirms every record carries
-- exactly this same closed set of 8 keys, with no observed exceptions --
-- normalizing a fixed, non-extensible checklist into rows would just add a
-- join for no real flexibility gained.
create table production_documents (
  production_record_id bigint primary key references production_records (id) on delete cascade,
  ssc                 boolean not null default false,
  dl                  boolean not null default false,
  poa                 boolean not null default false,
  ftc                 boolean not null default false,
  data_breach         boolean not null default false,
  affidavit           boolean not null default false,
  perm_purpose        boolean not null default false,
  experian_letter     boolean not null default false,
  updated_at          timestamptz not null default now()
);
create trigger trg_production_documents_updated_at before update on production_documents
  for each row execute function set_updated_at();
alter table production_documents enable row level security;
alter table production_documents force row level security;

-- Per-round CFPB portal logins. FLAGGED finding, resolved below: the sheet's
-- "email" column for a CFPB round sometimes holds a free-text status note
-- instead of an actual email address (confirmed real sample: "confirmed
-- disputes and portal message") -- it cannot be typed/validated as an email
-- column. Named honestly instead of implying a guarantee the data doesn't
-- have.
--
-- SECOND FLAGGED finding, resolved below: 8,285 non-blank plaintext CFPB
-- passwords exist in the real CSV. This is the open question from the
-- earlier session, now given a concrete answer: encrypt at the APPLICATION
-- layer (Node's built-in crypto, AES-256-GCM, key from an env var -- the
-- same pattern lib/auth.js already uses for SSO_SHARED_SECRET/HMAC secrets,
-- not a new pattern) before the value ever reaches a SQL statement, and
-- store only ciphertext here. This keeps the encryption key out of Postgres
-- entirely -- a Supabase project-level compromise alone can't decrypt these.
-- Decryption happens only in the Node process when staff actually need to
-- log into a CFPB portal.
create table production_cfpb_logins (
  id                  bigint generated always as identity primary key,
  production_record_id bigint not null references production_records (id) on delete cascade,
  round_number        integer not null check (round_number > 0),
  filed_date_raw       text,                              -- exactly what's in the sheet cell -- formats are confirmed inconsistent, don't force a cast
  filed_date           date,                               -- best-effort parse of filed_date_raw, null when unparseable; populated by the migration script, not by a DB-level cast
  portal_login_or_note text,                                -- honestly named: sometimes a real email, sometimes a status note (see flag above)
  portal_password_encrypted bytea,                          -- app-layer AES-256-GCM ciphertext; see flag above
  updated_at          timestamptz not null default now()
);
create unique index production_cfpb_logins_uidx on production_cfpb_logins (production_record_id, round_number);
create index production_cfpb_logins_record_idx on production_cfpb_logins (production_record_id);
alter table production_cfpb_logins enable row level security;
alter table production_cfpb_logins force row level security;

-- Deal Production's OWN notes thread -- distinct from client_notes (table 12)
-- below, which is a separate system in the current app (Clients/GHL drawer
-- notes, with @mentions). Append-only: matches the app's `note` (singular,
-- add-one) field on PATCH /api/production/:id, never a rewritable array, so
-- one employee can't delete/forge a colleague's note.
create table production_notes (
  id                  bigint generated always as identity primary key,
  production_record_id bigint not null references production_records (id) on delete cascade,
  author_user_id       bigint references users (id),      -- null for notes migrated from the sheet (author was literally "Sheet", not a real user)
  author_label         text,                                -- preserves "Sheet" or any pre-migration author string that isn't a real users row
  body                text not null,
  created_at          timestamptz not null default now()
);
create index production_notes_record_idx on production_notes (production_record_id);
create index production_notes_author_idx on production_notes (author_user_id);
alter table production_notes enable row level security;
alter table production_notes force row level security;


-- =============================================================================
-- 8. CLIENT NOTES -- the separate Clients/GHL-drawer notes system
--    (store.js notes.json), with @mention support
-- =============================================================================
create table client_notes (
  id                  bigint generated always as identity primary key,
  client_id           bigint not null references clients (id) on delete cascade,
  author_user_id       bigint references users (id),
  body                text not null,
  created_at          timestamptz not null default now()
);
create index client_notes_client_idx on client_notes (client_id);
create index client_notes_author_idx on client_notes (author_user_id);
alter table client_notes enable row level security;
alter table client_notes force row level security;

-- Mentions as a real join table (not an array column) so a mention is a
-- real, indexed, FK-enforced reference to a users row -- matches how
-- notifications (table 15) needs to query "everything I was mentioned in."
create table client_note_mentions (
  client_note_id       bigint not null references client_notes (id) on delete cascade,
  user_id             bigint not null references users (id) on delete cascade,
  primary key (client_note_id, user_id)
);
create index client_note_mentions_user_idx on client_note_mentions (user_id);
alter table client_note_mentions enable row level security;
alter table client_note_mentions force row level security;


-- =============================================================================
-- 9. TASKS -- Follow-Ups (shared team to-do list, not per-user scoped)
-- =============================================================================
create table tasks (
  id                  bigint generated always as identity primary key,
  title               text not null,
  client_id           bigint references clients (id),
  due_at              timestamptz,
  is_done             boolean not null default false,
  done_at             timestamptz,
  description         text,                                -- the original free-text description set at creation -- distinct from the task_notes thread below
  assigned_to_user_id  bigint references users (id),
  created_by_user_id   bigint references users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_tasks_updated_at before update on tasks
  for each row execute function set_updated_at();
create index tasks_client_idx on tasks (client_id);
create index tasks_assigned_to_idx on tasks (assigned_to_user_id);
create index tasks_created_by_idx on tasks (created_by_user_id);
alter table tasks enable row level security;
alter table tasks force row level security;

create table task_mentions (
  task_id             bigint not null references tasks (id) on delete cascade,
  user_id             bigint not null references users (id) on delete cascade,
  primary key (task_id, user_id)
);
create index task_mentions_user_idx on task_mentions (user_id);
alter table task_mentions enable row level security;
alter table task_mentions force row level security;

-- A thread of notes ON a task -- distinct from tasks.description above,
-- same append-only-with-real-author reasoning as production_notes.
create table task_notes (
  id                  bigint generated always as identity primary key,
  task_id             bigint not null references tasks (id) on delete cascade,
  author_user_id       bigint references users (id),
  body                text not null,
  created_at          timestamptz not null default now()
);
create index task_notes_task_idx on task_notes (task_id);
create index task_notes_author_user_id_idx on task_notes (author_user_id);
alter table task_notes enable row level security;
alter table task_notes force row level security;

create table task_note_mentions (
  task_note_id         bigint not null references task_notes (id) on delete cascade,
  user_id             bigint not null references users (id) on delete cascade,
  primary key (task_note_id, user_id)
);
create index task_note_mentions_user_idx on task_note_mentions (user_id);
alter table task_note_mentions enable row level security;
alter table task_note_mentions force row level security;


-- =============================================================================
-- 10. NOTIFICATIONS -- in-app bell (task assignment / @mention)
-- =============================================================================
-- Today's notifications.json uses a polymorphic {refType, refId} pair
-- (refType is 'task' or 'note', refId is an id in whichever table). Modeled
-- here as two separate NULLABLE real foreign keys instead, with a CHECK that
-- exactly one is set -- this keeps genuine FK integrity (a bad refId can't
-- silently point at nothing) instead of a soft, app-trusted reference.
create table notifications (
  id                  bigint generated always as identity primary key,
  user_id             bigint not null references users (id) on delete cascade,
  type                text not null check (type in ('assigned', 'mention')),
  task_id             bigint references tasks (id) on delete cascade,
  client_note_id       bigint references client_notes (id) on delete cascade,
  client_id           bigint references clients (id),
  body                text not null,
  from_name           text not null,
  is_read             boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint notifications_exactly_one_ref check (
    (task_id is not null)::int + (client_note_id is not null)::int = 1
  )
);
create index notifications_user_idx on notifications (user_id, is_read);
create index notifications_task_idx on notifications (task_id);
create index notifications_client_note_idx on notifications (client_note_id);
create index notifications_client_id_idx on notifications (client_id);
alter table notifications enable row level security;
alter table notifications force row level security;


-- =============================================================================
-- 11. DASHBOARD LAYOUTS -- per-user, plus one site-wide default row
-- =============================================================================
-- order/sizes stay jsonb deliberately: this is genuinely document-shaped,
-- per-user UI state that nothing else in the schema ever needs to join
-- against or query by widget -- normalizing it into rows would add
-- complexity with no real query benefit.
create table dashboard_layouts (
  id                  bigint generated always as identity primary key,
  user_id             bigint references users (id) on delete cascade, -- null = the site-wide default row
  is_default          boolean not null default false,
  widget_order        jsonb not null default '[]'::jsonb,
  widget_sizes        jsonb not null default '{}'::jsonb,
  updated_at          timestamptz not null default now()
);
create trigger trg_dashboard_layouts_updated_at before update on dashboard_layouts
  for each row execute function set_updated_at();
-- one personal layout per real user...
create unique index dashboard_layouts_user_uidx on dashboard_layouts (user_id) where user_id is not null;
-- ...and at most one default row
create unique index dashboard_layouts_default_uidx on dashboard_layouts ((true)) where is_default;
alter table dashboard_layouts enable row level security;
alter table dashboard_layouts force row level security;


-- =============================================================================
-- 12. WORKED STATUS -- reactivation queue
-- =============================================================================
create table worked_status (
  client_id           bigint primary key references clients (id) on delete cascade,
  worked_at           timestamptz not null default now(),
  worked_by           text,
  outcome             text
);
alter table worked_status enable row level security;
alter table worked_status force row level security;


-- =============================================================================
-- 13. SUPPORT TICKETS -- local audit copy of OUTBOUND submissions only
-- =============================================================================
-- Important distinction confirmed from the code: GET /api/support-tickets
-- syncs the LIVE queue from Proven Agency's own external dashboard -- this
-- table is only ever a fallback audit trail of what this app tried to send,
-- not a mirror of the real ticket system. ticket_views (below) tracks read
-- state against Proven's OWN external ticket ids, which don't correspond to
-- rows in this table at all -- there is no FK to be had there, by design of
-- the actual system, not an oversight.
create table support_tickets (
  id                  bigint generated always as identity primary key,
  subject             text not null,
  message             text not null,
  submitted_by_user_id bigint references users (id),
  submitted_by_role    text,
  forwarded            boolean not null default false,
  forward_error        text,
  created_at          timestamptz not null default now()
);
create index support_tickets_submitted_by_idx on support_tickets (submitted_by_user_id);
alter table support_tickets enable row level security;
alter table support_tickets force row level security;

create table ticket_views (
  user_id              bigint not null references users (id) on delete cascade,
  external_ticket_id   text not null,                     -- Proven Agency's own id -- no FK possible; that system is authoritative for this id space, not this database
  viewed_at            timestamptz not null default now(),
  primary key (user_id, external_ticket_id)
);
alter table ticket_views enable row level security;
alter table ticket_views force row level security;


-- =============================================================================
-- 14. AFFILIATE OVERRIDES -- manual per-client MFSN status override
-- =============================================================================
create table affiliate_overrides (
  client_id           bigint primary key references clients (id) on delete cascade,
  status               text not null check (status in ('affiliate', 'not_affiliate', 'not_on_mfsn')),
  set_by_user_id        bigint references users (id),
  set_at               timestamptz not null default now()
);
create index affiliate_overrides_set_by_user_id_idx on affiliate_overrides (set_by_user_id);
alter table affiliate_overrides enable row level security;
alter table affiliate_overrides force row level security;


-- =============================================================================
-- 15. MFSN MEMBERS -- affiliate enrollment snapshot
-- =============================================================================
-- Matches lib/affiliate.js normalizeMembers()'s real output shape exactly:
-- {email, name, hasAffiliateCode, planAmount}. This is a snapshot-replace
-- feed (a `members` array REPLACES the whole set on each sync, per the
-- webhook handler) -- modeled as a plain table that gets truncated + reloaded
-- on each full sync, not an append-only log, matching the real semantics.
create table mfsn_members (
  id                  bigint generated always as identity primary key,
  email                citext,
  name                text,
  has_affiliate_code    boolean not null default false,
  plan_amount          numeric(10,2),
  synced_at            timestamptz not null default now()
);
create index mfsn_members_email_idx on mfsn_members (email);
create index mfsn_members_name_idx on mfsn_members (name);
alter table mfsn_members enable row level security;
alter table mfsn_members force row level security;

-- store.js's mfsn_meta.json (`{syncedAt}`) -- one row, last-full-sync marker
create table mfsn_sync_meta (
  id                  boolean primary key default true check (id),
  synced_at            timestamptz
);
alter table mfsn_sync_meta enable row level security;
alter table mfsn_sync_meta force row level security;

-- "Old vs New member" manual audit. DELIBERATE deviation from a literal
-- overwrite-in-place mirror of mfsn_old_status.json: that file only ever
-- holds the latest audit and loses history on every re-audit. An
-- append-only log costs nothing extra in Postgres and lets "how has the Old
-- membership count trended" become an answerable question later -- the
-- current value is just "most recent row by audited_at."
create table mfsn_audit_snapshots (
  id                  bigint generated always as identity primary key,
  active               integer not null,
  active_total         integer not null,
  paused               integer not null,
  relinking            integer not null,
  audited_at           timestamptz not null default now()
);
alter table mfsn_audit_snapshots enable row level security;
alter table mfsn_audit_snapshots force row level security;


-- =============================================================================
-- 16. FOLLOWER SNAPSHOTS -- IG/FB growth chart
-- =============================================================================
create table follower_snapshots (
  snapshot_date        date primary key,                  -- genuinely a bare date in the source ('YYYY-MM-DD'), not a timestamp
  ig_followers          integer,
  fb_followers          integer,
  active_clients        integer,
  inactive_clients      integer,
  total_clients         integer
);
alter table follower_snapshots enable row level security;
alter table follower_snapshots force row level security;


-- =============================================================================
-- DATA INTEGRITY ISSUES TO RESOLVE BEFORE MIGRATION (not schema problems --
-- real source-data facts a migration script must handle explicitly)
-- =============================================================================
-- 1. 20 duplicate names / 40 rows in the CSV, with no email to disambiguate.
--    A migration script must either (a) create 40 distinct `clients` rows
--    with null primary_email and accept the ambiguity, same as the app does
--    today via bestGhlMatch()'s refusal to guess, or (b) get a human
--    (Tiffany) to manually disambiguate the 20 names first. Recommend (a)
--    now, (b) opportunistically later -- do not block the whole migration
--    on manually resolving 40 rows.
-- 2. CFPB "email" column sometimes holds a free-text status note instead of
--    an email -- modeled as portal_login_or_note (text, unvalidated) above,
--    not silently coerced into a fake email value.
-- 3. 8,285 plaintext CFPB passwords -- resolved above via app-layer
--    encryption before insert; the migration script must NOT insert these
--    values in the clear even transiently (encrypt in the same batch job
--    that reads the CSV, before any INSERT statement is built).
-- 4. CFPB filed-date formats are confirmed inconsistent across the sheet --
--    modeled as filed_date_raw (text, always populated) + filed_date (date,
--    best-effort parse, null when the migration script can't confidently
--    parse it) rather than forcing every value through a `date` cast that
--    would hard-fail the whole migration on the first bad cell.
-- 5. 285 unrecognized bureau-status free-text values default to 'none' at
--    the application layer today (lib/sheet.js parseBureauCell) -- the
--    unrecognized flag on production_bureau_status preserves which rows
--    that happened to, so they're findable for a human review pass instead
--    of silently indistinguishable from a real "not started."
-- 6. No source of truth for GHL contact linkage yet -- clients.ghl_contact_id
--    stays null for every migrated row until that integration is connected;
--    nothing else in this schema requires it to be non-null.
-- =============================================================================
