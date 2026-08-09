// Deal Production, Postgres-primary. Supabase is the source of truth for
// reads and writes; the local production.json file is kept as a live,
// always-current BACKUP (written after every successful Postgres read/write),
// and is the fallback ONLY if Postgres is unreachable -- this is the
// opposite priority from lib/store.js's dual-write pattern (JSON primary,
// Postgres best-effort mirror), by explicit instruction: "Webhooks, APIs
// will store to supabase first, Then JSON."
//
// Every function here returns/accepts the exact same JSON record shape the
// app has always used -- {id, name, pkg, stage, days, tu, eq, ex, docs, va,
// notes, cfpb} -- so server.js's dashboard aggregation, sheet-sync/reconcile
// diff logic, and the frontend are all unaffected by this being backed by a
// normalized Postgres schema underneath.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const appCrypto = require('./crypto');
const store = require('./store'); // reuses the existing cached()/clearCache() utility already used for GHL pulls

const PROD_FILE = path.join(process.env.DATA_DIR || __dirname + '/..', 'production.json');
const PROD_SEED = path.join(__dirname, '..', 'seed', 'production-seed.json');

const DOC_KEY_MAP = {
  SSC: 'ssc', DL: 'dl', POA: 'poa', FTC: 'ftc',
  'Data breach': 'data_breach', Affidavit: 'affidavit',
  'Perm. purpose': 'perm_purpose', 'Experian letter': 'experian_letter'
};
const DOC_KEY_MAP_REV = Object.fromEntries(Object.entries(DOC_KEY_MAP).map(([k, v]) => [v, k]));

function readJsonBackup() {
  try { return JSON.parse(fs.readFileSync(PROD_FILE, 'utf8')); } catch (e) { return null; }
}
function writeJsonBackup(list) {
  try { fs.writeFileSync(PROD_FILE, JSON.stringify(list)); return true; } catch (e) { return false; }
}

// Reconstructs the full Deal Production roster from Postgres in 5 queries
// total (not N+1) -- one per table, grouped in memory by production_record_id.
async function readAllFromPostgres() {
  const [prodRes, bureauRes, docRes, cfpbRes, noteRes] = await Promise.all([
    db.query(`select pr.id, pr.legacy_id, pr.stage, pr.package, pr.days_in_program, pr.ownership, c.display_name, c.ghl_contact_id, c.primary_email, c.phone
               from production_records pr join clients c on c.id = pr.client_id`),
    db.query(`select production_record_id, bureau, round_number, status from production_bureau_status`),
    db.query(`select * from production_documents`),
    db.query(`select production_record_id, round_number, filed_date_raw, portal_login_or_note, portal_password_encrypted
               from production_cfpb_logins order by round_number`),
    db.query(`select production_record_id, body, author_label, created_at from production_notes order by created_at`)
  ]);

  const byRecord = new Map(); // production_record_id (pg bigint) -> partial accumulators
  for (const row of bureauRes.rows) {
    const key = row.bureau.toLowerCase();
    const acc = byRecord.get(row.production_record_id) || {};
    acc[key] = { r: row.round_number, st: row.status };
    byRecord.set(row.production_record_id, acc);
  }
  const docsById = new Map(docRes.rows.map(d => [d.production_record_id, d]));
  const cfpbById = new Map();
  for (const row of cfpbRes.rows) {
    const list = cfpbById.get(row.production_record_id) || [];
    let pw = '';
    if (row.portal_password_encrypted) {
      try { pw = appCrypto.decrypt(row.portal_password_encrypted); }
      catch (e) { pw = ''; /* key mismatch/corrupt -- don't crash the whole read over one bad cell */ }
    }
    list.push({ round: row.round_number, date: row.filed_date_raw || '', email: row.portal_login_or_note || '', pw });
    cfpbById.set(row.production_record_id, list);
  }
  const notesById = new Map();
  for (const row of noteRes.rows) {
    const list = notesById.get(row.production_record_id) || [];
    list.push({ when: (row.created_at.toISOString ? row.created_at.toISOString() : row.created_at).slice(0, 10), who: row.author_label || 'Team', text: row.body });
    notesById.set(row.production_record_id, list);
  }

  return prodRes.rows.map(pr => {
    const bureaus = byRecord.get(pr.id) || {};
    const doc = docsById.get(pr.id);
    return {
      id: pr.legacy_id,
      name: pr.display_name,
      ghlId: pr.ghl_contact_id || undefined,
      email: pr.primary_email || undefined,
      phone: pr.phone || undefined,
      pkg: pr.package || '',
      stage: pr.stage,
      days: pr.days_in_program,
      tu: bureaus.tu || undefined,
      eq: bureaus.eq || undefined,
      ex: bureaus.ex || undefined,
      docs: doc ? {
        SSC: doc.ssc, DL: doc.dl, POA: doc.poa, FTC: doc.ftc,
        'Data breach': doc.data_breach, Affidavit: doc.affidavit,
        'Perm. purpose': doc.perm_purpose, 'Experian letter': doc.experian_letter
      } : undefined,
      va: pr.ownership || '—',
      notes: notesById.get(pr.id) || [],
      cfpb: cfpbById.get(pr.id) || []
    };
  });
}

