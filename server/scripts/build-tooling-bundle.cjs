'use strict';
// Builds the tooling import bundle from the drawing archive and its converted DXFs.
//   node server/scripts/build-tooling-bundle.cjs [--archive <root>] [--dxf-dir <dir>] [--out <bundleDir>]
//        [--known <known-toolings.json>] [--limit N] [--only <substring>] [--dry-run] [--force]
// Never deletes anything in --out; refuses to run over an existing manifest.json unless --force.
const fs = require('node:fs');
const path = require('node:path');
const { listArchiveDrawings } = require('../services/archiveMatcher.cjs');
const { dxfPathFor } = require('../services/dwgConvert.cjs');
const { extractFromDxf } = require('../services/dxfOpenings.cjs');
const { extractFromPdf } = require('../services/pdfOpenings.cjs');
const { knownFromExport, matchFiles, buildBundle } = require('../services/toolingBundle.cjs');

const DEFAULT_ARCHIVE = 'C:/Users/vijee/Desktop/18.06.2026/New folder/14.Die Toolings';
const DEFAULT_DXF_DIR = 'C:/Users/vijee/Desktop/18.06.2026/tooling-dxf';
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
  const archive = path.resolve(flag('--archive') || DEFAULT_ARCHIVE);
  const dxfRoot = path.resolve(flag('--dxf-dir') || DEFAULT_DXF_DIR);
  const out = path.resolve(flag('--out') || path.join(DEFAULT_OUT_BASE, localDay()));
  const knownFile = flag('--known');
  const limit = flag('--limit') ? Number(flag('--limit')) : null;
  const only = flag('--only') ? flag('--only').toLowerCase() : null;
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');

  if (!fs.existsSync(archive)) { console.error(`Archive root not found: ${archive}`); process.exit(1); }
  if (!dryRun && fs.existsSync(path.join(out, 'manifest.json')) && !force) {
    console.error(`${out} already holds a bundle (manifest.json). Use another --out or pass --force.`);
    process.exit(1);
  }
  const known = knownFile ? knownFromExport(JSON.parse(fs.readFileSync(knownFile, 'utf8'))) : new Map();

  let files = listArchiveDrawings(archive);
  if (only) {
    const keep = new Set();
    for (const [number, g] of matchFiles(files).groups) {
      if (number.toLowerCase().includes(only)) g.files.forEach((f) => keep.add(f.absPath));
    }
    files = files.filter((f) => keep.has(f.absPath));
  }

  const m = matchFiles(files);
  console.log(`Tooling bundle ${dryRun ? '(DRY RUN, nothing copied or extracted)' : '(LIVE)'}`);
  console.log(`Archive: ${archive}\nDXF dir: ${dxfRoot}\nOut:     ${out}\nKnown:   ${knownFile ? `${known.size} toolings` : '(none)'}`);
  console.log(`\nDrawing files: ${files.length}  toolings: ${m.groups.size}  skipped: ${m.skipped.length}  unrecognised: ${m.unmatched.length}`);
  if (dryRun) { console.log('\nDry run, nothing was written.'); return; }

  const io = {
    readFile: (p) => fs.readFileSync(p),
    copyFile: (abs, rel) => {
      const dest = path.join(out, ...rel.split('/'));
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
    },
    dxfFor: (file) => {
      const p = dxfPathFor(file, dxfRoot);
      return fs.existsSync(p) && fs.statSync(p).size > 0 ? p : null;
    },
  };
  fs.mkdirSync(out, { recursive: true });
  const r = await buildBundle({
    files, known, io, extractors: { dxf: extractFromDxf, pdf: extractFromPdf }, limit,
    onProgress: ({ done, total }) => { if (done % 25 === 0 || done === total) console.log(`${done}/${total} toolings`); },
  });

  const write = (name, obj) => fs.writeFileSync(path.join(out, name), JSON.stringify(obj, null, 2));
  write('toolings.json', r.toolings);
  write('drawings.json', r.drawings);
  write('openings.json', r.openings);
  write('hints.json', r.hints);
  write('report.json', r.report);
  write('manifest.json', {
    version: 1, createdAt: new Date().toISOString(), archiveRoot: archive, dxfRoot,
    counts: {
      files: r.drawings.filter((d) => d.bundleFile).length, toolingsNew: r.toolings.length, drawings: r.drawings.length,
      openings: r.openings.length, skipped: r.report.skipped.length,
    },
  });

  const reasons = {};
  for (const s of r.report.skipped) reasons[s.reason] = (reasons[s.reason] || 0) + 1;
  const stems = {};
  for (const s of r.report.unmatched) stems[s] = (stems[s] || 0) + 1;
  console.log(`\nbyConfidence: ${JSON.stringify(r.report.byConfidence)}${r.report.limited ? '  (limited)' : ''}`);
  console.log(`New toolings: ${r.toolings.length}  drawings: ${r.drawings.length}  openings: ${r.openings.length}`);
  console.log(`Skipped by reason: ${JSON.stringify(reasons)}`);
  console.log(`Unmatched stems: ${r.report.unmatched.length}`);
  for (const [s, n] of Object.entries(stems).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${n}x ${s}`);
  const missingDxf = r.report.extractionFailures.filter((f) => /no DXF/.test(f.error)).length;
  console.log(`Extraction failures: ${r.report.extractionFailures.length} (no DXF: ${missingDxf})  warnings: ${r.report.warnings.length}`);
  console.log(`Bundle written to ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
