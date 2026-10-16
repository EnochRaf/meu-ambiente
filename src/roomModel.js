// The room as a model: a floor slab, thick walls with a clean cut top, skirting
// boards, lined openings with architraves, panelled doors, framed windows with
// glass, sills and curtains, an optional balcony, and a soft shadow underneath.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMaterial, boxUV } from './materials.js';
import { mat } from './catalog.js';
import { wallLength } from './placement.js';
import { WALL_T, balconyFrame, toWorld } from './balcony.js';
import { viewGlassMaterial } from './views.js';
import { patchLamps } from './lamps.js';

export { WALL_T };
export const SLAB = 0.24;
// local x of a wall group = SIGN * u (see wallPose)
const SIGN = { N: 1, S: -1, W: -1, E: 1 };

export function wallPose(room, wall, u, y, inset = 0) {
  switch (wall) {
    case 'N': return { pos: [u, y, inset], rotY: 0 };
    case 'S': return { pos: [u, y, room.length - inset], rotY: Math.PI };
    case 'W': return { pos: [inset, y, u], rotY: Math.PI / 2 };
    default:  return { pos: [room.width - inset, y, u], rotY: -Math.PI / 2 };
  }
}

// Split a wall into solid rectangles (u0,u1,y0,y1) around its openings.
export function wallSegments(room, wall) {
  const len = wallLength(room, wall), H = room.height;
  const ops = room.openings.filter((o) => o.wall === wall).sort((a, b) => a.offset - b.offset);
  const cuts = new Set([0, len]);
  for (const o of ops) { cuts.add(Math.max(0, o.offset - o.width / 2)); cuts.add(Math.min(len, o.offset + o.width / 2)); }
  const xs = [...cuts].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const u0 = xs[i], u1 = xs[i + 1];
    if (u1 - u0 < 1e-6) continue;
    const mid = (u0 + u1) / 2;
    const o = ops.find((op) => mid > op.offset - op.width / 2 && mid < op.offset + op.width / 2);
    if (!o) { segs.push([u0, u1, 0, H]); continue; }
    if (o.bottom > 0.01) segs.push([u0, u1, 0, o.bottom]);
    if (o.bottom + o.height < H - 0.01) segs.push([u0, u1, o.bottom + o.height, H]);
  }
  return segs;
}

const TRIM = { mat: 'paint', color: '#f6f4f0' };
const trimMat = () => makeMaterial(TRIM);
const cutMat = mat('#e2ddd4', { roughness: 0.92 });
// the cut along the wall tops: a deeper warm grey, like a section cut on a drawing, so the walls read crisply
const capMat = mat('#857d74', { roughness: 0.9 });
const frameMat = mat('#f3f2ee', { roughness: 0.38, clearcoat: 0.3 });
const steel = mat('#c4c8ce', { metalness: 1, roughness: 0.3 });
const plainGlass = mat('#e4f0f4', { transparent: true, opacity: 0.16, roughness: 0.03, depthWrite: false });

// Collects geometry per material and merges it into one mesh each.
class Batch {
  constructor() { this.parts = new Map(); }
  add(geo, material, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    if (material.map) boxUV(geo);
    else if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    const g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
  }
  box(w, h, d, material, x, y, z, r = 0) {
    const geo = r > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.1, h / 2.1, d / 2.1)) : new THREE.BoxGeometry(w, h, d);
    geo.translate(x, y, z); this.add(geo, material);
  }
  build(into, userData = {}, { shadow = true } = {}) {
    for (const [material, geos] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(geos), material);
      m.castShadow = shadow && !material.transparent; m.receiveShadow = true; Object.assign(m.userData, userData);
      into.add(m);
    }
  }
}

let softTex = null;
// a blurred rounded rectangle, used for the soft shadow under the room
export function softShadowTexture() {
  if (softTex) return softTex;
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  // alpha maps read the green channel: white shape on an opaque black ground
  if (g && g.roundRect) { g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128); g.filter = 'blur(14px)'; g.fillStyle = '#fff'; g.beginPath(); g.roundRect(26, 26, 76, 76, 14); g.fill(); }
  softTex = new THREE.CanvasTexture(c);
  return softTex;
}

