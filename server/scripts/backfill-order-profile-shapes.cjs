'use strict';
// Traces the stored profile pictures of orders that have no order-pdf shape row yet.
//   node server/scripts/backfill-order-profile-shapes.cjs [--dry-run] [--limit N]
// One transaction; --dry-run traces everything and rolls back. Prints the result JSON last.
const fs = require('node:fs');
const { backfillOrderProfileShapes } = require('../services/orderProfileShape.cjs');
const { getRoot } = require('../services/orderFiles.cjs');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const li = process.argv.indexOf('--limit');
  const limit = li >= 0 ? Number(process.argv[li + 1]) : null;
  if (li >= 0 && !(Number.isInteger(limit) && limit > 0)) {
    console.error('Usage: node server/scripts/backfill-order-profile-shapes.cjs [--dry-run] [--limit N]');
    process.exit(1);
  }
  const root = getRoot();
  console.log(`Backfill order profile shapes: root ${root}, ${dryRun ? 'DRY RUN (rolled back)' : 'LIVE'}, limit ${limit ?? 'none'}`);
  const io = { exists: (p) => fs.existsSync(p), readFile: (p) => fs.promises.readFile(p) };
  const { pool } = require('../db.cjs');
  const client = await pool.connect();
  let result;
  try {
    result = await backfillOrderProfileShapes(client, { root, io, dryRun, limit, log: (m) => console.log(m) });
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
