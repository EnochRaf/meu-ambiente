// Project model, autosave and share-link encoding. No three.js here.
import { ROOM_TYPES, roomTypeOf, templateOpenings, templateFinishes } from './roomTypes.js';
import { RAILINGS, BALCONY_FLOORS, clampBalcony } from './balcony.js';
import { ATMOSPHERE_BY_ID } from './atmospheres.js';
import { starterLivingRoom } from './starter.js';

export const VIEWS = ['garden', 'ocean', 'city', 'none'];

const STORAGE_KEY = 'roomsmith:v1';
export const uid = () => Math.random().toString(36).slice(2, 10);
export const SURFACES = ['floor', 'N', 'S', 'W', 'E'];

export function defaultRoom(type = 'living', name = null) {
  const t = roomTypeOf(type);
  return {
    id: uid(), name: name || t.name, type: ROOM_TYPES[type] ? type : 'living',
    width: t.size[0], length: t.size[1], height: t.size[2],
    openings: templateOpenings(type, uid), finishes: templateFinishes(type), items: [],
    view: 'garden', balcony: null,
  };
}

export function defaultProject() {
  const room = starterLivingRoom(uid);
  return { version: 2, activeRoomId: room.id, rooms: [room], time: 2, atmosphere: 'golden-evening', lamps: 0.6 };
}

export function activeRoom(project) {
  return project.rooms.find((r) => r.id === project.activeRoomId) || project.rooms[0];
}

// ---- tiny store with undo/redo ------------------------------------------------
// update(mutate, { undoable, coalesce }): every undoable update snapshots the
// previous state. Updates sharing a `coalesce` key in a row (a slider drag)
// collapse into one undo step. Room switching is not undoable, and undo/redo
// keep the room you are looking at when it still exists.
export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 800;
export function createStore(initial, { now = () => Date.now() } = {}) {
  let state = initial;
  const listeners = new Set();
  const undoStack = [], redoStack = [];
  let lastCoalesce = null, lastAt = 0;
  const emit = () => listeners.forEach((l) => l(state));
  const restore = (snapshot) => {
    const keep = state.activeRoomId;
    state = snapshot.rooms.some((r) => r.id === keep) ? { ...snapshot, activeRoomId: keep } : snapshot;
    lastCoalesce = null;
    emit();
  };
  return {
    get: () => state,
    update(mutate, { undoable = true, coalesce = null } = {}) {
      const prev = state;
      const next = structuredClone(state);
      mutate(next);
      state = next;
      const merged = coalesce && coalesce === lastCoalesce && now() - lastAt < COALESCE_MS;
      if (undoable && !merged) {
        undoStack.push(prev);
        if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
        redoStack.length = 0;
      }
      if (undoable) { lastCoalesce = coalesce; lastAt = now(); }
      emit();
    },
    undo() { if (!undoStack.length) return false; redoStack.push(state); restore(undoStack.pop()); return true; },
    redo() { if (!redoStack.length) return false; undoStack.push(state); restore(redoStack.pop()); return true; },
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    replace(next) { state = next; undoStack.length = redoStack.length = 0; lastCoalesce = null; emit(); },
    subscribe(l) { listeners.add(l); return () => listeners.delete(l); },
  };
}

// ---- validation (used for both storage and share links) --------------------
const num = (v, lo, hi, dflt) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
const str = (v, dflt) => (typeof v === 'string' ? v.slice(0, 60) : dflt);
const WALLS = ['N', 'S', 'W', 'E'];
const finish = (f, dflt) => ({
  mat: f && /^[a-z]{2,12}$/.test(f.mat || '') ? f.mat : dflt.mat,
  color: f && /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color.toLowerCase() : dflt.color,
});

