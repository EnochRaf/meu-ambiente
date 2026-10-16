// Balcony geometry rules. A balcony hangs off the outside of one wall. Items on
// it are stored in balcony-local metres: x along the wall (0..width), z outward
// (0..depth), rot relative to the balcony. The local frame is a proper rotation
// of the room frame, so turning works the same as indoors.
import { wallLength, findFloorSpot, floorFits, obb, openingFits } from './placement.js';

export const WALL_T = 0.2;
export const BALCONY_LIMITS = { width: [1.2, 8], depth: [0.9, 3] };
export const RAILINGS = ['glass', 'metal', 'concrete'];
export const BALCONY_FLOORS = ['wood', 'tiles', 'concrete'];

export function defaultBalcony(room, wall = 'W') {
  const len = wallLength(room, wall);
  const width = Math.min(3.6, Math.max(BALCONY_LIMITS.width[0], len - 0.4));
  return { wall, offset: len / 2, width, depth: 1.8, railing: 'glass', floor: 'wood' };
}

export function clampBalcony(room, b) {
  const len = wallLength(room, b.wall);
  const width = Math.min(Math.max(b.width, BALCONY_LIMITS.width[0]), Math.min(BALCONY_LIMITS.width[1], len));
  const depth = Math.min(Math.max(b.depth, BALCONY_LIMITS.depth[0]), BALCONY_LIMITS.depth[1]);
  const offset = Math.min(Math.max(b.offset, width / 2), len - width / 2);
  return { ...b, width, depth, offset };
}

// start: world point of local (0, 0); a: local +x in world; o: local +z (outward); theta: rotation.y
export function balconyFrame(room, b) {
  const h = b.width / 2;
  switch (b.wall) {
    case 'N': return { start: [b.offset + h, -WALL_T], a: [-1, 0], o: [0, -1], theta: Math.PI };
    case 'S': return { start: [b.offset - h, room.length + WALL_T], a: [1, 0], o: [0, 1], theta: 0 };
    case 'W': return { start: [-WALL_T, b.offset - h], a: [0, 1], o: [-1, 0], theta: -Math.PI / 2 };
    default: return { start: [room.width + WALL_T, b.offset + h], a: [0, -1], o: [1, 0], theta: Math.PI / 2 };
  }
}
export function toWorld(room, b, x, z, rot = 0) {
  const f = balconyFrame(room, b);
  return { x: f.start[0] + f.a[0] * x + f.o[0] * z, z: f.start[1] + f.a[1] * x + f.o[1] * z, rot: rot + f.theta };
}
export function toLocal(room, b, wx, wz, rot = 0) {
  const f = balconyFrame(room, b), dx = wx - f.start[0], dz = wz - f.start[1];
  return { x: dx * f.a[0] + dz * f.a[1], z: dx * f.o[0] + dz * f.o[1], rot: rot - f.theta };
}
// Is a world point on (or within `pad` of) the balcony?
export function onBalcony(room, b, wx, wz, pad = 0) {
  if (!b) return false;
  const p = toLocal(room, b, wx, wz);
  return p.x > -pad && p.x < b.width + pad && p.z > -pad && p.z < b.depth + pad;
}
// The balcony as a virtual room for the placement rules (no openings).
export const balconyRoom = (b) => ({ width: b.width, length: b.depth, height: 3, openings: [] });
export const balconyItems = (room) => room.items.filter((i) => i.zone === 'balcony');
export const roomItems = (room) => room.items.filter((i) => i.zone !== 'balcony');

export function findBalconySpot(room, defs, def, lx, lz, rot, ignoreId = null) {
  return findFloorSpot(balconyRoom(room.balcony), defs, balconyItems(room), def, lx, lz, rot, ignoreId, 1.2);
}
export function balconyFits(room, defs, def, item) {
  return floorFits(balconyRoom(room.balcony), defs, balconyItems(room), obb(item.x, item.z, def.size[0], def.size[1], item.rot || 0), { kind: def.kind, ignoreId: item.id });
}
// After the balcony changes size, keep what still fits and nudge the rest;
// pieces that no longer fit anywhere are returned as `dropped`.
export function refitBalconyItems(room, defs) {
  if (!room.balcony) return { items: room.items, dropped: [] };
  const keep = [], dropped = [], placed = [];
  const virt = balconyRoom(room.balcony);
  for (const it of room.items) {
    if (it.zone !== 'balcony') { keep.push(it); continue; }
    const def = defs[it.type]; if (!def) continue;
    const spot = findFloorSpot(virt, defs, placed, def, it.x, it.z, it.rot || 0, null, 1.5);
    if (spot.ok) { const n = { ...it, x: spot.x, z: spot.z }; keep.push(n); placed.push(n); } else dropped.push(it);
  }
  return { items: keep, dropped };
}

// A floor-to-ceiling glass door onto the balcony. A window already inside the
// balcony's span is turned into the door; otherwise one is added if it fits.
// Returns the new openings list, or null when nothing changes.
export function withBalconyDoor(room, b, uid) {
  const inSpan = (o) => o.wall === b.wall && Math.abs(o.offset - b.offset) < b.width / 2 + o.width / 2 - 0.05;
  if (room.openings.some((o) => inSpan(o) && o.type === 'window' && o.bottom < 0.2)) return null;
  const width = Math.min(2.4, b.width - 0.4), height = Math.max(1.8, room.height - 0.25);
  const win = room.openings.find((o) => inSpan(o) && o.type === 'window');
  const others = room.openings.filter((o) => o !== win);
  const probe = { ...room, openings: others };
  for (const dx of [0, 0.4, -0.4, 0.8, -0.8]) {
    const offset = b.offset + dx;
    if (Math.abs(dx) + width / 2 > b.width / 2) continue;
    if (openingFits(probe, b.wall, offset, width)) return [...others, { id: win ? win.id : uid(), wall: b.wall, type: 'window', offset, width, bottom: 0.05, height }];
  }
  return null;
}
// Starter furniture: a lounge chair, a bistro table with two chairs, a planter, a lantern.
export function starterFurniture(room, defs, uid) {
  const b = room.balcony, out = [], tmp = { ...room, items: [...room.items] };
  const want = [
    ['planterBox', b.width / 2, 0.24, 0], ['loungeChair', 0.55, b.depth - 0.5, 0.25], ['bistroTable', b.width - 0.75, b.depth / 2 + 0.05, 0],
    ['bistroChair', b.width - 1.3, b.depth / 2 + 0.05, Math.PI / 2], ['bistroChair', b.width - 0.2, b.depth / 2 + 0.05, -Math.PI / 2], ['lantern', 0.2, 0.2, 0],
  ];
  for (const [type, x, z, rot] of want) {
    const def = defs[type]; if (!def) continue;
    const spot = findBalconySpot(tmp, defs, def, x, z, rot);
    if (!spot.ok) continue;
    const it = { id: uid(), type, zone: 'balcony', x: spot.x, z: spot.z, rot };
    out.push(it); tmp.items.push(it);
  }
  return out;
}
