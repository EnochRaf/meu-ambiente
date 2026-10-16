// Pure placement rules: no DOM, no three.js. Units are metres.
// Room coordinates: x in [0, width], z in [0, length]. Walls:
//   N: z = 0 (back),  S: z = length (front),  W: x = 0 (left),  E: x = width (right)
// Along a wall, u runs along x for N/S and along z for W/E.

export const GRID = 0.1;
export const SNAP_DIST = 0.3;
export const DOOR_CLEARANCE = 0.9;
export const ROT_STEP = Math.PI / 8; // 22.5 degrees, 16 steps
export const WALLS = ['N', 'S', 'W', 'E'];
const EPS = 1e-4;

export const roundTo = (v, step = GRID) => Math.round(v / step) * step;

export function wallLength(room, wall) {
  return wall === 'N' || wall === 'S' ? room.width : room.length;
}

// --- oriented boxes on the floor plane -------------------------------------
// Local axes follow three.js rotation.y: u = (cos a, -sin a), v = (sin a, cos a).
export function obb(cx, cz, w, d, a = 0) {
  return { cx, cz, hw: w / 2, hd: d / 2, a };
}

export function obbCorners(b) {
  const ux = Math.cos(b.a), uz = -Math.sin(b.a);
  const vx = Math.sin(b.a), vz = Math.cos(b.a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => [
    b.cx + su * b.hw * ux + sv * b.hd * vx,
    b.cz + su * b.hw * uz + sv * b.hd * vz,
  ]);
}

export function obbExtents(b) {
  const c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
  return { ex: b.hw * c + b.hd * s, ez: b.hw * s + b.hd * c };
}

function projRadius(b, nx, nz) {
  const ux = Math.cos(b.a), uz = -Math.sin(b.a);
  const vx = Math.sin(b.a), vz = Math.cos(b.a);
  return b.hw * Math.abs(nx * ux + nz * uz) + b.hd * Math.abs(nx * vx + nz * vz);
}

// Separating-axis test between two oriented rectangles. `gap` lets touching
// edges count as free.
export function obbOverlap(p, q, gap = 0.005) {
  const axes = [
    [Math.cos(p.a), -Math.sin(p.a)], [Math.sin(p.a), Math.cos(p.a)],
    [Math.cos(q.a), -Math.sin(q.a)], [Math.sin(q.a), Math.cos(q.a)],
  ];
  const dx = q.cx - p.cx, dz = q.cz - p.cz;
  for (const [nx, nz] of axes) {
    if (Math.abs(dx * nx + dz * nz) >= projRadius(p, nx, nz) + projRadius(q, nx, nz) - gap) return false;
  }
  return true;
}

export function insideRoom(room, b) {
  const { ex, ez } = obbExtents(b);
  return b.cx - ex >= -EPS && b.cx + ex <= room.width + EPS &&
         b.cz - ez >= -EPS && b.cz + ez <= room.length + EPS;
}

export function isOutsideRoom(room, x, z, margin = 0.5) {
  return x < -margin || x > room.width + margin || z < -margin || z > room.length + margin;
}

// Floor strip in front of each door that furniture must keep clear.
export function doorZones(room) {
  const zones = [];
  for (const o of room.openings) {
    if (o.type !== 'door') continue;
    const u0 = o.offset - o.width / 2, u1 = o.offset + o.width / 2, c = DOOR_CLEARANCE;
    if (o.wall === 'N') zones.push(obb((u0 + u1) / 2, c / 2, o.width, c));
    if (o.wall === 'S') zones.push(obb((u0 + u1) / 2, room.length - c / 2, o.width, c));
    if (o.wall === 'W') zones.push(obb(c / 2, (u0 + u1) / 2, c, o.width));
    if (o.wall === 'E') zones.push(obb(room.width - c / 2, (u0 + u1) / 2, c, o.width));
  }
  return zones;
}

export function floorBox(item, def) {
  return obb(item.x, item.z, def.size[0], def.size[1], item.rot || 0);
}

