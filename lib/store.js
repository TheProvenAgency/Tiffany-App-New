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
  getConfig, setConfig, getEvents, addEvent, getSnapshots, upsertSnapshot,
  getNotes, addNote, deleteNote, getTasks, addTask, updateTask, deleteTask,
  getWorked, setWorked, cached, clearCache, DATA_DIR
};
