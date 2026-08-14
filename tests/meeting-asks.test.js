// The Aug 13 walkthrough call with Nica and Charles produced four concrete
// asks: disputers add notes (already shipped), disputers add the CFPB login
// they create themselves, a daily task checkbox that sorts unfinished work
// first and credits whoever did it, and manual client entry until Commas is
// connected. These tests pin each one.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const audit = require('../lib/audit.js');
const auth = require('../lib/auth.js');

const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/* ---------- daily task checkbox ---------- */

test('ticking the box today shows as done; unticking takes it back', () => {
  const now = '2026-08-13T15:00:00.000Z';
  const log = [
    { at: '2026-08-13T09:00:00.000Z', who: 'Antoinette', clientId: 'c1', action: 'client_worked' },
    { at: '2026-08-13T09:05:00.000Z', who: 'Antoinette', clientId: 'c2', action: 'client_worked' },
    { at: '2026-08-13T09:30:00.000Z', who: 'Antoinette', clientId: 'c2', action: 'client_worked_undone' },
    { at: '2026-08-12T09:00:00.000Z', who: 'Alfred', clientId: 'c3', action: 'client_worked' } // yesterday
  ];
  const st = audit.workedToday(log, { now });
  assert.equal(st.c1.done, true);
  assert.equal(st.c1.who, 'Antoinette');
  assert.equal(st.c2.done, false, 'later entries win, like a checkbox');
  assert.equal(st.c3, undefined, 'yesterday does not carry over -- done resets daily by definition');
});

test('an undo cancels the credit instead of counting as more activity', () => {
  const now = Date.now();
  const at = m => new Date(now - m * 60000).toISOString();
  const honest = [
    { at: at(10), who: 'Alfred', clientId: 'c1', action: 'client_worked' },
    { at: at(9), who: 'Alfred', clientId: 'c2', action: 'client_worked' }
  ];
  const padder = [];
  for (let i = 0; i < 5; i++) {
    padder.push({ at: at(20 - i * 2), who: 'Padder', clientId: 'c9', action: 'client_worked' });
    padder.push({ at: at(19 - i * 2), who: 'Padder', clientId: 'c9', action: 'client_worked_undone' });
  }
  const t = audit.throughput(honest.concat(padder), { days: 1, now });
  const alfred = t.people.find(p => p.who === 'Alfred');
  const pad = t.people.find(p => p.who === 'Padder');
  assert.equal(alfred.worked, 2);
  assert.equal(pad.worked, 0, 'toggling a box five times is zero work');
  assert.equal(pad.total, 0, 'and zero total actions');
});

test('the worked toggle is a disputes-capability route', () => {
  assert.ok(auth.canAccess({ role: 'disputer' }, 'POST', '/api/disputes/abc/worked'));
  assert.ok(!auth.canAccess({ role: 'va' }, 'POST', '/api/disputes/abc/worked'),
    'a VA cannot claim dispute work');
  const route = srv.split("app.post('/api/disputes/:id/worked'")[1].split('\n});')[0];
  assert.ok(/client_worked_undone/.test(route), 'unticking is recorded as a correction');
  assert.ok(/clientName/.test(route), 'the entry names the client for the admin activity board');
});

test('the queue carries checkbox state and the desk sorts unfinished first', () => {
  const q = srv.split("app.get('/api/disputes/queue'")[1].split('\n});')[0];
  assert.ok(/workedToday/.test(q) && /workedBy/.test(q));
  const dq = pub('disputes.js');
  assert.ok(/function taskSort/.test(dq));
  assert.ok(/workedToday\?1:0/.test(dq), 'finished work sinks to the bottom');
  assert.ok(/ev.stopPropagation\(\)/.test(dq), 'ticking the box must not open the drawer');
  assert.ok(/dqKDone/.test(dq), 'a Done-today number on the desk');
});

/* ---------- CFPB login entry ---------- */

test('the drawer lets a disputer add the CFPB login they created', () => {
  const dq = pub('disputes.js');
  assert.ok(/dqcEmail/.test(dq) && /dqcPw/.test(dq) && /dqcRound/.test(dq));
  assert.ok(/patch\.cfpb=\[\{round:/.test(dq), 'saved through the same PATCH as everything else');
  assert.ok(auth.DISPUTE_FIELDS.has('cfpb'), 'and the server already accepts it from a disputer');
});

test('adding a round 3 login does not wipe rounds 1 and 2 from the JSON backup', () => {
  // applyProdPatchToJson used plain assignment for arrays: patching
  // cfpb:[{round:3,...}] REPLACED the whole login list. Postgres upserts by
  // round; the JSON side must match or the record the UI re-renders after
  // saving (and the backup) silently loses every earlier credential.
  const fn = srv.split('function applyProdPatchToJson')[1].split('\n}')[0];
  assert.ok(/k === 'cfpb'/.test(fn), 'cfpb is merged, not assigned');
  assert.ok(/String\(x\.round\) === String\(entry\.round\)/.test(fn), 'upsert by round, same as Postgres');
});

/* ---------- manual add-client ---------- */

test('a VA can add a client by hand; a disputer cannot', () => {
  assert.ok(auth.canAccess({ role: 'va' }, 'POST', '/api/production/add'));
  assert.ok(!auth.canAccess({ role: 'disputer' }, 'POST', '/api/production/add'));
});

test('manual add is durable, audited, and refuses silent duplicates', () => {
  const route = srv.split("app.post('/api/production/add'")[1].split('\n});')[0];
  assert.ok(/appendProdRecords/.test(route), 'Postgres-first creation, same path as sheet-sync');
  assert.ok(/client_added/.test(route), 'shows up in team activity');
  assert.ok(/409/.test(route), 'a same-name client is flagged, not doubled -- the sheet had dupes already');
  assert.ok(/clearCacheKey\('roster:composed'\)/.test(route), 'the roster caches learn about the new client');
  assert.ok(/'Onboarding'/.test(route), 'new clients land at the start of the pipeline');
});

test('the Deal Production bar has the Add client button wired to the route', () => {
  const pv = pub('production.js');
  assert.ok(/pvAddBtn/.test(pv));
  assert.ok(/\/api\/production\/add/.test(pv));
  assert.ok(/pvOpen\(o\.j\.id\)/.test(pv), 'opens the new profile so details can be filled in right away');
});

/* ---------- notes (regression guard for what was demoed) ---------- */

test('disputers still have the notes box that was promised on the call', () => {
  assert.ok(auth.DISPUTE_FIELDS.has('note'));
  assert.ok(/dqdNote/.test(pub('disputes.js')));
});

/* ---------- rebrand ---------- */

test('the new logo reaches every surface, including logged-out ones', () => {
  const html = pub('index.html');
  assert.ok(/logo-mark\.png"\/>/.test(html), 'square mark as favicon -- a wide wordmark is unreadable at 16px');
  assert.ok(html.includes('railbrand" onclick="showView(\'dash\')" title="Ms. Financial Solutions"><img src="/logo-mark.png"'));
  assert.ok(!pub('login.html').includes('msfinancialsolutions.net'),
    'the login page no longer depends on the marketing site being up');
  assert.ok(auth.canAccessAsset({ role: 'disputer' }, '/logo-mark.png'), 'workers can load the mark');
  const open = srvNow().split('const open =')[1].split(';')[0];
  assert.ok(open.includes("'/logo.png'") && open.includes("'/logo-mark.png'"),
    'the login page shows the logo before a session exists');
});
function srvNow(){ return fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'); }
