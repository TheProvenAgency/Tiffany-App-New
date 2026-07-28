// The Credit Repair Google Sheet is the source of truth Tiffany asked for --
// wherever it disagrees with Deal Production, the sheet wins. Tested here in
// isolation (CSV parsing, cell parsing, matching/diffing) without hitting
// the live server.
const { test } = require('node:test');
const assert = require('node:assert');
const sheet = require('../lib/sheet');

test('parseCsv handles a quoted field with an embedded comma', () => {
  const rows = sheet.parseCsv('a,b,c\n1,"2, and more",3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2, and more', '3']]);
});

test('parseCsv handles a doubled-quote escape inside a quoted field', () => {
  const rows = sheet.parseCsv('a\n"she said ""hi"""\n');
  assert.deepEqual(rows, [['a'], ['she said "hi"']]);
});

test('parseCsv handles CRLF line endings and a trailing row with no newline', () => {
  const rows = sheet.parseCsv('a,b\r\n1,2\r\n3,4');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseBureauCell: blank or "-" is none', () => {
  assert.deepEqual(sheet.parseBureauCell('', 0), { r: 0, st: 'none', raw: '' });
  assert.deepEqual(sheet.parseBureauCell('-', 0), { r: 0, st: 'none', raw: '-' });
});

test('parseBureauCell: "Resolved" is done with no explicit round, falls back to filed-round count', () => {
  const r = sheet.parseBureauCell('Resolved', 3);
  assert.equal(r.st, 'done');
  assert.equal(r.r, 3);
});

test('parseBureauCell: an explicit round number in the text wins over the filed-round count', () => {
  assert.deepEqual(sheet.parseBureauCell('Round 7 Log In', 2), { r: 7, st: 'login', raw: 'Round 7 Log In' });
  assert.deepEqual(sheet.parseBureauCell('Rnd 3 Rdy', 1), { r: 3, st: 'ready', raw: 'Rnd 3 Rdy' });
  assert.deepEqual(sheet.parseBureauCell('Round 6 Done', 0), { r: 6, st: 'done', raw: 'Round 6 Done' });
});

test('parseBureauCell: "ready" or "login" with no round number falls back to at least round 1', () => {
  assert.equal(sheet.parseBureauCell('ready', 0).r, 1);
  assert.equal(sheet.parseBureauCell('no log-in', 0).st, 'login');
});

test('parseBureauCell: an unrecognized status (cancelled, refunded, stray text) is flagged, not guessed', () => {
  const r = sheet.parseBureauCell('CANCELLED', 2);
  assert.equal(r.st, 'none');
  assert.equal(r.unrecognized, true);
  assert.equal(r.raw, 'CANCELLED');
});

// Builds a row array with the real sheet's column layout: 0-8 are the fixed
// columns (blank, blank, blank, NAME, PACKAGE, TU, EQ, EX, Notes), then
// round triples (date, email, pw) starting at column 9.
function rowWithCfpb(fixed, rounds) {
  const row = ['', '', '', ...fixed];
  for (const r of rounds) { row.push(r.date || '', r.email || '', r.pw || ''); }
  return row;
}

test('parseCfpbRounds reads only the rounds that have data, in order', () => {
  const row = rowWithCfpb(['Jane Doe', 'Pkg', 'x', 'x', 'x', ''], [
    { date: '7/1/26', email: 'r1@cfpb.com', pw: 'pw1' },
    {}, // round 2 fully blank -- skipped
    { date: '7/15/26', email: 'r3@cfpb.com', pw: 'pw3' }
  ]);
  const rounds = sheet.parseCfpbRounds(row);
  assert.deepEqual(rounds, [
    { round: 1, date: '7/1/26', email: 'r1@cfpb.com', pw: 'pw1' },
    { round: 3, date: '7/15/26', email: 'r3@cfpb.com', pw: 'pw3' }
  ]);
});

test('parseCfpbRounds returns nothing for a row with no CFPB columns filled in', () => {
  const row = ['', '', '', 'Jane Doe', 'Pkg', 'x', 'x', 'x', ''];
  assert.deepEqual(sheet.parseCfpbRounds(row), []);
});

test('reconcileSheet: CFPB logins are sheet-wins, same as package/round status', () => {
  const row = rowWithCfpb(['Jane Doe', 'Pkg', 'Round 2 Done', 'Round 2 Done', 'Round 2 Done', ''], [
    { date: '7/1/26', email: 'r1@cfpb.com', pw: 'pw1' }
  ]);
  const sheetRows = sheet.normalizeSheetRows([['h'], row]);
  const ghlClients = [{ id: 'g1', name: 'Jane Doe', email: 'jane@x.com' }];
  const prod = [{ id: 'P1', ghlId: 'g1', name: 'Jane Doe', pkg: 'Pkg', stage: 'In rounds', tu: { r: 2, st: 'done' }, eq: { r: 2, st: 'done' }, ex: { r: 2, st: 'done' }, cfpb: [] }];
  const { updates } = sheet.reconcileSheet(sheetRows, ghlClients, prod);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].patch.cfpb, [{ round: 1, date: '7/1/26', email: 'r1@cfpb.com', pw: 'pw1' }]);
});

