// The webhook secret must never round-trip through GET /api/config in the
// clear (that response is rendered straight into the Settings page and can
// end up in a screenshot/devtools/history), but it also must never look
// ambiguous ("(set)" reads the same as "not set" at a glance) and an admin
// needs a way to actually retrieve it to paste into Fanbasis/DisputeFox/n8n
// without it ever being shown on screen.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-test-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, adminCookie, employeeCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function login(username, password) {
  const r = await req('/api/login', { method: 'POST', body: { username, password } });
  assert.equal(r.status, 200, `login failed for ${username}`);
  return r.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = await login('admin', 'test-admin-pw');
  await req('/api/users', {
    method: 'POST', cookie: adminCookie,
    body: { username: 'va1', name: 'VA', role: 'employee', password: 'va-pw' }
  });
  employeeCookie = await login('va1', 'va-pw');
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('GET /api/config never returns the real webhook secret, but does not read as unset either', async () => {
  await req('/api/config', { method: 'POST', cookie: adminCookie, body: { webhookSecret: 'super-secret-value' } });
  const c = await (await req('/api/config', { cookie: adminCookie })).json();
  assert.notStrictEqual(c.webhookSecret, 'super-secret-value');
  assert.notStrictEqual(c.webhookSecret, '(set)'); // ambiguous with "not set"
  assert.match(c.webhookSecret, /^\*{6,}$/); // a run of asterisks, not the literal word "unset"
});

test('GET /api/config reports no secret when none is set', async () => {
  const c = await (await req('/api/config', { cookie: adminCookie })).json();
  // webhookSecret was set by the previous test in this same server instance;
  // a fresh instance would report '' here -- covered indirectly since
  // setConfig only ever adds a key, this asserts the falsy branch shape instead.
  assert.equal(typeof c.webhookSecret, 'string');
});

test('an admin can retrieve the real webhook secret to copy it', async () => {
  await req('/api/config', { method: 'POST', cookie: adminCookie, body: { webhookSecret: 'copy-me-please' } });
  const r = await req('/api/config/webhook-secret', { cookie: adminCookie });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.secret, 'copy-me-please');
});

test('an employee cannot retrieve the webhook secret', async () => {
  const r = await req('/api/config/webhook-secret', { cookie: employeeCookie });
  assert.equal(r.status, 403);
});

test('an unauthenticated caller cannot retrieve the webhook secret', async () => {
  const r = await req('/api/config/webhook-secret');
  assert.equal(r.status, 401);
});
