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
  // Calling an unreadable allowance 0 would report every one of those clients
  // finished. They stay unknown and finish only on the pipeline stage.
  for (const pkg of ['mentorship', 'Strong Method', 'Late to Positive', '']) {
    assert.equal(rounds.roundsIncluded(pkg), null, `${pkg} should be unknown`);
  }
  const r = rounds.forClient(c('Strong Method', 3, 3, 3));
  assert.equal(r.finished, false, 'an unknown allowance cannot finish on a count');
  assert.equal(r.roundsLeft, null);
});

test('"Full" packages are sold on the outcome, not a round count', () => {
  // "Full Expedited Credit Repair" means the credit gets repaired, however
  // many rounds that takes -- 519 clients, running to whatever they need
  // rather than stopping at a number. Not a fixed allowance and not unknown.
  for (const pkg of ['Full Expedited Credit Repair', 'Full Credit Repair + 2 Credit Cards',
                     '3B Expedited FULL CREDIT REPAIR']) {
    assert.equal(rounds.roundsIncluded(pkg), rounds.OUTCOME, `${pkg} should be outcome-based`);
  }
  const r = rounds.forClient(c('Full Expedited Credit Repair', 4, 4, 4));
  assert.equal(r.roundsLeft, null, 'there is no remaining count to show');
});

test('an outcome package finishes when the work is done, not when a count runs out', () => {
  const mid = rounds.forClient(Object.assign(c('Full Expedited Credit Repair', 4, 4, 4), { stage: 'In rounds' }));
  assert.equal(mid.finished, false, 'still being worked');

  const done = rounds.forClient(Object.assign(c('Full Expedited Credit Repair', 4, 4, 4), { stage: 'Completed' }));
  assert.equal(done.finished, true);
  assert.equal(done.finishedBy, 'stage');
});

test('a completed client is finished whatever the round maths says', () => {
  // The pipeline is the authority on whether the work is done. A client marked
  // Completed one round into a three-round package is still finished.
  const r = rounds.forClient(Object.assign(c('3 Month Expedited', 1, 0, 0), { stage: 'Completed' }));
  assert.equal(r.finished, true);
  assert.equal(r.finishedBy, 'stage');
  assert.equal(r.roundsLeft, 2, 'the remaining count is still reported honestly');
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
  // "Strong Method, 3 Month Expedited" is at least 3 rounds, but the first half
  // is unreadable so the real allowance may be higher. Claiming finished here
  // is a refund conversation, not an upsell. (A sweep in that position is
  // different -- that is a known zero, covered separately.)
  const inc = rounds.roundsIncluded('Strong Method, 3 Month Expedited');
  assert.deepEqual(inc, { atLeast: 3 });
  const r = rounds.forClient(c('Strong Method, 3 Month Expedited', 3, 3, 3));
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
  const inRounds = (x) => Object.assign(x, { stage: 'In rounds' });
  const q = rounds.upsellQueue([
    inRounds(c('3 Month Expedited', 3, 3, 3)),               // out of rounds
    inRounds(c('3 Month Expedited', 1, 1, 1)),               // mid-package
    inRounds(c('Unlimited Credit Repair Package', 9, 9, 9)), // unlimited, still working
    inRounds(c('Full Expedited Credit Repair', 5, 5, 5)),    // outcome, not done yet
    Object.assign(c('Full Expedited Credit Repair', 3, 3, 3), { stage: 'Completed' })
  ]);
  assert.equal(q.totals.finished, 2, 'one out of rounds, one completed');
  assert.equal(q.totals.byRounds, 1);
  assert.equal(q.totals.byStage, 1);
  assert.equal(q.totals.unlimited, 1);
  assert.equal(q.totals.outcomeBased, 2);
});

