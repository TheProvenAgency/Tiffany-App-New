// Who did what. Nothing recorded this before -- `who` reached the patch and was
// used only to label a note -- so "who is getting work done" could not be
// answered, and the operations card fell back on who a client is assigned to,
// which is ownership rather than activity and was empty in any case.
const { test } = require('node:test');
const assert = require('node:assert');
const audit = require('../lib/audit.js');

const NOW = new Date('2026-08-11T12:00:00Z').getTime();
const at = h => new Date(NOW - h * 3600000).toISOString();

test('filing a round reads as filing a round', () => {
  const e = audit.entriesFor(
    { tu: { r: 2, st: 'done' } },
    { id: 'c1', name: 'A', tu: { r: 1, st: 'ready' } },
    { who: 'Marta', at: at(1) });
  assert.equal(e.length, 1);
  assert.equal(e[0].action, 'round_filed');
  assert.equal(e[0].who, 'Marta');
  assert.equal(e[0].clientName, 'A');
});

test('completing a client is distinguished from any other stage move', () => {
  const done = audit.entriesFor({ stage: 'Completed' }, { stage: 'In rounds' }, { who: 'X' });
  assert.equal(done[0].action, 'client_completed');
  const moved = audit.entriesFor({ stage: 'In rounds' }, { stage: 'Ready' }, { who: 'X' });
  assert.equal(moved[0].action, 'stage_moved');
});

test('a save with nothing changed logs nothing', () => {
  // Opening a drawer and closing it would otherwise inflate everybody's count.
  const e = audit.entriesFor(
    { stage: 'Ready', tu: { r: 1, st: 'ready' } },
    { stage: 'Ready', tu: { r: 1, st: 'ready' } },
    { who: 'X' });
  assert.deepEqual(e, []);
});

test('a note always logs, since there is no previous value to compare', () => {
  const e = audit.entriesFor({ note: 'called them' }, { id: 'c1' }, { who: 'X' });
  assert.equal(e.length, 1);
  assert.equal(e[0].action, 'note_added');
});

test('passwords never reach the log', () => {
  // cfpb carries portal logins and passwords. The action is recorded; the
  // values are not -- an audit file is not a place to copy credentials into.
  const e = audit.entriesFor(
    { cfpb: [{ round: 1, pw: 'hunter2', login: 'someone@example.com' }] },
    { id: 'c1', cfpb: [] }, { who: 'X' });
  assert.equal(e[0].action, 'cfpb_updated');
  assert.equal(e[0].to, undefined);
  assert.ok(!JSON.stringify(e).includes('hunter2'));
});

test('only small scalar fields keep their before and after', () => {
  const stage = audit.entriesFor({ stage: 'Completed' }, { stage: 'Ready' }, { who: 'X' })[0];
  assert.equal(stage.from, 'Ready');
  assert.equal(stage.to, 'Completed');
  const docs = audit.entriesFor({ docs: { DL: true } }, { docs: { DL: false } }, { who: 'X' })[0];
  assert.equal(docs.to, undefined, 'a docs object would bloat the log without adding meaning');
});

test('throughput counts work, not clicks', () => {
  const entries = [
    { at: at(1), who: 'Marta', clientId: 'a', action: 'round_filed' },
    { at: at(2), who: 'Marta', clientId: 'b', action: 'round_filed' },
    { at: at(3), who: 'Marta', clientId: 'a', action: 'note_added' },
    { at: at(4), who: 'Sam', clientId: 'c', action: 'client_completed' }
  ];
  const t = audit.throughput(entries, { now: NOW, days: 30 });
  const marta = t.people.find(p => p.who === 'Marta');
  assert.equal(marta.roundsFiled, 2);
  assert.equal(marta.notes, 1);
  assert.equal(marta.clientsTouched, 2, 'two clients, three actions');
  assert.equal(t.totals.roundsFiled, 2);
  assert.equal(t.totals.completed, 1);
});

test('anything older than the window is left out', () => {
  const t = audit.throughput([
    { at: at(1), who: 'A', action: 'round_filed' },
    { at: at(24 * 40), who: 'A', action: 'round_filed' }
  ], { now: NOW, days: 30 });
  assert.equal(t.totals.actions, 1);
});

