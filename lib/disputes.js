// The dispute desk: what a disputer works from.
//
// Deliberately a projection of the Deal Production record rather than a
// second store. The bureau columns (tu/eq/ex), the round each one is on, the
// CFPB login for that round, and the document checklist all already live on
// that row -- duplicating them would create a second source of truth for the
// same dispute work. What this module does instead is decide which rows are
// actionable, and hand back only the fields the dispute job needs, so the
// route can stay narrow and money never has to be redacted out of it later.

const BUREAUS = ['tu', 'eq', 'ex'];

// 'ready'  -- the bureau is waiting for its next round to be filed.
// 'login'  -- blocked: no credit-monitoring access, so no report can be
//             pulled and nothing can be filed until the client reconnects it.
// 'done'   -- filed, waiting on the bureau.
// 'none'   -- not being worked at this bureau.
const READY = 'ready';
const BLOCKED = 'login';

// A finished file can still carry a stale bureau flag from before it closed;
// surfacing those would put dead work at the top of someone's queue.
const WORKABLE_STAGES = new Set(['In rounds', 'Ready', 'Onboarding']);

function bureausWith(record, status) {
  return BUREAUS.filter(b => record[b] && record[b].st === status);
}

function currentRound(record) {
  return BUREAUS.reduce((max, b) => {
    const r = record[b] && record[b].r;
    return typeof r === 'number' && r > max ? r : max;
  }, 0);
}

// One queue row. Only the fields the desk needs to triage -- no package price,
// no spend, no commission. Money is not omitted by redaction here, it is
// simply never read off the source row.
function toQueueRow(record) {
  const readyBureaus = bureausWith(record, READY);
  const blockedBureaus = bureausWith(record, BLOCKED);
  return {
    id: record.id,
    name: record.name,
    stage: record.stage,
    days: record.days,
    currentRound: currentRound(record),
    readyBureaus,
    blockedBureaus,
    // 'ready' wins when a client is both: there is work that can be done
    // right now, which matters more for triage than the part that is stuck.
    status: readyBureaus.length ? 'ready' : 'blocked',
    assignedTo: record.va && record.va !== '—' ? record.va : null
  };
}

function buildQueue(records) {
  return (records || [])
    .filter(r => r && WORKABLE_STAGES.has(r.stage))
    .filter(r => bureausWith(r, READY).length || bureausWith(r, BLOCKED).length)
    .map(toQueueRow)
    .sort((a, b) => {
      // Everything actionable first, then longest-waiting inside each group --
      // a file stuck 400 days is the one most worth a call today.
      if (a.status !== b.status) return a.status === 'ready' ? -1 : 1;
      return (b.days || 0) - (a.days || 0);
    });
}

// The per-client record behind a queue row. Same rule as above: this is built
// up field by field from the source row, so a money field added to Deal
// Production later cannot leak in here by default.
function toDisputeRecord(record) {
  if (!record) return null;
  const bureaus = {};
  for (const b of BUREAUS) {
    bureaus[b] = {
      round: (record[b] && record[b].r) || 0,
      status: (record[b] && record[b].st) || 'none'
    };
  }
  return {
    id: record.id,
    name: record.name,
    stage: record.stage,
    days: record.days,
    currentRound: currentRound(record),
    bureaus,
    docs: record.docs || {},
    // Per-round CFPB portal logins -- the disputer files the complaint, so
    // they need these. Encrypted at rest in Postgres (see lib/crypto.js).
    cfpb: record.cfpb || [],
    notes: record.notes || [],
    assignedTo: record.va && record.va !== '—' ? record.va : null
  };
}

module.exports = { buildQueue, toDisputeRecord, currentRound, BUREAUS };
