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
  // /api/clients and /api/pipeline are deliberately not in this list --
  // Clients opens redacted (see the tests below), and Pipeline was
  // explicitly opened up identical to Admin's own view on 2026-08-05.
  for (const p of ['/api/dashboard', '/api/config', '/api/social']) {
    const r = await req(p, { cookie: employeeCookie });
    assert.equal(r.status, 403, `${p} should be 403 for an employee, got ${r.status}`);
  }
});

test('an employee reads the top-level Pipeline identical to Admin, revenue included', async () => {
  // Explicit request on 2026-08-05: unlike Clients, this one is NOT
  // redacted for employees -- same totalRevenue/per-client totalSpent an
  // Admin sees.
  const empRes = await req('/api/pipeline', { cookie: employeeCookie });
  assert.equal(empRes.status, 200);
  const adminRes = await req('/api/pipeline', { cookie: adminCookie });
  assert.equal(adminRes.status, 200);
  assert.deepEqual(await empRes.json(), await adminRes.json(), 'byte-for-byte the same as what Admin sees');
});

test('an employee reads Clients with money fields redacted', async () => {
  const r = await req('/api/clients', { cookie: employeeCookie });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.moneyVisible, false);
  assert.ok(d.clients.length > 0, 'demo data should seed at least one client');
  for (const c of d.clients) {
    assert.ok(!('totalSpent' in c), 'totalSpent must not reach an employee');
    assert.ok(!('numberOfPayments' in c), 'numberOfPayments must not reach an employee');
    assert.ok(!('mfsnStatus' in c), 'mfsnStatus (affiliate/commission) must not reach an employee');
    assert.ok(!('mfsnCommission' in c), 'mfsnCommission (a dollar figure) must not reach an employee');
  }

  const detail = await req('/api/clients/' + d.clients[0].id, { cookie: employeeCookie });
  assert.equal(detail.status, 200);
  const dd = await detail.json();
  assert.equal(dd.moneyVisible, false);
  assert.ok(!('totalSpent' in dd.client));
  assert.ok(!('numberOfPayments' in dd.client));
  assert.deepEqual(dd.payments, [], 'payment history is a list of dollar amounts -- dropped entirely');
});

test('an admin still sees full money fields on Clients', async () => {
  const r = await req('/api/clients', { cookie: adminCookie });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.moneyVisible, true);
  assert.ok(d.clients.length > 0 && 'totalSpent' in d.clients[0]);
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

// ------------------------- dashboard layout default -------------------------

test('a login with no personal dashboard layout gets the shared default once an admin sets one', async () => {
  // Before any default is set, a fresh login sees null (frontend falls
  // back to the layout baked into the HTML).
  const before = await req('/api/dashboard-layout', { cookie: employeeCookie });
  assert.equal(before.status, 200);
  assert.equal((await before.json()).layout, null);

  const nodes = [{ id: 'rev-kpi-total', x: 0, y: 0, w: 4, h: 3 }];
  const setDefault = await req('/api/dashboard-layout/default', {
    method: 'POST', cookie: adminCookie, body: { layout: { nodes } }
  });
  assert.equal(setDefault.status, 200);

  const after = await req('/api/dashboard-layout', { cookie: employeeCookie });
  assert.equal(after.status, 200);
  assert.deepEqual((await after.json()).layout, { nodes });
});

test('an employee cannot set the shared default layout', async () => {
  const r = await req('/api/dashboard-layout/default', {
    method: 'POST', cookie: employeeCookie, body: { layout: { nodes: [] } }
  });
  assert.equal(r.status, 403);
});

test('a personal layout always wins over the shared default', async () => {
  const own = [{ id: 'rev-trend', x: 0, y: 0, w: 12, h: 5 }];
  await req('/api/dashboard-layout', { method: 'POST', cookie: employeeCookie, body: { layout: { nodes: own } } });

  const mine = await req('/api/dashboard-layout', { cookie: employeeCookie });
  assert.deepEqual((await mine.json()).layout, { nodes: own });

  // changing the shared default afterward doesn't touch someone who
  // already has their own saved layout
  await req('/api/dashboard-layout/default', {
    method: 'POST', cookie: adminCookie, body: { layout: { nodes: [{ id: 'mfsn', x: 0, y: 0, w: 12, h: 7 }] } }
  });
  const stillMine = await req('/api/dashboard-layout', { cookie: employeeCookie });
  assert.deepEqual((await stillMine.json()).layout, { nodes: own });
});

test('DELETE /api/dashboard-layout clears a personal override, falling back to the default again', async () => {
  await req('/api/dashboard-layout', { method: 'POST', cookie: employeeCookie, body: { layout: { nodes: [{ id: 'x', x: 0, y: 0, w: 1, h: 1 }] } } });
  const cleared = await req('/api/dashboard-layout', { method: 'DELETE', cookie: employeeCookie });
  assert.equal(cleared.status, 200);
  const after = await req('/api/dashboard-layout', { cookie: employeeCookie });
  // by this point in the suite the default has been set at least once above
  assert.notEqual((await after.json()).layout, null);
});

// ------------------------- admin still works -------------------------

test('an admin reaches the dashboard and config', async () => {
  assert.equal((await req('/api/dashboard', { cookie: adminCookie })).status, 200);
  assert.equal((await req('/api/config', { cookie: adminCookie })).status, 200);
});

// ------------------------- "View as Employee" preview -------------------------

test('an employee can never start a preview', async () => {
  const r = await req('/api/preview/start', { method: 'POST', cookie: employeeCookie });
  assert.equal(r.status, 403);
});

test('View as Employee is a real server-enforced downgrade, round-trips cleanly', async () => {
  // Baseline: real admin, not previewing.
  const before = await (await req('/api/me', { cookie: adminCookie })).json();
  assert.equal(before.role, 'admin');
  assert.equal(before.realRole, 'admin');
  assert.equal(before.previewing, false);

  const started = await req('/api/preview/start', { method: 'POST', cookie: adminCookie });
  assert.equal(started.status, 200);

  const during = await (await req('/api/me', { cookie: adminCookie })).json();
  assert.equal(during.role, 'employee', 'role is the EFFECTIVE role while previewing');
  assert.equal(during.realRole, 'admin', 'the account is still really an admin');
  assert.equal(during.previewing, true);

  // Every guard downstream of req.effectiveRole must now treat this exact
  // same session as an employee -- not a client-side mock.
  assert.equal((await req('/api/dashboard', { cookie: adminCookie })).status, 403);
  assert.equal((await req('/api/config', { cookie: adminCookie })).status, 403);
  const clientsDuringPreview = await req('/api/clients', { cookie: adminCookie });
  assert.equal(clientsDuringPreview.status, 200);
  assert.equal((await clientsDuringPreview.json()).moneyVisible, false);
  // Deal Production stays reachable, same as a real employee.
  assert.equal((await req('/api/production', { cookie: adminCookie })).status, 200);

  // Exiting must work from the very session that's mid-preview (real role,
  // not effective role, gates this route -- see server.js).
  const stopped = await req('/api/preview/stop', { method: 'POST', cookie: adminCookie });
  assert.equal(stopped.status, 200);

  const after = await (await req('/api/me', { cookie: adminCookie })).json();
  assert.equal(after.role, 'admin');
  assert.equal(after.previewing, false);
  assert.equal((await req('/api/dashboard', { cookie: adminCookie })).status, 200, 'full admin access restored, same session, no re-login');
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
