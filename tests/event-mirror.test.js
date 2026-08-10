// store.addEvent() mirrors payment/dispute/sms webhook events into their
// typed Postgres tables (payments/disputes/sms_events) as a best-effort,
// un-awaited background write -- JSON stays the source of truth for reads.
// This file guards the exact column mapping, since a mismatch here means
// Supabase silently holds a different value than what the dashboard (which
// reads from JSON) actually displays.
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

function isolatedDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-event-mirror-'));
  process.env.DATA_DIR = dir;
  return dir;
}

function mockDb(capture) {
  const db = require('../lib/db');
  db.isEnabled = () => true;
  db.query = async (sql, params) => {
    capture.sql = sql;
    capture.params = params;
    return { rows: [{ id: 1 }] };
  };
  return db;
}

test('addEvent(): a real DisputeFox action (e.g. "response_received") reaches the disputes.action column, not the "dispute_sent" fallback', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const capture = {};
  mockDb(capture);

  store.addEvent({
    type: 'dispute', at: new Date().toISOString(),
    email: 'client@example.com', name: 'Real Client',
    round: 2, action: 'response_received'
  });
  await new Promise(r => setTimeout(r, 20));

  assert.match(capture.sql, /insert into disputes/i);
  assert.equal(capture.params[4], 'response_received', 'the real webhook action must be mirrored verbatim, not overwritten with the fallback');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('addEvent(): dispute mirror still falls back to "dispute_sent" when no action was ever captured', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const capture = {};
  mockDb(capture);

  store.addEvent({ type: 'dispute', at: new Date().toISOString(), email: 'a@b.com', name: 'A B' });
  await new Promise(r => setTimeout(r, 20));

  assert.equal(capture.params[4], 'dispute_sent');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('addEvent(): payment mirror sends email/name/amount/product to the payments table', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const capture = {};
  mockDb(capture);

  store.addEvent({
    type: 'payment', at: new Date().toISOString(),
    email: 'payer@example.com', name: 'Payer Name', amount: 99.5, product: '3 Rounds'
  });
  await new Promise(r => setTimeout(r, 20));

  assert.match(capture.sql, /insert into payments/i);
  assert.equal(capture.params[1], 'payer@example.com');
  assert.equal(capture.params[2], 'Payer Name');
  assert.equal(capture.params[4], 99.5);
  assert.equal(capture.params[5], '3 Rounds');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('addEvent(): JSON write always succeeds even when the Postgres mirror throws', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');
  db.isEnabled = () => true;
  db.query = async () => { throw new Error('connection refused'); };

  const saved = store.addEvent({ type: 'dispute', at: new Date().toISOString(), email: 'x@y.com', name: 'X Y', action: 'round_sent' });
  await new Promise(r => setTimeout(r, 20));

  const events = store.getEvents();
  assert.ok(events.find(e => e.id === saved.id), 'event must be in JSON regardless of the Postgres mirror outcome');

  fs.rmSync(dir, { recursive: true, force: true });
});
