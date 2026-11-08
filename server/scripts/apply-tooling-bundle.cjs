'use strict';
// Loads a tooling bundle (built on the PC by build-tooling-bundle.cjs) into the database and file storage.
//   node server/scripts/apply-tooling-bundle.cjs <bundleDir> [--dry-run]
// One transaction. Idempotent: a drawing is keyed by (tooling, sha256), files are copied only when absent,
// openings are rewritten unless a person has reviewed them. toolings.status is never written.
const fs = require('node:fs');
const path = require('node:path');
const { readBundle, applyBundle } = require('../services/toolingBundle.cjs');
const { getRoot } = require('../services/toolingDrawings.cjs');

async function main() {
  const dir = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!dir || dir.startsWith('--')) {
    console.error('Usage: node server/scripts/apply-tooling-bundle.cjs <bundleDir> [--dry-run]');
    process.exit(1);
  }
  const bundle = readBundle(path.resolve(dir));
  const root = getRoot();

  console.log(`Tooling bundle apply ${dryRun ? '(DRY RUN, nothing written or copied)' : '(LIVE)'}`);
  console.log(`Bundle: ${bundle.dir}  created: ${bundle.manifest.createdAt || 'unknown'}`);
  console.log(`Storage root: ${root}`);
  console.log(`Manifest counts: ${JSON.stringify(bundle.manifest.counts || {})}`);
  if (bundle.report) {
    const r = bundle.report;
    console.log(`Report: byConfidence ${JSON.stringify(r.byConfidence || {})}, `
      + `readFailures ${(r.readFailures || []).length}, extractionFailures ${(r.extractionFailures || []).length}`);
  }

  const io = {
    exists: (p) => fs.existsSync(p),
    mkdirp: (d) => fs.mkdirSync(d, { recursive: true }),
    copyFile: (src, dest) => fs.copyFileSync(src, dest),
  };
  const { pool } = require('../db.cjs'); // only opened once the bundle has been read and validated
  const client = await pool.connect();
  let counts;
  try {
    counts = await applyBundle(client, bundle, { root, io, dryRun, log: (m) => console.log(m) });
  } finally {
    client.release();
    await pool.end();
  }
  console.log('\nResult:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (dryRun) console.log('\nDry run, no changes were written and no files were copied.');
}

main().catch((e) => { console.error(e); process.exit(1); });
