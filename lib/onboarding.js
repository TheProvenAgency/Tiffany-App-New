// New clients waiting to be onboarded, and which of them have waited too long.
//
// The clock is days since the client PAID, not days-in-stage. That is not a
// style choice -- it was checked against the live roster first. Of the 305
// clients sitting in Onboarding, days-in-stage is null for 153 and 0-5 for the
// other 152: the field is not tracking how long anyone has actually been
// waiting. Flagging on it would surface nobody, and the card would read as
// reassuring while 258 people who paid over a month ago sat unworked.
//
// Deliberately no money on these rows. Onboarding is desk work -- a VA runs it,
// and VAs do not see revenue.

const DAY = 86400000;
const DEFAULT_SLA_DAYS = 5;

// Only a client who has not yet moved on is still waiting to be onboarded.
const WAITING_STAGES = new Set(['Onboarding']);

function daysBetween(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

function countDocs(docs) {
  if (!docs || typeof docs !== 'object') return { onFile: 0, total: 0 };
  const keys = Object.keys(docs);
  return { onFile: keys.filter(k => docs[k]).length, total: keys.length };
}

function toRow(c, now, slaDays) {
  const waiting = daysBetween(c.lastPaid, now);
  const d = countDocs(c.docs);
  return {
    id: c.id,
    name: c.name || '(no name)',
    pkg: c.pkg || null,
    stage: c.stage,
    paidAt: c.lastPaid || null,
    waitingDays: waiting,
    // An unknown wait is not a breach. 43 of the 305 have no purchase date,
    // and claiming they are late would be inventing the thing being measured.
    flagged: waiting !== null && waiting > slaDays,
    docsOnFile: d.onFile,
    docsTotal: d.total,
    mfsn: c.mfsn || null,
    assignedTo: c.va && c.va !== '—' ? c.va : null
  };
}

function buildQueue(clients, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const slaDays = opts.slaDays == null ? DEFAULT_SLA_DAYS : Number(opts.slaDays);
  const limit = opts.limit == null ? 12 : opts.limit;

  const rows = (clients || [])
    .filter(c => c && WAITING_STAGES.has(c.stage))
    .map(c => toRow(c, now, slaDays))
    // Longest wait first -- that is the one worth chasing. Undated last: we
    // cannot rank what we cannot measure, and it must not outrank a real breach.
    .sort((a, b) => {
      if (a.waitingDays === null && b.waitingDays === null) return 0;
      if (a.waitingDays === null) return 1;
      if (b.waitingDays === null) return -1;
      return b.waitingDays - a.waitingDays;
    });

  const flagged = rows.filter(r => r.flagged);
  return {
    items: limit > 0 ? rows.slice(0, limit) : rows,
    totals: {
      onboarding: rows.length,
      flagged: flagged.length,
      undated: rows.filter(r => r.waitingDays === null).length,
      longestWait: rows.length && rows[0].waitingDays !== null ? rows[0].waitingDays : null,
      slaDays: slaDays
    },
    generatedAt: new Date(now).toISOString()
  };
}

module.exports = { buildQueue, DEFAULT_SLA_DAYS, WAITING_STAGES };
