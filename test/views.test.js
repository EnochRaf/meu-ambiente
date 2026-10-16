import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { VIEW_IDS, viewWeights, timeSlot } from '../src/views.js';
import { VIEWS } from '../src/state.js';

const root = new URL('../', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(root + 'assets/manifest.json', 'utf8'));

test('every view has a photo and a picker picture for day, sunset and night', () => {
  assert.deepEqual([...VIEW_IDS].sort(), [...VIEWS].sort());
  for (const v of VIEW_IDS.filter((v) => v !== 'none')) for (const t of ['day', 'sunset', 'night']) {
    assert.ok(existsSync(`${root}assets/views/${v}-${t}.webp`), `${v}-${t}`);
    assert.ok(existsSync(`${root}assets/views/${v}-${t}-pick.webp`), `${v}-${t}-pick`);
    const m = manifest.views[v][t];
    assert.ok(manifest.viewCredits[m.id]?.authors.length, `credit for ${m.id}`);
  }
});

test('the photos stay small enough to download', () => {
  const total = Object.values(manifest.views).flatMap((t) => Object.values(t)).reduce((s, m) => s + m.size, 0);
  assert.ok(total < 2.5e6, `${total} bytes`);
});

test('the hour picks the right photo, blending smoothly', () => {
  for (let t = 0; t <= 3; t += 0.05) { const w = viewWeights(t); assert.ok(Math.abs(w.x + w.y + w.z - 1) < 1e-9); assert.ok(Math.min(w.x, w.y, w.z) >= 0); }
  assert.equal(viewWeights(1).x, 1); assert.equal(viewWeights(3).z, 1); assert.ok(viewWeights(2).y > 0.9);
  assert.deepEqual([1, 2, 3].map(timeSlot), ['day', 'sunset', 'night']);
});
