// Integration tests: the boundary must hold in the real Express app, not just
// in lib/auth.js. These are the assertions the feature actually rests on.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Isolate from real data before anything requires lib/store.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-test-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base;
let server;
let adminCookie;
let employeeCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method,
    redirect: 'manual',
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

  const created = await req('/api/users', {
    method: 'POST',
    cookie: adminCookie,
    body: { username: 'va1', name: 'VA One', role: 'employee', password: 'va-pw' }
  });
  assert.equal(created.status, 200, 'admin should be able to create an employee');

  employeeCookie = await login('va1', 'va-pw');
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

// ------------------------- the boundary -------------------------

test('an employee is refused the money and admin APIs', async () => {
  for (const p of ['/api/dashboard', '/api/config', '/api/clients', '/api/pipeline', '/api/social']) {
    const r = await req(p, { cookie: employeeCookie });
    assert.equal(r.status, 403, `${p} should be 403 for an employee, got ${r.status}`);
  }
});

test('an employee is refused the bulk production overwrite', async () => {
  const r = await req('/api/production', { method: 'POST', cookie: employeeCookie, body: { clients: [] } });
  assert.equal(r.status, 403);
});

test('an employee may read the Deal Production tracker', async () => {
  const r = await req('/api/production', { cookie: employeeCookie });
  assert.equal(r.status, 200);
});

test('an employee cannot read personal-finances.js', async () => {
  // The balances are hardcoded in that file; gating the API would not help.
  const r = await req('/personal-finances.js', { cookie: employeeCookie });
  assert.equal(r.status, 403);
});

test('an employee can still load the app shell and its own script', async () => {
  assert.equal((await req('/production.js', { cookie: employeeCookie })).status, 200);
  assert.equal((await req('/index.html', { cookie: employeeCookie })).status, 200);
});

test('an employee cannot create users', async () => {
  const r = await req('/api/users', {
    method: 'POST', cookie: employeeCookie,
    body: { username: 'sneaky', role: 'admin', password: 'x' }
  });
  assert.equal(r.status, 403);
});

test('an employee can read the login directory, for the assignee dropdown', async () => {
  const r = await req('/api/users', { cookie: employeeCookie });
  assert.equal(r.status, 200);
  const list = await r.json();
  assert.ok(Array.isArray(list));
  assert.ok(!('password' in (list[0] || {})), 'no password field leaks to an employee');
});

test('an employee can create, note, and complete a Follow-Ups task', async () => {
  const created = await req('/api/tasks', {
    method: 'POST', cookie: employeeCookie,
    body: { title: 'employee follow-up' }
  });
  assert.equal(created.status, 200);
  const task = await created.json();

  const noted = await req(`/api/tasks/${task.id}/notes`, {
    method: 'POST', cookie: employeeCookie,
    body: { text: 'left a note as an employee' }
  });
  assert.equal(noted.status, 200);

  const listed = await req(`/api/tasks/${task.id}/notes`, { cookie: employeeCookie });
  assert.equal(listed.status, 200);
  const notes = await listed.json();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].authorName, 'VA One');

  const patched = await req(`/api/tasks/${task.id}`, {
    method: 'PATCH', cookie: employeeCookie, body: { done: true }
  });
  assert.equal(patched.status, 200);
});

// ------------------------- admin still works -------------------------

test('an admin reaches the dashboard and config', async () => {
  assert.equal((await req('/api/dashboard', { cookie: adminCookie })).status, 200);
  assert.equal((await req('/api/config', { cookie: adminCookie })).status, 200);
});

test('the legacy shared password still logs the admin in', async () => {
  // Migration guarantee: Tiffany must not be locked out on deploy.
  const r = await req('/api/login', { method: 'POST', body: { username: 'admin', password: 'test-admin-pw' } });
  assert.equal(r.status, 200);
});

// ------------------------- tampering -------------------------

test('a forged session cookie is rejected', async () => {
  const r = await req('/api/production', { cookie: 'msfs=deadbeefdeadbeef' });
  assert.equal(r.status, 401);
});

test('no cookie at all is rejected on the API', async () => {
  const r = await req('/api/production');
  assert.equal(r.status, 401);
});

test('/api/me reports the caller role', async () => {
  const r = await req('/api/me', { cookie: employeeCookie });
  const body = await r.json();
  assert.equal(body.role, 'employee');
  assert.equal(body.name, 'VA One');
});

test('/api/me includes the id, so Settings can change your own password', async () => {
  const me = await (await req('/api/me', { cookie: adminCookie })).json();
  assert.ok(me.id, 'id is needed to PATCH your own user');
});

test('disabling a user cuts off their existing session immediately', async () => {
  // Revocation that waits for cookie expiry is not revocation.
  await req('/api/users', {
    method: 'POST', cookie: adminCookie,
    body: { username: 'va2', name: 'VA Two', role: 'employee', password: 'pw2' }
  });
  const cookie = await login('va2', 'pw2');
  assert.equal((await req('/api/production', { cookie })).status, 200);

  const list = await (await req('/api/users', { cookie: adminCookie })).json();
  const va2 = list.find(u => u.username === 'va2');
  await req('/api/users/' + va2.id, { method: 'PATCH', cookie: adminCookie, body: { disabled: true } });

  assert.equal((await req('/api/production', { cookie })).status, 401, 'session must die at once');
});

test('the last admin cannot be disabled', async () => {
  // Otherwise the dashboard becomes unadministrable and nobody can undo it.
  const list = await (await req('/api/users', { cookie: adminCookie })).json();
  const admin = list.find(u => u.role === 'admin');
  const r = await req('/api/users/' + admin.id, { method: 'PATCH', cookie: adminCookie, body: { disabled: true } });
  assert.equal(r.status, 400);
  assert.equal((await req('/api/dashboard', { cookie: adminCookie })).status, 200, 'admin still works');
});

test('a disabled user cannot log back in', async () => {
  const r = await req('/api/login', { method: 'POST', body: { username: 'va2', password: 'pw2' } });
  assert.equal(r.status, 401);
});

test('signing out invalidates the session', async () => {
  const cookie = await login('va1', 'va-pw');
  assert.equal((await req('/api/production', { cookie })).status, 200);
  await req('/api/logout', { method: 'POST', cookie });
  assert.equal((await req('/api/production', { cookie })).status, 401);
});
