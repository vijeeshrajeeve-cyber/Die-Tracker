'use strict';
// Undoes what a drawing-bundle apply wrote into the tooling master, so a bundle built with changed extraction rules
// can be applied again from a clean slate.
//   node server/scripts/reset-drawing-derived-fields.cjs --known <export.json> [--dry-run]
// <export.json> is the export-known-toolings.cjs file taken BEFORE the first apply (the one the bundle was built from).
//   - every tooling in the export gets its exported size_class, size_class_source, size_class_confidence and cavities
//     back exactly, NULLs included;
//   - every other row with source = 'drawing-archive' has those four fields set to NULL (the re-apply refills them).
// One transaction; --dry-run prints the counts and rolls back. Never touches status, never deletes a row; drawings,
// openings and stored files are left alone (the re-apply rewrites unreviewed openings itself).
//
// An export written before size_class_source / size_class_confidence were exported lacks them. For those rows a NULL
// exported size class restores NULL source and confidence (the master never holds a source without a size class), and
// a non-NULL one keeps the row's current source and confidence (an apply never replaces an existing size class, so it
// never changed them).
const fs = require('node:fs');
const path = require('node:path');

const RESTORE_SQL = `UPDATE toolings SET
  size_class = $2,
  size_class_source = CASE WHEN $6::boolean THEN size_class_source ELSE $3 END,
  size_class_confidence = CASE WHEN $6::boolean THEN size_class_confidence ELSE $4 END,
  cavities = $5
WHERE number = $1`;
const DIFFERS_SQL = `SELECT number, size_class, size_class_source, size_class_confidence, cavities FROM toolings WHERE number = ANY($1)`;
const CLEAR_SQL = `UPDATE toolings SET size_class = NULL, size_class_source = NULL, size_class_confidence = NULL, cavities = NULL
WHERE source = 'drawing-archive' AND NOT (number = ANY($1))
  AND (size_class IS NOT NULL OR size_class_source IS NOT NULL OR size_class_confidence IS NOT NULL OR cavities IS NOT NULL)`;

function restoreParams(t) {
  const legacy = !('size_class_source' in t) || !('size_class_confidence' in t);
  const sizeClass = t.size_class ?? null;
  const keep = legacy && sizeClass != null;
  return [t.number, sizeClass, legacy ? null : (t.size_class_source ?? null), legacy ? null : (t.size_class_confidence ?? null),
    t.cavities ?? null, keep];
}

const eq = (a, b) => (a == null ? b == null : b != null && String(a) === String(b));

async function resetDrawingDerivedFields(client, exported, { dryRun = false, log = () => {} } = {}) {
  const toolings = (exported && exported.toolings) || [];
  if (!toolings.length) throw new Error('the export lists no toolings');
  const numbers = toolings.map((t) => t.number);
  const counts = { exported: toolings.length, restoreMatched: 0, restoreChanged: 0, drawingArchiveCleared: 0 };
  await client.query('BEGIN');
  try {
    const before = new Map((await client.query(DIFFERS_SQL, [numbers])).rows.map((r) => [r.number, r]));
    for (const t of toolings) {
      const p = restoreParams(t);
      const cur = before.get(t.number);
      if (cur) {
        const changed = !eq(cur.size_class, p[1]) || !eq(cur.cavities, p[4])
          || (!p[5] && (!eq(cur.size_class_source, p[2]) || !eq(cur.size_class_confidence, p[3])));
        if (changed) counts.restoreChanged++;
      }
      const res = await client.query(RESTORE_SQL, p);
      counts.restoreMatched += res.rowCount || 0;
    }
    const cleared = await client.query(CLEAR_SQL, [numbers]);
    counts.drawingArchiveCleared = cleared.rowCount || 0;
    log(dryRun ? 'dry run: rolling back' : 'committing');
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return counts;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { log(`rollback failed: ${rollbackErr.message}`); }
    throw err;
  }
}

function flag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const file = flag('--known');
  const dryRun = process.argv.includes('--dry-run');
  if (!file || file.startsWith('--')) {
    console.error('Usage: node server/scripts/reset-drawing-derived-fields.cjs --known <export.json> [--dry-run]');
    process.exit(1);
  }
  const exported = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  console.log(`Reset drawing-derived tooling fields ${dryRun ? '(DRY RUN, nothing written)' : '(LIVE)'}`);
  console.log(`Export: ${file}  exported: ${exported.exportedAt || 'unknown'}  toolings: ${(exported.toolings || []).length}`);
  const { pool } = require('../db.cjs'); // only opened once the export has been read
  const client = await pool.connect();
  let counts;
  try {
    counts = await resetDrawingDerivedFields(client, exported, { dryRun, log: (m) => console.log(m) });
  } finally {
    client.release();
    await pool.end();
  }
  console.log('\nResult:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (dryRun) console.log('\nDry run, no changes were written.');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { resetDrawingDerivedFields, restoreParams, RESTORE_SQL, CLEAR_SQL };
