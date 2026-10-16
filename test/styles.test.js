import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STYLES, applyStyle } from '../src/styles.js';
import { MATERIAL_BY_ID } from '../src/materials.js';

test('every style covers every material family with a valid colour', () => {
  for (const s of STYLES) {
    for (const m of Object.keys(MATERIAL_BY_ID)) assert.match(s.palette[m] || '', /^#[0-9a-f]{6}$/i, `${s.id} ${m}`);
    assert.ok(MATERIAL_BY_ID[s.floor.mat] && MATERIAL_BY_ID[s.wall.mat]);
  }
});

test('applyStyle recolours floor, walls and items but keeps material types', () => {
  const defs = { sofa: { finish: { mat: 'fabric', color: '#111111' } }, lamp: { finish: { mat: 'metal', color: '#222222' } } };
  const room = { finishes: { floor: {}, N: {}, S: {}, W: {}, E: {} }, items: [{ type: 'sofa' }, { type: 'lamp', finish: { mat: 'wood', color: '#333333' } }, { type: 'ghost' }] };
  const s = STYLES.find((x) => x.id === 'industrial');
  applyStyle(room, s, defs);
  assert.deepEqual(room.finishes.floor, s.floor);
  assert.deepEqual(room.finishes.E, s.wall);
  assert.deepEqual(room.items[0].finish, { mat: 'fabric', color: s.palette.fabric });
  assert.deepEqual(room.items[1].finish, { mat: 'wood', color: s.palette.wood }, 'user-chosen material type is kept');
  assert.equal(room.items[2].finish, undefined);
  assert.equal(room.style, 'industrial');
});
