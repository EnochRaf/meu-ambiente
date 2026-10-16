import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openingFits, findOpeningSpot, resizeRoom } from '../src/placement.js';

const room = () => ({
  width: 5, length: 4, height: 2.6,
  openings: [{ id: 'd', wall: 'N', type: 'door', offset: 1, width: 0.9, bottom: 0, height: 2.1 }],
  items: [{ id: 'a', type: 'sofa', x: 2.5, z: 0.5, rot: 0 }, { id: 'w', type: 'art', wall: 'N', u: 3, y: 1.5 }],
});

test('openings cannot overlap each other or leave the wall', () => {
  const r = room();
  assert.equal(openingFits(r, 'N', 3, 1.2), true);
  assert.equal(openingFits(r, 'N', 1.5, 1.2), false, 'too close to the door');
  assert.equal(openingFits(r, 'N', 4.6, 1.2), false, 'past the corner');
  assert.equal(openingFits(r, 'S', 1, 1.2), true, 'other wall is free');
  assert.equal(openingFits(r, 'N', 1, 0.9, 'd'), true, 'ignores itself while sliding');
});

test('findOpeningSpot slides sideways to the nearest free spot', () => {
  const r = room();
  assert.deepEqual(findOpeningSpot(r, 'N', 3, 1.2), { offset: 3, ok: true });
  const s = findOpeningSpot(r, 'N', 1.4, 1.2);
  assert.equal(s.ok, true);
  assert.ok(openingFits(r, 'N', s.offset, 1.2));
  assert.ok(s.offset > 1.4 && s.offset < 2.4, `moved right of the door (${s.offset})`);
  assert.equal(findOpeningSpot(r, 'N', 0, 1.2).offset >= 0.6, true, 'clamped inside the wall');
  const tiny = { ...r, width: 1 };
  assert.equal(findOpeningSpot(tiny, 'N', 0.5, 1.2).ok, false);
});

test('resizeRoom by the east or south wall only changes the size', () => {
  const r = resizeRoom(room(), 'E', 6.04);
  assert.equal(r.width, 6);
  assert.equal(r.items[0].x, 2.5);
  const s = resizeRoom(room(), 'S', 3);
  assert.equal(s.length, 3);
  assert.equal(s.width, 5);
});

test('resizeRoom by the west or north wall keeps things in place relative to the far wall', () => {
  const r = resizeRoom(room(), 'W', 6);
  assert.equal(r.width, 6);
  assert.equal(r.items[0].x, 3.5, 'floor item shifted by +1');
  assert.equal(r.openings[0].offset, 2, 'door on the north wall shifted');
  assert.equal(r.items[1].u, 4, 'wall item on the north wall shifted');
  const n = resizeRoom(room(), 'N', 5);
  assert.equal(n.length, 5);
  assert.equal(n.items[0].z, 1.5);
  assert.equal(n.openings[0].offset, 1, 'door on the north wall itself is untouched');
});

test('resizeRoom clamps and keeps openings on the wall', () => {
  const r = resizeRoom(room(), 'E', 0.3);
  assert.equal(r.width, 1.5);
  assert.ok(r.openings[0].offset + r.openings[0].width / 2 <= 1.5 + 1e-9);
  assert.equal(resizeRoom(room(), 'E', 5).width, 5, 'no-op keeps the size');
});
