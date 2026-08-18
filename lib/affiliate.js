// MyFreeScoreNow affiliate gap: which clients are on MyFreeScoreNow under
// her company account ("affiliate") or not found on MyFreeScoreNow at all
// ("not_on_mfsn"). Members arrive from the live n8n sync, which logs into
// her own MFSN admin account and pulls the member list scoped to her
// company -- so any match at all means MFSN already attributes that
// member to her. Clients come from the roster (GHL contacts, or the Deal
// Production tracker).
//
// Matching is by email when present (exact) and falls back to normalized
// name. Email is preferred because names collide — two "John Smith"s are
// common, duplicate emails are not.
//
// Corrected 2026-07-30: an earlier version of this file only counted a
// matched member as "affiliate" if their enrollment link/code was one of
// three known codes (AFFILIATE_CODES), tagging everyone else "not
// affiliate" -- on MFSN, but supposedly not credited to her. Spot-checked
// live against MFSN's own Member List for several "not affiliate" clients
// and every one of them was already sitting in her Active roster with a
// real commission attached, just enrolled through a code that wasn't on
// that short list. Since the member list itself is already scoped to her
// company account (it's fetched by logging into her MFSN admin login, not
// a company-wide export), any match at all is real credit for her --
// there's no such thing as "on her own MFSN account but not hers." So a
// match is now always "affiliate"; the enrollment code is kept around
// (hasHerAffiliateCode / AFFILIATE_CODES) purely as informational data,
// not as the thing that decides the tag. "not_affiliate" still exists as
// a manual override value (see overrides below) for the rare case Tiffany
// knows better than the match, but nothing computes it automatically
// anymore.

// Legacy set of specifically-confirmed codes -- no longer used to decide
// affiliate vs not_affiliate (see note above), kept for
// hasHerAffiliateCode()/informational use only.
const AFFILIATE_CODES = new Set(['B01B1514', 'D01', 'B02B1514']);

// Monthly commission by plan, confirmed live from Company Details -> Plans
// on MFSN's own site, 2026-07-30:
//   B01B1514 (no trial, $29.90 signup)   -> $13.80/mo
//   B02B1514 (7-day trial, $29.90 signup) -> $12.80/mo
//   C01B1514 (no trial, $34.95 signup)   -> $17.30/mo
// The member-list export/API includes a per-member "Plan Amount" ($29.90 or
// $34.95 -- confirmed live in the Member List row-expand view, 2026-07-30),
// which tells us the signup price but not which of the two $29.90 plans
// (B01 vs B02) they're on, since both cost the same to sign up. So: a
// $34.95 member maps exactly to $17.30/mo; a $29.90 member maps to the
// average of the two $29.90-tier rates. Members with no plan amount on file
// at all (not yet re-synced with this field, or not matched to MFSN) fall
// back to the overall blended rate.
const PLAN_AMOUNT_COMMISSION = { 29.90: 13.30, 34.95: 17.30 }; // 29.90 -> avg(13.80, 12.80)
const BLENDED_MONTHLY_RATE = 14.63; // (13.80 + 12.80 + 17.30) / 3, fallback only

function commissionForMember(m) {
  const amt = m && m.planAmount != null ? Number(m.planAmount) : null;
  if (amt != null && PLAN_AMOUNT_COMMISSION[amt] != null) return PLAN_AMOUNT_COMMISSION[amt];
  return BLENDED_MONTHLY_RATE;
}

function normEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  return s || null;
}
function normName(n) {
  const s = String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return s || null;
}

// Pulls the enrollment code out of an "Upgrade Link" URL, e.g.
// "https://app.myfreescorenow.com/enroll/B01B1514?s=..." -> "B01B1514".
// Returns null if there's no link or it doesn't match the expected shape.
function extractEnrollCode(upgradeLink) {
  const s = String(upgradeLink || '').trim();
  const m = s.match(/\/enroll\/([^/?]+)/i);
  return m ? m[1] : null;
}

// True if this row's enrollment code is one of hers.
function hasHerAffiliateCode(code) {
  return !!code && AFFILIATE_CODES.has(String(code).trim().toUpperCase());
}

