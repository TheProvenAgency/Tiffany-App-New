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
// Per-user layouts (setDashboardLayout/clearDashboardLayout/
// clearAllPersonalDashboardLayouts) are NOT mirrored: dashboard_layouts.user_id
// would need a real Postgres users.id, unavailable until users are migrated.
// The single site-wide DEFAULT row has no such dependency (user_id is null
// for it by design) and IS mirrored below.
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
  const clientPgId = await lookupClientPgId(clientId);
  if (clientPgId == null) return; // client not migrated into Postgres yet -- see file header
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
async function mirrorSetMfsnMembers(members) {
  // Snapshot-replace, matching the real semantics: a full sync REPLACES the
  // whole set, so a stale row from a former member must not linger.
  await db.query('delete from mfsn_members');
  for (const m of members) {
    await db.query(
      'insert into mfsn_members (email, name, has_affiliate_code, plan_amount) values ($1,$2,$3,$4)',
      [m.email || null, m.name || null, !!m.hasAffiliateCode, m.planAmount ?? null]
    );
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
function clearCache() { for (const k of Object.keys(memCache)) delete memCache[k]; }
// Clears just one cache entry -- unlike clearCache() above (used by
// POST /api/refresh to force-repull everything), callers that only
// invalidated ONE kind of cached data (e.g. lib/production.js after a Deal
// Production write) must not also force-expire unrelated caches like the
// 10-minute GHL client pull, which would needlessly burn GHL API calls.
function clearCacheKey(key) { delete memCache[key]; }

module.exports = {
  getConfig, setConfig, getEvents, addEvent, removeEvents, getSnapshots, upsertSnapshot,
  getNotes, addNote, deleteNote, getTasks, addTask, updateTask, deleteTask,
  getTaskNotes, addTaskNote, deleteTaskNote,
  getWorked, setWorked, cached, clearCache, clearCacheKey, DATA_DIR,
  hydrateConfigFromPostgres, setConfigPrimary,
  getMfsnMembers, setMfsnMembers, getMfsnSyncedAt, setMfsnSyncedAt,
  getMfsnOldStatus, setMfsnOldStatus,
  getTickets, addTicket, getTicketViews, markTicketViewed,
  getAffiliateOverrides, setAffiliateOverride,
  getNotifications, addNotification, markNotificationRead, markAllNotificationsRead,
  getDashboardLayout, setDashboardLayout, clearDashboardLayout,
  getDefaultDashboardLayout, setDefaultDashboardLayout, clearAllPersonalDashboardLayouts, clearDefaultDashboardLayout
};
