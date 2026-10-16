import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backgroundMask, featherMask, cropBounds, bleedEdges, extrudeMask } from '../src/cutout.js';

// 20x20 white image with a dark 8x10 block in the middle and a hole-free border
function sample() {
  const w = 20, h = 20, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 5; y < 15; y++) for (let x = 6; x < 14; x++) { const i = (y * w + x) * 4; data[i] = 90; data[i + 1] = 60; data[i + 2] = 40; }
  return { w, h, data };
}

test('backgroundMask keeps the object and drops the white border', () => {
  const { w, h, data } = sample();
  const m = backgroundMask(data, w, h, 40);
  assert.equal(m[0], 0); assert.equal(m[10 * w + 10], 1);
  assert.equal(m.reduce((a, b) => a + b, 0), 80);
});

test('backgroundMask follows gentle gradients but not strong edges', () => {
  const w = 30, h = 10, data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const v = 255 - x * 3; data[i] = data[i + 1] = data[i + 2] = v; }
  for (let y = 3; y < 7; y++) for (let x = 20; x < 24; x++) { const i = (y * w + x) * 4; data[i] = 10; data[i + 1] = 10; data[i + 2] = 10; }
  const m = backgroundMask(data, w, h, 30);
  assert.equal(m[5 * w + 15], 0, 'gradient background is still background');
  assert.equal(m[5 * w + 21], 1, 'dark block survives');
});

test('featherMask softens edges and cropBounds pads the box', () => {
  const { w, h, data } = sample();
  const alpha = featherMask(backgroundMask(data, w, h, 40), w, h);
  assert.equal(alpha[10 * w + 10], 255);
  assert.ok(alpha[5 * w + 6] > 0 && alpha[5 * w + 6] < 255, 'corner pixel is partially transparent');
  assert.deepEqual(cropBounds(alpha, w, h, 2), { x0: 4, y0: 3, x1: 15, y1: 16 });
  assert.equal(cropBounds(new Uint8ClampedArray(w * h), w, h), null);
});

test('bleedEdges paints transparent pixels with the average object colour', () => {
  const { w, h, data } = sample();
  const alpha = featherMask(backgroundMask(data, w, h, 40), w, h);
  bleedEdges(data, alpha, w, h);
  assert.deepEqual([data[0], data[1], data[2]], [90, 60, 40]);
});

test('extrudeMask builds front, back and only exposed sides', () => {
  // 2x1 grid, both filled: 2 front + 2 back + left + right + 2 top + 2 bottom = 10 quads
  const g = extrudeMask(new Uint8Array([1, 1]), 2, 1, { width: 1, height: 0.5, depth: 0.2, kind: 'floor' });
  assert.equal(g.indices.length / 6, 10);
  assert.equal(g.positions.length / 3, 40);
  const ys = Array.from(g.positions).filter((_, i) => i % 3 === 1);
  assert.equal(Math.min(...ys), 0); assert.equal(Math.max(...ys), 0.5);
  const zs = Array.from(g.positions).filter((_, i) => i % 3 === 2);
  assert.ok(Math.abs(Math.min(...zs) + 0.1) < 1e-6 && Math.abs(Math.max(...zs) - 0.1) < 1e-6, 'floor items centred in depth');
  const wall = extrudeMask(new Uint8Array([1]), 1, 1, { width: 1, height: 1, depth: 0.1, kind: 'wall' });
  const wys = Array.from(wall.positions).filter((_, i) => i % 3 === 1), wzs = Array.from(wall.positions).filter((_, i) => i % 3 === 2);
  assert.equal(Math.min(...wys), -0.5); assert.equal(Math.min(...wzs), 0); assert.ok(Math.abs(Math.max(...wzs) - 0.1) < 1e-6);
  const empty = extrudeMask(new Uint8Array([0]), 1, 1, { width: 1, height: 1, depth: 0.1, kind: 'floor' });
  assert.equal(empty.indices.length, 0);
});

test('extrudeMask uvs keep row 0 at the top of the picture', () => {
  const g = extrudeMask(new Uint8Array([1, 1]), 1, 2, { width: 1, height: 1, depth: 0.1, kind: 'floor' });
  // first quad is the front of the top cell: v spans 0.5..1
  const v = [g.uvs[1], g.uvs[3], g.uvs[5], g.uvs[7]];
  assert.deepEqual([Math.min(...v), Math.max(...v)], [0.5, 1]);
});
