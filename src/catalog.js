// Furniture catalog, all procedural. Every builder fills a THREE.Group whose
// origin is the item's anchor: floor items stand on y = 0, wall items are
// centred on the panel with their back at local z = 0 facing +z.
// `build(g, P)` receives the item's primary material (its chosen finish).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeMaterial, boxUV } from './materials.js';
import { patchLamps, makeLampSource } from './lamps.js';
import { addModel, modelSize, loadModel, hasParts } from './models.js';

export const PALETTE = {
  slate: '#6f7f9e', sage: '#9fb49b', sand: '#d9c7a7', clay: '#c98368', ink: '#3d4148',
  cream: '#f2ede3', oak: '#b89468', walnut: '#7d5d42', mist: '#cfd6de', moss: '#6e8a5e',
  linen: '#e6dfd1', night: '#3b4a6b', glass: '#9fc3d6', steel: '#b9bec5', white: '#f7f7f5', chrome: '#d8dbe0', brass: '#c9a45c',
};

// ---- materials ------------------------------------------------------------------
const mats = new Map();
// plain physical material for small parts without a surface pattern
export function mat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, patchLamps(new THREE.MeshPhysicalMaterial({ color, roughness: 0.6, metalness: 0, ...extra })));
  return mats.get(key);
}
// a finish: material, colour, and for pieces with a separate frame (legs, shell) its colour
const F = (m, color, frame) => (frame ? { mat: m, color, frame } : { mat: m, color });
const M = {
  wood: (c = PALETTE.walnut) => makeMaterial(F('wood', c)), oak: () => makeMaterial(F('wood', PALETTE.oak)),
  fabric: (c) => makeMaterial(F('fabric', c)), metal: (c = PALETTE.ink) => makeMaterial(F('metal', c)), ceramic: (c = PALETTE.white) => makeMaterial(F('ceramic', c)),
  brass: () => mat(PALETTE.brass, { metalness: 1, roughness: 0.28 }), chrome: () => mat(PALETTE.chrome, { metalness: 1, roughness: 0.12 }),
  glass: () => mat('#dfeef5', { transparent: true, opacity: 0.22, roughness: 0.02, metalness: 0, transmission: 0, ior: 1.5 }),
  marble: () => makeMaterial(F('stone', '#efebe4')), soil: () => mat('#4e3d31', { roughness: 1 }),
};
const asMat = (m) => (m && m.isMaterial ? m : mat(m));

// ---- geometry helpers --------------------------------------------------------------
function part(geo, m, x = 0, y = 0, z = 0) {
  const material = asMat(m);
  if (material.map) boxUV(geo);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
const rgeo = (w, h, d, r = 0.02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2.05, h / 2.05, d / 2.05));
const rbox = (w, h, d, m, x = 0, y = 0, z = 0, r = 0.012) => part(rgeo(w, h, d, r), m, x, y, z);
const box = rbox;
const cyl = (rt, rb, h, m, x = 0, y = 0, z = 0, seg = 32, open = false) => part(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m, x, y, z);
const ball = (r, m, x = 0, y = 0, z = 0) => part(new THREE.SphereGeometry(r, 24, 16), m, x, y, z);
const lathe = (pts, m, x = 0, y = 0, z = 0, seg = 40) => part(new THREE.LatheGeometry(pts.map(([a, b]) => new THREE.Vector2(a, b)), seg), m, x, y, z);
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// A draped sheet (duvet, throw): a grid laid over a box top whose edges roll
// over a small radius and hang down the sides and the foot, with soft folds.
function drape(w, d, drop, { r = 0.05, sides = true, foot = true, waves = 0.006, seed = 1 } = {}) {
  const sx = w + (sides ? 2 * drop : 0), sz = d + (foot ? drop : 0), nx = 64, nz = 64, rnd = rng(seed);
  const geo = new THREE.PlaneGeometry(sx, sz, nx, nz).rotateX(-Math.PI / 2), p = geo.attributes.position;
  const bend = (s, half) => { // distance along the sheet -> (offset, drop) over a rounded edge
    const a = Math.abs(s), flat = half - r, arc = (Math.PI / 2) * r;
    if (a <= flat) return [s, 0];
    if (a <= flat + arc) { const t = (a - flat) / r; return [Math.sign(s) * (flat + r * Math.sin(t)), r * (1 - Math.cos(t))]; }
    return [Math.sign(s) * half, r + (a - flat - arc)];
  };
  const ph = [rnd() * 6, rnd() * 6];
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i), v = p.getZ(i) + (foot ? -drop / 2 : 0); // v: 0 at the middle of the top, + towards the foot
    const [x, dx] = sides ? bend(u, w / 2) : [u, 0];
    const vz = v + d / 2; // 0 at the head
    let z = vz, dz = 0;
    if (foot && vz > d - r) { const [o, dd] = bend(vz - d / 2, d / 2); z = o + d / 2; dz = dd; }
    const hang = dx + dz, wave = Math.sin(u * 9 + ph[0]) * Math.sin(v * 7 + ph[1]) * waves;
    p.setXYZ(i, x + Math.sign(x) * Math.min(hang, 0.06) * 0.08, -hang + wave * (1 + hang * 4), z - d / 2);
  }
  geo.computeVertexNormals();
  return geo;
}
// Our upholstered bed: a slim platform on short legs, a channel-tufted headboard,
// a white mattress under a draped duvet with its top folded back, layered pillows
// and a throw across the foot in the second colour.
function upholsteredBed(g, P, accent) {
  const W = 1.7, L = 2.18, legM = M.wood(PALETTE.walnut), linen = M.fabric('#f4f0e8'), sheet = M.fabric('#ece6db'), acc = M.fabric(accent);
  for (const m of [linen, sheet, acc]) m.side = THREE.DoubleSide;
  const z0 = -L / 2 + 0.1; // the mattress starts just in front of the headboard
  g.add(rbox(W, 0.2, L - 0.1, P, 0, 0.17, 0.05, 0.04));                                     // platform
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) taperedLeg(g, sx * (W / 2 - 0.08), sz * (L / 2 - 0.12) + 0.05, 0.08, legM, { cap: false, top: 0.022, bottom: 0.018 });
  // headboard: vertical channels side by side, a little reclined
  const ch = 7, cw = W / ch;
  for (let i = 0; i < ch; i++) { const c = cushion(g, cw * 1.02, 1.08, 0.1, P, -W / 2 + cw * (i + 0.5), 0.62, -L / 2 + 0.03, { puff: 0.05, seam: false }); c.rotation.x = -0.06; }
  g.add(rbox(W + 0.02, 0.05, 0.12, P, 0, 0.13, -L / 2 + 0.03, 0.02));
  cushion(g, W - 0.08, 0.2, L - 0.16, M.fabric('#faf8f3'), 0, 0.37, 0.07, { puff: 0.06, seam: false }); // mattress
  // the duvet hangs over the sides and the foot; its top part is folded back
  const duvet = new THREE.Mesh(drape(W - 0.06, L - 0.62, 0.22, { r: 0.06, seed: 3 }), linen); duvet.position.set(0, 0.485, z0 + 0.52 + (L - 0.62) / 2); duvet.castShadow = duvet.receiveShadow = true; g.add(duvet);
  const fold = cushion(g, W - 0.04, 0.05, 0.26, sheet, 0, 0.5, z0 + 0.55, { puff: 0.5, seam: false }); fold.rotation.x = 0.04;
  // a throw across the foot in the accent colour
  const throwM = new THREE.Mesh(drape(W - 0.02, 0.5, 0.3, { r: 0.05, foot: false, waves: 0.01, seed: 7 }), acc); throwM.position.set(0, 0.5, L / 2 - 0.42); throwM.castShadow = throwM.receiveShadow = true; g.add(throwM);
  // pillows: two euro squares against the headboard, two sleeping pillows, one small cushion
  // standing pillows are made lying down (so they puff towards the room) and tipped up against the headboard
  const up = (w, t, h, m, x, y, z, lean, puff) => cushion(g, w, t, h, m, x, y, z, { puff, seam: true, rx: -(Math.PI / 2 - lean) });
  for (const s of [-1, 1]) {
    up(0.6, 0.2, 0.58, P, s * 0.41, 0.8, z0 + 0.12, 0.2, 0.55);
    cushion(g, 0.66, 0.15, 0.44, M.fabric('#fbfaf6'), s * 0.37, 0.59, z0 + 0.36, { puff: 0.45, seam: false, rx: -0.3 });
  }
  up(0.46, 0.14, 0.3, acc, 0, 0.66, z0 + 0.5, 0.38, 0.7);
}

