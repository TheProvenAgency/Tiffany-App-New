// Assigning a disputer per client, from the team walkthrough. The record
// already had an assignee field and the queue already showed it -- what was
// missing was any way to set it, and a rule about who may.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const auth = require('../lib/auth.js');

const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'disputes.js'), 'utf8');

test('the desk can reassign a file; a disputer cannot', () => {
  // A disputer should work their own files, not hand them around. This is the
  // server rule -- the hidden control is only there to avoid offering
  // something that would be refused.
  const asDesk = auth.filterEditable('employee', { va: 'Marta' });
  assert.deepEqual(asDesk.denied, [], 'the desk should be able to assign');
  assert.equal(asDesk.allowed.va, 'Marta');

  const asDisputer = auth.filterEditable('disputer', { va: 'Marta' });
  assert.deepEqual(asDisputer.allowed, {}, 'a disputer must not reassign');
  assert.deepEqual(asDisputer.denied, ['va']);
});

test('a disputer keeps everything they actually need', () => {
  const { allowed, denied } = auth.filterEditable('disputer',
    { tu: { r: 1, st: 'done' }, eq: { r: 1, st: 'ready' }, note: 'filed', cfpb: [] });
  assert.deepEqual(denied, []);
  assert.equal(Object.keys(allowed).length, 4);
});

test('a VA can assign, since they run the desk', () => {
  const { denied } = auth.filterEditable('va', { va: 'Marta' });
  assert.deepEqual(denied, []);
});

test('the control is only rendered for someone allowed to use it', () => {
  assert.ok(/state\.canAssign=state\.caps\.indexOf\('assign'\)>=0/.test(page),
    'the picker should be gated on the same capability the server checks');
  const render = page.split('function renderRecord()')[1].split('\n}\n')[0];
  assert.ok(/if\(state\.canAssign\)/.test(render));
  assert.ok(/else if\(r\.assignedTo\)/.test(render),
    'a disputer should still see who a file belongs to, just not change it');
});

test('reassignment is only sent when it actually changed', () => {
  const save = page.split('function saveRecord()')[1].split('\n}')[0];
  assert.ok(/want!==cur\)patch\.va=want/.test(save),
    'sending it unchanged would stamp a fresh edit on every save');
});

test('an assignee not in the list is preserved rather than silently dropped', () => {
  // Someone may have been assigned before their account changed. Rebuilding
  // the options without them would blank the field on the next save.
  const render = page.split('function renderRecord()')[1].split('\n}\n')[0];
  assert.ok(/DISPUTERS\.indexOf\(r\.assignedTo\)<0/.test(render));
});

test('unassigning is possible, not just reassigning', () => {
  const render = page.split('function renderRecord()')[1].split('\n}\n')[0];
  assert.ok(/<option value="">Unassigned<\/option>/.test(render));
});
