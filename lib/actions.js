// The Today queue: turns the three gaps the dashboard already measures into
// one ranked list of things to actually do.
//
// The problem this solves is not measurement. /api/affiliate-gap could
// already tell you there is roughly $62,700/month sitting in 4,287 clients
// who aren't on MyFreeScoreNow. But a number on a card is not a piece of
// work, and nobody opens an app to be told the size of a backlog.
//
// Two rules the ranking follows, both taken from the data rather than
// invented:
//
//   1. Reachability first. A client with no phone and no email cannot be
//      called, so they cannot be top of a call list regardless of value.
//   2. Warmth beats size. Someone who paid last month is far likelier to
//      enrol than someone who churned in 2024, and the commission spread
//      between clients is small ($14.63 blended, most within a few dollars),
//      so recency dominates value in practice.
//
// Dispute rounds share the queue because they are the other thing that makes
// money move, but they carry NO dollar figure. A round is work, not recurring
// revenue, and attaching a value would inflate the headline with money that
// does not exist.

const DAY = 86400000;

// Half-life on how much a lapsed client's recency still counts for. Not a
// cliff -- someone who lapsed 130 days ago is not worthless, just cooler.
const WARMTH_HALFLIFE_DAYS = 120;

function daysSince(dateish, now) {
  if (!dateish) return null;
  const t = new Date(dateish).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((now - t) / DAY));
}

// 0..1, applied as a multiplier rather than a bonus: an unreachable client
// isn't "slightly worse" to call, they're not callable. They stay in the list
// at a low rank rather than being hidden, because a number may exist
// elsewhere and silently dropping them would understate the opportunity.
function reachability(c) {
  const hasPhone = !!(c.phone && String(c.phone).trim());
  const hasEmail = !!(c.email && String(c.email).trim());
  if (hasPhone && hasEmail) return 1;
  if (hasPhone) return 0.85;
  if (hasEmail) return 0.55;
  return 0.05;
}

function warmth(c, now) {
  const d = daysSince(c.lastPaymentDate, now);
  if (d === null) return 0.15;
  return Math.pow(0.5, d / WARMTH_HALFLIFE_DAYS);
}

function enrollScore(c, now) {
  const active = (c.status === 'active') ? 1.35 : 1;
  // Value is deliberately a weak term: the spread is only a few dollars, so
  // letting it lead would reorder the list for no real gain.
  const value = 1 + Math.min(Number(c.mfsnCommission) || 0, 60) / 200;
  return reachability(c) * (0.35 + warmth(c, now)) * active * value;
}

function enrollItem(c, now) {
  const d = daysSince(c.lastPaymentDate, now);
  const why = c.status === 'active'
    ? (d !== null && d <= 60
        ? 'Active client, paid ' + d + ' days ago. Warmest kind of enrolment.'
        : 'Active credit-repair client with no MyFreeScoreNow monitoring.')
    : (d !== null
        ? 'Lapsed ' + d + ' days ago. Monitoring is a reason to re-open the conversation.'
        : 'No payment on file. Confirm they are still a client before pitching.');
  return {
    type: 'enroll',
    id: c.id,
    key: 'enroll:' + c.id,
    name: c.name || '(no name)',
    email: c.email || null,
    phone: c.phone || null,
    status: c.status || null,
    lastPaymentDate: c.lastPaymentDate || null,
    daysSincePayment: d,
    monthlyValue: Math.round((Number(c.mfsnCommission) || 0) * 100) / 100,
    why: why,
    action: 'Enrol on MyFreeScoreNow',
    score: enrollScore(c, now)
  };
}

// Rounds rank purely on how long they have sat. A round blocked for a year
// isn't worth more than one blocked a week -- it's more overdue, which is the
// only thing that should order this list.
function roundItem(r) {
  const days = Number(r.days) || 0;
  const ready = (r.readyBureaus || []).length;
  const blocked = (r.blockedBureaus || []).length;
  return {
    type: 'round',
    id: r.id,
    key: 'round:' + r.id,
    name: r.name || '(no name)',
    stage: r.stage || null,
    days: r.days == null ? null : days,
    readyBureaus: r.readyBureaus || [],
    blockedBureaus: r.blockedBureaus || [],
    monthlyValue: 0, // work, not revenue -- see the note at the top
    why: blocked
      ? blocked + ' bureau' + (blocked === 1 ? '' : 's') + ' blocked'
        + (days ? ', waiting ' + days + ' days' : '')
      : ready + ' bureau' + (ready === 1 ? '' : 's') + ' ready to file'
        + (days ? ', waiting ' + days + ' days' : ''),
    action: blocked ? 'Unblock and file' : 'File next round',
    score: days + (blocked ? 500 : 0)
  };
}

// When the caller can't see revenue (a disputer), the enrol side isn't
// filtered out at the end -- it is never built. Same discipline as
// lib/disputes.js: money can't leak from a field that was never populated.
function buildQueue(sources, opts) {
  sources = sources || {};
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const done = opts.done || {};
  const limit = opts.limit == null ? 25 : opts.limit;
  const caps = opts.capabilities ? new Set(opts.capabilities) : null;
  const canSeeMoney = !caps || caps.has('revenue') || caps.has('admin');

  const notOnMfsn = sources.notOnMfsn || [];
  const rounds = sources.rounds || [];

  let items = [];
  if (canSeeMoney) items = items.concat(notOnMfsn.map(function (c) { return enrollItem(c, now); }));
  items = items.concat(rounds.map(roundItem));
  items = items.filter(function (i) { return !done[i.key]; });

  // Normalise the two scoring scales against each other so one type can't
  // monopolise the top purely because its raw numbers are bigger.
  const maxBy = {};
  items.forEach(function (i) { maxBy[i.type] = Math.max(maxBy[i.type] || 0, i.score); });
  items.forEach(function (i) { i.rank = i.score / (maxBy[i.type] || 1); });
  items.sort(function (a, b) { return b.rank - a.rank; });

  const shown = limit > 0 ? items.slice(0, limit) : items;
  shown.forEach(function (i) { delete i.score; delete i.rank; });

  const totals = {
    roundsAvailable: rounds.length,
    shown: shown.length
  };
  if (canSeeMoney) {
    totals.enrollAvailable = notOnMfsn.length;
    totals.monthlyValue = Math.round(shown.reduce(function (s, i) {
      return s + (i.monthlyValue || 0); }, 0) * 100) / 100;
    // What the whole backlog is worth, not just today's page -- the reason to
    // come back tomorrow.
    totals.backlogMonthlyValue = Math.round(notOnMfsn.reduce(function (s, c) {
      return s + (Number(c.mfsnCommission) || 0); }, 0) * 100) / 100;
  }

  return { items: shown, totals: totals, generatedAt: new Date(now).toISOString() };
}

module.exports = { buildQueue: buildQueue, reachability: reachability, WARMTH_HALFLIFE_DAYS: WARMTH_HALFLIFE_DAYS };
