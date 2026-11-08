'use strict';
// Exports the known toolings (the hints file the drawing-bundle builder reads).
//   node server/scripts/export-known-toolings.cjs [--out <file>]
// Needs the database, so run it where the DB is reachable (the backend container).
// Writes { exportedAt, toolings: [{ number, kind, plant, size_class, size_class_source, size_class_confidence, cavities,
//   inventory_dims, status }] } (the source/confidence pair lets reset-drawing-derived-fields.cjs restore a row exactly)
// to --out, or to stdout when --out is absent.
const fs = require('node:fs');
const path = require('node:path');

function flag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const out = flag('--out');
  const { pool } = require('../db.cjs'); // only opened when the script runs
  try {
    const res = await pool.query(
      `SELECT number, kind, plant, size_class, size_class_source, size_class_confidence, cavities, inventory_dims, status
       FROM toolings ORDER BY number`);
    const text = JSON.stringify({ exportedAt: new Date().toISOString(), toolings: res.rows }, null, 2);
    if (out) {
      fs.writeFileSync(path.resolve(out), text);
      console.error(`Exported ${res.rows.length} toolings to ${out}`);
    } else {
      process.stdout.write(text + '\n');
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
