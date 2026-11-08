'use strict';
// A small pure-JS PNG decoder for pictures posted to the server. @napi-rs/canvas's loadImage
// segfaults on some corrupt PNGs (a valid signature followed by junk kills the process), so a
// picture from a request is never handed to it: this decoder throws a plain Error instead.
// Supports what browsers and drawing tools write: 8-bit greyscale, RGB, palette, grey+alpha
// and RGBA, non-interlaced. Output matches profileRaster.decodeImage: RGBA flattened onto white.
const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PIXELS = 40e6;
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  const idat = [];
  let ended = false;
  while (off + 12 <= buffer.length) {
    const len = buffer.readUInt32BE(off);
    const type = buffer.toString('latin1', off + 4, off + 8);
    const start = off + 8;
    if (start + len + 4 > buffer.length) throw new Error(`PNG chunk ${type} runs past the end of the file`);
    const body = buffer.subarray(start, start + len);
    if (type === 'IHDR') {
      if (len !== 13) throw new Error('bad PNG header');
      ihdr = {
        width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') { ended = true; break; }
    off = start + len + 4;
  }
  if (!ihdr) throw new Error('PNG has no header');
  if (!ended) throw new Error('PNG is truncated');
  const { width, height, depth, color, interlace } = ihdr;
  const channels = CHANNELS[color];
  if (!width || !height || width * height > MAX_PIXELS) throw new Error(`PNG size ${width}x${height} not accepted`);
  if (depth !== 8 || !channels) throw new Error(`unsupported PNG format (bit depth ${depth}, colour type ${color})`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  if (color === 3 && !palette) throw new Error('palette PNG without a palette');

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { throw new Error(`PNG image data is corrupt: ${e.message}`); }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) throw new Error('PNG image data is short');

  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    const prev = row - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= channels ? px[row + i - channels] : 0;
      const b = y > 0 ? px[prev + i] : 0;
      const c = y > 0 && i >= channels ? px[prev + i - channels] : 0;
      let v;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) v = x + paeth(a, b, c);
      else throw new Error(`bad PNG row filter ${filter}`);
      px[row + i] = v & 0xff;
    }
  }

  // RGBA, flattened onto white like decodeImage's white canvas.
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    let r; let g; let b; let alpha = 255;
    const s = p * channels;
    if (color === 0) { r = g = b = px[s]; }
    else if (color === 2) { r = px[s]; g = px[s + 1]; b = px[s + 2]; }
    else if (color === 3) {
      const k = px[s];
      if (3 * k + 2 >= palette.length) throw new Error('PNG palette index out of range');
      r = palette[3 * k]; g = palette[3 * k + 1]; b = palette[3 * k + 2];
      if (trns && k < trns.length) alpha = trns[k];
    } else if (color === 4) { r = g = b = px[s]; alpha = px[s + 1]; }
    else { r = px[s]; g = px[s + 1]; b = px[s + 2]; alpha = px[s + 3]; }
    const q = p * 4;
    const t = alpha / 255;
    data[q] = r * t + 255 * (1 - t);
    data[q + 1] = g * t + 255 * (1 - t);
    data[q + 2] = b * t + 255 * (1 - t);
    data[q + 3] = 255;
  }
  return { data, width, height };
}

module.exports = { decodePng };
