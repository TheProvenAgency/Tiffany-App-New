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

// Reversed 2026-08-05: moving a client between pipeline stages/columns from
// the Pipeline detail panel was explicitly opened to both roles (see
// EMPLOYEE_FIELDS in lib/auth.js). va (ownership reassignment) did not
// change -- still admin-only, see the mixed-fields test right below.
test('an employee can change stage', async () => {
  const r = await req('/api/production/C1', {
    method: 'PATCH', cookie: employeeCookie, body: { stage: 'Completed' }
  });
  assert.equal(r.status, 200);
  assert.equal((await lead('C1')).stage, 'Completed');
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

test('two edits to different fields of the SAME lead both survive', async () => {
  // The real remaining collision: the client sends only what changed, and the
  // server deep-merges the sub-objects, so ticking a doc and changing a round
  // on the same lead do not overwrite each other.
  await req('/api/production/C1', { method: 'PATCH', cookie: employeeCookie, body: { docs: { DL: true } } });
  await req('/api/production/C1', { method: 'PATCH', cookie: employeeCookie, body: { tu: { st: 'done' } } });
  const c = await lead('C1');
  assert.equal(c.docs.DL, true, 'the document tick survived the later round edit');
  assert.equal(c.tu.st, 'done', 'the round edit applied');
});

test('a partial doc patch does not wipe the other documents', async () => {
  await req('/api/production/C2', { method: 'PATCH', cookie: adminCookie, body: { docs: { DL: true, SSC: true } } });
  await req('/api/production/C2', { method: 'PATCH', cookie: employeeCookie, body: { docs: { POA: true } } });
  const c = await lead('C2');
  assert.equal(c.docs.DL, true, 'earlier doc survives');
  assert.equal(c.docs.SSC, true, 'earlier doc survives');
  assert.equal(c.docs.POA, true, 'new doc applied');
});

test('a partial round patch keeps the untouched half of the round', async () => {
  await req('/api/production/C1', { method: 'PATCH', cookie: employeeCookie, body: { eq: { r: 4 } } });
  await req('/api/production/C1', { method: 'PATCH', cookie: employeeCookie, body: { eq: { st: 'ready' } } });
  const c = await lead('C1');
  assert.equal(c.eq.r, 4, 'the round number set earlier is not lost when status changes');
  assert.equal(c.eq.st, 'ready');
});

test('one lead can be fetched on its own for the live refresh', async () => {
  const r = await req('/api/production/C1', { cookie: employeeCookie });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.client.id, 'C1');
  assert.ok('updatedAt' in body.client, 'the lead carries a timestamp so pollers can tell it changed');
});

test('fetching one missing lead is a 404', async () => {
  assert.equal((await req('/api/production/NOPE', { cookie: employeeCookie })).status, 404);
});

test('an edit stamps updatedAt so viewers can detect it', async () => {
  const before = (await (await req('/api/production/C2', { cookie: adminCookie })).json()).client.updatedAt;
  await req('/api/production/C2', { method: 'PATCH', cookie: employeeCookie, body: { docs: { FTC: true } } });
  const after = (await (await req('/api/production/C2', { cookie: adminCookie })).json()).client.updatedAt;
  assert.notEqual(after, before, 'updatedAt must move when the lead changes');
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