// Does a floor-layer box fit at this exact pose?
export function floorFits(room, defs, items, box, { kind, ignoreId = null } = {}) {
  if (!insideRoom(room, box)) return false;
  if (kind !== 'rug' && kind !== 'hanging') for (const zone of doorZones(room)) if (obbOverlap(box, zone)) return false;
  for (const it of items) {
    if (it.id === ignoreId) continue;
    const d = defs[it.type];
    if (!d || d.kind === 'wall') continue;
    // rugs only collide with rugs, hanging lights only with hanging lights
    if ((d.kind === 'rug') !== (kind === 'rug') || (d.kind === 'hanging') !== (kind === 'hanging')) continue;
    if (obbOverlap(box, floorBox(it, d))) return false;
  }
  return true;
}

// Round to the grid, then pull flush against a wall that is within SNAP_DIST.
export function snapFloor(room, box) {
  const b = { ...box, cx: roundTo(box.cx), cz: roundTo(box.cz) };
  const { ex, ez } = obbExtents(b);
  const left = b.cx - ex, right = room.width - (b.cx + ex);
  const back = b.cz - ez, front = room.length - (b.cz + ez);
  if (Math.abs(left) < SNAP_DIST && left <= right) b.cx = ex + 0.01;
  else if (Math.abs(right) < SNAP_DIST) b.cx = room.width - ex - 0.01;
  if (Math.abs(back) < SNAP_DIST && back <= front) b.cz = ez + 0.01;
  else if (Math.abs(front) < SNAP_DIST) b.cz = room.length - ez - 0.01;
  return b;
}

// Nearest legal floor spot to (x, z): the snapped spot if it fits, otherwise a
// ring search outwards. Returns { x, z, ok }.
export function findFloorSpot(room, defs, items, def, x, z, rot, ignoreId = null, maxR = 2.0) {
  const opts = { kind: def.kind, ignoreId };
  const tryAt = (cx, cz) => {
    const b = snapFloor(room, obb(cx, cz, def.size[0], def.size[1], rot));
    return floorFits(room, defs, items, b, opts) ? b : null;
  };
  const first = tryAt(x, z);
  if (first) return { x: first.cx, z: first.cz, ok: true };
  for (let r = GRID; r <= maxR + EPS; r += GRID) {
    const n = Math.max(8, Math.round(r * 40));
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const b = tryAt(x + Math.cos(t) * r, z + Math.sin(t) * r);
      if (b) return { x: b.cx, z: b.cz, ok: true };
    }
  }
  const s = snapFloor(room, obb(x, z, def.size[0], def.size[1], rot));
  return { x: s.cx, z: s.cz, ok: false };
}

// --- wall-mounted items (u along the wall, y up) -----------------------------
const rectsOverlap = (a, b, gap = 0.02) =>
  Math.abs(a.u - b.u) < a.hw + b.hw - gap && Math.abs(a.y - b.y) < a.hh + b.hh - gap;

export function wallRect(item, def) {
  return { u: item.u, y: item.y, hw: def.size[0] / 2, hh: def.size[1] / 2 };
}

export function wallFits(room, defs, items, wall, rect, ignoreId = null) {
  const len = wallLength(room, wall);
  if (rect.u - rect.hw < -EPS || rect.u + rect.hw > len + EPS) return false;
  if (rect.y - rect.hh < -EPS || rect.y + rect.hh > room.height + EPS) return false;
  for (const o of room.openings) {
    if (o.wall !== wall) continue;
    const orect = { u: o.offset, y: o.bottom + o.height / 2, hw: o.width / 2, hh: o.height / 2 };
    if (rectsOverlap(rect, orect, 0)) return false;
  }
  for (const it of items) {
    if (it.id === ignoreId || it.wall !== wall) continue;
    const d = defs[it.type];
    if (!d || d.kind !== 'wall') continue;
    if (rectsOverlap(rect, wallRect(it, d))) return false;
  }
  return true;
}