// Postgres-primary read: try Supabase first, refresh the JSON backup on
// success, fall back to the JSON backup (then the seed, on a first run) if
// Postgres is unreachable. This is the ONE function every other Deal
// Production read in server.js goes through.
//
// Cached for 30s (store.cached(), same utility already used for GHL pulls)
// -- reconstructing all ~3,600 records from 5 joined/grouped queries is
// real, measurable work (profiled at several seconds against Supabase's
// pooler from this environment), and Deal Production's full roster doesn't
// need to be byte-fresh on every single page load. A successful PATCH/append
// clears this cache immediately (see patchProdRecord/appendProdRecords)
// so a person's own edit is never hidden behind a stale cache window.
async function readProd() {
  if (db.isEnabled()) {
    try {
      const list = await store.cached('deal-production-full', 30 * 1000, readAllFromPostgres);
      writeJsonBackup(list); // keep the backup live and current
      return list;
    } catch (e) {
      console.error('Deal Production: Postgres read failed, falling back to JSON backup:', e.message);
    }
  }
  const backup = readJsonBackup();
  if (backup) return backup;
  // First run on a fresh disk with no Postgres data and no local backup yet.
  try {
    const seed = JSON.parse(fs.readFileSync(PROD_SEED, 'utf8'));
    if (!Array.isArray(seed)) return null;
    writeJsonBackup(seed);
    console.log(`Seeded Deal Production with ${seed.length} clients (JSON only -- Postgres unavailable)`);
    return seed;
  } catch (e) { return null; }
}

// Legacy full-replace path (POST /api/production) -- JSON only. This is the
// pre-PATCH pattern the code already flags as dangerous (last full write
// wins, clobbers concurrent edits); it predates this Postgres work and
// isn't the endpoint anything real should still be using.
function writeProdJsonOnly(list) { return writeJsonBackup(list); }

