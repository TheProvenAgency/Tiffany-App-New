// lib/sheet.js's JSON-shape reader for the n8n Google-Sheet sync webhook.
// Tested against real field values pulled verbatim from an actual n8n
// payload (trailing \r, malformed dates, "Rnd N login"/"Resolved"/"-"
// status text) -- no invented field names or shapes.
const { test } = require('node:test');
const assert = require('node:assert');
const sheet = require('../lib/sheet');
const { shamond, barbrielle, kaleel } = require('./fixtures/sheet-rows');

test('normalizeSheetJsonRow: basic fields map correctly', () => {
  const row = sheet.normalizeSheetJsonRow(shamond);
  assert.equal(row.name, 'Shamond Anderson');
  assert.equal(row.pkg, '6-Month Credit Repair Package');
  assert.equal(row.sourceRowId, 50);
  assert.equal(row.notes, null, 'blank Notes maps to null, not an empty string');
});

test('normalizeSheetJsonRow: trailing \\r is stripped from every string field', () => {
  const row = sheet.normalizeSheetJsonRow(shamond);
  const r3 = row.cfpb.find(c => c.round === 3);
  assert.equal(r3.email, 'shamond.anderson2025@outlook.com');
  assert.equal(r3.pw, 'Credit24Credit24!');
  assert.ok(!r3.email.includes('\r') && !r3.pw.includes('\r'));
});

test('normalizeSheetJsonRow: a date with free text instead of a year is preserved raw, not dropped', () => {
  const row = sheet.normalizeSheetJsonRow(shamond);
  const r5 = row.cfpb.find(c => c.round === 5);
  assert.equal(r5.date, '12/22 antonette', 'the whole malformed string survives untouched');
});

test('normalizeSheetJsonRow: a date with trailing garbage after \\r-trim is preserved raw too', () => {
  const row = sheet.normalizeSheetJsonRow(shamond);
  const r6 = row.cfpb.find(c => c.round === 6);
  assert.equal(r6.date, '01/30/2026 Mber', '\\r stripped, but the trailing word is not guessed away');
});

test('normalizeSheetJsonRow: blank rounds (7-10) are omitted entirely, not inserted empty', () => {
  const row = sheet.normalizeSheetJsonRow(shamond);
  assert.equal(row.cfpb.length, 6, 'only rounds 1-6 have any data');
  assert.ok(!row.cfpb.some(c => c.round > 6));
});

test('countFiledRoundsJson counts non-blank RND_N_DATE fields', () => {
  assert.equal(sheet.countFiledRoundsJson(shamond), 6);
  assert.equal(sheet.countFiledRoundsJson(barbrielle), 2);
});

test('TU/EQ/EX status text is parsed, not dropped: "Rnd 3 login"', () => {
  const row = sheet.normalizeSheetJsonRow(barbrielle);
  assert.deepEqual(row.tu, { r: 3, st: 'login', raw: 'Rnd 3 login' });
  assert.deepEqual(row.eq, { r: 3, st: 'login', raw: 'Rnd 3 login' });
});

test('TU/EQ/EX status text is parsed, not dropped: "-" is none', () => {
  const row = sheet.normalizeSheetJsonRow(barbrielle);
  assert.deepEqual(row.ex, { r: 0, st: 'none', raw: '-' });
});

test('TU/EQ/EX status text is parsed, not dropped: "Round 6 Done"', () => {
  const row = sheet.normalizeSheetJsonRow(shamond);
  assert.deepEqual(row.tu, { r: 6, st: 'done', raw: 'Round 6 Done' });
});

test('TU/EQ/EX status text is parsed, not dropped: "Resolved" falls back to the filed-round count', () => {
  const row = sheet.normalizeSheetJsonRow(kaleel);
  assert.equal(row.tu.st, 'done');
  assert.equal(row.tu.r, 3, 'no digit in "Resolved" itself, so it falls back to countFiledRoundsJson (3 filed rounds)');
  assert.deepEqual(row.eq, { r: 0, st: 'none', raw: '-' });
});

test('a malformed date with slash/period mixed separators is still preserved raw (no crash, no silent drop)', () => {
  const row = sheet.normalizeSheetJsonRow(kaleel);
  const r2 = row.cfpb.find(c => c.round === 2);
  assert.equal(r2.date, '07/15.2025');
});

test('round 10 is read correctly when populated', () => {
  const withRound10 = { ...shamond, RND_10_DATE: '08/01/2026', ROUND_10_CFPB_EMAIL: 'r10@outlook.com', CFPB_PW_RND_10: 'Round10Pw!' };
  const row = sheet.normalizeSheetJsonRow(withRound10);
  const r10 = row.cfpb.find(c => c.round === 10);
  assert.ok(r10, 'round 10 must not be dropped -- the schema has no upper bound below it');
  assert.equal(r10.date, '08/01/2026');
  assert.equal(r10.email, 'r10@outlook.com');
  assert.equal(r10.pw, 'Round10Pw!');
});

test('normalizeSheetJsonRows skips rows with a blank NAME and keeps the rest', () => {
  const rows = sheet.normalizeSheetJsonRows([shamond, { ...barbrielle, NAME: '' }, kaleel]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.name), ['Shamond Anderson', 'Kaleel Hines']);
});
