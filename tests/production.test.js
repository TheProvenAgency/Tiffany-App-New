// Per-lead updates: employees edit one client at a time, so two people working
// simultaneously stop overwriting each other.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'msfs-prod-'));
process.env.APP_PASSWORD = 'test-admin-pw';

fs.writeFileSync(path.join(process.env.DATA_DIR, 'production.json'), JSON.stringify([
  { id: 'C1', name: 'Alpha A.', pkg: '3 Month', stage: 'Onboarding', tu: { r: 1, st: 'sent' }, docs: { DL: false }, va: 'unassigned', notes: [] },
  { id: 'C2', name: 'Beta B.', pkg: 'Unlimited', stage: 'Onboarding', tu: { r: 2, st: 'sent' }, docs: { DL: false }, va: 'unassigned', notes: [] }
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

const lead = async (id) => (await (await req('/api/production', { cookie: adminCookie })).json())
  .clients.find(c => c.id === id);

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

test('an employee can update a dispute round on one lead', async () => {
  const r = await req('/api/production/C1', {
    method: 'PATCH', cookie: employeeCookie, body: { tu: { r: 3, st: 'done' } }
  });
  assert.equal(r.status, 200);
  assert.equal((await lead('C1')).tu.r, 3);
});

test('an employee cannot change stage, and the lead is left untouched', async () => {
  const before = (await lead('C1')).stage;
  const r = await req('/api/production/C1', {
    method: 'PATCH', cookie: employeeCookie, body: { stage: 'Completed' }
  });
  assert.equal(r.status, 403);
  assert.equal((await lead('C1')).stage, before, 'a rejected patch must change nothing');
});

test('a patch mixing allowed and forbidden fields is rejected wholesale', async () => {
  // Partial application would be worse than refusing: the employee would think
  // the whole edit saved.
  const r = await req('/api/production/C1', {
    method: 'PATCH', cookie: employeeCookie, body: { docs: { DL: true }, va: 'someone else' }
  });
  assert.equal(r.status, 403);
  assert.equal((await lead('C1')).docs.DL, false, 'nothing should have been applied');
});

test('an admin can change stage and va', async () => {
  const r = await req('/api/production/C1', {
    method: 'PATCH', cookie: adminCookie, body: { stage: 'Completed', va: 'VA One' }
  });
  assert.equal(r.status, 200);
  const c = await lead('C1');
  assert.equal(c.stage, 'Completed');
  assert.equal(c.va, 'VA One');
});

test('a note is attributed to the signed-in user, not to whoever the body claims', async () => {
  await req('/api/production/C2', {
    method: 'PATCH', cookie: employeeCookie,
    body: { note: 'called client', who: 'Tiffany', notes: [] }
  });
  const notes = (await lead('C2')).notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, 'called client');
  assert.equal(notes[0].who, 'VA One', 'attribution comes from the session');
});

test('notes are append-only for employees — an existing note cannot be erased', async () => {
  const before = (await lead('C2')).notes.length;
  await req('/api/production/C2', {
    method: 'PATCH', cookie: employeeCookie, body: { note: 'second note' }
  });
  const after = (await lead('C2')).notes;
  assert.equal(after.length, before + 1);
  assert.equal(after[0].text, 'called client', 'the earlier note survives');
});

test('simultaneous edits to different leads both survive', async () => {
  // The bug this feature exists to prevent: whole-file saves meant the second
  // writer silently erased the first.
  await Promise.all([
    req('/api/production/C1', { method: 'PATCH', cookie: employeeCookie, body: { docs: { DL: true } } }),
    req('/api/production/C2', { method: 'PATCH', cookie: adminCookie, body: { stage: 'Disputing' } })
  ]);
  assert.equal((await lead('C1')).docs.DL, true, 'employee edit survived');
  assert.equal((await lead('C2')).stage, 'Disputing', 'admin edit survived');
});

test('patching a lead that does not exist is a 404', async () => {
  const r = await req('/api/production/NOPE', {
    method: 'PATCH', cookie: employeeCookie, body: { docs: {} }
  });
  assert.equal(r.status, 404);
});

test('an employee still cannot replace the whole file', async () => {
  const r = await req('/api/production', { method: 'POST', cookie: employeeCookie, body: { clients: [] } });
  assert.equal(r.status, 403);
  assert.ok((await req('/api/production', { cookie: adminCookie })).ok);
});
