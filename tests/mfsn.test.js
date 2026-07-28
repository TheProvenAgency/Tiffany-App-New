// The MyFreeScoreNow webhook (ingest enrolled members) and the affiliate-gap
// API, tested against the real Express app.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-mfsn-'));
process.env.APP_PASSWORD = 'test-admin-pw';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, adminCookie, employeeCookie;

function req(pathname, { method = 'GET', cookie, body, raw } = {}) {
  return fetch(base + pathname, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: raw ? raw : (body ? JSON.stringify(body) : undefined)
  });
}
async function login(u, p) {
  const r = await req('/api/login', { method: 'POST', body: { username: u, password: p } });
  return r.headers.get('set-cookie').split(';')[0];
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

test('the MFSN webhook accepts a full member list and reports the count', async () => {
  const r = await req('/webhooks/mfsn', {
    method: 'POST',
    body: { members: [{ email: 'a@x.com', name: 'Client A' }, { email: 'b@x.com', name: 'Client B' }] }
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.count, 2);
});

test('posting a full list REPLACES the set (a snapshot, not an append)', async () => {
  // "Fetch Active Members List" is a snapshot; a member who dropped off must
  // not linger.
  await req('/webhooks/mfsn', { method: 'POST', body: { members: [{ email: 'a@x.com' }, { email: 'b@x.com' }] } });
  const r = await req('/webhooks/mfsn', { method: 'POST', body: { members: [{ email: 'a@x.com' }] } });
  assert.equal((await r.json()).count, 1, 'the dropped member is gone, not accumulated');
});

test('a single member can be upserted without wiping the list', async () => {
  await req('/webhooks/mfsn', { method: 'POST', body: { members: [{ email: 'a@x.com' }] } });
  const r = await req('/webhooks/mfsn', { method: 'POST', body: { email: 'c@x.com', name: 'Client C' } });
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.ok(d.count >= 2, 'the single member was added to the existing set');
});

test('the affiliate-gap API is admin-only', async () => {
  assert.equal((await req('/api/affiliate-gap', { cookie: employeeCookie })).status, 403);
  assert.equal((await req('/api/affiliate-gap', { cookie: adminCookie })).status, 200);
});

test('the gap API returns tri-state counts and the not-affiliate/not-on-mfsn lists', async () => {
  await req('/webhooks/mfsn', { method: 'POST', body: { members: [{ email: 'a@x.com' }] } });
  const r = await req('/api/affiliate-gap', { cookie: adminCookie });
  const d = await r.json();
  assert.ok(d.counts, 'has counts');
  assert.ok('total' in d.counts && 'affiliate' in d.counts && 'notAffiliate' in d.counts && 'notOnMfsn' in d.counts);
  assert.ok(Array.isArray(d.notAffiliate));
  assert.ok(Array.isArray(d.notOnMfsn));
});

test('the webhook rejects a wrong secret once a secret is set', async () => {
  await req('/api/config', { method: 'POST', cookie: adminCookie, body: { webhookSecret: 's3cret' } });
  const bad = await req('/webhooks/mfsn?secret=wrong', { method: 'POST', body: { members: [] } });
  assert.equal(bad.status, 401);
  const good = await req('/webhooks/mfsn?secret=s3cret', { method: 'POST', body: { members: [{ email: 'a@x.com' }] } });
  assert.equal(good.status, 200);
});

test('the Deal Production reconcile endpoint is admin-only', async () => {
  assert.equal((await req('/api/production/reconcile', { method: 'POST', cookie: employeeCookie })).status, 403);
  const r = await req('/api/production/reconcile', { method: 'POST', cookie: adminCookie });
  assert.equal(r.status, 200);
});

test('the sheet-sync endpoint is admin-only and defaults to a dry run', async () => {
  const csv = 'h\n,Yes,,Test Sheet Client,Pkg,ready,-,-,note here\n';
  assert.equal((await req('/api/production/sheet-sync', { method: 'POST', cookie: employeeCookie, body: { csv } })).status, 403);
  const r = await req('/api/production/sheet-sync', { method: 'POST', cookie: adminCookie, body: { csv } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.apply, false, 'apply defaults to false so nothing is written unless explicitly requested');
  assert.ok(d.sheetRowCount >= 1);
});

test('creating a client is admin-only, validates input, and demo mode adds it without touching GoHighLevel', async () => {
  assert.equal((await req('/api/clients', { method: 'POST', cookie: employeeCookie, body: { name: 'X', email: 'x@x.com' } })).status, 403);

  const noName = await req('/api/clients', { method: 'POST', cookie: adminCookie, body: { email: 'x@x.com' } });
  assert.equal(noName.status, 400);

  const noContact = await req('/api/clients', { method: 'POST', cookie: adminCookie, body: { name: 'No Contact Info' } });
  assert.equal(noContact.status, 400);

  const r = await req('/api/clients', { method: 'POST', cookie: adminCookie, body: { name: 'New Demo Client', email: 'newdemo@x.com' } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.demo, true, 'no GHL keys configured in this test app, so it falls back to the demo roster');

  const list = await (await req('/api/clients?q=New%20Demo%20Client', { cookie: adminCookie })).json();
  assert.ok(list.clients.some(c => c.email === 'newdemo@x.com'), 'the new client shows up in the Clients list right away');
});

test('reconcile reports what it added and what it could not match, and running it twice is idempotent', async () => {
  const first = await (await req('/api/production/reconcile', { method: 'POST', cookie: adminCookie })).json();
  assert.ok('addedCount' in first && 'notInGhlCount' in first);
  assert.ok(Array.isArray(first.added) && Array.isArray(first.notInGhl));

  // Every client this run added should be recognized on a second run (by the
  // ghlId it was tagged with), so a second reconcile adds nothing new.
  const second = await (await req('/api/production/reconcile', { method: 'POST', cookie: adminCookie })).json();
  assert.equal(second.addedCount, 0, 'a client just added should not be re-added on the next run');
});
