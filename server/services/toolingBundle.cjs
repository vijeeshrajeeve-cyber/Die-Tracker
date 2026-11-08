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
const { storedRelativePath, sha256Of, formatOf } = require('./toolingDrawings.cjs');
const { parseToolingNumber } = require('./toolingNumbers.cjs');

const NO_DXF = 'no DXF — run convert-dwg-to-dxf';
const SIZE_IN_NUMBER = /\d{3,4}X\d{2,3}/;
const EXTRACT_RANK = { dxf: 0, pdf: 1 };

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
  return {
    sizeClass: (k && k.size_class) ?? match.sizeClass ?? null,
    cavities: (k && k.cavities) ?? parseToolingNumber(number).cavities ?? null,
    inventoryDims: (k && k.inventory_dims) ?? null,
  };
}

const mismatch = (number, numbers) => {
  const usable = (numbers || []).filter((n) => !SIZE_IN_NUMBER.test(n));
  return usable.length > 0 && !usable.includes(number);
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
        const c = report.byConfidence[extraction.confidence] === undefined ? 'none' : extraction.confidence;
        const warn = mismatch(number, extraction.numbersInDrawing)
          ? { toolingNumber: number, file: source.file.relPath,
              warning: `number mismatch: drawing names ${extraction.numbersInDrawing.join(', ')}` }
          : null;
        report.byConfidence[c]++;
        if (warn) report.warnings.push(warn);
        openings.push({ toolingNumber: number, drawingSha256: source.row.sha256, extraction });
      } catch (err) {
        extraction = null;
        report.extractionFailures.push({ toolingNumber: number, file: source.file.relPath, error: err.message });
      }
    }
    // The primary is the stored row that was (or would have been) extracted; an unstored DWG row never is.
    for (const e of entries) drawings.push({ ...e.row, isPrimary: e === source });

    if (!isKnown) {
      let sizeClass = null; let sizeSource = null; let confidence = null;
      if (extraction && extraction.sizeClass) {
        sizeClass = extraction.sizeClass; sizeSource = 'drawing'; confidence = extraction.sizeClassConfidence || 'likely';
      } else if (match.sizeClass) {
        sizeClass = match.sizeClass; sizeSource = 'drawing'; confidence = 'likely';
      }
      toolings.push({
        number, kind: match.kind, plant: match.plant, size_class: sizeClass, size_class_source: sizeSource,
        size_class_confidence: confidence, cavities: (extraction && extraction.cavities) ?? hints.cavities,
        source: 'drawing-archive', status: 'retired', notes: `from drawing archive: ${group.primary.relPath}`,
      });
    }
    if (onProgress) onProgress({ done: processed, total: limit != null ? Math.min(limit, groups.size) : groups.size });
  }
  return { toolings, drawings, openings, hints: hintsOut, report };
}

module.exports = { NO_DXF, knownFromExport, matchFiles, buildBundle };