function curtainGeometry(w, h, seed) {
  const geo = new THREE.PlaneGeometry(w, h, 36, 10), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), v = 0.5 - y / h; // 0 top .. 1 bottom
    const folds = Math.sin((x / w) * Math.PI * 9 + seed) * (0.022 + 0.01 * v) + Math.sin((x / w) * Math.PI * 3.3 + seed * 2) * 0.008;
    p.setXYZ(i, x * (1 + 0.1 * v), y, folds);
  }
  geo.computeVertexNormals();
  return geo;
}

// Build the room shell. Returns { group, walls, floor, panes }.
export function buildRoom(room, { view = 'garden' } = {}) {
  const { width: W, length: L, height: H } = room, T = WALL_T;
  const group = new THREE.Group(), walls = {}, panes = [];

  // floor finish on top of a slab
  const floorMat = makeMaterial(room.finishes.floor, 'surface').clone();
  const fgeo = new THREE.BoxGeometry(W, 0.03, L); fgeo.translate(W / 2, -0.015, L / 2); boxUV(fgeo);
  const floor = new THREE.Mesh(fgeo, floorMat);
  floor.receiveShadow = true; floor.userData.surface = 'floor';
  group.add(floor);
  const slab = new Batch(); slab.box(W + 2 * T, SLAB - 0.03, L + 2 * T, cutMat, W / 2, -(SLAB + 0.03) / 2, L / 2); slab.build(group, { surface: 'floor' });

  group.add(buildPlinth(room));

  const balc = room.balcony;
  for (const wall of ['N', 'S', 'W', 'E']) {
    const len = wallLength(room, wall), s = SIGN[wall];
    const wg = new THREE.Group(); wg.userData.wall = wall;
    const pose = wallPose(room, wall, 0, 0, 0); wg.position.set(...pose.pos); wg.rotation.y = pose.rotY;
    const wallMat = makeMaterial(room.finishes[wall], 'surface');
    const B = new Batch(), trim = new Batch();
    for (let [u0, u1, y0, y1] of wallSegments(room, wall)) {
      // the front and back walls run past the corners so the corners close
      const horiz = wall === 'N' || wall === 'S';
      if (horiz && u0 < 1e-6) u0 = -T;
      if (horiz && u1 > len - 1e-6) u1 = len + T;
      if (y0 < 1e-6) y0 = -0.03;
      const geo = new THREE.BoxGeometry(u1 - u0, y1 - y0, T); geo.translate(s * (u0 + u1) / 2, (y0 + y1) / 2, -T / 2);
      B.add(geo, wallMat);
      if (y1 >= H - 1e-6) trim.box(u1 - u0, 0.006, T + 0.002, capMat, s * (u0 + u1) / 2, H + 0.003, -T / 2);
    }
    // skirting boards, broken by doors and floor-level windows
    const gaps = room.openings.filter((o) => o.wall === wall && o.bottom < 0.12).map((o) => [o.offset - o.width / 2 - (o.type === 'door' ? 0.07 : 0), o.offset + o.width / 2 + (o.type === 'door' ? 0.07 : 0)]).sort((a, b) => a[0] - b[0]);
    let at = 0;
    for (const [g0, g1] of [...gaps, [len, len]]) { if (g0 - at > 0.05) trim.box(g0 - at, 0.09, 0.016, trimMat(), s * (at + g0) / 2, 0.045, 0.008, 0.004); at = Math.max(at, g1); }

    for (const o of room.openings.filter((op) => op.wall === wall)) {
      const og = new THREE.Group(); og.userData.opening = o.id;
      og.position.set(s * o.offset, o.bottom + o.height / 2, 0);
      const w = o.width, h = o.height, O = new Batch(), lift = o.bottom + h / 2;
      const M = (geoFn, material, x, y, z) => { const g = geoFn(); g.translate(x, y, z); O.add(g, material); };
      if (o.type === 'door') {
        O.box(0.025, h, T, trimMat(), -w / 2 + 0.0125, 0, -T / 2); O.box(0.025, h, T, trimMat(), w / 2 - 0.0125, 0, -T / 2); O.box(w, 0.025, T, trimMat(), 0, h / 2 - 0.0125, -T / 2);
        for (const sx of [-1, 1]) O.box(0.07, h + 0.07, 0.02, trimMat(), sx * (w / 2 + 0.035), 0.035, 0.01, 0.005);
        O.box(w + 0.14, 0.07, 0.022, trimMat(), 0, h / 2 + 0.035, 0.011, 0.005);
        const leafMat = makeMaterial({ mat: 'wood', color: '#c9a882' }), lw = w - 0.05, lh = h - 0.03;
        O.box(lw, lh, 0.04, leafMat, 0, -0.012, -0.04, 0.006);
        for (const py of [lh * 0.22, -lh * 0.24]) O.box(lw - 0.2, lh * 0.36, 0.008, leafMat, 0, py - 0.012, -0.018, 0.004);
        const hy = 1.0 - lift, hx = w / 2 - 0.1;
        M(() => new THREE.CylinderGeometry(0.028, 0.028, 0.012, 24).rotateX(Math.PI / 2), steel, hx, hy, -0.014);
        M(() => new THREE.CylinderGeometry(0.009, 0.009, 0.05, 12).rotateX(Math.PI / 2), steel, hx, hy, 0.005);
        O.box(0.13, 0.018, 0.018, steel, hx - 0.055, hy, 0.03, 0.008);
        O.build(og, { surface: wall });
      } else {
        const door = o.bottom < 0.2, onBalcony = !!(balc && balc.wall === wall && Math.abs(o.offset - balc.offset) < balc.width / 2);
        // lining across the wall, architrave, frame profile with a mullion when wide
        O.box(0.02, h, T, trimMat(), -w / 2 + 0.01, 0, -T / 2); O.box(0.02, h, T, trimMat(), w / 2 - 0.01, 0, -T / 2); O.box(w, 0.02, T, trimMat(), 0, h / 2 - 0.01, -T / 2);
        for (const sx of [-1, 1]) O.box(0.06, h + (door ? 0.06 : 0.09), 0.02, trimMat(), sx * (w / 2 + 0.03), door ? 0.03 : 0.015, 0.01, 0.005);
        O.box(w + 0.12, 0.06, 0.022, trimMat(), 0, h / 2 + 0.03, 0.011, 0.005);
        const fz = -T * 0.5;
        O.box(0.055, h, 0.07, frameMat, -w / 2 + 0.0475, 0, fz, 0.006); O.box(0.055, h, 0.07, frameMat, w / 2 - 0.0475, 0, fz, 0.006);
        O.box(w - 0.04, 0.055, 0.07, frameMat, 0, h / 2 - 0.0475, fz, 0.006); O.box(w - 0.04, 0.055, 0.07, frameMat, 0, -h / 2 + 0.0475, fz, 0.006);
        const leaves = w > 1.25 ? 2 : 1;
        if (leaves === 2) O.box(0.06, h - 0.08, 0.07, frameMat, 0, 0, fz, 0.006);
        if (door) { O.box(w, 0.02, T, cutMat, 0, -h / 2 - 0.01 - (o.bottom - 0.0), -T / 2); for (const sx of leaves === 2 ? [-1, 1] : [1]) O.box(0.016, 0.16, 0.03, steel, sx * 0.06, 1.0 - lift, fz + 0.05, 0.007); }
        else {
          O.box(w + 0.16, 0.03, T / 2 + 0.05, makeMaterial({ mat: 'stone', color: '#ece8e1' }, 'surface'), 0, -h / 2 - 0.015, (0.05 - T / 2) / 2, 0.006);
          O.box(w + 0.1, 0.04, 0.1, cutMat, 0, -h / 2 - 0.02, -T - 0.03, 0.006);
          O.box(0.016, 0.12, 0.03, steel, (leaves === 2 ? -0.06 : w / 2 - 0.12), 0, fz + 0.05, 0.007);
        }
        O.build(og, { surface: wall });
        // glass: a soft view of the chosen scenery, or clear glass onto the balcony
        const gw = w - 0.1, gh = h - 0.1, showView = !onBalcony && view !== 'none';
        const glassMat = showView ? viewGlassMaterial(wall) : plainGlass;
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glassMat);
        pane.position.z = fz; pane.userData.surface = wall; pane.userData.pane = true; pane.renderOrder = onBalcony ? 2 : 0;
        if (showView) { pane.userData.area = gw * gh; panes.push(pane); }
        og.add(pane);
        // curtains on a rod, gathered to each side
        const rodY = Math.min(H - 0.08 - lift, h / 2 + 0.16), floorY = -lift + 0.015, ph = rodY - 0.03 - floorY;
        const C = new Batch(), cMat = makeMaterial({ mat: 'fabric', color: '#efe8dc' }).clone(); cMat.side = THREE.DoubleSide;
        const span = [-(o.offset) + 0.03, len - o.offset - 0.03]; // keep inside the wall (in u relative to the opening)
        let rod0 = Infinity, rod1 = -Infinity;
        for (const sx of [-1, 1]) {
          const pw = Math.min(0.5, Math.max(0.3, w * 0.28));
          let c0 = sx < 0 ? -w / 2 - pw + 0.14 : w / 2 - 0.14, c1 = c0 + pw;
          const uc0 = Math.max(span[0], Math.min(span[1], c0 * s)), uc1 = Math.max(span[0], Math.min(span[1], c1 * s));
          const a = Math.min(uc0, uc1) * s, b = Math.max(uc0, uc1) * s; c0 = Math.min(a, b); c1 = Math.max(a, b);
          if (c1 - c0 < 0.15) continue;
          rod0 = Math.min(rod0, c0); rod1 = Math.max(rod1, c1);
          const g = curtainGeometry(c1 - c0, ph, sx * 1.7 + o.offset); g.translate((c0 + c1) / 2, floorY + ph / 2, 0.11); C.add(g, cMat);
        }
        if (rod1 > rod0) {
          const rl = rod1 - rod0 + 0.12, rc = (rod0 + rod1) / 2, rodMat = mat('#2f3236', { metalness: 0.9, roughness: 0.35 });
          const rg = new THREE.CylinderGeometry(0.011, 0.011, rl, 12).rotateZ(Math.PI / 2); rg.translate(rc, rodY, 0.11); C.add(rg, rodMat);
          for (const ex of [rc - rl / 2, rc + rl / 2]) { const f = new THREE.SphereGeometry(0.022, 12, 8); f.translate(ex, rodY, 0.11); C.add(f, rodMat); const br = new THREE.BoxGeometry(0.015, 0.015, 0.1); br.translate(ex + Math.sign(rc - ex) * 0.05, rodY, 0.06); C.add(br, rodMat); }
          C.build(og, { surface: wall });
        }
      }
      wg.add(og);
    }
    B.build(wg, { surface: wall });
    trim.build(wg, { surface: wall });
    walls[wall] = wg; group.add(wg);
  }

  if (balc) group.add(buildBalcony(room, balc));
  return { group, walls, floor, panes };
}

