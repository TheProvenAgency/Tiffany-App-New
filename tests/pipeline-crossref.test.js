// The Pipeline board's persistent detail panel needs to know "where a
// client is in the process" -- Deal Production is the real system of
// record for that (stage, per-bureau round status), not the flat round
// number GoHighLevel carries. These tests cover the cross-reference: GET
// /api/clients/:id attaching a matching Deal Production record by ghlId,
// and GET /api/pipeline tagging each merged card with the right id/kind so
// the client knows whether to open it via /api/clients/:id or fall back to
// /api/production/:id when there's no GHL match at all.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-pipecross-'));
process.env.APP_PASSWORD = 'test-admin-pw';

// Demo-mode GHL client ids are deterministic ('demo-' + i, see lib/demo.js)
// -- 'demo-0' always exists regardless of its randomized status/round, so
// it's a stable id to cross-reference against here.
fs.writeFileSync(path.join(process.env.DATA_DIR, 'production.json'), JSON.stringify([
  {
    id: 'G-matched', ghlId: 'demo-0', name: 'Matched Client', pkg: '3 Bureau Expedited', stage: 'Onboarding',
    days: 2, tu: { r: 0, st: 'none' }, eq: { r: 0, st: 'none' }, ex: { r: 0, st: 'none' },
    docs: { SSC: true, DL: false }, va: 'Antoinette', notes: []
  },
  {
    id: 'S-unmatched', name: 'Sheet-Only Client', pkg: 'Unlimited', stage: 'Completed',
    days: 40, tu: { r: 6, st: 'done' }, eq: { r: 6, st: 'done' }, ex: { r: 6, st: 'done' },
    docs: { SSC: true, DL: true }, va: 'Bri', notes: [{ when: '2026-01-01', who: 'Bri', text: 'Wrapped up.' }]
  }
]));

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const app = require('../server');

let base, server, adminCookie, employeeCookie;

function req(pathname, { method = 'GET', cookie, body } = {}) {
  return fetch(base + pathname, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function login(username, password) {
  const r = await req('/api/login', { method: 'POST', body: { username, password } });
  return r.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise(res => server.once('listening', res));
  base = `http://127.0.0.1:${server.address().port}`;
  adminCookie = await login('admin', 'test-admin-pw');
  await req('/api/users', {
    method: 'POST', cookie: adminCookie,
    body: { username: 'va1', name: 'VA One', role: 'employee', password: 'va-pw' }
  });
  employeeCookie = await login('va1', 'va-pw');
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('GET /api/clients/:id attaches the matching Deal Production record by ghlId', async () => {
  for (const cookie of [adminCookie, employeeCookie]) {
    const r = await req('/api/clients/demo-0', { cookie });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.ok(d.production, 'a matching production record should be attached');
    assert.equal(d.production.id, 'G-matched');
    assert.equal(d.production.stage, 'Onboarding');
    assert.equal(d.production.va, 'Antoinette');
    assert.ok(!('name' in d.production), 'only operational fields, not a second copy of the name');
  }
});

test('GET /api/clients/:id has no production field when there is no match', async () => {
  const r = await req('/api/clients?pageSize=50', { cookie: adminCookie });
  const list = await r.json();
  const noMatch = list.clients.find(c => c.id !== 'demo-0');
  assert.ok(noMatch, 'need at least one other demo client to test against');
  const d = await (await req('/api/clients/' + noMatch.id, { cookie: adminCookie })).json();
  assert.equal(d.production, null);
});

test('GET /api/pipeline tags a GHL-matched merged card as kind:ghl with the real contact id', async () => {
  const d = await (await req('/api/pipeline', { cookie: adminCookie })).json();
  const onboarding = d.columns.find(c => c.name === 'New / Onboarding');
  assert.ok(onboarding, 'onboarding column should exist');
  const card = onboarding.clients.find(c => c.name === 'Matched Client');
  assert.ok(card, 'the matched production record should appear in the board');
  assert.equal(card.kind, 'ghl');
  assert.equal(card.id, 'demo-0', 'opens via the real GHL contact id, not the production-only id');
  assert.ok(card.production);
  assert.equal(card.production.stage, 'Onboarding');
});

test('GET /api/pipeline tags an unmatched production-only card as kind:production', async () => {
  const d = await (await req('/api/pipeline', { cookie: adminCookie })).json();
  const done = d.columns.find(c => c.name === 'Done');
  assert.ok(done, 'done column should exist');
  const card = done.clients.find(c => c.name === 'Sheet-Only Client');
  assert.ok(card, 'the unmatched production record should still appear in the board');
  assert.equal(card.kind, 'production');
  assert.equal(card.id, 'S-unmatched', 'no GHL match, so it opens via GET /api/production/:id instead');
  assert.ok(card.production);
});

test('the production-only fallback route works for both roles (no money in it either way)', async () => {
  for (const cookie of [adminCookie, employeeCookie]) {
    const r = await req('/api/production/S-unmatched', { cookie });
    assert.equal(r.status, 200);
    const d = await r.json();
    assert.equal(d.client.name, 'Sheet-Only Client');
    assert.equal(d.client.notes.length, 1);
  }
});

// The Pipeline panel's Add note / + Follow-up task now work even when a
// card has no GHL contact match -- openProductionOnlyClient in index.html
// writes the note straight to the Deal Production record's own note field
// (PATCH .../notes semantics via the `note` patch key) and tags a task with
// the production record's own id, exactly like these two calls.
test('an employee can add a note to a production-only (no-GHL-match) card', async () => {
  const r = await req('/api/production/S-unmatched', {
    method: 'PATCH', cookie: employeeCookie, body: { note: 'employee note, no GHL contact behind this one' }
  });
  assert.equal(r.status, 200);
  const d = await (await req('/api/production/S-unmatched', { cookie: employeeCookie })).json();
  assert.ok(d.client.notes.some(n => n.text === 'employee note, no GHL contact behind this one'));
});

test('an employee can create and assign a task against a production-only card', async () => {
  const created = await req('/api/tasks', {
    method: 'POST', cookie: employeeCookie,
    body: { title: 'Follow up on sheet-only client', clientId: 'S-unmatched', clientName: 'Sheet-Only Client', assignedTo: null }
  });
  assert.equal(created.status, 200);
  const task = await created.json();
  assert.equal(task.clientId, 'S-unmatched');

  const list = await (await req('/api/tasks', { cookie: employeeCookie })).json();
  assert.ok(list.open.some(t => t.clientId === 'S-unmatched' && t.title === 'Follow up on sheet-only client'));
});
