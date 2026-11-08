// DXF reader: parses AutoCAD DXF text into raw entities, then flattens them into
// polyline chains and texts (drawing units; callers multiply by `unitScale` for mm).

const MAX_INSERT_DEPTH = 8;
const SEGMENT_ANGLE = Math.PI / 16; // at least 8 segments per quadrant

function parseDxf(text) {
  const lines = String(text).split(/\r?\n/);
  const header = { insunits: null };
  const blocks = new Map();
  const blockBases = new Map();
  const entities = [];

  let section = null;
  let headerVar = null;
  let current = null; // entity being collected
  let currentBlock = null; // { name, base, entities }

  const finishEntity = () => {
    if (!current) return;
    if (current.type === 'BLOCK') {
      const nameGroup = current.groups.find(([c]) => c === 2);
      const bx = current.groups.find(([c]) => c === 10);
      const by = current.groups.find(([c]) => c === 20);
      currentBlock = {
        name: nameGroup ? nameGroup[1].trim() : '',
        base: [bx ? parseFloat(bx[1]) : 0, by ? parseFloat(by[1]) : 0],
        entities: [],
      };
    } else if (current.type === 'ENDBLK') {
      if (currentBlock) {
        blocks.set(currentBlock.name, currentBlock.entities);
        blockBases.set(currentBlock.name, currentBlock.base);
      }
      currentBlock = null;
    } else if (section === 'BLOCKS' && currentBlock) {
      currentBlock.entities.push(current);
    } else if (section === 'ENTITIES') {
      entities.push(current);
    }
    current = null;
  };

  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeText = lines[i].trim();
    if (!/^-?\d+$/.test(codeText)) { i -= 1; continue; } // resync on stray lines
    const code = parseInt(codeText, 10);
    const value = lines[i + 1];

    if (code === 0) {
      const type = value.trim();
      headerVar = null;
      finishEntity();
      if (type === 'SECTION') { section = ''; current = { type: 'SECTION', layer: '0', groups: [] }; continue; }
      if (type === 'ENDSEC') { section = null; continue; }
      if (type === 'EOF') break;
      if (section === 'BLOCKS' || section === 'ENTITIES') current = { type, layer: '0', groups: [] };
      continue;
    }
    if (current && current.type === 'SECTION') {
      if (code === 2) { section = value.trim(); current = null; }
      continue;
    }
    if (section === 'HEADER') {
      if (code === 9) headerVar = value.trim();
      else if (headerVar === '$INSUNITS' && code === 70) header.insunits = parseInt(value.trim(), 10);
      continue;
    }
    if (current) {
      if (code === 8) current.layer = value.trim();
      current.groups.push([code, value]);
    }
  }
  finishEntity();

  return { header, blocks, blockBases, entities };
}

// ---------- geometry helpers ----------

const num = (v) => parseFloat(v);
const first = (groups, code, fallback) => {
  const g = groups.find(([c]) => c === code);
  return g ? num(g[1]) : fallback;
};
const all = (groups, code) => groups.filter(([c]) => c === code).map(([, v]) => num(v));

function segmentCount(sweep, radius, tol) {
  const s = Math.abs(sweep);
  const ratio = Math.min(1, Math.max(-1, 1 - tol / Math.max(radius, 1e-9)));
  const byChord = 2 * Math.acos(ratio);
  const chordN = byChord > 1e-9 ? Math.ceil(s / byChord) : 1;
  return Math.max(1, Math.ceil(s / SEGMENT_ANGLE), chordN);
}

// Points along an arc, ending exactly at the sweep end; the start point is included on request.
function arcPoints(cx, cy, r, a0, sweep, tol, includeStart) {
  const n = segmentCount(sweep, r, tol);
  const pts = [];
  for (let k = includeStart ? 0 : 1; k <= n; k++) {
    const a = a0 + (sweep * k) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

function bulgeSegment(p1, p2, bulge, tol) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const c = Math.hypot(dx, dy);
  if (!bulge || c < 1e-12) return [p2];
  const d = (c / 2) * ((1 - bulge * bulge) / (2 * bulge));
  const cx = (p1[0] + p2[0]) / 2 + (-dy / c) * d;
  const cy = (p1[1] + p2[1]) / 2 + (dx / c) * d;
  const r = Math.hypot(p1[0] - cx, p1[1] - cy);
  const a0 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const pts = arcPoints(cx, cy, r, a0, 4 * Math.atan(bulge), tol, false);
  pts[pts.length - 1] = p2; // land exactly on the vertex
  return pts;
}

function polylinePoints(vertices, closed, tol) {
  if (!vertices.length) return [];
  const pts = [[vertices[0].x, vertices[0].y]];
  const segs = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    pts.push(...bulgeSegment([a.x, a.y], [b.x, b.y], a.bulge, tol));
  }
  if (closed && pts.length > 1) pts.pop(); // last point repeats the first
  return pts;
}

