import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  ORDER_FILE_SLOTS, ORDER_FILE_MAX_BYTES, orderFileProblem, planFileChanges, fileChangeNeedsReason, bySlot,
} from './orderFiles.js';

const server = createRequire(import.meta.url)('../../server/services/orderFiles.cjs');

const pdf = (name, size = 1000) => ({ name, size });

// Two copies of the slots and limits, one ESM for Vite and one CommonJS for the
// server. These checks are what stop them drifting.
test('the client and server copies agree on slots, size limit and file type', () => {
  assert.deepEqual({ ...ORDER_FILE_SLOTS }, { ...server.SLOTS });
  assert.equal(ORDER_FILE_MAX_BYTES, server.MAX_FILE_BYTES);
  for (const name of ['a.pdf', 'B.PDF', 'c.dwg', 'd.jpg', 'noext', 'e.pdf.exe']) {
    assert.equal(orderFileProblem(pdf(name)) === null, server.isAllowedExtension(name), name);
  }
});

test('a picked file must be a PDF within the size limit', () => {
  assert.equal(orderFileProblem(pdf('form.pdf')), null);
  assert.match(orderFileProblem(pdf('design.dwg')), /PDF/);
  assert.match(orderFileProblem(pdf('big.pdf', ORDER_FILE_MAX_BYTES + 1)), /too large \(max 25 MB\)/);
  assert.equal(orderFileProblem(pdf('edge.pdf', ORDER_FILE_MAX_BYTES)), null);
});

test('only staged slots become changes, in slot order, attached or replaced', () => {
  const current = { design_pdf: { id: 3, original_name: 'rev A.pdf' } };
  const staged = { design_pdf: pdf('rev B.pdf'), die_order_form: pdf('form.pdf') };
  assert.deepEqual(planFileChanges(current, staged), [
    { slot: 'die_order_form', label: 'Die Order Form', kind: 'attached', before: null, after: 'form.pdf' },
    { slot: 'design_pdf', label: 'Die Design PDF', kind: 'replaced', before: 'rev A.pdf', after: 'rev B.pdf' },
  ]);
  assert.deepEqual(planFileChanges(current, {}), []);
});

test('replacing needs a reason and attaching does not, as the server decides', () => {
  const [attached, replaced] = planFileChanges(
    { design_pdf: { original_name: 'old.pdf' } },
    { die_order_form: pdf('form.pdf'), design_pdf: pdf('new.pdf') },
  );
  assert.equal(fileChangeNeedsReason(attached), false);
  assert.equal(fileChangeNeedsReason(replaced), true);
  assert.doesNotThrow(() => server.planUpload({ slot: 'die_order_form', current: null, fileName: 'form.pdf', reason: null }));
  assert.throws(() => server.planUpload({ slot: 'design_pdf', current: { original_name: 'old.pdf' }, fileName: 'new.pdf', reason: null }));
});

test('bySlot keys the listed files by slot', () => {
  const files = [{ id: 1, slot: 'design_pdf' }, { id: 2, slot: 'die_order_form' }];
  assert.deepEqual(bySlot(files), { design_pdf: files[0], die_order_form: files[1] });
  assert.deepEqual(bySlot(undefined), {});
});
