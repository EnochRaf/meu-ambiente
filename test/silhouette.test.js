import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceContours, polygonArea, simplifyLoop, silhouette } from '../src/cutout.js';

const grid = (w, h, fn) => { const c = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c[y * w + x] = fn(x, y) ? 1 : 0; return c; };

test('traceContours walks a rectangle into one closed loop', () => {
  const loops = traceContours(grid(10, 8, (x, y) => x >= 2 && x < 7 && y >= 1 && y < 6), 10, 8);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 20, 'perimeter in cell steps');
  assert.equal(Math.abs(polygonArea(loops[0])), 25);
});

test('a ring produces an outline and a hole with opposite orientation', () => {
  const cells = grid(12, 12, (x, y) => x >= 1 && x < 11 && y >= 1 && y < 11 && !(x >= 4 && x < 8 && y >= 4 && y < 8));
  const loops = traceContours(cells, 12, 12);
  assert.equal(loops.length, 2);
  const areas = loops.map(polygonArea);
  assert.ok(Math.sign(areas[0]) !== Math.sign(areas[1]));
  const s = silhouette(cells, 12, 12);
  assert.equal(s.holes.length, 1);
  assert.ok(Math.abs(polygonArea(s.outer)) > Math.abs(polygonArea(s.holes[0])));
});

test('simplifyLoop removes staircase points but keeps corners', () => {
  const cells = grid(20, 20, (x, y) => x >= 2 && x < 18 && y >= 2 && y < 18);
  const loop = traceContours(cells, 20, 20)[0];
  const simple = simplifyLoop(loop, 0.8);
  assert.ok(simple.length <= 6 && simple.length >= 4, `${simple.length} points`);
  assert.ok(Math.abs(Math.abs(polygonArea(simple)) - 256) < 1e-9);
});

test('a diagonal edge simplifies to few points and keeps most of its area', () => {
  const cells = grid(30, 30, (x, y) => x >= 2 && x < 28 && y >= 2 && y < 28 && y >= x - 4);
  const s = silhouette(cells, 30, 30);
  assert.ok(s.outer.length < 12, `${s.outer.length} points`);
  const full = Math.abs(polygonArea(traceContours(cells, 30, 30)[0]));
  assert.ok(Math.abs(Math.abs(polygonArea(s.outer)) - full) / full < 0.05);
});

test('tiny specks are dropped as holes and empty grids return null', () => {
  const cells = grid(40, 40, (x, y) => x >= 1 && x < 39 && y >= 1 && y < 39 && !(x === 20 && y === 20));
  assert.equal(silhouette(cells, 40, 40).holes.length, 0);
  assert.equal(silhouette(new Uint8Array(16), 4, 4), null);
});
