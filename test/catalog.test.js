import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, DEFS, buildItemMesh } from '../src/catalog.js';
import { ROOM_TYPES, templateOpenings, templateFinishes } from '../src/roomTypes.js';
import { MATERIAL_BY_ID } from '../src/materials.js';
import { sanitizeProject, defaultRoom, defaultProject } from '../src/state.js';

// makeMaterial draws textures on a canvas; stub the DOM for node.
const ctx2d = () => new Proxy({}, { get: () => () => ctx2d() }); // every 2D call returns another stub (gradients etc.)
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };

test('catalog ids are unique and finishes use known materials', () => {
  const ids = CATALOG.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const d of CATALOG) {
    assert.ok(MATERIAL_BY_ID[d.finish.mat], `${d.id} finish ${d.finish.mat}`);
    assert.ok(['floor', 'rug', 'wall', 'hanging'].includes(d.kind));
    assert.equal(d.size.length, 3);
  }
});

test('every builder produces meshes and lamps carry a light', () => {
  for (const d of CATALOG) {
    const g = buildItemMesh(d);
    let meshes = 0, lights = 0;
    g.traverse((o) => { if (o.isMesh) meshes++; if (o.isLight) lights++; });
    assert.ok(meshes > 0, `${d.id} has meshes`);
    // lamps carry soft light sources, never three.js lights (fixed shader cost)
    assert.equal(lights, 0, `${d.id} has no three.js lights`);
    assert.equal((g.userData.lampSources || []).length, (d.lights || []).length, `${d.id} lamp sources`);
  }
});

test('room types reference real catalog items and produce valid openings', () => {
  for (const [type, t] of Object.entries(ROOM_TYPES)) {
    for (const id of t.catalog || []) assert.ok(DEFS[id], `${type} -> ${id}`);
    const [w, l] = t.size;
    for (const o of templateOpenings(type, () => 'x')) {
      const len = o.wall === 'N' || o.wall === 'S' ? w : l;
      assert.ok(o.offset - o.width / 2 >= 0 && o.offset + o.width / 2 <= len, `${type} ${o.type} on ${o.wall} fits`);
    }
    const f = templateFinishes(type);
    for (const k of ['floor', 'N', 'S', 'W', 'E']) assert.ok(MATERIAL_BY_ID[f[k].mat]);
  }
});

test('sanitizeProject upgrades a v1 project and keeps finishes and time', () => {
  const v1 = { version: 1, activeRoomId: 'a', rooms: [{ id: 'a', name: 'Old', width: 5, length: 4, height: 2.6, openings: [], items: [{ id: 'i', type: 'sofa', x: 1, z: 1, rot: 0 }] }] };
  const p = sanitizeProject(v1);
  assert.equal(p.rooms[0].type, 'living');
  assert.equal(p.rooms[0].finishes.floor.mat, 'wood');
  assert.equal(p.time, 1);
  assert.equal(p.rooms[0].items[0].finish, undefined);
  const q = sanitizeProject({ ...p, time: 2.5, rooms: [{ ...p.rooms[0], type: 'kitchen', finishes: { floor: { mat: 'tile', color: '#ABCDEF' }, N: { mat: 'bogus!', color: 'red' } }, items: [{ id: 'i', type: 'sofa', x: 1, z: 1, rot: 0, finish: { mat: 'leather', color: '#112233' } }] }] });
  assert.equal(q.time, 2.5);
  assert.equal(q.rooms[0].finishes.floor.color, '#abcdef');
  assert.equal(q.rooms[0].finishes.N.mat, 'paint', 'bad material falls back to the kitchen wall default');
  assert.deepEqual(q.rooms[0].items[0].finish, { mat: 'leather', color: '#112233' });
});

test('defaultRoom follows its type', () => {
  const b = defaultRoom('bathroom');
  assert.equal(b.width, 2.6); assert.equal(b.finishes.floor.mat, 'tile');
  assert.ok(b.openings.some((o) => o.type === 'window' && o.bottom === 0.6));
  assert.equal(defaultRoom('nope').type, 'living');
  assert.equal(defaultProject().version, 2);
});
