import test from 'node:test';
import assert from 'node:assert/strict';
import { extractProfile, inkMask, connectedComponents, chooseProfile } from './profileImage.js';

const BLACK = [0, 0, 0];
const BLUE = [40, 60, 220];

// A white RGBA sheet with a few filled rectangles on it.
function sheet(width, height, rects) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const { x, y, w, h, color } of rects) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const o = (yy * width + xx) * 4;
        [data[o], data[o + 1], data[o + 2]] = color;
      }
    }
  }
  return { data, width, height };
}

// A rectangle outline (the frame) as four bars.
const frame = (x, y, w, h, t, color = BLACK) => [
  { x, y, w, h: t, color }, { x, y: y + h - t, w, h: t, color },
  { x, y, w: t, h, color }, { x: x + w - t, y, w: t, h, color },
];

const at = (img, x, y) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

test('ink is dark and unsaturated: black counts, blue dimension lines do not', () => {
  const img = sheet(2, 1, [{ x: 0, y: 0, w: 1, h: 1, color: BLACK }, { x: 1, y: 0, w: 1, h: 1, color: BLUE }]);
  assert.deepEqual(Array.from(inkMask(img)), [1, 0]);
});

test('components are 8-connected and measured', () => {
  const mask = Uint8Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]); // a diagonal
  const { stats } = connectedComponents(mask, 3, 3);
  assert.equal(stats.length, 1);
  assert.deepEqual(stats[0], { id: 1, area: 3, x: 0, y: 0, w: 3, h: 3 });
});

test('the sheet border is never the profile', () => {
  const stats = [{ id: 1, area: 9000, x: 0, y: 0, w: 1000, h: 1000 }, { id: 2, area: 500, x: 100, y: 100, w: 300, h: 300 }];
  assert.equal(chooseProfile(stats, 1000, 1000).id, 2);
});

test('the profile is cut out alone: border, dimensions and loose text are dropped', () => {
  const img = sheet(800, 800, [
    ...frame(0, 0, 800, 800, 4),                          // sheet border
    ...frame(200, 200, 300, 200, 8),                      // the profile: a hollow box
    { x: 150, y: 300, w: 400, h: 2, color: BLUE },        // a dimension line across it
    { x: 330, y: 290, w: 20, h: 20, color: BLACK },       // a note printed inside the bore
    { x: 600, y: 650, w: 30, h: 30, color: BLACK },       // a stray mark elsewhere
  ]);
  const out = extractProfile(img);
  assert.ok(out, 'a profile is found');
  // Tight to the 300x200 box plus the margin on each side.
  assert.ok(out.width >= 300 && out.width <= 340, `width ${out.width}`);
  assert.ok(out.height >= 200 && out.height <= 240, `height ${out.height}`);
  const left = Math.round((out.width - 300) / 2);
  const top = Math.round((out.height - 200) / 2);
  assert.deepEqual(at(out, left + 2, top + 50), BLACK, 'the outline is kept');
  assert.deepEqual(at(out, left + 140, top + 100), [255, 255, 255], 'the note inside the bore is gone');
  assert.deepEqual(at(out, left + 100, top + 100), [255, 255, 255], 'the dimension line is gone');
});

test('a sheet with nothing but its border has no profile', () => {
  assert.equal(extractProfile(sheet(400, 400, frame(0, 0, 400, 400, 4))), null);
});
