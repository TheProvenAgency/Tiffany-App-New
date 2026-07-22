// READ_ONLY protects Tiffany's real GoHighLevel account while developing
// locally against live credentials. Only two routes can write to GHL:
// status write-back (tag changes) and sending an SMS to a real client.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-ro-'));
process.env.APP_PASSWORD = 'test-admin-pw';
process.env.READ_ONLY = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, adminCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;

  const r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-pw' } });
  adminCookie = r.headers.get('set-cookie').split(';')[0];

  // Fake credentials are enough to flip liveMode() on. If the guard failed to
  // fire, the route would try to reach GoHighLevel with them and fail
  // differently — so a 403 proves the guard ran first.
  await req('/api/config', {
    method: 'POST', cookie: adminCookie,
    body: { ghlToken: 'pit-fake-token', ghlLocationId: 'fake-location' }
  });
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('a status write-back to live GoHighLevel is refused', async () => {
  const r = await req('/api/clients/fake-contact/status', {
    method: 'POST', cookie: adminCookie, body: { status: 'inactive' }
  });
  assert.equal(r.status, 403);
  const body = await r.json();
  assert.match(body.error, /read-only/i, 'the refusal must say why');
});

test('sending an SMS to a real client is refused', async () => {
  const r = await req('/api/clients/fake-contact/sms', {
    method: 'POST', cookie: adminCookie, body: { message: 'test message' }
  });
  assert.equal(r.status, 403);
});

test('the refusal is visible, never a silent success', async () => {
  // A 200 here would be the worst outcome: you would believe the tag changed.
  const r = await req('/api/clients/fake-contact/status', {
    method: 'POST', cookie: adminCookie, body: { status: 'active' }
  });
  assert.notEqual(r.status, 200);
});

test('reads and local-only writes are unaffected', async () => {
  assert.equal((await req('/api/tasks', { cookie: adminCookie })).status, 200);
  const r = await req('/api/tasks', { method: 'POST', cookie: adminCookie, body: { title: 'local task' } });
  assert.equal(r.status, 200, 'local storage writes are not GoHighLevel writes');
});
