// From the team walkthrough: the spreadsheet this replaces is kept in
// newest-purchase order, and Deal Production had no purchase date at all --
// only days-in-stage. Without it the queue can't be worked the way the team
// already works.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const affiliate = require('../lib/affiliate.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');

test('the purchase date is joined on from the roster, not invented', () => {
  const fn = src.split('async function withLastPaid(')[1].split('\n}')[0];
  assert.ok(fn.includes('lastPaymentDate'), 'it should come from the roster field');
  assert.ok(/normEmail/.test(fn) && /normName/.test(fn),
    'matching should reuse the same helpers as the MFSN tag, or the two disagree about who is who');
  assert.ok(/email/.test(fn.split('normName')[0]),
    'email should be tried before the coarser name match');
});

test('a roster failure leaves the rows alone rather than blanking the column', () => {
  const fn = src.split('async function withLastPaid(')[1].split('\n}')[0];
  assert.ok(/catch \(e\) \{ return clients; \}/.test(fn),
    'no date is better than a wrong one');
});

test('the queue opens on newest purchase first', () => {
  assert.ok(/var curSort='paid', sortDir=-1;/.test(prod),
    'anything else means re-sorting on every visit');
});

test('sorting is stable so paging does not reshuffle equal rows', () => {
  const fn = prod.split('function currentRows()')[1].split('\n}')[0];
  assert.ok(/localeCompare/.test(fn), 'ties need a deterministic tie-break');
});

test('dates and counts sort biggest-first, names do not', () => {
  const fn = prod.split('function wireSort()')[1].split('\n}\n')[0];
  assert.ok(/k==='paid'\|\|k==='days'\|\|k==='docs'\|\|k==='mfsn'\)\?-1:1/.test(fn));
});

test('a client with no recorded purchase sorts last rather than first', () => {
  // -Infinity with a descending default puts unknowns at the bottom, which is
  // right: an unknown date is not a recent one.
  const fn = prod.split('function sortVal(')[1].split('\n}')[0];
  assert.ok(/lastPaid\?new Date\(c\.lastPaid\)\.getTime\(\):-Infinity/.test(fn));
});

test('normEmail and normName are exported for the join to use', () => {
  assert.equal(typeof affiliate.normEmail, 'function');
  assert.equal(typeof affiliate.normName, 'function');
});
