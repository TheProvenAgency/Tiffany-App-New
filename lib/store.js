// Simple JSON-file store (no native deps, survives restarts on a persistent disk).
//
// Postgres mirroring: every write function below ALSO fires a best-effort,
// un-awaited insert/update into the matching Supabase table (see
// docs/postgres-schema-design.sql). This file's exported functions stay
// fully synchronous on purpose -- server.js calls them without `await`
// throughout, so making them async would silently break every call site.
// That means the Postgres write can't be awaited before returning either:
// JSON is written and returned first, exactly as before, and the mirror
// happens in the background via mirror(). If DATABASE_URL isn't set, or the
// query fails for any reason (network, bad creds, FK violation), mirror()
// swallows it and logs -- the JSON path is completely unaffected either way.
//
// Id correlation: a JSON record's id (`Date.now()+random`) and a Postgres
// row's id (bigint identity) are generated independently and don't match.
// When a mirror insert succeeds, patchPgId() writes the resulting Postgres
// id back onto the JSON record as `.pgId`. Later update/delete functions
// look for `.pgId` on the existing record to mirror that same mutation, and
// skip Postgres cleanly if it's absent (meaning that record was never
// successfully mirrored -- most commonly because Postgres was unreachable
// at creation time, or the record predates this change).
//
// Known, deliberate gaps (not bugs): mirroring anything that requires a
// real `clients.id` or `users.id` foreign key (client_notes, worked_status,
// affiliate_overrides, notifications, ticket_views, per-user dashboard
// layouts) only works once those rows actually exist in Postgres via
// lookupClientPgId() below -- and no client/user migration has run yet, so
// today those mirrors will typically no-op. They're wired correctly so they
// start working the moment that migration happens, rather than needing a
// second pass through this file. Functions that would need a real user id
// with no lookup path available at all (addNotification,
// markNotificationRead/markAllNotificationsRead, markTicketViewed,
// setDashboardLayout/clearDashboardLayout/clearAllPersonalDashboardLayouts)
// skip Postgres entirely for now -- see each function's comment.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const appCrypto = require('./crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) { return path.join(DATA_DIR, name + '.json'); }

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); }
  catch { return fallback; }
}

function write(name, obj) {
  const tmp = file(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file(name));
}

// ---- Postgres mirror helpers ----

// Fires an already-invoked async operation without making the caller wait.
// Any failure (Postgres down, bad creds, FK violation because the
// referenced client/user hasn't been migrated yet, etc.) is logged and
// swallowed -- it must never surface to the JSON-backed caller.
//
// IMPORTANT: the promise argument has already started running by the time
// this function sees it (JS evaluates call arguments eagerly) -- so this
// must unconditionally attach a .catch(), every time, with no early return.
// An early return here (e.g. gated on db.isEnabled()) would skip attaching
// the handler to an already-in-flight promise that's about to reject,
// producing an unhandled rejection instead of a swallowed one.
function mirror(promise) {
  promise.catch(e => console.error('Postgres mirror failed (continuing with JSON only):', e.message));
}

// Patches the Postgres row id back onto a JSON record after a successful
// mirror insert, so later update/delete calls can find it again.
function patchPgId(name, jsonId, pgId) {
  const all = read(name, []);
  const i = all.findIndex(x => x.id === jsonId);
  if (i < 0) return; // record was deleted locally before the mirror insert resolved -- nothing to patch
  all[i].pgId = pgId;
  write(name, all);
}

async function lookupClientPgId(ghlContactId) {
  if (!ghlContactId) return null;
  const { rows } = await db.query('select id from clients where ghl_contact_id = $1', [String(ghlContactId)]);
  return rows[0] ? rows[0].id : null;
}

// ---- config (API keys etc.) ----
function getConfig() {
  return read('config', {
    ghlToken: '', ghlLocationId: '',
    metaPageToken: '', fbPageId: '', igUserId: '',
    igHandle: 'msfinancialsolutions_',
    fbPageUrl: 'https://www.facebook.com/tiffany.kiara.9',
    webhookSecret: '', appPassword: ''
  });
}
function setConfig(patch) {
  const cfg = { ...getConfig(), ...patch };
  write('config', cfg);
  mirror(mirrorAppSettings(cfg));
  return cfg;
}

// Postgres-primary variant of setConfig(), used ONLY by the actual GHL/
// Meta/webhook-secret Settings save (POST /api/config in server.js) --
// Supabase is the source of truth for those credentials; config.json is
// the live backup, written after. Every OTHER setConfig() call site (user
// management, SSO, invite secret -- none of which are mirrored to
// app_settings at all) keeps the original fire-and-forget setConfig()
// above unchanged: forcing an awaited Postgres round-trip onto adding a
// team member or an SSO login would add latency for zero durability
// benefit, since that data was never part of this mirror. Async on
// purpose (unlike setConfig()) -- its one call site already awaits it.
async function setConfigPrimary(patch) {
  const cfg = { ...getConfig(), ...patch };
  if (db.isEnabled()) {
    try { await mirrorAppSettings(cfg); }
    catch (e) { console.error('Postgres write failed for app_settings (JSON backup still updated):', e.message); }
  }
  write('config', cfg); // backup, written after -- always, regardless of the Postgres outcome above
  return cfg;
}

// One-time boot hydration: on a host with no persistent disk (e.g. Render's
// free tier), config.json is wiped on every restart/spin-down -- but
// getConfig() above must stay synchronous (see file header; server.js calls
// it un-awaited throughout, so making it async would silently break every
// call site). So instead of touching getConfig() itself, restore any
// missing fields from the app_settings Postgres mirror ONCE at process
// startup, before the server starts accepting requests -- by the time any
// route runs, config.json already has what Postgres has. Never overwrites a
// field that's already present locally (e.g. a host that DOES have a disk,
// or this running mid-process after a real save).
async function hydrateConfigFromPostgres() {
  if (!db.isEnabled()) return;
  const cfg = getConfig();
  if (cfg.ghlToken && cfg.ghlLocationId && cfg.webhookSecret) return; // nothing missing, skip the query
  try {
    const { rows } = await db.query('select * from app_settings where id = true');
    const row = rows[0];
    if (!row) return;
    const patch = {};
    if (!cfg.ghlLocationId && row.ghl_location_id) patch.ghlLocationId = row.ghl_location_id;
    if (!cfg.fbPageId && row.fb_page_id) patch.fbPageId = row.fb_page_id;
    if (!cfg.igUserId && row.ig_user_id) patch.igUserId = row.ig_user_id;
    if (!cfg.igHandle && row.ig_handle) patch.igHandle = row.ig_handle;
    if (!cfg.fbPageUrl && row.fb_page_url) patch.fbPageUrl = row.fb_page_url;
    if (appCrypto.isEnabled()) {
      if (!cfg.ghlToken && row.ghl_token_encrypted) {
        try { patch.ghlToken = appCrypto.decrypt(row.ghl_token_encrypted); } catch (e) { /* key mismatch/corrupt -- skip, don't block boot */ }
      }
      if (!cfg.metaPageToken && row.meta_page_token_encrypted) {
        try { patch.metaPageToken = appCrypto.decrypt(row.meta_page_token_encrypted); } catch (e) {}
      }
      if (!cfg.webhookSecret && row.webhook_secret_encrypted) {
        try { patch.webhookSecret = appCrypto.decrypt(row.webhook_secret_encrypted); } catch (e) {}
      }
    }
    if (Object.keys(patch).length) {
      write('config', { ...cfg, ...patch });
      console.log('Restored app config from Postgres (local config.json was empty -- likely an ephemeral-disk restart)');
    }
  } catch (e) {
    console.error('Config hydration from Postgres failed (continuing with local/default config):', e.message);
  }
}
async function mirrorAppSettings(cfg) {
  // Secrets only get mirrored once APP_ENCRYPTION_KEY is configured --
  // never write plaintext into a Postgres *_encrypted column. Non-secret
  // fields (Location ID, ig handle, fb page url) mirror regardless.
  const encFields = appCrypto.isEnabled()
    ? {
        ghl_token_encrypted: cfg.ghlToken ? appCrypto.encrypt(cfg.ghlToken) : null,
        meta_page_token_encrypted: cfg.metaPageToken ? appCrypto.encrypt(cfg.metaPageToken) : null,
        webhook_secret_encrypted: cfg.webhookSecret ? appCrypto.encrypt(cfg.webhookSecret) : null
      }
    : { ghl_token_encrypted: null, meta_page_token_encrypted: null, webhook_secret_encrypted: null };
  await db.query(
    `insert into app_settings (id, ghl_location_id, fb_page_id, ig_user_id, ig_handle, fb_page_url,
       ghl_token_encrypted, meta_page_token_encrypted, webhook_secret_encrypted, updated_at)
     values (true, $1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (id) do update set
       ghl_location_id = excluded.ghl_location_id,
       fb_page_id = excluded.fb_page_id,
       ig_user_id = excluded.ig_user_id,
       ig_handle = excluded.ig_handle,
       fb_page_url = excluded.fb_page_url,
       -- never overwrite an already-stored secret with null just because
       -- this particular save didn't touch it (setConfig only patches the
       -- fields it was given -- see server.js's allowed-fields filter)
       ghl_token_encrypted = coalesce(excluded.ghl_token_encrypted, app_settings.ghl_token_encrypted),
       meta_page_token_encrypted = coalesce(excluded.meta_page_token_encrypted, app_settings.meta_page_token_encrypted),
       webhook_secret_encrypted = coalesce(excluded.webhook_secret_encrypted, app_settings.webhook_secret_encrypted),
       updated_at = now()`,
    [cfg.ghlLocationId || null, cfg.fbPageId || null, cfg.igUserId || null, cfg.igHandle || null, cfg.fbPageUrl || null,
     encFields.ghl_token_encrypted, encFields.meta_page_token_encrypted, encFields.webhook_secret_encrypted]
  );
}

