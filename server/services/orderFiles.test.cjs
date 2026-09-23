'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const f = require('./orderFiles.cjs');

test('the drawer has two slots, each with the label the change log shows', () => {
  assert.deepEqual(f.SLOTS, { die_order_form: 'Die Order Form', design_pdf: 'Die Design PDF' });
});

test('only PDFs are accepted', () => {
  assert.equal(f.isAllowedExtension('Order form.PDF'), true);
  assert.equal(f.isAllowedExtension('design.pdf'), true);
  assert.equal(f.isAllowedExtension('design.dwg'), false);
  assert.equal(f.isAllowedExtension('photo.jpg'), false);
  assert.equal(f.isAllowedExtension('noext'), false);
});

test('MAX_FILE_BYTES is 25 MB', () => {
  assert.equal(f.MAX_FILE_BYTES, 25 * 1024 * 1024);
});

test('buildStoredPath composes root/die/order/slot/stamp_name', () => {
  const root = path.join('/srv', 'order-files');
  const out = f.buildStoredPath(root, {
    dieNo: '30533_201', orderId: 7, slot: 'design_pdf', stamp: 1758600000000, fileName: 'Die design rev B.pdf',
  });
  assert.equal(out, path.join(root, '30533_201', '7', 'design_pdf', '1758600000000_Die_design_rev_B.pdf'));
});

test('buildStoredPath cannot be escaped by a traversal die number or filename', () => {
  const root = path.resolve('/srv/order-files');
  const out = f.buildStoredPath(root, {
    dieNo: '../..', orderId: 1, slot: 'die_order_form', stamp: 1, fileName: '../../etc/passwd',
  });
  assert.equal(path.resolve(out).startsWith(root), true);
  const dots = f.buildStoredPath(root, { dieNo: '..', orderId: '..', slot: '..', stamp: 1, fileName: 'a.pdf' });
  assert.equal(path.resolve(dots).startsWith(root), true);
});

test('isInsideRoot accepts paths under the root, rejects escapes and look-alike siblings', () => {
  const root = path.resolve('/srv/order-files');
  assert.equal(f.isInsideRoot(root, path.join(root, 'a', 'd.pdf')), true);
  assert.equal(f.isInsideRoot(root, path.join(root, '..', 'd.pdf')), false);
  assert.equal(f.isInsideRoot(root, `${root}-evil${path.sep}d.pdf`), false);
  assert.equal(f.isInsideRoot(root, root), false);
});

test('getTmpDir sits directly under the storage root (same filesystem)', () => {
  assert.equal(f.getTmpDir(), path.join(f.getRoot(), '.uploads-tmp'));
});

test('a first file for a slot needs no reason and logs from blank', () => {
  assert.deepEqual(
    f.planUpload({ slot: 'die_order_form', current: null, fileName: 'form.pdf', reason: null }),
    { field: 'Die Order Form', oldValue: null, newValue: 'form.pdf', reason: null },
  );
});

test('replacing a file without a reason is refused, naming the slot', () => {
  assert.throws(
    () => f.planUpload({ slot: 'design_pdf', current: { original_name: 'old.pdf' }, fileName: 'new.pdf', reason: null }),
    (e) => e.code === 'REASON_REQUIRED' && e.status === 400 && e.fields[0] === 'Die Design PDF',
  );
});

test('replacing a file with a reason logs the old and new names', () => {
  assert.deepEqual(
    f.planUpload({ slot: 'design_pdf', current: { original_name: 'old.pdf' }, fileName: 'new.pdf', reason: 'Rev B' }),
    { field: 'Die Design PDF', oldValue: 'old.pdf', newValue: 'new.pdf', reason: 'Rev B' },
  );
});
