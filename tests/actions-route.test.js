// Integration test for the Today queue. lib/actions.js was fully unit-tested
// and green while the route returned 500, because server.js was missing its
// require -- unit tests on a module say nothing about whether the app has
// been wired to it. This is the test that would have caught it.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-actions-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, adminCookie, disputerCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method, redirect: 'manual',
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

  await req('/api/users', { method: 'POST', cookie: adminCookie,
    body: { username: 'dq', name: 'D Q', role: 'disputer', password: 'dq-pw-123' } });
  const dr = await req('/api/login', { method: 'POST', body: { username: 'dq', password: 'dq-pw-123' } });
  if (dr.status === 200) disputerCookie = dr.headers.get('set-cookie').split(';')[0];
});

after(() => server && server.close());

test('the route is actually wired up and answers', async () => {
  const r = await req('/api/actions', { cookie: adminCookie });
  assert.equal(r.status, 200, 'a 500 here means server.js is not wired to lib/actions.js');
  const d = await r.json();
  assert.ok(Array.isArray(d.items));
  assert.ok(d.totals && typeof d.totals === 'object');
});

test('an unauthenticated caller gets nothing', async () => {
  const r = await req('/api/actions');
  assert.ok(r.status === 401 || r.status === 302, `expected a rejection, got ${r.status}`);
});

test('a disputer gets their rounds and no money at all', async (t) => {
  if (!disputerCookie) return t.skip('disputer account unavailable');
  const r = await req('/api/actions', { cookie: disputerCookie });
  assert.equal(r.status, 200);
  const body = await r.text();
  const d = JSON.parse(body);
  assert.ok(d.items.every(i => i.type === 'round'), 'a disputer should only see round work');
  assert.equal(d.totals.monthlyValue, undefined, 'no money total for a disputer');
  assert.equal(d.totals.backlogMonthlyValue, undefined);
  assert.ok(!/"monthlyValue":[1-9]/.test(body), 'no non-zero value anywhere in the payload');
});

test('a completed action is remembered, and can be undone', async () => {
  const key = 'enroll:route-test-1';
  let r = await req('/api/actions/done', { method: 'POST', cookie: adminCookie, body: { key } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).done, true);

  r = await req('/api/actions/done', { method: 'POST', cookie: adminCookie, body: { key, undo: true } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).done, false);
});

test('a junk key is rejected rather than written into config', async () => {
  for (const key of ['__proto__', 'constructor', 'other:x', 'enroll:' + 'x'.repeat(200), '']) {
    const r = await req('/api/actions/done', { method: 'POST', cookie: adminCookie, body: { key } });
    assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(key.slice(0, 20))}`);
  }
});
