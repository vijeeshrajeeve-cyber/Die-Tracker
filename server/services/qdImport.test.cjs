'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imp = require('./qdImport.cjs');

const TODAY = '2026-09-19';
const BASE = {
  qdNo: ' 2026ph-04 ', raisedDate: '2026-06-04', supplier: 'Phoenix', dieNo: '30601-201',
  plant: 'GEX 1', issue: 'Heavy blend on the profile.\nSecond paragraph.', status: 'Open',
  preparedBy: 'Veera', authorizedBy: 'Imran Mulla', recommendedAction: '',
};

// Just enough of pg for the import: records every call, knows which QD
// numbers and suppliers exist, and keeps qd_foc_rounds so the real
// updateStatus -> openFocRound -> recordReceipt path runs unmodified.
function fakeClient({ existingQdNos = [], suppliers = ['PHOENIX'], qdRow = null, files = [] } = {}) {
  const calls = [];
  const rounds = [];
  return {
    calls,
    rounds,
    async query(sql, params = []) {
      const s = String(sql);
      calls.push({ sql: s, params });
      if (s.includes('UPPER(qd_no)')) {
        const hit = existingQdNos.some((n) => n.toUpperCase() === String(params[0]).toUpperCase());
        return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
      }
      if (s.includes('FROM suppliers')) {
        const name = suppliers.find((n) => n.toUpperCase() === String(params[0]).toUpperCase());
        return { rows: name ? [{ name }] : [], rowCount: name ? 1 : 0 };
      }
      if (s.includes('INSERT INTO quality_discrepancies')) return { rows: [{ id: 42 }], rowCount: 1 };
      if (s.includes('SELECT imported FROM quality_discrepancies')) {
        return { rows: qdRow ? [qdRow] : [], rowCount: qdRow ? 1 : 0 };
      }
      if (s.includes('SELECT stored_path FROM quality_discrepancy_files')) return { rows: files, rowCount: files.length };
      if (s.includes('FROM qd_foc_rounds')) {
        const rows = rounds.filter((r) => r.qd_id === params[0]);
        return { rows, rowCount: rows.length };
      }
      if (s.includes('INSERT INTO qd_foc_rounds')) {
        rounds.push({ id: rounds.length + 1, qd_id: params[0], round_no: params[1], promised_eta: params[2],
          received_date: null, trial_date: null, trial_result: null });
        return { rows: [], rowCount: 1 };
      }
      if (s.includes('SET received_date')) {
        rounds.find((r) => r.id === params[2]).received_date = params[0];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const statusUpdates = (client) => client.calls
  .filter((c) => c.sql.includes('SET status = $1')).map((c) => c.params[0]);

test('validateImport trims, upper-cases the number and nulls dates the status does not use', () => {
  const f = imp.validateImport({ ...BASE, closedDate: '2026-06-20', etaDate: '2026-10-01' }, { today: TODAY });
  assert.equal(f.qdNo, '2026PH-04');
  assert.equal(f.status, 'Open');
  assert.equal(f.closedDate, null);
  assert.equal(f.etaDate, null);
  assert.equal(f.receivedDate, null);
  assert.equal(f.recommendedAction, null);
  assert.equal(f.preparedBy, 'Veera');
});

test('validateImport refuses each missing required field, as a client error', () => {
  for (const key of ['qdNo', 'raisedDate', 'supplier', 'dieNo', 'plant', 'issue']) {
    assert.throws(() => imp.validateImport({ ...BASE, [key]: '  ' }, { today: TODAY }),
      (e) => e.clientError === true && /required/.test(e.message), key);
  }
});

test('validateImport checks dates against today and the raised date', () => {
  const v = (extra) => () => imp.validateImport({ ...BASE, ...extra }, { today: TODAY });
  assert.throws(v({ raisedDate: '2026-09-20' }), /Date raised cannot be in the future/);
  assert.throws(v({ raisedDate: '04/06/2026' }), /Date raised must be a date/);
  assert.throws(v({ status: 'Closed' }), /Closed date is required/);
  assert.throws(v({ status: 'Closed', closedDate: '2026-06-01' }), /Closed date cannot be before/);
  assert.throws(v({ status: 'Rejected', closedDate: '2026-09-20' }), /Closed date cannot be in the future/);
  assert.throws(v({ status: 'FOC Accepted' }), /ETA is required/);
  // An ETA is a supplier's promise -- the future is exactly where it lives.
  assert.equal(v({ status: 'FOC Accepted', etaDate: '2026-12-01' })().etaDate, '2026-12-01');
  assert.throws(v({ status: 'FOC Received', etaDate: '2026-07-01' }), /Received date is required/);
  assert.throws(v({ status: 'FOC Received', etaDate: '2026-07-01', receivedDate: '2026-05-01' }), /Received date cannot be before/);
  assert.throws(v({ status: 'Paused' }), /Invalid status/);
});

test('a QD number already in the register is refused before anything is written', async () => {
  const client = fakeClient({ existingQdNos: ['2026PH-04'] });
  const f = imp.validateImport(BASE, { today: TODAY });
  await assert.rejects(imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'old.pdf' }),
    (e) => e.clientError === true && /2026PH-04 already exists/.test(e.message));
  assert.ok(!client.calls.some((c) => c.sql.includes('INSERT')));
});

test('an unknown supplier is refused', async () => {
  const client = fakeClient({ suppliers: [] });
  const f = imp.validateImport(BASE, { today: TODAY });
  await assert.rejects(imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'old.pdf' }),
    (e) => e.clientError === true && /Unknown supplier/.test(e.message));
});