const DECK = { wood: { mat: 'wood', color: '#a8865f' }, tiles: { mat: 'tile', color: '#d8d2c8' }, concrete: { mat: 'concrete', color: '#bdb8ae' } };
export function buildBalcony(room, b) {
  const f = balconyFrame(room, b), g = new THREE.Group(), bw = b.width, bd = b.depth, B = new Batch();
  g.position.set(f.start[0], 0, f.start[1]); g.rotation.y = f.theta; g.userData.balcony = true;
  B.box(bw, SLAB - 0.03, bd, cutMat, bw / 2, -(SLAB + 0.03) / 2, bd / 2);
  const deck = makeMaterial(DECK[b.floor] || DECK.wood, 'surface');
  B.box(bw - 0.03, 0.03, bd - 0.03, deck, bw / 2, -0.015, bd / 2);
  const runs = [[0, bd, bw, bd], [0, 0, 0, bd], [bw, 0, bw, bd]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), along = x1 !== x0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const sz = (lx, h, t) => (along ? [lx, h, t] : [t, h, lx]);
    if (b.railing === 'concrete') { B.box(...sz(len + 0.14, 1.0, 0.14), cutMat, cx, 0.47, cz, 0.01); B.box(...sz(len + 0.18, 0.05, 0.2), trimMat(), cx, 0.995, cz, 0.012); continue; }
    if (b.railing === 'glass') {
      B.box(...sz(len, 0.92, 0.016), plainGlass, cx, 0.5, cz);
      const n = Math.max(1, Math.round(len / 1.1));
      for (let i = 0; i <= n; i++) { const t = (len * i) / n; B.box(0.04, 0.1, 0.05, steel, along ? x0 + t : x0, 0.05, along ? z0 : z0 + t, 0.006); }
      B.box(...sz(len + 0.04, 0.045, 0.06), steel, cx, 1.0, cz, 0.018);
    } else {
      const n = Math.round(len / 0.11);
      for (let i = 0; i <= n; i++) { const t = (len * i) / n, c = new THREE.CylinderGeometry(0.01, 0.01, 0.95, 8); c.translate(along ? x0 + t : x0, 0.48, along ? z0 : z0 + t); B.add(c, mat('#2c2f33', { metalness: 0.7, roughness: 0.4 })); }
      B.box(...sz(len + 0.04, 0.04, 0.05), mat('#2c2f33', { metalness: 0.7, roughness: 0.4 }), cx, 0.97, cz, 0.015);
      B.box(...sz(len, 0.025, 0.03), mat('#2c2f33', { metalness: 0.7, roughness: 0.4 }), cx, 0.06, cz, 0.008);
    }
  }
  // glass is drawn after the opaque parts, without shadows
  const glass = B.parts.get(plainGlass); B.parts.delete(plainGlass);
  B.build(g, { surface: 'floor' });
  if (glass) { const m = new THREE.Mesh(mergeGeometries(glass), plainGlass); m.renderOrder = 2; m.userData.surface = 'floor'; g.add(m); }
  return g;
}