test('the log says how far back it goes', () => {
  // An empty week must not read as a quiet week when the truth is that logging
  // only started on Tuesday.
  const t = audit.throughput([{ at: at(5), who: 'A', action: 'note_added' }], { now: NOW });
  assert.equal(t.totals.oldestEntry, at(5));
});

test('the log is capped, newest kept', () => {
  const many = Array.from({ length: audit.MAX_ENTRIES + 500 }, (_, i) => ({
    at: new Date(NOW - i * 60000).toISOString(), who: 'A', action: 'note_added'
  }));
  const kept = audit.trim(many);
  assert.equal(kept.length, audit.MAX_ENTRIES);
  assert.equal(kept[0].at, many[0].at, 'newest first');
});

test('every production edit is logged, with a snapshot taken first', () => {
  // Logging the submitted patch instead of the diff would record "changed
  // stage to Ready" every time somebody saved a drawer that was already Ready.
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const patch = src.split("app.patch('/api/production/:id'")[1].split('\n});')[0];
  assert.ok(/readOneProdRecord\(req\.params\.id\)[\s\S]*appendAudit/.test(patch),
    'the before-state must be read before the write, then logged');
  const dispute = src.split("app.patch('/api/disputes/:id'")[1].split('\n});')[0];
  assert.ok(/appendAudit/.test(dispute), 'dispute edits are work too');
});

test('an audit failure can never fail the edit it is recording', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const patch = src.split("app.patch('/api/production/:id'")[1].split('\n});')[0];
  assert.ok(/try \{[\s\S]*appendAudit[\s\S]*catch/.test(patch),
    'the log is a record of work, not a gate on it');
});

test('the assignee list is real accounts, not names from a spreadsheet', () => {
  // It was four hardcoded names, so assignment pointed at people with no
  // account -- the disputer "Mine" tab matches on the signed-in name and could
  // never match, and the operations view had nobody to report on.
  const fs = require('fs');
  const path = require('path');
  const prod = fs.readFileSync(path.join(__dirname, '..', 'public', 'production.js'), 'utf8');
  const code = prod.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/VAS=\['Antoinette'/.test(code), 'the hardcoded roster should be gone');
  assert.ok(/fetch\('\/api\/users'\)/.test(code), 'it should come from the accounts');
  assert.ok(/legacy/.test(prod), 'a name already on a record must not be orphaned');
});

test('a message sent is attributed, like any other piece of work', () => {
  // Sending was recorded as a volume event with no author, so "messages sent"
  // could not be broken down per person -- which is half of what a VA does.
  const e = audit.actionEntry('message_sent', { who: 'Marta', clientId: 'c1' });
  assert.equal(e.action, 'message_sent');
  assert.equal(e.who, 'Marta');
  assert.equal(e.clientId, 'c1');
});

test('throughput reports the columns that describe each job', () => {
  const t = audit.throughput([
    { at: new Date().toISOString(), who: 'Marta', clientId: 'a', action: 'round_filed' },
    { at: new Date().toISOString(), who: 'Marta', clientId: 'b', action: 'message_sent' },
    { at: new Date().toISOString(), who: 'Marta', clientId: 'c', action: 'stage_moved' },
    { at: new Date().toISOString(), who: 'Sam', clientId: 'd', action: 'client_completed' }
  ], { days: 30 });
  const m = t.people.find(p => p.who === 'Marta');
  assert.equal(m.roundsFiled, 1);
  assert.equal(m.messages, 1);
  assert.equal(m.stageMoves, 1);
  assert.equal(m.clientsTouched, 3);
  assert.equal(t.totals.messages, 1);
  assert.equal(t.totals.stageMoves, 1);
});

test('both send paths are attributed, not just one', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const route of ["app.post('/api/clients/:id/sms'", "app.post('/api/messages/:id/reply'"]) {
    const body = src.split(route)[1].split('\n});')[0];
    assert.ok(/appendAudit/.test(body), route + ' should attribute the send');
  }
});