test('reconcileSheet: an unchanged CFPB login produces no patch entry for it', () => {
  const row = rowWithCfpb(['Jane Doe', 'New Pkg', 'x', 'x', 'x', ''], [
    { date: '7/1/26', email: 'r1@cfpb.com', pw: 'pw1' }
  ]);
  const sheetRows = sheet.normalizeSheetRows([['h'], row]);
  const ghlClients = [{ id: 'g1', name: 'Jane Doe', email: 'jane@x.com' }];
  const prod = [{ id: 'P1', ghlId: 'g1', name: 'Jane Doe', pkg: 'Old Pkg', stage: 'Onboarding', tu: { r: 0, st: 'none' }, eq: { r: 0, st: 'none' }, ex: { r: 0, st: 'none' }, cfpb: [{ round: 1, date: '7/1/26', email: 'r1@cfpb.com', pw: 'pw1' }] }];
  const { updates } = sheet.reconcileSheet(sheetRows, ghlClients, prod);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].patch.pkg, 'New Pkg');
  assert.equal(updates[0].patch.cfpb, undefined, 'identical CFPB data should not be re-patched');
});

test('deriveStage: any login beats ready and done', () => {
  assert.equal(sheet.deriveStage({ st: 'login' }, { st: 'done' }, { st: 'ready' }), 'In rounds');
});

test('deriveStage: all done is Completed', () => {
  assert.equal(sheet.deriveStage({ st: 'done' }, { st: 'done' }, { st: 'done' }), 'Completed');
});

test('deriveStage: all none is Onboarding', () => {
  assert.equal(sheet.deriveStage({ st: 'none' }, { st: 'none' }, { st: 'none' }), 'Onboarding');
});

test('reconcileSheet: an existing record matched by ghlId gets a diff patch for changed fields only', () => {
  const sheetRows = sheet.normalizeSheetRows([
    ['h'],
    ['', 'Yes', '', 'Jane Doe', 'New Package', 'Round 2 Done', 'Round 2 Done', 'Round 2 Ready', 'sheet note']
  ]);
  const ghlClients = [{ id: 'g1', name: 'Jane Doe', email: 'jane@x.com' }];
  const prod = [{ id: 'P1', ghlId: 'g1', name: 'Jane Doe', pkg: 'Old Package', stage: 'Onboarding', tu: { r: 1, st: 'done' }, eq: { r: 2, st: 'done' }, ex: { r: 0, st: 'none' } }];
  const { updates } = sheet.reconcileSheet(sheetRows, ghlClients, prod);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'P1');
  assert.equal(updates[0].patch.pkg, 'New Package');
  assert.deepEqual(updates[0].patch.tu, { r: 2, st: 'done' });
  assert.equal(updates[0].patch.eq, undefined, 'eq already matched the sheet, so it is not in the patch');
  assert.deepEqual(updates[0].patch.ex, { r: 2, st: 'ready' });
});

test('reconcileSheet: a legacy "First L." record matches by first-name + last-initial and gets backfilled with ghlId, full name, email, and phone', () => {
  const sheetRows = sheet.normalizeSheetRows([
    ['h'],
    ['', 'Yes', '', 'Brittany Carpenter', 'Pkg', 'Resolved', 'Resolved', 'Resolved', '']
  ]);
  const ghlClients = [{ id: 'g9', name: 'Brittany Carpenter', email: 'b@x.com', phone: '+15551234567' }];
  const prod = [{ id: 'C1000', name: 'Brittany C.', pkg: 'Pkg', stage: 'Completed', tu: { r: 6, st: 'done' }, eq: { r: 6, st: 'done' }, ex: { r: 6, st: 'done' } }];
  const { updates } = sheet.reconcileSheet(sheetRows, ghlClients, prod);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, 'C1000');
  assert.equal(updates[0].patch.ghlId, 'g9');
  assert.equal(updates[0].patch.name, 'Brittany Carpenter', 'the redacted "First L." name is upgraded to the real full name once GHL confirms identity');
  assert.equal(updates[0].patch.email, 'b@x.com');
  assert.equal(updates[0].patch.phone, '+15551234567');
});

test('reconcileSheet: a sheet row matched to GHL with no existing record is queued to create', () => {
  const sheetRows = sheet.normalizeSheetRows([
    ['h'],
    ['', 'Yes', '', 'New Client', 'Pkg', 'ready', '-', '-', '']
  ]);
  const ghlClients = [{ id: 'g5', name: 'New Client', email: 'nc@x.com', phone: '+1555' }];
  const { toCreate, updates } = sheet.reconcileSheet(sheetRows, ghlClients, []);
  assert.equal(updates.length, 0);
  assert.equal(toCreate.length, 1);
  assert.equal(toCreate[0].ghlId, 'g5');
  assert.equal(toCreate[0].email, 'nc@x.com');
});

test('reconcileSheet: a sheet row matching neither GHL nor an existing record is unmatched, never created blind', () => {
  const sheetRows = sheet.normalizeSheetRows([
    ['h'],
    ['', 'Yes', '', 'Nobody Anywhere', 'Pkg', '-', '-', '-', '']
  ]);
  const { toCreate, unmatched } = sheet.reconcileSheet(sheetRows, [], []);
  assert.equal(toCreate.length, 0);
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].name, 'Nobody Anywhere');
});

test('reconcileSheet: two sheet rows with the same name are both skipped as ambiguous', () => {
  const sheetRows = sheet.normalizeSheetRows([
    ['h'],
    ['', 'Yes', '', 'John Smith', 'Pkg A', '-', '-', '-', ''],
    ['', 'Yes', '', 'John Smith', 'Pkg B', '-', '-', '-', '']
  ]);
  const { duplicateNames, updates, toCreate, unmatched } = sheet.reconcileSheet(sheetRows, [{ id: 'g1', name: 'John Smith' }], []);
  assert.equal(duplicateNames.length, 2);
  assert.equal(updates.length, 0);
  assert.equal(toCreate.length, 0);
  assert.equal(unmatched.length, 0);
});
