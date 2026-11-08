'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formPaths, recordForm, ensureToolingRows } = require('./newDieOrderForms.cjs');

const SQUARE = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const HOLE = [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]];
const PROFILE = {
  style: 'silhouette', outer_unit: SQUARE, holes_unit: [HOLE], hole_count: 1, true_size: true,
  outer_mm: SQUARE.map(([x, y]) => [x * 10, y * 10]), holes_mm: [HOLE.map(([x, y]) => [x * 10, y * 10])], ccd_mm: 28.28,
  true_size_source: 'pdf-scale', true_size_confidence: 'confirmed', needs_review: true, review_reason: 'thin wall',
};

// A fake pg client: records every query; `known` is the toolings master.
function fakeClient({ known = [], failOn = null } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (failOn && failOn.test(sql)) throw new Error('boom');
      if (/^INSERT INTO new_die_order_forms/.test(sql)) return { rows: [{ id: 41, die_no: params[1], profile_shape_id: null }], rowCount: 1 };
      if (/^INSERT INTO profile_shapes/.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
      if (/^UPDATE new_die_order_forms SET profile_shape_id/.test(sql)) return { rows: [{ id: params[1], profile_shape_id: params[0] }], rowCount: 1 };
      if (/^SELECT number FROM toolings WHERE number = ANY/.test(sql)) {
        return { rows: known.filter((k) => params[0].includes(k.number)).map((k) => ({ number: k.number })) };
      }
      if (/^SELECT number, kind FROM toolings/.test(sql)) return { rows: known };
      if (/^INSERT INTO toolings/.test(sql)) { known.push({ number: params[0], kind: params[1] }); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 1 };
    },
  };
}

const BASE = {
  user: { id: 5 }, plant: 'GEX 01', dieNo: '31234_001', profileNumber: '31234', customer: 'ACME', press: 'PRESS 5',
  dieSize: '250X160', cavities: 2,
  values: { PLANT: 'GEX 1', DIE_NO: '31234_001', INSERT_NO: 'I-21599', BOLSTER_NO: '', HOLLOW: true, SOLID: false },
  chosen: { tooling: 'I-21599', kind: 'insert', fromFinder: true }, candidates: [{ number: 'I-21599', score: 0.9 }],
  profile: PROFILE, drawingPath: 'new-die-orders/gex-1/31234_001-1-drawing.pdf', formPdfPath: 'new-die-orders/gex-1/31234_001-1-form.pdf',
  drawingSha: 'abc123',
};

const firstLine = (sql) => sql.trim().split('\n')[0].trim();

test('formPaths puts both files under new-die-orders/<plant-slug> with a sanitised die number', () => {
  assert.deepEqual(formPaths({ plant: 'GEX 01', dieNo: '31234/001 x', stamp: 1700 }), {
    drawingPath: 'new-die-orders/gex-1/31234_001_x-1700-drawing.pdf',
    formPdfPath: 'new-die-orders/gex-1/31234_001_x-1700-form.pdf',
  });
  assert.equal(formPaths({ plant: 'gex 2', dieNo: '../../etc', stamp: 1 }).drawingPath, 'new-die-orders/gex-2/______etc-1-drawing.pdf');
});