// ---- event log (webhook-fed payments / disputes / sms) ----
// event: { id, type: 'payment'|'dispute'|'sms_in'|'sms_out', at: ISO, amount?, email?, name?, product?, round?, meta? }
function getEvents() { return read('events', []); }
// Same boot-time-hydration reasoning as hydrateConfigFromPostgres /
// hydrateMfsnFromPostgres above: events.json is wiped on every
// restart/spin-down on this host (no persistent disk), and getEvents() is
// JSON-only with no Postgres fallback. The Data Sources health check
// (paymentFeedOk/disputeFeedOk in server.js) is a pure "how recent is the
// last event in this file" check -- with no local events, a real webhook
// feed that's actually fine reads as broken ("Fix") until the next live
// sale/dispute happens to fire. Restores the most recent rows from the
// three typed Postgres tables (payments/disputes/sms_events) into a single
// merged, time-sorted list once at boot, only when local is empty. Capped
// per table -- this table only grows over time, and the dashboard/activity
// feed only ever look at recent slices anyway.
const EVENT_HYDRATE_LIMIT = 5000;
async function hydrateEventsFromPostgres() {
  if (!db.isEnabled()) return;
  if (getEvents().length) return; // already have local data, nothing to restore
  try {
    const [pay, dis, sms] = await Promise.all([
      db.query(`select * from payments order by received_at desc limit ${EVENT_HYDRATE_LIMIT}`),
      db.query(`select * from disputes order by received_at desc limit ${EVENT_HYDRATE_LIMIT}`),
      db.query(`select * from sms_events order by received_at desc limit ${EVENT_HYDRATE_LIMIT}`)
    ]);
    const events = [];
    for (const r of pay.rows) events.push({
      id: 'pg-payment-' + r.id, type: 'payment', at: r.sale_at, receivedAt: r.received_at,
      email: r.email || '', name: r.name || '', phone: r.phone || '',
      amount: r.amount != null ? Number(r.amount) : 0, product: r.product || ''
    });
    for (const r of dis.rows) events.push({
      id: 'pg-dispute-' + r.id, type: 'dispute', at: r.event_at, receivedAt: r.received_at,
      email: r.email || '', name: r.name || '', round: r.round_number, action: r.action || 'dispute_sent'
    });
    for (const r of sms.rows) events.push({
      id: 'pg-sms-' + r.id, type: r.direction === 'out' ? 'sms_out' : 'sms_in',
      at: r.event_at, receivedAt: r.received_at, phone: r.phone || ''
    });
    if (!events.length) return;
    events.sort((a, b) => String(a.receivedAt || a.at || '').localeCompare(String(b.receivedAt || b.at || '')));
    write('events', events);
    console.log(`Restored ${events.length} payment/dispute/sms events from Postgres (local events.json was empty -- likely an ephemeral-disk restart)`);
  } catch (e) {
    console.error('Event log hydration from Postgres failed (continuing with an empty local log):', e.message);
  }
}
// Tasks, task notes and client notes mirror into Postgres on every write but
// were never read back, so on a host with no persistent disk they looked lost
// after every spin-down even though the rows were sitting safely in Supabase.
// Same shape as hydrateEventsFromPostgres above: only restore when the local
// file is empty, so a live JSON file is never overwritten by an older mirror.
//
// Known lossy edges, deliberate rather than overlooked: assignedTo/createdBy
// are this app's own user ids and were never mirrored (no users migration has
// run -- see the two-tier note in CLAUDE.md), and JSON ids are regenerated on
// restore, so a `.pgId` link is re-established but the original JSON id is
// not preserved. Titles, due dates, done state, descriptions, bodies and
// timestamps -- the parts someone actually typed -- all survive.
async function hydrateTasksFromPostgres() {
  if (!db.isEnabled()) return;
  if (getTasks().length) return;
  try {
    const { rows } = await db.query(
      `select t.id, t.title, t.due_at, t.is_done, t.done_at, t.description, t.created_at,
              c.ghl_contact_id
         from tasks t left join clients c on c.id = t.client_id
        order by t.created_at asc`
    );
    if (!rows.length) return;
    const tasks = rows.map(r => ({
      id: 'pg-task-' + r.id,
      pgId: r.id,
      title: r.title || '',
      clientId: r.ghl_contact_id || null,
      due: r.due_at ? String(r.due_at).slice(0, 10) : null,
      done: !!r.is_done,
      doneAt: r.done_at || null,
      notes: r.description || '',
      createdAt: r.created_at,
      mentions: []
    }));
    write('tasks', tasks);
    console.log(`Restored ${tasks.length} tasks from Postgres (local tasks.json was empty -- likely an ephemeral-disk restart)`);
  } catch (e) {
    console.error('Task hydration from Postgres failed (continuing with an empty local list):', e.message);
  }
}

async function hydrateTaskNotesFromPostgres() {
  if (!db.isEnabled()) return;
  if (read('taskNotes', []).length) return;
  try {
    const { rows } = await db.query(
      'select id, task_id, body, created_at from task_notes order by created_at asc'
    );
    if (!rows.length) return;
    // The thread hangs off the restored task ids above, which are derived
    // from the same Postgres ids -- so the two line up without a second pass.
    const notes = rows.map(r => ({
      id: 'pg-tasknote-' + r.id,
      pgId: r.id,
      taskId: 'pg-task-' + r.task_id,
      text: r.body || '',
      at: r.created_at,
      mentions: []
    }));
    write('taskNotes', notes);
    console.log(`Restored ${notes.length} task notes from Postgres`);
  } catch (e) {
    console.error('Task-note hydration from Postgres failed:', e.message);
  }
}

