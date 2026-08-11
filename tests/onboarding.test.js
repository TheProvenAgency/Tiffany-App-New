// "New clients in, flagged if more than 5 days without being onboarded."
//
// The clock has to be days since they PAID, not days-in-stage. Checked against
// the live roster first: of 305 clients sitting in Onboarding, days-in-stage is
// null for 153 and 0-5 for the other 152 -- it is not tracking how long anyone
// has actually been waiting. Flagging on it would surface nobody, and the card
// would look reassuring while 258 people who paid over a month ago sat unworked.
const { test } = require('node:test');
const assert = require('node:assert');
const onboarding = require('../lib/onboarding.js');

const NOW = new Date('2026-08-11T00:00:00Z').getTime();
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();
const c = (over) => Object.assign({
  id: 'x', name: 'A Client', pkg: 'Full Repair', stage: 'Onboarding',
  lastPaid: daysAgo(1), docs: { SSC: true, DL: false }, mfsn: 'needs'
}, over);

test('a client past the SLA is flagged, one inside it is not', () => {
  const q = onboarding.buildQueue([
    c({ id: 'fresh', lastPaid: daysAgo(2) }),
    c({ id: 'late', lastPaid: daysAgo(9) })
  ], { now: NOW });
  const by = Object.fromEntries(q.items.map(i => [i.id, i]));
  assert.equal(by.fresh.flagged, false);
  assert.equal(by.late.flagged, true);
  assert.equal(by.late.waitingDays, 9);
});

test('the boundary is "more than five days", not five', () => {
  const q = onboarding.buildQueue([
    c({ id: 'five', lastPaid: daysAgo(5) }),
    c({ id: 'six', lastPaid: daysAgo(6) })
  ], { now: NOW });
  const by = Object.fromEntries(q.items.map(i => [i.id, i]));
  assert.equal(by.five.flagged, false, 'day five is still within the window');
  assert.equal(by.six.flagged, true);
});

test('only clients still onboarding are counted', () => {
  const q = onboarding.buildQueue([
    c({ id: 'done', stage: 'Completed', lastPaid: daysAgo(60) }),
    c({ id: 'rounds', stage: 'In rounds', lastPaid: daysAgo(60) }),
    c({ id: 'onb', stage: 'Onboarding', lastPaid: daysAgo(60) })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['onb']);
});

test('longest wait first, because that is the one worth chasing', () => {
  const q = onboarding.buildQueue([
    c({ id: 'a', lastPaid: daysAgo(10) }),
    c({ id: 'b', lastPaid: daysAgo(40) }),
    c({ id: 'c', lastPaid: daysAgo(20) })
  ], { now: NOW });
  assert.deepEqual(q.items.map(i => i.id), ['b', 'c', 'a']);
});

test('a client with no purchase date is surfaced but never called late', () => {
  // 43 of the 305 onboarding clients have no purchase date. Hiding them would
  // understate the backlog; claiming a wait we cannot compute would be worse.
  const q = onboarding.buildQueue([
    c({ id: 'nodate', lastPaid: null }),
    c({ id: 'late', lastPaid: daysAgo(30) })
  ], { now: NOW });
  const by = Object.fromEntries(q.items.map(i => [i.id, i]));
  assert.equal(by.nodate.waitingDays, null);
  assert.equal(by.nodate.flagged, false, 'an unknown wait is not a breach');
  assert.equal(q.totals.undated, 1);
  assert.equal(q.items[q.items.length - 1].id, 'nodate', 'undated must not outrank a real breach');
});

test('totals describe the whole backlog, not just the rows shown', () => {
  const many = Array.from({ length: 40 }, (_, i) => c({ id: 'c' + i, lastPaid: daysAgo(30) }));
  const q = onboarding.buildQueue(many, { now: NOW, limit: 8 });
  assert.equal(q.items.length, 8);
  assert.equal(q.totals.onboarding, 40);
  assert.equal(q.totals.flagged, 40);
  assert.equal(q.totals.longestWait, 30);
});

test('the SLA is configurable rather than a magic 5 buried in the code', () => {
  const q = onboarding.buildQueue([c({ id: 'a', lastPaid: daysAgo(9) })], { now: NOW, slaDays: 14 });
  assert.equal(q.items[0].flagged, false);
  assert.equal(q.totals.slaDays, 14);
});

test('each row carries what you need to act, and no money', () => {
  const q = onboarding.buildQueue([c({ id: 'a', totalSpent: 999, lastPaid: daysAgo(9) })], { now: NOW });
  const row = q.items[0];
  assert.equal(row.docsOnFile, 1);
  assert.equal(row.docsTotal, 2);
  assert.equal(row.mfsn, 'needs');
  assert.ok(!/999/.test(JSON.stringify(row)), 'onboarding is desk work; money has no place on it');
});
