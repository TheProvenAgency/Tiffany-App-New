// Every client's real purchase history, derived from the Commas payment
// events rather than GoHighLevel's last_payment_date custom field.
//
// I previously wrote these event dates off as unusable. That was wrong, and
// worth recording so nobody repeats it: the check that condemned them summed
// events from a store that had not been seeded, got $14,148 for January
// against Commas' $74,255, and blamed the data. Summed properly the 5,133
// seeded events land within 5% of Commas' own monthly figures every month and
// match July exactly ($28,500). The dates were always fine.
//
// What that unlocks: a client's FIRST purchase, which is the honest clock for
// "how long have they been waiting to be onboarded". GHL only carries the
// LAST payment, so a client who bought in January and paid again in April
// looked four months newer than they were.

const affiliate = require('./affiliate');

function index(events) {
  const byEmail = new Map();
  const byName = new Map();
  // Deal Production came from a spreadsheet: the names are abbreviated to a
  // first name and a last initial ("April O.") and there is no email column at
  // all. Neither of the exact keys above can ever match one of those rows, so
  // a coarse key is the only way in -- the same one lib/affiliate.js already
  // uses to tag those clients.
  //
  // Coarse means collisions, and a collision here is not a slightly-worse
  // match, it is somebody else's purchase date. So each coarse key records
  // whether it is ambiguous, and an ambiguous one is refused rather than
  // guessed at.
  const byCoarse = new Map();

  const add = (map, key, e) => {
    if (!key) return;
    const cur = map.get(key);
    if (!cur) { map.set(key, { first: e.at, last: e.at, count: 1, total: e.amount || 0, people: new Set([affiliate.normName(e.name) || '']) }); return; }
    if (e.at < cur.first) cur.first = e.at;
    if (e.at > cur.last) cur.last = e.at;
    cur.count++;
    cur.total += e.amount || 0;
    cur.people.add(affiliate.normName(e.name) || '');
  };

  for (const e of events || []) {
    if (!e || !e.at) continue;
    add(byEmail, affiliate.normEmail(e.email), e);
    add(byName, affiliate.normName(e.name), e);
    add(byCoarse, affiliate.normFirstLastInitial(e.name), e);
  }
  return { byEmail, byName, byCoarse };
}

// Email first, normalised name second -- the same order and helpers
// lib/affiliate.js matches on, so a client the MFSN tag recognises is the same
// client this recognises rather than the two disagreeing about who is who.
function lookup(idx, client) {
  const e = affiliate.normEmail(client.email);
  if (e && idx.byEmail.has(e)) return { hit: idx.byEmail.get(e), by: 'email' };
  const n = affiliate.normName(client.name);
  if (n && idx.byName.has(n)) return { hit: idx.byName.get(n), by: 'name' };
  // Last resort, and only when it is unambiguous. "April O." matching two
  // different April O-somethings would hand one of them the other's purchase
  // date, and a confidently wrong date is worse than none.
  const k = affiliate.normFirstLastInitial(client.name);
  if (k && idx.byCoarse.has(k)) {
    const hit = idx.byCoarse.get(k);
    if (hit.people.size === 1) return { hit, by: 'initial' };
    return { ambiguous: true };
  }
  return null;
}

// Attaches firstPaid/lastPaid to each client. `fallback` supplies a date for
// clients with no matching event -- GoHighLevel's last_payment_date, which is
// still better than nothing, but is flagged as such so a caller can tell a
// real first purchase from a last-payment stand-in.
function attach(clients, events, opts) {
  opts = opts || {};
  const idx = index(events);
  const fallback = opts.fallback || (() => null);
  return (clients || []).map(c => {
    const m = lookup(idx, c);
    if (m && m.ambiguous) {
      const fb0 = fallback(c);
      return Object.assign({}, c, {
        firstPaid: null, lastPaid: fb0 || null, paymentCount: 0,
        paidSource: fb0 ? 'ghl:last-payment' : 'ambiguous'
      });
    }
    if (m) {
      return Object.assign({}, c, {
        firstPaid: m.hit.first,
        lastPaid: m.hit.last,
        paymentCount: m.hit.count,
        paidSource: 'commas:' + m.by
      });
    }
    const fb = fallback(c);
    return Object.assign({}, c, {
      firstPaid: null,           // a last payment is not a first purchase
      lastPaid: fb || null,
      paymentCount: 0,
      paidSource: fb ? 'ghl:last-payment' : null
    });
  });
}

// The date to measure a wait from: the real first purchase when we have it,
// otherwise whatever last-payment stand-in exists. Callers that care about the
// difference read paidSource.
function purchasedAt(client) {
  return (client && (client.firstPaid || client.lastPaid)) || null;
}

module.exports = { attach, index, lookup, purchasedAt };