function lwVertices(groups) {
  const vs = [];
  for (const [code, value] of groups) {
    if (code === 10) vs.push({ x: num(value), y: 0, bulge: 0 });
    else if (code === 20 && vs.length) vs[vs.length - 1].y = num(value);
    else if (code === 42 && vs.length) vs[vs.length - 1].bulge = num(value);
  }
  return vs;
}

function ellipsePoints(groups, tol) {
  const cx = first(groups, 10, 0), cy = first(groups, 20, 0);
  const mx = first(groups, 11, 1), my = first(groups, 21, 0);
  const ratio = first(groups, 40, 1);
  const t0 = first(groups, 41, 0);
  let t1 = first(groups, 42, 2 * Math.PI);
  if (t1 <= t0) t1 += 2 * Math.PI;
  const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-9;
  const n = segmentCount(t1 - t0, Math.hypot(mx, my), tol);
  const pts = [];
  for (let k = 0; k <= (full ? n - 1 : n); k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    const ct = Math.cos(t), st = Math.sin(t) * ratio;
    pts.push([cx + ct * mx - st * my, cy + ct * my + st * mx]);
  }
  return { points: pts, closed: full };
}

function pairsOf(groups, xCode, yCode) {
  const out = [];
  let cur = null;
  for (const [code, value] of groups) {
    if (code === xCode) { cur = [num(value), 0]; out.push(cur); }
    else if (code === yCode && cur) cur[1] = num(value);
  }
  return out;
}

function splinePoints(groups) {
  const degree = first(groups, 71, 3);
  const knots = all(groups, 40);
  const weights = all(groups, 41);
  const ctrl = pairsOf(groups, 10, 20);
  const closed = (first(groups, 70, 0) & 1) === 1;
  const n = ctrl.length;
  if (n > degree && knots.length === n + degree + 1) {
    const w = weights.length === n ? weights : new Array(n).fill(1);
    // de Boor on homogeneous coordinates, evaluated in knot span k
    const evalAt = (k, t) => {
      const d = [];
      for (let j = 0; j <= degree; j++) {
        const idx = j + k - degree;
        d.push([ctrl[idx][0] * w[idx], ctrl[idx][1] * w[idx], w[idx]]);
      }
      for (let r = 1; r <= degree; r++) {
        for (let j = degree; j >= r; j--) {
          const lo = knots[j + k - degree], hi = knots[j + 1 + k - r];
          const alpha = hi - lo === 0 ? 0 : (t - lo) / (hi - lo);
          for (let c = 0; c < 3; c++) d[j][c] = (1 - alpha) * d[j - 1][c] + alpha * d[j][c];
        }
      }
      const res = d[degree];
      return [res[0] / res[2], res[1] / res[2]];
    };
    const pts = [];
    let lastSpan = -1;
    for (let i = degree; i < n; i++) {
      const a = knots[i], b = knots[i + 1];
      if (!(b > a)) continue;
      lastSpan = i;
      for (let s = 0; s < 16; s++) pts.push(evalAt(i, a + ((b - a) * s) / 16));
    }
    if (lastSpan >= 0) pts.push(evalAt(lastSpan, knots[lastSpan + 1]));
    if (pts.length) return { points: pts, closed };
  }
  return { points: pairsOf(groups, 11, 21), closed }; // fit points only
}

// ---------- text ----------

function plainText(value) {
  let s = String(value == null ? '' : value);
  s = s.replace(/\\P/g, ' ');
  s = s.replace(/\\~/g, ' ');
  s = s.replace(/\\[fFHWCTQApc][^;]*;/g, '');
  s = s.replace(/\\[LlOoKk]/g, '');
  s = s.replace(/\^[MJI]/g, '');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\\\\/g, '\\');
  s = s.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%');
  return s.replace(/\s+/g, ' ').trim();
}

function textValue(entity) {
  if (entity.type === 'MTEXT') {
    const chunks = entity.groups.filter(([c]) => c === 3).map(([, v]) => v).join('');
    const tail = entity.groups.filter(([c]) => c === 1).map(([, v]) => v).join('');
    return plainText(chunks + tail);
  }
  const g = entity.groups.find(([c]) => c === 1);
  return plainText(g ? g[1] : '');
}

// ---------- transforms: [a, b, c, d, e, f]  x' = a x + c y + e,  y' = b x + d y + f ----------

