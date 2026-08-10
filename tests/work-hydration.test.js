// Tasks, task notes and client notes mirrored into Postgres on every write
// but were never read back. On this host (no persistent disk) that meant a
// spin-down looked like data loss even though the rows were safe in Supabase.
// Same restore-only-when-empty shape as hydrateEventsFromPostgres.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshStore() {
  delete require.cache[require.resolve('../lib/store')];
  delete require.cache[require.resolve('../lib/db')];
  delete require.cache[require.resolve('../lib/crypto')];
  return require('../lib/store');
}

function isolatedDataDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-' + tag + '-'));
  process.env.DATA_DIR = dir;
  return dir;
}

test('hydrateTasksFromPostgres(): no-op when Postgres is not configured', async () => {
  const dir = isolatedDataDir('taskhy');
  delete process.env.DATABASE_URL;
  const store = freshStore();
  await store.hydrateTasksFromPostgres();
  assert.deepEqual(store.getTasks(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateTasksFromPostgres(): restores what someone actually typed', async () => {
  const dir = isolatedDataDir('taskhy');
  const store = freshStore();
  const db = require('../lib/db');
  db.isEnabled = () => true;
  db.query = async () => ({ rows: [{
    id: 7, title: 'Chase Experian round 3', due_at: '2026-08-14T00:00:00.000Z',
    is_done: false, done_at: null, description: 'waiting on POA',
    created_at: '2026-08-01T10:00:00.000Z', ghl_contact_id: 'ghl-abc'
  }] });

  await store.hydrateTasksFromPostgres();
  const tasks = store.getTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'Chase Experian round 3');
  assert.equal(tasks[0].notes, 'waiting on POA');
  assert.equal(tasks[0].done, false);
  assert.equal(tasks[0].due, '2026-08-14');
  // The client link survives as the GHL contact id the JSON side keys on,
  // not the Postgres row id.
  assert.equal(tasks[0].clientId, 'ghl-abc');
  // .pgId re-established so a later update/delete can mirror the same row.
  assert.equal(tasks[0].pgId, 7);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateTasksFromPostgres(): never overwrites a local list that already has tasks', async () => {
  const dir = isolatedDataDir('taskhy');
  const store = freshStore();
  const db = require('../lib/db');
  store.addTask({ title: 'local task' });
  db.isEnabled = () => true;
  db.query = async () => ({ rows: [{
    id: 1, title: 'from postgres', due_at: null, is_done: false, done_at: null,
    description: null, created_at: '2026-01-01T00:00:00.000Z', ghl_contact_id: null
  }] });

  await store.hydrateTasksFromPostgres();
  const tasks = store.getTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, 'local task', 'a live local file wins over an older mirror');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateTaskNotesFromPostgres(): thread ids line up with the restored tasks', async () => {
  const dir = isolatedDataDir('tnhy');
  const store = freshStore();
  const db = require('../lib/db');
  db.isEnabled = () => true;
  db.query = async () => ({ rows: [{
    id: 3, task_id: 7, body: 'left a voicemail', created_at: '2026-08-02T09:00:00.000Z'
  }] });

  await store.hydrateTaskNotesFromPostgres();
  const notes = store.getTaskNotes ? store.getTaskNotes(7) : null;
  // getTaskNotes filters by taskId, so assert on the raw restored shape:
  // both sides derive their id from the same Postgres id, so they match.
  const all = JSON.parse(fs.readFileSync(path.join(dir, 'taskNotes.json'), 'utf8'));
  assert.equal(all.length, 1);
  assert.equal(all[0].taskId, 'pg-task-7');
  assert.equal(all[0].text, 'left a voicemail');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateNotesFromPostgres(): restores client notes keyed by GHL contact id', async () => {
  const dir = isolatedDataDir('nhy');
  const store = freshStore();
  const db = require('../lib/db');
  db.isEnabled = () => true;
  db.query = async () => ({ rows: [{
    id: 11, body: 'client says docs are coming Friday',
    created_at: '2026-08-03T12:00:00.000Z', ghl_contact_id: 'ghl-xyz'
  }] });

  await store.hydrateNotesFromPostgres();
  const notes = store.getNotes('ghl-xyz');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, 'client says docs are coming Friday');
  fs.rmSync(dir, { recursive: true, force: true });
});