// Clean an incoming member list: keep email/name/hasAffiliateCode, drop
// blanks, dedupe by email (or by name when there is no email). On a
// dedupe collision, hasAffiliateCode is OR'd across the duplicates rather
// than just keeping the first -- if any row for this person carries her
// code, they count as hers.
function normalizeMembers(members) {
  const seen = new Map();
  for (const m of members || []) {
    const email = normEmail(m.email);
    const name = normName(m.name);
    if (!email && !name) continue;
    const key = email || 'name:' + name;
    const hasAffiliateCode = typeof m.hasAffiliateCode === 'boolean'
      ? m.hasAffiliateCode
      : hasHerAffiliateCode(m.code || extractEnrollCode(m.upgradeLink));
    const planAmount = m.planAmount != null && m.planAmount !== '' ? Number(m.planAmount) : null;
    const existing = seen.get(key);
    if (existing) {
      existing.hasAffiliateCode = existing.hasAffiliateCode || hasAffiliateCode;
      if (existing.planAmount == null) existing.planAmount = planAmount;
    } else {
      seen.set(key, { email, name, hasAffiliateCode, planAmount });
    }
  }
  return Array.from(seen.values());
}

// overrides: { [clientId]: 'affiliate' | 'not_affiliate' | 'not_on_mfsn' }
// -- a manual, per-client call from the client drawer that wins over the
// computed status (e.g. someone signed up under her link with a
// different email than the one on file, so the export doesn't catch
// them). See store.getAffiliateOverrides(). The raw match is still
// tracked underneath an override (matchedEmails/matchedNames below) so
// "prospects" -- members matching no client at all -- doesn't get thrown
// off by a manual override on one client.
function affiliateGap(clients, enrolled, overrides) {
  overrides = overrides || {};
  const members = normalizeMembers(enrolled);
  const byEmail = new Map(members.filter(m => m.email).map(m => [m.email, m]));
  const byName = new Map(members.filter(m => m.name).map(m => [m.name, m]));

  const matchedEmails = new Set();
  const matchedNames = new Set();

  // One pass, annotating every client with its effective status --
  // reused as-is by /api/clients and /api/clients/:id so the list, the
  // filter, and this card's counts can never disagree with each other.
  const tagged = (clients || []).map(c => {
    let member = null;
    const e = normEmail(c.email);
    if (e && byEmail.has(e)) { member = byEmail.get(e); matchedEmails.add(e); }
    else {
      const n = normName(c.name);
      if (n && byName.has(n)) { member = byName.get(n); matchedNames.add(n); }
    }
    const matched = !!member;
    // Any match at all means MFSN's own data already credits this member
    // to her company account -- see the note above. hasAffiliateCode is
    // no longer part of this decision, just informational data on member.
    const computed = matched ? 'affiliate' : 'not_on_mfsn';
    const override = overrides[c.id] || null;
    const mfsnStatus = override || computed;
    // Only trust the matched member's real plan-based commission when the
    // match is still live (not overridden away from what MFSN's data says) --
    // an override to 'not_on_mfsn' means we no longer believe this member
    // match, so fall back to the blended rate for that client's revenue.
    const commission = matched && mfsnStatus !== 'not_on_mfsn' ? commissionForMember(member) : BLENDED_MONTHLY_RATE;
    return { ...c, mfsnStatus, mfsnMatched: matched, mfsnOverride: override, mfsnCommission: commission };
  });

  const affiliateClients = tagged.filter(c => c.mfsnStatus === 'affiliate');
  const notAffiliateClients = tagged.filter(c => c.mfsnStatus === 'not_affiliate');
  const notOnMfsnClients = tagged.filter(c => c.mfsnStatus === 'not_on_mfsn');

  // Members on MyFreeScoreNow who matched NO client at all -- on the
  // export (maybe through her link, maybe not) but not a credit-repair
  // client in this system yet. Real emails here (GHL is the source), so
  // this match is exact, not the coarse name-only fallback
  // productionGap() below has to use. Based on the raw match, not any
  // override, so manually re-tagging one client never manufactures or
  // hides a prospect.
  const prospects = members.filter(m => {
    if (m.email && matchedEmails.has(m.email)) return false;
    if (m.name && matchedNames.has(m.name)) return false;
    return true;
  });

  const round2 = n => Math.round(n * 100) / 100;
  const sumCommission = list => list.reduce((s, c) => s + (c.mfsnCommission || BLENDED_MONTHLY_RATE), 0);

  return {
    tagged,
    affiliate: affiliateClients,
    notAffiliate: notAffiliateClients,
    notOnMfsn: notOnMfsnClients,
    prospects,
    counts: {
      total: tagged.length,
      affiliate: affiliateClients.length,
      notAffiliate: notAffiliateClients.length,
      notOnMfsn: notOnMfsnClients.length,
      prospects: prospects.length
    },
    // $ figures. Where a client is matched to a real MFSN member with a
    // known plan amount, uses that member's actual commission
    // (mfsnCommission, set above from PLAN_AMOUNT_COMMISSION); otherwise
    // falls back to the blended rate. affiliate/notAffiliate are matched
    // members, so these are as real as the plan-amount data on file.
    // notOnMfsn/total lean on the blended estimate for the not-yet-enrolled
    // portion, since there's no real plan to read for someone who isn't a
    // member yet.
    // - affiliate: what she's actually collecting today
    // - notAffiliate: money she's missing out on right now -- these clients
    //   are already paying MFSN, just not attributed to her affiliate link
    // - notOnMfsn: potential monthly revenue if these clients get enrolled
    // - total: the ceiling -- what she could be collecting on her full
    //   client list if every one of them were an active, correctly
    //   attributed MFSN affiliate member
    revenue: {
      monthlyRate: BLENDED_MONTHLY_RATE,
      affiliate: round2(sumCommission(affiliateClients)),
      notAffiliate: round2(sumCommission(notAffiliateClients)),
      notOnMfsn: round2(notOnMfsnClients.length * BLENDED_MONTHLY_RATE),
      total: round2(sumCommission(affiliateClients) + sumCommission(notAffiliateClients) + notOnMfsnClients.length * BLENDED_MONTHLY_RATE)
    }
  };
}

