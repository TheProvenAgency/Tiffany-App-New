// Reconciles Tiffany's live Google Sheet ("MSF CREDIT CLIENTS" -> Credit
// Repair tab) into Deal Production. Per Tiffany: the sheet is the source of
// truth for package/TU/EQ/EX round status/notes -- wherever it disagrees
// with what's in Deal Production, the sheet wins. This is a manual, one-time
// import (no live Sheets API connection): an admin pastes the tab's CSV
// export and this computes (and, once confirmed, applies) the diff.
//
// The sheet also carries a CFPB complaint-portal email + password per round
// (the team files each client's CFPB complaint on their behalf, so these are
// throwaway portal logins the team itself created and uses -- not the
// client's own credentials). Read and synced into Deal Production alongside
// everything else here, sheet-wins, same as package/TU/EQ/EX.

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
const ROUND_DATE_COLS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

function countFiledRounds(row) {
  let n = 0;
  for (const i of ROUND_DATE_COLS) if (row[i] && String(row[i]).trim()) n++;
  return n;
}

// CFPB portal login columns per round. Rounds 1-10 follow date/email/pw
// triples starting at column 9; the sheet's own layout runs out of that
// pattern at round 10 (no PW column follows RND 10 CFPB EMAIL) and tacks on
// an 11th round's email/pw with no date column of its own -- read exactly
// what's there rather than assuming a triple exists everywhere.
const CFPB_ROUND_COLS = [
  { round: 1, date: 9, email: 10, pw: 11 },
  { round: 2, date: 12, email: 13, pw: 14 },
  { round: 3, date: 15, email: 16, pw: 17 },
  { round: 4, date: 18, email: 19, pw: 20 },
  { round: 5, date: 21, email: 22, pw: 23 },
  { round: 6, date: 24, email: 25, pw: 26 },
  { round: 7, date: 27, email: 28, pw: 29 },
  { round: 8, date: 30, email: 31, pw: 32 },
  { round: 9, date: 33, email: 34, pw: 35 },
  { round: 10, date: 36, email: 37, pw: null },
  { round: 11, date: null, email: 39, pw: 40 }
];

function cell(row, i) {
  if (i == null) return null;
  const v = (row[i] || '').trim();
  return v || null;
}

// Returns one entry per round that has at least one of date/email/pw filled
// in -- most rows only go a few rounds deep, so this stays short in practice.
function parseCfpbRounds(row) {
  const out = [];
  for (const c of CFPB_ROUND_COLS) {
    const date = cell(row, c.date), email = cell(row, c.email), pw = cell(row, c.pw);
    if (date || email || pw) out.push({ round: c.round, date, email, pw });
  }
  return out;
}

function cfpbEqual(a, b) {
  const x = a || [], y = b || [];
  if (x.length !== y.length) return false;
  return x.every((r, i) => y[i] && r.round === y[i].round && r.date === y[i].date && r.email === y[i].email && r.pw === y[i].pw);
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
      notes: (row[8] || '').trim() || null,
      cfpb: parseCfpbRounds(row)
    });
  }
  return out;
}

function bureauEqual(a, b) {
  return a && b && a.r === b.r && a.st === b.st;
}

// GHL sometimes has more than one contact under the same name -- a real one
// from the client's actual signup (email/phone, real tags) alongside a bare
// "source:dispute-sheet-only" placeholder (no email/phone) that some other
// process created later. Picking blindly ("whichever comes first") silently
// linked Deal Production to the empty placeholder in practice, hiding real
// contact info that was there the whole time. Prefer the contact that
// actually has an email or phone; if more than one real contact shares the
// name, that's a genuine GHL-side duplicate worth a human look, not
// something to guess at -- return null rather than pick wrong.
function bestGhlMatch(candidates) {
  if (!candidates || !candidates.length) return null;
  const withInfo = candidates.filter(c => c.email || c.phone);
  if (withInfo.length === 1) return withInfo[0];
  if (withInfo.length === 0) return candidates[0]; // only blank placeholders -- any one links the same
  return null; // multiple real contacts share this name -- too ambiguous to auto-pick
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

  // Group every GHL contact under its normalized name first (not just the
  // first one seen) so bestGhlMatch() can choose the one with real contact
  // info instead of whichever the API happened to return first.
  const ghlGroupsByName = new Map();
  for (const c of ghl) {
    const n = normName(c.name);
    if (!n) continue;
    if (!ghlGroupsByName.has(n)) ghlGroupsByName.set(n, []);
    ghlGroupsByName.get(n).push(c);
  }

  const prodByGhlId = new Map(prod.filter(c => c.ghlId).map(c => [c.ghlId, c]));
  const prodByKey = new Map();
  for (const c of prod) { const k = normFirstLastInitial(c.name); if (k && !prodByKey.has(k)) prodByKey.set(k, c); }

  const nameCounts = new Map();
  for (const r of sheetRows) { const n = normName(r.name); if (n) nameCounts.set(n, (nameCounts.get(n) || 0) + 1); }

  const updates = [], toCreate = [], unmatched = [], duplicateNames = [];

  for (const row of sheetRows) {
    const n = normName(row.name);
    if (n && nameCounts.get(n) > 1) { duplicateNames.push(row); continue; }

    const ghlMatch = n ? bestGhlMatch(ghlGroupsByName.get(n)) : null;
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
      if (row.cfpb.length && !cfpbEqual(row.cfpb, existing.cfpb)) patch.cfpb = row.cfpb;
      // A GHL match confirms this record's real identity -- worth backfilling
      // even on a legacy "First L." record from the original redacted import,
      // so the client is findable by name/email everywhere else in the app
      // (search, the drawer, future matching) instead of staying stuck as
      // e.g. "Jennifer U." forever.
      if (ghlMatch) {
        if (ghlMatch.id && existing.ghlId !== ghlMatch.id) patch.ghlId = ghlMatch.id;
        if (ghlMatch.name && ghlMatch.name !== existing.name) patch.name = ghlMatch.name;
        if (ghlMatch.email && ghlMatch.email !== existing.email) patch.email = ghlMatch.email;
        if (ghlMatch.phone && ghlMatch.phone !== existing.phone) patch.phone = ghlMatch.phone;
      }
      if (Object.keys(patch).length) updates.push({ id: existing.id, patch, matchedGhl: !!ghlMatch, sheetNote: row.notes });
      continue;
    }

    if (ghlMatch) {
      toCreate.push({
        ghlId: ghlMatch.id, name: ghlMatch.name, email: ghlMatch.email || null, phone: ghlMatch.phone || null,
        pkg: row.pkg, stage: deriveStage(row.tu, row.eq, row.ex), tu: row.tu, eq: row.eq, ex: row.ex, notes: row.notes,
        cfpb: row.cfpb
      });
      continue;
    }

    unmatched.push(row);
  }

  return { updates, toCreate, unmatched, duplicateNames };
}

