// The admin operations view.
const { test } = require('node:test');
const assert = require('node:assert');
const ops = require('../lib/ops.js');

const NOW = new Date('2026-08-11T00:00:00Z').getTime();
const ago = n => new Date(NOW - n * 86400000).toISOString();
const c = (over) => Object.assign({
  id: 'x', name: 'A', pkg: '3 Month Expedited', stage: 'Ready',
  lastPaid: ago(1), tu: { r: 0 }, eq: { r: 0 }, ex: { r: 0 }, docs: {}
}, over);

test('never-started means paid with no round filed anywhere', () => {
  const q = ops.firstRoundOverdue([
    c({ id: 'none', tu: { r: 0 } }),
    c({ id: 'started', tu: { r: 1 } }),
    c({ id: 'eqonly', tu: { r: 0 }, eq: { r: 2 } })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['none'],
    'a round on any bureau counts as started');
});

test('a completed client is not waiting on a first round', () => {
  const q = ops.firstRoundOverdue([c({ id: 'done', stage: 'Completed' })], { now: NOW });
  assert.equal(q.items.length, 0);
});

test('flagged past the SLA, and the boundary is "more than"', () => {
  const q = ops.firstRoundOverdue([
    c({ id: 'at', lastPaid: ago(14) }),
    c({ id: 'past', lastPaid: ago(15) })
  ], { now: NOW, slaDays: 14 });
  const by = Object.fromEntries(q.items.map(i => [i.id, i]));
  assert.equal(by.at.flagged, false);
  assert.equal(by.past.flagged, true);
});

test('an unknown wait is surfaced but never called a breach', () => {
  const q = ops.firstRoundOverdue([c({ id: 'nodate', lastPaid: null, firstPaid: null })], { now: NOW });
  assert.equal(q.items[0].waitingDays, null);
  assert.equal(q.items[0].flagged, false);
  assert.equal(q.totals.undated, 1);
});

test('the clock restarts on a repeat purchase, same as onboarding', () => {
  const q = ops.firstRoundOverdue([
    c({ id: 'repeat', firstPaid: ago(300), lastPaid: ago(3) })
  ], { now: NOW, slaDays: 14 });
  assert.equal(q.items[0].waitingDays, 3);
  assert.equal(q.items[0].flagged, false);
});

test('the snapshot counts states, and does not claim a rate it cannot measure', () => {
  const s = ops.snapshot([
    c({ stage: 'Completed' }), c({ stage: 'Completed' }),
    c({ stage: 'In rounds' }), c({ stage: 'Onboarding', lastPaid: ago(200) })
  ], { now: NOW });
  assert.equal(s.total, 4);
  assert.equal(s.completed, 2);
  assert.equal(s.byStage['In rounds'], 1);
  // There are no per-round timestamps in the data, so "completed this month"
  // is not derivable and must not appear.
  assert.equal(s.completedThisMonth, undefined);
});

test('new clients are those who bought recently, on the same clock', () => {
  const s = ops.snapshot([
    c({ lastPaid: ago(5) }), c({ lastPaid: ago(29) }), c({ lastPaid: ago(45) })
  ], { now: NOW, newWithinDays: 30 });
  assert.equal(s.newClients, 2);
});

test('per-owner numbers are ownership, not throughput', () => {
  // Nothing in the data records who advanced a stage or filed a round, so this
  // can only say who holds what. Presenting it as productivity would be a
  // claim the data cannot support.
  const s = ops.snapshot([
    c({ va: 'Marta', stage: 'Completed' }),
    c({ va: 'Marta', tu: { r: 2 } }),
    c({ va: 'Marta' }),
    c({ va: '—' })
  ], { now: NOW });
  const marta = s.owners.find(o => o.owner === 'Marta');
  assert.equal(marta.total, 3);
  assert.equal(marta.completed, 1);
  assert.equal(marta.inRounds, 1);
  assert.equal(marta.notStarted, 1);
  assert.equal(s.unassigned, 1);
});

test('longest wait comes first, undated last', () => {
  const q = ops.firstRoundOverdue([
    c({ id: 'a', lastPaid: ago(20) }),
    c({ id: 'none', lastPaid: null, firstPaid: null }),
    c({ id: 'b', lastPaid: ago(90) })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['b', 'a', 'none']);
});

test('the package is editable, and editing it re-reads the allowance', () => {
  // The package decides the round allowance, and 49 clients carry one the
  // parser cannot read. Without an edit path the only fix was changing the
  // sheet the records were seeded from.
  const fs = require('fs');
  const path = require('path');
  const auth = require('../lib/auth.js');
  assert.deepEqual(auth.filterEditable('employee', { pkg: '3 Month Expedited' }).denied, []);
  assert.deepEqual(auth.filterEditable('disputer', { pkg: 'x' }).denied, ['pkg'],
    'a disputer has no business repricing a client');

  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const patch = src.split("app.patch('/api/production/:id'")[1].split('\n});')[0];
  assert.ok(/rounds\.attach\(\[lead\]\)/.test(patch),
    'the response must carry the recomputed allowance; the drawer cannot work it out');
});

test('the operations route is desk work, not a money surface', () => {
  const auth = require('../lib/auth.js');
  for (const role of ['admin', 'va', 'employee']) {
    assert.ok(auth.canAccess(role, 'GET', '/api/ops'), `${role} should reach it`);
  }
  assert.ok(!auth.canAccess('disputer', 'GET', '/api/ops'));
});

test('the card never claims a completion rate', () => {
  // There are no per-round or per-stage timestamps in the data, so "completed
  // this month" is not derivable. The card counts states, and says so.
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const card = page.split('gs-id="ops"')[1].split('</div></div>')[0];
  assert.ok(!/this month|per month|this week|rate/i.test(card),
    'the card must not imply a throughput it cannot measure');
});

test('the client drawer opens before the data arrives, not after', () => {
  // /api/clients/:id measured 5.5s live because it reads the whole roster to
  // find one client. openClient() awaited that before touching the DOM, so
  // clicking a client did nothing at all for several seconds -- which reads as
  // "clicking doesn't work" rather than "it is loading".
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const fn = page.split('async function openClient(id)')[1].split('\n}')[0];
  const openAt = fn.indexOf("classList.add('open')");
  const fetchAt = fn.indexOf('await fetch');
  assert.ok(openAt > -1 && openAt < fetchAt,
    'the drawer must open before the request, not after it resolves');
  assert.ok(/Loading/.test(fn), 'and say that it is loading');
});

test('a failed client load says so instead of doing nothing', () => {
  // `if(!r.ok) return;` made a failure look identical to a slow success.
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const fn = page.split('async function openClient(id)')[1].split('\n}')[0];
  assert.ok(!/if\(!r\.ok\)return;/.test(fn.replace(/\s/g, '')),
    'a silent return leaves the user staring at nothing');
  assert.ok(/Could not load this client/.test(fn));
});

test('the actionable cards sit above the charts', () => {
  const fs = require('fs');
  const path = require('path');
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const y = (id) => {
    const m = page.match(new RegExp('gs-id="' + id + '" gs-x="\\d+" gs-y="(\\d+)"'));
    return m ? Number(m[1]) : null;
  };
  assert.ok(y('onboarding') < y('rev-trend'), 'work to do comes before the sales chart');
  assert.ok(y('ops') < y('what-changed'));
  assert.ok(y('replies-due') < y('rev-trend'));
});

test('caching the tagged roster does not serve a stale affiliate status', () => {
  // The cache added for drawer speed is keyed on the roster, but the affiliate
  // OVERRIDE is a separate input -- so changing it left the drawer showing the
  // old status for up to a minute. Caught by two existing tests, not by me.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const route = src.split("app.post('/api/clients/:id/affiliate'")[1].split('\n});')[0];
  assert.ok(/clearCacheKey\('clients:tagged'\)/.test(route),
    'an override must invalidate the tagged roster');
  const order = route.indexOf("clearCacheKey") < route.indexOf('withAffiliateTags');
  assert.ok(order, 'and must do so before re-reading');
});
