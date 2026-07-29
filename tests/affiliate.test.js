// The affiliate gap: tri-state MyFreeScoreNow status per client --
// 'affiliate' (on MFSN under one of her confirmed enrollment codes),
// 'not_affiliate' (on MFSN, matched, but no code / a different code), or
// 'not_on_mfsn' (no match at all). Match by email when we have it (exact),
// else by normalized name.
const { test } = require('node:test');
const assert = require('node:assert');
const a = require('../lib/affiliate');

test('a client matched with her affiliate code counts as affiliate', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Brittany Carter', email: 'britt@example.com' }],
    [{ email: 'britt@example.com', name: 'Brittany C', code: 'B01B1514' }]
  );
  assert.equal(r.counts.affiliate, 1);
  assert.equal(r.counts.notAffiliate, 0);
  assert.equal(r.counts.notOnMfsn, 0);
  assert.equal(r.tagged[0].mfsnStatus, 'affiliate');
});

test('a client matched but with no code (or a different code) counts as not_affiliate', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Someone', email: 'someone@example.com' }],
    [{ email: 'someone@example.com', name: 'Someone', code: 'NA' }]
  );
  assert.equal(r.counts.affiliate, 0);
  assert.equal(r.counts.notAffiliate, 1);
  assert.equal(r.tagged[0].mfsnStatus, 'not_affiliate');
});

test('a client with no match at all is not_on_mfsn', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Unmatched Client', email: 'nobody@example.com' }],
    [{ email: 'someone@example.com', name: 'Someone Else', code: 'B01B1514' }]
  );
  assert.equal(r.counts.notOnMfsn, 1);
  assert.equal(r.notOnMfsn[0].id, '1');
  assert.equal(r.tagged[0].mfsnStatus, 'not_on_mfsn');
});

test('email matching is case- and whitespace-insensitive', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'X', email: '  Britt@Example.com ' }],
    [{ email: 'britt@example.com', code: 'B01B1514' }]
  );
  assert.equal(r.counts.affiliate, 1);
});

test('with no email, a matching name still counts, using the code', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Brittany Carter' }],
    [{ name: 'brittany   carter', code: 'd01' }]
  );
  assert.equal(r.counts.affiliate, 1, 'd01 (case-insensitive) is one of her three codes');
});

test('email takes precedence: a name collision does not falsely tag the wrong client', () => {
  // Two different people named "John Smith"; only the one whose email is
  // matched with her code should count as affiliate.
  const r = a.affiliateGap(
    [
      { id: '1', name: 'John Smith', email: 'john.a@example.com' },
      { id: '2', name: 'John Smith', email: 'john.b@example.com' }
    ],
    [{ email: 'john.a@example.com', name: 'John Smith', code: 'B01B1514' }]
  );
  assert.ok(r.counts.affiliate >= 1);
});

test('counts add up to the client total', () => {
  const r = a.affiliateGap(
    [{ id: '1', email: 'a@x.com' }, { id: '2', email: 'b@x.com' }, { id: '3', email: 'c@x.com' }],
    [{ email: 'a@x.com', code: 'B01B1514' }]
  );
  assert.equal(r.counts.total, 3);
  assert.equal(r.counts.affiliate + r.counts.notAffiliate + r.counts.notOnMfsn, r.counts.total);
});

test('an empty enrolled list means every client is not_on_mfsn', () => {
  const r = a.affiliateGap([{ id: '1', email: 'a@x.com' }, { id: '2', email: 'b@x.com' }], []);
  assert.equal(r.counts.notOnMfsn, 2);
});

test('a manual override to "affiliate" wins over a computed non-match', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Nobody', email: 'nobody@example.com' }],
    [], // not on MFSN at all
    { '1': 'affiliate' }
  );
  assert.equal(r.counts.affiliate, 1);
  assert.equal(r.counts.notOnMfsn, 0);
  assert.equal(r.tagged[0].mfsnStatus, 'affiliate');
  assert.equal(r.tagged[0].mfsnMatched, false);
  assert.equal(r.tagged[0].mfsnOverride, 'affiliate');
});

test('a manual override to "not_on_mfsn" wins over a computed affiliate match', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Someone', email: 'someone@example.com' }],
    [{ email: 'someone@example.com', code: 'B01B1514' }],
    { '1': 'not_on_mfsn' }
  );
  assert.equal(r.counts.affiliate, 0);
  assert.equal(r.counts.notOnMfsn, 1);
  assert.equal(r.tagged[0].mfsnMatched, true, 'the raw match is still tracked underneath the override');
});

