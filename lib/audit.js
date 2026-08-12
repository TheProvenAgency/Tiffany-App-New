// Who did what, and when.
//
// Nothing recorded this before: `who` reached patchProdRecord and was used only
// to label a note. So "who is getting work done" could not be answered at all,
// and the operations card had to fall back on who a client is ASSIGNED to --
// which is ownership, not activity, and was empty anyway.
//
// This is deliberately an append-only log of field changes rather than a
// counter per person. Counters cannot be audited, cannot be corrected, and
// cannot answer "what actually happened to this client" six weeks later.

const ROUND_FIELDS = new Set(['tu', 'eq', 'ex']);
const MAX_ENTRIES = 5000; // a working window, not an archive -- see trim()

// What a change means in plain terms. The label is what shows up in a
// throughput count, so it has to describe work, not the shape of the payload.
function classify(field, from, to) {
  if (ROUND_FIELDS.has(field)) {
    const wasR = (from && Number(from.r)) || 0;
    const nowR = (to && Number(to.r)) || 0;
    const wasSt = (from && from.st) || 'none';
    const nowSt = (to && to.st) || 'none';
    if (nowSt === 'done' && wasSt !== 'done') return 'round_filed';
    if (nowR > wasR) return 'round_advanced';
    if (nowSt === 'login' && wasSt !== 'login') return 'round_blocked';
    return 'round_updated';
  }
  if (field === 'stage') return to === 'Completed' ? 'client_completed' : 'stage_moved';
  if (field === 'docs') return 'docs_updated';
  if (field === 'note') return 'note_added';
  if (field === 'cfpb') return 'cfpb_updated';
  if (field === 'va') return to ? 'assigned' : 'unassigned';
  if (field === 'pkg') return 'package_changed';
  return 'updated';
}

// A change is only worth logging if something actually changed. Saving a
// drawer without edits would otherwise inflate everybody's numbers.
function changed(a, b) {
  if (a === b) return false;
  if (a == null && b == null) return false;
  return JSON.stringify(a) !== JSON.stringify(b);
}

// Builds the entries for one patch. `before` is the record as it was.
function entriesFor(patch, before, meta) {
  const at = (meta && meta.at) || new Date().toISOString();
  const who = (meta && meta.who) || 'Unknown';
  const out = [];
  for (const [field, to] of Object.entries(patch || {})) {
    const from = before ? before[field] : undefined;
    // A note is always new -- there is no previous value to compare.
    if (field !== 'note' && !changed(from, to)) continue;
    out.push({
      at, who,
      clientId: (meta && meta.clientId) || (before && before.id) || null,
      clientName: (before && before.name) || null,
      field,
      action: classify(field, from, to),
      // Values are kept only for the small scalar fields. A docs object or a
      // cfpb array would bloat the log without making it more readable, and
      // cfpb carries portal passwords, which must never land in an audit file.
      from: field === 'stage' || field === 'pkg' || field === 'va' ? (from ?? null) : undefined,
      to: field === 'stage' || field === 'pkg' || field === 'va' ? (to ?? null) : undefined
    });
  }
  return out;
}

// Newest first, capped. The cap is a working window: this answers "what has the
// team been doing lately", and an unbounded JSON log on a host with no
// persistent disk is a slow way to break the app.
function trim(list) {
  const sorted = (list || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return sorted.slice(0, MAX_ENTRIES);
}

// Per-person throughput over a window. Counts real actions, so somebody who
// files rounds all day outranks somebody who opens a lot of drawers.
function throughput(entries, opts) {
  opts = opts || {};
  const now = opts.now ? new Date(opts.now).getTime() : Date.now();
  const days = opts.days == null ? 30 : Number(opts.days);
  const since = now - days * 86400000;

  const people = {};
  let counted = 0;
  for (const e of entries || []) {
    const t = new Date(e.at).getTime();
    if (!isFinite(t) || t < since) continue;
    counted++;
    const p = people[e.who] = people[e.who] || {
      who: e.who, total: 0, roundsFiled: 0, completed: 0, notes: 0, docs: 0, other: 0,
      clients: new Set()
    };
    p.total++;
    if (e.clientId) p.clients.add(e.clientId);
    if (e.action === 'round_filed' || e.action === 'round_advanced') p.roundsFiled++;
    else if (e.action === 'client_completed') p.completed++;
    else if (e.action === 'note_added') p.notes++;
    else if (e.action === 'docs_updated') p.docs++;
    else p.other++;
  }

  const rows = Object.values(people).map(p => ({
    who: p.who, total: p.total, roundsFiled: p.roundsFiled, completed: p.completed,
    notes: p.notes, docs: p.docs, other: p.other, clientsTouched: p.clients.size
  })).sort((a, b) => b.total - a.total);

  return {
    people: rows,
    totals: {
      actions: counted,
      roundsFiled: rows.reduce((a, r) => a + r.roundsFiled, 0),
      completed: rows.reduce((a, r) => a + r.completed, 0),
      days,
      // Says how far back the log actually goes, so an empty week is not
      // mistaken for a quiet week when the truth is "we only started logging
      // on Tuesday".
      oldestEntry: (entries || []).length
        ? (entries || []).map(e => e.at).sort()[0] : null
    }
  };
}

module.exports = { entriesFor, throughput, trim, classify, changed, MAX_ENTRIES };