// A soft cushion: rounded block whose top and bottom puff out, with a piped seam
// running round the middle of its sides.
function cushion(g, w, h, d, m, x, y, z, { puff = 0.35, seam = true, rx = 0, ry = 0 } = {}) {
  const r = Math.min(h * 0.45, w * 0.2, d * 0.2);
  let geo = new RoundedBoxGeometry(w, h, d, 6, r);
  const p = geo.attributes.position, hw = w / 2, hh = h / 2, hd = d / 2;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const fx = Math.max(0, 1 - (vx / hw) ** 2), fz = Math.max(0, 1 - (vz / hd) ** 2), bulge = fx * fz;
    p.setY(i, vy + Math.sign(vy) * bulge * h * puff * (Math.abs(vy) / hh));
    const side = Math.max(0, 1 - (vy / hh) ** 2) * 0.04 * h;
    p.setX(i, vx + Math.sign(vx) * side * fz); p.setZ(i, vz + Math.sign(vz) * side * fx);
  }
  geo.computeVertexNormals();
  const mesh = part(geo, m, x, y, z); mesh.rotation.set(rx, ry, 0); g.add(mesh);
  if (seam) {
    const sw = hw - r * 0.15, sd = hd - r * 0.15, rr = Math.min(r, sw * 0.5, sd * 0.5) * 0.9, s = new THREE.Shape();
    s.moveTo(-sw + rr, -sd); s.lineTo(sw - rr, -sd); s.absarc(sw - rr, -sd + rr, rr, -Math.PI / 2, 0); s.lineTo(sw, sd - rr); s.absarc(sw - rr, sd - rr, rr, 0, Math.PI / 2); s.lineTo(-sw + rr, sd); s.absarc(-sw + rr, sd - rr, rr, Math.PI / 2, Math.PI); s.lineTo(-sw, -sd + rr); s.absarc(-sw + rr, -sd + rr, rr, Math.PI, Math.PI * 1.5);
    const pts = s.getSpacedPoints(80).map((v) => new THREE.Vector3(v.x, 0, v.y));
    const pipe = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, Math.min(0.007, h * 0.06), 6, true), asMat(m));
    pipe.position.set(x, y, z); pipe.rotation.set(rx, ry, 0); pipe.castShadow = false; pipe.receiveShadow = true;
    if (asMat(m).color) { const pm = asMat(m).clone(); pm.color = asMat(m).color.clone().multiplyScalar(0.82); pipe.material = pm; }
    g.add(pipe);
  }
  return mesh;
}
// Tapered round leg with a metal foot cap; returns nothing, adds to g.
function taperedLeg(g, x, z, h, m, { top = 0.022, bottom = 0.014, cap = true, splay = 0 } = {}) {
  const leg = cyl(top, bottom, h, m, x, h / 2, z, 20); leg.rotation.set(splay * Math.sign(z), 0, -splay * Math.sign(x)); g.add(leg);
  if (cap) g.add(cyl(bottom + 0.002, bottom + 0.002, 0.03, M.brass(), x + Math.sign(x) * splay * h * 0.5, 0.015, z + Math.sign(z) * splay * h * 0.5, 16));
}
function turnedLeg(g, x, z, h, m) {
  g.add(lathe([[0, 0], [0.016, 0], [0.018, 0.02], [0.014, 0.05], [0.017, h * 0.55], [0.022, h * 0.62], [0.018, h * 0.7], [0.022, h - 0.03], [0.022, h], [0, h]], m, x, 0, z, 18));
}
function squareLegs(g, w, d, h, m, inset = 0.05, t = 0.045) { for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(rbox(t, h, t, m, sx * (w / 2 - inset), h / 2, sz * (d / 2 - inset), 0.006)); }
function handle(g, x, y, z, len = 0.12, vertical = false) {
  const m = M.brass(), t = 0.008;
  const barMesh = cyl(t, t, len, m, x, y, z + 0.03, 12); if (!vertical) barMesh.rotation.z = Math.PI / 2; g.add(barMesh);
  for (const s of [-1, 1]) g.add(cyl(t * 0.8, t * 0.8, 0.03, m, x + (vertical ? 0 : s * len * 0.4), y + (vertical ? s * len * 0.4 : 0), z + 0.015, 10).rotateX(Math.PI / 2));
}
function plinth(g, w, d, h, m, x = 0, z = 0) { g.add(rbox(w, h, d, m, x, h / 2, z, 0.006)); }
// a warm shade whose emissive glow the scene fades in at night, with a soft
// halo around it (an additive sprite, faded in with the lamps)
let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  if (g && g.createRadialGradient) { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}
function shade(g, geo, x, y, z, color = PALETTE.cream, haloSize = 0) {
  const m = patchLamps(new THREE.MeshPhysicalMaterial({ color, roughness: 0.9, emissive: '#ffb86e', emissiveIntensity: 0, side: THREE.DoubleSide, sheen: 0.4, sheenRoughness: 0.8 }));
  m.userData.disposable = true;
  const mesh = part(geo, m, x, y, z); mesh.userData.glow = true; mesh.userData.glowK = 0.62; mesh.castShadow = false; g.add(mesh);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff3dc' })); bulb.position.set(x, y, z); bulb.userData.bulb = true; bulb.visible = false; g.add(bulb);
  halo(g, x, y, z, haloSize || (geo.parameters?.radiusBottom || 0.08) * 5);
  return mesh;
}
// the soft glow around a lit lamp, faded in with the lamps
function halo(g, x, y, z, size) {
  const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: '#ffc98e', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  h.material.userData.disposable = true; h.scale.set(size, size, 1); h.position.set(x, y, z); h.userData.halo = true; h.renderOrder = 3; h.raycast = () => {}; g.add(h);
  return h;
}
// A pleated fabric shade: a tapered drum whose wall folds in and out, finished
// with a rolled edge top and bottom, and a translucent diffuser across the top.
function pleatedShade(g, x, y, z, { top, bottom, height, pleats = 64, depth = 0.006, color = '#f2eadc', haloSize = 0.7 }) {
  const seg = pleats * 4, geo = new THREE.CylinderGeometry(top, bottom, height, seg, 6, true), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vz = p.getZ(i), a = Math.atan2(vz, vx), f = 1 + (depth / Math.hypot(vx, vz)) * Math.cos(a * pleats);
    p.setX(i, vx * f); p.setZ(i, vz * f);
  }
  geo.computeVertexNormals();
  const s = shade(g, geo, x, y, z, color, haloSize);
  const trim = s.material.clone(); trim.color.multiplyScalar(0.93); trim.userData.disposable = true;
  for (const [r, yy] of [[top + depth, y + height / 2], [bottom + depth, y - height / 2]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0045, 8, 160).rotateX(Math.PI / 2), trim);
    ring.position.set(x, yy, z); ring.userData.glow = true; ring.userData.glowK = 0.62; ring.castShadow = false; ring.userData.noLampShadow = true; g.add(ring);
  }
  const dif = s.material.clone(); dif.userData.disposable = true; dif.transparent = true; dif.opacity = 0.55; dif.color.set('#fbf6ee');
  const disc = new THREE.Mesh(new THREE.CircleGeometry(top * 0.98, 64).rotateX(-Math.PI / 2), dif);
  disc.position.set(x, y + height / 2 - 0.004, z); disc.userData.glow = true; disc.userData.glowK = 0.62; disc.castShadow = false; g.add(disc);
  return s;
}
// lamp hardware inside the shade: socket, harp and finial (no lamp shadows: the bulb sits among them)
function lampFittings(g, x, yTop, z, socketY, m) {
  const add = (mesh) => { mesh.userData.noLampShadow = true; g.add(mesh); };
  add(lathe([[0, 0], [0.017, 0], [0.019, 0.006], [0.017, 0.012], [0.015, 0.05], [0.012, 0.055], [0, 0.055]], m, x, socketY - 0.055, z, 24));
  const harp = new THREE.CatmullRomCurve3([[-0.06, socketY - 0.03, 0], [-0.07, socketY + 0.05, 0], [-0.03, yTop - 0.01, 0], [0, yTop, 0], [0.03, yTop - 0.01, 0], [0.07, socketY + 0.05, 0], [0.06, socketY - 0.03, 0]].map(([a, b, c]) => new THREE.Vector3(x + a, b, z + c)));
  add(part(new THREE.TubeGeometry(harp, 48, 0.0022, 6), m));
  add(lathe([[0, 0], [0.008, 0], [0.012, 0.01], [0.011, 0.018], [0.005, 0.026], [0, 0.028]], m, x, yTop, z, 20));
}
// foliage: many small leaves (flattened, curved ellipsoids) fanned around a
// centre, vertex-shaded lighter at the tips, merged into one mesh
const leafMat = patchLamps(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide }));
function leafGeometry() {
  const geo = new THREE.SphereGeometry(1, 10, 6), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, x * 0.42, y * 0.06 + (z * z) * 0.12 - Math.abs(x) * 0.08, z * 0.5 + 0.5); }
  geo.deleteAttribute('uv');
  return geo;
}
function foliage(g, cx, cy, cz, size, colors, seed = 1, n = 9, sy = 1, { leaf = 0.14, droop = 0.35 } = {}) {
  const r = rng(seed), base = leafGeometry(), parts = [], q = new THREE.Quaternion(), e = new THREE.Euler(), m = new THREE.Matrix4(), c = new THREE.Color();
  const count = Math.round(n * 9);
  for (let i = 0; i < count; i++) {
    // points spread through a rounded crown, leaves pointing outwards and a little down
    const u = r() * 2 - 1, a = r() * Math.PI * 2, rad = Math.cbrt(r()) * size * 0.55, h = Math.sqrt(1 - u * u);
    const px = cx + Math.cos(a) * h * rad, py = cy + u * rad * 0.8 * sy, pz = cz + Math.sin(a) * h * rad;
    e.set(-droop - r() * 0.5 + u * 0.5, -a + Math.PI / 2, (r() - 0.5) * 0.8, 'YXZ'); q.setFromEuler(e);
    const sc = leaf * (0.7 + r() * 0.6) * (size / 0.4) ** 0.5;
    m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sc, sc, sc));
    const geo = base.clone().applyMatrix4(m), cnt = geo.attributes.position.count, col = new Float32Array(cnt * 3);
    c.set(colors[i % colors.length]).multiplyScalar(0.8 + 0.35 * (0.5 + u * 0.5) + (r() - 0.5) * 0.15);
    for (let k = 0; k < cnt; k++) col.set([c.r, c.g, c.b], k * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(geo.index ? geo.toNonIndexed() : geo);
  }
  const merged = mergeGeometries(parts); merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, leafMat); mesh.castShadow = mesh.receiveShadow = true; mesh.userData.foliage = true; g.add(mesh);
}
function books(g, x0, x1, y, z, depth, seed, { lean = true } = {}) {
  const r = rng(seed), cols = ['#b5543c', '#3b4a6b', '#8a9a74', '#d9c7a7', '#2f3338', '#c9a45c', '#6f7f9e', '#e9e3d8', '#7b4e5e'];
  let x = x0;
  while (x < x1 - 0.03) {
    if (r() < 0.12 && x1 - x > 0.25) { // a short stack lying flat, with a small object on top
      let yy = y; for (let k = 0; k < 2 + Math.floor(r() * 3); k++) { const hh = 0.025 + r() * 0.015; g.add(rbox(0.16 + r() * 0.05, hh, depth * 0.8, cols[Math.floor(r() * cols.length)], x + 0.1, yy + hh / 2, z, 0.003)); yy += hh; }
      if (r() < 0.6) g.add(lathe([[0, 0], [0.025, 0], [0.032, 0.03], [0.02, 0.07], [0.012, 0.09], [0, 0.09]], M.ceramic(['#e9e3d8', '#9fb49b', '#c98368'][Math.floor(r() * 3)]), x + 0.1, yy, z, 24));
      x += 0.24; continue;
    }
    const w = 0.018 + r() * 0.03, h = 0.17 + r() * 0.1, c = cols[Math.floor(r() * cols.length)];
    const b = rbox(w, h, depth * (0.75 + r() * 0.2), c, x + w / 2, y + h / 2, z, 0.004);
    if (lean && r() < 0.08) { b.rotation.z = -0.25; b.position.x += 0.03; b.position.y -= 0.01; x += 0.04; }
    g.add(b); if (r() < 0.3) g.add(box(w * 0.98, 0.012, 0.002, '#e8dcc0', x + w / 2, y + h * 0.82, z + depth * 0.4, 0.001));
    x += w + 0.002;
  }
}