// ---- n8n JSON ingestion (the automated version of the CSV paste above) ----
// Same underlying "MSF CREDIT CLIENTS" Google Sheet, pushed by an n8n flow
// on a schedule instead of pasted by hand -- the sheet's per-round CFPB
// columns are now named CFPB_PW_RND_1..10 / ROUND_1..10_CFPB_EMAIL /
// RND_1..10_DATE (round 10 newly added) rather than laid out as fixed CSV
// column offsets, so this reads named JSON fields instead of column
// indices. Everything downstream (parseBureauCell, deriveStage,
// reconcileSheet) is unchanged and reused as-is -- only the raw-row reader
// differs from normalizeSheetRows() above.
function trimStr(v) {
  return String(v == null ? '' : v).trim();
}

// JSON equivalent of countFiledRounds() -- counts non-blank RND_N_DATE
// fields (1-10) so parseBureauCell's no-explicit-digit fallback (e.g.
// "Resolved") still resolves to a real round number instead of always
// defaulting to 1.
function countFiledRoundsJson(item) {
  let n = 0;
  for (let i = 1; i <= 10; i++) if (trimStr(item['RND_' + i + '_DATE'])) n++;
  return n;
}

// Real payload data is dirty (malformed dates, trailing \r on nearly every
// string field). Dates are never parsed into a real Date here -- neither
// parseCfpbRounds() above nor the Postgres write path
// (lib/production.js patchProdRecord/appendProdRecords) ever populate the
// parsed `filed_date` column, only the raw-text `filed_date_raw` -- so a
// malformed date ("12/22 antonette") is stored verbatim rather than
// dropped or crashing on an invalid date literal, exactly like a CSV
// import's messy date cells already are. trimStr() alone (JS's .trim()
// strips \r as whitespace) is the only sanitization this needs.
function parseCfpbRoundsJson(item) {
  const out = [];
  for (let i = 1; i <= 10; i++) {
    const date = trimStr(item['RND_' + i + '_DATE']) || null;
    const email = trimStr(item['ROUND_' + i + '_CFPB_EMAIL']) || null;
    const pw = trimStr(item['CFPB_PW_RND_' + i]) || null;
    if (date || email || pw) out.push({ round: i, date, email, pw });
  }
  return out;
}

// One n8n payload item (one Google Sheet row) -> the same
// {name, pkg, tu, eq, ex, notes, cfpb} shape normalizeSheetRows() produces
// from CSV, so reconcileSheet() can be reused unmodified. sourceRowId (the
// sheet/n8n row's own numeric `id`) rides along on the row for the
// caller's idempotent legacy_id scheme -- reconcileSheet() only ever reads
// the fields above and passes an unmatched row through untouched, so this
// extra property survives into its `unmatched` output.
function normalizeSheetJsonRow(item) {
  const filedRounds = countFiledRoundsJson(item);
  return {
    sourceRowId: item.id,
    name: trimStr(item.NAME),
    pkg: trimStr(item.PACKAGE) || null,
    tu: parseBureauCell(item.TU, filedRounds),
    eq: parseBureauCell(item.EQ, filedRounds),
    ex: parseBureauCell(item.EX, filedRounds),
    notes: trimStr(item.Notes) || null,
    cfpb: parseCfpbRoundsJson(item)
  };
}

// body: the n8n payload's body[] array of raw sheet-row objects. Returns
// one entry per row with a non-blank NAME (mirrors normalizeSheetRows()
// skipping blank-name CSV rows).
function normalizeSheetJsonRows(body) {
  const out = [];
  for (const item of (body || [])) {
    if (item && trimStr(item.NAME)) out.push(normalizeSheetJsonRow(item));
  }
  return out;
}

module.exports = {
  parseCsv, parseBureauCell, deriveStage, normalizeSheetRows, reconcileSheet, countFiledRounds, parseCfpbRounds, bestGhlMatch,
  countFiledRoundsJson, parseCfpbRoundsJson, normalizeSheetJsonRow, normalizeSheetJsonRows
};