async function hydrateNotesFromPostgres() {
  if (!db.isEnabled()) return;
  if (getNotes().length) return;
  try {
    const { rows } = await db.query(
      `select n.id, n.body, n.created_at, c.ghl_contact_id
         from client_notes n join clients c on c.id = n.client_id
        order by n.created_at asc`
    );
    if (!rows.length) return;
    const notes = rows.map(r => ({
      id: 'pg-note-' + r.id,
      pgId: r.id,
      clientId: r.ghl_contact_id,
      text: r.body || '',
      at: r.created_at,
      mentions: []
    }));
    write('notes', notes);
    console.log(`Restored ${notes.length} client notes from Postgres`);
  } catch (e) {
    console.error('Client-note hydration from Postgres failed:', e.message);
  }
}

// worked-status and affiliate overrides: keyed maps rather than lists, but
// the same restore-only-when-empty rule applies. Both key their JSON side by
// GHL contact id, which the Postgres rows carry via the clients join.
async function hydrateWorkedFromPostgres() {
  if (!db.isEnabled()) return;
  if (Object.keys(getWorked()).length) return;
  try {
    const { rows } = await db.query(
      `select w.worked_at, w.worked_by, w.outcome, c.ghl_contact_id
         from worked_status w join clients c on c.id = w.client_id`
    );
    if (!rows.length) return;
    const w = {};
    for (const r of rows) {
      if (!r.ghl_contact_id) continue;
      w[r.ghl_contact_id] = { workedAt: r.worked_at, by: r.worked_by || null, outcome: r.outcome || null };
    }
    if (!Object.keys(w).length) return;
    write('worked', w);
    console.log(`Restored ${Object.keys(w).length} reactivation worked-marks from Postgres`);
  } catch (e) {
    console.error('Worked-status hydration from Postgres failed:', e.message);
  }
}

async function hydrateAffiliateOverridesFromPostgres() {
  if (!db.isEnabled()) return;
  if (Object.keys(getAffiliateOverrides()).length) return;
  try {
    const { rows } = await db.query(
      `select a.status, c.ghl_contact_id
         from affiliate_overrides a join clients c on c.id = a.client_id`
    );
    const all = {};
    for (const r of rows) if (r.ghl_contact_id) all[r.ghl_contact_id] = r.status;
    // The generic table wins on a conflict: it is written on every change,
    // the legacy one only when a GHL-side row exists.
    const generic = await db.query('select ext_id, status from mfsn_overrides');
    for (const r of generic.rows) all[r.ext_id] = r.status;
    if (!Object.keys(all).length) return;
    if (!Object.keys(all).length) return;
    write('affiliate_overrides', all);
    console.log(`Restored ${Object.keys(all).length} affiliate overrides from Postgres`);
  } catch (e) {
    console.error('Affiliate-override hydration from Postgres failed:', e.message);
  }
}

// The real Commas/Fanbasis sale history: 5,133 succeeded transactions with
// exact per-sale timestamps, exported from the Commas dashboard on
// 2026-08-10 and covering 2025-04-12 through 2026-07-20. This replaces both
// the dateless HISTORICAL_PRODUCT_SALES snapshot and the GHL approximation
// -- with it, every date range from Today to All Time is a sum of real
// individual sales rather than an estimate.
//
// Seeded rather than webhook-delivered because the Fanbasis Zap only started
// carrying a product field in late July; everything before that would
// otherwise be invisible. Ids are derived from the Commas payment id, so
// re-running this can never double-count, and a live webhook event for a
// sale already in here collides on id instead of adding a second copy.
const COMMAS_SEED = path.join(__dirname, '..', 'seed', 'commas-payments-seed.json');
function seedCommasPayments() {
  try {
    const existing = getEvents();
    const have = new Set(existing.filter(e => e.type === 'payment').map(e => e.id));
    // Only seed rows we don't already hold -- so this is safe to run on every
    // boot, and safe alongside Postgres hydration having already restored a
    // partial log.
    const seed = JSON.parse(fs.readFileSync(COMMAS_SEED, 'utf8'));
    const missing = seed.filter(e => !have.has(e.id));
    if (!missing.length) return 0;
    const merged = existing.concat(missing.map(e => ({ ...e, receivedAt: e.at })));
    merged.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
    write('events', merged);
    console.log(`Seeded ${missing.length} Commas sales (real per-sale history, 2025-04 to 2026-07)`);
    return missing.length;
  } catch (e) {
    console.error('Commas payment seed failed (continuing without it):', e.message);
    return 0;
  }
}

// Mirror the account list into Postgres so the three per-user stores below
// have a real users.id to hang off. Called after any user write; upserts on
// app_user_id, which is the JSON side's own id.
// Returns true only if every row landed. Callers that CREATE an account must
// await and check this: a fire-and-forget mirror failure means the login
// evaporates on the next restart, silently -- which is precisely how a newly
// added VA vanished twice. (The second time: the server starts listening
// before bootstrap's migration finishes, so an account created in the first
// seconds after a deploy hit a users table that did not have the record
// column yet, and the insert failed into a log nobody sees.)
async function mirrorUsers(users) {
  if (!db.isEnabled() || !Array.isArray(users)) return { ok: false, error: 'no database configured' };
  let allOk = true;
  let lastError = null;
  for (const u of users) {
    if (!u || !u.id || !u.username) continue;
    try {
      await db.query(
        `insert into users (app_user_id, username, name, role, capabilities, disabled, sso_only, record)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (app_user_id) do update set
           username = excluded.username, name = excluded.name, role = excluded.role,
           capabilities = excluded.capabilities, disabled = excluded.disabled,
           sso_only = excluded.sso_only, record = excluded.record, updated_at = now()`,
        [String(u.id), u.username, u.name || '', u.role || 'employee',
         u.capabilities ? JSON.stringify(u.capabilities) : null,
         !!u.disabled, !!u.ssoOnly, JSON.stringify(u)]
      );
    } catch (e) {
      allOk = false;
      lastError = e.message;
      console.error('User mirror failed for', u.username, '->', e.message);
    }
  }
  // The error comes back with the result. This SQL only ever executes against
  // the real schema -- the test environment has no Postgres -- so when it
  // breaks, the message in a response an admin can read is the only
  // diagnostics that exist.
  return { ok: allOk, error: lastError };
}

async function lookupUserPgId(appUserId) {
  if (!appUserId) return null;
  const { rows } = await db.query('select id from users where app_user_id = $1', [String(appUserId)]);
  return rows[0] ? rows[0].id : null;
}

// Reverse direction, for hydration: Postgres id -> the app's own user id.
async function userIdMap() {
  const { rows } = await db.query('select id, app_user_id from users where app_user_id is not null');
  const byPg = new Map();
  for (const r of rows) byPg.set(r.id, r.app_user_id);
  return byPg;
}

async function hydrateNotificationsFromPostgres() {
  if (!db.isEnabled()) return;
  if (read('notifications', []).length) return;
  try {
    const map = await userIdMap();
    const { rows } = await db.query(
      'select id, user_id, type, body, from_name, is_read, created_at from notifications order by created_at asc'
    );
    const out = [];
    for (const r of rows) {
      const appId = map.get(r.user_id);
      if (!appId) continue; // orphaned by a deleted account -- nothing to show it to
      out.push({
        id: 'pg-notif-' + r.id, pgId: r.id, userId: appId,
        type: r.type, body: r.body || '', fromName: r.from_name || '',
        read: !!r.is_read, at: r.created_at
      });
    }
    if (!out.length) return;
    write('notifications', out);
    console.log(`Restored ${out.length} notifications from Postgres`);
  } catch (e) {
    console.error('Notification hydration from Postgres failed:', e.message);
  }
}

// ------------------------- client roster snapshot -------------------------
// Survives the container so a cold boot doesn't have to wait on GoHighLevel.
// Deliberately one row: this is a cache, not a history, and keeping versions
// would grow without bound for no benefit.
async function saveClientsSnapshot(clients) {
  if (!db.isEnabled()) return;
  if (!Array.isArray(clients) || !clients.length) return; // never cache a failed fetch
  try {
    await db.query(
      `insert into client_snapshot (id, data, saved_at) values (1, $1, now())
       on conflict (id) do update set data = excluded.data, saved_at = now()`,
      [JSON.stringify(clients)]
    );
  } catch (e) {
    console.error('Client snapshot save failed (roster still works):', e.message);
  }
}

