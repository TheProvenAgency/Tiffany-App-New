// The dispute desk is where a disputer spends their day, so the list has to be
// honest about what can actually be worked.
//
// The problem it had: 390 rows marked "Ready to file" while every one of them
// was missing all 8 documents. Bureau readiness and paperwork are two separate
// gates and the queue only showed one, so working the list top-down meant
// opening file after file and finding none of them could be filed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const disputes = require('../lib/disputes.js');

const rec = (over) => Object.assign({
  id: 'x', name: 'A', stage: 'Ready', days: 10,
  tu: { r: 1, st: 'ready' }, docs: { SSC: true, DL: true }
}, over);

test('workable means bureau ready AND paperwork complete', () => {
  const [r] = disputes.buildQueue([rec()]);
  assert.equal(r.workableNow, true);
});

test('bureau ready with missing docs is not workable', () => {
  const [r] = disputes.buildQueue([rec({ docs: { SSC: true, DL: false } })]);
  assert.equal(r.status, 'ready', 'the bureau really is ready');
  assert.equal(r.workableNow, false, 'but nothing can be filed without the paperwork');
});

test('blocked on a login is never workable, whatever the docs say', () => {
  const [r] = disputes.buildQueue([rec({ tu: { r: 1, st: 'login' } })]);
  assert.equal(r.status, 'blocked');
  assert.equal(r.workableNow, false);
});

test('a client with no document record is not assumed ready', () => {
  // countMissingDocs returns null when nothing is recorded, which is not zero.
  const [r] = disputes.buildQueue([rec({ docs: undefined })]);
  assert.equal(r.docsMissing, null);
  assert.equal(r.workableNow, false);
});

test('workable files sort above everything else', () => {
  const q = disputes.buildQueue([
    rec({ id: 'stuck', days: 400, docs: { SSC: false } }),
    rec({ id: 'go', days: 2 })
  ]);
  assert.equal(q[0].id, 'go', 'a file you can work today beats a longer-waiting one you cannot');
});

test('among unworkable files, fewest documents outstanding comes first', () => {
  // Three missing is closer to workable than eight, and chasing three is a
  // shorter conversation.
  const q = disputes.buildQueue([
    rec({ id: 'eight', docs: { a:false,b:false,c:false,d:false,e:false,f:false,g:false,h:false } }),
    rec({ id: 'one', docs: { a:true,b:true,c:false } })
  ]);
  assert.deepEqual(q.map(r => r.id), ['one', 'eight']);
});

test('the desk offers the filters that match those gates, and a search', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'disputes.js'), 'utf8');
  for (const f of ['workable', 'docs', 'blocked', 'mine', 'all']) {
    assert.ok(ui.includes('data-f="' + f + '"'), 'missing the ' + f + ' filter');
  }
  assert.ok(/id="dqSearch"/.test(ui), '1,231 rows with no search is not a work tool');
});

test('the dead days-in-stage column is gone from the desk', () => {
  // It reads 0 for all 1,231 rows, so it was a column of zeroes and a
  // "longest wait" headline of nothing.
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'disputes.js'), 'utf8');
  assert.ok(!/<th>Waiting<\/th>/.test(ui));
  assert.ok(!/dqKOld/.test(ui), 'the longest-wait KPI had no value to show');
});
