import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFS } from '../src/catalog.js';
import { TEMPLATES, TEMPLATE_BY_ID, templateRoom, applyTemplateTo, roomAsTemplate, isDefaultRoomName } from '../src/templates.js';
import { ATMOSPHERE_BY_ID } from '../src/atmospheres.js';
import { ROOM_TYPES } from '../src/roomTypes.js';
import { floorFits, floorBox, wallFits, wallRect, openingFits, obbOverlap } from '../src/placement.js';
import { sanitizeProject } from '../src/state.js';

const ctx2d = () => new Proxy({}, { get: () => () => ctx2d() });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };
let n = 0; const uid = () => 'id' + n++;

// distance from a point to an oriented floor box
function distToBox(px, pz, b) {
  const dx = px - b.cx, dz = pz - b.cz;
  const u = dx * Math.cos(b.a) - dz * Math.sin(b.a), v = dx * Math.sin(b.a) + dz * Math.cos(b.a);
  return Math.hypot(Math.max(Math.abs(u) - b.hw, 0), Math.max(Math.abs(v) - b.hd, 0));
}
// Where can a person (a 90 cm wide body) walk from the doors? Grid flood fill.
export function walkable(room, defs) {
  const S = 0.05, R = 0.45, nx = Math.round(room.width / S), nz = Math.round(room.length / S);
  const boxes = room.items.filter((it) => defs[it.type]?.kind === 'floor').map((it) => floorBox(it, defs[it.type]));
  const free = (i, k) => {
    const x = (i + 0.5) * S, z = (k + 0.5) * S;
    if (x < R || z < R || x > room.width - R || z > room.length - R) return false;
    return boxes.every((b) => distToBox(x, z, b) >= R);
  };
  const seen = new Uint8Array(nx * nz), queue = [];
  for (const o of room.openings.filter((o) => o.type === 'door')) {
    const at = { N: [o.offset, R + 0.12], S: [o.offset, room.length - R - 0.12], W: [R + 0.12, o.offset], E: [room.width - R - 0.12, o.offset] }[o.wall];
    const i = Math.floor(at[0] / S), k = Math.floor(at[1] / S);
    if (free(i, k)) { seen[k * nx + i] = 1; queue.push([i, k]); }
  }
  while (queue.length) {
    const [i, k] = queue.pop();
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + a, kk = k + b;
      if (ii < 0 || kk < 0 || ii >= nx || kk >= nz || seen[kk * nx + ii] || !free(ii, kk)) continue;
      seen[kk * nx + ii] = 1; queue.push([ii, kk]);
    }
  }
  const cells = []; for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (seen[k * nx + i]) cells.push([(i + 0.5) * S, (k + 0.5) * S]);
  return cells;
}