test('recordForm writes the form, the profile-drawing shape and the links in one transaction', async () => {
  const client = fakeClient({ known: [{ number: 'I-21599', kind: 'insert' }] });
  const row = await recordForm(client, BASE);
  const sqls = client.calls.map((c) => firstLine(c.sql));
  assert.equal(sqls[0], 'BEGIN');
  assert.equal(sqls[sqls.length - 1], 'COMMIT');
  assert.ok(!sqls.includes('ROLLBACK'));
  assert.deepEqual(row, { id: 41, profile_shape_id: 77 });

  const form = client.calls.find((c) => /^INSERT INTO new_die_order_forms/.test(c.sql));
  assert.deepEqual(form.params.slice(0, 7), ['GEX 1', '31234_001', '31234', 'ACME', 'PRESS 5', '250X160', 2]);
  assert.deepEqual(JSON.parse(form.params[7]), BASE.values);
  assert.deepEqual(form.params.slice(8, 11), ['I-21599', 'insert', true]);
  assert.deepEqual(JSON.parse(form.params[11]), BASE.candidates);
  assert.deepEqual(form.params.slice(12), [BASE.drawingPath, BASE.formPdfPath, 5]);

  const shape = client.calls.find((c) => /^INSERT INTO profile_shapes/.test(c.sql));
  assert.match(shape.sql, /WHERE profile_shapes\.reviewed_at IS NULL/);
  const p = shape.params;
  assert.deepEqual(p.slice(0, 8), ['31234_001', 'GEX 1', '31234', 'profile-drawing', '41', 'abc123', BASE.drawingPath, 'silhouette']);
  assert.deepEqual(JSON.parse(p[8]), SQUARE);
  assert.deepEqual(JSON.parse(p[9]), [HOLE]);
  assert.equal(JSON.parse(p[10]).length, 24, 'signature computed server-side');
  assert.equal(p[11], 1);
  assert.equal(p[12], 2);
  assert.equal(p[13], 'Hollow');
  assert.ok(Math.abs(p[14] - 1) < 1e-9, 'square aspect 1');
  assert.ok(p[15] > 0 && p[15] <= 1);
  assert.equal(p[16], true);
  assert.deepEqual(JSON.parse(p[17]), PROFILE.outer_mm);
  assert.equal(p[19], 28.28);
  assert.deepEqual(p.slice(20), ['pdf-scale', 'confirmed', true, 'thin wall']);

  const update = client.calls.find((c) => /^UPDATE new_die_order_forms/.test(c.sql));
  assert.deepEqual(update.params, [77, 41]);

  const del = client.calls.find((c) => /^DELETE FROM die_tooling_links/.test(c.sql));
  assert.equal(del.sql, "DELETE FROM die_tooling_links WHERE source = 'new-order-form' AND die_no = $1");
  assert.deepEqual(del.params, ['31234_001']);
  const link = client.calls.find((c) => /^INSERT INTO die_tooling_links/.test(c.sql));
  assert.deepEqual(link.params, ['31234_001', 'GEX 1', 'I-21599', 'insert', 'I-21599', 'new-order-form']);
  assert.ok(!client.calls.some((c) => /^INSERT INTO toolings/.test(c.sql)), 'a known number adds no tooling');
});

test('unknown typed number becomes unverified and linked', async () => {
  const client = fakeClient({ known: [] });
  await recordForm(client, {
    ...BASE, values: { ...BASE.values, INSERT_NO: 'i 99999', BOLSTER_NO: 'see drawing' }, chosen: null, profile: null,
  });
  const ins = client.calls.filter((c) => /^INSERT INTO toolings/.test(c.sql));
  assert.equal(ins.length, 1, 'the unparseable bolster text adds no tooling');
  assert.match(ins[0].sql, /ON CONFLICT \(number\) DO NOTHING/);
  assert.match(ins[0].sql, /'order-form', 'unverified', '\{\}'/);
  assert.deepEqual(ins[0].params, ['I-99999', 'insert', 'GEX 1']);
  const link = client.calls.find((c) => /^INSERT INTO die_tooling_links/.test(c.sql));
  assert.deepEqual(link.params, [
    '31234_001', 'GEX 1', 'I-99999', 'insert', 'i 99999', 'new-order-form',
    '31234_001', 'GEX 1', null, 'unknown', 'see drawing', 'new-order-form',
  ]);
  assert.ok(!client.calls.some((c) => /profile_shapes/.test(c.sql)), 'no profile, no shape row');
  const form = client.calls.find((c) => /^INSERT INTO new_die_order_forms/.test(c.sql));
  assert.deepEqual(form.params.slice(8, 11), [null, null, false]);
});

test('a failing step rolls the whole form back', async () => {
  const client = fakeClient({ failOn: /^INSERT INTO die_tooling_links/ });
  await assert.rejects(() => recordForm(client, BASE), /boom/);
  const sqls = client.calls.map((c) => firstLine(c.sql));
  assert.equal(sqls[sqls.length - 1], 'ROLLBACK');
  assert.ok(!sqls.includes('COMMIT'));
});

test('ensureToolingRows skips known, blank and unparseable numbers', async () => {
  const client = fakeClient({ known: [{ number: 'BOL-12', kind: 'bolster' }] });
  const added = await ensureToolingRows(client, {
    plant: 'GEX 2',
    numbers: [{ raw: 'BOL 12', kind: 'bolster' }, { raw: '', kind: 'insert' }, { raw: '35IC2-7', kind: 'insert' }, { raw: 'n/a', kind: 'insert' }],
  });
  assert.deepEqual(added, ['35IC2-7']);
  const ins = client.calls.filter((c) => /^INSERT INTO toolings/.test(c.sql));
  assert.deepEqual(ins.map((c) => c.params), [['35IC2-7', 'insert', 'GEX 2']]);
});