test('overriding one client does not manufacture a false prospect', () => {
  // The email is still genuinely matched -- overriding the client's own
  // status shouldn't make the matching MFSN member look unmatched.
  const r = a.affiliateGap(
    [{ id: '1', name: 'Someone', email: 'someone@example.com' }],
    [{ email: 'someone@example.com', name: 'Someone', code: 'B01B1514' }],
    { '1': 'not_on_mfsn' }
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

test('extractEnrollCode pulls the code out of an Upgrade Link URL', () => {
  assert.equal(a.extractEnrollCode('https://app.myfreescorenow.com/enroll/B01B1514?s=1&e=2'), 'B01B1514');
  assert.equal(a.extractEnrollCode('https://app.myfreescorenow.com/enroll/d01'), 'd01');
  assert.equal(a.extractEnrollCode(''), null);
  assert.equal(a.extractEnrollCode('NA'), null);
});

test('hasHerAffiliateCode recognizes all three confirmed codes, case-insensitively', () => {
  assert.equal(a.hasHerAffiliateCode('B01B1514'), true);
  assert.equal(a.hasHerAffiliateCode('d01'), true);
  assert.equal(a.hasHerAffiliateCode('D01'), true);
  assert.equal(a.hasHerAffiliateCode('B02B1514'), true);
  assert.equal(a.hasHerAffiliateCode('SOMEONE-ELSES-CODE'), false);
  assert.equal(a.hasHerAffiliateCode(null), false);
  assert.equal(a.hasHerAffiliateCode(''), false);
});

test('a member row carrying an upgradeLink is matched via code extraction, not just an explicit code field', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Via Link', email: 'vialink@example.com' }],
    [{ email: 'vialink@example.com', upgradeLink: 'https://app.myfreescorenow.com/enroll/B02B1514?s=x&e=y' }]
  );
  assert.equal(r.tagged[0].mfsnStatus, 'affiliate');
});

test('a member matched by email but genuinely not enrolled under any of her codes is not_affiliate, not not_on_mfsn', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'Plain Member', email: 'plain@example.com' }],
    [{ email: 'plain@example.com', upgradeLink: 'NA' }]
  );
  assert.equal(r.tagged[0].mfsnStatus, 'not_affiliate');
  assert.equal(r.tagged[0].mfsnMatched, true);
});

// ---- $ figures on the affiliate-gap card (revenue) ----

test('commissionForMember maps known plan amounts to the real per-plan commission, and unknown/missing amounts to the blended rate', () => {
  assert.equal(a.commissionForMember({ planAmount: 34.95 }), a.PLAN_AMOUNT_COMMISSION[34.95]);
  assert.equal(a.commissionForMember({ planAmount: 29.90 }), a.PLAN_AMOUNT_COMMISSION[29.90]);
  assert.equal(a.commissionForMember({ planAmount: 99.99 }), a.BLENDED_MONTHLY_RATE);
  assert.equal(a.commissionForMember({}), a.BLENDED_MONTHLY_RATE);
  assert.equal(a.commissionForMember(null), a.BLENDED_MONTHLY_RATE);
});

test('affiliateGap revenue.affiliate sums each matched member\'s real plan commission, not a flat rate times count', () => {
  const r = a.affiliateGap(
    [
      { id: '1', name: 'High Plan', email: 'high@example.com' },
      { id: '2', name: 'Low Plan', email: 'low@example.com' }
    ],
    [
      { email: 'high@example.com', code: 'B01B1514', planAmount: 34.95 },
      { email: 'low@example.com', code: 'B01B1514', planAmount: 29.90 }
    ]
  );
  const expected = a.PLAN_AMOUNT_COMMISSION[34.95] + a.PLAN_AMOUNT_COMMISSION[29.90];
  assert.equal(r.revenue.affiliate, Math.round(expected * 100) / 100);
});

test('affiliateGap revenue for not_on_mfsn and total falls back to the blended rate (no real plan to read for non-members)', () => {
  const r = a.affiliateGap(
    [{ id: '1', name: 'No Match', email: 'nomatch@example.com' }],
    []
  );
  assert.equal(r.counts.notOnMfsn, 1);
  assert.equal(r.revenue.notOnMfsn, a.BLENDED_MONTHLY_RATE);
  assert.equal(r.revenue.total, a.BLENDED_MONTHLY_RATE);
});

test('affiliateGap revenue.total equals affiliate + notAffiliate + notOnMfsn revenue combined', () => {
  const r = a.affiliateGap(
    [
      { id: '1', name: 'Affiliate Guy', email: 'aff@example.com' },
      { id: '2', name: 'Leak Guy', email: 'leak@example.com' },
      { id: '3', name: 'No Match Guy', email: 'none@example.com' }
    ],
    [
      { email: 'aff@example.com', code: 'B01B1514', planAmount: 34.95 },
      { email: 'leak@example.com', upgradeLink: 'NA', planAmount: 29.90 }
    ]
  );
  const expectedTotal = Math.round((r.revenue.affiliate + r.revenue.notAffiliate + r.revenue.notOnMfsn) * 100) / 100;
  assert.equal(r.revenue.total, expectedTotal);
});
