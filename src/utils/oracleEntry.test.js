import test from 'node:test';
import assert from 'node:assert/strict';
import { isTooling, nextStatusAfter, designToEmsSince, toOracleDie, buildOracleBatch, batchSummary, ORACLE_BATCH_MARK } from './oracleEntry.js';

test('a tooling is order type T, whatever its case or padding', () => {
  assert.equal(isTooling({ TYPE: 'T' }), true);
  assert.equal(isTooling({ TYPE: ' t ' }), true);
  assert.equal(isTooling({ TYPE: 'N' }), false);
  assert.equal(isTooling({ TYPE: null }), false);
  assert.equal(isTooling({}), false);
});

test('completing PR sends a tooling straight to Design to EMS, a die to Oracle Entry', () => {
  assert.equal(nextStatusAfter({ TYPE: 'T' }, 'PENDING FOR PR'), 'PENDING FOR DESIGN TO EMS');
  assert.equal(nextStatusAfter({ TYPE: 'B' }, 'PENDING FOR PR'), 'PENDING FOR ORACLE ENTRY');
  assert.equal(nextStatusAfter({ TYPE: 'T' }, 'PENDING FOR DESIGN APPROVAL'), 'PENDING FOR PR');
  assert.equal(nextStatusAfter({ TYPE: 'N' }, 'PENDING FOR ORACLE ENTRY'), 'PENDING FOR DESIGN TO EMS');
});

test('Design to EMS counts from Oracle entry, or from PR entry when Oracle was skipped', () => {
  assert.equal(designToEmsSince({ 'Oracle Entry': '2026-10-24', 'PR Entry': '2026-10-20' }), '2026-10-24');
  assert.equal(designToEmsSince({ 'Oracle Entry': null, 'PR Entry': '2026-10-20' }), '2026-10-20');
  assert.equal(designToEmsSince({ 'Oracle Entry': '', 'PR Entry': '' }), null);
});

// Die 30713-201 as the tracker held it in the 2026-10-24 screen recording.
const DIE_30713 = {
  'DIE NO': '30713-201', TYPE: 'B', Supplier: 'PHME', Press: 'P2', 'Die Size': '320X160',
  Cavity: 1, 'Die Type': 'HOLLOW', 'Ordered date': '2026-10-21', 'Mandrels per Cavity': 1,
};

test('a die becomes the values Dinesh typed into Oracle for it', () => {
  assert.deepEqual(toOracleDie(DIE_30713), { ok: true, die: {
    dieNo: '30713-201', profileId: '30713', dieIndex: '201', itemCode: 'GEX.DIE_30713_201',
    cavities: 1, diameter: 320, thickness: 160,
    supplier: 'PHME', supplierNames: ['PHME', 'PHOENIX MIDDLE EAST', 'ME PHOENIX'],
    dieType: 'Hollow', dieLife: 55, press: '2', orderedDate: '21-Oct-2026', flags: [],
  } });
});

test('a solid die gets 50 mT of die life', () => {
  const { die } = toOracleDie({ ...DIE_30713, 'Die Type': 'SOLID' });
  assert.equal(die.dieType, 'Solid');
  assert.equal(die.dieLife, 50);
});

test('press codes become the press number Oracle lists', () => {
  const press = (Press) => toOracleDie({ ...DIE_30713, Press }).die.press;
  assert.equal(press('P7'), '7');
  assert.equal(press('P 4'), '4');
  assert.equal(press('P25'), '7'); // GEX 2 press 7's code
  assert.equal(press('P35'), '8');
  assert.equal(press('B'), '2');
  assert.equal(press('I'), '9');
});

test('a profile number keeps its leading zero, and the index is the part after the last dash', () => {
  const { die } = toOracleDie({ ...DIE_30713, 'DIE NO': '030724-701' });
  assert.equal(die.profileId, '030724');
  assert.equal(die.dieIndex, '701');
  assert.equal(die.itemCode, 'GEX.DIE_030724_701');
});

test('what the tracker does not know is flagged, not guessed', () => {
  const { die } = toOracleDie({ ...DIE_30713, 'Die Type': null, 'Die Size': 'N/A', Press: null, 'Ordered date': null, Supplier: 'UNKNOWN' });
  assert.equal(die.dieType, null);
  assert.equal(die.dieLife, null);
  assert.equal(die.diameter, null);
  assert.deepEqual(die.flags, ['die type missing', 'die size not readable', 'press missing', 'ordered date missing', 'supplier missing']);
});

test('ordered dates in day-first form are read too', () => {
  assert.equal(toOracleDie({ ...DIE_30713, 'Ordered date': '21/10/2026' }).die.orderedDate, '21-Oct-2026');
  assert.equal(toOracleDie({ ...DIE_30713, 'Ordered date': '2026-10-21T00:00:00.000Z' }).die.orderedDate, '21-Oct-2026');
});

test('toolings and die numbers Oracle cannot take are left out with a reason', () => {
  assert.deepEqual(toOracleDie({ ...DIE_30713, 'DIE NO': 'INS-30713', TYPE: 'T' }), { ok: false, reason: 'tooling — not an Oracle asset' });
  assert.deepEqual(toOracleDie({ ...DIE_30713, 'DIE NO': '19803-606 IN MN' }), { ok: false, reason: 'die number is not <profile>-<index>' });
  assert.deepEqual(toOracleDie({ ...DIE_30713, 'DIE NO': '30713' }), { ok: false, reason: 'die number is not <profile>-<index>' });
});

test('a batch is marked text the Fill die bookmark recognises, with the left-out dies listed', () => {
  const batch = buildOracleBatch([DIE_30713, { ...DIE_30713, 'DIE NO': 'BOL 2-2-A', TYPE: 'T' }]);
  assert.equal(batch.dies.length, 1);
  assert.deepEqual(batch.skipped, [{ dieNo: 'BOL 2-2-A', reason: 'tooling — not an Oracle asset' }]);
  assert.ok(batch.text.startsWith(`${ORACLE_BATCH_MARK}\n`));
  assert.deepEqual(JSON.parse(batch.text.slice(ORACLE_BATCH_MARK.length + 1)), batch.dies);
});

test('the copy message says how many dies went into the batch and which were left out', () => {
  assert.equal(batchSummary(buildOracleBatch([DIE_30713])), 'Copied 1 die for Oracle. In Oracle, click Fill die and paste.');
  assert.equal(
    batchSummary(buildOracleBatch([DIE_30713, { ...DIE_30713, 'DIE NO': '32148-401', 'Die Type': null }, { ...DIE_30713, 'DIE NO': 'INS-30713', TYPE: 'T' }])),
    'Copied 2 dies for Oracle (1 to check: 32148-401). Left out: INS-30713 (tooling — not an Oracle asset). In Oracle, click Fill die and paste.',
  );
  assert.equal(batchSummary(buildOracleBatch([])), 'No dies selected.');
});
