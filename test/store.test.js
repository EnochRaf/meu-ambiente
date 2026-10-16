import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, HISTORY_LIMIT } from '../src/state.js';

const init = () => ({ activeRoomId: 'a', rooms: [{ id: 'a', items: [] }, { id: 'b', items: [] }], time: 1 });

test('undo and redo walk the history', () => {
  const s = createStore(init());
  s.update((p) => p.rooms[0].items.push('x'));
  s.update((p) => p.rooms[0].items.push('y'));
  assert.deepEqual(s.get().rooms[0].items, ['x', 'y']);
  assert.equal(s.undo(), true);
  assert.deepEqual(s.get().rooms[0].items, ['x']);
  assert.equal(s.redo(), true);
  assert.deepEqual(s.get().rooms[0].items, ['x', 'y']);
  assert.equal(s.redo(), false);
  s.undo(); s.undo();
  assert.deepEqual(s.get().rooms[0].items, []);
  assert.equal(s.undo(), false);
});

test('a new update clears the redo stack', () => {
  const s = createStore(init());
  s.update((p) => p.rooms[0].items.push('x'));
  s.undo();
  s.update((p) => p.rooms[0].items.push('z'));
  assert.equal(s.canRedo(), false);
  assert.deepEqual(s.get().rooms[0].items, ['z']);
});

test('coalesced updates collapse into one undo step', () => {
  const s = createStore(init());
  for (const t of [1.2, 1.5, 2, 2.4]) s.update((p) => { p.time = t; }, { coalesce: 'time' });
  s.update((p) => p.rooms[0].items.push('x'));
  s.undo();
  assert.equal(s.get().time, 2.4);
  s.undo();
  assert.equal(s.get().time, 1, 'the whole slider drag undone at once');
});

test('non-undoable updates are skipped and undo keeps the current room', () => {
  const s = createStore(init());
  s.update((p) => p.rooms[0].items.push('x'));
  s.update((p) => { p.activeRoomId = 'b'; }, { undoable: false });
  s.undo();
  assert.equal(s.get().activeRoomId, 'b', 'still looking at room b');
  assert.deepEqual(s.get().rooms[0].items, []);
});

test('history is capped', () => {
  const s = createStore(init());
  for (let i = 0; i < HISTORY_LIMIT + 20; i++) s.update((p) => { p.time = i % 3; });
  let n = 0; while (s.undo()) n++;
  assert.equal(n, HISTORY_LIMIT);
});

test('coalescing stops after a pause', async () => {
  const { createStore, COALESCE_MS } = await import('../src/state.js');
  let clock = 0;
  const s = createStore(init(), { now: () => clock });
  s.update((p) => { p.time = 2; }, { coalesce: 'time' });
  clock += 100;
  s.update((p) => { p.time = 2.5; }, { coalesce: 'time' });
  clock += COALESCE_MS + 1;
  s.update((p) => { p.time = 0; }, { coalesce: 'time' });
  s.undo();
  assert.equal(s.get().time, 2.5, 'the later drag is its own step');
  s.undo();
  assert.equal(s.get().time, 1);
});

test('projects keep a known atmosphere and a clamped lamp level', async () => {
  const { sanitizeProject, defaultProject } = await import('../src/state.js');
  const base = defaultProject();
  // the starter home opens in a known atmosphere, furnished
  assert.ok(base.atmosphere === null || typeof base.atmosphere === 'string');
  assert.ok(base.rooms[0].items.length > 10);
  const ok = sanitizeProject({ ...base, atmosphere: 'cozy-night', lamps: 4 });
  assert.equal(ok.atmosphere, 'cozy-night'); assert.equal(ok.lamps, 1.5);
  const bad = sanitizeProject({ ...base, atmosphere: 'moody', lamps: 'bright' });
  assert.equal(bad.atmosphere, null); assert.equal(bad.lamps, null);
});
