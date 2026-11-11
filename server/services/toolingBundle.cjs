'use strict';
// Bundle builder (PC side): matches archive drawings to tooling numbers, copies them into a bundle
// directory and extracts opening geometry. Pure apart from the injected `io`, so the tests use fakes.
//
//   io = { readFile(absPath) -> Buffer, copyFile(absPath, bundleRelPath), dxfFor(file) -> absPath | null }
//   extractors = { dxf(text, hints), pdf(buffer, hints) }   (each may be sync or async)
//
// A DWG itself is never stored: its converted DXF is (named after the DWG, archivePath = the DWG's path).
// A DWG without a converted DXF is recorded as a 'dwg' drawing with no bundle file and reported.
const { interpretStem, groupByTooling } = require('./archiveMatcher.cjs');
const { storedRelativePath, sha256Of, formatOf, absolutePath } = require('./toolingDrawings.cjs');
const { parseToolingNumber, drawingHintsFromNumber } = require('./toolingNumbers.cjs');
const { openingRowFromExtraction, openingParams } = require('./toolingReview.cjs');

const NO_DXF = 'no DXF — run convert-dwg-to-dxf';
const SIZE_IN_NUMBER = /\d{3,4}X\d{2,3}/;
const EXTRACT_RANK = { dxf: 0, pdf: 1 };
// Only an opening the extractor is sure of may write the master's cavities or drawing-derived size class; the rest
// is left NULL for the review queue.
const MASTER_GRADE = new Set(['confirmed', 'likely']);
const fillsMaster = (x) => !!(x && MASTER_GRADE.has(x.confidence));

function knownFromExport(json) {
  const map = new Map();
  for (const t of (json && json.toolings) || []) {
    map.set(t.number, {
      kind: t.kind ?? null, plant: t.plant ?? null, size_class: t.size_class ?? null, cavities: t.cavities ?? null,
      inventory_dims: t.inventory_dims ?? null, status: t.status ?? null,
    });
  }
  return map;
}

// Interprets every file name; returns the tooling groups plus what was skipped or not recognised.
function matchFiles(files) {
  const matched = [];
  const skipped = [];
  const unmatched = [];
  for (const file of files) {
    const m = interpretStem(file.stem, { plant: file.plant, kindHint: file.kindHint });
    if (m.skip) {
      skipped.push({ relPath: file.relPath, reason: m.skip });
      if (m.skip === 'unrecognised') unmatched.push(file.stem);
    } else {
      matched.push({ ...file, ...m });
    }
  }
  return { groups: groupByTooling(matched), skipped, unmatched };
}

function hintsFor(number, match, known) {
  const k = known.get(number);
  const fromNumber = drawingHintsFromNumber(number);
  return {
    sizeClass: (k && k.size_class) ?? match.sizeClass ?? null,
    cavities: (k && k.cavities) ?? parseToolingNumber(number).cavities ?? null,
    inventoryDims: (k && k.inventory_dims) ?? null,
    steppedPockets: fromNumber.steppedPockets,
  };
}