// ---- Deal Production roster gap: same idea, but for the built-in client
// tracker (seeded from the credit-repair sheet), not GHL. Those records only
// ever have "First L." (last name reduced to an initial, for privacy) and no
// email, so a normName() exact match almost never fires. Match on first name
// + last initial instead — coarser, and two "John S."s really do collide, but
// it is the best a name-only, initial-only roster allows. Called out to
// whoever reads this: verify collisions before trusting "needs affiliate" as
// gospel for someone with a common name.
function normFirstLastInitial(n) {
  const s = String(n || '').trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const parts = s.split(' ');
  const first = parts[0];
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
  if (!first) return null;
  return first + '|' + lastInitial;
}

// prodClients: [{id, name, ...}] from the Deal Production tracker.
// enrolled: raw MyFreeScoreNow member list [{name, email}].
//
// Returns:
//   tagged      — one entry per prodClient: { id, mfsn: 'affiliate' | 'needs' }
//   prospects   — enrolled members that matched NO production client at all
//                 (on MyFreeScoreNow, but not a credit-repair client yet)
//   counts      — total / affiliate / needs / prospects
function productionGap(prodClients, enrolled, overrides) {
  overrides = overrides || {};
  const members = normalizeMembers(enrolled);
  const byKey = new Map();
  for (const m of members) {
    const key = normFirstLastInitial(m.name);
    if (key && !byKey.has(key)) byKey.set(key, m); // first match wins on a collision
  }

  const matchedKeys = new Set();
  const tagged = (prodClients || []).map(c => {
    const key = normFirstLastInitial(c.name);
    const hit = key && byKey.has(key);
    if (hit) matchedKeys.add(key);
    // A hand-set mark beats the name-match guess ("mark if they're in
    // MyFreeScoreNow" -- the team knows things a coarse name key cannot).
    // 'not_affiliate' still reads as needs here: on MFSN under the wrong
    // link is exactly the situation the needs-affiliate pill exists for.
    const ov = overrides[c.id] || null;
    const mfsn = ov === 'affiliate' ? 'affiliate'
      : (ov === 'not_on_mfsn' || ov === 'not_affiliate') ? 'needs'
      : (hit ? 'affiliate' : 'needs');
    return { id: c.id, mfsn, mfsnOverride: ov };
  });

  const prospects = members.filter(m => {
    const key = normFirstLastInitial(m.name);
    return key && !matchedKeys.has(key);
  });

  const affiliateCount = tagged.filter(t => t.mfsn === 'affiliate').length;
  return {
    tagged,
    prospects,
    counts: {
      total: (prodClients || []).length,
      affiliate: affiliateCount,
      needs: tagged.length - affiliateCount,
      prospects: prospects.length
    }
  };
}

