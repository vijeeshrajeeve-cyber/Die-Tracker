'use strict';
// The new-die-order form: the stamped order PDF a user generates for a die that does not exist yet,
// recorded with the tooling they chose (from the finder or typed), the finder's candidates, and the
// profile traced from the drawing. Files live under the tooling root (toolingDrawings.getRoot()).
const { normalizePlant } = require('./frozenDesigns.cjs');
const { parseToolingNumber } = require('./toolingNumbers.cjs');
const { recordOrderToolingLinks } = require('./dieToolingLinks.cjs');
const { toUnitFrame, signatureOf, shapeStats } = require('./profileShape.cjs');
const profileSimilarity = require('./profileSimilarity.cjs');
const toolingFinder = require('./toolingFinder.cjs');

const PLANT_SLUGS = { 'GEX 1': 'gex-1', 'GEX 2': 'gex-2' };
const plantSlug = (plant) => {
  const p = normalizePlant(plant);
  return PLANT_SLUGS[p] || (p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown');
};
const safeSegment = (v) => String(v == null ? '' : v).replace(/[^A-Za-z0-9_-]/g, '_');

// Root-relative paths (forward slashes: persisted and served on Linux) of one form's two files.
function formPaths({ plant, dieNo, stamp }) {
  const base = `new-die-orders/${plantSlug(plant)}/${safeSegment(dieNo)}-${safeSegment(stamp)}`;
  return { drawingPath: `${base}-drawing.pdf`, formPdfPath: `${base}-form.pdf` };
}

const finiteOrNull = (n) => (Number.isFinite(n) ? n : null);
const jsonOrNull = (v) => (v == null ? null : JSON.stringify(v));

// 'Solid' / 'Hollow' from the form's checkboxes; neither or both -> null.
const dieTypeOf = (values = {}) => {
  if (values.SOLID === true && values.HOLLOW !== true) return 'Solid';
  if (values.HOLLOW === true && values.SOLID !== true) return 'Hollow';
  return null;
};

// Twin of orderProfileShape.cjs's UPSERT_SHAPE (same columns, same guard: a row a person has reviewed
// is never rewritten), but RETURNING id so the form can point at its shape.
const UPSERT_DRAWING_SHAPE = `INSERT INTO profile_shapes
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
  RETURNING id`;

const INSERT_FORM = `INSERT INTO new_die_order_forms
    (plant, die_no, profile_number, customer, press, die_size, cavities, form_values,
     chosen_tooling, chosen_kind, chosen_from_finder, candidates, drawing_path, form_pdf_path, generated_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
  RETURNING *`;

// The typed INSERT No / BOLSTER No that parse to a canonical number the master lacks become
// 'unverified' toolings (source 'order-form'), so the link resolves and a reviewer can confirm them.
// The parsed kind wins over the field it was typed in. Unparseable text adds nothing (the link
// recorder keeps it as a raw 'unknown' link). Returns the numbers added.
async function ensureToolingRows(client, { numbers = [], plant }) {
  const byNumber = new Map();
  for (const { raw } of numbers) {
    const parsed = parseToolingNumber(raw);
    if (parsed.kind === 'unknown' || !parsed.canonical) continue;
    byNumber.set(parsed.canonical, parsed.kind);
  }
  if (!byNumber.size) return [];
  const { rows } = await client.query('SELECT number FROM toolings WHERE number = ANY($1)', [[...byNumber.keys()]]);
  const present = new Set(rows.map((r) => r.number));
  const added = [];
  const normPlant = normalizePlant(plant);
  for (const [number, kind] of byNumber) {
    if (present.has(number)) continue;
    await client.query(
      `INSERT INTO toolings (number, kind, plant, source, status, held_presses)
         VALUES ($1, $2, $3, 'order-form', 'unverified', '{}')
         ON CONFLICT (number) DO NOTHING`,
      [number, kind, normPlant],
    );
    added.push(number);
  }
  return added;
}

// The traced shape -> UPSERT_DRAWING_SHAPE's parameters. Signature, aspect ratio and solidity are
// recomputed here from the unit polygons (all scale-free), not taken from the client.
function drawingShapeParams({ formId, dieNo, plant, profileNumber, cavities, dieType, drawingSha, drawingPath, profile }) {
  const outer = profile.outer_unit;
  const holes = profile.holes_unit || [];
  const unit = toUnitFrame({ outer, holes });
  const signature = signatureOf({ outer: unit.outer, holes: unit.holes });
  if (!signature.every(Number.isFinite)) throw new Error('degenerate outline');
  const stats = shapeStats({ outer: unit.outer, holes: unit.holes });
  const trueSize = profile.true_size === true && Array.isArray(profile.outer_mm);
  return [
    dieNo, plant, profileNumber || null, 'profile-drawing', String(formId), drawingSha || null, drawingPath, profile.style || null,
    jsonOrNull(outer), jsonOrNull(holes), jsonOrNull(signature), holes.length,
    Number.isInteger(cavities) && cavities > 0 ? cavities : null, dieType, finiteOrNull(stats.aspectRatio), finiteOrNull(stats.solidity),
    trueSize, trueSize ? jsonOrNull(profile.outer_mm) : null, trueSize ? jsonOrNull(profile.holes_mm || []) : null,
    trueSize ? finiteOrNull(profile.ccd_mm) : null,
    trueSize ? profile.true_size_source || null : null, trueSize ? profile.true_size_confidence || null : null,
    !!profile.needs_review, profile.review_reason ?? null,
  ];
}

// One transaction: the form row, its profile-drawing shape (when a traced profile came with it),
// unverified toolings for unknown typed numbers, and the die's 'new-order-form' links. Returns the
// form row. Caches are dropped after COMMIT: a new shape and possibly a new tooling exist.
async function recordForm(client, {
  user, plant, dieNo, profileNumber = null, customer = null, press = null, dieSize = null, cavities = null, values,
  chosen = null, candidates = null, profile = null, drawingPath, formPdfPath, drawingSha = null,
}) {
  const normPlant = normalizePlant(plant);
  const cav = Number.isInteger(cavities) && cavities > 0 ? cavities : null;
  await client.query('BEGIN');
  try {
    const { rows } = await client.query(INSERT_FORM, [
      normPlant, dieNo, profileNumber || null, customer || null, press || null, dieSize || null, cav, JSON.stringify(values || {}),
      chosen ? chosen.tooling : null, chosen ? chosen.kind || null : null, !!(chosen && chosen.fromFinder),
      jsonOrNull(candidates), drawingPath, formPdfPath, user && user.id ? user.id : null,
    ]);
    let form = rows[0];
    if (profile) {
      const shape = await client.query(UPSERT_DRAWING_SHAPE, drawingShapeParams({
        formId: form.id, dieNo, plant: normPlant, profileNumber, cavities: cav, dieType: dieTypeOf(values),
        drawingSha, drawingPath, profile,
      }));
      if (shape.rows[0]) {
        const updated = await client.query(
          'UPDATE new_die_order_forms SET profile_shape_id = $1 WHERE id = $2 RETURNING *',
          [shape.rows[0].id, form.id],
        );
        form = updated.rows[0];
      }
    }
    const insertNo = values && values.INSERT_NO;
    const bolsterNo = values && values.BOLSTER_NO;
    await ensureToolingRows(client, { plant: normPlant, numbers: [{ raw: insertNo, kind: 'insert' }, { raw: bolsterNo, kind: 'bolster' }] });
    await recordOrderToolingLinks(client, { dieNo, plant: normPlant, insertNo, bolsterNo, source: 'new-order-form' });
    await client.query('COMMIT');
    profileSimilarity.invalidate(normPlant);
    toolingFinder.invalidate(normPlant);
    return form;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

module.exports = { formPaths, recordForm, ensureToolingRows, dieTypeOf };
