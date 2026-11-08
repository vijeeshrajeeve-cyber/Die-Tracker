'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resetDrawingDerivedFields, restoreParams } = require('./reset-drawing-derived-fields.cjs');

function fakeClient(current = []) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/^SELECT number, size_class/.test(sql)) return { rows: current.filter((r) => params[0].includes(r.number)), rowCount: 0 };
      if (/^UPDATE toolings SET\s+size_class = \$2/.test(sql)) return { rows: [], rowCount: current.some((r) => r.number === params[0]) ? 1 : 0 };
      if (/WHERE source = 'drawing-archive'/.test(sql)) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    },
  };
}

const exported = { toolings: [
  { number: 'I-21599', size_class: '175X80', size_class_source: 'inventory', size_class_confidence: 'confirmed', cavities: 1 },
  { number: 'I-00001', size_class: null, size_class_source: null, size_class_confidence: null, cavities: null },
] };

test('restores the exported values exactly, NULLs included', async () => {
  const client = fakeClient([
    { number: 'I-21599', size_class: '175X80', size_class_source: 'inventory', size_class_confidence: 'confirmed', cavities: 1 },
    { number: 'I-00001', size_class: '300X100', size_class_source: 'drawing', size_class_confidence: 'likely', cavities: 2 },
  ]);
  const counts = await resetDrawingDerivedFields(client, exported);
  const ups = client.calls.filter((c) => /^UPDATE toolings SET\s+size_class = \$2/.test(c.sql));
  assert.deepEqual(ups.map((u) => u.params), [
    ['I-21599', '175X80', 'inventory', 'confirmed', 1, false],
    ['I-00001', null, null, null, null, false],
  ]);
  assert.match(ups[0].sql, /WHERE number = \$1$/);
  assert.deepEqual(counts, { exported: 2, restoreMatched: 2, restoreChanged: 1, drawingArchiveCleared: 3 });
  assert.equal(client.calls[0].sql, 'BEGIN');
  assert.equal(client.calls[client.calls.length - 1].sql, 'COMMIT');
});

test('drawing-archive rows outside the export are NULLed, and only those four fields', async () => {
  const client = fakeClient();
  await resetDrawingDerivedFields(client, exported);
  const clear = client.calls.find((c) => /WHERE source = 'drawing-archive'/.test(c.sql));
  assert.match(clear.sql, /SET size_class = NULL, size_class_source = NULL, size_class_confidence = NULL, cavities = NULL/);
  assert.match(clear.sql, /WHERE source = 'drawing-archive' AND NOT \(number = ANY\(\$1\)\)/);
  assert.deepEqual(clear.params, [['I-21599', 'I-00001']]);
  for (const c of client.calls) {
    assert.doesNotMatch(c.sql, /\bstatus\b/);
    assert.doesNotMatch(c.sql, /\bDELETE\b/i);
  }
});

test('dry run rolls back', async () => {
  const client = fakeClient();
  await resetDrawingDerivedFields(client, exported, { dryRun: true });
  assert.equal(client.calls[client.calls.length - 1].sql, 'ROLLBACK');
  assert.ok(!client.calls.some((c) => c.sql === 'COMMIT'));
});

test('an error rolls back and rethrows; an empty export is refused', async () => {
  const client = fakeClient();
  const orig = client.query;
  client.query = async (sql, p) => { if (/drawing-archive/.test(sql)) throw new Error('boom'); return orig(sql, p); };
  await assert.rejects(resetDrawingDerivedFields(client, exported), /boom/);
  assert.equal(client.calls[client.calls.length - 1].sql, 'ROLLBACK');
  await assert.rejects(resetDrawingDerivedFields(fakeClient(), { toolings: [] }), /no toolings/);
});

test('an export without source/confidence: a NULL size class restores NULLs, a set one keeps the current source', () => {
  assert.deepEqual(restoreParams({ number: 'A', size_class: null, cavities: null }), ['A', null, null, null, null, false]);
  assert.deepEqual(restoreParams({ number: 'B', size_class: '475X220', cavities: 2 }), ['B', '475X220', null, null, 2, true]);
});
