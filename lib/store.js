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
// note: { id, clientId, text, at }
function getNotes(clientId) {
  const all = read('notes', []);
  return clientId ? all.filter(n => n.clientId === clientId) : all;
}
function addNote(clientId, text) {
  const all = read('notes', []);
  const note = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), clientId, text, at: new Date().toISOString() };
  all.push(note); write('notes', all); return note;
}
function deleteNote(id) {
  write('notes', read('notes', []).filter(n => n.id !== id));
}

// ---- tasks / follow-ups ----
// task: { id, title, clientId?, clientName?, due?, done, createdAt, doneAt? }
function getTasks() { return read('tasks', []); }
function addTask(t) {
  const all = getTasks();
  const task = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 6), done: false, createdAt: new Date().toISOString(), ...t };
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
  getWorked, setWorked, cached, clearCache, DATA_DIR,
  getMfsnMembers, setMfsnMembers, getMfsnSyncedAt, setMfsnSyncedAt,
  getTickets, addTicket, getTicketViews, markTicketViewed,
  getAffiliateOverrides, setAffiliateOverride
};