test('a closed QD is inserted Approved, imported, with the paper dates and a back-dated raise', async () => {
  const client = fakeClient();
  const f = imp.validateImport({ ...BASE, status: 'Closed', closedDate: '2026-06-20' }, { today: TODAY });
  const id = await imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'old.pdf' });
  assert.equal(id, 42);

  const insert = client.calls.find((c) => c.sql.includes('INSERT INTO quality_discrepancies')).params;
  assert.equal(insert[0], '2026PH-04');
  assert.equal(insert[4], '2026-06-04');           // raised_date
  assert.equal(insert[6], 'PHOENIX');              // canonical name from the master
  assert.equal(insert[10], 'Heavy blend on the profile.'); // summary = first line
  assert.equal(insert[14], '2026-06-20');          // closed_at from the paper
  assert.equal(insert[15], 1);                     // created_by
  assert.equal(insert[16], 'Approved');
  assert.equal(insert[17], 'Veera');               // prepared_by from the form

  assert.ok(client.calls.some((c) => c.sql.includes('SET imported = TRUE') && c.params[0] === 42));
  const acts = client.calls.filter((c) => c.sql.includes('INSERT INTO quality_discrepancy_activity')).map((c) => c.params);
  assert.equal(acts[0][2], 'raised QD against die 30601-201');
  assert.equal(acts[0][1], 'Veera');
  assert.equal(acts[0][6], '2026-06-04 00:00:00');
  assert.match(acts[1][2], /imported from the original QD form old\.pdf · Authorized by Imran Mulla/);
  assert.deepEqual(statusUpdates(client), ['Closed']);
  assert.match(acts[2][2], /changed status to Closed — Status at import/);
});

test('an Open import changes no status', async () => {
  const client = fakeClient();
  await imp.insertImportedQd(client, imp.validateImport(BASE, { today: TODAY }), { actor: 'admin', userId: 1, fileName: 'a.pdf' });
  assert.deepEqual(statusUpdates(client), []);
});

test('FOC Received opens a round at the ETA, then records the receipt on it', async () => {
  const client = fakeClient();
  const f = imp.validateImport({ ...BASE, status: 'FOC Received', etaDate: '2026-07-15', receivedDate: '2026-07-20' }, { today: TODAY });
  await imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'a.pdf' });
  assert.deepEqual(statusUpdates(client), ['FOC Accepted', 'FOC Received']);
  assert.equal(client.rounds.length, 1);
  assert.equal(client.rounds[0].promised_eta, '2026-07-15');
  assert.equal(client.rounds[0].received_date, '2026-07-20');
});

test('attachOriginal stores the PDF under the original_form category', async () => {
  const client = fakeClient();
  await imp.attachOriginal(client, { qdId: 42, originalName: 'old.pdf', storedPath: '2026PH-04/42/old.pdf', mimeType: 'application/pdf', size: 10, userId: 1 });
  const ins = client.calls.find((c) => c.sql.includes('INSERT INTO quality_discrepancy_files'));
  assert.equal(ins.params[6], 'original_form');
  assert.equal(imp.ORIGINAL_FORM, 'original_form');
});

test('undo refuses a QD raised in the app and deletes nothing', async () => {
  const client = fakeClient({ qdRow: { imported: false } });
  await assert.rejects(imp.deleteImportedQd(client, 42), (e) => e.clientError === true && /Only an imported QD/.test(e.message));
  assert.ok(!client.calls.some((c) => c.sql.startsWith('DELETE')));
});

test('undo of a missing QD is not found', async () => {
  await assert.rejects(imp.deleteImportedQd(fakeClient(), 42), (e) => e.notFound === true);
});

test('undo of an imported QD deletes it and hands back its files', async () => {
  const client = fakeClient({ qdRow: { imported: true }, files: [{ stored_path: 'a/42/old.pdf' }, { stored_path: 'a/42/p.png' }] });
  assert.deepEqual(await imp.deleteImportedQd(client, 42), ['a/42/old.pdf', 'a/42/p.png']);
  const del = client.calls.find((c) => c.sql.startsWith('DELETE FROM quality_discrepancies'));
  assert.deepEqual(del.params, [42]);
});
