// events.json (payments/disputes/sms log) is wiped on every restart on this
// host (no persistent disk). The Data Sources health check (paymentFeedOk/
// disputeFeedOk) is purely "how recent is the last event in this file" --
// live-verified this session: a real redeploy wiped it and both Fanbasis and
// DisputeFox showed "Fix" in the UI even though the underlying Postgres data
// (and the real Zapier feeds) were completely fine. hydrateEventsFromPostgres
// restores the merged event log from the three typed tables once at boot,
// same pattern as hydrateConfigFromPostgres / hydrateMfsnFromPostgres.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-events-hydrate-'));
  process.env.DATA_DIR = dir;
  return dir;
}

test('hydrateEventsFromPostgres(): no-op when Postgres is not configured', async () => {
  const dir = isolatedDataDir();
  delete process.env.DATABASE_URL;
  const store = freshStore();

  await store.hydrateEventsFromPostgres();
  assert.deepEqual(store.getEvents(), []);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateEventsFromPostgres(): restores payments, disputes, and sms events, merged and sorted', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async (sql) => {
    if (/from payments/i.test(sql)) return { rows: [{
      id: 2, email: 'natarra@x.com', name: 'Natarra Waters', phone: null,
      amount: '75.00', product: '3 EXPEDITED ROUNDS',
      sale_at: '2026-07-06T18:39:36.000Z', received_at: '2026-08-10T01:38:16.564Z'
    }] };
    if (/from disputes/i.test(sql)) return { rows: [{
      id: 1, email: 'deja@x.com', name: 'Deja Tunstill', round_number: null,
      action: 'response_received', event_at: '2026-08-10T01:31:38.835Z', received_at: '2026-08-10T01:31:38.835Z'
    }] };
    if (/from sms_events/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };

  await store.hydrateEventsFromPostgres();

  const events = store.getEvents();
  assert.equal(events.length, 2);
  const payment = events.find(e => e.type === 'payment');
  assert.equal(payment.email, 'natarra@x.com');
  assert.equal(payment.amount, 75);
  assert.equal(payment.product, '3 EXPEDITED ROUNDS');
  const dispute = events.find(e => e.type === 'dispute');
  assert.equal(dispute.action, 'response_received');
  // sorted oldest-received first, same order addEvent() would have produced
  assert.equal(events[0].email, 'deja@x.com');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateEventsFromPostgres(): never overwrites a local log that already has events', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  store.addEvent({ type: 'payment', at: new Date().toISOString(), email: 'local@x.com', amount: 10 });

  let queried = false;
  db.isEnabled = () => true;
  db.query = async () => { queried = true; return { rows: [] }; };

  await store.hydrateEventsFromPostgres();

  assert.equal(queried, false, 'should short-circuit before querying when local events already exist');
  assert.equal(store.getEvents().length, 1);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('hydrateEventsFromPostgres(): a Postgres error during hydration does not throw or block boot', async () => {
  const dir = isolatedDataDir();
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async () => { throw new Error('connection refused'); };

  await assert.doesNotReject(() => store.hydrateEventsFromPostgres());

  fs.rmSync(dir, { recursive: true, force: true });
});

test('a restored payment event makes /api/dashboard report the Fanbasis feed healthy again', async () => {
  const dir = isolatedDataDir();
  process.env.APP_PASSWORD = 'test-admin-pw';
  const store = freshStore();
  const db = require('../lib/db');

  db.isEnabled = () => true;
  db.query = async (sql) => {
    if (/from payments/i.test(sql)) return { rows: [{
      id: 1, email: 'a@x.com', name: 'A', phone: null, amount: '50.00', product: 'Help me fix it',
      sale_at: new Date().toISOString(), received_at: new Date().toISOString()
    }] };
    return { rows: [] };
  };
  await store.hydrateEventsFromPostgres();

  delete require.cache[require.resolve('../server')];
  const app = require('../server');
  const server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  const base = `http://127.0.0.1:${server.address().port}`;

  const loginRes = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pw' })
  });
  const cookie = loginRes.headers.get('set-cookie').split(';')[0];
  const d = await (await fetch(base + '/api/dashboard', { headers: { cookie } })).json();

  assert.equal(d.health.paymentFeedOk, true);

  server.close();
  delete process.env.APP_PASSWORD;
  fs.rmSync(dir, { recursive: true, force: true });
});
