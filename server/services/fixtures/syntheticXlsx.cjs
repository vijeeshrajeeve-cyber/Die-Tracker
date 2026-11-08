'use strict';
// Test helper: builds a small synthetic .xlsx in memory (workbook, rels, shared strings, sheets,
// drawings with picture anchors, media) and opens it as a `{ entries, read }` zip object, the
// shape `openZip` returns. buildZip and its CRC-32 table are copied from zipReader.test.cjs.
const zlib = require('node:zlib');
const { listEntries, readEntry } = require('../zipReader.cjs');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Builds a zip from [{ name, data: Buffer, deflate?: bool }].
function buildZip(files, { comment = '' } = {}) {
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const method = f.deflate ? 8 : 0;
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(f.data), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([lh, name, body]);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(f.data), 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name])); locals.push(local); offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(Buffer.byteLength(comment), 20);
  return Buffer.concat([...locals, cd, eocd, Buffer.from(comment)]);
}

const zipFromBuffer = (buffer) => {
  const entries = new Map(listEntries(buffer).map((e) => [e.name, e]));
  return {
    entries,
    read: (name) => {
      if (!entries.has(name)) throw new Error(`Zip entry not found: ${name}`);
      return readEntry(buffer, entries.get(name));
    },
  };
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const T = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const rels = (list) => `<?xml version="1.0"?><Relationships ${REL_NS}>${list
  .map(([id, type, target]) => `<Relationship Id="${id}" Type="${T}${type}" Target="${target}"/>`).join('')}</Relationships>`;

// sheets: [{ name, rows: [{ r, cells: { A: 'text' | { inline: 'text' } | 12 } }],
//            pictures?: [{ row (1-based), media: 'image1.gif', toRow? }] }]
// media: { 'image1.gif': Buffer }. Plain strings become shared strings; numbers stay numbers.
function makeXlsx({ sheets, media = {} }) {
  const sst = [];
  const sstIndex = (s) => { let i = sst.indexOf(s); if (i < 0) { i = sst.length; sst.push(s); } return i; };
  const files = [];
  const add = (name, text) => files.push({ name, data: Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8'), deflate: !Buffer.isBuffer(text) });
  // Workbook relationship ids are deliberately out of order (rId2 before rId1) so name → path
  // must go through the rels part.
  const wbRels = [];
  const sheetTags = [];
  let drawingNo = 0;
  sheets.forEach((sheet, i) => {
    const n = i + 1;
    const rid = `rId${sheets.length - i}`;
    sheetTags.push(`<sheet name="${esc(sheet.name)}" sheetId="${n}" r:id="${rid}"/>`);
    wbRels.push([rid, 'worksheet', `worksheets/sheet${n}.xml`]);
    const rowsXml = sheet.rows.map(({ r, cells }) => `<row r="${r}" spans="1:8">${Object.entries(cells).map(([col, v]) => {
      if (typeof v === 'number') return `<c r="${col}${r}"><v>${v}</v></c>`;
      if (v && typeof v === 'object') return `<c r="${col}${r}" t="inlineStr"><is><t>${esc(v.inline)}</t></is></c>`;
      return `<c r="${col}${r}" s="2" t="s"><v>${sstIndex(v)}</v></c>`;
    }).join('')}</row>`).join('');
    let drawingTag = '';
    if (sheet.pictures) {
      drawingNo++;
      drawingTag = '<drawing r:id="rId1"/>';
      add(`xl/worksheets/_rels/sheet${n}.xml.rels`, rels([['rId1', 'drawing', `../drawings/drawing${drawingNo}.xml`]]));
      const mediaIds = new Map();
      const anchors = sheet.pictures.map((p, k) => {
        if (!mediaIds.has(p.media)) mediaIds.set(p.media, `rId${mediaIds.size + 1}`);
        const from = p.row - 1;
        const to = (p.toRow || p.row) - 1;
        return `<xdr:twoCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:colOff>25400</xdr:colOff><xdr:row>${from}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
          + `<xdr:to><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${to}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
          + `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="Pic_${k + 1}"/><xdr:cNvPicPr/></xdr:nvPicPr>`
          + `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${mediaIds.get(p.media)}" cstate="print"/></xdr:blipFill>`
          + '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>';
      });
      add(`xl/drawings/drawing${drawingNo}.xml`, '<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        + `${anchors.join('')}</xdr:wsDr>`);
      add(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, rels([...mediaIds].map(([m, id]) => [id, 'image', `../media/${m}`])));
    }
    add(`xl/worksheets/sheet${n}.xml`, `<?xml version="1.0"?><worksheet ${NS}><sheetData>${rowsXml}</sheetData>${drawingTag}</worksheet>`);
  });
  wbRels.push([`rId${sheets.length + 1}`, 'sharedStrings', 'sharedStrings.xml']);
  add('xl/workbook.xml', `<?xml version="1.0"?><workbook ${NS}><sheets>${sheetTags.join('')}</sheets></workbook>`);
  add('xl/_rels/workbook.xml.rels', rels(wbRels));
  add('xl/sharedStrings.xml', `<?xml version="1.0"?><sst ${NS} count="${sst.length}" uniqueCount="${sst.length}">${sst
    .map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`);
  for (const [m, data] of Object.entries(media)) add(`xl/media/${m}`, data);
  return zipFromBuffer(buildZip(files));
}

module.exports = { buildZip, zipFromBuffer, makeXlsx };