// Inserts brand-new records (sheet-sync's toCreate, reconcile's toAdd) --
// Postgres first, matching the same client+production_record+children
// pattern as the original CSV migration, then refreshes the JSON backup
// with the full merged roster.
async function appendProdRecords(existingList, newRecords) {
  if (db.isEnabled()) {
    try {
      await db.withTransaction(async client => {
        for (const rec of newRecords) {
          const clientRes = await client.query(
            'insert into clients (display_name, source, ghl_contact_id, primary_email, phone) values ($1,$2,$3,$4,$5) returning id',
            [rec.name || '', 'manual', rec.ghlId ? String(rec.ghlId) : null, rec.email || null, rec.phone || null]
          );
          const clientId = clientRes.rows[0].id;
          const prodRes = await client.query(
            `insert into production_records (legacy_id, client_id, stage, package, days_in_program, ownership)
             values ($1,$2,$3,$4,$5,$6) returning id`,
            [rec.id, clientId, rec.stage || 'Onboarding', rec.pkg || '', rec.days ?? null, rec.va || null]
          );
          const prId = prodRes.rows[0].id;
          for (const b of ['tu', 'eq', 'ex']) {
            if (!rec[b]) continue;
            await client.query(
              `insert into production_bureau_status (production_record_id, bureau, round_number, status) values ($1,$2,$3,$4)`,
              [prId, b.toUpperCase(), rec[b].r ?? null, rec[b].st || 'none']
            );
          }
          const docs = rec.docs || {};
          await client.query(
            `insert into production_documents (production_record_id, ssc, dl, poa, ftc, data_breach, affidavit, perm_purpose, experian_letter)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [prId, !!docs.SSC, !!docs.DL, !!docs.POA, !!docs.FTC, !!docs['Data breach'], !!docs.Affidavit, !!docs['Perm. purpose'], !!docs['Experian letter']]
          );
          for (const c of (rec.cfpb || [])) {
            const encPw = c.pw ? appCrypto.encrypt(c.pw) : null;
            await client.query(
              `insert into production_cfpb_logins (production_record_id, round_number, filed_date_raw, portal_login_or_note, portal_password_encrypted)
               values ($1,$2,$3,$4,$5)`,
              [prId, c.round, c.date || null, c.email || null, encPw]
            );
          }
          for (const n of (rec.notes || [])) {
            await client.query(
              `insert into production_notes (production_record_id, body, author_label) values ($1,$2,$3)`,
              [prId, n.text || '', n.who || 'Team']
            );
          }
        }
      });
      store.clearCacheKey('deal-production-full'); // don't let readProd() serve a stale pre-append cache
    } catch (e) {
      console.error('Deal Production: Postgres append failed (rolled back), JSON backup still updated:', e.message);
    }
  }
  writeJsonBackup(existingList.concat(newRecords));
  return true;
}

// Targeted single-record read for the open-drawer 4s poller (GET
// /api/production/:id) -- must NOT reconstruct the full ~3,600-record
// roster just to serve one lead; that was the whole reason this endpoint
// exists instead of reusing GET /api/production (see server.js's comment
// on that route). Same 5-table shape as readAllFromPostgres, filtered to
// one production_record_id, so it stays fast regardless of overall table
// size. Falls back to scanning the JSON backup if Postgres is unreachable.
async function readOneProdRecord(legacyId) {
  if (db.isEnabled()) {
    try {
      const prRes = await db.query(
        `select pr.id, pr.legacy_id, pr.stage, pr.package, pr.days_in_program, pr.ownership, c.display_name, c.ghl_contact_id, c.primary_email, c.phone
         from production_records pr join clients c on c.id = pr.client_id where pr.legacy_id = $1`,
        [legacyId]
      );
      const pr = prRes.rows[0];
      if (!pr) return null;
      const [bureauRes, docRes, cfpbRes, noteRes] = await Promise.all([
        db.query('select bureau, round_number, status from production_bureau_status where production_record_id = $1', [pr.id]),
        db.query('select * from production_documents where production_record_id = $1', [pr.id]),
        db.query('select round_number, filed_date_raw, portal_login_or_note, portal_password_encrypted from production_cfpb_logins where production_record_id = $1 order by round_number', [pr.id]),
        db.query('select body, author_label, created_at from production_notes where production_record_id = $1 order by created_at', [pr.id])
      ]);
      const bureaus = {};
      for (const row of bureauRes.rows) bureaus[row.bureau.toLowerCase()] = { r: row.round_number, st: row.status };
      const doc = docRes.rows[0];
      return {
        id: pr.legacy_id, name: pr.display_name,
        ghlId: pr.ghl_contact_id || undefined, email: pr.primary_email || undefined, phone: pr.phone || undefined,
        pkg: pr.package || '', stage: pr.stage, days: pr.days_in_program,
        tu: bureaus.tu, eq: bureaus.eq, ex: bureaus.ex,
        docs: doc ? {
          SSC: doc.ssc, DL: doc.dl, POA: doc.poa, FTC: doc.ftc,
          'Data breach': doc.data_breach, Affidavit: doc.affidavit,
          'Perm. purpose': doc.perm_purpose, 'Experian letter': doc.experian_letter
        } : undefined,
        va: pr.ownership || '—',
        notes: noteRes.rows.map(n => ({ when: (n.created_at.toISOString ? n.created_at.toISOString() : n.created_at).slice(0, 10), who: n.author_label || 'Team', text: n.body })),
        cfpb: cfpbRes.rows.map(c => {
          let pw = '';
          if (c.portal_password_encrypted) { try { pw = appCrypto.decrypt(c.portal_password_encrypted); } catch (e) { pw = ''; } }
          return { round: c.round_number, date: c.filed_date_raw || '', email: c.portal_login_or_note || '', pw };
        })
      };
    } catch (e) {
      console.error('Deal Production: Postgres single-record read failed, falling back to JSON backup:', e.message);
    }
  }
  const backup = readJsonBackup();
  return Array.isArray(backup) ? (backup.find(c => c.id === legacyId) || null) : null;
}

// Applies one lead's PATCH -- Postgres first (targeted updates to just the
// affected tables, not a whole-array rewrite), then the JSON backup via the
// same deep-merge server.js already used. `allowed` is the already
// role-filtered patch (see auth.filterEditable in server.js) plus `who`.
async function patchProdRecord(legacyId, allowed, who) {
  if (db.isEnabled()) {
    try {
      const { rows } = await db.query('select id, client_id from production_records where legacy_id = $1', [legacyId]);
      const prId = rows[0] && rows[0].id;
      const clientPgId = rows[0] && rows[0].client_id;
      if (prId != null) {
        for (const b of ['tu', 'eq', 'ex']) {
          if (!allowed[b]) continue;
          await db.query(
            `insert into production_bureau_status (production_record_id, bureau, round_number, status)
             values ($1,$2,$3,$4)
             on conflict (production_record_id, bureau) do update set round_number = excluded.round_number, status = excluded.status, updated_at = now()`,
            [prId, b.toUpperCase(), allowed[b].r ?? null, allowed[b].st || 'none']
          );
        }
        if (allowed.docs) {
          const sets = [];
          const vals = [prId];
          for (const [jsonKey, pgCol] of Object.entries(DOC_KEY_MAP)) {
            if (!(jsonKey in allowed.docs)) continue;
            vals.push(!!allowed.docs[jsonKey]);
            sets.push(`${pgCol} = $${vals.length}`);
          }
          if (sets.length) {
            await db.query(
              `insert into production_documents (production_record_id) values ($1) on conflict (production_record_id) do nothing`,
              [prId]
            );
            await db.query(`update production_documents set ${sets.join(', ')}, updated_at = now() where production_record_id = $1`, vals);
          }
        }
        if (allowed.note) {
          await db.query(
            'insert into production_notes (production_record_id, body, author_label) values ($1,$2,$3)',
            [prId, allowed.note, who || 'Team']
          );
        }
        if (Array.isArray(allowed.cfpb)) {
          for (const c of allowed.cfpb) {
            if (c.round == null) continue;
            const encPw = c.pw ? appCrypto.encrypt(c.pw) : null;
            await db.query(
              `insert into production_cfpb_logins (production_record_id, round_number, filed_date_raw, portal_login_or_note, portal_password_encrypted)
               values ($1,$2,$3,$4,$5)
               on conflict (production_record_id, round_number) do update set
                 filed_date_raw = excluded.filed_date_raw, portal_login_or_note = excluded.portal_login_or_note,
                 portal_password_encrypted = coalesce(excluded.portal_password_encrypted, production_cfpb_logins.portal_password_encrypted),
                 updated_at = now()`,
              [prId, c.round, c.date || null, c.email || null, encPw]
            );
          }
        }
        if (allowed.stage || allowed.va || allowed.pkg) {
          const sets = []; const vals = [prId];
          if (allowed.stage) { vals.push(allowed.stage); sets.push(`stage = $${vals.length}`); }
          if (allowed.va) { vals.push(allowed.va); sets.push(`ownership = $${vals.length}`); }
          if (allowed.pkg) { vals.push(allowed.pkg); sets.push(`package = $${vals.length}`); }
          await db.query(`update production_records set ${sets.join(', ')}, updated_at = now() where id = $1`, vals);
        }
        // GHL-linking fields (produced by sheet-sync's reconcileSheet() diff,
        // not the regular drawer PATCH) live on the linked clients row, not
        // production_records -- see lib/sheet.js reconcileSheet().
        if (clientPgId != null && (allowed.ghlId || allowed.name || allowed.email || allowed.phone)) {
          const sets = []; const vals = [clientPgId];
          if (allowed.ghlId) { vals.push(String(allowed.ghlId)); sets.push(`ghl_contact_id = $${vals.length}`); }
          if (allowed.name) { vals.push(allowed.name); sets.push(`display_name = $${vals.length}`); }
          if (allowed.email) { vals.push(allowed.email); sets.push(`primary_email = $${vals.length}`); }
          if (allowed.phone) { vals.push(allowed.phone); sets.push(`phone = $${vals.length}`); }
          await db.query(`update clients set ${sets.join(', ')}, updated_at = now() where id = $1`, vals);
        }
        store.clearCacheKey('deal-production-full'); // don't let readProd() serve a stale pre-patch cache
      } else {
        console.error(`Deal Production: PATCH for legacy_id ${legacyId} has no matching Postgres row (not migrated yet?) -- JSON backup still updated`);
      }
    } catch (e) {
      console.error('Deal Production: Postgres patch failed, JSON backup still updated:', e.message);
    }
  }
}

module.exports = { readProd, readOneProdRecord, writeProdJsonOnly, appendProdRecords, patchProdRecord, readJsonBackup, writeJsonBackup };
