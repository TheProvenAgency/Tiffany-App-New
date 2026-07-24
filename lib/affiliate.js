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

function affiliateGap(clients, enrolled) {
  const members = normalizeMembers(enrolled);
  const byEmail = new Set(members.map(m => m.email).filter(Boolean));
  const byName = new Set(members.map(m => m.name).filter(Boolean));

  const isEnrolled = c => {
    const e = normEmail(c.email);
    if (e && byEmail.has(e)) return true;
    const n = normName(c.name);
    if (n && byName.has(n)) return true;
    return false;
  };

  const enrolledClients = [];
  const notEnrolled = [];
  for (const c of clients || []) (isEnrolled(c) ? enrolledClients : notEnrolled).push(c);

  return {
    enrolled: enrolledClients,
    notEnrolled,
    counts: { total: (clients || []).length, enrolled: enrolledClients.length, notEnrolled: notEnrolled.length }
  };
}

module.exports = { affiliateGap, normalizeMembers, normEmail, normName };
