import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  obb, obbOverlap, obbCorners, insideRoom, doorZones, floorFits, snapFloor,
  findFloorSpot, wallFits, findWallSpot, isOutsideRoom,
} from '../src/placement.js';

const defs = {
  sofa: { kind: 'floor', size: [2, 0.9, 0.8] },
  table: { kind: 'floor', size: [1, 0.6, 0.45] },
  rug: { kind: 'rug', size: [2, 1.4, 0.02] },
  art: { kind: 'wall', size: [0.8, 0.6, 0.04] },
};
const room = () => ({
  width: 5, length: 4, height: 2.6,
  openings: [{ wall: 'S', type: 'door', offset: 1, width: 0.9, bottom: 0, height: 2.1 },
             { wall: 'N', type: 'window', offset: 2.5, width: 1.2, bottom: 0.9, height: 1.2 }],
});

test('obbOverlap: separated, touching and overlapping boxes', () => {
  assert.equal(obbOverlap(obb(0, 0, 1, 1), obb(2, 0, 1, 1)), false);
  assert.equal(obbOverlap(obb(0, 0, 1, 1), obb(1, 0, 1, 1)), false, 'touching edges are free');
  assert.equal(obbOverlap(obb(0, 0, 1, 1), obb(0.9, 0, 1, 1)), true);
  // rotated 45deg box reaches further along the axes
  assert.equal(obbOverlap(obb(0, 0, 1, 1, Math.PI / 4), obb(1.2, 0, 1, 1)), true);
  assert.equal(obbOverlap(obb(0, 0, 1, 1, Math.PI / 4), obb(1.3, 0, 1, 1)), false);
});

test('obbCorners follow three.js rotation.y convention', () => {
  const c = obbCorners(obb(0, 0, 2, 1, Math.PI / 2));
  // width axis now runs along -z, so x extent is 0.5 and z extent is 1
  const xs = c.map((p) => Math.abs(p[0])), zs = c.map((p) => Math.abs(p[1]));
  assert.ok(xs.every((v) => Math.abs(v - 0.5) < 1e-9));
  assert.ok(zs.every((v) => Math.abs(v - 1) < 1e-9));
});

test('insideRoom respects rotation', () => {
  const r = room();
  assert.equal(insideRoom(r, obb(1, 0.45, 2, 0.9)), true);
  assert.equal(insideRoom(r, obb(1, 0.4, 2, 0.9)), false);
  assert.equal(insideRoom(r, obb(0.45, 2, 2, 0.9, Math.PI / 2)), true);
  assert.equal(insideRoom(r, obb(0.4, 2, 2, 0.9, Math.PI / 2)), false);
});

test('door clearance zone blocks furniture but not rugs', () => {
  const r = room();
  const zones = doorZones(r);
  assert.equal(zones.length, 1);
  const box = obb(1, 3.7, 1, 0.6); // right in front of the south door
  assert.equal(floorFits(r, defs, [], box, { kind: 'floor' }), false);
  assert.equal(floorFits(r, defs, [], box, { kind: 'rug' }), true);
});

test('furniture collides with furniture, sits on rugs; rugs collide with rugs', () => {
  const r = room();
  const items = [
    { id: 'a', type: 'rug', x: 2.5, z: 2, rot: 0 },
    { id: 'b', type: 'sofa', x: 2.5, z: 1, rot: 0 },
  ];
  const tableOnRug = obb(2.5, 2.2, 1, 0.6);
  assert.equal(floorFits(r, defs, items, tableOnRug, { kind: 'floor' }), true);
  const tableOnSofa = obb(2.5, 1.2, 1, 0.6);
  assert.equal(floorFits(r, defs, items, tableOnSofa, { kind: 'floor' }), false);
  const rugOnRug = obb(3, 2, 2, 1.4);
  assert.equal(floorFits(r, defs, items, rugOnRug, { kind: 'rug' }), false);
  assert.equal(floorFits(r, defs, items, tableOnSofa, { kind: 'floor', ignoreId: 'b' }), true, 'ignores itself while moving');
});

test('snapFloor rounds to the grid and pulls flush to a nearby wall', () => {
  const r = room();
  const b = snapFloor(r, obb(1.03, 0.62, 2, 0.9));
  assert.ok(Math.abs(b.cx - 1.01) < 1e-9, "left edge pulled to x=0.01");
  assert.ok(Math.abs(b.cz - 0.46) < 1e-9, 'back edge pulled to z=0.01');
  const far = snapFloor(r, obb(2.5, 2.0, 2, 0.9));
  assert.ok(Math.abs(far.cz - 2.0) < 1e-9, 'no snap when far from walls');
  const over = snapFloor(r, obb(0.8, 2.0, 2, 0.9));
  assert.ok(Math.abs(over.cx - 1.01) < 1e-9, 'pushed out of the wall it overlapped');
});

test('findFloorSpot returns the pose when it fits, else the nearest legal pose', () => {
  const r = room();
  const items = [{ id: 'b', type: 'sofa', x: 2.5, z: 2, rot: 0 }];
  const direct = findFloorSpot(r, defs, items, defs.table, 1, 1, 0);
  assert.deepEqual(direct, { x: 1, z: 1, ok: true });
  const nudged = findFloorSpot(r, defs, items, defs.table, 2.5, 2.1, 0);
  assert.equal(nudged.ok, true);
  const dist = Math.hypot(nudged.x - 2.5, nudged.z - 2.1);
  assert.ok(dist > 0 && dist <= 1.0, `moved a short distance (${dist})`);
  assert.equal(floorFits(r, defs, items, obb(nudged.x, nudged.z, 1, 0.6), { kind: 'floor' }), true);
  const tiny = { width: 0.5, length: 0.5, height: 2.6, openings: [] };
  assert.equal(findFloorSpot(tiny, defs, [], defs.sofa, 0.25, 0.25, 0).ok, false);
});

test('wall items avoid openings, bounds and each other', () => {
  const r = room();
  const rect = { u: 2.5, y: 1.5, hw: 0.4, hh: 0.3 };
  assert.equal(wallFits(r, defs, [], 'N', rect), false, 'over the window');
  assert.equal(wallFits(r, defs, [], 'S', rect), true);
  assert.equal(wallFits(r, defs, [], 'S', { ...rect, u: 0.3 }), false, 'past the wall start');
  assert.equal(wallFits(r, defs, [], 'S', { ...rect, y: 2.5 }), false, 'above the ceiling');
  const items = [{ id: 'x', type: 'art', wall: 'S', u: 2.5, y: 1.5 }];
  assert.equal(wallFits(r, defs, items, 'S', rect), false);
  assert.equal(wallFits(r, defs, items, 'S', rect, 'x'), true);
  assert.equal(wallFits(r, defs, items, 'W', rect), true, 'different wall');
});

test('findWallSpot slides off the window', () => {
  const r = room();
  const spot = findWallSpot(r, defs, [], defs.art, 'N', 2.5, 1.5);
  assert.equal(spot.ok, true);
  assert.ok(Math.abs(spot.u - 2.5) > 0.5 || Math.abs(spot.y - 1.5) > 0.3);
});

test('isOutsideRoom uses the margin', () => {
  const r = room();
  assert.equal(isOutsideRoom(r, -0.3, 2), false);
  assert.equal(isOutsideRoom(r, -0.6, 2), true);
  assert.equal(isOutsideRoom(r, 2, 4.6), true);
});
