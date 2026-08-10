// A VA and a disputer could be created and the server gated them correctly,
// but neither could actually use the app:
//
//   - team.js (the employee home) activated on m.role === 'employee', so a VA
//     -- who holds exactly the capabilities that view is built from -- signed
//     in and got no home view at all.
//   - gateNav() bailed unless #teamNavBtn existed. A disputer never gets that
//     button, so the nav filter never ran for them: full unfiltered nav, and
//     a landing on a Dashboard the server refuses.
//
// Both were role-name equality standing in for a capability check.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const auth = require('../lib/auth.js');

// Comments in these files quote the old code they replaced, so strip them
// before asserting the old pattern is gone.
const strip = src => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
const read = f => strip(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'));
const team = read('team.js');
const role = read('role.js');
const prod = read('production.js');

test('the employee home is gated on capability, not on a role name', () => {
  assert.ok(!/m\.role!=='employee'/.test(team),
    'team.js should not test the role name; a VA holds the same capabilities');
  assert.ok(/caps\.indexOf\('production'\)/.test(team),
    'it should activate for anyone who can reach Deal Production');
  assert.ok(/caps\.indexOf\('admin'\)>=0\)return/.test(team),
    'a real admin should still be a no-op here');
});

test("Deal Production's employee affordances follow the capability too", () => {
  assert.ok(!/m\.role==='employee'/.test(prod),
    'production.js should not gate its worker affordances on a role name');
});

test('landing is chosen from capabilities', () => {
  assert.ok(/var HOME = /.test(role), 'there should be a computed home');
  assert.ok(/can\('production'\).*HOME = \{ view: 'team'/s.test(role));
  assert.ok(/can\('disputes'\).*HOME = \{ view: 'disputes'/s.test(role));
});

test('the nav filter waits for the home that actually applies', () => {
  assert.ok(!/getElementById\('teamNavBtn'\)\) return false/.test(role),
    'waiting unconditionally for teamNavBtn means gateNav never runs for a disputer');
  assert.ok(/HOME\.waitFor/.test(role));
});

test("a disputer's only nav button survives the filter", () => {
  // The flat ALLOWED_IDS list is gone -- nav items now map to the capability
  // that reaches their data (see tests/nav-caps.test.js). The guarantee is
  // unchanged: hiding this would remove the one button their job runs through.
  const map = role.split('var NAV_CAPS = ')[1].split('};')[0];
  assert.ok(/disputesNavBtn: 'disputes'/.test(map),
    'the round queue must be reachable by anyone holding the disputes capability');
});

test('every role still has somewhere to land', () => {
  // The real guarantee: no preset should end up with a home it cannot open.
  for (const [name, caps] of Object.entries(auth.ROLE_CAPS)) {
    const set = new Set(caps);
    const lands = set.has('admin') || set.has('production') || set.has('disputes');
    assert.ok(lands, `the ${name} preset has no view it is allowed to open`);
  }
});