// ---- GHL <-> Deal Production reconciliation ----
// Deal Production was seeded once from the old credit-repair sheet (3,578
// records, "First L." names only, no email/phone -- see productionGap above).
// GoHighLevel is the live, growing client list. The two have drifted apart:
// a client added to GHL since that one-time import (like a brand-new signup)
// never shows up in Deal Production until someone notices and adds them by
// hand. This reconciles GHL -> Deal Production one direction, and reports
// (but does not act on) the other direction.
//
// isCreditRepairClient: only GHL contacts actually doing credit-repair work
// are candidates -- a bare SMS lead with no deal tag and no DisputeFox tag
// isn't a "missing" Deal Production client, just a contact that was never
// meant to be tracked there.
function isCreditRepairClient(c) {
  if (c.deal) return true;
  const tags = c.tags || [];
  return tags.some(t => t === 'disputefox client' || String(t).startsWith('client:'));
}

// ghlClients: decorated GHL contacts (see server.js getClients()).
// prodClients: the current Deal Production roster (readProd()).
//
// Matching a GHL client against the existing roster:
//   1. exact match on ghlId, for any prod record this function already
//      created on a previous run (see makeProdRecordFromGhl in server.js)
//   2. first-name + last-initial fallback, to avoid re-adding someone who is
//      already in the roster under the old sheet's "First L." format
// Fallback (2) is coarse -- two different "John S."s collide -- so a GHL
// client can be skipped as "already tracked" when they are not. That is the
// safer failure mode than creating a duplicate for every close name match.
//
// Returns:
//   toAdd    — GHL clients with no match at all; caller creates a Deal
//              Production record for each (see makeProdRecordFromGhl)
//   notInGhl — existing Deal Production clients that match no current GHL
//              contact by ghlId or by name key. Best-effort and name-only
//              for legacy (pre-sync) records, so this needs a human look
//              before assuming any one of them is truly missing -- it is
//              surfaced for review, not auto-created in GHL (the sheet
//              import has no email or phone to create a usable contact
//              from).
function reconcileProduction(ghlClients, prodClients) {
  const prod = prodClients || [];
  const ghl = (ghlClients || []).filter(isCreditRepairClient);

  const existingGhlIds = new Set(prod.filter(c => c.ghlId).map(c => c.ghlId));
  const existingKeys = new Set(prod.map(c => normFirstLastInitial(c.name)).filter(Boolean));

  const toAdd = ghl.filter(c => {
    if (c.id && existingGhlIds.has(c.id)) return false;
    const key = normFirstLastInitial(c.name);
    if (key && existingKeys.has(key)) return false;
    return true;
  });

  const ghlIds = new Set(ghl.map(c => c.id).filter(Boolean));
  const ghlKeys = new Set(ghl.map(c => normFirstLastInitial(c.name)).filter(Boolean));
  const notInGhl = prod.filter(c => {
    if (c.ghlId) return !ghlIds.has(c.ghlId);
    const key = normFirstLastInitial(c.name);
    return !(key && ghlKeys.has(key));
  });

  return { toAdd, notInGhl };
}

module.exports = {
  affiliateGap, productionGap, normalizeMembers, normEmail, normName, normFirstLastInitial,
  extractEnrollCode, hasHerAffiliateCode, AFFILIATE_CODES,
  isCreditRepairClient, reconcileProduction,
  commissionForMember, PLAN_AMOUNT_COMMISSION, BLENDED_MONTHLY_RATE
};
