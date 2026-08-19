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
  assert.ok(/logo-mark\.png\?v=\d+"\/>/.test(html), 'square mark as favicon -- a wide wordmark is unreadable at 16px');
  assert.ok(/railbrand" onclick="showView\('dash'\)" title="Ms\. Financial Solutions"><img src="\/logo-mark\.png\?v=\d+"/.test(html));
  // Images carry a 7-day max-age, so swapped art MUST ship under a new URL
  // or the team stares at the old logo for a week.
  assert.ok(!/src="\/logo(-mark|-wordmark)?\.png"/.test(html), 'no unversioned reference to the swapped art');
  assert.ok(!pub('login.html').includes('msfinancialsolutions.net'),
    'the login page no longer depends on the marketing site being up');
  assert.ok(auth.canAccessAsset({ role: 'disputer' }, '/logo-mark.png'), 'workers can load the mark');
  const open = srvNow().split('const open =')[1].split(';')[0];
  assert.ok(open.includes("'/logo.png'") && open.includes("'/logo-mark.png'"),
    'the login page shows the logo before a session exists');
});
function srvNow(){ return fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'); }

/* ---------- disputes-done widget ---------- */

test('the dashboard has a per-person disputes-done card with a time window', () => {
  const html = pub('index.html');
  assert.ok(/gs-id="disputework" gs-x="0" gs-y="0"/.test(html),
    'ships at the very top of the dashboard');
  assert.ok(/known\.has\(el\.getAttribute\('gs-id'\)\)/.test(html),
    'and surfaces at the top even for someone whose saved layout predates it');
  assert.ok(/data-days="1"/.test(html) && /data-days="7"/.test(html) && /data-days="30"/.test(html),
    'Today / Week / Month windows');
  assert.ok(/\/api\/team-activity\?days='\+dwDays/.test(html), 'window drives the same audit-log endpoint');
  assert.ok(/p\.worked\|\|0\)\+\(p\.roundsFiled\|\|0/.test(html),
    'disputes done = rounds filed + task-list checkoffs, the two forms dispute work takes here');
  assert.ok(/renderDisputeWork\(\);/.test(html), 'rendered with the other dashboard cards');
});

/* ---------- unread sync + mark-unread ---------- */

test('the inbox carries the FULL history with a fresher unread overlay', () => {
  // GHL showed 90+ unread, the app 17: the fetch was capped at the 300 most
  // recent conversations. Now the whole book loads (the default max is a
  // 20,000-conversation runaway guard, not a window) on a 5-minute cycle,
  // with a cheap unread-only fetch overlaid every 45s so new unread shows
  // within a minute even though the big list is minutes old.
  const srv = srvNow();
  const fn = srv.split('async function allConversations')[1].split('\n}')[0];
  assert.ok(/5 \* 60 \* 1000/.test(fn), 'full history on a 5-minute cycle -- faster would burn GHL rate limit');
  assert.ok(/fetchAllConversations\(cfg, \{\}\)/.test(fn), 'no recency cap on the big fetch');
  assert.ok(/messages:unread/.test(fn), 'a second, unread-only fetch');
  assert.ok(/unread: c\.unread \|\| 1/.test(fn), 'the unread copy wins the merge');
  const ghl2 = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ghl.js'), 'utf8');
  assert.ok(/max = 20000/.test(ghl2), 'the pager walks the whole history, stopping at the first short page');
  const ui = pub('messages.js');
  assert.ok(/showCount/.test(ui) && /Show /.test(ui),
    'thousands of rows render in slices, not one giant DOM dump');
  for (const route of ["app.get('/api/messages'", "app.get('/api/replies-due'"]) {
    assert.ok(/allConversations\(/.test(srv.split(route)[1].split('\n});')[0]),
      route + ' uses the merged list');
  }
  const ghlSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ghl.js'), 'utf8');
  assert.ok(/status: 'unread'/.test(ghlSrc), 'GHL filters unread server-side, so paging scales with the backlog');
});

test('mark-unread flips the state in GHL, and a VA is allowed to do it', () => {
  assert.ok(auth.canAccess({ role: 'va' }, 'POST', '/api/messages/abc/unread'),
    'inbox triage is the VA\'s actual job');
  assert.ok(!auth.canAccess({ role: 'disputer' }, 'POST', '/api/messages/abc/unread'));
  const route = srvNow().split("app.post('/api/messages/:id/unread'")[1].split('\n});')[0];
  assert.ok(/setConversationUnread/.test(route), 'GHL is the one source of unread truth -- no app-side flag to drift');
  assert.ok(/clearCacheKey\('messages'\)/.test(route) && /clearCacheKey\('messages:unread'\)/.test(route),
    'the next list load refetches the truth it just changed');
  const ui = pub('messages.js');
  assert.ok(/msgUnreadBtn/.test(ui));
  assert.ok(/Mark read/.test(ui) && /Mark unread/.test(ui), 'one button, both directions');
});

/* ---------- live inbox: 30s refresh, files, emojis, snippets ---------- */

test('the inbox is within ~30s of GHL without re-paging the whole history', () => {
  const srv = srvNow();
  const fn = srv.split('async function allConversations')[1].split('\n}')[0];
  assert.ok(/messages:fresh/.test(fn) && /30 \* 1000/.test(fn),
    'a cheap 200-conversation fetch every 30s overlays the 5-minute full history');
  assert.ok(/setInterval\(warm, 25 \* 1000\)/.test(srv),
    'the warm loop beats the 30s TTL so a visitor never pays for the refresh');
  const ui = pub('messages.js');
  assert.ok(/loadThread\(curId,true\)/.test(ui), 'the OPEN thread re-polls too, silently');
});

test('photos and files go out through GHL, staged in the composer', () => {
  const srv = srvNow();
  const route = srv.split("app.post('/api/messages/:id/attachments'")[1].split('\n});')[0];
  assert.ok(/uploadMessageAttachment/.test(route), 'GHL hosts the file and returns the URL');
  assert.ok(/10 \* 1024 \* 1024/.test(route), 'a 10MB cap, like GHL itself');
  assert.ok(auth.canAccess({ role: 'va' }, 'POST', '/api/messages/x/attachments'));
  const reply = srv.split("app.post('/api/messages/:id/reply'")[1].split('\n});')[0];
  assert.ok(/attachments:/.test(reply), 'the reply carries the uploaded URLs');
  assert.ok(/hasAttachments/.test(reply), 'a photo with no text is still a valid message');
  const ghlSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ghl.js'), 'utf8');
  assert.ok(/body\.attachments = attachments/.test(ghlSrc));
  assert.ok(/attachments: Array\.isArray\(m\.attachments\)/.test(ghlSrc), 'inbound attachments survive normalization');
  const ui = pub('messages.js');
  assert.ok(/msgAttachBtn/.test(ui) && /PENDING_FILES/.test(ui) && /attHTML/.test(ui),
    'staged chips in the composer, rendered images/links in the thread');
});

test('the emoji picker draws from the full Unicode set with a working fallback', () => {
  const ui = pub('messages.js');
  assert.ok(/emoji\.json/.test(ui), 'the complete ~1,900-emoji dataset, lazy-loaded on first open');
  assert.ok(/EMOJI_FALLBACK/.test(ui), 'a built-in core set if the CDN is unreachable -- never a dead button');
  assert.ok(/msgEmojiSearch/.test(ui), 'searchable by name');
  assert.ok(/insertAtCursor/.test(ui), 'inserts where the cursor is, not appended at the end');
});

test('GHL snippets appear in the composer, pulled from GHL itself', () => {
  assert.ok(auth.canAccess({ role: 'va' }, 'GET', '/api/snippets'));
  const srv = srvNow();
  assert.ok(/ghl:snippets/.test(srv), 'cached a few minutes -- snippets change on edit, not per message');
  const ghlSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ghl.js'), 'utf8');
  assert.ok(/function fetchSnippets/.test(ghlSrc) && /templates\?deleted=false/.test(ghlSrc));
  const ui = pub('messages.js');
  assert.ok(/msgSnippetBtn/.test(ui) && /msgSnippetSearch/.test(ui), 'a searchable picker in the composer');
});

/* ---------- speed without touching any pull ---------- */

test('responses are compressed and the CDN libs no longer block first paint', () => {
  const srv = srvNow();
  assert.ok(/app\.use\(compression\(\)\)/.test(srv),
    'the 2.4MB roster JSON and 230KB index.html ship at ~a tenth of their size');
  assert.ok(srv.indexOf('app.use(compression())') < srv.indexOf("express.static"),
    'compression is installed before anything that serves bytes');
  const html = pub('index.html');
  assert.ok(/<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/.test(html));
  assert.ok(/<script defer src="https:\/\/cdn\.jsdelivr\.net\/npm\/gridstack/.test(html));
  assert.ok(/rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/.test(html),
    'TLS to the CDN starts before the HTML finishes arriving');
  // deferring the libs is only safe because the boot block waits for them:
  const boot = html.split('/* ================= boot =================')[1];
  assert.ok(/DOMContentLoaded/.test(boot.slice(0, 400)),
    'boot waits for DOMContentLoaded, which the spec fires after deferred scripts run');
});

/* ---------- snippets: team-made + none missing ---------- */

test('snippet fetch pages past 100 and keeps unknown body shapes visible', () => {
  // "a lot of snippets aren't showing": the fetch stopped at the first 100
  // AND dropped any snippet whose body sat in a field it didn't map.
  const ghlSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'ghl.js'), 'utf8');
  const fn = ghlSrc.split('async function fetchSnippets')[1].split('\n}')[0];
  assert.ok(/skip < 1000; skip \+= 100/.test(fn), 'pages until GHL runs out');
  assert.ok(/tpl\.body \|\| tpl\.message \|\| tpl\.text/.test(fn), 'every known body shape');
  assert.ok(!/filter\(t => t\.body\)/.test(fn), 'a bodyless snippet is shown by name, not silently dropped');
});

test('the team can add their own snippets, durably, and delete them', () => {
  assert.ok(auth.canAccess({ role: 'va' }, 'POST', '/api/snippets'));
  assert.ok(auth.canAccess({ role: 'va' }, 'DELETE', '/api/snippets/x'));
  const st = require('../lib/store.js');
  const made = st.addAppSnippet({ name: 'Welcome', body: 'Hi {{name}}, welcome aboard!', who: 'Nica' });
  assert.ok(made.id && made.createdAt);
  assert.ok(st.getAppSnippets().some(x => x.id === made.id));
  assert.ok(st.deleteAppSnippet(made.id), 'and gone again');
  assert.ok(!st.getAppSnippets().some(x => x.id === made.id));
  const srv = srvNow();
  assert.ok(/app_\.concat/.test(srv), 'served merged with the GHL ones');
  assert.ok(/hydrateAppSnippetsFromPostgres/.test(srv), 'restored at boot -- this disk does not survive a deploy');
  const migrate = fs.readFileSync(path.join(__dirname, '..', 'lib', 'migrate.js'), 'utf8');
  assert.ok(/app_snippets/.test(migrate));
  const ui = pub('messages.js');
  assert.ok(/snipNew/.test(ui) && /snipSave/.test(ui), 'a + New snippet form in the picker');
  assert.ok(/data-del/.test(ui) && /Delete this snippet for the whole team/.test(ui),
    'app-made ones are deletable; GHL-made ones are edited in GHL');
});

/* ---------- Nica: VA + dispute desk, never admin ---------- */

test("a VA-plus-disputes override opens the desk and nothing admin", () => {
  const caps = ['production', 'messages', 'clients', 'followups', 'tickets', 'assign', 'disputes'];
  const nica = { role: 'va', capabilities: caps };
  assert.ok(auth.canAccess(nica, 'GET', '/api/disputes/queue'), 'the desk opens');
  assert.ok(auth.canAccess(nica, 'PATCH', '/api/disputes/x'), 'and she can work a record');
  assert.ok(auth.canAccess(nica, 'POST', '/api/disputes/x/worked'));
  assert.ok(auth.canAccessAsset(nica, '/disputes.js'), 'the desk code is served to her');
  assert.ok(auth.canAccess(nica, 'GET', '/api/production'), 'her VA portal is untouched');
  assert.ok(!auth.canAccess(nica, 'POST', '/api/users'), 'creating accounts stays admin-only');
  assert.ok(!auth.canAccess(nica, 'GET', '/api/team-activity'), 'the admin activity board stays closed');
  // and the money wall is a capability, which she still does not hold:
  const rec = { id: 'c', name: 'X', totalSpent: 900, mfsnCommission: 50 };
  const redacted = auth.redactClient(nica, rec);
  assert.equal(redacted.totalSpent, undefined, 'no money appears anywhere in her session');
});

test('the boot grant is idempotent and only ever ADDS disputes', () => {
  const srv = srvNow();
  const grant = srv.split('One-time capability grant')[1].split('await store.mirrorUsers')[0];
  assert.ok(/toLowerCase\(\) === 'nica'/.test(grant));
  assert.ok(/wanted\.filter\(c => !caps\.includes\(c\)\)/.test(grant), 'a second boot changes nothing');
  assert.ok(/saveUsersDurable/.test(grant), 'survives the next deploy like any account change');
  assert.ok(/ROLE_CAPS\[nica\.role\]/.test(grant), 'an override starts from her real VA capabilities');
});

test('holding disputes alongside production does not move the front door', () => {
  const dq = fs.readFileSync(path.join(__dirname, '..', 'public', 'disputes.js'), 'utf8');
  const landing = dq.split('their home\n  // screen')[1] || dq.split('home screen')[1];
  assert.ok(/indexOf\('production'\)<0/.test(landing),
    'only a PURE disputer auto-lands on the desk; a VA with desk access keeps her VA home');
});

/* ---------- account management for Nica + the four disputers ---------- */

test("the 'users' capability manages the team but can never mint an admin", () => {
  const mgr = { role: 'va', capabilities: ['production', 'messages', 'clients', 'followups', 'tickets', 'assign', 'disputes', 'users'] };
  assert.ok(auth.canAccess(mgr, 'POST', '/api/users'), 'create members');
  assert.ok(auth.canAccess(mgr, 'PATCH', '/api/users/x'), 'edit members');
  assert.ok(auth.canAccess(mgr, 'POST', '/api/users/x/invite'), 'resend setup links');
  assert.ok(!auth.canAccess(mgr, 'DELETE', '/api/users/x'), 'deleting accounts stays admin-only');
  const srv = srvNow();
  const post = srv.split("app.post('/api/users',")[1].split('app.patch')[0];
  assert.ok(/role === 'admin' \|\| \(caps \|\| \[\]\)\.includes\('admin'\)/.test(post),
    'a non-admin creator cannot create admin access by role OR by capability override');
  const patch = srv.split("app.patch('/api/users/:id',")[1].split('app.post')[0];
  assert.ok(/only an admin can modify an admin account/.test(patch),
    'nor touch an admin account -- a password change there would be a takeover');
  const invite = srv.split("app.post('/api/users/:id/invite',")[1].split('\n});')[0];
  assert.ok(/only an admin can reset an admin account/.test(invite),
    'a setup link IS a password reset, so it gets the same wall');
});

test('the Team Accounts door shows the team block and none of the secrets', () => {
  const html = pub('index.html');
  assert.ok(/id="setSecrets"/.test(html), 'API keys and webhook secrets are wrapped');
  assert.ok(/body:not\(\[data-caps~="admin"\]\) #setSecrets\{display:none\}/.test(html));
  assert.ok(/id="teamAccNavBtn"/.test(html), 'a sidebar entry for account managers');
  assert.ok(/#u_role option\[value="admin"\]\{display:none\}/.test(html),
    'the Admin role option hides for non-admin (the server refuses it regardless)');
  const role = pub('role.js');
  assert.ok(/teamAccNavBtn: 'users'/.test(role), 'gated on the users capability');
  assert.ok(/users:'Team accounts'/.test(html), 'CAP_LABELS stays in sync with lib/auth');
});

test('the four disputer accounts seed at boot, with no plaintext password in the repo', () => {
  const srv = srvNow();
  const seed = srv.split('DISPUTER_SEED = [')[1].split('];')[0];
  for (const n of ['alfred', 'antonette', 'mber', 'yvette']) {
    assert.ok(seed.includes(`username: '${n}'`), n + ' is seeded');
  }
  assert.ok(/role: 'disputer'/.test(srv.split('DISPUTER_SEED')[2] || srv.split('DISPUTER_SEED = [')[1]),
    'seeded as disputers');
  assert.ok(!srv.includes('Dispute2026'), 'the starter password never appears in source -- only scrypt hashes');
  assert.ok(/!seedUsers\.some\(u => \(u\.username \|\| ''\)\.toLowerCase\(\) === d\.username\)/.test(srv),
    'idempotent by username: later password changes and Team edits stick');
  assert.ok(/saveUsersDurable\(seedUsers\)/.test(srv), 'durable like every other account');
});

test('seeded disputers appear in the assignment lists automatically', () => {
  // disputes.js builds its assignee dropdown from /api/users, keeping anyone
  // whose role or capability override includes dispute work -- so the four
  // new accounts show up for Nica and the admins with no further wiring, and
  // the daily worked-checkbox counts (Disputes done card, team activity)
  // track them by name the moment they tick a box.
  const dq = pub('disputes.js');
  const filter = dq.split('DISPUTERS=(us||[])')[1].split('.map(')[0];
  assert.ok(/u\.role==='disputer'/.test(filter));
  assert.ok(/indexOf\('disputes'\)>=0/.test(filter), 'capability overrides count too (Nica herself)');
});

/* ---------- MFSN markable everywhere ---------- */

test('a hand-set MFSN mark beats the name-match guess on the production side', () => {
  const affiliate = require('../lib/affiliate.js');
  const clients = [{ id: 'p1', name: 'April O.' }, { id: 'p2', name: 'Ben K.' }];
  const members = [{ name: 'April Oldman', email: 'a@x.com' }]; // p1 auto-matches
  const g0 = affiliate.productionGap(clients, members, {});
  assert.equal(g0.tagged.find(t => t.id === 'p1').mfsn, 'affiliate', 'auto match still works');
  assert.equal(g0.tagged.find(t => t.id === 'p2').mfsn, 'needs');
  const g1 = affiliate.productionGap(clients, members, { p1: 'not_on_mfsn', p2: 'affiliate' });
  assert.equal(g1.tagged.find(t => t.id === 'p1').mfsn, 'needs', 'the team can overrule a false match');
  assert.equal(g1.tagged.find(t => t.id === 'p2').mfsn, 'affiliate', 'and mark someone the export missed');
  assert.equal(g1.tagged.find(t => t.id === 'p2').mfsnOverride, 'affiliate', 'the drawer can say "marked by hand"');
});

test('the mark is settable from both desks and durable for BOTH id namespaces', () => {
  assert.ok(auth.canAccess({ role: 'va' }, 'POST', '/api/production/x/mfsn'));
  assert.ok(auth.canAccess({ role: 'disputer' }, 'POST', '/api/production/x/mfsn'));
  const srv = srvNow();
  const route = srv.split("app.post('/api/production/:id/mfsn'")[1].split('\n});')[0];
  assert.ok(/setAffiliateOverride/.test(route), 'one override map for every surface');
  assert.ok(/clearCacheKey\('roster:composed'\)/.test(route) && /clearCacheKey\('clients:tagged'\)/.test(route),
    'both cached rosters drop -- both render the pill being changed');
  const st = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  assert.ok(/insert into mfsn_overrides/.test(st),
    'the generic mirror keyed by raw id -- production legacy ids never resolved through the GHL join, so their marks used to evaporate on redeploy');
  assert.ok(/select ext_id, status from mfsn_overrides/.test(st), 'and they hydrate back at boot');
});

test('the pill is a control in the production drawer and the dispute desk', () => {
  const pv = pub('production.js');
  assert.ok(/mfsnmark/.test(pv) && /\/api\/production\/'\+encodeURIComponent\(c\.id\)\+'\/mfsn/.test(pv));
  const dq = pub('disputes.js');
  assert.ok(/dq-mfsn/.test(dq) && /\/mfsn'/.test(dq));
  assert.ok(/marked by hand/.test(pv) && /marked by hand/.test(dq),
    'a hand mark is labeled, so nobody mistakes it for the automatic match');
  const srv = srvNow();
  assert.ok(/record\.mfsnOverride/.test(srv.split("app.get('/api/disputes/:id'")[1].split('\n});')[0]),
    'the dispute record carries the standing so the desk can show it');
});

/* ---------- The Audit (Tiffany's file-by-file pass) ---------- */

test('audit outcomes save durably, overwrite cleanly, and clear on a mis-click', () => {
  const st = require('../lib/store.js');
  const e1 = st.setClientAudit('t-1', { outcome: 'completed', who: 'Tiffany' });
  assert.equal(e1.outcome, 'completed');
  assert.ok(e1.at, 'when it was audited is part of the record');
  const e2 = st.setClientAudit('t-1', { outcome: 'graduated', who: 'Tiffany' });
  assert.equal(st.getClientAudits()['t-1'].outcome, 'graduated', 'a re-audit replaces, not duplicates');
  assert.equal(st.setClientAudit('t-1', { outcome: null }), null);
  assert.ok(!st.getClientAudits()['t-1'], 'cleared -- the client reads as needing an audit again');
  assert.throws(() => st.setClientAudit('t-2', { outcome: 'banana' }), /outcome must be/);
});

test('graduated and completed are separate outcomes, exactly as she drew the line', () => {
  // "Completed means I did what they paid for -- they can possibly still
  // need work. Graduated means I'm finished with their credit."
  const st = require('../lib/store.js');
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'store.js'), 'utf8');
  assert.ok(/'graduated', 'completed', 'free_round', 'in_progress'/.test(src),
    'four outcomes: graduated, completed, free round, still in process');
});

test('the audit routes are admin-only and the tab is invisible to workers', () => {
  assert.ok(!auth.canAccess({ role: 'va' }, 'GET', '/api/audit'), 'not even Nica, until Tiffany opens it up');
  assert.ok(!auth.canAccess({ role: 'disputer' }, 'POST', '/api/audit/x'));
  assert.ok(auth.canAccess({ role: 'admin' }, 'GET', '/api/audit'));
  assert.ok(!auth.canAccessAsset({ role: 'va' }, '/audit.js'), 'the module itself is refused to worker sessions');
  const srv = srvNow();
  const route = srv.split("app.get('/api/audit',")[1].split('\n});')[0];
  assert.ok(/stripCfpbSecretsAll/.test(route), 'no portal passwords ride along on 3,900 rows');
  assert.ok(/audits\[c\.id\] \|\| null/.test(route), 'no entry = not audited = how future clients surface automatically');
  const post = srv.split("app.post('/api/audit/:id',")[1].split('\n});')[0];
  assert.ok(/client_audited/.test(post), 'each mark feeds the activity trail -- auditing will be somebody\'s whole job');
});

test('the audit tab: numbered, un-audited first by default, outcomes explained', () => {
  const au = fs.readFileSync(path.join(__dirname, '..', 'public', 'audit.js'), 'utf8');
  assert.ok(/filter:'todo'/.test(au), 'opens on Not audited -- the work, not the trophies');
  assert.ok(/data-open=/.test(au), 'client name opens the audit drawer');
  assert.ok(/OUT_DESC/.test(au) && /upsell/.test(au), 'each outcome says what it means before you click it');
  assert.ok(/hydrateClientAuditsFromPostgres/.test(srvNow()), 'audit state survives every deploy');
  assert.ok(/audit\.js" defer/.test(pub('index.html')));
});

/* ---------- call quick-fixes ---------- */

test("labels match what Tiffany corrected on the call", () => {
  const html = pub('index.html');
  assert.ok(/Awaiting first round<\/h3>/.test(html), '"Never started" read as "waiting to onboard" to her -- it means round 1 not filed');
  assert.ok(html.includes('<option value="va">Team Lead</option>'), 'VA reads as Team Lead; the role value is unchanged so nothing breaks');
  const pv = pub('production.js');
  assert.ok(/MFSN on/.test(pv) && /MFSN off/.test(pv), 'pill says on/off, her words');
});

test('the audit drawer holds the WHOLE file and their conversation', () => {
  // Her follow-up: the audit tab must carry the message thread for the
  // person AND everything about them -- round they are on, what they paid
  // for, MFSN, all of it -- so one panel serves the whole audit pass.
  const au = fs.readFileSync(path.join(__dirname, '..', 'public', 'audit.js'), 'utf8');
  assert.ok(/Round by bureau/.test(au) && /What they bought/.test(au) && /First paid/.test(au)
    && /MyFreeScoreNow/.test(au), 'round, purchases, MFSN -- the facts she listed');
  assert.ok(/data-mfsn/.test(au), 'MFSN markable right in the drawer');
  assert.ok(/data-out=/.test(au), 'the outcome buttons live in the drawer too');
  assert.ok(/audSend/.test(au) && /\/reply'/.test(au), 'message them without leaving the audit');
  const srv = srvNow();
  const thread = srv.split("app.get('/api/audit/:id/thread'")[1].split('\n});')[0];
  assert.ok(/email/.test(thread) && /phone/.test(thread), 'their thread found by email, then phone, then name');
  assert.ok(/allConversations/.test(thread), 'against the same cached inbox as Messages -- no extra GHL calls');
  const rows = srv.split("app.get('/api/audit',")[1].split('\n});')[0];
  assert.ok(/tu: c\.tu/.test(rows) && /paymentCount/.test(rows) && /firstPaid/.test(rows),
    'the list rows carry bureau rounds and payment history for the drawer');
});

test('the audit list shows every purchase as its own chip, not one truncated string', () => {
  // "you have to show what package they got better" -- the package field
  // accumulates purchases ("3 Month Expedited, Upgrade to Unlimited"), so
  // each segment renders as its own readable chip, with a rounds progress
  // bar and per-bureau rounds beside it.
  const au = fs.readFileSync(path.join(__dirname, '..', 'public', 'audit.js'), 'utf8');
  assert.ok(/function pkgChips/.test(au) && /split\(','\)/.test(au), 'one chip per purchase');
  assert.ok(/function roundsBar/.test(au), 'used-of-bought as a visible bar');
  assert.ok(/function bureauCell/.test(au), 'TU/EQ/EX round each shown');
  assert.ok(/saved \\u2713/.test(au), 'a mark says saved so nobody wonders if it stuck');
});

test('the audit runs itself: start button, plain-English readout, pick = save + next', () => {
  // "make it easier so she knows what to do instantly": one Start button
  // opens the next un-audited file; the drawer reads the file out loud in a
  // sentence (rounds bought vs used, monitoring on/off, last paid) and
  // flags which outcome that usually means; picking an outcome saves and
  // opens the next file, so the whole pass is read, message, pick, repeat.
  const au = fs.readFileSync(path.join(__dirname, '..', 'public', 'audit.js'), 'utf8');
  assert.ok(/auStart/.test(au) && /Start auditing/.test(au));
  assert.ok(/function nextTodo/.test(au), 'always knows which file is next');
  assert.ok(/function readFile/.test(au) && /used <b>all of them<\/b>/.test(au),
    'the sentence does the thinking; she only corrects it');
  assert.ok(/likely this one/.test(au), 'the usual outcome is flagged, never auto-picked');
  assert.ok(/au-outcard/.test(au) && /it saves and opens the next file/.test(au),
    'outcomes are big labeled cards with their meaning visible, not tooltips');
  assert.ok(/audSkip/.test(au), 'skip moves on without marking');
});

test('after the audit: replies and MFSN signups show up on their own', () => {
  // "it has to track if they end up signing for MFSN or if somebody
  // responds". MFSN state is live (the member-list sync flips the pill the
  // moment they appear on it), and the audit list joins the inbox so a
  // client who spoke last carries a 'replied' badge, with totals for both.
  const srv = srvNow();
  const route = srv.split("app.get('/api/audit',")[1].split('\napp.')[0];
  assert.ok(/auditedMfsnOn/.test(route) && /auditedReplied/.test(route));
  assert.ok(/lastDirection === 'inbound'/.test(route), 'replied means THEY spoke last');
  const au = fs.readFileSync(path.join(__dirname, '..', 'public', 'audit.js'), 'utf8');
  assert.ok(/au-replied/.test(au) && /data-f="replied"/.test(au), 'a badge on the row and a filter for them');
});

test('threads read oldest-first everywhere -- GHL hands them back reversed', () => {
  // "the texts seem off and mixed up": GHL returns newest-first and both
  // thread endpoints passed that through, so every conversation rendered
  // upside down. Both now sort by time before answering.
  const srv = srvNow();
  const msgs = srv.split("app.get('/api/messages/:id'")[1].split('\n});')[0];
  assert.ok(/localeCompare\(String\(b\.at/.test(msgs));
  const audThread = srv.split("app.get('/api/audit/:id/thread'")[1].split('\n});')[0];
  assert.ok(/localeCompare\(String\(b\.at/.test(audThread));
  assert.ok(/nameHits\.length === 1/.test(audThread),
    'and a bare name only matches when unique -- two Kiaras must never swap texts');
});