async function getClientsSnapshot() {
  if (!db.isEnabled()) return null;
  try {
    const { rows } = await db.query('select data, saved_at from client_snapshot where id = 1');
    if (!rows.length) return null;
    const data = rows[0].data;
    const clients = typeof data === 'string' ? JSON.parse(data) : data;
    if (!Array.isArray(clients) || !clients.length) return null;
    return { clients, savedAt: new Date(rows[0].saved_at).toISOString() };
  } catch (e) {
    console.error('Client snapshot read failed:', e.message);
    return null;
  }
}

// ------------------------------ audit log ------------------------------
function getAuditLog() { return read('audit', []); }
function appendAudit(entries) {
  if (!entries || !entries.length) return;
  const audit = require('./audit');
  write('audit', audit.trim(getAuditLog().concat(entries)));
  // Mirror to Postgres so the log survives the container. Fire-and-forget: an
  // audit write must never be able to fail the edit it is recording.
  mirrorAudit(entries).catch(() => {});
}
async function mirrorAudit(entries) {
  if (!db.isEnabled()) return;
  try {
    for (const e of entries) {
      await db.query(
        `insert into audit_log (at, who, client_id, client_name, field, action, from_value, to_value)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [e.at, e.who, e.clientId, e.clientName, e.field, e.action,
         e.from === undefined ? null : String(e.from), e.to === undefined ? null : String(e.to)]
      );
    }
  } catch (err) {
    console.error('Audit mirror failed (the edit still saved):', err.message);
  }
}
async function hydrateAuditFromPostgres() {
  if (!db.isEnabled()) return;
  if (getAuditLog().length) return;
  try {
    const audit = require('./audit');
    const { rows } = await db.query(
      `select at, who, client_id, client_name, field, action, from_value, to_value
       from audit_log order by at desc limit ${audit.MAX_ENTRIES}`);
    if (!rows.length) return;
    write('audit', rows.map(r => ({
      at: new Date(r.at).toISOString(), who: r.who, clientId: r.client_id,
      clientName: r.client_name, field: r.field, action: r.action,
      from: r.from_value, to: r.to_value
    })));
    console.log(`Restored ${rows.length} audit entries from Postgres`);
  } catch (err) {
    console.error('Audit hydration failed:', err.message);
  }
}

// ------------------------------ users ------------------------------
// Puts the accounts back after a restart. Restore-only-when-empty, same as
// every other hydration: a populated local users list is newer than whatever
// Postgres holds, since every write mirrors forward.
async function hydrateUsersFromPostgres() {
  if (!db.isEnabled()) return;
  const cfg = read('config', {});
  if (Array.isArray(cfg.users) && cfg.users.length > 1) return; // more than the auto-created admin
  try {
    const { rows } = await db.query('select record from users where record is not null');
    const users = rows.map(r => (typeof r.record === 'string' ? JSON.parse(r.record) : r.record))
      .filter(u => u && u.id && u.username);
    if (!users.length) return;
    // Keep an existing admin row (ensureAdmin may have just made it) unless
    // Postgres has its own copy of the same username.
    const have = new Set(users.map(u => u.username));
    const keep = (cfg.users || []).filter(u => !have.has(u.username));
    write('config', { ...cfg, users: keep.concat(users) });
    console.log(`Restored ${users.length} user accounts from Postgres (logins survive restarts now)`);
  } catch (e) {
    console.error('User hydration from Postgres failed:', e.message);
  }
}

// ---------------------------- sessions ----------------------------
// Written on every login/logout. Fire-and-forget by design: a Postgres blip
// must never be able to fail a login, so the file write and the in-memory
// map stay authoritative for the running process and this is only the copy
// that outlives the container.
async function mirrorSessions(map) {
  if (!db.isEnabled()) return;
  const entries = Object.entries(map || {});
  try {
    // Replace wholesale rather than diffing: the map is small (one row per
    // active login) and this keeps deletions -- logout, revoke, expiry --
    // from needing their own path.
    await db.query('delete from sessions');
    for (const [token, s] of entries) {
      if (!token || !s || !s.userId) continue;
      await db.query(
        `insert into sessions (token, app_user_id, role, preview_role, via_sso, created_at)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (token) do update set role = excluded.role,
           preview_role = excluded.preview_role, via_sso = excluded.via_sso`,
        [token, String(s.userId), s.role || 'employee', s.previewRole || null,
         !!s.viaSso, new Date(s.createdAt || Date.now())]
      );
    }
  } catch (e) {
    console.error('Session mirror to Postgres failed (login still works):', e.message);
  }
}

// Returns a token->session map shaped exactly like sessions.json, so the
// caller can hand it straight to auth.createSessions() -- which is what
// applies the 30-day expiry. Restoring rows here without that check would
// resurrect tokens the in-memory store had already dropped.
async function hydrateSessionsFromPostgres() {
  if (!db.isEnabled()) return {};
  try {
    const { rows } = await db.query(
      'select token, app_user_id, role, preview_role, via_sso, created_at from sessions'
    );
    const out = {};
    for (const r of rows) {
      out[r.token] = {
        userId: r.app_user_id,
        role: r.role,
        createdAt: new Date(r.created_at).getTime()
      };
      if (r.preview_role) out[r.token].previewRole = r.preview_role;
      if (r.via_sso) out[r.token].viaSso = true;
    }
    if (Object.keys(out).length) {
      console.log(`Restored ${Object.keys(out).length} sessions from Postgres (nobody gets logged out by a restart)`);
    }
    return out;
  } catch (e) {
    console.error('Session hydration from Postgres failed:', e.message);
    return {};
  }
}

async function hydrateTicketViewsFromPostgres() {
  if (!db.isEnabled()) return;
  if (Object.keys(getTicketViews()).length) return;
  try {
    const map = await userIdMap();
    const { rows } = await db.query('select user_id, external_ticket_id, viewed_at from ticket_views');
    const out = {};
    for (const r of rows) {
      const appId = map.get(r.user_id);
      if (!appId) continue;
      out[appId] = out[appId] || {};
      out[appId][r.external_ticket_id] = r.viewed_at;
    }
    if (!Object.keys(out).length) return;
    write('ticket_views', out);
    console.log(`Restored ticket read-state for ${Object.keys(out).length} users from Postgres`);
  } catch (e) {
    console.error('Ticket-view hydration from Postgres failed:', e.message);
  }
}

async function hydrateDashboardLayoutsFromPostgres() {
  if (!db.isEnabled()) return;
  if (Object.keys(read('dashboardLayouts', {})).length) return;
  try {
    const map = await userIdMap();
    const { rows } = await db.query(
      'select user_id, is_default, widget_order, widget_sizes from dashboard_layouts'
    );
    const out = {};
    for (const r of rows) {
      // user_id null + is_default marks the site-wide default (reserved key).
      const key = r.is_default ? '__default__' : map.get(r.user_id);
      if (!key) continue;
      // The app stores and reads { nodes: [...] } -- GridStack's own save()
      // output. Restoring {order, sizes} handed the client a layout with no
      // .nodes, which it quietly ignored, so a restored layout was no better
      // than a lost one.
      const nodes = Array.isArray(r.widget_order) ? r.widget_order
        : (r.widget_order && Array.isArray(r.widget_order.nodes) ? r.widget_order.nodes : []);
      if (!nodes.length) continue;
      out[key] = { nodes };
    }
    if (!Object.keys(out).length) return;
    write('dashboardLayouts', out);
    console.log(`Restored ${Object.keys(out).length} dashboard layouts from Postgres`);
  } catch (e) {
    console.error('Dashboard-layout hydration from Postgres failed:', e.message);
  }
}

function removeEvents(predicate) {
  // JSON only -- this deletes by an arbitrary in-memory predicate across
  // what would be three different typed Postgres tables (payments/
  // disputes/sms_events) with no id correlation to work from. Only used by
  // the admin test-data cleanup route; not worth mirroring.
  write('events', read('events', []).filter(e => !predicate(e)));
}
function addEvent(ev) {
  const events = getEvents();
  ev.id = ev.id || (Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  ev.receivedAt = new Date().toISOString();
  events.push(ev);
  // keep a sane cap
  if (events.length > 100000) events.splice(0, events.length - 100000);
  write('events', events);
  mirror(mirrorEvent(ev));
  return ev;
}
async function mirrorEvent(ev) {
  const clientId = null; // no client resolution attempted for events yet -- see file header
  if (ev.type === 'payment') {
    const saleAt = ev.at || ev.receivedAt;
    const { rows } = await db.query(
      `insert into payments (client_id, webhook_route, email, name, phone, amount, product, sale_at, sale_local_date, received_at)
       values ($1,'fanbasis',$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [clientId, ev.email || '', ev.name || '', ev.phone || null, ev.amount || 0, ev.product || null,
       saleAt, new Date(saleAt).toISOString().slice(0, 10), ev.receivedAt]
    );
    patchPgId('events', ev.id, rows[0].id);
  } else if (ev.type === 'dispute') {
    const { rows } = await db.query(
      `insert into disputes (client_id, email, name, round_number, action, event_at, received_at)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [clientId, ev.email || '', ev.name || '', ev.round || null, ev.action || 'dispute_sent', ev.at || ev.receivedAt, ev.receivedAt]
    );
    patchPgId('events', ev.id, rows[0].id);
  } else if (ev.type === 'sms_in' || ev.type === 'sms_out') {
    const { rows } = await db.query(
      `insert into sms_events (client_id, direction, phone, event_at, received_at)
       values ($1,$2,$3,$4,$5) returning id`,
      [clientId, ev.type === 'sms_out' ? 'out' : 'in', ev.phone || null, ev.at || ev.receivedAt, ev.receivedAt]
    );
    patchPgId('events', ev.id, rows[0].id);
  }
}

// ---- daily snapshots (followers, client counts) for growth charts ----
// snapshot: { date: 'YYYY-MM-DD', igFollowers, fbFollowers, activeClients, inactiveClients, totalClients }
function getSnapshots() { return read('snapshots', []); }
function upsertSnapshot(snap) {
  const snaps = getSnapshots();
  const i = snaps.findIndex(s => s.date === snap.date);
  if (i >= 0) snaps[i] = { ...snaps[i], ...snap };
  else snaps.push(snap);
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  write('snapshots', snaps);
  const full = snaps.find(s => s.date === snap.date);
  mirror(db.query(
    `insert into follower_snapshots (snapshot_date, ig_followers, fb_followers, active_clients, inactive_clients, total_clients)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (snapshot_date) do update set
       ig_followers = excluded.ig_followers, fb_followers = excluded.fb_followers,
       active_clients = excluded.active_clients, inactive_clients = excluded.inactive_clients,
       total_clients = excluded.total_clients`,
    [full.date, full.igFollowers ?? null, full.fbFollowers ?? null,
     full.activeClients ?? null, full.inactiveClients ?? null, full.totalClients ?? null]
  ));
  return snap;
}

// ---- notes (per client) ----
// note: { id, clientId, text, at, authorId?, authorName?, mentions?: [userId] }
function getNotes(clientId) {
  const all = read('notes', []);
  return clientId ? all.filter(n => n.clientId === clientId) : all;
}
function addNote(clientId, text, extra) {
  const all = read('notes', []);
  const note = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), clientId, text, at: new Date().toISOString(), mentions: [], ...extra };
  all.push(note); write('notes', all);
  mirror(mirrorAddNote(note));
  return note;
}
async function mirrorAddNote(note) {
  const clientPgId = await lookupClientPgId(note.clientId);
  if (clientPgId == null) return; // client not migrated into Postgres yet -- see file header
  const { rows } = await db.query(
    'insert into client_notes (client_id, body, created_at) values ($1,$2,$3) returning id',
    [clientPgId, note.text, note.at]
  );
  patchPgId('notes', note.id, rows[0].id);
}
function deleteNote(id) {
  const all = read('notes', []);
  const existing = all.find(n => n.id === id);
  write('notes', all.filter(n => n.id !== id));
  if (existing && existing.pgId != null) mirror(db.query('delete from client_notes where id = $1', [existing.pgId]));
}

// ---- tasks / follow-ups ----
// task: { id, title, clientId?, clientName?, due?, done, createdAt, doneAt?,
//         notes?, assignedTo?: userId, assignedToName?, createdBy?: userId,
//         createdByName?, mentions?: [userId] }
function getTasks() { return read('tasks', []); }
function addTask(t) {
  const all = getTasks();
  const task = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), done: false, createdAt: new Date().toISOString(), mentions: [], ...t };
  all.push(task); write('tasks', all);
  mirror(mirrorAddTask(task));
  return task;
}
async function mirrorAddTask(task) {
  // assignedTo/createdBy are this app's own user ids, not yet correlated to
  // a Postgres users.id (no user migration has run) -- left null for now.
  const clientPgId = await lookupClientPgId(task.clientId);
  const { rows } = await db.query(
    `insert into tasks (title, client_id, due_at, is_done, done_at, description, created_at)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [task.title || '', clientPgId, task.due || null, !!task.done, task.doneAt || null, task.notes || null, task.createdAt]
  );
  patchPgId('tasks', task.id, rows[0].id);
}
function updateTask(id, patch) {
  const all = getTasks();
  const i = all.findIndex(t => t.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  if (patch.done === true && !all[i].doneAt) all[i].doneAt = new Date().toISOString();
  write('tasks', all);
  const updated = all[i];
  if (updated.pgId != null) {
    mirror(db.query(
      `update tasks set title=$1, due_at=$2, is_done=$3, done_at=$4, description=$5 where id=$6`,
      [updated.title || '', updated.due || null, !!updated.done, updated.doneAt || null, updated.notes || null, updated.pgId]
    ));
  }
  return updated;
}
function deleteTask(id) {
  const all = getTasks();
  const existing = all.find(t => t.id === id);
  write('tasks', all.filter(t => t.id !== id));
  if (existing && existing.pgId != null) mirror(db.query('delete from tasks where id = $1', [existing.pgId]));
}

// ---- task notes (a thread of notes on a follow-up task, so more than one
// person can leave their own updates on it -- same shape and @mention
// handling as the per-client notes above, just keyed by taskId instead of
// clientId. Separate from task.notes, which is the original description
// set when the task was created.) ----
// note: { id, taskId, text, at, authorId?, authorName?, mentions?: [userId] }
function getTaskNotes(taskId) {
  const all = read('taskNotes', []);
  return taskId ? all.filter(n => n.taskId === taskId) : all;
}
function addTaskNote(taskId, text, extra) {
  const all = read('taskNotes', []);
  const note = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), taskId, text, at: new Date().toISOString(), mentions: [], ...extra };
  all.push(note); write('taskNotes', all);
  mirror(mirrorAddTaskNote(note));
  return note;
}
async function mirrorAddTaskNote(note) {
  const parentTask = getTasks().find(t => t.id === note.taskId);
  if (!parentTask || parentTask.pgId == null) return; // parent task was never mirrored -- nothing to attach to
  const { rows } = await db.query(
    'insert into task_notes (task_id, body, created_at) values ($1,$2,$3) returning id',
    [parentTask.pgId, note.text, note.at]
  );
  patchPgId('taskNotes', note.id, rows[0].id);
}
function deleteTaskNote(id) {
  const all = read('taskNotes', []);
  const existing = all.find(n => n.id === id);
  write('taskNotes', all.filter(n => n.id !== id));
  if (existing && existing.pgId != null) mirror(db.query('delete from task_notes where id = $1', [existing.pgId]));
}

// ---- app snippets (team-made message templates, alongside GHL's own) ----
// Durable the same way users/audit are: JSON for speed, mirrored to the
// app_snippets table, restored at boot when the JSON copy is empty (this
// host's disk does not survive a deploy).
function getAppSnippets() { return read('appSnippets', []); }
function addAppSnippet({ name, body, who }) {
  const snip = {
    id: 'snip-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(name).trim(), body: String(body).trim(),
    createdBy: who || '', createdAt: new Date().toISOString()
  };
  write('appSnippets', read('appSnippets', []).concat([snip]));
  if (db.isEnabled()) {
    db.query('insert into app_snippets (snip_id, name, body, created_by) values ($1,$2,$3,$4) on conflict (snip_id) do nothing',
      [snip.id, snip.name, snip.body, snip.createdBy]).catch(e => console.error('Snippet mirror failed (still saved locally):', e.message));
  }
  return snip;
}
function deleteAppSnippet(id) {
  const before = read('appSnippets', []);
  const after = before.filter(x => x.id !== id);
  write('appSnippets', after);
  if (db.isEnabled()) {
    db.query('delete from app_snippets where snip_id = $1', [id]).catch(e => console.error('Snippet delete mirror failed:', e.message));
  }
  return after.length < before.length;
}
async function hydrateAppSnippetsFromPostgres() {
  if (!db.isEnabled()) return;
  if (read('appSnippets', []).length) return; // local copy wins when present
  try {
    const { rows } = await db.query('select snip_id, name, body, created_by, created_at from app_snippets order by created_at asc');
    if (!rows.length) return;
    write('appSnippets', rows.map(r => ({
      id: r.snip_id, name: r.name, body: r.body, createdBy: r.created_by,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at)
    })));
    console.log(`Restored ${rows.length} app snippets from Postgres`);
  } catch (e) { console.error('Snippet hydration failed:', e.message); }
}

// ---- notifications (in-app only -- drives a bell badge, same pattern as
// the support-ticket unread badge). Created whenever a task is assigned to
// someone, or someone is @mentioned in a note or task. ----
// notification: { id, userId, type: 'assigned'|'mention', refType: 'task'|'note',
//                  refId, clientId?, clientName?, text, fromName, read, createdAt }
//
// NOT mirrored to Postgres: notifications.user_id is a required (not null)
// foreign key to users(id), and no user migration has run yet, so there is
// no real Postgres user id to attach these to -- attempting it would just
// fail every single time. Revisit once users are migrated.
function getNotifications(userId) {
  const all = read('notifications', []);
  return userId ? all.filter(n => n.userId === userId) : all;
}
function addNotification(n) {
  const all = read('notifications', []);
  const note = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), read: false, createdAt: new Date().toISOString(), ...n };
  all.push(note);
  if (all.length > 5000) all.splice(0, all.length - 5000);
  write('notifications', all);
  return note;
}
function markNotificationRead(userId, id) {
  const all = read('notifications', []);
  const i = all.findIndex(n => n.id === id && n.userId === userId);
  if (i < 0) return null;
  all[i].read = true;
  write('notifications', all);
  return all[i];
}
function markAllNotificationsRead(userId) {
  const all = read('notifications', []);
  let changed = false;
  for (const n of all) if (n.userId === userId && !n.read) { n.read = true; changed = true; }
  if (changed) write('notifications', all);
}

