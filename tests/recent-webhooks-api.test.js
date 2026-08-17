// GET /api/recent-webhooks -- the real-time webhook feed's read endpoint.
// Tested against the real Express app: a real unauthenticated request and a
// real employee session, both actually rejected (not just reasoned about),
// plus a real admin request seeing only allowlisted/metadata-only fields
// after real POSTs to /webhooks/sheet-sync and /webhooks/mfsn.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-webhookfeed-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');
const { shamond } = require('./fixtures/sheet-rows');

let base, server, adminCookie, employeeCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function login(u, p) {
  const r = await req('/api/login', { method: 'POST', body: { username: u, password: p } });
  return r.headers.get('set-cookie').split(';')[0];
}
function n8nEnvelope(items) {
  return [{ headers: {}, params: {}, query: {}, body: items, webhookUrl: 'test', executionMode: 'production' }];
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = await login('admin', 'test-admin-pw');
  await req('/api/users', { method: 'POST', cookie: adminCookie, body: { username: 'va1', name: 'VA One', role: 'employee', password: 'pw' } });
  employeeCookie = await login('va1', 'pw');
});

after(() => { server.close(); fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); });

test('a real unauthenticated request is rejected', async () => {
  const r = await req('/api/recent-webhooks');
  assert.equal(r.status, 401);
});

test('a real employee session is rejected', async () => {
  const r = await req('/api/recent-webhooks', { cookie: employeeCookie });
  assert.equal(r.status, 403);
});

test('a real admin session can read the feed', async () => {
  const r = await req('/api/recent-webhooks', { cookie: adminCookie });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok(Array.isArray(d.entries));
});

test('a real POST to /webhooks/sheet-sync shows up in the admin feed with only allowlisted fields', async () => {
  await req('/webhooks/sheet-sync', { method: 'POST', body: n8nEnvelope([shamond]) });

  const r = await req('/api/recent-webhooks?after=0', { cookie: adminCookie });
  const d = await r.json();
  const entry = d.entries.find(e => e.path === '/sheet-sync');
  assert.ok(entry, 'the real POST landed in the feed');
  assert.equal(entry.summary, 'Sheet Sync · 1 item');
  const item = entry.display.items[0];
  assert.equal(item.NAME, 'Shamond Anderson');
  assert.equal(item.PACKAGE, '6-Month Credit Repair Package');
  assert.ok(!('CFPB_PW_RND_1' in item), 'no CFPB password reached the feed');
  assert.ok(!('ROUND_1_CFPB_EMAIL' in item), 'no CFPB email reached the feed');
  assert.ok(!JSON.stringify(d).includes('Credit24Credit24!'), 'the real plaintext password from the payload is nowhere in the response');
});

test('a real POST to /webhooks/mfsn shows up as metadata only, no member emails', async () => {
  await req('/webhooks/mfsn', { method: 'POST', body: { members: [{ email: 'real-member@example.com', name: 'Real Member' }] } });

  const r = await req('/api/recent-webhooks?after=0', { cookie: adminCookie });
  const d = await r.json();
  const entry = d.entries.find(e => e.path === '/mfsn');
  assert.ok(entry);
  assert.equal(entry.summary, 'MFSN sync · 1 item');
  assert.equal(entry.display.items, null, 'no confirmed safe-field list for mfsn yet -- metadata only');
  assert.ok(!JSON.stringify(d).includes('real-member@example.com'));
});

test('a rejected webhook call (bad secret) still shows up in the feed, with its real status code', async () => {
  await req('/api/config', {
    method: 'POST', cookie: adminCookie,
    body: { webhookSecret: 'a-real-secret' }
  });
  const bad = await req('/webhooks/mfsn?secret=wrong', { method: 'POST', body: { members: [] } });
  assert.equal(bad.status, 401);

  const r = await req('/api/recent-webhooks?after=0', { cookie: adminCookie });
  const d = await r.json();
  const rejected = d.entries.filter(e => e.path === '/mfsn').pop();
  assert.equal(rejected.status, 401, 'a failed auth attempt is visible too -- "is it even hitting us" matters even when the answer is no');
});
