import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBalcony, clampBalcony, balconyFrame, toWorld, toLocal, onBalcony, findBalconySpot, refitBalconyItems } from '../src/balcony.js';

const room = (b = null, items = []) => ({ width: 5, length: 4, height: 2.6, openings: [], items, balcony: b });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('defaults and clamping keep the balcony on its wall', () => {
  const r = room();
  const b = defaultBalcony(r, 'W');
  assert.equal(b.offset, 2); assert.equal(b.width, 3.6);
  const c = clampBalcony(r, { ...b, width: 20, depth: 9, offset: 0 });
  assert.equal(c.width, 4); assert.equal(c.depth, 3); assert.equal(c.offset, 2);
  const s = clampBalcony(r, { ...b, wall: 'N', width: 0.2, offset: 4.9 });
  assert.equal(s.width, 1.2); assert.ok(near(s.offset, 4.4));
});

test('each wall frame is a proper rotation pointing away from the room', () => {
  for (const wall of ['N', 'S', 'W', 'E']) {
    const r = room(); const b = { ...defaultBalcony(r, wall), depth: 2 };
    const f = balconyFrame(r, b);
    assert.equal(f.a[0] * f.o[1] - f.a[1] * f.o[0], 1, `${wall} determinant`);
    // three.js rotation.y maps local x to (cos, -sin) and local z to (sin, cos)
    assert.ok(near(Math.cos(f.theta), f.a[0], 1e-12) && near(-Math.sin(f.theta), f.a[1], 1e-12), `${wall} theta matches a`);
    assert.ok(near(Math.sin(f.theta), f.o[0], 1e-12) && near(Math.cos(f.theta), f.o[1], 1e-12), `${wall} theta matches o`);
    // the far edge is outside the room
    const far = toWorld(r, b, b.width / 2, b.depth);
    assert.ok(far.x < 0 || far.x > r.width || far.z < 0 || far.z > r.length, `${wall} far edge outside`);
  }
});

test('toWorld and toLocal are inverses', () => {
  const r = room();
  for (const wall of ['N', 'S', 'W', 'E']) {
    const b = defaultBalcony(r, wall);
    const w = toWorld(r, b, 1.3, 0.7, 0.4), l = toLocal(r, b, w.x, w.z, w.rot);
    assert.ok(near(l.x, 1.3) && near(l.z, 0.7) && near(l.rot, 0.4), wall);
  }
  const b = defaultBalcony(r, 'W');
  assert.equal(onBalcony(r, b, -1, 2), true);
  assert.equal(onBalcony(r, b, 1, 2), false);
  assert.equal(onBalcony(r, b, -1, 2.0, 0), true);
  assert.equal(onBalcony(r, null, -1, 2), false);
});

test('balcony placement collides only with balcony items', () => {
  const defs = { chair: { kind: 'floor', size: [0.6, 0.6, 0.9] }, sofa: { kind: 'floor', size: [2, 0.9, 0.8] } };
  const b = { ...defaultBalcony(room(), 'W'), depth: 1.8 };
  const items = [{ id: 'in', type: 'sofa', x: 2.5, z: 2, rot: 0 }, { id: 'b1', type: 'chair', zone: 'balcony', x: 1, z: 0.9, rot: 0 }];
  const r = room(b, items);
  const s = findBalconySpot(r, defs, defs.chair, 1, 0.9, 0);
  assert.equal(s.ok, true);
  assert.ok(Math.hypot(s.x - 1, s.z - 0.9) >= 0.59, 'moved off the other chair');
  assert.ok(s.x >= 0.3 - 1e-6 && s.x <= 3.3 + 1e-6 && s.z >= 0.3 - 1e-6 && s.z <= 1.5 + 1e-6, 'inside the balcony');
  const big = findBalconySpot(r, defs, { kind: 'floor', size: [5, 2.5, 1] }, 1, 1, 0);
  assert.equal(big.ok, false);
});

test('shrinking the balcony nudges or drops pieces', () => {
  const defs = { chair: { kind: 'floor', size: [0.6, 0.6, 0.9] } };
  const items = [{ id: 'a', type: 'chair', zone: 'balcony', x: 3.2, z: 1.4, rot: 0 }, { id: 'b', type: 'chair', zone: 'balcony', x: 0.4, z: 0.4, rot: 0 }, { id: 'c', type: 'chair', zone: 'balcony', x: 1.4, z: 0.4, rot: 0 }, { id: 'room', type: 'chair', x: 1, z: 1, rot: 0 }];
  const r = room({ ...defaultBalcony(room(), 'W'), width: 1.4, depth: 0.9 }, items);
  const { items: out, dropped } = refitBalconyItems(r, defs);
  assert.equal(out.filter((i) => i.zone === 'balcony').length + dropped.length, 3);
  assert.ok(out.some((i) => i.id === 'room'), 'room items untouched');
  for (const it of out.filter((i) => i.zone === 'balcony')) assert.ok(it.x >= 0.3 - 1e-6 && it.x <= 1.1 + 1e-6 && it.z >= 0.3 - 1e-6 && it.z <= 0.6 + 1e-6, JSON.stringify(it));
  assert.ok(dropped.length >= 1);
});

