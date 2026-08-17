// POST /webhooks/sheet-sync -- the n8n Google-Sheet sync, tested against the
// real Express app. No DATABASE_URL/APP_ENCRYPTION_KEY in this environment,
// so Postgres calls no-op and everything lands in the JSON backup -- exactly
// the same fallback path a real Postgres outage would take, and the only
// way to assert on write outcomes without touching the live database.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-sheetsync-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const dealProd = require('../lib/production');
const { shamond, barbrielle, kaleel } = require('./fixtures/sheet-rows');

let base, server;

function req(pathname, { method = 'GET', body, headers } = {}) {
  return fetch(base + pathname, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

// Real n8n envelope shape, verified from the actual webhook payload: an
// array wrapping n8n's own trigger data ({headers, body, ...}), not a bare
// array of sheet rows.
function n8nEnvelope(items) {
  return [{
    headers: { host: 'stratex.app.n8n.cloud', 'user-agent': 'n8n' },
    params: {}, query: {}, body: items,
    webhookUrl: 'https://stratex.app.n8n.cloud/webhook/test', executionMode: 'production'
  }];
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

test('rejects a bad secret once one is configured', async () => {
  const admin = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-pw' } });
  const cookie = admin.headers.get('set-cookie').split(';')[0];
  await fetch(base + '/api/config', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ webhookSecret: 'shh-its-a-secret' })
  });

  const r = await req('/webhooks/sheet-sync?secret=wrong', { method: 'POST', body: n8nEnvelope([shamond]) });
  assert.equal(r.status, 401);
});

test('is exempt from the session gate (no cookie needed, right secret)', async () => {
  // A synthetic, non-seed-colliding row -- kept separate from the real
  // shamond/barbrielle/kaleel fixtures below so this test's side effect
  // doesn't change what the next test expects to see.
  const isolated = { ...shamond, NAME: 'Isolation Exempt', id: 999 };
  const r = await req('/webhooks/sheet-sync?secret=shh-its-a-secret', { method: 'POST', body: n8nEnvelope([isolated]) });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.createdCount, 1, 'a genuinely new sheet-only name with no GHL/existing match is created');
});

test('400s on a body that is not the expected n8n envelope shape', async () => {
  const r = await req('/webhooks/sheet-sync?secret=shh-its-a-secret', { method: 'POST', body: { nonsense: true } });
  assert.equal(r.status, 400);
});

// Found during self-check, not assumed going in: these three names are NOT
// fresh -- production-seed.json (the real, pre-migration client data this
// app already ships) has them under the redacted "First L." format used
// before GHL linking ("Shamond A." / C1049, "Barbrielle H." / C1050,
// "Kaleel H." / C1052), with pkg/tu/eq/ex already matching what this exact
// payload says except Kaleel's tu/ex round count and stage (seed says
// Completed/round 6; the sheet's "Resolved" with only 3 filed-round dates
// says round 3 -- a real drift the sync is supposed to catch). So the
// first real fire is an UPDATE path, not a create path -- this is actually
// the realistic case for a production sheet-sync run.
test('ingests a real payload: updates real seeded clients, corrects drifted data', async () => {
  const r = await req('/webhooks/sheet-sync?secret=shh-its-a-secret', {
    method: 'POST', body: n8nEnvelope([shamond, barbrielle, kaleel])
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.receivedCount, 3);
  assert.equal(d.createdCount, 0, 'all three already exist in the seed, matched by the first-name+last-initial fallback key');
  assert.equal(d.updatesCount, 3);
  assert.deepEqual(d.updates.sort(), ['C1049', 'C1050', 'C1052']);
  assert.equal(d.duplicateNameCount, 0);

  const prod = await dealProd.readProd();
  const shamondRec = prod.find(c => c.id === 'C1049');
  assert.equal(shamondRec.name, 'Shamond A.', 'no GHL match means the redacted name is not upgraded -- inherited from reconcileSheet, not new behavior');
  assert.equal(shamondRec.pkg, '6-Month Credit Repair Package');
  assert.deepEqual(shamondRec.tu, { r: 6, st: 'done' });
  assert.equal(shamondRec.cfpb.length, 6, 'the seed had no cfpb data at all -- all 6 filed rounds are now attached');

  const kaleelRec = prod.find(c => c.id === 'C1052');
  assert.equal(kaleelRec.stage, 'In rounds', 'corrected from the seed\'s stale "Completed" -- EQ is actually "-" per the sheet');
  assert.deepEqual(kaleelRec.tu, { r: 3, st: 'done' }, 'seed said round 6; "Resolved" with only 3 filed-round dates says round 3');
});

test('malformed dates are stored raw on the updated record, never dropped', async () => {
  const prod = await dealProd.readProd();
  const shamondRec = prod.find(c => c.id === 'C1049');
  const r5 = shamondRec.cfpb.find(c => c.round === 5);
  assert.equal(r5.date, '12/22 antonette');
  const r6 = shamondRec.cfpb.find(c => c.round === 6);
  assert.equal(r6.date, '01/30/2026 Mber');
});

test('CFPB passwords are never stored in the clear when APP_ENCRYPTION_KEY is unset', async () => {
  const prod = await dealProd.readProd();
  const shamondRec = prod.find(c => c.id === 'C1049');
  assert.ok(shamondRec.cfpb.every(c => !c.pw), 'every password was stripped, not written as plaintext');
  assert.ok(!JSON.stringify(prod).includes('Credit24Credit24!'), 'the real plaintext password never made it into the JSON backup at all');
});

test('re-firing the identical payload is idempotent: no new records, no repeat updates, no duplicate rows', async () => {
  const before = await dealProd.readProd();
  const beforeCount = before.length;

  const r = await req('/webhooks/sheet-sync?secret=shh-its-a-secret', {
    method: 'POST', body: n8nEnvelope([shamond, barbrielle, kaleel])
  });
  const d = await r.json();
  assert.equal(d.createdCount, 0);
  assert.equal(d.updatesCount, 0, 'every field already matches after the first sync -- reconcileSheet produces no diff at all, not just an empty create list');

  const after = await dealProd.readProd();
  assert.equal(after.length, beforeCount, 'roster size is unchanged after the re-fire');
  assert.equal(after.filter(c => c.id === 'C1049').length, 1, 'no duplicate row for the same person');
});

test('a duplicate name within one payload is reported, never silently merged', async () => {
  const twinA = { ...shamond, NAME: 'Pat Twin', id: 900 };
  const twinB = { ...barbrielle, NAME: 'Pat Twin', id: 901 };
  const before = await dealProd.readProd();

  const r = await req('/webhooks/sheet-sync?secret=shh-its-a-secret', { method: 'POST', body: n8nEnvelope([twinA, twinB]) });
  const d = await r.json();
  assert.equal(d.duplicateNameCount, 2);
  assert.deepEqual(d.duplicateNames.sort(), ['Pat Twin', 'Pat Twin']);
  assert.equal(d.createdCount, 0, 'neither ambiguous row is created');

  const after = await dealProd.readProd();
  assert.equal(after.length, before.length, 'the collision produced no new rows at all');
});
