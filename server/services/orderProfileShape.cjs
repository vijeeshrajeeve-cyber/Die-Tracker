'use strict';
// Order-PDF profiles. The PDF import cuts the profile from page 1 of the die drawing and posts it
// as a PNG (POST /api/orders/:id/profile-image) with the drawing's stated scales and title-block
// numbers. Here that PNG is traced into a profile_shapes row (source 'order-pdf'), true-sized
// from a stated scale only when another number backs it: the drawing's own CCD or the die list's
// (within 3 %), or, with neither, the main scale when the profile then fits the die with room.
const { shapeFromImage } = require('./profileRaster.cjs');
const { decodePng } = require('./pngDecode.cjs');
const { toUnitFrame, signatureOf, shapeStats } = require('./profileShape.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');
const { MIN_CCD_MM, PLANT_SPELLINGS } = require('./profileBundle.cjs');

const MM_PER_INCH = 25.4;
const CCD_AGREEMENT = 0.03; // a scale is confirmed when its CCD is this close to the reference CCD
const DIE_MARGIN_MM = 40; // without a reference CCD the profile must leave this much of the die diameter

const finiteOrNull = (n) => (Number.isFinite(n) ? n : null);
const round6 = (n) => Math.round(n * 1e6) / 1e6;
const roundPoly = (poly) => poly.map(([x, y]) => [round6(x), round6(y)]);
const jsonOrNull = (v) => (v == null ? null : JSON.stringify(v));

// 'Hollow' / 'HOLOW' -> true, 'SOLID' / 'SOLD' -> false, anything else -> null (the tracer decides).
const hollowFrom = (s) => {
  const t = (s || '').trim().toUpperCase();
  if (t.startsWith('HOL')) return true;
  if (t.startsWith('SOL')) return false;
  return null;
};

// A CCD worth comparing against: a number, not a die list placeholder below MIN_CCD_MM.
const referenceCcd = (v) => (Number.isFinite(v) && v >= MIN_CCD_MM ? v : null);

// 'DIA320X160' / '320X160' / 'Dia 250 x 80' -> the diameter (the first size); else null.
function dieDiameterOf(dieSize) {
  const m = String(dieSize == null ? '' : dieSize).match(/^\s*(?:DIA\s*)?(\d+(?:\.\d+)?)\s*[X×*]/i);
  return m ? Number(m[1]) : null;
}

// Which stated scale, if any, sizes the picture. `scales` are drawing mm per sheet mm (SCALE 3:1
// -> 1/3), main scale first; `dieListCcd` is the reference CCD in mm (the drawing's own or the
// die list's). Returns { mmPerPx, scale, source, confidence } or null (no true size).
function chooseScale({ pxCcd, renderDpi, scales, dieListCcd, dieSize }) {
  if (!(pxCcd > 0) || !(renderDpi > 0) || !Array.isArray(scales)) return null;
  const candidates = scales.filter((s) => Number.isFinite(s) && s > 0);
  if (!candidates.length) return null;
  const mmPerPx = (scale) => (MM_PER_INCH / renderDpi) * scale;
  const pick = (scale, confidence) => ({ mmPerPx: mmPerPx(scale), scale, source: 'pdf-scale', confidence });

  const ref = referenceCcd(dieListCcd);
  if (ref != null) {
    let best = null;
    for (const scale of candidates) {
      const off = Math.abs(pxCcd * mmPerPx(scale) - ref) / ref;
      if (off <= CCD_AGREEMENT && (!best || off < best.off)) best = { scale, off };
    }
    return best ? pick(best.scale, 'confirmed') : null;
  }
  const dia = dieDiameterOf(dieSize);
  const main = candidates[0];
  if (dia == null || pxCcd * mmPerPx(main) > dia - DIE_MARGIN_MM) return null;
  return pick(main, 'likely');
}

// PNG bytes + drawing meta -> the profile_shapes columns the shape decides. Throws when the
// picture is not a readable PNG or holds no traceable profile. The bytes come from a request, so
// they go through the pure-JS decoder: the canvas one can crash the process on a corrupt PNG. meta: { renderDpi, scales, ccdStated, dieListCcd, dieSize, dieType }.
async function shapeFromProfilePng(buffer, meta = {}) {
  const image = decodePng(buffer);
  const shape = shapeFromImage(image, { expectHollow: hollowFrom(meta.dieType) });
  if (!shape) throw new Error('no profile found in the picture');
  const px = { outer: shape.outer, holes: shape.holes };
  const signature = signatureOf(px);
  if (!signature.every(Number.isFinite)) throw new Error('degenerate outline');
  const unit = toUnitFrame(px);
  const stats = shapeStats(px);

  // The drawing's own CCD (its title block) is the better reference; the die list's is the fallback.
  const reference = referenceCcd(meta.ccdStated) ?? meta.dieListCcd ?? null;
  const sized = chooseScale({
    pxCcd: stats.ccd, renderDpi: meta.renderDpi, scales: meta.scales, dieListCcd: reference, dieSize: meta.dieSize,
  });
  // Millimetre polygons share the unit frame's origin: the outer outline's centroid.
  const [cx, cy] = unit.centroid;
  const mm = (poly) => roundPoly(poly.map(([x, y]) => [(x - cx) * sized.mmPerPx, (y - cy) * sized.mmPerPx]));

  return {
    style: shape.style,
    outer_unit: roundPoly(unit.outer),
    holes_unit: unit.holes.map(roundPoly),
    signature,
    hole_count: shape.holeCount,
    aspect_ratio: finiteOrNull(stats.aspectRatio),
    solidity: finiteOrNull(stats.solidity),
    true_size: sized != null,
    outer_mm: sized ? mm(px.outer) : null,
    holes_mm: sized ? px.holes.map(mm) : null,
    ccd_mm: sized ? round6(stats.ccd * sized.mmPerPx) : null,
    true_size_source: sized ? sized.source : null,
    true_size_confidence: sized ? sized.confidence : null,
    needs_review: shape.needsReview,
    review_reason: shape.reviewReason,
  };
}