test('sanitizer keeps settings, balcony and balcony items; drops orphans', async () => {
  const { sanitizeProject, defaultRoom } = await import('../src/state.js');
  const r = defaultRoom('living');
  assert.equal(r.view, 'garden'); assert.equal(r.balcony, null);
  const raw = { activeRoomId: r.id, rooms: [{ ...r, view: 'ocean', setting: 'apartment', floorLevel: 'high', balcony: { wall: 'W', offset: 2, width: 99, depth: 1.5, railing: 'metal', floor: 'nope' },
    items: [{ id: 'a', type: 'sofa', x: 1, z: 1, rot: 0 }, { id: 'b', type: 'chair', zone: 'balcony', x: 0.5, z: 0.5, rot: 0 }] }] };
  const p = sanitizeProject(raw).rooms[0];
  assert.equal(p.view, 'ocean'); assert.equal(p.setting, undefined, 'old setting dropped'); assert.equal(p.floorLevel, undefined, 'old floor level dropped');
  assert.deepEqual([p.balcony.width, p.balcony.railing, p.balcony.floor], [4, 'metal', 'wood']);
  assert.equal(p.items.find((i) => i.id === 'b').zone, 'balcony');
  const q = sanitizeProject({ ...raw, rooms: [{ ...raw.rooms[0], balcony: null, view: 'moon' }] }).rooms[0];
  assert.equal(q.view, 'garden');
  assert.ok(!q.items.some((i) => i.zone === 'balcony'), 'balcony items dropped with the balcony');
});

test('resizing by the far wall moves the balcony with its wall and leaves its items alone', async () => {
  const { resizeRoom } = await import('../src/placement.js');
  const r = { width: 5, length: 4, height: 2.6, openings: [], balcony: { ...defaultBalcony(room(), 'N') }, items: [{ id: 'b', type: 'chair', zone: 'balcony', x: 0.5, z: 0.5, rot: 0 }, { id: 'a', type: 'chair', x: 1, z: 1, rot: 0 }] };
  const n = resizeRoom(r, 'W', 6);
  assert.equal(n.balcony.offset, r.balcony.offset + 1);
  assert.deepEqual([n.items[0].x, n.items[1].x], [0.5, 2]);
  const s = resizeRoom(r, 'E', 2);
  assert.ok(s.balcony.width <= 2 && s.balcony.offset - s.balcony.width / 2 >= -1e-9);
});

test('a new balcony gets a glass door and starter furniture that fits', async () => {
  const { withBalconyDoor, starterFurniture, balconyFits } = await import('../src/balcony.js');
  const { DEFS } = await import('../src/catalog.js').catch(() => ({ DEFS: null }));
  let n = 0; const uid = () => 'id' + n++;
  const r = { width: 5, length: 4, height: 2.6, openings: [{ id: 'w', wall: 'W', type: 'window', offset: 2.2, width: 1.4, bottom: 0.9, height: 1.2 }], items: [], balcony: null };
  r.balcony = defaultBalcony(r, 'W');
  const added = withBalconyDoor({ ...r, openings: [] }, r.balcony, uid), door = added[0];
  assert.ok(door && door.bottom < 0.1 && door.width <= 2.4 && door.wall === 'W');
  const converted = withBalconyDoor(r, r.balcony, uid);
  assert.equal(converted.length, 1, 'the window inside the span becomes the door');
  assert.equal(converted[0].id, 'w'); assert.ok(converted[0].bottom < 0.1 && converted[0].height > 2);
  assert.equal(withBalconyDoor({ ...r, openings: converted }, r.balcony, uid), null, 'already has a door');
  const defs = { planterBox: { kind: 'floor', size: [0.9, 0.42, 0.85] }, loungeChair: { kind: 'floor', size: [0.78, 0.9, 0.8] }, bistroTable: { kind: 'floor', size: [0.7, 0.7, 0.75] }, bistroChair: { kind: 'floor', size: [0.5, 0.5, 0.88] }, lantern: { kind: 'floor', size: [0.3, 0.3, 0.75] } };
  const items = starterFurniture(r, defs, uid);
  assert.ok(items.length >= 5, `${items.length} pieces`);
  const full = { ...r, items };
  for (const it of items) assert.ok(balconyFits(full, defs, defs[it.type], it), `${it.type} fits`);
});