// Comparison key of a tooling number: kind prefix and punctuation dropped, and - only when allowed - the leading
// zeros of each digit run (BOL-S_05256 -> S5256, I-05256 -> 5256, 25IC1-028851 -> 25IC128851). `seps` marks the key
// positions that followed punctuation in the original, so a match can tell a whole segment from a digit run.
const KIND = /^(I|BOL)-/;
function numberKey(n, stripZeros) {
  let s = String(n).toUpperCase().replace(KIND, '');
  if (stripZeros) s = s.replace(/\d+/g, (d) => String(Number(d)));
  let key = '';
  const seps = [];
  let sep = false;
  for (const ch of s) {
    if (/[A-Z0-9]/.test(ch)) { seps.push(sep); key += ch; sep = false; } else sep = true;
  }
  return { key, seps };
}
const kindOf = (n) => (KIND.exec(String(n).toUpperCase()) || [])[1] || null;
const digitCount = (n) => String(n).replace(KIND, '').replace(/\D/g, '').length;
// The same tooling written another way. Leading zeros are dropped only between numbers of the same kind or with the
// same digit count (25IC1-28851 ~ 25IC1-028851, but BOL-5043 is not I-05043). Then equal keys, or one key inside the
// other where the extra characters are letters (I-29361C, BOL-IB17928, INS-35IC1-026904) or whole punctuation-
// separated segments (35IC1 on a 35IC1-090371 drawing) - never stray digits (I-05289 is not I-15289).
function sameTooling(a, b) {
  const ka0 = kindOf(a);
  const kb0 = kindOf(b);
  const strip = !ka0 || !kb0 || ka0 === kb0 || digitCount(a) === digitCount(b);
  const ka = numberKey(a, strip);
  const kb = numberKey(b, strip);
  if (ka.key === kb.key) return true;
  const [short, long] = ka.key.length <= kb.key.length ? [ka, kb] : [kb, ka];
  if (short.key.length < 4) return false;
  for (let at = long.key.indexOf(short.key); at !== -1; at = long.key.indexOf(short.key, at + 1)) {
    const end = at + short.key.length;
    const pre = long.key.slice(0, at);
    const post = long.key.slice(end);
    const preOk = !pre || /^[A-Z]+$/.test(pre) || long.seps[at];
    const postOk = !post || /^[A-Z]+$/.test(post) || long.seps[end];
    if (preOk && postOk) return true;
  }
  return false;
}

// The drawing's own (non-size) numbers when they exist and none of them is this tooling; null otherwise.
const mismatch = (number, numbers) => {
  const usable = (numbers || []).filter((n) => !SIZE_IN_NUMBER.test(n));
  return usable.length > 0 && !usable.some((n) => sameTooling(n, number)) ? usable : null;
};

