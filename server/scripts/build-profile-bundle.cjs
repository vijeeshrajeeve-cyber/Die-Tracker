'use strict';
// Builds the profile shape bundle from the image-check workbook's pictures.
//   node server/scripts/build-profile-bundle.cjs [--workbook <xlsx>] [--out <bundleDir>]
//        [--sheet GEX1|GEX2] [--limit N] [--dry-run] [--force]
// Never deletes anything in --out; refuses to run over an existing manifest.json unless --force.
// --dry-run reads and traces everything but writes nothing.
const fs = require('node:fs');
const path = require('node:path');
const { openZip } = require('../services/zipReader.cjs');
const { buildProfileBundle, SHAPES_FILE } = require('../services/profileBundle.cjs');

const DEFAULT_WORKBOOK = 'C:/Users/vijee/Desktop/18.06.2026/Dies List ExtractedNew - Image Check - Final 30.10.2026.xlsx';
const DEFAULT_OUT_BASE = 'C:/Users/vijee/Desktop/18.06.2026/tooling-bundle';

function localDay() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function flag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const workbook = path.resolve(flag('--workbook') || DEFAULT_WORKBOOK);
  const out = path.resolve(flag('--out') || path.join(DEFAULT_OUT_BASE, `profiles-${localDay()}`));
  const sheet = flag('--sheet');
  const limit = flag('--limit') ? Number(flag('--limit')) : null;
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  if (sheet && !['GEX1', 'GEX2'].includes(sheet)) { console.error(`--sheet must be GEX1 or GEX2, not ${sheet}`); process.exit(1); }
  if (limit != null && !(Number.isInteger(limit) && limit > 0)) { console.error('--limit must be a positive whole number'); process.exit(1); }
  if (!fs.existsSync(workbook)) { console.error(`Workbook not found: ${workbook}`); process.exit(1); }
  if (!dryRun && fs.existsSync(path.join(out, 'manifest.json')) && !force) {
    console.error(`${out} already holds a bundle (manifest.json). Use another --out or pass --force.`);
    process.exit(1);
  }

  const sheets = sheet ? [sheet] : ['GEX1', 'GEX2'];
  console.log(`Profile bundle ${dryRun ? '(DRY RUN, nothing written)' : '(LIVE)'}`);
  console.log(`Workbook: ${workbook}\nOut:      ${out}\nSheets:   ${sheets.join(', ')}${limit ? `\nLimit:    ${limit} pictures` : ''}`);

  const io = dryRun
    ? { copyBytes: () => {}, writeJson: () => {}, appendLine: () => {} }
    : {
      copyBytes: (rel, buffer) => {
        const dest = path.join(out, ...rel.split('/'));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buffer);
      },
      writeJson: (name, obj) => fs.writeFileSync(path.join(out, name), JSON.stringify(obj)),
      appendLine: (name, text) => fs.appendFileSync(path.join(out, name), `${text}
`),
    };
  if (!dryRun) {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, SHAPES_FILE), ''); // a --force rebuild starts the shape lines afresh
  }

  const started = Date.now();
  const zip = openZip(workbook);
  const { shapesWritten, flagged, report } = await buildProfileBundle({
    zip, sheets, io, limit,
    onProgress: ({ done, total }) => { if (done % 500 === 0 || done === total) console.log(`${done}/${total} pictures`); },
  });

  const { errors, ...counts } = report;
  console.log(`\n${JSON.stringify(counts, null, 2)}`);
  console.log(`Shapes: ${shapesWritten}  flagged for review: ${flagged}  errors: ${errors.length}`);
  for (const e of errors.slice(0, 20)) console.log(`  ${e.row}: ${e.error}`);
  if (errors.length > 20) console.log(`  … ${errors.length - 20} more in report.json`);
  console.log(`Elapsed: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(dryRun ? 'Dry run, nothing was written.' : `Bundle written to ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