export function findWallSpot(room, defs, items, def, wall, u, y, ignoreId = null, maxR = 2.0) {
  const tryAt = (cu, cy) => {
    const r = { u: roundTo(cu), y: roundTo(cy), hw: def.size[0] / 2, hh: def.size[1] / 2 };
    return wallFits(room, defs, items, wall, r, ignoreId) ? r : null;
  };
  const first = tryAt(u, y);
  if (first) return { u: first.u, y: first.y, ok: true };
  for (let r = GRID; r <= maxR + EPS; r += GRID) {
    for (const [du, dy] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r], [r, -r], [-r, -r]]) {
      const hit = tryAt(u + du, y + dy);
      if (hit) return { u: hit.u, y: hit.y, ok: true };
    }
  }
  return { u: roundTo(u), y: roundTo(y), ok: false };
}

// --- openings along a wall -----------------------------------------------------
export function openingFits(room, wall, offset, width, ignoreId = null) {
  const len = wallLength(room, wall);
  if (offset - width / 2 < -EPS || offset + width / 2 > len + EPS) return false;
  for (const o of room.openings) {
    if (o.id === ignoreId || o.wall !== wall) continue;
    if (Math.abs(o.offset - offset) < (o.width + width) / 2 + 0.1 - EPS) return false;
  }
  return true;
}

// Nearest legal centre for an opening of `width` on `wall`, searching sideways.
export function findOpeningSpot(room, wall, offset, width, ignoreId = null) {
  const len = wallLength(room, wall);
  const clampU = (u) => Math.min(Math.max(u, width / 2), len - width / 2);
  const first = roundTo(clampU(offset));
  if (openingFits(room, wall, first, width, ignoreId)) return { offset: first, ok: true };
  for (let r = GRID; r <= len; r += GRID) {
    for (const u of [first + r, first - r]) {
      const c = roundTo(clampU(u));
      if (openingFits(room, wall, c, width, ignoreId)) return { offset: c, ok: true };
    }
  }
  return { offset: first, ok: false };
}

// --- resizing a room by dragging one wall ---------------------------------------
export const MIN_SIDE = 1.5, MAX_SIDE = 30;
// Moving the E or S wall just changes the size. Moving the W or N wall shifts
// everything so the opposite wall stays where it is.
export function resizeRoom(room, wall, newSize) {
  const size = roundTo(Math.min(MAX_SIDE, Math.max(MIN_SIDE, newSize)));
  const horizontal = wall === 'W' || wall === 'E'; // these change width
  const old = horizontal ? room.width : room.length;
  if (Math.abs(size - old) < EPS) return room;
  const delta = size - old;
  const next = { ...room, items: room.items.map((i) => ({ ...i })), openings: room.openings.map((o) => ({ ...o })) };
  if (horizontal) next.width = size; else next.length = size;
  if (wall === 'W' || wall === 'N') {
    const key = horizontal ? 'x' : 'z';
    const along = horizontal ? ['N', 'S'] : ['W', 'E'];
    for (const it of next.items) if (it[key] !== undefined && it.zone !== 'balcony') it[key] += delta;
    for (const o of next.openings) if (along.includes(o.wall)) o.offset += delta;
    for (const it of next.items) if (it.wall && along.includes(it.wall)) it.u += delta;
    if (next.balcony && along.includes(next.balcony.wall)) next.balcony = { ...next.balcony, offset: next.balcony.offset + delta };
  }
  if (next.balcony) {
    const b = next.balcony, len = wallLength(next, b.wall), width = Math.min(b.width, len);
    next.balcony = { ...b, width, offset: Math.min(Math.max(b.offset, width / 2), len - width / 2) };
  }
  for (const o of next.openings) {
    const len = wallLength(next, o.wall);
    o.width = Math.min(o.width, len);
    o.offset = Math.min(Math.max(o.offset, o.width / 2), len - o.width / 2);
  }
  return next;
}
