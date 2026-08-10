const { test } = require('node:test');
const assert = require('node:assert');
const disputes = require('../lib/disputes');

const rec = (over = {}) => ({
  id: 'C1', name: 'A B', pkg: '3 Month', stage: 'In rounds', days: 10,
  tu: { r: 2, st: 'done' }, eq: { r: 2, st: 'done' }, ex: { r: 2, st: 'done' },
  docs: {}, va: '—', notes: [], ...over
});

// ------------------------- queue -------------------------

test('a client with a bureau ready for its next round lands in the queue', () => {
  const q = disputes.buildQueue([rec({ ex: { r: 2, st: 'ready' } })]);
  assert.equal(q.length, 1);
  assert.equal(q[0].id, 'C1');
  assert.deepEqual(q[0].readyBureaus, ['ex']);
  assert.equal(q[0].status, 'ready');
});

test('a client whose bureaus are all filed is not in the queue', () => {
  assert.equal(disputes.buildQueue([rec()]).length, 0);
});

test('a client blocked on monitoring login is surfaced, but flagged separately from ready', () => {
  const q = disputes.buildQueue([rec({
    tu: { r: 1, st: 'login' }, eq: { r: 1, st: 'login' }, ex: { r: 1, st: 'login' }
  })]);
  assert.equal(q.length, 1);
  assert.equal(q[0].status, 'blocked');
  assert.deepEqual(q[0].blockedBureaus, ['tu', 'eq', 'ex']);
  assert.deepEqual(q[0].readyBureaus, []);
});

test('ready outranks blocked when a client has both', () => {
  const q = disputes.buildQueue([rec({
    tu: { r: 1, st: 'ready' }, eq: { r: 1, st: 'login' }, ex: { r: 1, st: 'done' }
  })]);
  assert.equal(q[0].status, 'ready');
  assert.deepEqual(q[0].readyBureaus, ['tu']);
  assert.deepEqual(q[0].blockedBureaus, ['eq']);
});

test('completed clients never enter the queue even with a stale bureau flag', () => {
  const q = disputes.buildQueue([rec({ stage: 'Completed', ex: { r: 2, st: 'ready' } })]);
  assert.equal(q.length, 0);
});

test('the queue is ordered ready-first, then by longest waiting', () => {
  const q = disputes.buildQueue([
    rec({ id: 'blocked-old', days: 400, tu: { r: 1, st: 'login' } }),
    rec({ id: 'ready-new', days: 5, tu: { r: 1, st: 'ready' } }),
    rec({ id: 'ready-old', days: 300, tu: { r: 1, st: 'ready' } })
  ]);
  assert.deepEqual(q.map(x => x.id), ['ready-old', 'ready-new', 'blocked-old']);
});

test('the queue carries no money field of any kind', () => {
  const q = disputes.buildQueue([rec({
    tu: { r: 1, st: 'ready' }, totalSpent: 900, mfsnCommission: 13.8, pkg: '3 Month'
  })]);
  const keys = Object.keys(q[0]);
  for (const banned of ['totalSpent', 'mfsnCommission', 'revenue', 'payments']) {
    assert.equal(keys.includes(banned), false, `queue row must not carry ${banned}`);
  }
});

// ------------------------- per-client record -------------------------

test('a dispute record exposes bureau status, round history and the document checklist', () => {
  const d = disputes.toDisputeRecord(rec({
    tu: { r: 3, st: 'ready' },
    docs: { SSC: true, DL: false },
    notes: [{ when: '2026-01-01', who: 'X', text: 'hi' }]
  }));
  assert.equal(d.id, 'C1');
  assert.equal(d.bureaus.tu.round, 3);
  assert.equal(d.bureaus.tu.status, 'ready');
  assert.deepEqual(d.docs, { SSC: true, DL: false });
  assert.equal(d.notes.length, 1);
  assert.equal(d.currentRound, 3, 'the furthest round any bureau has reached');
});

test('a dispute record strips money even if the source row carries it', () => {
  const d = disputes.toDisputeRecord(rec({ totalSpent: 900, mfsnCommission: 13.8 }));
  assert.equal(d.totalSpent, undefined);
  assert.equal(d.mfsnCommission, undefined);
});

test('a missing record yields null rather than throwing', () => {
  assert.equal(disputes.toDisputeRecord(null), null);
});
