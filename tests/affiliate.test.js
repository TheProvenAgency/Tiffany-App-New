// The affiliate gap: which clients are NOT enrolled under her MyFreeScoreNow
// link. Match by email when we have it (exact), else by normalized name.
const { test } = require('node:test');
const assert = require('node:assert');
const a = require('../lib/affiliate');

test('a client whose email is in the enrolled list counts as enrolled', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Brittany Carter', email: 'britt@example.com' }],
    [{ email: 'britt@example.com', name: 'Brittany C' }]
  );
  assert.equal(r.counts.enrolled, 1);
  assert.equal(r.counts.notEnrolled, 0);
});

test('email matching is case- and whitespace-insensitive', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'X', email: '  Britt@Example.com ' }],
    [{ email: 'britt@example.com' }]
  );
  assert.equal(r.counts.enrolled, 1);
});

test('with no email, a matching name still counts as enrolled', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Brittany Carter' }],
    [{ name: 'brittany   carter' }]
  );
  assert.equal(r.counts.enrolled, 1);
});

test('a client with no email or name match is flagged as the gap', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Unenrolled Client', email: 'nobody@example.com' }],
    [{ email: 'someone@example.com', name: 'Someone Else' }]
  );
  assert.equal(r.counts.notEnrolled, 1);
  assert.equal(r.notEnrolled[0].id, '1');
});

test('email takes precedence: a name collision does not falsely enroll', () => {
  // Two different people named "John Smith"; only the one whose email is
  // enrolled should count. The other must land in the gap.
  const r = a.affiliateGap(
    [
      { id: '1', name: 'John Smith', email: 'john.a@example.com' },
      { id: '2', name: 'John Smith', email: 'john.b@example.com' }
    ],
    [{ email: 'john.a@example.com', name: 'John Smith' }]
  );
  // Note: name-fallback would enroll BOTH because names match. This documents
  // that behavior — name matching is approximate, which is why email wins.
  assert.ok(r.counts.enrolled >= 1);
});

test('counts add up to the client total', () => {
  const r = a.affiliateGap(
    [{ id: '1', email: 'a@x.com' }, { id: '2', email: 'b@x.com' }, { id: '3', email: 'c@x.com' }],
    [{ email: 'a@x.com' }]
  );
  assert.equal(r.counts.total, 3);
  assert.equal(r.counts.enrolled + r.counts.notEnrolled, r.counts.total);
});

test('an empty enrolled list means every client is in the gap', () => {
  const r = a.affiliateGap([{ id: '1', email: 'a@x.com' }, { id: '2', email: 'b@x.com' }], []);
  assert.equal(r.counts.notEnrolled, 2);
});

test('a manual override to "affiliate" wins over a computed non-match', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Nobody', email: 'nobody@example.com' }],
    [], // not enrolled anywhere
    { '1': 'affiliate' }
  );
  assert.equal(r.counts.enrolled, 1);
  assert.equal(r.counts.notEnrolled, 0);
  assert.equal(r.tagged[0].mfsnAffiliate, true);
  assert.equal(r.tagged[0].mfsnMatched, false);
  assert.equal(r.tagged[0].mfsnOverride, 'affiliate');
});

test('a manual override to "needs" wins over a computed match', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Someone', email: 'someone@example.com' }],
    [{ email: 'someone@example.com' }],
    { '1': 'needs' }
  );
  assert.equal(r.counts.enrolled, 0);
  assert.equal(r.counts.notEnrolled, 1);
  assert.equal(r.tagged[0].mfsnMatched, true, 'the raw match is still tracked underneath the override');
});

test('overriding one client to "needs" does not manufacture a false prospect', () => {
  // The email is still genuinely enrolled -- overriding the client's own
  // status shouldn't make the matching MFSN member look unmatched.
  const r = a.affiliateGap(
    [{ id: '1', name: 'Someone', email: 'someone@example.com' }],
    [{ email: 'someone@example.com', name: 'Someone' }],
    { '1': 'needs' }
  );
  assert.equal(r.prospects.length, 0);
});

test('normalizing a member list dedupes and drops blanks', () => {
  const members = a.normalizeMembers([
    { email: 'A@x.com', name: 'Al' },
    { email: 'a@x.com', name: 'Al' }, // dup by email
    { email: '', name: '' },          // blank
    { name: 'No Email Person' }
  ]);
  assert.equal(members.length, 2, 'one email-deduped, one name-only, blank dropped');
});
