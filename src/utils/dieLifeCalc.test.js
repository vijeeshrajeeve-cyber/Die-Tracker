import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { calcDieLife, formatDieLife, rowErrors, calculatedFor, supplierKey } from './dieLifeCalc.js';

const require = createRequire(import.meta.url);
const server = require('../../server/services/supplierDieLife.cjs');

const B = { tonnageMt: null, diesScrapped: null, diesInService: null, diesFailed: null, newDiesReceived: null, newDieTrials: null, backupDiesReceived: null, backupDieTrials: null };
const row = (o) => ({ ...B, ...o });

const CASES = {
  empty: [],
  allBlank: [row({})],
  single: [row({ tonnageMt: 420, diesScrapped: 6, diesInService: 40, diesFailed: 5, newDiesReceived: 3, newDieTrials: 5, backupDiesReceived: 2, backupDieTrials: 2 })],
  noScrap: [row({ tonnageMt: 150, diesScrapped: 0 })],
  zeroRun: [row({ diesInService: 0, diesFailed: 0 })],
  tonnageOnly: [row({ tonnageMt: 100 })],
  scrapOnly: [row({ diesScrapped: 4 })],
  multi: [
    row({ tonnageMt: 100, diesScrapped: 2, diesInService: 10, diesFailed: 1, newDiesReceived: 4, newDieTrials: 6 }),
    row({ tonnageMt: 50, diesScrapped: 3, diesInService: 30, diesFailed: 3, backupDiesReceived: 2, backupDieTrials: 1 }),
    row({ tonnageMt: '70', diesScrapped: '0', diesInService: '5', newDiesReceived: '1', newDieTrials: '1' }),
  ],
  oneSidedPair: [row({ newDiesReceived: 5 }), row({ newDiesReceived: 2, newDieTrials: 3 })],
};

for (const [name, rows] of Object.entries(CASES)) {
  test(`calcDieLife matches the server: ${name}`, () => {
    assert.deepEqual(calcDieLife(rows), server.aggregateDieLife(rows));
  });
}

test('formatDieLife gives the three outputs', () => {
  assert.equal(formatDieLife(calcDieLife(CASES.single)), '70.0');
  assert.equal(formatDieLife(calcDieLife(CASES.noScrap)), 'no dies scrapped');
  assert.equal(formatDieLife(calcDieLife(CASES.allBlank)), 'not recorded');
});

test('rowErrors flags unloaded above run and trials without dies', () => {
  assert.deepEqual(rowErrors(row({ diesInService: 5, diesFailed: 6 })), { diesFailed: 'More dies unloaded than dies run' });
  assert.ok(rowErrors(row({ diesFailed: 1 })).diesFailed);
  assert.ok(rowErrors(row({ diesInService: 0, diesFailed: 0 })).diesFailed);
  assert.ok(rowErrors(row({ newDieTrials: 2 })).newDieTrials);
  assert.ok(rowErrors(row({ newDiesReceived: 0, newDieTrials: 2 })).newDieTrials);
  assert.ok(rowErrors(row({ backupDieTrials: 2 })).backupDieTrials);
  assert.deepEqual(rowErrors(CASES.single[0]), {});
  assert.deepEqual(rowErrors(row({})), {});
});

test('rowErrors agrees with the server validator', () => {
  const bad = [row({ diesFailed: 1 }), row({ diesInService: 5, diesFailed: 6 }), row({ newDieTrials: 1 }), row({ backupDieTrials: 1 }), row({ diesScrapped: 1.5 }), row({ tonnageMt: -1 })];
  for (const r of bad) {
    assert.ok(Object.keys(rowErrors(r)).length > 0);
    assert.throws(() => server.validateEntry({ supplier: 'X', ...r }));
  }
  for (const r of [CASES.single[0], row({}), row({ tonnageMt: 0, diesScrapped: 0 })]) {
    assert.deepEqual(rowErrors(r), {});
    assert.doesNotThrow(() => server.validateEntry({ supplier: 'X', ...r }));
  }
});

test('calculatedFor: All plants uses the server figures, one plant calculates live', () => {
  const pair = [row({ tonnageMt: 100 }), row({ diesScrapped: 4 })];
  const summed = { ...B, tonnageMt: 100, diesScrapped: 4 };
  const fromServer = server.aggregateDieLife(pair);
  assert.equal(fromServer.dieLife, null);
  // summing first would invent a number
  assert.equal(calcDieLife([summed]).dieLife, 25);
  assert.deepEqual(calculatedFor({ readOnly: true, row: { ...summed, calculated: fromServer }, counts: summed }), fromServer);
  assert.equal(calculatedFor({ readOnly: false, row: { ...summed, calculated: fromServer }, counts: summed }).dieLife, 25);
  assert.equal(calculatedFor({ readOnly: true, row: undefined, counts: B }).dieLife, null);
});

test('supplierKey ignores case and surrounding spaces', () => {
  assert.equal(supplierKey(' wefa '), supplierKey('WEFA'));
  assert.equal(supplierKey(null), '');
});