// ---- framed prints of our own --------------------------------------------------------
// Abstract artwork painted on a canvas in the piece's colour (with lighter and
// deeper tones of it, a warm paper and a dark line), behind a white mat in a
// moulded frame whose colour is the piece's frame colour.
const artCache = new Map();
function artTexture(kind, color, w, h) {
  const key = kind + color + w + h;
  if (artCache.has(key)) return artCache.get(key);
  const W = 512, H = Math.round(512 * h / w), c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (g && g.fillRect) {
    const base = new THREE.Color(color), hex = (k, toward = '#f3ece2') => '#' + base.clone().lerp(new THREE.Color(toward), k).getHexString();
    const paper = '#f2ebe1', soft = hex(0.55), mid = hex(0.25), deep = '#' + base.clone().multiplyScalar(0.62).getHexString(), ink = '#2b2622', sand = '#d9c6a9';
    g.fillStyle = paper; g.fillRect(0, 0, W, H);
    const r = rng(kind.length * 977 + Math.round(base.r * 255));
    if (kind === 'arches') {
      // nested arches standing on a ground line, a sun beside them
      const bw = W * 0.26;
      [[0.3, soft, 0.62], [0.52, '#' + base.getHexString(), 0.72], [0.74, sand, 0.5]].forEach(([cx, col, hh]) => {
        g.fillStyle = col; const x = W * cx, top = H * (1 - hh), bot = H * 0.84;
        g.beginPath(); g.moveTo(x - bw / 2, bot); g.lineTo(x - bw / 2, top + bw / 2); g.arc(x, top + bw / 2, bw / 2, Math.PI, 0); g.lineTo(x + bw / 2, bot); g.closePath(); g.fill();
      });
      g.fillStyle = deep; g.beginPath(); g.arc(W * 0.78, H * 0.22, W * 0.07, 0, Math.PI * 2); g.fill();
      g.fillStyle = ink; g.fillRect(W * 0.1, H * 0.84, W * 0.8, 3);
    } else if (kind === 'hills') {
      // layered hills under a low sun
      g.fillStyle = soft; g.beginPath(); g.arc(W * 0.62, H * 0.38, W * 0.16, 0, Math.PI * 2); g.fill();
      [[0.55, sand], [0.68, mid], [0.8, deep]].forEach(([y, col], i) => {
        g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 8) g.lineTo(x, H * y + Math.sin(x / W * Math.PI * (1.3 + i * 0.6) + i * 1.7) * H * 0.06);
        g.lineTo(W, H); g.closePath(); g.fill();
      });
    } else if (kind === 'blocks') {
      // soft cut-out shapes, a few leaves, a line
      const blob = (x, y, rx, ry, col) => { g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, r() * 0.6 - 0.3, 0, Math.PI * 2); g.fill(); };
      blob(W * 0.38, H * 0.42, W * 0.22, H * 0.2, soft); blob(W * 0.62, H * 0.6, W * 0.18, H * 0.16, '#' + base.getHexString()); blob(W * 0.36, H * 0.72, W * 0.1, H * 0.08, sand);
      g.strokeStyle = ink; g.lineWidth = 3; g.beginPath(); g.moveTo(W * 0.2, H * 0.25); g.bezierCurveTo(W * 0.5, H * 0.1, W * 0.6, H * 0.5, W * 0.82, H * 0.3); g.stroke();
      for (let i = 0; i < 3; i++) { g.fillStyle = deep; g.beginPath(); g.ellipse(W * (0.7 + i * 0.05), H * (0.2 + i * 0.06), W * 0.035, H * 0.012, 0.8, 0, Math.PI * 2); g.fill(); }
    } else {
      // a single flowing line over two tones
      g.fillStyle = soft; g.fillRect(0, H * 0.55, W, H * 0.45);
      g.fillStyle = '#' + base.getHexString(); g.beginPath(); g.arc(W * 0.3, H * 0.55, H * 0.2, Math.PI, 0); g.fill();
      g.strokeStyle = ink; g.lineWidth = 2.5; g.beginPath(); g.moveTo(W * 0.05, H * 0.7);
      for (let x = 0; x <= W * 0.95; x += 6) g.lineTo(x + W * 0.05, H * 0.62 + Math.sin(x / W * 9) * H * 0.08 * Math.sin(x / W * 3));
      g.stroke();
    }
    // a little paper grain
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(80,60,40,${0.03 * r()})`; g.fillRect(r() * W, r() * H, 1.5, 1.5); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  artCache.set(key, t);
  return t;
}
function printDef(id, name, w, h, kind, color, frame) {
  return { id, cat: 'decor', name, kind: 'wall', size: [w, h, 0.035], finish: F('paint', color, frame), frameable: true,
    build(g, P, fin) {
      const fm = mat(fin?.frame || frame, { roughness: 0.55 }), lip = 0.024, d = 0.034;
      // moulding: four bars with rounded edges, a recessed white mat and the print
      g.add(rbox(w, lip, d, fm, 0, h / 2 - lip / 2, d / 2, 0.004)); g.add(rbox(w, lip, d, fm, 0, -h / 2 + lip / 2, d / 2, 0.004));
      g.add(rbox(lip, h - 2 * lip, d, fm, -w / 2 + lip / 2, 0, d / 2, 0.004)); g.add(rbox(lip, h - 2 * lip, d, fm, w / 2 - lip / 2, 0, d / 2, 0.004));
      const mw = w - 2 * lip, mh = h - 2 * lip, m = Math.min(mw, mh) * 0.11;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), mat('#f6f2ea', { roughness: 0.95 })); board.position.z = 0.012; board.receiveShadow = true; g.add(board);
      const art = patchLamps(new THREE.MeshStandardMaterial({ map: artTexture(kind, fin?.color || color, mw - 2 * m, mh - 2 * m), roughness: 0.9 })); art.userData.disposable = true;
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(mw - 2 * m, mh - 2 * m), art); pic.position.z = 0.0125; pic.receiveShadow = true; g.add(pic);
    } };
}

// A plain wool rug with a soft rounded body and a slightly darker bound edge.
function rugDef(id, name, w, d, color) {
  return { id, cat: 'decor', name, kind: 'rug', size: [w, d, 0.02], finish: F('carpet', color),
    build(g, P, fin) {
      const edge = makeMaterial(F('carpet', '#' + new THREE.Color(fin?.color || color).multiplyScalar(0.8).getHexString()));
      g.add(rbox(w, 0.015, d, edge, 0, 0.0075, 0, 0.006));
      g.add(rbox(w - 0.07, 0.017, d - 0.07, P, 0, 0.0085, 0, 0.007));
    } };
}

// Model-based pieces. `q` = quarter-turns so the piece faces +z with its long
// side along x; `decor` places small models (and our books) on its surfaces.
// `retint`: recolour the model with its finish colour from the start (dark source models)
function modelDef(id, cat, name, model, { q = 0, kind = 'floor', finish, decor = null, lights, scale = 1, mat = 'fabric', retint = false, tintDetail = 1, frameable = null, frameLabel = null, frameKind = null } = {}) {
  const [w, d, h] = modelSize(model, q, scale);
  const size = kind === 'wall' ? [w, h, d] : [w, d, h];
  // hanging pieces hang from the ceiling: their top is the group's origin
  const offset = kind === 'hanging' ? [0, -h, 0] : [0, 0, 0];
  const def = { id, cat, name, kind, size, model, finish: finish || F(mat, '#c8bfb2'), modelColor: (finish || F(mat, '#c8bfb2')).color, lights, frameable: frameable ?? hasParts(model), ...(frameLabel ? { frameLabel } : {}), ...(frameKind ? { frameKind } : {}),
    preload: () => Promise.all([loadModel(model), ...(decor ? decor.models.map(loadModel) : [])]),
    build(g, P, fin) {
      const tint = fin && (retint || fin.color !== def.modelColor) ? fin.color : null;
      // the frame keeps the model's own wood or metal unless a frame colour is set (or the piece is recoloured from the start)
      const frameTint = fin?.frame && (retint || fin.frame !== def.finish.frame) ? fin.frame : null;
      addModel(g, model, { quarter: q, scale, tint, frameTint, tintDetail, wall: kind === 'wall', offset });
      decor?.build(g, fin);
    } };
  return def;
}
const deco = (models, build) => ({ models, build });
// a table lamp of our own: a glazed ceramic jar on a turned wooden foot, brass
// neck and fittings, and a pleated linen shade
function tableLamp(g, x, y, z, base = '#e8e1d6') {
  const glaze = mat(base, { roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 });
  g.add(lathe([[0, 0], [0.058, 0], [0.062, 0.006], [0.06, 0.022], [0.052, 0.026], [0, 0.026]], M.wood(PALETTE.walnut), x, y, z, 48));
  g.add(lathe([[0, 0], [0.05, 0], [0.072, 0.03], [0.09, 0.08], [0.094, 0.12], [0.088, 0.17], [0.066, 0.215], [0.034, 0.24], [0.026, 0.25], [0.028, 0.258], [0, 0.26]], glaze, x, y + 0.026, z, 64));
  g.add(lathe([[0, 0], [0.018, 0], [0.02, 0.008], [0.009, 0.014], [0.0065, 0.02], [0.0065, 0.1], [0, 0.1]], M.brass(), x, y + 0.284, z, 24));
  lampFittings(g, x, y + 0.52, z, y + 0.43, M.brass());
  pleatedShade(g, x, y + 0.44, z, { top: 0.1, bottom: 0.145, height: 0.18, pleats: 48, depth: 0.0045, color: '#f3ebdd', haloSize: 0.6 });
}
// a floor lamp of our own: weighted turned base, slim stem with a brass collar,
// pleated shade, and its cord trailing over the floor to a foot switch
function floorLamp(g, P) {
  g.add(lathe([[0, 0], [0.15, 0], [0.158, 0.004], [0.16, 0.014], [0.155, 0.024], [0.13, 0.03], [0.04, 0.038], [0.022, 0.05], [0, 0.05]], P, 0, 0, 0, 64));
  g.add(lathe([[0, 0], [0.011, 0], [0.0105, 0.62], [0, 0.62]], P, 0, 0.05, 0, 16));
  g.add(lathe([[0, 0], [0.016, 0], [0.017, 0.004], [0.017, 0.036], [0.016, 0.04], [0, 0.04]], M.brass(), 0, 0.66, 0, 24));
  g.add(lathe([[0, 0], [0.0105, 0], [0.0095, 0.6], [0, 0.6]], P, 0, 0.7, 0, 16));
  lampFittings(g, 0, 1.6, 0, 1.47, M.brass());
  pleatedShade(g, 0, 1.47, 0, { top: 0.16, bottom: 0.215, height: 0.3, pleats: 72, depth: 0.006, color: PALETTE.cream, haloSize: 0.75 });
  const cord = new THREE.CatmullRomCurve3([[0.12, 0.012, 0.0], [0.2, 0.004, 0.06], [0.32, 0.004, 0.02], [0.42, 0.004, 0.1], [0.5, 0.004, 0.08]].map((p) => new THREE.Vector3(...p)));
  g.add(part(new THREE.TubeGeometry(cord, 48, 0.0028, 6), '#2a2a2c'));
  const sw = rbox(0.05, 0.016, 0.03, '#2a2a2c', 0.5, 0.008, 0.08, 0.007); sw.rotation.y = 0.3; g.add(sw);
}
const put = (g, model, x, y, z, q = 0, scale = 1) => addModel(g, model, { quarter: q, scale, offset: [x, y, z] });
// a pair of CC0 wooden candlesticks with small flames that glow with the lamps;
// candleLights() gives the matching soft light sources for the piece's `lights`
const CANDLE_SPOTS = (x, z) => [[x - 0.05, z, 1], [x + 0.06, z + 0.04, 0.8]];
const candleLights = (x, y, z) => CANDLE_SPOTS(x, z).map(([cx, cz, sc]) => ({ pos: [cx, y + 0.222 * sc + 0.02, cz], color: '#ffb66e', strength: 1.1, reach: 1.6, focus: 0, size: 0.015 }));
const flameMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0', toneMapped: false });
function candles(g, x, y, z) {
  for (const [cx, cz, sc] of CANDLE_SPOTS(x, z)) {
    put(g, 'wooden_candlestick', cx, y, cz, 0, sc);
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8).scale(1, 2.2, 1), flameMat);
    f.position.set(cx, y + 0.222 * sc + 0.016, cz); f.userData.bulb = true; f.visible = false; f.raycast = () => {}; g.add(f);
    halo(g, cx, y + 0.222 * sc + 0.016, cz, 0.16);
  }
}
function modelDefs() {
  return [
    modelDef('loungeChair2', 'seating', 'Leather lounge chair', 'mid_century_lounge_chair', { mat: 'leather', finish: F('leather', '#7a4a2c', '#5b3b26') }),
    modelDef('woodArmchair', 'seating', 'Wood armchair', 'modern_arm_chair_01', { mat: 'leather', finish: F('leather', '#2b2a2a', '#9a7350') }),
    modelDef('oakCoffee', 'tables', 'Oak coffee table', 'modern_coffee_table_01', { q: 1, mat: 'wood', finish: F('wood', '#b08a5e'),
      decor: deco(['wooden_bowl_01', 'ceramic_vase_04'], (g) => { put(g, 'wooden_bowl_01', 0.28, 0.39, 0.02); put(g, 'ceramic_vase_04', -0.38, 0.39, -0.05, 0, 0.8); books(g, -0.12, 0.12, 0.39, 0.06, 0.22, 77, { lean: false }); }) }),
    modelDef('roundCoffee', 'tables', 'Round coffee table', 'coffee_table_round_01', { mat: 'stone', finish: F('stone', '#e9e6e1'),
      decor: deco(['ceramic_vase_02'], (g) => { put(g, 'ceramic_vase_02', 0.2, 0.49, -0.1, 0, 0.8); }) }),
    modelDef('oakSide', 'tables', 'Oak side table', 'side_table_01', { mat: 'wood', finish: F('wood', '#c49a64'),
      lights: [{ pos: [0.06, 0.551 + 0.43, -0.04], color: '#ffbf80', strength: 9, reach: 3.6, focus: 0.45 }],
      decor: deco(['potted_plant_04'], (g) => { tableLamp(g, 0.06, 0.551, -0.04); put(g, 'potted_plant_04', -0.16, 0.551, 0.12); }) }),
    modelDef('sideboard', 'storage', 'Sideboard', 'modern_wooden_cabinet', { mat: 'wood', finish: F('wood', '#8a6a4b'),
      lights: [{ pos: [0.95, 0.68 + 0.43, -0.02], color: '#ffbf80', strength: 9, reach: 3.6, focus: 0.45 }],
      decor: deco(['ceramic_vase_01', 'ceramic_vase_03', 'standing_picture_frame_01', 'wooden_bowl_01'], (g) => { put(g, 'ceramic_vase_01', -0.85, 0.68, 0); put(g, 'ceramic_vase_03', -0.62, 0.68, 0.05); put(g, 'standing_picture_frame_01', 0.55, 0.68, -0.05, 1); put(g, 'wooden_bowl_01', 0.15, 0.68, 0.05); books(g, -0.4, -0.1, 0.68, 0.0, 0.22, 91, { lean: false }); tableLamp(g, 0.95, 0.68, -0.02); }) }),
    modelDef('cubeShelf', 'storage', 'Cube shelf', 'wooden_display_shelves_01', { q: 3, mat: 'wood', finish: F('wood', '#c49a64'),
      decor: deco(['wicker_basket_01', 'ceramic_vase_02', 'potted_plant_04'], (g) => {
        put(g, 'wicker_basket_01', -0.27, 0.03, 0.0, 1, 0.85); put(g, 'wicker_basket_01', 0.27, 0.03, 0.0, 1, 0.85);
        books(g, -0.48, -0.08, 0.4, 0.0, 0.26, 61, { lean: true }); put(g, 'ceramic_vase_02', 0.27, 0.4, 0, 0, 0.75);
        books(g, 0.08, 0.48, 0.79, 0.0, 0.26, 63, { lean: true }); put(g, 'potted_plant_04', -0.27, 0.79, 0);
        put(g, 'ceramic_vase_03', 0.3, 1.556, 0.02, 0, 0.8); books(g, -0.45, -0.1, 1.556, 0.0, 0.26, 65, { lean: false });
      }) }),
    modelDef('sofa', 'seating', 'Sofa', 'sofa_02', { mat: 'fabric', finish: F('fabric', '#6f7f9e'), retint: true, tintDetail: 0.75,
      frameable: true, frameLabel: 'Cushions', frameKind: 'fabric',
      // its cushions keep their own pattern unless they are given a colour
      decor: deco(['throw_pillows_01'], (g, fin) => { addModel(g, 'throw_pillows_01', { offset: [0.05, 0.4, -0.12], tint: fin?.frame || null, tintDetail: 0.55 }); }) }),
    modelDef('chair', 'seating', 'Dining chair', 'dining_chair_02', { mat: 'fabric', finish: F('fabric', '#d9c7a7', '#5e4230'), retint: true, tintDetail: 0.4 }),
    modelDef('dining', 'tables', 'Round dining table', 'round_wooden_table_01', { scale: 0.745, mat: 'wood', finish: F('wood', '#a47a4f'), retint: true,
      decor: deco(['ceramic_vase_01', 'wooden_bowl_01'], (g) => { put(g, 'wooden_bowl_01', 0.12, 0.748, 0.08); put(g, 'ceramic_vase_01', -0.14, 0.748, -0.06, 0, 0.85); }) }),
    modelDef('ottoman', 'seating', 'Leather ottoman', 'Ottoman_01', { scale: 0.72, mat: 'leather', finish: F('leather', '#8a5a3c', '#2e2622'), retint: true }),
    modelDef('pendant', 'lights', 'Globe pendant', 'modern_ceiling_lamp_01', { kind: 'hanging', scale: 1.15, mat: 'metal', finish: F('metal', '#d8dbe0'),
      lights: [{ pos: [0, -0.85, 0], color: '#ffc58c', strength: 13, reach: 5, focus: 0.25, size: 0.26 }],
      decor: deco([], (g) => { halo(g, 0, -0.85, 0, 0.9); }) }),
    modelDef('pendantShort', 'lights', 'Short globe pendant', 'modern_ceiling_lamp_01', { kind: 'hanging', scale: 0.8, mat: 'metal', finish: F('metal', '#d8dbe0'),
      lights: [{ pos: [0, -0.59, 0], color: '#ffc58c', strength: 10, reach: 4.6, focus: 0.2, size: 0.18 }],
      decor: deco([], (g) => { halo(g, 0, -0.59, 0, 0.65); }) }),
    modelDef('nightstand2', 'tables', 'Painted nightstand', 'painted_wooden_nightstand', { mat: 'wood', finish: F('wood', '#e9e4da'), retint: true, tintDetail: 0.6,
      lights: [{ pos: [0, 0.6155 + 0.44, -0.04], color: '#ffc68a', strength: 6.5, reach: 3, focus: 0.45 }],
      decor: deco([], (g) => { tableLamp(g, 0, 0.6155, -0.04, '#d8cfc2'); }) }),
    modelDef('counterStool', 'seating', 'Counter stool', 'metal_stool_01', { scale: 0.75, mat: 'metal', finish: F('metal', '#2f2d2b') }),
    modelDef('woodChair', 'seating', 'Wooden chair', 'painted_wooden_chair_01', { mat: 'paint', finish: F('paint', '#f1eee8') }),
    modelDef('clock', 'decor', 'Wall clock', 'wall_clock', { kind: 'wall', mat: 'metal', finish: F('metal', '#d8dbe0') }),
    modelDef('plantFig', 'decor', 'Leafy plant', 'potted_plant_01', { mat: 'ceramic', finish: F('ceramic', '#c47a52') }),
    modelDef('plantMonstera', 'decor', 'Big-leaf plant', 'potted_plant_02', { mat: 'ceramic', finish: F('ceramic', '#c47a52') }),
    modelDef('frameTall', 'decor', 'Framed print', 'hanging_picture_frame_01', { kind: 'wall', mat: 'paint', finish: F('paint', '#1f1f1f') }),
    modelDef('frameWide', 'decor', 'Wide framed print', 'hanging_picture_frame_02', { kind: 'wall', mat: 'paint', finish: F('paint', '#efece6') }),
    modelDef('frameSmall', 'decor', 'Small framed print', 'hanging_picture_frame_03', { kind: 'wall', mat: 'paint', finish: F('paint', '#c9a45c') }),
  ];
}

export const CATALOG = [
  // ---- living --------------------------------------------------------------------
  { id: 'armchair', cat: 'seating', name: 'Armchair', kind: 'floor', size: [0.9, 0.9, 0.8], finish: F('fabric', '#c98368'),
    build(g, P) {
      g.add(rbox(0.86, 0.16, 0.84, P, 0, 0.21, 0, 0.05)); g.add(rbox(0.58, 0.5, 0.2, P, 0, 0.58, -0.33, 0.07));
      for (const s of [-1, 1]) cushion(g, 0.17, 0.44, 0.86, P, s * 0.355, 0.43, 0, { puff: 0.08 });
      cushion(g, 0.54, 0.15, 0.64, P, 0, 0.37, 0.07); cushion(g, 0.52, 0.38, 0.16, P, 0, 0.65, -0.2, { puff: 0.25, rx: -0.12 });
      for (const sx of [-0.37, 0.37]) for (const sz of [-0.35, 0.35]) taperedLeg(g, sx, sz, 0.13, M.wood(), { splay: 0.06 });
    } },
  { id: 'pouf', cat: 'seating', name: 'Pouf', kind: 'floor', size: [0.55, 0.55, 0.42], finish: F('fabric', '#9fb49b'),
    build(g, P) { cushion(g, 0.55, 0.4, 0.55, P, 0, 0.2, 0, { puff: 0.15 }); for (let i = 0; i < 4; i++) g.add(ball(0.012, P, Math.cos(i * 1.57 + 0.78) * 0.12, 0.425, Math.sin(i * 1.57 + 0.78) * 0.12)); } },
  { id: 'bench', cat: 'seating', name: 'Bench', kind: 'floor', size: [1.3, 0.4, 0.46], finish: F('wood', '#b89468'),
    build(g, P) { g.add(rbox(1.3, 0.05, 0.4, P, 0, 0.42, 0, 0.012)); cushion(g, 1.22, 0.07, 0.34, PALETTE.linen, 0, 0.48, 0, { puff: 0.3 }); for (const sx of [-0.55, 0.55]) { g.add(rbox(0.05, 0.4, 0.34, P, sx, 0.2, 0, 0.01)); } g.add(rbox(1.1, 0.03, 0.04, P, 0, 0.12, 0, 0.005)); } },
  { id: 'coffee', cat: 'tables', name: 'Coffee table', kind: 'floor', size: [1.1, 0.6, 0.42], finish: F('wood', '#b89468'),
    build(g, P) {
      g.add(rbox(1.1, 0.04, 0.6, P, 0, 0.4, 0, 0.012)); g.add(rbox(1.0, 0.025, 0.5, P, 0, 0.13, 0, 0.008));
      for (const sx of [-0.49, 0.49]) for (const sz of [-0.24, 0.24]) taperedLeg(g, sx, sz, 0.38, P, { top: 0.02, bottom: 0.016, cap: false });
      books(g, -0.4, -0.05, 0.145, 0, 0.2, 5, { lean: false });
      g.add(lathe([[0, 0], [0.05, 0], [0.065, 0.02], [0.05, 0.1], [0.03, 0.16], [0.035, 0.18], [0, 0.18]], M.ceramic('#e9e3d8'), 0.3, 0.42, 0.05, 32));
      foliage(g, 0.3, 0.66, 0.05, 0.12, ['#7da35d', '#6b9150'], 3, 4, 1.3);
    } },
  { id: 'diningRect', cat: 'tables', name: 'Long dining table', kind: 'floor', size: [1.8, 0.9, 0.75], finish: F('wood', '#7a5235'), lights: candleLights(-0.2, 0.75, -0.02),
    preload: () => Promise.all(['wooden_candlestick', 'ceramic_vase_02'].map(loadModel)),
    build(g, P) {
      // a softly rounded top over a recessed apron, tapered legs splayed outwards, a vase and candles
      g.add(rbox(1.8, 0.035, 0.9, P, 0, 0.732, 0, 0.014));
      g.add(rbox(1.56, 0.07, 0.68, P, 0, 0.68, 0, 0.006));
      for (const sx of [-0.74, 0.74]) for (const sz of [-0.32, 0.32]) taperedLeg(g, sx, sz, 0.715, P, { top: 0.026, bottom: 0.014, cap: false, splay: 0.07 });
      put(g, 'ceramic_vase_02', 0.12, 0.75, 0.02, 0, 0.75);
      candles(g, -0.2, 0.75, -0.02);
    } },
  { id: 'tv', cat: 'storage', name: 'TV stand', kind: 'floor', size: [1.4, 0.4, 1.1], finish: F('wood', '#8a6a4b'),
    build(g, P) {
      g.add(rbox(1.4, 0.4, 0.4, P, 0, 0.3, 0, 0.012)); for (const sx of [-0.35, 0.35]) { g.add(rbox(0.68, 0.36, 0.01, P, sx, 0.3, 0.2, 0.004)); handle(g, sx, 0.4, 0.2, 0.14); }
      for (const sx of [-0.62, 0.62]) for (const sz of [-0.15, 0.15]) taperedLeg(g, sx, sz, 0.1, M.metal(), { cap: false, top: 0.012, bottom: 0.01 });
      g.add(rbox(1.12, 0.64, 0.035, '#1d2026', 0, 0.86, -0.08, 0.01)); g.add(box(1.08, 0.6, 0.002, mat('#11141a', { roughness: 0.08, clearcoat: 1 }), 0, 0.86, -0.06, 0.0005)); g.add(rbox(0.3, 0.02, 0.18, M.metal(), 0, 0.51, -0.08, 0.005));
    } },
  { id: 'bookcase', cat: 'storage', name: 'Bookcase', kind: 'floor', size: [0.9, 0.35, 1.8], finish: F('wood', '#b89468'),
    build(g, P) {
      g.add(rbox(0.9, 1.8, 0.02, P, 0, 0.9, -0.165, 0.005)); for (const s of [-1, 1]) g.add(rbox(0.03, 1.8, 0.35, P, s * 0.435, 0.9, 0, 0.008));
      for (let i = 0; i < 5; i++) g.add(rbox(0.86, 0.03, 0.34, P, 0, 0.05 + i * 0.425, 0, 0.006)); plinth(g, 0.86, 0.32, 0.05, P);
      for (let i = 0; i < 4; i++) books(g, -0.41, 0.41, 0.065 + i * 0.425, 0.0, 0.26, 11 + i * 7);
    } },
  { id: 'rug', cat: 'decor', name: 'Rug', kind: 'rug', size: [2.0, 1.4, 0.02], finish: F('carpet', '#9fb49b'),
    build(g, P) { g.add(rbox(2.0, 0.016, 1.4, P, 0, 0.008, 0, 0.006)); g.add(rbox(1.72, 0.017, 1.12, makeMaterial(F('carpet', PALETTE.linen)), 0, 0.0086, 0, 0.004)); } },
  printDef('printLarge', 'Large print', 1.2, 0.8, 'arches', '#b8643c', '#3a2b22'), printDef('printTall', 'Tall print', 0.6, 0.84, 'hills', '#8a9a7b', '#c9a873'),
  printDef('printSquare', 'Square print', 0.55, 0.55, 'blocks', '#c98368', '#2b2622'), printDef('printWide', 'Panorama print', 1.1, 0.45, 'lines', '#6f7f9e', '#e9e3d8'),
  rugDef('rugLarge', 'Large rug', 2.6, 1.8, '#d9cfbf'), rugDef('rugXL', 'Extra large rug', 3.0, 2.2, '#cfc3b0'), rugDef('runner', 'Runner', 0.8, 2.4, '#b9a891'),
  { id: 'rugRound', cat: 'decor', name: 'Round rug', kind: 'rug', size: [1.6, 1.6, 0.02], finish: F('carpet', '#c98368'),
    build(g, P) { g.add(cyl(0.8, 0.8, 0.016, P, 0, 0.008, 0, 64)); g.add(cyl(0.62, 0.62, 0.017, makeMaterial(F('carpet', PALETTE.sand)), 0, 0.0086, 0, 64)); g.add(part(new THREE.TorusGeometry(0.79, 0.008, 6, 96).rotateX(Math.PI / 2), P, 0, 0.012, 0)); } },
  { id: 'lamp', cat: 'lights', name: 'Floor lamp', kind: 'floor', size: [0.4, 0.4, 1.6], finish: F('metal', '#3d4148'),
    lights: [{ pos: [0, 1.48, 0], color: '#ffbd7e', strength: 17, reach: 6, focus: 0.6, size: 0.17 }],
    build(g, P) { floorLamp(g, P); } },
  { id: 'plant', cat: 'decor', name: 'Plant', kind: 'floor', size: [0.5, 0.5, 1.2], finish: F('ceramic', '#d9c7a7'),
    build(g, P) {
      g.add(lathe([[0, 0], [0.13, 0], [0.16, 0.04], [0.18, 0.3], [0.19, 0.33], [0.17, 0.33], [0, 0.31]], P, 0, 0, 0, 40)); g.add(cyl(0.165, 0.165, 0.01, M.soil(), 0, 0.31, 0, 32));
      for (const [a, h] of [[0, 0.62], [2.1, 0.5], [4.2, 0.56]]) g.add(cyl(0.008, 0.012, h, '#6b5844', Math.cos(a) * 0.03, 0.31 + h / 2, Math.sin(a) * 0.03, 8));
      foliage(g, 0, 0.9, 0, 0.42, ['#4f8a43', '#66a052', '#3f7337', '#76ad5c'], 7, 9, 1.2, { leaf: 0.16 });
    } },
  // ---- bedroom -----------------------------------------------------------------------
  { id: 'bed', cat: 'beds', name: 'Bed', kind: 'floor', size: [1.7, 2.18, 1.15], finish: F('fabric', '#cfc4b4', '#9a8a74'), frameable: true, frameLabel: 'Throw and cushion', frameKind: 'fabric',
    build(g, P, fin) { upholsteredBed(g, P, fin?.frame || '#9a8a74'); } },
  { id: 'nightstand', cat: 'tables', name: 'Nightstand', kind: 'floor', size: [0.5, 0.4, 0.55], finish: F('wood', '#8a6a4b'),
    lights: [{ pos: [0.12, 0.8, -0.05], color: '#ffc68a', strength: 5, reach: 2.8, focus: 0.5 }],
    build(g, P) { g.add(rbox(0.5, 0.42, 0.4, P, 0, 0.33, 0, 0.012)); g.add(rbox(0.46, 0.17, 0.01, P, 0, 0.37, 0.2, 0.004)); handle(g, 0, 0.38, 0.2, 0.1); for (const sx of [-0.21, 0.21]) for (const sz of [-0.16, 0.16]) taperedLeg(g, sx, sz, 0.12, P, { cap: false, top: 0.015, bottom: 0.011 }); g.add(lathe([[0, 0], [0.06, 0], [0.04, 0.03], [0.012, 0.25], [0, 0.25]], M.brass(), 0.12, 0.54, -0.05, 24)); shade(g, new THREE.CylinderGeometry(0.06, 0.09, 0.12, 32, 1, true), 0.12, 0.8, -0.05); } },
  { id: 'wardrobe', cat: 'storage', name: 'Wardrobe', kind: 'floor', size: [1.2, 0.6, 2.0], finish: F('paint', '#f2ede3'),
    build(g, P) { g.add(rbox(1.2, 1.94, 0.6, P, 0, 1.03, 0, 0.012)); plinth(g, 1.12, 0.52, 0.06, M.wood()); for (const sx of [-0.3, 0.3]) { g.add(rbox(0.58, 1.86, 0.012, P, sx, 1.03, 0.303, 0.004)); handle(g, sx - Math.sign(sx) * 0.24, 1.05, 0.31, 0.3, true); } } },
  { id: 'dresser', cat: 'storage', name: 'Dresser', kind: 'floor', size: [1.2, 0.5, 0.8], finish: F('wood', '#b89468'),
    build(g, P) { g.add(rbox(1.2, 0.68, 0.5, P, 0, 0.44, 0, 0.012)); for (let i = 0; i < 3; i++) { g.add(rbox(1.14, 0.2, 0.01, P, 0, 0.21 + i * 0.22, 0.25, 0.004)); for (const sx of [-0.3, 0.3]) handle(g, sx, 0.21 + i * 0.22, 0.25, 0.1); } for (const sx of [-0.56, 0.56]) for (const sz of [-0.21, 0.21]) taperedLeg(g, sx, sz, 0.1, P, { cap: false }); g.add(lathe([[0, 0], [0.05, 0], [0.06, 0.05], [0.03, 0.18], [0.02, 0.2], [0, 0.2]], M.ceramic('#9fb49b'), 0.4, 0.78, 0, 32)); } },
  // ---- bathroom ------------------------------------------------------------------------
  { id: 'bathtub', cat: 'bath', name: 'Bathtub', kind: 'floor', size: [0.8, 1.7, 0.6], finish: F('ceramic', '#f7f7f5'),
    build(g, P) {
      g.add(rbox(0.8, 0.56, 1.7, P, 0, 0.3, 0, 0.12)); g.add(rbox(0.64, 0.05, 1.5, mat('#bcd6e0', { roughness: 0.05, transparent: true, opacity: 0.75, clearcoat: 1 }), 0, 0.5, 0, 0.1));
      for (const sx of [-0.33, 0.33]) for (const sz of [-0.7, 0.7]) g.add(ball(0.04, M.brass(), sx, 0.03, sz));
      g.add(cyl(0.014, 0.014, 0.25, M.chrome(), 0, 0.68, -0.72, 12)); g.add(part(new THREE.TorusGeometry(0.06, 0.014, 8, 16, Math.PI), M.chrome(), 0, 0.8, -0.66).rotateY(Math.PI / 2));
    } },
  { id: 'shower', cat: 'bath', name: 'Shower', kind: 'floor', size: [0.9, 0.9, 2.1], finish: F('tile', '#eef1f3'),
    build(g, P) { g.add(rbox(0.9, 0.06, 0.9, P, 0, 0.03, 0, 0.01)); g.add(box(0.9, 2.0, 0.012, M.glass(), 0, 1.06, 0.44, 0.003)); g.add(box(0.012, 2.0, 0.9, M.glass(), 0.44, 1.06, 0, 0.003)); g.add(rbox(0.02, 2.0, 0.02, M.chrome(), 0.44, 1.06, 0.44, 0.005)); g.add(cyl(0.012, 0.012, 1.9, M.chrome(), -0.4, 1.02, -0.4, 12)); g.add(cyl(0.1, 0.1, 0.015, M.chrome(), -0.26, 1.98, -0.26, 32)); g.add(cyl(0.04, 0.04, 0.005, '#333', 0, 0.062, 0, 24)); } },
  { id: 'toilet', cat: 'bath', name: 'Toilet', kind: 'floor', size: [0.4, 0.7, 0.8], finish: F('ceramic', '#f7f7f5'),
    build(g, P) { g.add(rbox(0.38, 0.38, 0.18, P, 0, 0.6, -0.26, 0.05)); g.add(lathe([[0, 0], [0.13, 0], [0.16, 0.2], [0.2, 0.38], [0, 0.38]], P, 0, 0, 0.08, 40)); g.add(part(new THREE.TorusGeometry(0.16, 0.025, 10, 40).rotateX(Math.PI / 2).scale(1, 1, 1.2), P, 0, 0.41, 0.08)); g.add(rbox(0.06, 0.02, 0.03, M.chrome(), 0.1, 0.8, -0.26, 0.005)); } },
  { id: 'vanity', cat: 'bath', name: 'Sink', kind: 'floor', size: [0.8, 0.5, 0.85], finish: F('wood', '#8a6a4b'),
    build(g, P) { g.add(rbox(0.8, 0.62, 0.5, P, 0, 0.38, 0, 0.012)); for (const sx of [-0.2, 0.2]) { g.add(rbox(0.38, 0.56, 0.01, P, sx, 0.38, 0.25, 0.004)); handle(g, sx - Math.sign(sx) * 0.15, 0.55, 0.25, 0.1, true); } g.add(rbox(0.82, 0.03, 0.52, M.marble(), 0, 0.705, 0, 0.008)); g.add(lathe([[0, 0], [0.16, 0], [0.18, 0.1], [0.17, 0.1], [0.15, 0.02], [0, 0.02]], M.ceramic(), 0, 0.72, 0.02, 40)); g.add(cyl(0.012, 0.012, 0.2, M.chrome(), 0, 0.82, -0.17, 12)); g.add(rbox(0.02, 0.02, 0.1, M.chrome(), 0, 0.92, -0.13, 0.008)); } },
  { id: 'bathmat', cat: 'decor', name: 'Bath mat', kind: 'rug', size: [0.8, 0.5, 0.02], finish: F('fabric', '#9fb2c2'),
    build(g, P) { g.add(rbox(0.8, 0.018, 0.5, P, 0, 0.009, 0, 0.008)); } },
  // ---- kitchen ----------------------------------------------------------------------------
  { id: 'counter', cat: 'kitchen', name: 'Counter', kind: 'floor', size: [1.2, 0.6, 0.9], finish: F('paint', '#f2ede3'),
    build(g, P) { g.add(rbox(1.2, 0.8, 0.56, P, 0, 0.46, -0.02, 0.008)); plinth(g, 1.16, 0.5, 0.06, '#3d4148', 0, -0.04); for (const sx of [-0.3, 0.3]) { g.add(rbox(0.58, 0.74, 0.012, P, sx, 0.46, 0.265, 0.004)); handle(g, sx, 0.78, 0.27, 0.24); } g.add(rbox(1.22, 0.04, 0.62, M.marble(), 0, 0.88, 0, 0.006)); } },
  { id: 'sinkCounter', cat: 'kitchen', name: 'Sink counter', kind: 'floor', size: [1.2, 0.6, 0.9], finish: F('paint', '#f2ede3'),
    build(g, P) { g.add(rbox(1.2, 0.8, 0.56, P, 0, 0.46, -0.02, 0.008)); plinth(g, 1.16, 0.5, 0.06, '#3d4148', 0, -0.04); for (const sx of [-0.3, 0.3]) { g.add(rbox(0.58, 0.74, 0.012, P, sx, 0.46, 0.265, 0.004)); handle(g, sx, 0.78, 0.27, 0.24); } g.add(rbox(1.22, 0.04, 0.62, M.marble(), 0, 0.88, 0, 0.006)); g.add(rbox(0.6, 0.01, 0.4, mat(PALETTE.steel, { metalness: 1, roughness: 0.25 }), 0, 0.905, 0, 0.02)); const tap = new THREE.CatmullRomCurve3([[0, 0.9, -0.22], [0, 1.15, -0.22], [0, 1.2, -0.12], [0, 1.1, -0.04]].map((p) => new THREE.Vector3(...p))); g.add(part(new THREE.TubeGeometry(tap, 24, 0.012, 10), M.chrome())); } },
  { id: 'stove', cat: 'kitchen', name: 'Stove', kind: 'floor', size: [0.6, 0.6, 0.9], finish: F('metal', '#b9bec5'),
    build(g, P) { g.add(rbox(0.6, 0.86, 0.6, P, 0, 0.45, 0, 0.01)); g.add(box(0.5, 0.34, 0.01, mat('#1b1e23', { roughness: 0.05, clearcoat: 1 }), 0, 0.36, 0.3, 0.004)); handle(g, 0, 0.58, 0.31, 0.44); g.add(box(0.58, 0.01, 0.58, mat('#1b1e23', { roughness: 0.08, clearcoat: 1 }), 0, 0.885, 0, 0.003)); for (const x of [-0.14, 0.14]) for (const z of [-0.14, 0.14]) g.add(part(new THREE.TorusGeometry(0.075, 0.005, 6, 32).rotateX(Math.PI / 2), '#44484f', x, 0.892, z)); for (let i = 0; i < 4; i++) g.add(cyl(0.02, 0.02, 0.03, M.chrome(), -0.18 + i * 0.12, 0.8, 0.31, 16).rotateX(Math.PI / 2)); } },
  { id: 'fridge', cat: 'kitchen', name: 'Fridge', kind: 'floor', size: [0.7, 0.7, 1.8], finish: F('metal', '#d8dbe0'),
    build(g, P) { g.add(rbox(0.7, 1.78, 0.66, P, 0, 0.9, -0.02, 0.02)); g.add(rbox(0.68, 0.006, 0.02, '#3d4148', 0, 1.2, 0.31, 0.002)); handle(g, 0.26, 1.48, 0.31, 0.42, true); handle(g, 0.26, 0.75, 0.31, 0.5, true); } },
  { id: 'island', cat: 'kitchen', name: 'Island', kind: 'floor', size: [1.8, 0.9, 0.9], finish: F('wood', '#8a6a4b'),
    build(g, P) { g.add(rbox(1.8, 0.82, 0.86, P, 0, 0.44, 0, 0.012)); plinth(g, 1.74, 0.8, 0.05, '#3d4148'); g.add(rbox(1.9, 0.05, 1.0, M.marble(), 0, 0.885, 0, 0.008)); for (let i = -1; i <= 1; i++) { g.add(rbox(0.56, 0.74, 0.01, P, i * 0.58, 0.45, 0.43, 0.004)); handle(g, i * 0.58, 0.75, 0.435, 0.2); } g.add(lathe([[0, 0], [0.12, 0], [0.14, 0.06], [0.12, 0.08], [0, 0.08]], M.ceramic('#efe9e0'), 0.5, 0.91, 0, 40)); for (let k = 0; k < 3; k++) g.add(ball(0.035, ['#d9534f', '#e8b931', '#8fbf5a'][k], 0.47 + k * 0.035, 0.96, (k - 1) * 0.04)); } },
  // ---- office ------------------------------------------------------------------------------
  { id: 'desk', cat: 'tables', name: 'Desk', kind: 'floor', size: [1.4, 0.7, 0.75], finish: F('wood', '#d9c7a7'),
    lights: [{ pos: [-0.5, 1.06, -0.15], color: '#ffd7a8', strength: 5, reach: 2.5, focus: 0.85 }],
    preload: () => Promise.all(['stationery_supplies', 'office_notepads'].map(loadModel)),
    build(g, P) {
      put(g, 'stationery_supplies', -0.33, 0.75, 0.12, 0, 0.8); put(g, 'office_notepads', 0.52, 0.75, 0.18, 0, 0.32);
      g.add(rbox(1.4, 0.035, 0.7, P, 0, 0.73, 0, 0.01)); for (const s of [-1, 1]) for (const sz of [-0.3, 0.3]) taperedLeg(g, s * 0.64, sz, 0.71, M.metal(), { top: 0.016, bottom: 0.016, cap: false });
      g.add(rbox(0.4, 0.14, 0.5, P, 0.45, 0.64, 0, 0.008)); handle(g, 0.45, 0.64, 0.25, 0.1);
      g.add(rbox(0.56, 0.33, 0.02, '#1d2026', 0.15, 0.97, -0.22, 0.008)); g.add(box(0.53, 0.3, 0.002, mat('#12161c', { roughness: 0.08, clearcoat: 1 }), 0.15, 0.97, -0.208, 0.0005)); g.add(cyl(0.012, 0.012, 0.14, M.metal(), 0.15, 0.8, -0.24, 12)); g.add(rbox(0.18, 0.012, 0.14, M.metal(), 0.15, 0.755, -0.22, 0.004));
      g.add(rbox(0.42, 0.012, 0.14, '#e9e6e0', 0.15, 0.755, 0.06, 0.004)); g.add(lathe([[0, 0], [0.05, 0], [0.04, 0.03], [0.012, 0.32], [0, 0.32]], M.metal(), -0.5, 0.75, -0.2, 24)); shade(g, new THREE.ConeGeometry(0.08, 0.1, 32, 1, true), -0.5, 1.09, -0.17);
    } },
  { id: 'taskChair', cat: 'seating', name: 'Office chair', kind: 'floor', size: [0.6, 0.6, 1.0], finish: F('leather', '#2b2f36'),
    build(g, P) { cushion(g, 0.48, 0.08, 0.48, P, 0, 0.5, 0, { puff: 0.3 }); cushion(g, 0.44, 0.5, 0.07, P, 0, 0.8, -0.22, { puff: 0.25, rx: -0.08 }); g.add(cyl(0.025, 0.025, 0.42, M.chrome(), 0, 0.25, 0, 16)); g.add(cyl(0.035, 0.035, 0.1, '#222', 0, 0.42, 0, 16)); for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, arm = rbox(0.3, 0.025, 0.04, '#25282d', Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15, 0.01); arm.rotation.y = -a; g.add(arm); g.add(ball(0.025, '#15171a', Math.cos(a) * 0.28, 0.025, Math.sin(a) * 0.28)); } for (const s of [-1, 1]) g.add(rbox(0.04, 0.03, 0.26, '#25282d', s * 0.25, 0.66, 0, 0.01)); } },
  { id: 'filing', cat: 'storage', name: 'Filing cabinet', kind: 'floor', size: [0.5, 0.6, 1.1], finish: F('metal', '#9fb2c2'),
    build(g, P) { g.add(rbox(0.5, 1.08, 0.6, P, 0, 0.55, 0, 0.01)); for (let i = 0; i < 3; i++) { g.add(rbox(0.46, 0.32, 0.01, P, 0, 0.21 + i * 0.34, 0.3, 0.004)); handle(g, 0, 0.3 + i * 0.34, 0.3, 0.14); g.add(rbox(0.08, 0.04, 0.005, '#f4f1ea', 0, 0.25 + i * 0.34, 0.307, 0.002)); } } },
  // ---- balcony and outdoor -------------------------------------------------------------------
  { id: 'loungeChair', cat: 'balcony', name: 'Lounge chair', kind: 'floor', size: [0.78, 0.9, 0.8], finish: F('fabric', '#efe9df'),
    build(g, P) {
      const frame = M.metal('#2f3338');
      cushion(g, 0.7, 0.13, 0.7, P, 0, 0.37, 0.06, { puff: 0.3 }); const back = cushion(g, 0.7, 0.58, 0.15, P, 0, 0.64, -0.3, { puff: 0.2, rx: -0.25 });
      for (const sx of [-0.37, 0.37]) { taperedLeg(g, sx, 0.38, 0.3, frame, { cap: false, top: 0.016, bottom: 0.014 }); taperedLeg(g, sx, -0.36, 0.3, frame, { cap: false, top: 0.016, bottom: 0.014 }); g.add(rbox(0.035, 0.035, 0.84, frame, sx, 0.3, 0.01, 0.012)); g.add(rbox(0.05, 0.03, 0.7, M.wood(PALETTE.oak), sx, 0.52, 0, 0.012)); g.add(rbox(0.03, 0.22, 0.03, frame, sx, 0.41, 0.3, 0.01)); }
    } },
  { id: 'bistroChair', cat: 'balcony', name: 'Bistro chair', kind: 'floor', size: [0.5, 0.5, 0.88], finish: F('metal', '#33373d'),
    build(g, P) {
      const seatY = 0.46;
      g.add(lathe([[0, 0], [0.205, 0], [0.215, 0.012], [0.215, 0.03], [0, 0.03]], P, 0, seatY - 0.03, 0, 40));
      cushion(g, 0.38, 0.04, 0.38, '#e9e1d4', 0, seatY + 0.02, 0, { puff: 0.3 });
      for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; const leg = cyl(0.011, 0.011, seatY, P, Math.cos(a) * 0.17, seatY / 2, Math.sin(a) * 0.17, 12); leg.rotation.set(-Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08); g.add(leg); g.add(ball(0.014, P, Math.cos(a) * 0.19, 0.01, Math.sin(a) * 0.19)); }
      g.add(part(new THREE.TorusGeometry(0.17, 0.008, 8, 48).rotateX(Math.PI / 2), P, 0, 0.17, 0));
      const curve = (rad, y) => new THREE.CatmullRomCurve3(Array.from({ length: 17 }, (_, i) => { const t = -0.75 + 1.5 * i / 16; return new THREE.Vector3(Math.sin(t) * rad, y, 0.02 - Math.cos(t) * rad); }));
      g.add(part(new THREE.TubeGeometry(curve(0.26, 0.86), 32, 0.013, 8), P)); g.add(part(new THREE.TubeGeometry(curve(0.25, 0.68), 32, 0.009, 8), P));
      for (let i = -2; i <= 2; i++) { const t = i * 0.26, a = new THREE.Vector3(Math.sin(t) * 0.2, seatY + 0.01, 0.02 - Math.cos(t) * 0.2), b = new THREE.Vector3(Math.sin(t) * 0.26, 0.86, 0.02 - Math.cos(t) * 0.26), d = b.clone().sub(a); const sp = cyl(0.006, 0.006, d.length(), P, 0, 0, 0, 8); sp.position.copy(a).addScaledVector(d, 0.5); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(sp); }
    } },
  { id: 'bistroTable', cat: 'balcony', name: 'Bistro table', kind: 'floor', size: [0.7, 0.7, 0.75], finish: F('metal', '#33373d'),
    build(g, P) {
      g.add(lathe([[0, 0], [0.33, 0], [0.345, 0.01], [0.345, 0.026], [0.33, 0.034], [0, 0.034]], M.marble(), 0, 0.706, 0, 64));
      g.add(part(new THREE.TorusGeometry(0.27, 0.01, 8, 48).rotateX(Math.PI / 2), P, 0, 0.69, 0));
      g.add(lathe([[0.05, 0], [0.028, 0.06], [0.022, 0.2], [0.03, 0.34], [0.022, 0.5], [0.026, 0.62], [0.06, 0.71]], P, 0, 0, 0, 24));
      for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3, c = Math.cos(a), sn = Math.sin(a); g.add(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0.03 * c, 0.1, 0.03 * sn], [0.12 * c, 0.06, 0.12 * sn], [0.24 * c, 0.03, 0.24 * sn], [0.28 * c, 0.012, 0.28 * sn]].map((p) => new THREE.Vector3(...p))), 16, 0.014, 8), P)); g.add(ball(0.02, P, 0.285 * c, 0.014, 0.285 * sn)); }
      g.add(lathe([[0, 0], [0.03, 0], [0.035, 0.05], [0.015, 0.12], [0.02, 0.14], [0, 0.14]], M.glass(), 0.1, 0.74, 0.05, 24));
    } },
  { id: 'planterBox', cat: 'balcony', name: 'Planter', kind: 'floor', size: [0.9, 0.42, 0.85], finish: F('concrete', '#b9b2a7'),
    build(g, P) { g.add(rbox(0.9, 0.45, 0.42, P, 0, 0.225, 0, 0.02)); g.add(box(0.84, 0.02, 0.36, M.soil(), 0, 0.44, 0, 0.004)); foliage(g, -0.2, 0.58, 0, 0.32, ['#5f8a4c', '#6f9a58'], 31, 6); foliage(g, 0.22, 0.56, 0.02, 0.28, ['#577f45', '#7da35d'], 33, 6); for (let i = 0; i < 9; i++) g.add(ball(0.025, ['#e7a1c4', '#f4efe6', '#c9a2e2'][i % 3], -0.35 + i * 0.085, 0.62 + (i % 3) * 0.04, (i % 2 ? 0.1 : -0.08))); } },
  { id: 'potTree', cat: 'balcony', name: 'Potted olive', kind: 'floor', size: [0.5, 0.5, 1.7], finish: F('ceramic', '#d6cbbd'),
    build(g, P) { g.add(lathe([[0, 0], [0.17, 0], [0.22, 0.48], [0.23, 0.5], [0, 0.48]], P, 0, 0, 0, 40)); g.add(cyl(0.2, 0.2, 0.01, M.soil(), 0, 0.48, 0, 32)); g.add(cyl(0.02, 0.03, 0.7, '#6b5844', 0, 0.83, 0, 10)); foliage(g, 0, 1.32, 0, 0.44, ['#8aa275', '#9db58a', '#73905f'], 5, 16, 1.0, { leaf: 0.07, droop: 0.1 }); } },
  { id: 'lantern', cat: 'balcony', name: 'Outdoor lantern', kind: 'floor', size: [0.3, 0.3, 0.75], finish: F('metal', '#2f3338'),
    lights: [{ pos: [0, 0.32, 0], color: '#ffbf7a', strength: 4.5, reach: 3, focus: 0.15 }],
    build(g, P) { g.add(rbox(0.28, 0.04, 0.28, P, 0, 0.02, 0, 0.008)); g.add(rbox(0.3, 0.05, 0.3, P, 0, 0.64, 0, 0.01)); for (const sx of [-0.13, 0.13]) for (const sz of [-0.13, 0.13]) g.add(rbox(0.02, 0.6, 0.02, P, sx, 0.34, sz, 0.004)); g.add(box(0.24, 0.58, 0.24, M.glass(), 0, 0.34, 0, 0.004)); shade(g, new THREE.CylinderGeometry(0.04, 0.04, 0.18, 24, 1, false), 0, 0.3, 0, '#fff4e2'); g.add(part(new THREE.TorusGeometry(0.06, 0.008, 6, 20), P, 0, 0.72, 0)); } },
  // ---- CC0 models (Poly Haven), some styled with decor -------------------------------------
  ...modelDefs(),
  // ---- wall-mounted: size = [width, height, depth] ------------------------------------------
  { id: 'art', cat: 'decor', name: 'Wall art', kind: 'wall', size: [0.8, 0.6, 0.04], finish: F('paint', '#3b4a6b'),
    build(g, P) { g.add(rbox(0.8, 0.6, 0.035, M.wood(PALETTE.oak), 0, 0, 0.018, 0.006)); g.add(box(0.7, 0.5, 0.01, '#f4f1ea', 0, 0, 0.032, 0.002)); g.add(box(0.56, 0.38, 0.004, P, 0, 0, 0.038, 0.001)); g.add(cyl(0.11, 0.11, 0.004, '#e9c46a', 0.1, 0.05, 0.041, 48).rotateX(Math.PI / 2)); g.add(box(0.56, 0.1, 0.004, '#2d3a55', 0, -0.14, 0.04, 0.001)); } },
  { id: 'shelf', cat: 'storage', name: 'Shelf', kind: 'wall', size: [0.9, 0.25, 0.25], finish: F('wood', '#b89468'),
    build(g, P) { g.add(rbox(0.9, 0.03, 0.25, P, 0, -0.1, 0.125, 0.006)); for (const s of [-1, 1]) g.add(rbox(0.025, 0.12, 0.2, M.metal(), s * 0.38, -0.04, 0.1, 0.004)); books(g, -0.4, -0.05, -0.085, 0.13, 0.17, 41); g.add(lathe([[0, 0], [0.05, 0], [0.06, 0.06], [0.03, 0.15], [0, 0.15]], M.ceramic('#9fb49b'), 0.22, -0.085, 0.12, 32)); foliage(g, 0.22, 0.1, 0.12, 0.09, ['#6b9150', '#7da35d'], 9, 4); } },
  { id: 'mirror', cat: 'decor', name: 'Mirror', kind: 'wall', size: [0.5, 0.9, 0.03], finish: F('metal', '#3d4148'),
    build(g, P) { const geo = new THREE.CapsuleGeometry(0.25, 0.4, 8, 32).scale(1, 1, 0.06); g.add(part(geo, P, 0, 0, 0.015)); g.add(part(new THREE.CapsuleGeometry(0.225, 0.4, 8, 32).scale(1, 1, 0.04), mat('#c7d6dd', { roughness: 0.02, metalness: 1 }), 0, 0, 0.025)); } },
  { id: 'cabinet', cat: 'storage', name: 'Wall cabinet', kind: 'wall', size: [1.2, 0.7, 0.35], finish: F('paint', '#f2ede3'),
    build(g, P) { g.add(rbox(1.2, 0.7, 0.35, P, 0, 0, 0.175, 0.01)); for (const sx of [-0.3, 0.3]) { g.add(rbox(0.58, 0.66, 0.012, P, sx, 0, 0.355, 0.004)); handle(g, sx - Math.sign(sx) * 0.22, -0.22, 0.36, 0.14, true); } } },
  { id: 'sconce', cat: 'lights', name: 'Wall light', kind: 'wall', size: [0.22, 0.3, 0.24], finish: F('metal', '#c9a45c'),
    lights: [{ pos: [0, 0.06, 0.17], color: '#ffd09c', strength: 6, reach: 3.2, focus: 0.35, size: 0.07 }],
    build(g, P) {
      // a round back plate, a curved arm and a small pleated shade
      g.add(lathe([[0, 0], [0.045, 0], [0.05, 0.006], [0.048, 0.016], [0, 0.018]], P, 0, 0, 0, 40).rotateX(Math.PI / 2));
      g.add(part(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0, 0, 0.016], [0, 0, 0.09], [0, 0.02, 0.15], [0, 0.03, 0.17]].map((p) => new THREE.Vector3(...p))), 24, 0.006, 8), P));
      lampFittings(g, 0, 0.12, 0.17, 0.06, P);
      pleatedShade(g, 0, 0.06, 0.17, { top: 0.065, bottom: 0.095, height: 0.12, pleats: 36, depth: 0.0035, color: '#f4ecdf', haloSize: 0.45 });
    } },
];

export const DEFS = Object.fromEntries(CATALOG.map((d) => [d.id, d]));

// an item's finish: its own material and colour (or the piece's default), plus a frame colour for pieces that have one
export function itemFinish(item, def) {
  const f = item.finish ? { mat: item.finish.mat, color: item.finish.color } : { mat: def.finish.mat, color: def.finish.color };
  const frame = item.frame || def.finish.frame;
  return frame ? { ...f, frame } : f;
}

// Bake an item's many small parts into one mesh per material: a sofa or a full
// bookcase then costs a handful of draw calls instead of a hundred.
function mergeStatic(g) {
  const groups = new Map(), drop = [];
  g.updateMatrixWorld(true);
  for (const m of g.children) {
    if (!m.isMesh || Array.isArray(m.material) || m.children.length || Object.keys(m.userData).length) continue;
    const geo = m.geometry, attrs = Object.keys(geo.attributes).sort().join(',');
    const key = m.material.uuid + '|' + attrs + '|' + m.castShadow;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((m) => (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix));
    const merged = mergeGeometries(geos); if (!merged) continue;
    const mesh = new THREE.Mesh(merged, list[0].material); mesh.castShadow = list[0].castShadow; mesh.receiveShadow = true;
    g.add(mesh); drop.push(...list);
  }
  for (const m of drop) { g.remove(m); m.geometry.dispose(); }
}

export function buildItemMesh(def, finish = def.finish) {
  const g = new THREE.Group();
  def.build(g, makeMaterial({ mat: finish.mat, color: finish.color }), finish);
  if (!def.custom) mergeStatic(g);
  // lamps register soft light sources (see lamps.js) instead of three.js lights
  if (def.lights?.length) g.userData.lampSources = def.lights.map(makeLampSource);
  return g;
}