// The base: a light, rounded plinth the room (and its balcony) stands on, with a
// gentle bevel and a soft two-layer shadow beneath. It sits just under the slab.
export const PLINTH = { margin: 0.42, radius: 0.55, height: 0.1 };
const plinthMat = patchLamps(new THREE.MeshPhysicalMaterial({ color: '#efeae3', roughness: 0.62, clearcoat: 0.25, clearcoatRoughness: 0.5, sheen: 0.2, sheenRoughness: 0.9 }));
const shadowMats = [0.5, 0.26].map((opacity) => new THREE.MeshBasicMaterial({ color: '#2b2722', alphaMap: softShadowTexture(), transparent: true, opacity, depthWrite: false }));
export function modelBounds(room) {
  const T = WALL_T;
  let x0 = -T, x1 = room.width + T, z0 = -T, z1 = room.length + T;
  if (room.balcony) {
    const b = room.balcony;
    for (const [x, z] of [[0, 0], [b.width, 0], [0, b.depth], [b.width, b.depth]]) { const w = toWorld(room, b, x, z); x0 = Math.min(x0, w.x); x1 = Math.max(x1, w.x); z0 = Math.min(z0, w.z); z1 = Math.max(z1, w.z); }
  }
  return { x0, x1, z0, z1 };
}
function buildPlinth(room) {
  const { x0, x1, z0, z1 } = modelBounds(room), m = PLINTH.margin, h = PLINTH.height;
  const w = x1 - x0 + 2 * m, d = z1 - z0 + 2 * m, r = Math.min(PLINTH.radius, w / 2 - 0.01, d / 2 - 0.01);
  const shape = new THREE.Shape(), hw = w / 2, hd = d / 2;
  shape.moveTo(-hw + r, -hd); shape.lineTo(hw - r, -hd); shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0); shape.lineTo(hw, hd - r); shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2);
  shape.lineTo(-hw + r, hd); shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI); shape.lineTo(-hw, -hd + r); shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5);
  const bevel = 0.035;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24 });
  geo.rotateX(Math.PI / 2); // extrude downwards
  const g = new THREE.Group(), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, top = -SLAB;
  const mesh = new THREE.Mesh(geo, plinthMat);
  mesh.position.set(cx, top - bevel, cz); mesh.receiveShadow = true; mesh.castShadow = true; mesh.raycast = () => {}; mesh.userData.plinth = true;
  g.add(mesh);
  // a tight contact shadow and a wide, faint one
  for (const [i, sc] of [[0, 1.08], [1, 1.55]]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMats[i]);
    sh.rotation.x = -Math.PI / 2; sh.position.set(cx, top - h - 0.004 - i * 0.002, cz + 0.06 * (i + 1)); sh.scale.set(w * sc * 1.25, d * sc * 1.25, 1);
    sh.raycast = () => {}; sh.userData.noAO = true; g.add(sh);
  }
  return g;
}
