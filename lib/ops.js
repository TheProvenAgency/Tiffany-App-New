// Admin operations view: what is moving, what is arriving, and what has
// stalled before it ever got started.
//
// "Past the mark on their first round" is the one that matters most. A client
// who has paid and never had round 1 filed is the worst state in the book --
// they have given money and received nothing, and unlike a stalled mid-package
// client there is no partial delivery to point at. It is also invisible in
// every other view: they sit in Onboarding or Ready looking like normal work.

const DAY = 86400000;
const DEFAULT_FIRST_ROUND_DAYS = 14;

function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

function roundsUsed(c) {
  return ['tu', 'eq', 'ex'].reduce((m, b) => {
    const r = c && c[b] && Number(c[b].r);
    return isFinite(r) && r > m ? r : m;
  }, 0);
}

// Bought, and nothing filed yet. Measured from the most recent purchase, the
// same clock the onboarding card uses -- buying again restarts the obligation.
function firstRoundOverdue(clients, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const slaDays = opts.slaDays == null ? DEFAULT_FIRST_ROUND_DAYS : Number(opts.slaDays);
  const limit = opts.limit == null ? 12 : opts.limit;

  const rows = (clients || [])
    .filter(c => c && c.stage !== 'Completed')
    .filter(c => roundsUsed(c) === 0)
    .map(c => {
      const from = c.lastPaid || c.firstPaid;
      const waiting = daysSince(from, now);
      return {
        id: c.id,
        name: c.name || '(no name)',
        pkg: c.pkg || null,
        stage: c.stage || null,
        paidAt: from || null,
        waitingDays: waiting,
        // An unknown wait is not a breach -- same rule as everywhere else.
        flagged: waiting !== null && waiting > slaDays,
        docsOnFile: c.docs ? Object.values(c.docs).filter(Boolean).length : 0,
        docsTotal: c.docs ? Object.keys(c.docs).length : 0,
        assignedTo: c.va && c.va !== '—' ? c.va : null
      };
    })
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
      neverStarted: rows.length,
      flagged: flagged.length,
      undated: rows.filter(r => r.waitingDays === null).length,
      longestWait: rows.length && rows[0].waitingDays !== null ? rows[0].waitingDays : null,
      slaDays: slaDays
    }
  };
}

// Headline counts for the admin view. Everything here is a state of the book
// right now rather than a rate over time: there is no per-round timestamp in
// the data, so "completed this month" cannot be computed honestly and is not
// claimed. What can be said is how many sit in each state today.
function snapshot(clients, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const newWithinDays = opts.newWithinDays == null ? 30 : Number(opts.newWithinDays);
  const list = clients || [];

  const byStage = {};
  for (const c of list) {
    const s = c.stage || '(none)';
    byStage[s] = (byStage[s] || 0) + 1;
  }

  const arrivals = list.filter(c => {
    const d = daysSince(c.lastPaid || c.firstPaid, now);
    return d !== null && d <= newWithinDays;
  });

  // Who owns what. The only per-person signal the data actually carries --
  // there is no record of who advanced a stage or filed a round, so this is
  // ownership, not throughput, and is labelled that way.
  const byOwner = {};
  for (const c of list) {
    const who = (c.va && c.va !== '—') ? c.va : null;
    if (!who) continue;
    const o = byOwner[who] = byOwner[who] || { owner: who, total: 0, completed: 0, inRounds: 0, notStarted: 0 };
    o.total++;
    if (c.stage === 'Completed') o.completed++;
    else if (roundsUsed(c) > 0) o.inRounds++;
    else o.notStarted++;
  }

  return {
    total: list.length,
    byStage,
    completed: byStage['Completed'] || 0,
    newClients: arrivals.length,
    newWithinDays,
    unassigned: list.filter(c => !c.va || c.va === '—').length,
    owners: Object.values(byOwner).sort((a, b) => b.total - a.total)
  };
}

module.exports = { firstRoundOverdue, snapshot, roundsUsed, DEFAULT_FIRST_ROUND_DAYS };
