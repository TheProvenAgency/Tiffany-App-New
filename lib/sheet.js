// Reconciles Tiffany's live Google Sheet ("MSF CREDIT CLIENTS" -> Credit
// Repair tab) into Deal Production. Per Tiffany: the sheet is the source of
// truth for package/TU/EQ/EX round status/notes -- wherever it disagrees
// with what's in Deal Production, the sheet wins. This is a manual, one-time
// import (no live Sheets API connection): an admin pastes the tab's CSV
// export and this computes (and, once confirmed, applies) the diff.
//
// The sheet also carries CFPB complaint emails/passwords per round -- those
// are credentials, not client data, and are intentionally never read here.

const { normName, normFirstLastInitial } = require('./affiliate');

// ---- CSV parsing (RFC4180-lite: quoted fields, embedded commas, "" escape) ----
// No npm dependency for this -- the app already avoids native deps (see
// lib/store.js) and the sheet export has no pathological edge cases beyond
// quoted commas.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = String(text || '').replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// 0-indexed columns for "RND N DATE" (rounds 1-10) in the Credit Repair tab.
// Used only to approximate a round number when a bureau cell's own text has
// none (e.g. "ready" with no round number) -- never to read the CFPB
// email/password columns next to each date.
const ROUND_DATE_COLS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

function countFiledRounds(row) {
  let n = 0;
  for (const i of ROUND_DATE_COLS) if (row[i] && String(row[i]).trim()) n++;
  return n;
}

// Turns one TU/EQ/EX cell's free text into { r, st }, matching the
// { r, st: 'none'|'ready'|'login'|'done' } shape production.json already
// uses. Real sheet text is messy ("Rnd 2 Rdy", "Round 7 Log In", "Resolved",
// "-", "CANCELLED", stray notes typed in the wrong column) -- anything that
// doesn't clearly map to one of the four states is left as 'none' with
// unrecognized:true and the raw text preserved, rather than guessed at.
function parseBureauCell(raw, filedRounds) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s === '-') return { r: 0, st: 'none', raw: s };
  const low = s.toLowerCase();
  const numMatch = s.match(/\d+/);
  const explicitRound = numMatch ? parseInt(numMatch[0], 10) : null;
  let st = null;
  if (/done|resolved|completed/.test(low)) st = 'done';
  else if (/rdy|ready/.test(low)) st = 'ready';
  else if (/log[\s-]?in/.test(low)) st = 'login';
  if (!st) return { r: 0, st: 'none', raw: s, unrecognized: true };
  const r = explicitRound != null ? explicitRound : Math.max(filedRounds, 1);
  return { r, st, raw: s };
}

// Best-effort pipeline stage from the three bureaus' computed status --
// mirrors how the app already reasons about a lead's stage (see
// anyLogin/anyReady in production.js) rather than inventing new rules.
function deriveStage(tu, eq, ex) {
  const sts = [tu.st, eq.st, ex.st];
  if (sts.includes('login')) return 'In rounds';
  if (sts.includes('ready')) return 'Ready';
  if (sts.every(s => s === 'done')) return 'Completed';
  if (sts.some(s => s !== 'none')) return 'In rounds';
  return 'Onboarding';
}

// rows: raw parseCsv() output, including the header row.
// Returns one entry per non-blank-name data row.
function normalizeSheetRows(rows) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[3] || '').trim();
    if (!name) continue;
    const filedRounds = countFiledRounds(row);
    out.push({
      rowIndex: i,
      name,
      pkg: (row[4] || '').trim() || null,
      tu: parseBureauCell(row[5], filedRounds),
      eq: parseBureauCell(row[6], filedRounds),
      ex: parseBureauCell(row[7], filedRounds),
      notes: (row[8] || '').trim() || null
    });
  }
  return out;
}

function bureauEqual(a, b) {
  return a && b && a.r === b.r && a.st === b.st;
}

