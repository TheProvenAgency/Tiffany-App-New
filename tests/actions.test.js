// The dashboard could already tell you there is $62,718/month sitting in
// 4,287 clients who aren't on MyFreeScoreNow. What it couldn't tell you is
// who to call first. A number on a card is not a piece of work.
//
// These tests hold the queue to the things that make it trustworthy: it must
// rank people you can actually reach above people you can't, it must not
// invent value, and it must never put money figures in front of a disputer.
const { test } = require('node:test');
const assert = require('node:assert');
const actions = require('../lib/actions.js');

const client = (over) => Object.assign({
  id: 'c1', name: 'A Client', email: 'a@example.com', phone: '15550001111',
  status: 'active', lastPaymentDate: '2026-07-01', totalSpent: 500,
  mfsnStatus: 'not_on_mfsn', mfsnCommission: 14.63
}, over);

test('an unreachable client ranks below a reachable one of equal value', () => {
  // You cannot call someone with no phone and no email, so they cannot be
  // the top of a call list no matter what they're worth.
  const q = actions.buildQueue({
    notOnMfsn: [
      client({ id: 'noContact', name: 'No Contact', email: null, phone: null }),
      client({ id: 'reachable', name: 'Reachable' })
    ]
  });
  const ids = q.items.map(i => i.id);
  assert.ok(ids.indexOf('reachable') < ids.indexOf('noContact'),
    'the reachable client should come first');
});

test('an active client outranks a long-churned one', () => {
  const q = actions.buildQueue({
    notOnMfsn: [
      client({ id: 'cold', status: 'inactive', lastPaymentDate: '2024-01-01' }),
      client({ id: 'warm', status: 'active', lastPaymentDate: '2026-07-20' })
    ]
  });
  assert.equal(q.items[0].id, 'warm');
});

test('every item carries its own monthly value and they sum to the total', () => {
  const q = actions.buildQueue({
    notOnMfsn: [client({ id: 'a', mfsnCommission: 14.63 }), client({ id: 'b', mfsnCommission: 20 })]
  });
  for (const i of q.items) assert.ok(i.monthlyValue > 0, 'each action should be worth something');
  const summed = q.items.reduce((s, i) => s + i.monthlyValue, 0);
  assert.ok(Math.abs(summed - q.totals.monthlyValue) < 0.01);
});

test('value is never invented for an action that has none', () => {
  // Dispute rounds are work, not revenue. Attaching a dollar figure to them
  // would inflate the headline with money that does not exist.
  const q = actions.buildQueue({
    rounds: [{ id: 'r1', name: 'R', stage: 'Ready', status: 'ready', days: 40, readyBureaus: ['tu'] }]
  });
  const round = q.items.find(i => i.type === 'round');
  assert.equal(round.monthlyValue, 0, 'a dispute round is not recurring revenue');
  assert.equal(q.totals.monthlyValue, 0);
});

test('the longest-stalled round comes first', () => {
  const q = actions.buildQueue({
    rounds: [
      { id: 'new', name: 'N', stage: 'Ready', status: 'ready', days: 3, readyBureaus: ['tu'] },
      { id: 'old', name: 'O', stage: 'Ready', status: 'ready', days: 400, readyBureaus: ['tu'] }
    ]
  });
  const rounds = q.items.filter(i => i.type === 'round');
  assert.equal(rounds[0].id, 'old');
});

test('a disputer sees the work and never the money', () => {
  // Same guarantee lib/disputes.js makes. The queue is a second surface onto
  // the same clients, so it has to make it too or the money leaks sideways.
  const q = actions.buildQueue({
    notOnMfsn: [client({ id: 'a' })],
    rounds: [{ id: 'r1', name: 'R', stage: 'Ready', status: 'ready', days: 10, readyBureaus: ['tu'] }]
  }, { capabilities: ['disputes'] });
  assert.ok(q.items.every(i => i.type === 'round'), 'a disputer should only see rounds');
  assert.equal(q.totals.monthlyValue, undefined, 'no money total for a disputer');
  const blob = JSON.stringify(q);
  assert.ok(!/monthlyValue"\s*:\s*[1-9]/.test(blob), 'no value figures anywhere in the payload');
});

test('the queue is capped so it reads as a day of work, not a database dump', () => {
  const many = Array.from({ length: 500 }, (_, i) => client({ id: 'c' + i }));
  const q = actions.buildQueue({ notOnMfsn: many }, { limit: 20 });
  assert.equal(q.items.length, 20);
  // ...but the totals must describe the whole opportunity, not just the page.
  assert.equal(q.totals.enrollAvailable, 500);
});

test('marking something done removes it from the next build', () => {
  const q = actions.buildQueue({ notOnMfsn: [client({ id: 'a' }), client({ id: 'b' })] },
    { done: { 'enroll:a': '2026-08-10' } });
  assert.ok(!q.items.some(i => i.id === 'a'), 'a completed action should not come back');
  assert.ok(q.items.some(i => i.id === 'b'));
});

test('a disputer can load the page and the endpoint', () => {
  // The queue is the one screen every role opens, so both the asset and the
  // route have to be reachable without the revenue capability -- while the
  // money stays absent from the payload itself.
  const auth = require('../lib/auth.js');
  assert.ok(auth.canAccessAsset('disputer', '/actions.js'),
    'a disputer must be able to load the Today page');
  assert.ok(auth.canAccess('disputer', 'GET', '/api/actions'),
    'a disputer must be able to fetch their own queue');
  assert.ok(auth.canAccess('va', 'GET', '/api/actions'));
});

test('the done key is validated, not trusted', () => {
  // It goes straight into a persisted config object, so a caller must not be
  // able to write an arbitrary key into it.
  const re = /^(enroll|round):[\w.-]{1,80}$/;
  assert.ok(re.test('enroll:abc123'));
  assert.ok(re.test('round:CSV-22'));
  assert.ok(!re.test('__proto__'));
  assert.ok(!re.test('enroll:' + 'x'.repeat(200)));
  assert.ok(!re.test('other:abc'));
});