for (const tpl of TEMPLATES) {
  test(`${tpl.name}: complete and every piece fits`, () => {
    assert.ok(ROOM_TYPES[tpl.type], 'known room type');
    assert.ok(tpl.name && tpl.blurb && tpl.style, 'name, description and style');
    assert.ok(ATMOSPHERE_BY_ID[tpl.atmosphere], 'default atmosphere');
    assert.equal(tpl.palette.length, 4, 'main, secondary and accent colours');
    const room = templateRoom({ type: tpl.type, ...tpl.room }, uid, tpl.name);
    for (const o of room.openings) assert.ok(openingFits(room, o.wall, o.offset, o.width, o.id), `${o.type} on ${o.wall}`);
    for (const it of room.items) {
      const d = DEFS[it.type];
      assert.ok(d, `${it.type} exists`);
      if (d.kind === 'wall') assert.ok(wallFits(room, DEFS, room.items, it.wall, wallRect(it, d), it.id), `${it.type} on ${it.wall} at ${it.u}`);
      else assert.ok(floorFits(room, DEFS, room.items, floorBox(it, d), { kind: d.kind, ignoreId: it.id }), `${it.type} at ${it.x}, ${it.z}`);
    }
    // the project format keeps everything
    const p = sanitizeProject({ rooms: [room] });
    assert.equal(p.rooms[0].items.length, room.items.length);
  });

  test(`${tpl.name}: 90 cm walking paths reach every piece of furniture`, () => {
    const room = templateRoom({ type: tpl.type, ...tpl.room }, uid, tpl.name);
    const cells = walkable(room, DEFS);
    assert.ok(cells.length > 20, 'a path from the door');
    for (const it of room.items) {
      const d = DEFS[it.type];
      // pieces you walk up to (side and coffee tables are reached from the seat beside them)
      if (d.kind !== 'floor' || !(['seating', 'storage', 'beds', 'kitchen', 'bath'].includes(d.cat) || ['dining', 'desk', 'island'].includes(it.type))) continue;
      const b = floorBox(it, d);
      const near = Math.min(...cells.map(([x, z]) => distToBox(x, z, b)));
      assert.ok(near <= 0.8, `${it.type} at ${it.x}, ${it.z} is ${near.toFixed(2)} m from the nearest 90 cm path`);
    }
  });

  test(`${tpl.name}: rugs carry the front legs of the seating around them`, () => {
    const room = templateRoom({ type: tpl.type, ...tpl.room }, uid, tpl.name);
    const rugs = room.items.filter((it) => DEFS[it.type].kind === 'rug').map((it) => floorBox(it, DEFS[it.type]));
    if (!rugs.length) return;
    for (const it of room.items) {
      const d = DEFS[it.type];
      if (d.cat !== 'seating' || d.kind !== 'floor' || ['ottoman', 'pouf', 'bench'].includes(it.type)) continue; // footstools have no front
      const b = floorBox(it, d);
      // the piece's front edge centre (pieces face +z before rotation)
      const fx = b.cx + Math.sin(b.a) * (b.hd - 0.08), fz = b.cz + Math.cos(b.a) * (b.hd - 0.08);
      const nearRug = rugs.some((r) => obbOverlap(r, b)); // seats that touch a rug stand with their front legs on it
      if (nearRug) assert.ok(rugs.some((r) => distToBox(fx, fz, r) === 0), `${it.type} front legs on the rug`);
    }
  });
}

test('applying a template keeps the room id and name; saving a room as a template drops ids', () => {
  const room = { id: 'keep', name: 'Mine', type: 'bedroom', width: 3, length: 3, height: 2.5, openings: [], finishes: {}, items: [], view: 'none', balcony: null };
  applyTemplateTo(room, TEMPLATES[0], uid);
  assert.equal(room.id, 'keep'); assert.equal(room.name, 'Mine');
  assert.equal(room.items.length, TEMPLATES[0].room.items.length);
  const t = roomAsTemplate(room, { name: 'Saved' }, uid);
  assert.ok(t.room.items.every((it) => !('id' in it)));
  assert.equal(t.type, TEMPLATES[0].type);
});

test('applying a template updates the type, and a default name with it', () => {
  const room = { id: 'r', name: 'Living room', type: 'living', width: 5, length: 4, height: 2.6, openings: [], finishes: {}, items: [], view: 'garden', balcony: null };
  applyTemplateTo(room, TEMPLATE_BY_ID['bedroom-soft-minimal'], uid, ['Kitchen']);
  assert.equal(room.type, 'bedroom'); assert.equal(room.name, 'Bedroom');
  // numbered when another room has that name already
  applyTemplateTo(room, TEMPLATE_BY_ID['kitchen-scandi'], uid, ['Kitchen']);
  assert.equal(room.type, 'kitchen'); assert.equal(room.name, 'Kitchen 2');
  // a template's own name counts as a default too
  room.name = 'Japandi studio'; applyTemplateTo(room, TEMPLATE_BY_ID['office-moody'], uid, []);
  assert.equal(room.name, 'Office');
  // a name the user chose stays
  room.name = "Ana's room"; applyTemplateTo(room, TEMPLATE_BY_ID['dining-mid-century'], uid, []);
  assert.equal(room.type, 'dining'); assert.equal(room.name, "Ana's room");
  assert.ok(isDefaultRoomName('Bedroom 3') && !isDefaultRoomName('Bedroom for Ana'));
});