// ---- per-user dashboard layout (drag/resize customization) ----
// { order: ['widget-id', ...], sizes: { 'widget-id': 'sm'|'md'|'lg'|'full' } }
// keyed by userId so it follows the login, not the browser. A reserved
// '__default__' key holds the site-wide default (see set/getDefault below)
// -- whoever hasn't personally rearranged anything yet sees that instead of
// falling back to whatever order happens to be in the HTML.
//
// Per-user layouts ARE mirrored now. They were not, because
// dashboard_layouts.user_id needs a real Postgres users.id and there was no
// users table -- that is no longer true (see lib/migrate.js and mirrorUsers),
// but nobody came back to switch this on. The result: a personal arrangement
// lived only in JSON, on a host with no persistent disk, so it survived until
// the next spin-down and no longer. That is the "I move the cards and they do
// not stay" bug.
const DEFAULT_LAYOUT_KEY = '__default__';
function getDashboardLayout(userId) {
  const all = read('dashboardLayouts', {});
  if (Object.prototype.hasOwnProperty.call(all, userId)) return all[userId];
  return all[DEFAULT_LAYOUT_KEY] || null;
}
function setDashboardLayout(userId, layout) {
  const all = read('dashboardLayouts', {});
  all[userId] = layout;
  write('dashboardLayouts', all);
  mirrorPersonalLayout(userId, layout).catch(() => {});
}