async function buildBundle({ files, known, io, extractors, limit = null, onProgress = null }) {
  const { groups, skipped, unmatched } = matchFiles(files);
  const toolings = [];
  const drawings = [];
  const openings = [];
  const hintsOut = [];
  const report = {
    skipped, unmatched,
    extractionFailures: [],
    readFailures: [],
    warnings: [],
    byConfidence: { confirmed: 0, likely: 0, uncertain: 0, none: 0 },
    limited: false,
  };

  let processed = 0;
  for (const [number, group] of groups) {
    if (limit != null && processed >= limit) { report.limited = true; break; }
    processed++;
    const { match } = group;
    const isKnown = known.has(number);
    const hints = hintsFor(number, match, known);
    hintsOut.push({ toolingNumber: number, known: isKnown, hints: { ...hints } });

    // One entry per file: what is stored, and whether it can be extracted from.
    const entries = [];
    const seen = new Set();
    const fileName = (file) => file.relPath.split('/').pop();
    const readFailed = (file, err) => report.readFailures.push({ toolingNumber: number, file: file.relPath, error: err.message });
    const addStored = (file, readFrom, originalName, ext) => {
      try {
        const buffer = io.readFile(readFrom);
        const sha256 = sha256Of(buffer);
        if (seen.has(sha256)) return;
        const bundleFile = `files/${storedRelativePath({ number, sha256, originalName })}`;
        io.copyFile(readFrom, bundleFile);
        seen.add(sha256);
        entries.push({ file, extract: { ext, buffer }, row: {
          toolingNumber: number, bundleFile, originalName, archivePath: file.relPath, format: formatOf(originalName),
          matchBasis: match.basis, sha256, byteSize: buffer.length,
        } });
      } catch (err) { readFailed(file, err); }
    };
    for (const file of group.files) {
      if (file.ext === 'dwg') {
        const dxfAbs = io.dxfFor(file);
        if (!dxfAbs) {
          entries.push({ file, extract: null, row: {
            toolingNumber: number, bundleFile: null, originalName: fileName(file), archivePath: file.relPath,
            format: 'dwg', matchBasis: match.basis, sha256: null, byteSize: null,
          } });
          if (file === group.primary) report.extractionFailures.push({ toolingNumber: number, file: file.relPath, error: NO_DXF });
          continue;
        }
        addStored(file, dxfAbs, fileName(file).replace(/\.dwg$/i, '.dxf'), 'dxf');
      } else {
        addStored(file, file.absPath, fileName(file), file.ext);
      }
    }

    // Extraction source: the matcher's primary first, then dxf before pdf, non-FIN, shortest stem.
    const candidates = entries.filter((e) => e.extract).sort((a, b) =>
      ((b.file === group.primary) - (a.file === group.primary))
      || (EXTRACT_RANK[a.extract.ext] - EXTRACT_RANK[b.extract.ext])
      || ((a.file.variant === 'FIN') - (b.file.variant === 'FIN'))
      || (a.file.stem.length - b.file.stem.length));
    let extraction = null;
    const source = candidates[0];
    if (source) {
      try {
        extraction = source.extract.ext === 'dxf'
          ? await extractors.dxf(source.extract.buffer.toString('utf8'), hints)
          : await extractors.pdf(source.extract.buffer, hints);
        if (!extraction || typeof extraction !== 'object') throw new Error('extractor returned no result');
        // A drawing that names other numbers but not this one may be filed under the wrong tooling: keep the
        // geometry for review, never better than uncertain.
        const named = mismatch(number, extraction.numbersInDrawing);
        if (named) {
          extraction = { ...extraction, notes: [...(extraction.notes || []), `drawing names ${named.join(', ')}, not ${number}`] };
          if (MASTER_GRADE.has(extraction.confidence)) extraction.confidence = 'uncertain';
          report.warnings.push({ toolingNumber: number, file: source.file.relPath,
            warning: `number mismatch: drawing names ${extraction.numbersInDrawing.join(', ')}` });
        }
        const c = report.byConfidence[extraction.confidence] === undefined ? 'none' : extraction.confidence;
        report.byConfidence[c]++;
        openings.push({ toolingNumber: number, drawingSha256: source.row.sha256, extraction });
      } catch (err) {
        extraction = null;
        report.extractionFailures.push({ toolingNumber: number, file: source.file.relPath, error: err.message });
      }
    }
    // The primary is the stored row that was (or would have been) extracted; an unstored DWG row never is.
    for (const e of entries) drawings.push({ ...e.row, isPrimary: e === source });

    if (!isKnown) {
      // The extraction's size class and cavities count only when the opening is confirmed or likely; the size in the
      // file name and the cavities in the tooling number (GEX-2 35IC2) do not depend on the geometry.
      const sure = fillsMaster(extraction);
      let sizeClass = null; let sizeSource = null; let confidence = null;
      if (sure && extraction.sizeClass) {
        sizeClass = extraction.sizeClass; sizeSource = 'drawing'; confidence = extraction.sizeClassConfidence || 'likely';
      } else if (match.sizeClass) {
        sizeClass = match.sizeClass; sizeSource = 'drawing'; confidence = 'likely';
      }
      toolings.push({
        number, kind: match.kind, plant: match.plant, size_class: sizeClass, size_class_source: sizeSource,
        size_class_confidence: confidence, cavities: (sure ? extraction.cavities : null) ?? hints.cavities ?? null,
        source: 'drawing-archive', status: 'retired', notes: `from drawing archive: ${group.primary.relPath}`,
      });
    }
    if (onProgress) onProgress({ done: processed, total: limit != null ? Math.min(limit, groups.size) : groups.size });
  }
  return { toolings, drawings, openings, hints: hintsOut, report };
}


