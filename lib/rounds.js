// How many dispute rounds a client paid for, how many they have used, and
// therefore how many are left -- which is what says whether they are finished
// and worth an upsell.
//
// The rule was read off the data rather than assumed. Grouping the 3,883
// clients by package and comparing the highest round any of them reached:
//
//   "3 Month Expedited"    533 clients   max round 3
//   "3 Expedited Rounds"   468 clients   max round 3
//   "1 Month Expedited"    339 clients   max round 1 (one outlier at 2)
//   "2 Month Expedited"    273 clients   max round 2 (one outlier at 3)
//   "4 Month Expedited"     80 clients   max round 4
//   "4 Expedited Rounds"    75 clients   max round 4
//   "Help me fix it"        79 clients   max round 1
//
// The leading number is the round count whether the package says "Month" or
// "Rounds", and nobody exceeds it except by a rounding-error handful. Anything
// carrying "Unlimited" runs past it freely ("3 Month Expedited, Upgrade to
// Unlimited" reaches 8), which is the second rule.
//
// Everything else returns null. An unknown allowance is not zero and is not
// unlimited, and a client whose allowance we cannot read must never be
// reported as finished -- telling someone a client is done when they still
// have rounds owed is a refund conversation.

const UNLIMITED = 'unlimited';

// Packages whose names carry no number but whose allowance is known.
const NAMED = {
  'help me fix it': 1,
  'quick-fix': 1,
  'one hitter quitter': 1,
  'diamond': UNLIMITED,
  'unlimited': UNLIMITED
};

function roundsIncluded(pkg) {
  const raw = String(pkg || '').trim().toLowerCase();
  if (!raw) return null;

  // "Upgrade to Unlimited" wins over whatever was bought first -- that is the
  // point of the upgrade, and the data shows those clients running well past
  // the original number.
  if (/unlimited/.test(raw)) return UNLIMITED;

  // The package field accumulates: buying again appends rather than replaces,
  // so "Experian&Equifax Expedited Removal, 3 Month Expedited" is two
  // purchases. Reading only the first number is what produced 143 clients
  // apparently using more rounds than they bought. Sum the segments instead.
  let total = 0, sawNumber = false, sawUnknown = false;
  for (const seg of raw.split(',')) {
    const n = segmentRounds(seg.trim());
    if (n === null) { if (seg.trim()) sawUnknown = true; continue; }
    total += n;
    sawNumber = true;
  }
  if (!sawNumber) return null;
  // A total that includes an unreadable segment is a floor, not the answer.
  // forClient() marks it so nothing downstream treats it as exact.
  return sawUnknown ? { atLeast: total } : total;
}

// One package's allowance, from its own name.
function segmentRounds(raw) {
  if (!raw) return null;
  // One optional word between the count and the unit covers "3 Expedited
  // Rounds" alongside "3 Month Expedited" and "4-Month". Deliberately not
  // greedier than that: "2 Week Quick Fix" must not read as 2 rounds, which is
  // why only month/round count as the unit.
  const m = raw.match(/(\d+)\s*[-\s]?\s*(?:[a-z]+\s+)?(month|round)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n <= 24) return n; // a sane package; anything wilder is a typo
  }
  // Hyphens and spaces are used interchangeably in these names ("quick-fix"
  // in one record, "2 Week Quick Fix" in another), so flatten both sides.
  const flat = raw.replace(/[-\s]+/g, ' ');
  for (const key of Object.keys(NAMED)) {
    if (NAMED[key] === UNLIMITED) continue; // handled above
    if (flat.includes(key.replace(/[-\s]+/g, ' '))) return NAMED[key];
  }
  return null;
}

// Rounds used is the furthest any bureau has got. Rounds go out per bureau and
// do not always move together, so the highest is the one that has been paid
// for; summing the three would triple-count a single round.
function roundsUsed(client) {
  if (!client) return 0;
  return ['tu', 'eq', 'ex'].reduce((max, b) => {
    const r = client[b] && Number(client[b].r);
    return isFinite(r) && r > max ? r : max;
  }, 0);
}

function forClient(client) {
  const inc = roundsIncluded(client && client.pkg);
  const used = roundsUsed(client);

  if (inc === UNLIMITED) {
    return { roundsIncluded: UNLIMITED, roundsUsed: used, roundsLeft: null, finished: false, allowanceExact: true };
  }
  if (inc === null) {
    return { roundsIncluded: null, roundsUsed: used, roundsLeft: null, finished: false, allowanceExact: false };
  }

  const exact = typeof inc === 'number';
  const included = exact ? inc : inc.atLeast;
  const left = Math.max(0, included - used);

  return {
    roundsIncluded: included,
    allowanceExact: exact,
    roundsUsed: used,
    roundsLeft: left,
    // Finished means the work they paid for is done, which is the moment to
    // offer more. Only claimed when the allowance is exact -- if part of the
    // package was unreadable the real allowance may be higher, and telling
    // someone a client is done when rounds are still owed is a refund
    // conversation, not an upsell.
    finished: exact && used >= included
  };
}

function attach(clients) {
  return (clients || []).map(c => Object.assign({}, c, forClient(c)));
}

// Clients who have used everything they bought. Deliberately excludes anyone
// whose allowance is unknown or unlimited -- an upsell list has to be people
// you can honestly say are done.
function upsellQueue(clients, opts) {
  opts = opts || {};
  const limit = opts.limit == null ? 12 : opts.limit;
  const rows = attach(clients)
    .filter(c => c.finished)
    .sort((a, b) => (b.roundsUsed || 0) - (a.roundsUsed || 0));
  return {
    items: limit > 0 ? rows.slice(0, limit) : rows,
    totals: {
      finished: rows.length,
      unknownAllowance: attach(clients).filter(c => c.roundsIncluded === null).length,
      unlimited: attach(clients).filter(c => c.roundsIncluded === UNLIMITED).length
    }
  };
}

module.exports = { roundsIncluded, segmentRounds, roundsUsed, forClient, attach, upsellQueue, UNLIMITED };
