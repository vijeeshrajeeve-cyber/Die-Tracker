'use strict';
// Loads a profile bundle (built on the PC by build-profile-bundle.cjs) into profile_shapes and file storage.
//   node server/scripts/apply-profile-bundle.cjs <bundleDir> [--dry-run]
// One transaction. Idempotent: a shape is keyed by (die_no, plant, source, source_ref), a reviewed row is
// left alone, pictures are copied only when absent.
const fs = require('node:fs');
const path = require('node:path');
const { readProfileBundle, applyProfileBundle } = require('../services/profileBundle.cjs');
const { getRoot } = require('../services/toolingDrawings.cjs');

async function main() {
  const dir = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!dir || dir.startsWith('--')) {
    console.error('Usage: node server/scripts/apply-profile-bundle.cjs <bundleDir> [--dry-run]');
    process.exit(1);
  }
  const bundle = readProfileBundle(path.resolve(dir));
  const root = getRoot();
  console.log(`Profile bundle apply ${dryRun ? '(DRY RUN, nothing written or copied)' : '(LIVE)'}`);
  console.log(`Bundle: ${bundle.dir}  created: ${bundle.manifest.createdAt || 'unknown'}`);
  console.log(`Storage root: ${root}`);
  console.log(`Manifest counts: ${JSON.stringify(bundle.manifest.counts || {})}`);

  const io = {
    exists: (p) => fs.existsSync(p),
    mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
    copyFile: (src, dest) => fs.copyFileSync(src, dest),
  };
  const { pool } = require('../db.cjs'); // only opened once the bundle has been read and validated
  const client = await pool.connect();
  let counts;
  try {
    counts = await applyProfileBundle(client, bundle, { root, io, dryRun, log: (m) => console.log(m) });
  } finally {
    client.release();
    await pool.end();
  }
  console.log('\nResult:');
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