// Multipart text fields from the PDF import -> meta. Blank or unreadable values are null.
function metaFromForm(body = {}) {
  const num = (v) => {
    if (v == null || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const text = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  let scales = [];
  try {
    const parsed = body.scales ? JSON.parse(body.scales) : [];
    if (Array.isArray(parsed)) scales = parsed.map(Number).filter((s) => Number.isFinite(s) && s > 0);
  } catch { scales = []; }
  return {
    renderDpi: num(body.renderDpi),
    scales,
    ccdStated: num(body.ccdStated),
    externalPerimeter: num(body.externalPerimeter),
    internalPerimeter: num(body.internalPerimeter),
    cavities: num(body.cavities),
    dieSize: text(body.dieSize),
  };
}

// The die list's ProfileCCD for a die (Task 5's query); null when absent or not a number.
async function readDieListCcd(client, dieNo, plant) {
  const p = normalizePlant(plant);
  const { rows } = await client.query(
    "SELECT raw_data->>'ProfileCCD' AS ccd FROM existing_die_details WHERE die_no = $1 AND plant = ANY($2)",
    [dieNo, PLANT_SPELLINGS[p] || [p]]
  );
  const raw = rows[0] && rows[0].ccd;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const UPSERT_SHAPE = `INSERT INTO profile_shapes
    (die_no, plant, profile_number, source, source_ref, image_sha, image_path, style, outer_unit, holes_unit, signature,
     hole_count, cavities, die_type, aspect_ratio, solidity, true_size, outer_mm, holes_mm, ccd_mm,
     true_size_source, true_size_confidence, needs_review, review_reason)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
  ON CONFLICT (die_no, plant, source, source_ref) DO UPDATE SET
    profile_number = EXCLUDED.profile_number, image_sha = EXCLUDED.image_sha, image_path = EXCLUDED.image_path,
    style = EXCLUDED.style, outer_unit = EXCLUDED.outer_unit, holes_unit = EXCLUDED.holes_unit,
    signature = EXCLUDED.signature, hole_count = EXCLUDED.hole_count, cavities = EXCLUDED.cavities,
    die_type = EXCLUDED.die_type, aspect_ratio = EXCLUDED.aspect_ratio, solidity = EXCLUDED.solidity,
    true_size = EXCLUDED.true_size, outer_mm = EXCLUDED.outer_mm, holes_mm = EXCLUDED.holes_mm, ccd_mm = EXCLUDED.ccd_mm,
    true_size_source = EXCLUDED.true_size_source, true_size_confidence = EXCLUDED.true_size_confidence,
    needs_review = EXCLUDED.needs_review, review_reason = EXCLUDED.review_reason, updated_at = CURRENT_TIMESTAMP
  WHERE profile_shapes.reviewed_at IS NULL
  RETURNING (xmax = 0) AS inserted`;

// Upserts the order's shape. A re-posted picture never rewrites a row a person has reviewed.
async function recordOrderProfileShape(client, {
  orderId, dieNo, plant, profileNumber = null, imageSha = null, imagePath = null, dieType = null, cavities = null, fields,
}) {
  const f = fields;
  await client.query(UPSERT_SHAPE, [
    dieNo, normalizePlant(plant), profileNumber, 'order-pdf', String(orderId), imageSha, imagePath, f.style,
    jsonOrNull(f.outer_unit), jsonOrNull(f.holes_unit || []), jsonOrNull(f.signature), f.hole_count,
    Number.isFinite(cavities) && cavities > 0 ? cavities : null, dieType || null, f.aspect_ratio, f.solidity,
    f.true_size, jsonOrNull(f.outer_mm), jsonOrNull(f.holes_mm), f.ccd_mm,
    f.true_size_source, f.true_size_confidence, !!f.needs_review, f.review_reason ?? null,
  ]);
}

module.exports = { chooseScale, dieDiameterOf, shapeFromProfilePng, metaFromForm, readDieListCcd, recordOrderProfileShape };
