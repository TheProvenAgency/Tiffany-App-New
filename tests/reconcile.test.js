// GHL <-> Deal Production reconciliation: a GHL credit-repair client with no
// existing Deal Production record should be flagged to add; a Deal
// Production client matching no current GHL contact should be reported
// (never auto-created in GHL -- the old sheet import has no email/phone).
const { test } = require('node:test');
const assert = require('node:assert');
const a = require('../lib/affiliate');

test('isCreditRepairClient is true for a deal tag or a disputefox/client: tag, false otherwise', () => {
  assert.equal(a.isCreditRepairClient({ deal: 'full-repair', tags: [] }), true);
  assert.equal(a.isCreditRepairClient({ tags: ['disputefox client'] }), true);
  assert.equal(a.isCreditRepairClient({ tags: ['client:credit-repair'] }), true);
  assert.equal(a.isCreditRepairClient({ tags: ['status:active'] }), false);
  assert.equal(a.isCreditRepairClient({ tags: [] }), false);
});

test('a GHL credit-repair client with no matching Deal Production record is flagged to add', () => {
  const ghl = [{ id: 'g1', name: 'Jennifer Upshaw', email: 'jupshaw84@yahoo.com', tags: ['disputefox client'] }];
  const prod = [{ id: 'C1', name: 'Brittany C.' }]; // unrelated existing record
  const { toAdd } = a.reconcileProduction(ghl, prod);
  assert.equal(toAdd.length, 1);
  assert.equal(toAdd[0].id, 'g1');
});

test('a GHL client already tracked by ghlId is not re-added', () => {
  const ghl = [{ id: 'g1', name: 'Jennifer Upshaw', tags: ['disputefox client'] }];
  const prod = [{ id: 'G1', ghlId: 'g1', name: 'Jennifer Upshaw' }];
  const { toAdd } = a.reconcileProduction(ghl, prod);
  assert.equal(toAdd.length, 0);
});

test('a GHL client matching an existing sheet record by first-name + last-initial is not re-added', () => {
  const ghl = [{ id: 'g1', name: 'Brittany Carter', tags: ['disputefox client'] }];
  const prod = [{ id: 'C1', name: 'Brittany C.' }]; // old sheet's redacted format
  const { toAdd } = a.reconcileProduction(ghl, prod);
  assert.equal(toAdd.length, 0, 'first name + last initial already matches "Brittany C."');
});

test('a GHL contact with no credit-repair signal at all is not flagged', () => {
  const ghl = [{ id: 'g1', name: 'Random Lead', tags: ['status:active'] }]; // no deal tag, no disputefox/client: tag
  const { toAdd } = a.reconcileProduction(ghl, []);
  assert.equal(toAdd.length, 0);
});

test('a Deal Production client matching no current GHL contact is reported as notInGhl', () => {
  const ghl = [{ id: 'g1', name: 'Someone Else', tags: ['disputefox client'] }];
  const prod = [{ id: 'C1', name: 'Brittany C.' }];
  const { notInGhl } = a.reconcileProduction(ghl, prod);
  assert.equal(notInGhl.length, 1);
  assert.equal(notInGhl[0].id, 'C1');
});

test('a Deal Production client tracked by ghlId that no longer appears in GHL is reported', () => {
  const prod = [{ id: 'G1', ghlId: 'g1', name: 'Jennifer Upshaw' }];
  const { notInGhl } = a.reconcileProduction([], prod);
  assert.equal(notInGhl.length, 1);
  assert.equal(notInGhl[0].id, 'G1');
});

test('a matched Deal Production client is not reported as notInGhl', () => {
  const ghl = [{ id: 'g1', name: 'Brittany Carter', tags: ['disputefox client'] }];
  const prod = [{ id: 'C1', name: 'Brittany C.' }];
  const { notInGhl } = a.reconcileProduction(ghl, prod);
  assert.equal(notInGhl.length, 0);
});
