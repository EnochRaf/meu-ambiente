// CC0 furniture and decor models (Poly Haven, see ASSETS.md), prepared by
// tools/assets.mjs into compact .glb files. A model loads once on first use;
// each placed piece is a light clone. Until it arrives, an invisible box keeps
// the piece pickable. Model materials get our lamp field and keep their own
// baked ambient occlusion maps, so each piece shades itself correctly wherever
// it is moved.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { patchLamps } from './lamps.js';
import manifest from '../assets/manifest.json' with { type: 'json' };

export const MODEL_INFO = manifest.models;
const BASE = new URL('../assets/models/', import.meta.url).href;
let loader = null;
const templates = new Map(); // id -> Promise<Object3D>
const ready = new Map();     // id -> Object3D once loaded
let pending = 0;
export const pendingModels = () => pending;
// per-model handling: parts that glow at night (and so cast no lamp shadow),
// and models whose 'glass' material also covers metal parts
const GLOW = { modern_ceiling_lamp_01: /globe/i };
const KEEP_GLASS = new Set(['modern_ceiling_lamp_01']);
// opal shades that share a material with metal parts: the triangles of the
// sphere (centre, radius range, top cut-off, in model metres) become their own glowing part
const OPAL = { modern_ceiling_lamp_01: { c: [0, 0.436, 0], r: [0.15, 0.26], top: 0.6 } };
// Models whose frame (legs, shell, base) can take its own colour, apart from the
// upholstery: either a material of its own, or the connected pieces of geometry
// that a rule picks out (c = { min, max, size, tris } in model metres).
const PARTS = {
  dining_chair_02: { frame: (c) => c.max[1] < 0.33 },                                   // the four legs
  Ottoman_01: { frame: (c) => c.max[1] < 0.1 },                                          // its feet
  mid_century_lounge_chair: { frame: (c) => c.max[1] < 0.3 || c.size[0] > 0.9 || c.tris < 1000 }, // base, seat shell with arms, back shell
  modern_arm_chair_01: { material: /legs/i },                                            // a wooden frame of its own
};
export const hasParts = (id) => !!PARTS[id];
// split a mesh into upholstery and frame by its connected pieces
function splitParts(mesh, rule) {
  const g = mesh.geometry, p = g.attributes.position, n = p.count, m4 = mesh.matrixWorld, v = new THREE.Vector3();
  const idx = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i);
  const P = new Float32Array(n * 3), canon = new Map(), weld = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m4); P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
    const k = `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;
    if (!canon.has(k)) canon.set(k, i); weld[i] = canon.get(k);
  }
  const par = Int32Array.from({ length: n }, (_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) { const a = find(weld[idx[t]]); par[find(weld[idx[t + 1]])] = a; par[find(weld[idx[t + 2]])] = a; }
  const comps = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(weld[idx[t]]);
    if (!comps.has(r)) comps.set(r, { tris: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] });
    const c = comps.get(r); c.tris++;
    for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) { const x = P[idx[t + k] * 3 + j]; c.min[j] = Math.min(c.min[j], x); c.max[j] = Math.max(c.max[j], x); }
  }
  for (const c of comps.values()) { c.size = c.max.map((x, j) => x - c.min[j]); c.frame = rule(c); }
  const main = [], frame = [];
  for (let t = 0; t < idx.length; t += 3) (comps.get(find(weld[idx[t]])).frame ? frame : main).push(idx[t], idx[t + 1], idx[t + 2]);
  if (!main.length || !frame.length) return null;
  const a = g.clone(); a.setIndex(main); mesh.geometry = a; mesh.userData.part = 'main';
  const b = g.clone(); b.setIndex(frame);
  const fm = mesh.material.clone(); fm.name = mesh.material.name + '-frame';
  const o = new THREE.Mesh(b, fm);
  o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
  o.userData.part = 'frame';
  return o;
}
function splitOpal(mesh, { c, r, top }) {
  const g = mesh.geometry, p = g.attributes.position, idx = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i);
  const keep = [], opal = [], v = new THREE.Vector3(), m4 = mesh.matrixWorld; // quantised meshes: positions are scaled by the node
  for (let t = 0; t < idx.length; t += 3) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(p, idx[t + k]).applyMatrix4(m4); x += v.x / 3; y += v.y / 3; z += v.z / 3; }
    const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
    (d > r[0] && d < r[1] && y < top ? opal : keep).push(idx[t], idx[t + 1], idx[t + 2]);
  }
  if (!opal.length) return null;
  const a = g.clone(); a.setIndex(keep); mesh.geometry = a;
  const b = g.clone(); b.setIndex(opal);
  const m = new THREE.MeshStandardMaterial({ color: '#f6f2ec', roughness: 0.3, metalness: 0, emissive: '#000000', name: 'opal' });
  const o = new THREE.Mesh(b, patchLamps(m, null, '-model'));
  o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
  o.userData.glow = true; o.userData.glowK = 0.3; o.userData.noLampShadow = true; o.castShadow = false; o.receiveShadow = true;
  return o;
}

// Footprint after a quarter-turn rotation: [width (x), depth (z), height (y)].
export function modelSize(id, quarter = 0, scale = 1) {
  const b = MODEL_INFO[id]?.bounds; if (!b) return [0.5, 0.5, 0.5];
  const sx = (b.max[0] - b.min[0]) * scale, sy = (b.max[1] - b.min[1]) * scale, sz = (b.max[2] - b.min[2]) * scale;
  return quarter % 2 ? [sz, sx, sy] : [sx, sz, sy];
}

export function loadModel(id) {
  if (templates.has(id)) return templates.get(id);
  if (typeof window === 'undefined') return new Promise(() => {}); // node tests: footprints only
  loader ??= new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  pending++;
  const p = new Promise((resolve, reject) => loader.load(BASE + id + '.glb', (gltf) => {
    pending--;
    const root = gltf.scene;
    if (OPAL[id]) { root.updateMatrixWorld(true); const adds = []; root.traverse((o) => { if (o.isMesh && /glass/i.test(o.material.name)) { const op = splitOpal(o, OPAL[id]); if (op) adds.push([o.parent, op]); } }); for (const [parent, op] of adds) parent.add(op); }
    const parts = PARTS[id];
    if (parts?.frame) { root.updateMatrixWorld(true); const adds = []; root.traverse((o) => { if (o.isMesh && !Array.isArray(o.material)) { const f = splitParts(o, parts.frame); if (f) adds.push([o.parent, f]); } }); for (const [parent, f] of adds) parent.add(f); }
    if (parts?.material) root.traverse((o) => { if (o.isMesh) o.userData.part = parts.material.test(o.material.name) ? 'frame' : 'main'; });
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (o.userData.glow) return; // an opal part made above
      if (GLOW[id]) { o.userData.noLampShadow = true; if (mats.some((m) => GLOW[id].test(m.name))) { o.userData.glow = true; o.castShadow = false; } }
      for (const m of mats) {
        if (m.map) m.map.anisotropy = 8;
        m.envMapIntensity = 1;
        if (o.userData.glow) { m.emissive?.set('#000000'); m.emissiveIntensity = 0; m.roughness = 0.35; }
        if (/glass/i.test(m.name) && !KEEP_GLASS.has(id)) { m.transparent = true; m.opacity = 0.14; m.depthWrite = false; m.roughness = 0.04; m.map = null; m.color.set('#ffffff'); }
        else if (m.transparent && m.opacity > 0.95) { m.transparent = false; m.alphaTest = 0.5; } // foliage cut-outs, not blended
        patchLamps(m, null, '-model');
      }
    });
    ready.set(id, root);
    resolve(root);
    // after the waiting pieces have attached their copies (they do so as the promise resolves)
    setTimeout(() => window.dispatchEvent?.(new CustomEvent('roomsmith:model-loaded', { detail: id })), 0);
  }, undefined, (e) => { pending--; reject(e); }));
  templates.set(id, p);
  return p;
}
export const modelReady = (id) => ready.has(id);

// Average (linear) brightness of a material's base texture where a mesh uses it
// (its uv coordinates), for tinting with a chosen colour.
const small = new WeakMap(), lumCache = new WeakMap();
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
function meanLuminance(tex, geo) {
  if (geo && lumCache.has(geo)) return lumCache.get(geo);
  let out = 0.5;
  try {
    const S = 64;
    if (!small.has(tex)) { const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d'); g.drawImage(tex.image, 0, 0, S, S); small.set(tex, g.getImageData(0, 0, S, S).data); }
    const d = small.get(tex), uv = geo?.attributes.uv, used = geo?.index ? geo.index.array : null;
    let s = 0, n = 0;
    const at = (u, v) => { const x = Math.min(S - 1, Math.floor((u - Math.floor(u)) * S)), y = Math.min(S - 1, Math.floor((v - Math.floor(v)) * S)), i = (y * S + x) * 4; s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); n++; };
    if (uv && used) { const step = Math.max(1, Math.floor(used.length / 3000)); for (let k = 0; k < used.length; k += step) at(uv.getX(used[k]), uv.getY(used[k])); }
    else for (let i = 0; i < S * S; i++) at((i % S + 0.5) / S, (Math.floor(i / S) + 0.5) / S);
    out = Math.max(0.02, s / Math.max(1, n));
  } catch {}
  if (geo) lumCache.set(geo, out);
  return out;
}
// a copy of a model material recoloured with `color`, keeping `detail` of the texture's variation
function tinted(material, color, detail, geo) {
  const m = material.clone(); patchLamps(m, null, '-model');
  const lum = m.map ? meanLuminance(m.map, geo) : 0.6;
  const tc = new THREE.Color(color), prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => { prev(sh, r); sh.uniforms.uTint = { value: tc }; sh.uniforms.uTintK = { value: 1 / lum }; sh.uniforms.uTintD = { value: detail };
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uTintK; uniform float uTintD;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n{ float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = uTint * mix(1.0, l * uTintK, uTintD); }'); };
  m.customProgramCacheKey = () => 'lamps-model-tint';
  m.userData.disposable = true;
  return m;
}

// Place a model inside `group`: rotated by `quarter` quarter-turns, centred on
// its footprint, standing on y = 0 (or hung on the wall for wall pieces).
// `tint` (a colour) recolours the model's upholstery (or its largest material),
// keeping its texture; `frameTint` recolours its frame where it has one.
// `tintDetail` (0..1) keeps that much of the texture's light and dark variation.
export function addModel(group, id, { quarter = 0, scale = 1, tint = null, frameTint = null, tintDetail = 1, wall = false, offset = [0, 0, 0] } = {}) {
  const [w, d, h] = modelSize(id, quarter, scale);
  const b = MODEL_INFO[id]?.bounds;
  const holder = new THREE.Group(); holder.rotation.y = (quarter * Math.PI) / 2; holder.scale.setScalar(scale);
  const cx = b ? (b.min[0] + b.max[0]) / 2 : 0, cz = b ? (b.min[2] + b.max[2]) / 2 : 0, y0 = b ? b.min[1] : 0;
  holder.position.set(offset[0], offset[1] + (wall ? -((b ? (b.min[1] + b.max[1]) / 2 : 0)) * scale : -y0 * scale), offset[2]);
  const inner = new THREE.Group(); inner.position.set(-cx, 0, wall ? -(b ? b.min[2] : 0) : -cz); holder.add(inner);
  group.add(holder);
  // invisible pick box until (and while) the model is in place
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  proxy.position.set(offset[0], offset[1] + (wall ? 0 : h / 2), offset[2] + (wall ? d / 2 : 0)); proxy.userData.noAO = true; proxy.userData.proxy = true;
  group.add(proxy);
  const attach = (tpl) => {
    const inst = tpl.clone(true);
    const parts = []; inst.traverse((o) => { if (o.isMesh && o.userData.part && !Array.isArray(o.material)) parts.push(o); });
    if (parts.length) {
      for (const o of parts) {
        const frame = o.userData.part === 'frame', c = frame ? frameTint : tint;
        if (c) o.material = tinted(o.material, c, frame ? 0.85 : tintDetail, o.geometry);
      }
    } else if (tint) {
      let best = null, area = -1;
      inst.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new THREE.Vector3()); const a = s.x * s.y + s.y * s.z + s.x * s.z; if (a > area) { area = a; best = o; } } });
      if (best && !Array.isArray(best.material)) best.material = tinted(best.material, tint, tintDetail, null);
    }
    inner.add(inst);
  };
  if (ready.has(id)) attach(ready.get(id)); else loadModel(id).then(attach).catch((e) => console.warn('model', id, e));
  return { size: [w, d, h] };
}
