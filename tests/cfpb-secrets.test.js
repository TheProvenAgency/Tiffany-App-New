// CFPB portal logins and passwords.
//
// Found by auditing what /api/production actually puts on the wire: 8,285 real
// passwords across 3,259 clients, on every Deal Production page load. They are
// encrypted at rest, which buys nothing if they are decrypted and broadcast to
// the browser.
//
// Worse, a VA received all of them. A VA has no `disputes` capability and
// cannot open the dispute desk at all -- filing CFPB complaints is the
// disputer's job -- so there was no version of their work that needed a single
// one of those passwords.
const { test } = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth.js');

const rec = () => ({
  id: 'c1', name: 'A',
  cfpb: [{ round: 1, date: '2026-01-01', email: 'portal@example.com', pw: 'hunter2' },
         { round: 2, date: '2026-02-01', email: 'portal@example.com', pw: 'hunter3' }]
});

test('a disputer keeps the credentials, because filing is their job', () => {
  const out = auth.stripCfpbSecrets('disputer', rec());
  assert.equal(out.cfpb[0].pw, 'hunter2');
  assert.equal(out.cfpb[0].email, 'portal@example.com');
});

test('a VA gets the progress and none of the credentials', () => {
  const out = auth.stripCfpbSecrets('va', rec());
  assert.equal(out.cfpb.length, 2, 'the rounds themselves are ordinary progress info');
  assert.equal(out.cfpb[0].round, 1);
  assert.equal(out.cfpb[0].date, '2026-01-01');
  assert.equal(out.cfpb[0].pw, undefined);
  assert.equal(out.cfpb[0].email, undefined);
  assert.ok(!JSON.stringify(out).includes('hunter2'));
});

test('an employee is treated the same as a VA', () => {
  const out = auth.stripCfpbSecrets('employee', rec());
  assert.ok(!JSON.stringify(out).includes('hunter'));
});

test('the list drops them for everyone, admin included', () => {
  // Least privilege belongs to the surface as much as the role. A table of
  // 3,885 clients has no use for a password whoever is looking at it.
  const out = auth.stripCfpbSecretsAll([rec(), rec()]);
  assert.ok(!JSON.stringify(out).includes('hunter'));
  assert.equal(out[0].cfpb[0].round, 1, 'progress survives');
});

test('a record with no cfpb is passed through untouched', () => {
  const plain = { id: 'x', name: 'B' };
  assert.strictEqual(auth.stripCfpbSecrets('va', plain), plain);
  assert.strictEqual(auth.stripCfpbSecretsAll([plain])[0], plain);
});

test('stripping never mutates the stored record', () => {
  // These objects come straight off the in-memory store. Editing them in place
  // would delete the passwords from the app's own data.
  const original = rec();
  auth.stripCfpbSecrets('va', original);
  auth.stripCfpbSecretsAll([original]);
  assert.equal(original.cfpb[0].pw, 'hunter2', 'the source must be unchanged');
});

test('both read paths are covered', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const list = src.split("app.get('/api/production'")[1].split('\n});')[0];
  assert.ok(/stripCfpbSecretsAll/.test(list), 'the list must strip');
  const one = src.split("app.get('/api/production/:id'")[1].split('\n});')[0];
  assert.ok(/stripCfpbSecrets\(req\.actor/.test(one), 'the single record must gate on capability');
});

test('revealing a password fetches the gated record instead of reading the list', () => {
  // The list no longer carries them for anyone, so the reveal button has to go
  // and get the single record -- which is capability-gated -- rather than
  // showing whatever happened to be in the page payload.
  const fs = require('fs');
  const path = require('path');
  const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  assert.ok(/function revealCfpb\(c\)/.test(prod));
  assert.ok(/fetch\('\/api\/production\/'/.test(prod), 'it should re-read the record');
  assert.ok(/caps\.indexOf\('disputes'\)<0/.test(prod),
    'and not bother asking for a role that would be refused');
  // The old toggle flipped a flag over data already in the page.
  const code = prod.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/cfpbToggle\.onclick=function\(\)\{cfpbRevealed=!cfpbRevealed/.test(code),
    'the old in-page toggle must be gone, or it overrides the gated one');
});