test('against the real roster, most clients get a readable allowance', () => {
  const fs = require('fs');
  const path = require('path');
  const raw = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'seed', 'production-seed.json'), 'utf8'));
  const cs = Array.isArray(raw) ? raw : (raw.clients || []);
  const out = rounds.attach(cs);
  const readable = out.filter(x => x.roundsIncluded !== null).length;
  assert.ok(readable > cs.length * 0.85,
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

test('a named unlimited package is recognised without the word "unlimited"', () => {
  // "Diamond" is 46 clients. It was falling through to unknown because the
  // segment parser skips named-unlimited entries, assuming the /unlimited/
  // regex already caught them -- which it cannot for a package that never says
  // the word.
  assert.equal(rounds.roundsIncluded('Diamond'), rounds.UNLIMITED);
  assert.equal(rounds.roundsIncluded('Diamond Package'), rounds.UNLIMITED);
  const r = rounds.forClient(Object.assign(c('Diamond', 5, 5, 5), { stage: 'In rounds' }));
  assert.equal(r.finished, false, 'unlimited finishes on the stage, not a count');
});

test('a sweep or removal is targeted work, not a round allowance', () => {
  // 72 clients hold one of these and 68 hold nothing else, so calling their
  // allowance "unknown" was wrong twice over: it is not unknown, there simply
  // isn't one. The job is the job, and it finishes when the pipeline says so.
  for (const pkg of ['Transunion Sweep', 'Experian Expedited Removal', 'Inquiry Removal',
                     'EX SWEEP', '3 Bureau Expedited Removal']) {
    assert.equal(rounds.roundsIncluded(pkg), rounds.ADDON, `${pkg} should be add-on work`);
  }
  const mid = rounds.forClient(Object.assign(c('Transunion Sweep', 2, 0, 0), { stage: 'In rounds' }));
  assert.equal(mid.finished, false);
  assert.equal(mid.roundsLeft, null, 'there is no remainder to show');
  const done = rounds.forClient(Object.assign(c('Transunion Sweep', 2, 0, 0), { stage: 'Completed' }));
  assert.equal(done.finished, true);
});

test('an add-on bought alongside a package still leaves the package exact', () => {
  // An add-on segment contributes a known zero, not an unreadable one. Without
  // that, "Experian Removal, 3 Month Expedited" reads as "at least 3" and can
  // never qualify as finished.
  assert.equal(rounds.roundsIncluded('Experian&Equifax Expedited Removal, 3 Month Expedited'), 3);
  const r = rounds.forClient(Object.assign(
    c('Experian&Equifax Expedited Removal, 3 Month Expedited', 3, 3, 3), { stage: 'In rounds' }));
  assert.equal(r.allowanceExact, true);
  assert.equal(r.finished, true);
});

test('several add-ons together are still add-on work, not zero rounds bought', () => {
  assert.equal(rounds.roundsIncluded('Experian Sweep, Transunion Sweep'), rounds.ADDON);
});

test('a refunded sale is not a client to upsell', () => {
  assert.equal(rounds.roundsIncluded('REFUNDED'), rounds.REFUND);
  const r = rounds.forClient(Object.assign(c('REFUNDED', 3, 3, 3), { stage: 'Completed' }));
  assert.equal(r.finished, false, 'a refund must never reach the upsell list');
  const q = rounds.upsellQueue([Object.assign(c('REFUNDED', 3, 3, 3), { stage: 'Completed' })]);
  assert.equal(q.totals.finished, 0);
  assert.equal(q.totals.refunded, 1);
});

test('(HLP) is the abbreviation for Help me fix it', () => {
  // 31 clients, the largest single unreadable package. The priced version of
  // the same name is $50, which is exactly one round at the $50-a-round rate
  // every readable package in the book charges.
  assert.equal(rounds.roundsIncluded('(HLP)'), 1);
  assert.equal(rounds.roundsIncluded('Help me fix it'), 1);
});

test('the unreadable tail is now small enough to be worth asking about', () => {
  const fs3 = require('fs');
  const path3 = require('path');
  const raw = JSON.parse(fs3.readFileSync(
    path3.join(__dirname, '..', 'seed', 'production-seed.json'), 'utf8'));
  const cs = Array.isArray(raw) ? raw : (raw.clients || []);
  const unknown = rounds.attach(cs).filter(x => x.roundsIncluded === null);
  assert.ok(unknown.length < cs.length * 0.03,
    `${unknown.length} of ${cs.length} still unreadable -- that is a category being missed, not a tail`);
});
