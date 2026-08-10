// Previewing was the only way to see what a worker actually gets without
// creating an account and signing out -- and it was hardcoded to 'employee',
// so the VA and disputer views could not be checked from an admin session at
// all. That is a large part of why they shipped unusable.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-preview-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const auth = require('../lib/auth.js');

let base, server, cookie;
const req = (p, o = {}) => fetch(base + p, {
  method: o.method || 'GET', redirect: 'manual',
  headers: Object.assign({}, cookie ? { cookie } : {}, o.body ? { 'content-type': 'application/json' } : {}),
  body: o.body ? JSON.stringify(o.body) : undefined
});

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-admin-pw' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => server && server.close());

test('every non-admin preset can be previewed', async () => {
  for (const role of Object.keys(auth.ROLE_CAPS).filter(r => r !== 'admin')) {
    const r = await req('/api/preview/start', { method: 'POST', body: { role } });
    assert.equal(r.status, 200, `could not preview as ${role}`);
    const me = await (await req('/api/me')).json();
    assert.equal(me.role, role, `/api/me should report the previewed role`);
    assert.equal(me.realRole, 'admin', 'the real role must not change');
    assert.deepEqual(me.capabilities.slice().sort(), auth.ROLE_CAPS[role].slice().sort(),
      'previewing should carry that preset exactly, or it is not a real preview');
    await req('/api/preview/stop', { method: 'POST' });
  }
});

test('previewing as admin is refused', async () => {
  // It would be a no-op that looks like it worked, and it is the one value
  // that could quietly re-grant everything mid-preview.
  const r = await req('/api/preview/start', { method: 'POST', body: { role: 'admin' } });
  assert.equal(r.status, 400);
});

test('a supplied but unknown role is refused rather than defaulting', async () => {
  for (const role of ['owner', '', 'ADMIN', 'va; drop']) {
    const r = await req('/api/preview/start', { method: 'POST', body: { role } });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(role)}`);
  }
});

test('omitting the role still means employee, for a stale cached client', async () => {
  // A browser running a cached copy of the old role.js posts no body at all.
  // That case has to keep working, which is not the same as accepting junk.
  const r = await req('/api/preview/start', { method: 'POST' });
  assert.equal(r.status, 200);
  const me = await (await req('/api/me')).json();
  assert.equal(me.role, 'employee');
  await req('/api/preview/stop', { method: 'POST' });
});

test('a preview really loses access, it is not just a cosmetic switch', async () => {
  await req('/api/preview/start', { method: 'POST', body: { role: 'disputer' } });
  const dash = await req('/api/dashboard');
  assert.equal(dash.status, 403, 'a previewed disputer should be refused the money view');
  const q = await req('/api/disputes/queue');
  assert.ok(q.status === 200 || q.status === 503, 'but should still reach their own queue');
  await req('/api/preview/stop', { method: 'POST' });
});

test('stopping the preview restores admin', async () => {
  await req('/api/preview/start', { method: 'POST', body: { role: 'va' } });
  await req('/api/preview/stop', { method: 'POST' });
  const me = await (await req('/api/me')).json();
  assert.equal(me.role, 'admin');
  assert.equal(me.previewing, false);
});

test('the picker offers every previewable role', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const sel = page.split('id="viewAsEmployeeBtn"')[1].split('</select>')[0];
  for (const role of Object.keys(auth.ROLE_CAPS).filter(r => r !== 'admin')) {
    assert.ok(sel.includes(`value="${role}"`), `the picker cannot preview ${role}`);
  }
  assert.ok(!sel.includes('value="admin"'), 'admin is not a preview target');
});