// Fire-and-forget: rearranging a dashboard must not be able to fail on a
// database blip, and the JSON copy is authoritative for the running process.
async function mirrorPersonalLayout(userId, layout) {
  if (!db.isEnabled()) return;
  try {
    const pgId = await lookupUserPgId(userId);
    if (!pgId) return; // account not mirrored yet; nothing to hang the row off
    await db.query(
      `insert into dashboard_layouts (user_id, is_default, widget_order, widget_sizes, updated_at)
       values ($1, false, $2, $3, now())
       on conflict (user_id) where user_id is not null
       do update set widget_order = excluded.widget_order,
                     widget_sizes = excluded.widget_sizes, updated_at = now()`,
      [pgId, JSON.stringify(layout && layout.nodes ? layout.nodes : []), JSON.stringify({})]
    );
  } catch (e) {
    console.error('Dashboard layout mirror failed (it still saved locally):', e.message);
  }
}
// Drops the user's personal override so they fall back to the site default
// (or the shipped HTML order, if no default has been set) -- this is what
// "Reset to default" now does, instead of pinning them to an empty layout.
function clearDashboardLayout(userId) {
  const all = read('dashboardLayouts', {});
  delete all[userId];
  write('dashboardLayouts', all);
}
function getDefaultDashboardLayout() {
  const all = read('dashboardLayouts', {});
  return all[DEFAULT_LAYOUT_KEY] || null;
}
function setDefaultDashboardLayout(layout) {
  const all = read('dashboardLayouts', {});
  all[DEFAULT_LAYOUT_KEY] = layout;
  write('dashboardLayouts', all);
  mirror(db.query(
    `insert into dashboard_layouts (user_id, is_default, widget_order, widget_sizes, updated_at)
     values (null, true, $1, $2, now())
     on conflict ((true)) where is_default do update set
       widget_order = excluded.widget_order, widget_sizes = excluded.widget_sizes, updated_at = now()`,
    [JSON.stringify(layout?.order || []), JSON.stringify(layout?.sizes || {})]
  ));
}
// Drops the site-wide default entirely so everyone without a personal
// override falls back to the HTML's own shipped gs-w/gs-h/gs-x/gs-y
// attributes -- the one case setDefaultDashboardLayout can't reach, since
// it can only ever replace __default__ with a new layout, never remove it.
// Needed because this clone's dashboardLayouts.json shipped with a
// pre-existing __default__ entry from before the Admina-matching pass, and
// with no way to clear it, every fresh login (and every "Reset to default")
// kept silently reverting to that stale layout instead of the current HTML.
function clearDefaultDashboardLayout() {
  const all = read('dashboardLayouts', {});
  const had = Object.prototype.hasOwnProperty.call(all, DEFAULT_LAYOUT_KEY);
  delete all[DEFAULT_LAYOUT_KEY];
  write('dashboardLayouts', all);
  mirror(db.query('delete from dashboard_layouts where is_default'));
  return had;
}
// Drops every *personal* override so everyone (not just people who never
// customized anything) falls back to the current site default on their
// next load -- used by "Set as default for everyone" when the admin wants
// this to actually take effect for people who already had their own saved
// arrangement, not just new/never-touched logins. The __default__ entry
// itself is left alone.
function clearAllPersonalDashboardLayouts() {
  const all = read('dashboardLayouts', {});
  let cleared = 0;
  for (const key of Object.keys(all)) {
    if (key === DEFAULT_LAYOUT_KEY) continue;
    delete all[key];
    cleared++;
  }
  write('dashboardLayouts', all);
  return cleared;
}

