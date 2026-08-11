// Rounds bought, rounds used, rounds left -- and therefore who is finished and
// worth an upsell.
//
// The parsing rule was read off the data, not assumed. Grouping all 3,578
// clients by package and taking the highest round any of them reached:
// "3 Month Expedited" (533 clients) tops out at 3, "1 Month Expedited" (339)
// at 1, "4 Expedited Rounds" (75) at 4. The leading number is the allowance
// whether the package says Month or Rounds. Anything carrying "Unlimited" runs
// past it freely -- "3 Month Expedited, Upgrade to Unlimited" reaches 8.
const { test } = require('node:test');
const assert = require('node:assert');
const rounds = require('../lib/rounds.js');
const fs2 = require('fs');
const path2 = require('path');

const c = (pkg, tu, eq, ex) => ({
  id: 'x', name: 'A', pkg,
  tu: { r: tu || 0 }, eq: { r: eq || 0 }, ex: { r: ex || 0 }
});

test('the leading number is the allowance, however the package spells it', () => {
  for (const [pkg, want] of [
    ['3 Month Expedited', 3], ['3 Expedited Rounds', 3], ['1 Month Expedited', 1],
    ['2 Month Expedited', 2], ['4 Expedited Rounds', 4], ['1 Expedited Round', 1],
    ['6 Month Expedited', 6], ['3 Months Credit Repair', 3]
  ]) {
    assert.equal(rounds.roundsIncluded(pkg), want, `${pkg} should be ${want}`);
  }
});

test('unlimited beats whatever was bought first', () => {
  assert.equal(rounds.roundsIncluded('3 Month Expedited, Upgrade to Unlimited'), rounds.UNLIMITED);
  assert.equal(rounds.roundsIncluded('Unlimited Credit Repair Package'), rounds.UNLIMITED);
  const r = rounds.forClient(c('Upgrade to Unlimited', 8, 8, 8));
  assert.equal(r.roundsLeft, null, 'unlimited has no remaining count');
  assert.equal(r.finished, false, 'and can never be finished');
});

test('a week is not a round', () => {
  // "2 Week Quick Fix" must not read as two rounds just because it starts
  // with a digit. Only month and round count as the unit.
  assert.equal(rounds.roundsIncluded('2 Week Quick Fix'), 1, 'it is a quick-fix, worth one');
});

test('an unreadable package is unknown, not zero', () => {
  // "Full Expedited Credit Repair" is 519 clients and its allowance cannot be
  // read from the name. Calling it 0 would report every one of them finished.
  for (const pkg of ['Full Expedited Credit Repair', '(HLP)', 'mentorship', '']) {
    assert.equal(rounds.roundsIncluded(pkg), null, `${pkg} should be unknown`);
  }
  const r = rounds.forClient(c('Full Expedited Credit Repair', 3, 3, 3));
  assert.equal(r.finished, false, 'an unknown allowance can never be finished');
  assert.equal(r.roundsLeft, null);
});

test('a repeat purchase adds allowance, because the package field accumulates', () => {
  // Buying again appends rather than replaces. Reading only the first number
  // is what produced 143 clients apparently using more rounds than they bought.
  assert.equal(rounds.roundsIncluded('3 Month Expedited, 3 Month Expedited'), 6);
  const r = rounds.forClient(c('3 Month Expedited, 3 Month Expedited', 6, 6, 5));
  assert.equal(r.roundsIncluded, 6);
  assert.equal(r.roundsLeft, 0);
  assert.equal(r.finished, true);
});

test('a package with an unreadable half gives a floor, and refuses to call it finished', () => {
  // "Experian Expedited Removal, 3 Month Expedited" is at least 3 rounds, but
  // the first half is unreadable so the real allowance may be higher. Claiming
  // finished here is a refund conversation, not an upsell.
  const inc = rounds.roundsIncluded('Experian Expedited Removal, 3 Month Expedited');
  assert.deepEqual(inc, { atLeast: 3 });
  const r = rounds.forClient(c('Experian Expedited Removal, 3 Month Expedited', 3, 3, 3));
  assert.equal(r.roundsIncluded, 3);
  assert.equal(r.allowanceExact, false);
  assert.equal(r.finished, false, 'not exact, so not claimed as finished');
});

test('rounds used is the furthest bureau, not the sum', () => {
  // Rounds go out per bureau and do not move together. Summing would
  // triple-count a single round and finish everybody immediately.
  assert.equal(rounds.roundsUsed(c('x', 3, 2, 1)), 3);
  assert.equal(rounds.roundsUsed(c('x', 0, 0, 0)), 0);
  assert.equal(rounds.roundsUsed(null), 0);
});

test('rounds left never goes negative', () => {
  // 62 clients have genuinely had more rounds than their package names, which
  // is a real thing that happens. It should read as none left, not minus three.
  const r = rounds.forClient(c('3 Month Expedited', 6, 6, 6));
  assert.equal(r.roundsLeft, 0);
  assert.equal(r.finished, true);
});

test('the upsell list is only people you can honestly say are done', () => {
  const q = rounds.upsellQueue([
    c('3 Month Expedited', 3, 3, 3),             // finished
    c('3 Month Expedited', 1, 1, 1),             // mid-package
    c('Unlimited Credit Repair Package', 9, 9, 9), // never finished
    c('Full Expedited Credit Repair', 5, 5, 5)   // unknown allowance
  ]);
  assert.equal(q.items.length, 1);
  assert.equal(q.totals.finished, 1);
  assert.equal(q.totals.unlimited, 1);
  assert.equal(q.totals.unknownAllowance, 1);
});

test('against the real roster, most clients get a readable allowance', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'seed', 'production-seed.json'), 'utf8'));
  const cs = Array.isArray(raw) ? raw : (raw.clients || []);
  const out = rounds.attach(cs);
  const readable = out.filter(x => x.roundsIncluded !== null).length;
  assert.ok(readable > cs.length * 0.7,
    `only ${readable} of ${cs.length} packages were readable`);
  assert.ok(out.filter(x => x.finished).length > 0, 'somebody should be finished');
  assert.ok(out.every(x => x.roundsLeft === null || x.roundsLeft >= 0),
    'no negative remainders');
});

test('every client row carries its remaining rounds', () => {
  // The ask was that each client shows how many are left, not just a summary
  // card, so the attach has to run on the roster the tracker reads.
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'server.js'), 'utf8');
  const route = src.split("app.get('/api/production'")[1].split('\n});')[0];
  assert.ok(/rounds\.attach\(/.test(route),
    '/api/production should attach rounds to every row');
});

test('an unreadable package shows a dash, never a zero, in the table', () => {
  // 519 clients are on "Full Expedited Credit Repair". Rendering 0 left for
  // them would read as finished and put them all on the upsell list.
  const prod = fs2.readFileSync(path2.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  const fn = prod.split('function roundsCell(c){')[1].split('\n}')[0];
  assert.ok(/roundsIncluded==null\)return .*-/.test(fn), 'unknown should render a dash');
  assert.ok(/roundsIncluded==='unlimited'/.test(fn), 'unlimited needs its own label');
});
