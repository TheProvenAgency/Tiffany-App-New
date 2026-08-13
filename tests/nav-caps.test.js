// The VA's job is Deal Production, and they could not open it. The nav filter
// was a flat allowlist that deliberately excluded pvNavBtn ("Production nav
// item itself stays Admin-only"), so a VA got only the locked New Clients
// subset -- while the server happily served them /api/production and
// /production.js. The UI was the thing withholding it.
//
// A flat list also can't reflect a per-user capability override, which is the
// whole point of the model, so the nav now maps each item to the capability
// that actually reaches its data.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const auth = require('../lib/auth.js');

const role = fs.readFileSync(path.join(__dirname, '..', 'public', 'role.js'), 'utf8');
const NAV_CAPS = eval('(' + role.split('var NAV_CAPS = ')[1].split('};')[0] + '})');
const GROUP_OF = eval('(' + role.split('var GROUP_OF = ')[1].split('};')[0] + '})');

// Three kinds of entry: a capability name, null for "anyone signed in", and
// false for account chores, which moved to the avatar menu and stay in the
// sidebar only for an admin.
const navFor = (roleName) => {
  const caps = auth.ROLE_CAPS[roleName];
  return Object.keys(NAV_CAPS).filter(id => {
    const need = NAV_CAPS[id];
    if (need === false) return caps.includes('admin');
    return need === null || caps.includes(need);
  });
};

test('a VA gets the full Deal Production tracker, not just New Clients', () => {
  const nav = navFor('va');
  assert.ok(nav.includes('pvNavBtn'), 'Deal Production is the VA job; it must be reachable');
  assert.ok(nav.includes('msgNavBtn'), 'and Messages, per the same requirement');
});

test('a VA still sees no money anywhere in the nav', () => {
  const nav = navFor('va');
  for (const id of ['rvNavBtn', 'mfNavBtn', 'lmNavBtn']) {
    assert.ok(!nav.includes(id), `${id} is a money surface and must stay hidden`);
  }
});

test('a disputer gets their queue and nothing else but the account items', () => {
  const nav = navFor('disputer');
  assert.ok(nav.includes('disputesNavBtn'));
  assert.ok(!nav.includes('pvNavBtn'), 'no Deal Production');
  assert.ok(!nav.includes('msgNavBtn'), 'no inbox');
  assert.ok(!nav.includes('rvNavBtn'), 'no money');
  assert.deepEqual(nav.filter(id => NAV_CAPS[id] !== null && NAV_CAPS[id] !== false),
    ['disputesNavBtn']);
});

test('an admin reaches everything', () => {
  const nav = navFor('admin');
  assert.deepEqual(nav.sort(), Object.keys(NAV_CAPS).sort());
});

test('every nav item names a capability the server actually knows', () => {
  // A typo here would silently hide a button forever.
  for (const [id, cap] of Object.entries(NAV_CAPS)) {
    if (cap === null || cap === false) continue;
    assert.ok(auth.CAPABILITIES.includes(cap), `${id} maps to unknown capability "${cap}"`);
  }
});

test('every nav item is placed in a group, so its heading can follow it', () => {
  for (const id of Object.keys(NAV_CAPS)) {
    assert.ok(GROUP_OF[id], `${id} has no group; its heading would never show`);
  }
});

test('unknown buttons are hidden rather than shown by default', () => {
  assert.ok(/if \(!\(id in NAV_CAPS\)\) return false/.test(role),
    'a new button should have to opt in, not leak out');
});

test('group headings follow the buttons that survived, not a fixed list', () => {
  assert.ok(!/ALLOWED_GROUPS/.test(role), 'the fixed group list should be gone');
  assert.ok(/visibleGroups\[heading\.dataset\.g\]/.test(role));
});

test('bulk re-sync stays an owner action even though a VA has the page', () => {
  const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  assert.ok(/_c\.indexOf\('admin'\)>=0/.test(prod),
    'rewriting the whole tracker from an external source is not desk work');
});