// ---- reactivation queue worked-status ----
function getWorked() { return read('worked', {}); } // clientId -> { workedAt, by, outcome }
function setWorked(clientId, val) {
  const w = getWorked();
  if (val) w[clientId] = { workedAt: new Date().toISOString(), ...((typeof val === 'object') ? val : {}) };
  else delete w[clientId];
  write('worked', w);
  mirror(mirrorSetWorked(clientId, w[clientId] || null));
  return w[clientId] || null;
}
async function mirrorSetWorked(clientId, val) {
  const clientPgId = await lookupClientPgId(clientId);
  if (clientPgId == null) return; // client not migrated into Postgres yet -- see file header
  if (val) {
    await db.query(
      `insert into worked_status (client_id, worked_at, worked_by, outcome) values ($1,$2,$3,$4)
       on conflict (client_id) do update set worked_at = excluded.worked_at, worked_by = excluded.worked_by, outcome = excluded.outcome`,
      [clientPgId, val.workedAt, val.by || null, val.outcome || null]
    );
  } else {
    await db.query('delete from worked_status where client_id = $1', [clientPgId]);
  }
}

// ---- support tickets (local audit copy; the real destination is Proven
// Agency's own dashboard -- see the /api/support-tickets forward in
// server.js. Kept here too so a submission isn't silently lost if that
// forward ever fails, and so an admin can see submission history without
// leaving this app.) ----
// ticket: { id, subject, message, submittedByName, submittedByUsername,
//           submittedByRole, forwarded, forwardError?, createdAt }
function getTickets() { return read('tickets', []); }
function addTicket(t) {
  const all = getTickets();
  const ticket = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), createdAt: new Date().toISOString(), ...t };
  all.push(ticket);
  if (all.length > 5000) all.splice(0, all.length - 5000);
  write('tickets', all);
  mirror(db.query(
    `insert into support_tickets (subject, message, submitted_by_role, forwarded, forward_error, created_at)
     values ($1,$2,$3,$4,$5,$6)`,
    [ticket.subject || '', ticket.message || '', ticket.submittedByRole || null, !!ticket.forwarded, ticket.forwardError || null, ticket.createdAt]
  ));
  return ticket;
}

// ---- support ticket "last viewed" tracking (drives the unread badge on
// the Ticket Requests nav item). Keyed by our own userId (stable across
// name/username changes), then ticket id (Proven Agency's uuid, not our
// local audit-copy id above -- these are unrelated ids for unrelated
// records). A ticket is "unread" for a user when its updated_at is newer
// than the last time that user opened its thread; see the compare in
// server.js's GET /api/support-tickets. ----
//
// NOT mirrored: ticket_views.user_id is a required foreign key to
// users(id), unavailable until users are migrated.
function getTicketViews() { return read('ticket_views', {}); }
function markTicketViewed(userId, ticketId) {
  const all = getTicketViews();
  if (!all[userId]) all[userId] = {};
  all[userId][ticketId] = new Date().toISOString();
  write('ticket_views', all);
}

// ---- manual affiliate overrides (GHL clients, not Deal Production) ----
// A person can mark a client Affiliate / Not affiliate / Not on
// MyFreeScoreNow by hand from the client drawer, overriding the computed
// status from the synced MyFreeScoreNow "Active List" export -- e.g.
// Tiffany knows someone signed up under her link with a different email
// than the one on file. Cleared (deleted from the map) to go back to the
// computed status.
// map: clientId -> 'affiliate' | 'not_affiliate' | 'not_on_mfsn'
function getAffiliateOverrides() { return read('affiliate_overrides', {}); }
function setAffiliateOverride(clientId, value) {
  const all = getAffiliateOverrides();
  if (value === 'affiliate' || value === 'not_affiliate' || value === 'not_on_mfsn') all[clientId] = value;
  else delete all[clientId];
  write('affiliate_overrides', all);
  mirror(mirrorSetAffiliateOverride(clientId, all[clientId] || null));
  return all[clientId] || null;
}
async function mirrorSetAffiliateOverride(clientId, value) {
  // Generic mirror first, keyed by the raw external id -- this is what makes
  // an override on a DEAL PRODUCTION record durable. The legacy
  // affiliate_overrides table joins through clients.ghl_contact_id, which a
  // production legacy id never resolves to, so before this every mark made
  // from the production or dispute drawer silently evaporated on redeploy.
  if (value) {
    await db.query(
      `insert into mfsn_overrides (ext_id, status, set_at) values ($1,$2,now())
       on conflict (ext_id) do update set status = excluded.status, set_at = now()`,
      [String(clientId), value]);
  } else {
    await db.query('delete from mfsn_overrides where ext_id = $1', [String(clientId)]);
  }
  const clientPgId = await lookupClientPgId(clientId);
  if (clientPgId == null) return; // no GHL-side row -- the generic mirror above already has it
  if (value) {
    await db.query(
      `insert into affiliate_overrides (client_id, status, set_at) values ($1,$2,now())
       on conflict (client_id) do update set status = excluded.status, set_at = now()`,
      [clientPgId, value]
    );
  } else {
    await db.query('delete from affiliate_overrides where client_id = $1', [clientPgId]);
  }
}

// ---- MyFreeScoreNow enrolled members (for the affiliate gap) ----
function getMfsnMembers() { return read('mfsn_members', []); }
function setMfsnMembers(list) {
  const members = Array.isArray(list) ? list : [];
  write('mfsn_members', members);
  mirror(mirrorSetMfsnMembers(members));
  return getMfsnMembers();
}
// Snapshot-replace, matching the real semantics: a full sync REPLACES the
// whole set, so a stale row from a former member must not linger. Runs in
// one transaction (delete + all inserts) so a mid-sync failure can't leave
// the mirror half-replaced -- with the real Zap now firing every 6h against
// 1,000+ members, that used to mean 1,000+ sequential awaited round trips
// with no atomicity at all: any single failed insert left mfsn_members
// permanently missing whatever had already been deleted but not yet
// re-inserted, until the next scheduled sync happened to succeed all the
// way through. Batched (500 rows/statement) instead of one insert per
// member for the same reason -- this table only gets bigger over time.
const MFSN_MIRROR_BATCH = 500;
async function mirrorSetMfsnMembers(members) {
  await db.withTransaction(async client => {
    await client.query('delete from mfsn_members');
    for (let i = 0; i < members.length; i += MFSN_MIRROR_BATCH) {
      const batch = members.slice(i, i + MFSN_MIRROR_BATCH);
      const values = [];
      const params = [];
      batch.forEach((m, idx) => {
        const base = idx * 4;
        values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
        params.push(m.email || null, m.name || null, !!m.hasAffiliateCode, m.planAmount ?? null);
      });
      await client.query(
        `insert into mfsn_members (email, name, has_affiliate_code, plan_amount) values ${values.join(',')}`,
        params
      );
    }
  });
}
// Same boot-time-hydration reasoning as hydrateConfigFromPostgres above:
// mfsn_members.json is wiped on every restart/spin-down on a host with no
// persistent disk. Unlike config, nothing was restoring this before -- the
// affiliate-gap dashboard (getMfsnMembers(), JSON-only, no Postgres
// fallback) would read back an empty list and show every client as a gap
// until the next scheduled /webhooks/mfsn sync happened to fire, which is
// only every 6h. Restores from the mirror once at boot if local is empty;
// never overwrites a local list that's already there.
async function hydrateMfsnFromPostgres() {
  if (!db.isEnabled()) return;
  if (getMfsnMembers().length) return; // already have local data, nothing to restore
  try {
    const { rows } = await db.query('select email, name, has_affiliate_code, plan_amount from mfsn_members');
    if (!rows.length) return;
    const members = rows.map(r => ({
      email: r.email, name: r.name,
      hasAffiliateCode: r.has_affiliate_code,
      planAmount: r.plan_amount != null ? Number(r.plan_amount) : null
    }));
    write('mfsn_members', members);
    const metaRes = await db.query('select synced_at from mfsn_sync_meta where id = true');
    if (metaRes.rows[0] && metaRes.rows[0].synced_at) write('mfsn_meta', { syncedAt: metaRes.rows[0].synced_at });
    console.log(`Restored ${members.length} MFSN members from Postgres (local mfsn_members.json was empty -- likely an ephemeral-disk restart)`);
  } catch (e) {
    console.error('MFSN member hydration from Postgres failed (continuing with an empty local list):', e.message);
  }
}
function getMfsnSyncedAt() { return read('mfsn_meta', {}).syncedAt || null; }
function setMfsnSyncedAt(ts) {
  write('mfsn_meta', { syncedAt: ts });
  mirror(db.query(
    `insert into mfsn_sync_meta (id, synced_at) values (true, $1)
     on conflict (id) do update set synced_at = excluded.synced_at`,
    [ts]
  ));
}

