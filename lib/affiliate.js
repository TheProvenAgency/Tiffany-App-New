// MyFreeScoreNow affiliate gap: which clients are NOT enrolled under her
// affiliate link. Enrolled members arrive from a scheduled Zapier "Fetch Active
// Members List" Zap; clients come from the roster (GHL contacts, or the tracker).
//
// Matching is by email when present (exact) and falls back to normalized name.
// Email is preferred because names collide — two "John Smith"s are common,
// duplicate emails are not.

function normEmail(e) {
  const s = String(e || '').trim().toLowerCase();
  return s || null;
}
function normName(n) {
  const s = String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return s || null;
}

// Clean an incoming member list: keep email/name, drop blanks, dedupe by email
// (or by name when there is no email).
function normalizeMembers(members) {
  const seen = new Set();
  const out = [];
  for (const m of members || []) {
    const email = normEmail(m.email);
    const name = normName(m.name);
    if (!email && !name) continue;
    const key = email || 'name:' + name;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ email, name });
  }
  return out;
}

// overrides: { [clientId]: 'affiliate' | 'needs' } -- a manual, per-client
// call from the client drawer that wins over the computed email/name
// match (e.g. someone signed up under her link with a different email
// than the one on file). See store.getAffiliateOverrides(). The raw
// match is still tracked underneath an override (matchedEmails/
// matchedNames below) so "prospects" -- members matching no client at
// all -- doesn't get thrown off by a manual override on one client.
function affiliateGap(clients, enrolled, overrides) {
  overrides = overrides || {};
  const members = normalizeMembers(enrolled);
  const byEmail = new Set(members.map(m => m.email).filter(Boolean));
  const byName = new Set(members.map(m => m.name).filter(Boolean));

  const matchedEmails = new Set();
  const matchedNames = new Set();

  // One pass, annotating every client with its effective status --
  // reused as-is by /api/clients and /api/clients/:id so the list, the
  // filter, and this card's counts can never disagree with each other.
  const tagged = (clients || []).map(c => {
    let matched = false;
    const e = normEmail(c.email);
    if (e && byEmail.has(e)) { matched = true; matchedEmails.add(e); }
    else {
      const n = normName(c.name);
      if (n && byName.has(n)) { matched = true; matchedNames.add(n); }
    }
    const override = overrides[c.id] || null;
    const mfsnAffiliate = override === 'affiliate' ? true : override === 'needs' ? false : matched;
    return { ...c, mfsnAffiliate, mfsnMatched: matched, mfsnOverride: override };
  });

  const enrolledClients = tagged.filter(c => c.mfsnAffiliate);
  const notEnrolled = tagged.filter(c => !c.mfsnAffiliate);

  // Members on MyFreeScoreNow who matched NO client at all -- on the
  // affiliate roster (maybe through her link, maybe not) but not a
  // credit-repair client in this system yet. Real emails here (GHL is the
  // source), so this match is exact, not the coarse name-only fallback
  // productionGap() below has to use. Based on the raw match, not any
  // override, so manually re-tagging one client never manufactures or
  // hides a prospect.
  const prospects = members.filter(m => {
    if (m.email && matchedEmails.has(m.email)) return false;
    if (m.name && matchedNames.has(m.name)) return false;
    return true;
  });

  return {
    tagged,
    enrolled: enrolledClients,
    notEnrolled,
    prospects,
    counts: {
      total: tagged.length,
      enrolled: enrolledClients.length,
      notEnrolled: notEnrolled.length,
      prospects: prospects.length
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
function productionGap(prodClients, enrolled) {
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
    return { id: c.id, mfsn: hit ? 'affiliate' : 'needs' };
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

module.exports = { affiliateGap, productionGap, normalizeMembers, normEmail, normName, normFirstLastInitial };
