import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleGrid, normalizeDepth, keepMainParts, reliefMesh, pillowDepth } from '../src/relief.js';

const grid = (w, h, fn) => { const a = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fn(x, y); return a; };
const disc = (w, h, r = 0.4) => grid(w, h, (x, y) => (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) < r * Math.min(w, h) ? 255 : 0));

test('sampleGrid averages alpha and weights depth by alpha', () => {
  const w = 8, h = 4, alpha = new Uint8Array(w * h), depth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) { alpha[i] = i % w < 4 ? 255 : 0; depth[i] = i % w < 4 ? 1 : 0; }
  const g = sampleGrid(alpha, depth, w, h, 2, 1);
  assert.deepEqual([...g.alpha], [255, 0]);
  assert.equal(g.depth[0], 1);
  assert.equal(g.depth[1], 0, 'no object pixels: plain average');
});

test('normalizeDepth maps the object to 0..1, near = 1, and leaves the outside at 0', () => {
  const w = 10, h = 10, alpha = disc(w, h, 0.45), depth = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) depth[i] = 5 + (i % w); // nearer to the right
  const d = normalizeDepth(depth, alpha, w, h, { blur: 0 });
  let lo = 1, hi = 0;
  for (let i = 0; i < w * h; i++) if (alpha[i]) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); } else assert.equal(d[i], 0);
  assert.equal(lo, 0); assert.equal(hi, 1);
  assert.ok(d[5 * w + 7] > d[5 * w + 3], 'right side is nearer');
});

test('keepMainParts drops flecks and keeps the piece', () => {
  const w = 20, h = 10, inside = grid(w, h, (x, y) => (x >= 2 && x < 14 && y >= 2 && y < 8) || (x === 18 && y === 1) ? 1 : 0);
  const kept = keepMainParts(inside, w, h);
  assert.equal(kept[1 * w + 18], 0);
  assert.equal(kept[4 * w + 5], 1);
});

test('reliefMesh builds a closed solid: front, back and sides, indices in range, photo face first', () => {
  const gw = 24, gh = 16, alpha = disc(gw, gh, 0.42);
  const depth = normalizeDepth(pillowDepth(alpha, gw, gh), alpha, gw, gh, { blur: 0 });
  const m = reliefMesh(alpha, depth, gw, gh, { width: 1.2, height: 0.8, depth: 0.5, kind: 'floor' });
  assert.ok(m && m.cells > 100);
  const nv = m.positions.length / 3;
  assert.equal(m.normals.length, m.positions.length); assert.equal(m.uvs.length / 2, nv);
  for (const i of m.indices) assert.ok(i >= 0 && i < nv);
  assert.equal(m.indices.length % 3, 0);
  // the front faces +z, the back -z, both within the item's box
  let zmin = Infinity, zmax = -Infinity, ymin = Infinity;
  for (let v = 0; v < nv; v++) { zmin = Math.min(zmin, m.positions[v * 3 + 2]); zmax = Math.max(zmax, m.positions[v * 3 + 2]); ymin = Math.min(ymin, m.positions[v * 3 + 1]); }
  assert.ok(Math.abs(zmin + 0.25) < 1e-6, 'back at -depth/2'); assert.ok(zmax <= 0.25 + 1e-6 && zmax > 0, 'front within depth');
  assert.ok(ymin >= -1e-6, 'stands on the floor');
  for (let t = 0; t < m.frontCount; t += 3) assert.ok(m.normals[m.indices[t] * 3 + 2] > 0, 'front normals point forward');
  // every triangle after the front faces away from the centre (back or side)
  for (let t = m.frontCount; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, nz = m.normals[a + 2], nx = m.normals[a], ny = m.normals[a + 1];
    const x = m.positions[a], y = m.positions[a + 1] - 0.4;
    assert.ok(nz < -0.99 || (Math.abs(nz) < 1e-6 && nx * x + ny * y > -0.06), 'back or outward side (stair steps may sit across the radius)');
  }
  // full thickness in the middle, thinner at the rim, so the piece reads as rounded
  const frontZ = (i, j) => { const x = -0.6 + (i + 0.5) * (1.2 / gw), y = 0.8 - (j + 0.5) * (0.8 / gh); for (let v = 0; v < nv; v++) if (Math.abs(m.positions[v * 3] - x) < 1e-4 && Math.abs(m.positions[v * 3 + 1] - y) < 1e-4 && m.normals[v * 3 + 2] > 0) return m.positions[v * 3 + 2]; return null; };
  const centre = frontZ(gw >> 1, gh >> 1);
  assert.ok(centre > 0.2, 'full thickness in the middle');
  let rim = 0; for (let x = 0; x < gw; x++) if (alpha[(gh >> 1) * gw + x] && !alpha[(gh >> 1) * gw + x - 1]) rim = x;
  const edge = frontZ(rim + 1, gh >> 1);
  assert.ok(edge !== null && edge < centre, 'thinner near the rim');
});

test('reliefMesh returns null when nothing is solid, and places wall items on the wall', () => {
  assert.equal(reliefMesh(new Uint8Array(16), new Float32Array(16), 4, 4, { width: 1, height: 1, depth: 0.1, kind: 'floor' }), null);
  const gw = 20, gh = 12, alpha = grid(gw, gh, () => 255), depth = new Float32Array(gw * gh).fill(0.5);
  const m = reliefMesh(alpha, depth, gw, gh, { width: 0.8, height: 0.6, depth: 0.04, kind: 'wall' });
  let zmin = Infinity, ymin = Infinity, ymax = -Infinity;
  for (let v = 0; v < m.positions.length / 3; v++) { zmin = Math.min(zmin, m.positions[v * 3 + 2]); ymin = Math.min(ymin, m.positions[v * 3 + 1]); ymax = Math.max(ymax, m.positions[v * 3 + 1]); }
  assert.ok(Math.abs(zmin) < 1e-6, 'back on the wall');
  assert.ok(Math.abs(ymin + 0.3) < 0.06 && Math.abs(ymax - 0.3) < 0.06, 'centred on the hanging height');
});

test('pillowDepth is 0 at the rim and rises towards the middle', () => {
  const gw = 30, gh = 30, alpha = disc(gw, gh, 0.45), d = pillowDepth(alpha, gw, gh);
  assert.ok(d[15 * gw + 15] > 0.9);
  let rim = 0; for (let x = 0; x < gw; x++) if (alpha[15 * gw + x] && !alpha[15 * gw + x - 1]) rim = x;
  assert.equal(d[15 * gw + rim], 0);
});