const IDENTITY = [1, 0, 0, 1, 0, 0];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
// compose(p, c): apply c first, then p
const compose = (p, c) => [
  p[0] * c[0] + p[2] * c[1], p[1] * c[0] + p[3] * c[1],
  p[0] * c[2] + p[2] * c[3], p[1] * c[2] + p[3] * c[3],
  p[0] * c[4] + p[2] * c[5] + p[4], p[1] * c[4] + p[3] * c[5] + p[5],
];

// translate(insertion) · rotate · scale · translate(-blockBase)
function insertTransform(groups, base) {
  const tx = first(groups, 10, 0), ty = first(groups, 20, 0);
  const sx = first(groups, 41, 1), sy = first(groups, 42, 1);
  const rot = (first(groups, 50, 0) * Math.PI) / 180;
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const a = cs * sx, b = sn * sx, c = -sn * sy, d = cs * sy;
  return [a, b, c, d, tx - (a * base[0] + c * base[1]), ty - (b * base[0] + d * base[1])];
}

function flattenDxf(dxf, { chordTolerance = 0.1 } = {}) {
  const tol = chordTolerance;
  const chains = [];
  const texts = [];

  const emitChain = (layer, source, points, closed, m) => {
    if (points.length < 2) return;
    chains.push({ layer, points: points.map((p) => apply(m, p)), closed, source });
  };

  const walk = (ents, m, depth, parentLayer) => {
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      const g = e.groups;
      const layer = e.layer === '0' && parentLayer ? parentLayer : e.layer;
      switch (e.type) {
        case 'LINE':
          emitChain(layer, 'LINE', [[first(g, 10, 0), first(g, 20, 0)], [first(g, 11, 0), first(g, 21, 0)]], false, m);
          break;
        case 'ARC': {
          const a0 = (first(g, 50, 0) * Math.PI) / 180;
          let a1 = (first(g, 51, 360) * Math.PI) / 180;
          if (a1 <= a0) a1 += 2 * Math.PI;
          emitChain(layer, 'ARC', arcPoints(first(g, 10, 0), first(g, 20, 0), first(g, 40, 0), a0, a1 - a0, tol, true), false, m);
          break;
        }
        case 'CIRCLE': {
          const pts = arcPoints(first(g, 10, 0), first(g, 20, 0), first(g, 40, 0), 0, 2 * Math.PI, tol, true);
          pts.pop(); // last point repeats the first
          emitChain(layer, 'CIRCLE', pts, true, m);
          break;
        }
        case 'LWPOLYLINE': {
          const closed = (first(g, 70, 0) & 1) === 1;
          emitChain(layer, 'LWPOLYLINE', polylinePoints(lwVertices(g), closed, tol), closed, m);
          break;
        }
        case 'POLYLINE': {
          const closed = (first(g, 70, 0) & 1) === 1;
          const vs = [];
          while (i + 1 < ents.length && ents[i + 1].type === 'VERTEX') {
            i++;
            const vg = ents[i].groups;
            if ((first(vg, 70, 0) & 16) === 0) vs.push({ x: first(vg, 10, 0), y: first(vg, 20, 0), bulge: first(vg, 42, 0) });
          }
          if (i + 1 < ents.length && ents[i + 1].type === 'SEQEND') i++;
          emitChain(layer, 'POLYLINE', polylinePoints(vs, closed, tol), closed, m);
          break;
        }
        case 'ELLIPSE': {
          const { points, closed } = ellipsePoints(g, tol);
          emitChain(layer, 'ELLIPSE', points, closed, m);
          break;
        }
        case 'SPLINE': {
          const { points, closed } = splinePoints(g);
          emitChain(layer, 'SPLINE', points, closed, m);
          break;
        }
        case 'TEXT':
        case 'MTEXT': {
          const value = textValue(e);
          if (!value) break;
          const [x, y] = apply(m, [first(g, 10, 0), first(g, 20, 0)]);
          texts.push({ layer, value, x, y });
          break;
        }
        case 'INSERT': {
          if (depth >= MAX_INSERT_DEPTH) break;
          const nameG = g.find(([c]) => c === 2);
          const name = nameG && nameG[1].trim();
          const block = name && dxf.blocks.get(name);
          if (!block) break;
          const base = (dxf.blockBases && dxf.blockBases.get(name)) || [0, 0];
          walk(block, compose(m, insertTransform(g, base)), depth + 1, layer);
          break;
        }
        default:
          break; // DIMENSION, HATCH, LEADER, POINT, SOLID, IMAGE, ATTRIB, VIEWPORT ...
      }
    }
  };

  walk(dxf.entities, IDENTITY, 0, null);
  const insunits = dxf.header.insunits;
  const unitScale = insunits === 1 ? 25.4 : insunits === 2 ? 304.8 : 1;
  return { chains, texts, unitScale };
}

module.exports = { parseDxf, flattenDxf, plainText };
