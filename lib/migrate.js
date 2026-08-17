// Additive, idempotent schema catch-up, run once at boot.
//
// Why here rather than a one-shot script: the Supabase connection string only
// exists as a Render env var, so nobody working locally can run a migration
// against it. A boot-time migration is the only path that reliably reaches
// the deployed database -- and being idempotent, running it on every boot
// costs one cheap round trip and can't drift.
//
// Strictly additive: `if not exists` everywhere, no drops, no data rewrites.
// A migration that can destroy data has no business running unattended.
//
// What it unblocks: notifications, ticket_views and dashboard_layouts all
// need a real users.id foreign key. No users migration had ever run, so those
// three were JSON-only -- and on a host with no persistent disk that means
// they were lost on every spin-down.

const db = require('./db');

// The app's own user ids are strings it generates (uuid-ish), while the
// designed schema uses bigint identity. Rather than rewrite either, users
// carries app_user_id as the join key back to the JSON side.
const STATEMENTS = [
  `create table if not exists users (
     id                bigint generated always as identity primary key,
     app_user_id       text unique,
     username          text not null,
     name              text not null default '',
     role              text not null default 'employee',
     capabilities      jsonb,
     disabled          boolean not null default false,
     sso_only          boolean not null default false,
     created_at        timestamptz not null default now(),
     updated_at        timestamptz not null default now()
   )`,

  // The GoHighLevel roster, kept whole. Fetching 5,504 contacts is the single
  // thing that makes a cold start take ~17 seconds, and the in-memory cache
  // that normally covers it dies with the container -- which on a host that
  // spins down after ~15 min idle means it is cold almost every time someone
  // actually opens the app. One row, replaced wholesale.
  `create table if not exists client_snapshot (
     id        int primary key,
     data      jsonb not null,
     saved_at  timestamptz not null default now()
   )`,

  // Who did what. Nothing recorded this before, so the operations view could
  // only report who a client is ASSIGNED to -- ownership, not activity.
  // Deliberately append-only: a counter per person cannot be audited,
  // corrected, or asked "what happened to this client six weeks ago".
  `create table if not exists audit_log (
     id           bigint generated always as identity primary key,
     at           timestamptz not null,
     who          text not null,
     client_id    text,
     client_name  text,
     field        text not null,
     action       text not null,
     from_value   text,
     to_value     text
   )`,
  `create index if not exists audit_log_at_idx on audit_log (at desc)`,
  `create index if not exists audit_log_who_idx on audit_log (who)`,

  // Sessions. Previously sessions.json on local disk, which on Render's free
  // tier (no persistent disk, spins down after ~15 min idle) meant everyone
  // was logged out several times a day. Keyed by the opaque token itself.
  // Nothing sensitive lives here beyond the token: no password material, and
  // the token is already the bearer credential the cookie carries.
  `create table if not exists sessions (
     token       text primary key,
     app_user_id text not null,
     role        text not null default 'employee',
     preview_role text,
     via_sso     boolean not null default false,
     created_at  timestamptz not null default now()
   )`,
  `create index if not exists sessions_app_user_id_idx on sessions (app_user_id)`,

  // Pre-existing installs may have the table without this column, and its
  // role check predates the va/disputer presets.
  `alter table users add column if not exists app_user_id text`,
  `alter table users add column if not exists capabilities jsonb`,
  // The whole user record, credential hash included. The structured columns
  // above describe the account; this is what LOGIN needs back after a
  // restart. Without it the mirror was decorative: accounts were "mirrored"
  // minus the one thing that lets anyone sign in, nothing restored them at
  // boot, and every deploy or spin-down deleted every account except admin
  // (which ensureAdmin recreates from the env password). That is why a
  // freshly added team member vanished within minutes.
  `alter table users add column if not exists record jsonb`,

  // The live users table predates this migration -- it was created from an
  // earlier hand-designed schema and carries its own NOT NULL columns
  // (password_hash was the one that surfaced). Our insert doesn't fill those,
  // so every mirror write failed on the constraint, silently, forever: that is
  // the root cause under the vanishing-accounts bug, beneath the missing
  // restore and the missing record column. Relax the NOT NULLs on every
  // column this code does not supply -- the jsonb record is authoritative
  // now, and a constraint on a column nobody writes protects nothing.
  `do $$
   declare col text;
   begin
     for col in
       select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'users'
         and is_nullable = 'NO'
         and column_name not in ('id', 'username')
     loop
       execute format('alter table users alter column %I drop not null', col);
     end loop;
   end $$`,
  `create unique index if not exists users_app_user_id_uidx on users (app_user_id)`,

  `create table if not exists app_snippets (
     id                bigint generated always as identity primary key,
     snip_id           text not null unique,
     name              text not null,
     body              text not null,
     created_by        text not null default '',
     created_at        timestamptz not null default now()
   )`,

  `create table if not exists notifications (
     id                bigint generated always as identity primary key,
     user_id           bigint references users (id) on delete cascade,
     type              text not null,
     body              text not null default '',
     from_name         text not null default '',
     is_read           boolean not null default false,
     created_at        timestamptz not null default now()
   )`,

  `create table if not exists ticket_views (
     user_id            bigint not null references users (id) on delete cascade,
     external_ticket_id text not null,
     viewed_at          timestamptz not null default now(),
     primary key (user_id, external_ticket_id)
   )`,

  `create table if not exists dashboard_layouts (
     id            bigint generated always as identity primary key,
     user_id       bigint references users (id) on delete cascade,
     is_default    boolean not null default false,
     widget_order  jsonb not null default '[]'::jsonb,
     widget_sizes  jsonb not null default '{}'::jsonb,
     updated_at    timestamptz not null default now()
   )`,
  `create unique index if not exists dashboard_layouts_user_uidx
     on dashboard_layouts (user_id) where user_id is not null`,
  `create unique index if not exists dashboard_layouts_default_uidx
     on dashboard_layouts (is_default) where is_default`
];

// The users.role check constraint, if an older install created one, only
// allowed ('admin','employee') -- inserting a va or disputer would fail. Drop
// it rather than trying to redefine it, since roles are presets in
// lib/auth.js now and the database is not the place that decides which exist.
const RELAX_ROLE_CHECK = `do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'users_role_check' and conrelid = 'users'::regclass
  ) then
    alter table users drop constraint users_role_check;
  end if;
end $$`;

async function run() {
  if (!db.isEnabled()) return { skipped: true };
  const applied = [];
  const failed = [];
  for (const sql of STATEMENTS.concat([RELAX_ROLE_CHECK])) {
    try {
      await db.query(sql);
      applied.push(sql.slice(0, 60).replace(/\s+/g, ' '));
    } catch (e) {
      // One failing statement must not stop the rest, and must never stop
      // boot: the app runs fine on JSON alone.
      failed.push({ sql: sql.slice(0, 60).replace(/\s+/g, ' '), error: e.message });
    }
  }
  if (failed.length) {
    console.error(`Schema catch-up: ${applied.length} applied, ${failed.length} failed`);
    for (const f of failed) console.error('  ', f.sql, '->', f.error);
  } else {
    console.log(`Schema catch-up: ${applied.length} statements applied (idempotent)`);
  }
  return { applied: applied.length, failed };
}

module.exports = { run, STATEMENTS, RELAX_ROLE_CHECK };
