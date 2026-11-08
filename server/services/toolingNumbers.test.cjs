'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./toolingNumbers.cjs');

test('GEX-2 insert numbers carry plant, cavities and the die they were made for', () => {
  assert.deepEqual(m.parseToolingNumber('25IC2-110634'), { kind: 'insert', canonical: '25IC2-110634', plant: 'GEX 2', cavities: 2, madeForDie: '110634', raw: '25IC2-110634' });
  assert.equal(m.parseToolingNumber('35IC1-120021').cavities, 1);
  assert.equal(m.parseToolingNumber('35IC4-090462').cavities, 4);
  assert.deepEqual(m.parseToolingNumber(' 25IC2E ').canonical, '25IC2E');
  assert.equal(m.parseToolingNumber('25IC2E').madeForDie, null);
});

test('GEX-1 insert numbers normalise to I- plus five digits', () => {
  assert.equal(m.parseToolingNumber('I-05043').canonical, 'I-05043');
  assert.equal(m.parseToolingNumber('i-5043').canonical, 'I-05043', 'padded to five digits');
  assert.equal(m.parseToolingNumber('I 5043').canonical, 'I-05043');
  assert.equal(m.parseToolingNumber('05043').kind, 'unknown', 'a bare number is not assumed to be an insert');
  assert.equal(m.parseToolingNumber('I-12495').canonical, 'I-12495');
  assert.equal(m.parseToolingNumber('I-12495').madeForDie, '12495');
  assert.equal(m.parseToolingNumber('I-12495').plant, 'GEX 1');
  assert.equal(m.parseToolingNumber('I-2D').canonical, 'I-2D');
});

test('bolster codes normalise to BOL- prefix', () => {
  assert.equal(m.parseToolingNumber('BOL-4-6-A').canonical, 'BOL-4-6-A');
  assert.equal(m.parseToolingNumber('B-6-1-C').canonical, 'BOL-6-1-C');
  assert.equal(m.parseToolingNumber('bol 2-1-c').canonical, 'BOL-2-1-C');
  assert.equal(m.parseToolingNumber('BOL-4-6-A').kind, 'bolster');
  assert.equal(m.parseToolingNumber('BOL4-6-A').canonical, 'BOL-4-6-A');
  assert.equal(m.parseToolingNumber('b 6-1-c').canonical, 'BOL-6-1-C');
  for (const text of ['BLANK', 'BOTTOM', 'B12345']) assert.equal(m.parseToolingNumber(text).kind, 'unknown', text);
});

test('bare numbers and free text are unknown but keep the raw value', () => {
  assert.deepEqual(m.parseToolingNumber('15109'), { kind: 'unknown', canonical: null, plant: null, cavities: null, madeForDie: null, raw: '15109' });
  assert.equal(m.parseToolingNumber('2(=)').kind, 'unknown');
  assert.equal(m.parseToolingNumber('').kind, 'unknown');
  assert.equal(m.parseToolingNumber(null).raw, '');
});

test('size classes are uppercase X, no prefix, decimals kept, NO is null', () => {
  assert.equal(m.normalizeSizeClass('460x150'), '460X150');
  assert.equal(m.normalizeSizeClass(' 302.5 X 145 '), '302.5X145');
  assert.equal(m.normalizeSizeClass('∅355x200'), '355X200');
  assert.equal(m.normalizeSizeClass('Dia475X280'), '475X280');
  assert.equal(m.normalizeSizeClass('NO'), null);
  assert.equal(m.normalizeSizeClass(''), null);
  assert.equal(m.normalizeSizeClass(undefined), null);
  assert.equal(m.normalizeSizeClass('RING SIZE DIE'), 'RING SIZE DIE');
});

test('bare numbers resolve against the known master, unknown when ambiguous', () => {
  const known = { inserts: new Set(['I-15109', 'I-05043']), bolsters: new Set(['BOL-15109', 'BOL-302']) };
  assert.deepEqual(m.resolveToolingRef('302', known), { kind: 'bolster', toolingNumber: 'BOL-302', raw: '302' });
  assert.deepEqual(m.resolveToolingRef('5043', known), { kind: 'insert', toolingNumber: 'I-05043', raw: '5043' });
  assert.deepEqual(m.resolveToolingRef('15109', known), { kind: 'unknown', toolingNumber: null, raw: '15109' });
  assert.deepEqual(m.resolveToolingRef('I-12495', known), { kind: 'insert', toolingNumber: 'I-12495', raw: 'I-12495' });
  assert.deepEqual(m.resolveToolingRef('2(=)', known), { kind: 'unknown', toolingNumber: null, raw: '2(=)' });
});

test('GEX-2 inventory locations map to press names', () => {
  assert.equal(m.pressFromGex2Location('25MN'), 'PRESS 7');
  assert.equal(m.pressFromGex2Location('P35'), 'PRESS 8');
  assert.equal(m.pressFromGex2Location(''), null);
});

test('letter-variant inserts and BOL- bolsters stored by the inventory resolve against the master', () => {
  const known = {
    inserts: new Set(['35IC1A', '35IC1J-027555', 'AMBIG']),
    bolsters: new Set(['BOL-35B1C1A', 'BOL-AMBIG']),
  };
  assert.deepEqual(m.resolveToolingRef('35IC1A', known), { kind: 'insert', toolingNumber: '35IC1A', raw: '35IC1A' });
  assert.deepEqual(m.resolveToolingRef(' 35ic1j-027555 ', known), { kind: 'insert', toolingNumber: '35IC1J-027555', raw: ' 35ic1j-027555 ' });
  assert.deepEqual(m.resolveToolingRef('35B1C1A', known), { kind: 'bolster', toolingNumber: 'BOL-35B1C1A', raw: '35B1C1A' });
  assert.equal(m.resolveToolingRef('AMBIG', known).kind, 'unknown', 'present in both is ambiguous');
  assert.equal(m.resolveToolingRef('35IC9Z', known).kind, 'unknown', 'present in neither');
});
