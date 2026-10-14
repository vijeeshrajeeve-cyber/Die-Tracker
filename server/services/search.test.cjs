'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('./search.cjs');

test('normaliseQuery trims and rejects anything under two characters', () => {
  assert.equal(search.normaliseQuery('  D-12 '), 'D-12');
  assert.equal(search.normaliseQuery(' a '), null);
  assert.equal(search.normaliseQuery('   '), null);
  assert.equal(search.normaliseQuery(undefined), null);
  assert.equal(search.normaliseQuery(['ab']), null);
});

test('LIKE metacharacters are escaped so die nos like 30533_201 match literally', () => {
  assert.equal(search.escapeLike('30533_201'), '30533\\_201');
  assert.equal(search.escapeLike('50%\\x'), '50\\%\\\\x');
  assert.equal(search.containsPattern('a_b'), '%a\\_b%');
  assert.equal(search.prefixPattern('a%b'), 'a\\%b%');
});

test('matchClause and rankClause only ever reference bound parameters', () => {
  assert.equal(search.matchClause(['die_no', 'order_no']), '(die_no ILIKE $1 OR order_no ILIKE $1)');
  assert.equal(
    search.rankClause({ fields: ['die_no', 'supplier'], primary: ['die_no'] }),
    'CASE WHEN lower(die_no) = $2 THEN 0 WHEN die_no ILIKE $3 OR supplier ILIKE $3 THEN 1 ELSE 2 END',
  );
});

const order = (id, fields, created_at = '2026-01-01') => ({ id, created_at, ...fields });

test('exact beats prefix beats contains, regardless of age', () => {
  const rows = [
    order(1, { die_no: 'X-D12-9' }, '2026-09-01'),  // contains
    order(2, { die_no: 'D12-77' }, '2026-08-01'),   // prefix
    order(3, { order_no: 'd12' }, '2025-01-01'),    // exact on a primary field, oldest
  ];
  const ranked = search.rankRows(rows, 'D12', search.ORDER_SEARCH);
  assert.deepEqual(ranked.map(r => r.row.id), [3, 2, 1]);
  assert.deepEqual(ranked.map(r => r.matchedField), ['order_no', 'die_no', 'die_no']);
});

test('an exact match on a non-primary field only counts as a prefix match', () => {
  const rows = [order(1, { supplier: 'ALPHA' }, '2026-09-01'), order(2, { die_no: 'ALPHA' }, '2025-01-01')];
  assert.deepEqual(search.rankRows(rows, 'alpha', search.ORDER_SEARCH).map(r => r.row.id), [2, 1]);
});

test('ties break newest first, then by id', () => {
  const rows = [
    order(1, { supplier: 'BETA' }, '2026-01-01'),
    order(2, { supplier: 'BETA' }, '2026-05-01'),
    order(3, { supplier: 'BETA' }, '2026-05-01'),
  ];
  assert.deepEqual(search.rankRows(rows, 'bet', search.ORDER_SEARCH).map(r => r.row.id), [3, 2, 1]);
});

test('null fields and unparseable dates do not throw', () => {
  const rows = [order(1, { die_no: null, supplier: 'GAMMA' }, null), order(2, { die_no: 'GAMMA-1' }, 'not a date')];
  assert.deepEqual(search.rankRows(rows, 'gamma', search.ORDER_SEARCH).map(r => r.row.id), [2, 1]);
});

test('rows that do not actually match are dropped, and the result is capped at 8', () => {
  const rows = Array.from({ length: 12 }, (_, i) => order(i + 1, { die_no: `D-${i}` }));
  rows.push(order(99, { die_no: 'ZZZ' }));
  const ranked = search.rankRows(rows, 'D-', search.ORDER_SEARCH);
  assert.equal(ranked.length, search.RESULT_CAP);
  assert.ok(ranked.every(r => r.row.id !== 99));
});

test('QD ranking uses qd_no / die_no as primary and raised_date for recency', () => {
  const rows = [
    { id: 1, qd_no: 'QD-25-031', raised_date: new Date('2025-03-01') },
    { id: 2, issue_summary: 'crack near qd-25-031 mark', raised_date: new Date('2026-03-01') },
  ];
  assert.deepEqual(search.rankRows(rows, 'qd-25-031', search.QD_SEARCH).map(r => r.row.id), [1, 2]);
});
