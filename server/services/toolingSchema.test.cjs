'use strict';
// init.sql serves fresh installs, db.cjs migrates existing ones; the tooling
// tables must be defined identically in both or the test server and a fresh
// install drift apart.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const initSql = fs.readFileSync(path.join(__dirname, '..', '..', 'init.sql'), 'utf8');
const dbCjs = fs.readFileSync(path.join(__dirname, '..', 'db.cjs'), 'utf8');

const columnsOf = (text, table) => {
  const m = text.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\);`));
  assert.ok(m, `${table} is defined`);
  // Split on either line ending: core.autocrlf rewrites the files as CRLF on Windows checkouts.
  return m[1].split(/\r?\n/).map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)
    .map((l) => l.replace(/,$/, '').replace(/\s+/g, ' '));
};

for (const table of ['toolings', 'tooling_drawings', 'tooling_openings', 'tooling_combinations', 'die_tooling_links', 'profile_shapes', 'new_die_order_forms']) {
  test(`${table} has the same columns in init.sql and db.cjs`, () => {
    assert.deepEqual(columnsOf(dbCjs, table), columnsOf(initSql, table));
  });
}

test('toolings.status and die_tooling_links.kind are constrained', () => {
  const cols = columnsOf(initSql, 'toolings');
  assert.ok(cols.some((c) => c.startsWith('status TEXT NOT NULL DEFAULT \'active\' CHECK')));
  assert.ok(columnsOf(initSql, 'die_tooling_links').some((c) => c.includes("CHECK (kind IN ('insert', 'bolster', 'unknown'))")));
});

test('tooling_openings carries drawing_id, extraction_note and extraction_meta in both files and as ALTERs', () => {
  for (const text of [initSql, dbCjs]) {
    const cols = columnsOf(text, 'tooling_openings');
    assert.ok(cols.some((c) => c.startsWith('drawing_id INTEGER REFERENCES tooling_drawings(id)')));
    assert.ok(cols.includes('extraction_note TEXT'));
    assert.ok(cols.includes('extraction_meta JSONB'));
    assert.ok(cols.indexOf('extraction_meta JSONB') === cols.indexOf('extraction_note TEXT') + 1, 'extraction_meta follows extraction_note');
  }
  assert.ok(dbCjs.includes('ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS drawing_id'));
  assert.ok(dbCjs.includes('ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS extraction_note'));
  assert.ok(dbCjs.includes('ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS extraction_meta JSONB;'));
});

test('tooling_drawings is created before tooling_openings in both files', () => {
  for (const text of [initSql, dbCjs]) {
    const a = text.indexOf('CREATE TABLE IF NOT EXISTS tooling_drawings');
    const b = text.indexOf('CREATE TABLE IF NOT EXISTS tooling_openings');
    assert.ok(a >= 0 && b >= 0 && a < b);
  }
});

test('profile_shapes constrains source and is unique per source reference in both files', () => {
  for (const text of [initSql, dbCjs]) {
    const cols = columnsOf(text, 'profile_shapes');
    assert.ok(cols.includes("source TEXT NOT NULL CHECK (source IN ('image-check-xlsx', 'order-pdf', 'profile-drawing', 'manual'))"));
    assert.ok(cols.includes('UNIQUE (die_no, plant, source, source_ref)'));
  }
});

test('users.can_review_toolings is in init.sql and migrated by db.cjs', () => {
  const cols = columnsOf(initSql, 'users');
  assert.ok(cols.includes('can_review_toolings BOOLEAN NOT NULL DEFAULT false'));
  assert.ok(/ALTER TABLE users ADD COLUMN IF NOT EXISTS can_review_toolings BOOLEAN NOT NULL DEFAULT false/.test(dbCjs));
});

test('new_die_order_forms is created after profile_shapes in both files', () => {
  for (const text of [initSql, dbCjs]) {
    const a = text.indexOf('CREATE TABLE IF NOT EXISTS profile_shapes');
    const b = text.indexOf('CREATE TABLE IF NOT EXISTS new_die_order_forms');
    assert.ok(a >= 0 && b > a);
  }
});