// sheetRows: normalizeSheetRows() output.
// ghlClients: decorated GHL contacts (server.js getClients()) -- used only
//   to resolve a sheet row's identity (email/phone/ghlId), never modified.
// prodClients: current Deal Production roster (readProd()).
//
// Matching, in order:
//   1. a GHL client whose name matches the sheet row (normName, exact) ->
//      then an existing Deal Production record by that client's ghlId, or by
//      the old sheet-seed's first-name+last-initial key (see
//      lib/affiliate.js normFirstLastInitial) as a legacy fallback.
//   2. no GHL match at all -> still try the legacy first-name+last-initial
//      key directly, so an already-tracked sheet client is updated even
//      without a live GHL contact to confirm identity.
//   3. neither matches -> reported, never created (no email/phone in this
//      export to create a real GHL contact from).
//
// Returns:
//   updates      — [{ id, patch, matchedGhl }] existing records whose
//                  pkg/tu/eq/ex/notes differ from the sheet and should be
//                  overwritten (sheet wins)
//   toCreate     — [{ ghlId, name, email, phone, pkg, stage, tu, eq, ex,
//                  notes }] sheet rows matched to a GHL client with no
//                  Deal Production record yet
//   unmatched    — sheet rows matching neither a GHL client nor an existing
//                  Deal Production record
//   duplicateNames — sheet rows whose name collides with another sheet row
//                  (skipped entirely -- too ambiguous to auto-apply)
function reconcileSheet(sheetRows, ghlClients, prodClients) {
  const ghl = ghlClients || [];
  const prod = prodClients || [];

  const ghlByName = new Map();
  for (const c of ghl) { const n = normName(c.name); if (n && !ghlByName.has(n)) ghlByName.set(n, c); }

  const prodByGhlId = new Map(prod.filter(c => c.ghlId).map(c => [c.ghlId, c]));
  const prodByKey = new Map();
  for (const c of prod) { const k = normFirstLastInitial(c.name); if (k && !prodByKey.has(k)) prodByKey.set(k, c); }

  const nameCounts = new Map();
  for (const r of sheetRows) { const n = normName(r.name); if (n) nameCounts.set(n, (nameCounts.get(n) || 0) + 1); }

  const updates = [], toCreate = [], unmatched = [], duplicateNames = [];

  for (const row of sheetRows) {
    const n = normName(row.name);
    if (n && nameCounts.get(n) > 1) { duplicateNames.push(row); continue; }

    const ghlMatch = n ? ghlByName.get(n) : null;
    let existing = null;
    if (ghlMatch && ghlMatch.id && prodByGhlId.has(ghlMatch.id)) existing = prodByGhlId.get(ghlMatch.id);
    if (!existing) {
      const key = normFirstLastInitial(row.name);
      if (key && prodByKey.has(key)) existing = prodByKey.get(key);
    }

    if (existing) {
      const patch = {};
      if (row.pkg && row.pkg !== existing.pkg) patch.pkg = row.pkg;
      if (!bureauEqual(row.tu, existing.tu)) patch.tu = { r: row.tu.r, st: row.tu.st };
      if (!bureauEqual(row.eq, existing.eq)) patch.eq = { r: row.eq.r, st: row.eq.st };
      if (!bureauEqual(row.ex, existing.ex)) patch.ex = { r: row.ex.r, st: row.ex.st };
      const stage = deriveStage(row.tu, row.eq, row.ex);
      if (stage !== existing.stage) patch.stage = stage;
      if (ghlMatch && ghlMatch.id && existing.ghlId !== ghlMatch.id) patch.ghlId = ghlMatch.id;
      if (Object.keys(patch).length) updates.push({ id: existing.id, patch, matchedGhl: !!ghlMatch, sheetNote: row.notes });
      continue;
    }

    if (ghlMatch) {
      toCreate.push({
        ghlId: ghlMatch.id, name: ghlMatch.name, email: ghlMatch.email || null, phone: ghlMatch.phone || null,
        pkg: row.pkg, stage: deriveStage(row.tu, row.eq, row.ex), tu: row.tu, eq: row.eq, ex: row.ex, notes: row.notes
      });
      continue;
    }

    unmatched.push(row);
  }

  return { updates, toCreate, unmatched, duplicateNames };
}

module.exports = { parseCsv, parseBureauCell, deriveStage, normalizeSheetRows, reconcileSheet, countFiledRounds };