// ---- Apply half (server side) ---------------------------------------------------------------------
// readBundle(dir, fsLike) reads and validates a bundle directory written by build-tooling-bundle.cjs.
function readBundle(dir, fsLike = require('node:fs')) {
  const path = require('node:path');
  const read = (name, optional = false) => {
    try { return JSON.parse(fsLike.readFileSync(path.join(dir, name), 'utf8')); } catch (err) {
      if (optional && err && err.code === 'ENOENT') return null;
      throw new Error(`Cannot read ${name} from the bundle: ${err.message}`);
    }
  };
  const manifest = read('manifest.json');
  if (!manifest || manifest.version !== 1) {
    throw new Error(`Unsupported bundle version ${manifest && manifest.version}; this applier reads version 1`);
  }
  const parts = { toolings: read('toolings.json'), drawings: read('drawings.json'), openings: read('openings.json') };
  for (const [name, value] of Object.entries(parts)) {
    if (!Array.isArray(value)) throw new Error(`${name}.json must be an array`);
  }
  return { dir, manifest, ...parts, report: read('report.json', true) };
}

// Writes a bundle into the database in one transaction. Never writes toolings.status; never overwrites a
// reviewed opening; copies a file only when it is not already stored. All file IO is injected.
async function applyBundle(client, bundle, { root, io, dryRun = false, log = () => {} }) {
  const counts = {
    toolingsInserted: 0, toolingsUpdated: 0, drawingsInserted: 0, drawingsSkipped: 0, drawingsUnstored: 0,
    drawingsSkippedUnknownTooling: 0, openingsWritten: 0, openingsSkippedReviewed: 0, openingsSkippedUnknownTooling: 0,
    filesCopied: 0,
  };
  await client.query('BEGIN');
  try {
    // A tooling known only from a drawing is always a retired drawing-archive row, whatever the bundle says.
    for (const t of bundle.toolings) {
      const res = await client.query(
        `INSERT INTO toolings (number, kind, plant, size_class, size_class_source, size_class_confidence, cavities, source, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'drawing-archive', 'retired', $8)
         ON CONFLICT (number) DO UPDATE SET
           size_class = COALESCE(toolings.size_class, EXCLUDED.size_class),
           size_class_source = CASE WHEN toolings.size_class IS NULL AND EXCLUDED.size_class IS NOT NULL THEN EXCLUDED.size_class_source ELSE toolings.size_class_source END,
           size_class_confidence = CASE WHEN toolings.size_class IS NULL AND EXCLUDED.size_class IS NOT NULL THEN EXCLUDED.size_class_confidence ELSE toolings.size_class_confidence END,
           cavities = COALESCE(toolings.cavities, EXCLUDED.cavities),
           updated_at = CURRENT_TIMESTAMP
         RETURNING (xmax = 0) AS inserted`,
        [t.number, t.kind, t.plant, t.size_class ?? null, t.size_class_source ?? null, t.size_class_confidence ?? null,
          t.cavities ?? null, t.notes ?? null]);
      if (res.rows[0] && res.rows[0].inserted) counts.toolingsInserted++;
    }

    const numbers = [...new Set([...bundle.drawings, ...bundle.openings].map((r) => r.toolingNumber))];
    const idOf = new Map();
    if (numbers.length) {
      const res = await client.query('SELECT id, number FROM toolings WHERE number = ANY($1)', [numbers]);
      for (const row of res.rows) idOf.set(row.number, row.id);
    }

    const toCopy = [];
    const primaries = new Map();
    for (const d of bundle.drawings) {
      if (!d.bundleFile || !d.sha256) { counts.drawingsUnstored++; continue; }
      const toolingId = idOf.get(d.toolingNumber);
      if (toolingId == null) { counts.drawingsSkippedUnknownTooling++; continue; }
      const filePath = d.bundleFile.replace(/^files\//, '');
      const res = await client.query(
        `INSERT INTO tooling_drawings (tooling_id, file_path, original_name, archive_path, format, match_basis, sha256, byte_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (tooling_id, sha256) DO NOTHING`,
        [toolingId, filePath, d.originalName, d.archivePath ?? null, d.format, d.matchBasis, d.sha256, d.byteSize]);
      if (res.rowCount > 0) counts.drawingsInserted++; else counts.drawingsSkipped++;
      if (d.isPrimary) primaries.set(toolingId, d.sha256);
      toCopy.push({ src: `${bundle.dir}/${d.bundleFile}`.replace(/\\/g, '/'), dest: absolutePath(root, filePath) });
    }
    for (const [toolingId, sha] of primaries) {
      await client.query('UPDATE tooling_drawings SET is_primary = (sha256 = $2) WHERE tooling_id = $1', [toolingId, sha]);
    }
    if (!dryRun) {
      const path = require('node:path');
      for (const f of toCopy) {
        if (io.exists(f.dest)) continue;
        io.mkdirp(path.dirname(f.dest));
        io.copyFile(f.src, f.dest);
        counts.filesCopied++;
      }
    }

    for (const o of bundle.openings) {
      const toolingId = idOf.get(o.toolingNumber);
      if (toolingId == null) { counts.openingsSkippedUnknownTooling++; continue; }
      const x = o.extraction;
      let drawingId = null; let drawingFile = null;
      if (o.drawingSha256) {
        const found = await client.query('SELECT id, file_path FROM tooling_drawings WHERE tooling_id = $1 AND sha256 = $2', [toolingId, o.drawingSha256]);
        if (found.rows[0]) { drawingId = found.rows[0].id; drawingFile = found.rows[0].file_path; }
      }
      const res = await client.query(
        `INSERT INTO tooling_openings (tooling_id, outer_outline, pockets, pocket_gap_mm, extraction_source, confidence, drawing_file, drawing_id, extraction_note, extraction_meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tooling_id) DO UPDATE SET
           outer_outline = EXCLUDED.outer_outline, pockets = EXCLUDED.pockets, pocket_gap_mm = EXCLUDED.pocket_gap_mm,
           extraction_source = EXCLUDED.extraction_source, confidence = EXCLUDED.confidence,
           drawing_file = EXCLUDED.drawing_file, drawing_id = EXCLUDED.drawing_id,
           extraction_note = EXCLUDED.extraction_note, extraction_meta = EXCLUDED.extraction_meta,
           updated_at = CURRENT_TIMESTAMP
         WHERE tooling_openings.reviewed_at IS NULL`,
        openingParams(toolingId, openingRowFromExtraction(x, { drawingId, drawingFile })));
      if (res.rowCount > 0) counts.openingsWritten++; else counts.openingsSkippedReviewed++;

      // Only a confirmed or likely opening fills the master's blanks.
      if (fillsMaster(x) && (x.sizeClass || x.cavities)) {
        const cur = (await client.query('SELECT size_class, cavities FROM toolings WHERE id = $1', [toolingId])).rows[0];
        const fills = cur && ((cur.size_class == null && x.sizeClass) || (cur.cavities == null && x.cavities));
        if (fills) {
          await client.query(
            `UPDATE toolings SET
               size_class = COALESCE(size_class, $2),
               size_class_source = CASE WHEN size_class IS NULL AND $2 IS NOT NULL THEN 'drawing' ELSE size_class_source END,
               size_class_confidence = CASE WHEN size_class IS NULL AND $2 IS NOT NULL THEN $3 ELSE size_class_confidence END,
               cavities = COALESCE(cavities, $4),
               updated_at = CURRENT_TIMESTAMP
             WHERE number = $1`,
            [o.toolingNumber, x.sizeClass ?? null, x.sizeClassConfidence ?? 'likely', x.cavities ?? null]);
          counts.toolingsUpdated++;
        }
      }
    }
    log(dryRun ? 'dry run: rolling back' : 'committing');
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return counts;
  } catch (err) {
    // A failing ROLLBACK (e.g. the connection died) must not hide the error that caused it.
    try { await client.query('ROLLBACK'); } catch (rollbackErr) { log(`rollback failed: ${rollbackErr.message}`); }
    throw err;
  }
}

module.exports = { NO_DXF, knownFromExport, matchFiles, buildBundle, readBundle, applyBundle, sameTooling };
