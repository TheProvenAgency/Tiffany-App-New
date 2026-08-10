// The VA and disputer portals existed in the backend for a while and could
// not be used at all, because the only roles the Team form offered were
// Employee and Admin. There was no way to create a VA or a disputer, so from
// the outside the portals simply were not there.
//
// These tests cover the two ways that can happen again: the form losing a
// role, and the form's idea of what a role can reach drifting from what the
// server actually enforces.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const auth = require('../lib/auth.js');

const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const form = page.split('id="u_role"')[1].split('</select>')[0];

test('every role the server accepts can be created from the form', () => {
  for (const role of Object.keys(auth.ROLE_CAPS)) {
    assert.ok(form.includes('value="' + role + '"'),
      `the Team form offers no way to create a ${role}`);
  }
});

test('the form presets match what the server enforces, exactly', () => {
  // A preset that overstates access is a security surprise; one that
  // understates it is a support ticket. Neither is acceptable, so they must
  // be identical rather than merely close.
  const block = page.split('const ROLE_PRESETS=')[1].split('};')[0] + '}';
  const presets = eval('(' + block + ')');
  for (const [role, caps] of Object.entries(auth.ROLE_CAPS)) {
    assert.deepEqual(presets[role].slice().sort(), caps.slice().sort(),
      `the form's ${role} preset disagrees with lib/auth.js`);
  }
});

test('every capability the server knows about is offered in the picker', () => {
  const labels = page.split('const CAP_LABELS=')[1].split('};')[0] + '}';
  const map = eval('(' + labels + ')');
  for (const cap of auth.CAPABILITIES) {
    assert.ok(map[cap], `no label for the ${cap} capability, so it can never be granted`);
  }
});

test('a disputer preset carries no money and no admin', () => {
  const caps = auth.ROLE_CAPS.disputer;
  assert.ok(!caps.includes('revenue'), 'a disputer must never see revenue');
  assert.ok(!caps.includes('admin'));
  assert.ok(!caps.includes('production'), 'the round queue is the whole job');
});

test('a VA gets the client desk and no money', () => {
  const caps = auth.ROLE_CAPS.va;
  assert.ok(caps.includes('production') && caps.includes('messages'),
    'a VA needs Deal Production and the inbox');
  assert.ok(!caps.includes('revenue'), 'explicit requirement: VAs do not see money');
  assert.ok(!caps.includes('admin'));
});

test('only an explicit override is sent, so untouched accounts follow their role', () => {
  const add = page.split('async function addUser()')[1].split('\n}')[0];
  assert.ok(/caps\.slice\(\)\.sort\(\)\.join\(','\)\s*!==\s*preset\.join\(','\)/.test(add),
    'capabilities should only be sent when they differ from the preset');
});
