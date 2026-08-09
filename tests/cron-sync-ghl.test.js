// Automatic 12h GHL -> Deal Production sync, triggered externally (GitHub
// Actions, see .github/workflows/sync-ghl.yml) since an in-process
// setInterval would be unreliable on a free-tier host that sleeps after
// idle. Gated by CRON_SECRET (a plain env var, separate from the
// Settings-configured webhookSecret) since there's no session cookie to
// check -- this test is about the auth gate and wiring, not reconcile's
// business logic (already covered by tests/reconcile.test.js).
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-cron-test-'));
process.env.APP_PASSWORD = 'test-admin-pw';
process.env.CRON_SECRET = 'test-cron-secret-value';
fs.writeFileSync(path.join(process.env.DATA_DIR, 'production.json'), JSON.stringify([]));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server;

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  delete process.env.CRON_SECRET;
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('no CRON_SECRET header at all is rejected', async () => {
  const r = await fetch(base + '/internal/cron/sync-ghl', { method: 'POST' });
  assert.equal(r.status, 401);
});

test('a wrong CRON_SECRET is rejected', async () => {
  const r = await fetch(base + '/internal/cron/sync-ghl', {
    method: 'POST', headers: { 'x-cron-secret': 'not-the-right-value' }
  });
  assert.equal(r.status, 401);
});

test('no admin session or cookie is required -- only the header secret', async () => {
  const r = await fetch(base + '/internal/cron/sync-ghl', {
    method: 'POST', headers: { 'x-cron-secret': 'test-cron-secret-value' }
  });
  assert.notEqual(r.status, 401);
  assert.notEqual(r.status, 403);
});

test('the correct secret runs the reconcile and returns its shape', async () => {
  const r = await fetch(base + '/internal/cron/sync-ghl', {
    method: 'POST', headers: { 'x-cron-secret': 'test-cron-secret-value' }
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.addedCount, 'number');
  assert.ok(Array.isArray(body.added));
  assert.equal(typeof body.notInGhlCount, 'number');
});

test('CRON_SECRET unset entirely reports 503, not a confusing 401', async () => {
  delete process.env.CRON_SECRET;
  const r = await fetch(base + '/internal/cron/sync-ghl', {
    method: 'POST', headers: { 'x-cron-secret': 'anything' }
  });
  assert.equal(r.status, 503);
  process.env.CRON_SECRET = 'test-cron-secret-value';
});
