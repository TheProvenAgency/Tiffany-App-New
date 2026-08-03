// Simple JSON-file store (no native deps, survives restarts on a persistent disk).
const fs = require('fs');
const path = require('path');

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
  return cfg;
}

// ---- event log (webhook-fed payments / disputes / sms) ----
// event: { id, type: 'payment'|'dispute'|'sms_in'|'sms_out', at: ISO, amount?, email?, name?, product?, round?, meta? }
function getEvents() { return read('events', []); }
function removeEvents(predicate) {
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
  return ev;
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
  all.push(note); write('notes', all); return note;
}
function deleteNote(id) {
  write('notes', read('notes', []).filter(n => n.id !== id));
}

// ---- tasks / follow-ups ----
// task: { id, title, clientId?, clientName?, due?, done, createdAt, doneAt?,
//         notes?, assignedTo?: userId, assignedToName?, createdBy?: userId,
//         createdByName?, mentions?: [userId] }
function getTasks() { return read('tasks', []); }
function addTask(t) {
  const all = getTasks();
  const task = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), done: false, createdAt: new Date().toISOString(), mentions: [], ...t };
  all.push(task); write('tasks', all); return task;
}
function updateTask(id, patch) {
  const all = getTasks();
  const i = all.findIndex(t => t.id === id);
  if (i < 0) return null;
  all[i] = { ...all[i], ...patch };
  if (patch.done === true && !all[i].doneAt) all[i].doneAt = new Date().toISOString();
  write('tasks', all); return all[i];
}
function deleteTask(id) { write('tasks', getTasks().filter(t => t.id !== id)); }

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
  all.push(note); write('taskNotes', all); return note;
}
function deleteTaskNote(id) {
  write('taskNotes', read('taskNotes', []).filter(n => n.id !== id));
}

// ---- notifications (in-app only -- drives a bell badge, same pattern as
// the support-ticket unread badge). Created whenever a task is assigned to
// someone, or someone is @mentioned in a note or task. ----
// notification: { id, userId, type: 'assigned'|'mention', refType: 'task'|'note',
//                  refId, clientId?, clientName?, text, fromName, read, createdAt }
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
  write('worked', w); return w[clientId] || null;
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
  return ticket;
}

// ---- support ticket "last viewed" tracking (drives the unread badge on
// the Ticket Requests nav item). Keyed by our own userId (stable across
// name/username changes), then ticket id (Proven Agency's uuid, not our
// local audit-copy id above -- these are unrelated ids for unrelated
// records). A ticket is "unread" for a user when its updated_at is newer
// than the last time that user opened its thread; see the compare in
// server.js's GET /api/support-tickets. ----
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
  return all[clientId] || null;
}

// ---- MyFreeScoreNow enrolled members (for the affiliate gap) ----
function getMfsnMembers() { return read('mfsn_members', []); }
function setMfsnMembers(list) { write('mfsn_members', Array.isArray(list) ? list : []); return getMfsnMembers(); }
function getMfsnSyncedAt() { return read('mfsn_meta', {}).syncedAt || null; }
function setMfsnSyncedAt(ts) { write('mfsn_meta', { syncedAt: ts }); }

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
  return next;
}

// ---- generic cache with TTL ----
const memCache = {};
function cached(key, ttlMs, fn) {
  const hit = memCache[key];
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  return Promise.resolve(fn()).then(value => {
    memCache[key] = { at: Date.now(), value };
    return value;
  });
}
function clearCache() { for (const k of Object.keys(memCache)) delete memCache[k]; }

module.exports = {
  getConfig, setConfig, getEvents, addEvent, removeEvents, getSnapshots, upsertSnapshot,
  getNotes, addNote, deleteNote, getTasks, addTask, updateTask, deleteTask,
  getTaskNotes, addTaskNote, deleteTaskNote,
  getWorked, setWorked, cached, clearCache, DATA_DIR,
  getMfsnMembers, setMfsnMembers, getMfsnSyncedAt, setMfsnSyncedAt,
  getMfsnOldStatus, setMfsnOldStatus,
  getTickets, addTicket, getTicketViews, markTicketViewed,
  getAffiliateOverrides, setAffiliateOverride,
  getNotifications, addNotification, markNotificationRead, markAllNotificationsRead,
  getDashboardLayout, setDashboardLayout, clearDashboardLayout,
  getDefaultDashboardLayout, setDefaultDashboardLayout, clearAllPersonalDashboardLayouts, clearDefaultDashboardLayout
};
