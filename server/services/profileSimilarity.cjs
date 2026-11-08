'use strict';
// In-memory similarity index over profile_shapes, one per plant. Only loadIndex
// touches the database; nearest is pure.
const { signatureDistance } = require('./profileShape.cjs');

const DEFAULT_LIMIT = 20;

const STAMP_SQL = `SELECT max(updated_at) AS max_updated, count(*)::int AS n
  FROM profile_shapes WHERE plant = $1 AND needs_review = false`;
const LOAD_SQL = `SELECT id, die_no, plant, profile_number, signature, hole_count, cavities, true_size, updated_at
  FROM profile_shapes WHERE plant = $1 AND needs_review = false`;

// plant -> { stamp, rows }
const cache = new Map();

const stampKey = (r) => {
  const t = r && r.max_updated;
  return `${t instanceof Date ? t.toISOString() : String(t ?? '')}|${r ? r.n : 0}`;
};

// The cheap stamp runs every call; the full load only when it moved.
async function loadIndex(client, { plant }) {
  const { rows: [stampRow] } = await client.query(STAMP_SQL, [plant]);
  const stamp = stampKey(stampRow);
  const cached = cache.get(plant);
  if (cached && cached.stamp === stamp) return cached;
  const { rows } = await client.query(LOAD_SQL, [plant]);
  const index = { stamp, rows };
  cache.set(plant, index);
  return index;
}

function invalidate(plant) {
  cache.delete(plant);
}

const knownCount = (v) => v != null && Number.isFinite(Number(v));

// '_' and '-' are the same die-number separator (die list 13794_525, requests 13794-525).
const sameDieNo = (a, b) => String(a).replace(/_/g, '-') === String(b).replace(/_/g, '-');

function nearest(index, { signature, holeCount, cavities = null, limit = DEFAULT_LIMIT, excludeDieNo = null }) {
  const best = new Map(); // die_no -> item
  for (const r of index.rows) {
    if (r.needs_review) continue;
    if (r.hole_count !== holeCount) continue;
    if (excludeDieNo != null && sameDieNo(r.die_no, excludeDieNo)) continue;
    if (!Array.isArray(r.signature) || r.signature.length !== signature.length) continue;
    const distance = signatureDistance(signature, r.signature);
    const prev = best.get(r.die_no);
    if (prev && prev.distance <= distance) continue;
    best.set(r.die_no, {
      die_no: r.die_no,
      profile_number: r.profile_number ?? null,
      distance,
      cavityMatch: knownCount(cavities) && knownCount(r.cavities) ? Number(cavities) === Number(r.cavities) : null,
      trueSize: !!r.true_size,
      shapeId: r.id,
    });
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance).slice(0, limit);
}

module.exports = { loadIndex, nearest, invalidate, DEFAULT_LIMIT };