export function sanitizeProject(raw) {
  if (!raw || !Array.isArray(raw.rooms) || raw.rooms.length === 0) return null;
  const rooms = raw.rooms.map((r, i) => {
    const type = ROOM_TYPES[r.type] ? r.type : 'living';
    const tf = templateFinishes(type);
    const fin = r.finishes && typeof r.finishes === 'object' ? r.finishes : {};
    return {
      id: str(r.id, uid()),
      name: str(r.name, `Room ${i + 1}`),
      type,
      width: num(r.width, 1, 30, 5),
      length: num(r.length, 1, 30, 4),
      height: num(r.height, 2, 6, 2.6),
      openings: (Array.isArray(r.openings) ? r.openings : []).map((o) => ({
        id: str(o.id, uid()),
        wall: WALLS.includes(o.wall) ? o.wall : 'S',
        type: o.type === 'window' ? 'window' : 'door',
        offset: num(o.offset, 0, 30, 1),
        width: num(o.width, 0.3, 10, 0.9),
        bottom: num(o.bottom, 0, 5, 0),
        height: num(o.height, 0.2, 6, 2.1),
      })),
      finishes: Object.fromEntries(SURFACES.map((k) => [k, finish(fin[k], tf[k])])),
      ...(typeof r.style === 'string' && /^[a-z]{2,20}$/.test(r.style) ? { style: r.style } : {}),
      view: VIEWS.includes(r.view) ? r.view : 'garden',
      balcony: null,
      items: (Array.isArray(r.items) ? r.items : []).map((it) => ({
        id: str(it.id, uid()),
        type: str(it.type, ''),
        ...(WALLS.includes(it.wall)
          ? { wall: it.wall, u: num(it.u, -1, 31, 0), y: num(it.y, 0, 6, 1.5) }
          : { x: num(it.x, -1, 31, 0), z: num(it.z, -1, 31, 0), rot: num(it.rot, -7, 7, 0) }),
        ...(it.zone === 'balcony' && !WALLS.includes(it.wall) ? { zone: 'balcony' } : {}),
        ...(it.finish && typeof it.finish === 'object' ? { finish: finish(it.finish, { mat: 'paint', color: '#cccccc' }) } : {}),
        ...(typeof it.frame === 'string' && /^#[0-9a-f]{6}$/i.test(it.frame) ? { frame: it.frame.toLowerCase() } : {}),
      })).filter((it) => it.type),
    };
  });
  raw.rooms.forEach((r, i) => {
    const b = r.balcony;
    if (!b || typeof b !== 'object' || !WALLS.includes(b.wall)) { rooms[i].items = rooms[i].items.filter((it) => it.zone !== 'balcony'); return; }
    rooms[i].balcony = clampBalcony(rooms[i], {
      wall: b.wall, offset: num(b.offset, 0, 30, 1), width: num(b.width, 0.5, 30, 3), depth: num(b.depth, 0.5, 5, 1.8),
      railing: RAILINGS.includes(b.railing) ? b.railing : 'glass', floor: BALCONY_FLOORS.includes(b.floor) ? b.floor : 'wood',
    });
  });
  const activeRoomId = rooms.some((r) => r.id === raw.activeRoomId) ? raw.activeRoomId : rooms[0].id;
  return {
    version: 2, activeRoomId, rooms, time: num(raw.time, 0, 3, 1),
    atmosphere: ATMOSPHERE_BY_ID[raw.atmosphere] ? raw.atmosphere : null,
    lamps: typeof raw.lamps === 'number' && isFinite(raw.lamps) ? Math.min(1.5, Math.max(0, raw.lamps)) : null,
  };
}

// ---- autosave ---------------------------------------------------------------
export function loadLocal() {
  try { return sanitizeProject(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { return null; }
}
export function saveLocal(project) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch {}
}

// ---- share link: deflate + base64url, with a plain-JSON fallback -----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(project) {
  const json = new TextEncoder().encode(JSON.stringify(project));
  if (typeof CompressionStream === 'function') {
    return 'z.' + b64url(await pipe(json, new CompressionStream('deflate-raw')));
  }
  return 'j.' + b64url(json);
}

export async function decodeShare(str) {
  if (!str) return null;
  const [mode, data] = str.split('.', 2);
  if (!data) return null;
  let bytes = unb64url(data);
  if (mode === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return sanitizeProject(JSON.parse(new TextDecoder().decode(bytes)));
}

export const shareUrl = (code) => `${location.origin}${location.pathname}#p=${code}`;
export const readShareHash = () => (location.hash.match(/p=([^&]+)/) || [])[1] || null;