// ---- MyFreeScoreNow "Old" (Smart Credit, not yet migrated) member audit ----
// MFSN's member-list export/webhook feed (normalizeMembers, above) does not
// carry the "Member Type" (Old vs New) flag at all -- it's only visible by
// hand, filtering the Member List UI on myfreescorenow.com by Member Type =
// Old, tab by tab (Active / Paused / Relinking). So unlike the rest of the
// affiliate-gap numbers (fed live by the /webhooks/mfsn sync), this is a
// manually-audited snapshot, refreshed by re-running that filter and
// POSTing the new counts to /api/mfsn-old-status. Seeded here with the real
// count taken 2026-07-31: Active 344 of 1,084 active members, Paused/Closed
// 1,571, Relinking 14 (Relinking rows also exposed real per-member
// commission, $12.80-$13.80 on the $29.90 plan tier -- see
// PLAN_AMOUNT_COMMISSION in lib/affiliate.js).
function getMfsnOldStatus() {
  return read('mfsn_old_status', {
    active: 344, activeTotal: 1084,
    paused: 1571,
    relinking: 14,
    auditedAt: '2026-07-31T00:00:00.000Z'
  });
}
function setMfsnOldStatus(patch) {
  const cur = getMfsnOldStatus();
  const next = { ...cur, ...patch, auditedAt: new Date().toISOString() };
  write('mfsn_old_status', next);
  // Append-only in Postgres (unlike the JSON file, which only ever holds
  // the latest) -- see docs/postgres-schema-design.sql for why: history of
  // this audit is a real, cheap-to-keep, previously-impossible question.
  mirror(db.query(
    'insert into mfsn_audit_snapshots (active, active_total, paused, relinking, audited_at) values ($1,$2,$3,$4,$5)',
    [next.active, next.activeTotal, next.paused, next.relinking, next.auditedAt]
  ));
  return next;
}

// ---- generic cache with TTL ----
const memCache = {};
// Concurrent callers hitting the same cold/expired key must share ONE
// underlying fn() call, not fire one each -- without this, N requests
// arriving right as a 30s TTL expires would each kick off their own
// ~18-20s Postgres reconstruction (readProd()'s cold-cache cost). Tracked
// separately from memCache so a value already served from cache never
// touches this path.
const inFlight = {};
function cached(key, ttlMs, fn) {
  const hit = memCache[key];
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  if (inFlight[key]) return inFlight[key];
  const promise = Promise.resolve().then(fn).then(value => {
    memCache[key] = { at: Date.now(), value };
    delete inFlight[key];
    return value;
  }, err => {
    delete inFlight[key];
    throw err;
  });
  inFlight[key] = promise;
  return promise;
}
// Is there a live in-memory hit for this key? Lets a caller decide whether it
// is about to pay for a slow fetch, without triggering one to find out.
function peekCached(key, ttlMs) {
  const hit = memCache[key];
  if (!hit) return false;
  return (Date.now() - hit.at) < (ttlMs == null ? Infinity : ttlMs);
}
// Stale-while-revalidate variant of cached(). A fresh hit returns as before;
// a STALE hit returns the old value immediately and refreshes in the
// background. The difference in practice: with plain cached(), whoever
// arrives first after the TTL lapses pays the full rebuild -- on this app
// about two seconds of roster composition -- while everyone behind them gets
// it free. With SWR nobody ever waits on a rebuild; the worst anyone sees is
// data one refresh-cycle old, on endpoints whose data changes a few times a
// day.
function cachedSWR(key, ttlMs, fn) {
  const hit = memCache[key];
  const refresh = () => {
    if (inFlight[key]) return inFlight[key];
    const p = Promise.resolve().then(fn).then(value => {
      memCache[key] = { at: Date.now(), value };
      delete inFlight[key];
      return value;
    }, err => { delete inFlight[key]; throw err; });
    inFlight[key] = p;
    return p;
  };
  if (hit) {
    if (Date.now() - hit.at >= ttlMs) refresh().catch(() => {}); // stale: refresh behind the reply
    return Promise.resolve(hit.value);
  }
  return refresh(); // nothing cached yet -- the only case that ever waits
}
function clearCache() { for (const k of Object.keys(memCache)) delete memCache[k]; }
// Clears just one cache entry -- unlike clearCache() above (used by
// POST /api/refresh to force-repull everything), callers that only
// invalidated ONE kind of cached data (e.g. lib/production.js after a Deal
// Production write) must not also force-expire unrelated caches like the
// 10-minute GHL client pull, which would needlessly burn GHL API calls.
function clearCacheKey(key) { delete memCache[key]; }

module.exports = {
  getAppSnippets, addAppSnippet, deleteAppSnippet, hydrateAppSnippetsFromPostgres,
  cachedSWR,
  hydrateUsersFromPostgres,
  getAuditLog, appendAudit, hydrateAuditFromPostgres,
  peekCached,
  saveClientsSnapshot,
  getClientsSnapshot,
  mirrorSessions,
  hydrateSessionsFromPostgres,
  getConfig, setConfig, getEvents, addEvent, removeEvents, getSnapshots, upsertSnapshot,
  getNotes, addNote, deleteNote, getTasks, addTask, updateTask, deleteTask,
  getTaskNotes, addTaskNote, deleteTaskNote,
  getWorked, setWorked, cached, clearCache, clearCacheKey, DATA_DIR,
  hydrateConfigFromPostgres, setConfigPrimary, hydrateMfsnFromPostgres, hydrateEventsFromPostgres,
  hydrateTasksFromPostgres, hydrateTaskNotesFromPostgres, hydrateNotesFromPostgres,
  hydrateWorkedFromPostgres, hydrateAffiliateOverridesFromPostgres,
  mirrorUsers, lookupUserPgId,
  hydrateNotificationsFromPostgres, hydrateTicketViewsFromPostgres,
  hydrateDashboardLayoutsFromPostgres,
  seedCommasPayments,
  getMfsnMembers, setMfsnMembers, getMfsnSyncedAt, setMfsnSyncedAt,
  getMfsnOldStatus, setMfsnOldStatus,
  getTickets, addTicket, getTicketViews, markTicketViewed,
  getAffiliateOverrides, setAffiliateOverride,
  getNotifications, addNotification, markNotificationRead, markAllNotificationsRead,
  getDashboardLayout, setDashboardLayout, clearDashboardLayout,
  getDefaultDashboardLayout, setDefaultDashboardLayout, clearAllPersonalDashboardLayouts, clearDefaultDashboardLayout
};
