import { test } from 'node:test';
import assert from 'node:assert/strict';
import { erodeMask, featherMaskRadius, defringe, sharpness, tiltHint, dominantColors, rgbToHex, backgroundMask } from '../src/cutout.js';

function block(w, h, x0, y0, x1, y1) { const m = new Uint8Array(w * h); for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1; return m; }

test('erodeMask peels one pixel per pass', () => {
  const m = block(10, 10, 2, 2, 8, 8);
  const e = erodeMask(m, 10, 10, 1);
  assert.equal(e.reduce((a, b) => a + b, 0), 16);
  assert.equal(erodeMask(m, 10, 10, 3).reduce((a, b) => a + b, 0), 0);
});

test('featherMaskRadius ramps over the radius', () => {
  const a = featherMaskRadius(block(20, 20, 5, 5, 15, 15), 20, 20, 2);
  assert.equal(a[10 * 20 + 10], 255);
  assert.ok(a[10 * 20 + 5] > 60 && a[10 * 20 + 5] < 200, `edge ${a[10 * 20 + 5]}`);
  assert.equal(a[10 * 20 + 1], 0);
});

test('defringe pulls edge colours from the opaque interior', () => {
  const w = 10, h = 10, data = new Uint8ClampedArray(w * h * 4).fill(255);
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (x >= 3 && x < 7) { alpha[i] = 255; data[i * 4] = 200; data[i * 4 + 1] = 30; data[i * 4 + 2] = 30; } else if (x === 2 || x === 7) alpha[i] = 120; }
  const out = defringe(data, alpha, w, h, 2);
  const i = 5 * w + 2;
  assert.deepEqual([out[i * 4], out[i * 4 + 1], out[i * 4 + 2]], [200, 30, 30]);
  assert.equal(out[(5 * w + 0) * 4], 255, 'fully transparent pixels untouched');
});

test('sharpness is higher for a crisp edge than for a blur', () => {
  const w = 40, h = 40;
  const crisp = new Uint8ClampedArray(w * h * 4), soft = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const c = x < 20 ? 0 : 255, s = Math.max(0, Math.min(255, (x - 10) * 12.75));
    crisp[i] = crisp[i + 1] = crisp[i + 2] = c; soft[i] = soft[i + 1] = soft[i + 2] = s;
  }
  assert.ok(sharpness(crisp, w, h) > sharpness(soft, w, h) * 5);
});

test('tiltHint sees a slanted underside', () => {
  const w = 30, h = 30, level = new Uint8ClampedArray(w * h), tilted = new Uint8ClampedArray(w * h);
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) { level[y * w + x] = 255; if (y < 25 - Math.round((x - 5) * 0.5)) tilted[y * w + x] = 255; }
  assert.equal(tiltHint(level, w, h), 0);
  assert.ok(tiltHint(tilted, w, h) > 0.3, `${tiltHint(tilted, w, h)}`);
});

test('dominantColors finds the two main colours', () => {
  const w = 40, h = 40, data = new Uint8ClampedArray(w * h * 4), alpha = new Uint8ClampedArray(w * h).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (x < 30) { data[i] = 180; data[i + 1] = 60; data[i + 2] = 40; } else { data[i] = 30; data[i + 1] = 40; data[i + 2] = 120; } }
  const cols = dominantColors(data, alpha, w, h, 3);
  assert.ok(cols[0].share > 0.6 && Math.abs(cols[0].rgb[0] - 180) < 6, JSON.stringify(cols));
  assert.equal(rgbToHex([255, 0, 16]), '#ff0010');
});

test('erode + feather removes the halo of a region-grown mask', () => {
  // dark object on white: the grown mask keeps a bright 1px ring; eroding it removes the ring
  const w = 30, h = 30, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 8; y < 22; y++) for (let x = 8; x < 22; x++) { const i = (y * w + x) * 4; data[i] = 40; data[i + 1] = 40; data[i + 2] = 40; }
  for (let x = 8; x < 22; x++) { const i = (7 * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 170; } // soft bright fringe row
  const m = backgroundMask(data, w, h, 40);
  assert.equal(m[7 * w + 10], 1, 'fringe row counted as object by the grower');
  assert.equal(erodeMask(m, w, h, 1)[7 * w + 10], 0, 'erosion drops it');
});

test('extrudeMask puts front faces first and reports their count', async () => {
  const { extrudeMask } = await import('../src/cutout.js');
  const g = extrudeMask(new Uint8Array([1, 1]), 2, 1, { width: 1, height: 0.5, depth: 0.2, kind: 'floor' });
  assert.equal(g.frontCount, 12, 'two front quads');
  assert.equal(g.indices.length / 6, 10);
  for (let q = 0; q < 2; q++) assert.equal(g.normals[g.indices[q * 6] * 3 + 2], 1, 'front quads face +z');
  assert.equal(Math.max(...g.indices), g.positions.length / 3 - 1, 'indices stay in range');
});
