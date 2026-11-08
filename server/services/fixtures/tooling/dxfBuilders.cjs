// Minimal DXF group-code builders for tests. Each returns the text of one entity.
const g = (code, value) => `${String(code).padStart(3, ' ')}\n${value}\n`;

const line = (x1, y1, x2, y2) => g(0, 'LINE') + g(8, '0') + g(10, x1) + g(20, y1) + g(11, x2) + g(21, y2);
// Optional extrusion normal: `normal: -1` emits (0, 0, -1); `normal: [nx, ny, nz]` emits that vector.
const extrusion = (normal) => {
  if (normal === undefined) return '';
  const [nx, ny, nz] = Array.isArray(normal) ? normal : [0, 0, normal];
  return g(210, nx) + g(220, ny) + g(230, nz);
};
const arc = (cx, cy, r, startDeg, endDeg, { normal } = {}) =>
  g(0, 'ARC') + g(8, '0') + g(10, cx) + g(20, cy) + g(40, r) + g(50, startDeg) + g(51, endDeg) + extrusion(normal);
const circleEntity = (cx, cy, r, { normal } = {}) =>
  g(0, 'CIRCLE') + g(8, '0') + g(10, cx) + g(20, cy) + g(40, r) + extrusion(normal);
const lwpolyline = (points, { closed = false, bulges = [], normal } = {}) =>
  g(0, 'LWPOLYLINE') + g(8, '0') + g(90, points.length) + g(70, closed ? 1 : 0) +
  points.map(([x, y], i) => g(10, x) + g(20, y) + (bulges[i] ? g(42, bulges[i]) : '')).join('') + extrusion(normal);
const insert = (blockName, x, y, scale = 1, rotationDeg = 0) =>
  g(0, 'INSERT') + g(8, '0') + g(2, blockName) + g(10, x) + g(20, y) + g(41, scale) + g(42, scale) + g(50, rotationDeg);
const rectLines = (w, h, cx = 0, cy = 0) => {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - h / 2, y1 = cy + h / 2;
  return [line(x0, y0, x1, y0), line(x1, y0, x1, y1), line(x1, y1, x0, y1), line(x0, y1, x0, y0)];
};
const text = (value, x, y) => g(0, 'TEXT') + g(8, '0') + g(10, x) + g(20, y) + g(40, 2.5) + g(1, value);

const dxfOf = ({ insunits = 4, blocks = {}, entities = [] } = {}) => {
  const flat = entities.flat();
  let out = g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$INSUNITS') + g(70, insunits) + g(0, 'ENDSEC');
  out += g(0, 'SECTION') + g(2, 'BLOCKS');
  for (const [name, ents] of Object.entries(blocks)) {
    out += g(0, 'BLOCK') + g(2, name) + g(10, 0) + g(20, 0) + [].concat(ents).join('') + g(0, 'ENDBLK');
  }
  out += g(0, 'ENDSEC') + g(0, 'SECTION') + g(2, 'ENTITIES') + flat.join('') + g(0, 'ENDSEC') + g(0, 'EOF');
  return out;
};

module.exports = { dxfOf, line, arc, circleEntity, lwpolyline, insert, rectLines, text };
