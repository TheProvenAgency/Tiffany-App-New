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
function toQueueRow(record, docsInUse) {
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
    // Whether this can ACTUALLY be filed today. On the live book all 390 rows
    // marked "ready" are missing all 8 documents, so a disputer working the
    // list top-down opens every one and finds they cannot file it. Bureau
    // readiness and paperwork are two different gates and the queue was only
    // showing one.
    workableNow: !!readyBureaus.length && (!docsInUse || countMissingDocs(record) === 0),
    // So the UI can say "not tracked" instead of "8 missing", which reads as a
    // blocker that nobody put there.
    docsTracked: !!docsInUse,
    // Paperwork is the usual reason a round that looks ready can't actually
    // go out, and it is invisible from the queue without this -- a disputer
    // would open the record, find a missing affidavit, and close it again.
    // A count, not the documents themselves: the queue is a triage list.
    docsMissing: countMissingDocs(record),
    assignedTo: record.va && record.va !== '—' ? record.va : null
  };
}

// Documents are stored as a flat map of name -> truthy when on file. A record
// with no docs object at all has nothing recorded rather than nothing missing,
// which is a different thing, so it reports null instead of 0.
function countMissingDocs(record) {
  const docs = record && record.docs;
  if (!docs || typeof docs !== 'object') return null;
  const keys = Object.keys(docs);
  if (!keys.length) return null;
  return keys.filter(k => !docs[k]).length;
}

// Is anybody using the document checklist at all? On the live book the answer
// is no: all 3,891 clients have all 8 boxes false and not one document is
// ticked anywhere in the system. The checklist exists and has never been
// filled in.
//
// That matters because a gate on an unused field is not a gate, it is a wall.
// Requiring documents made "can file now" read 0 out of 1,231 -- technically
// true, practically a desk telling a disputer there is nothing to do all day.
// So the docs gate only applies once somebody has actually started using it.
function docsTrackingInUse(records) {
  return (records || []).some(r => {
    const d = r && r.docs;
    return d && typeof d === 'object' && Object.values(d).some(Boolean);
  });
}

function buildQueue(records) {
  const docsInUse = docsTrackingInUse(records);
  return (records || [])
    .filter(r => r && WORKABLE_STAGES.has(r.stage))
    .filter(r => bureausWith(r, READY).length || bureausWith(r, BLOCKED).length)
    .map(r => toQueueRow(r, docsInUse))
    .sort((a, b) => {
      // Genuinely workable first -- bureau ready AND paperwork complete. That
      // is the only group where opening the file leads to filing something.
      if (a.workableNow !== b.workableNow) return a.workableNow ? -1 : 1;
      if (a.status !== b.status) return a.status === 'ready' ? -1 : 1;
      // Then fewest documents outstanding: three missing is closer to workable
      // than eight, and chasing three is a shorter conversation.
      const am = a.docsMissing == null ? 99 : a.docsMissing;
      const bm = b.docsMissing == null ? 99 : b.docsMissing;
      if (am !== bm) return am - bm;
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

module.exports = { buildQueue, docsTrackingInUse, toDisputeRecord, currentRound, countMissingDocs, BUREAUS };
