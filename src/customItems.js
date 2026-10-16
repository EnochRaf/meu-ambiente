// Photo items: turn an uploaded picture into a cutout, keep it in IndexedDB and
// expose catalog definitions. Two flavours: an extruded photo cutout, or a
// catalog piece recoloured from the photo ("matched 3D").
import * as THREE from 'three';
import { backgroundMask, cropBounds, bleedEdges, extrudeMask, erodeMask, featherMaskRadius, defringe, sharpness, tiltHint, dominantColors, rgbToHex, silhouette } from './cutout.js';
import { MATERIAL_BY_ID } from './materials.js';

const DB = 'roomsmith', STORE = 'customItems', MAX_SIDE = 1024, GRID = 96, OUTLINE_GRID = 160;
export const CUSTOM_PREFIX = 'c_';

// ---- IndexedDB -------------------------------------------------------------------
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const customStore = {
  all: () => tx('readonly', (s) => s.getAll()).then((r) => r || []),
  put: (rec) => tx('readwrite', (s) => s.put(rec)),
  remove: (id) => tx('readwrite', (s) => s.delete(id)),
};

// ---- photo in ------------------------------------------------------------------------
export async function loadPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
  const original = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  return { canvas: c, original };
}

// Friendly warnings about the photo itself.
export function analyzePhoto(canvas, original) {
  const w = canvas.width, h = canvas.height;
  const data = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const warnings = [];
  if (Math.max(original.width, original.height) < 500) warnings.push({ id: 'small', text: 'This photo is quite small, so the piece may look soft up close. A larger photo helps.' });
  const sharp = sharpness(data, w, h);
  if (sharp < 60) warnings.push({ id: 'blurry', text: 'The photo looks a little blurry. If you can, shoot again with steadier hands or more light.' });
  return { sharp, warnings };
}

export const quickMask = (canvas, tolerance) => {
  const { width: w, height: h } = canvas;
  return backgroundMask(canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data, w, h, tolerance);
};
export const alphaToMask = (alpha, threshold = 128) => { const m = new Uint8Array(alpha.length); for (let i = 0; i < alpha.length; i++) m[i] = alpha[i] >= threshold ? 1 : 0; return m; };

// Rotate a canvas (degrees) around its centre onto a new canvas big enough to hold it.
export function rotateCanvas(src, deg) {
  if (!deg) return src;
  const rad = (deg * Math.PI) / 180, c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
  const w = Math.ceil(src.width * c + src.height * s), h = Math.ceil(src.width * s + src.height * c);
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.translate(w / 2, h / 2); ctx.rotate(rad); ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

// Build the final cutout: mask -> erode -> feather -> defringe -> crop.
// `mask` is 0/1 at the canvas size. `crop` is optional {x0,y0,x1,y1} in canvas pixels.
export function finishCutout(canvas, mask, { erode = 1, feather = 2, crop = null, keepBackground = false, legacy = false } = {}) {
  if (legacy) { erode = 0; feather = 1; }
  const w = canvas.width, h = canvas.height;
  const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  let m = keepBackground ? new Uint8Array(w * h).fill(1) : mask;
  if (crop) {
    m = new Uint8Array(m);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < crop.x0 || x > crop.x1 || y < crop.y0 || y > crop.y1) m[y * w + x] = 0;
  }
  if (!keepBackground && erode) m = erodeMask(m, w, h, erode);
  const alpha = keepBackground ? new Uint8ClampedArray(w * h).fill(255) : featherMaskRadius(m, w, h, feather);
  const b = cropBounds(alpha, w, h, 2);
  if (!b) return null;
  const tilt = tiltHint(alpha, w, h);
  let data = keepBackground || legacy ? img.data : defringe(img.data, alpha, w, h, 3);
  bleedEdges(data, alpha, w, h);
  for (let i = 0; i < w * h; i++) data[i * 4 + 3] = alpha[i];
  const colors = dominantColors(data, alpha, w, h, 4).map((c) => ({ ...c, hex: rgbToHex(c.rgb) }));
  const full = document.createElement('canvas'); full.width = w; full.height = h;
  full.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  const out = document.createElement('canvas');
  out.width = b.x1 - b.x0 + 1; out.height = b.y1 - b.y0 + 1;
  out.getContext('2d').drawImage(full, b.x0, b.y0, out.width, out.height, 0, 0, out.width, out.height);
  return { canvas: out, tilt, colors, bounds: b };
}

export const canvasToBlob = (c) => new Promise((resolve) => c.toBlob(resolve, 'image/png'));

// ---- catalog definitions -------------------------------------------------------------
// rec: { id, name, kind, size (metres: floor [w,d,h], wall [w,h,d]), blob, category?,
//        match?: { base: 'sofa', finish: {mat,color} } }
let contactTex = null;
function contactShadow(w, d) {
  if (!contactTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    contactTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.25, d * 1.4), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.renderOrder = 1; m.userData.contact = true;
  return m;
}

function legacyGeometry(cells, gw, gh, dims) {
  const g = extrudeMask(cells, gw, gh, dims);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(g.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
  geo.addGroup(0, g.frontCount, 0);
  geo.addGroup(g.frontCount, g.indices.length - g.frontCount, 1);
  return geo;
}

// Smooth silhouette: trace the alpha outline on a fine grid, extrude it with a
// small bevel, map the front to the photo and let every other face sample the
// photo at the outline so sides and back carry the edge colours.
function outlineGeometry(bmp, { width, height, depth, kind }) {
  const gw = bmp.width >= bmp.height ? OUTLINE_GRID : Math.max(8, Math.round(OUTLINE_GRID * bmp.width / bmp.height));
  const gh = bmp.width >= bmp.height ? Math.max(8, Math.round(OUTLINE_GRID * bmp.height / bmp.width)) : OUTLINE_GRID;
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, gw, gh);
  const a = ctx.getImageData(0, 0, gw, gh).data;
  const cells = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) cells[i] = a[i * 4 + 3] > 110 ? 1 : 0;
  const sil = silhouette(cells, gw, gh, { epsilon: 0.9 });
  if (!sil) return new THREE.BoxGeometry(width, height, depth);
  const y0 = kind === 'wall' ? -height / 2 : 0;
  const toXY = ([cx, cy]) => new THREE.Vector2(-width / 2 + (cx / gw) * width, y0 + height - (cy / gh) * height);
  const shape = new THREE.Shape(sil.outer.map(toXY));
  for (const h of sil.holes) shape.holes.push(new THREE.Path(h.map(toXY)));
  // rounded front and back edges so the piece reads as a solid, not a box
  const bevel = Math.min(0.06, depth / 4, width / 16, height / 16);
  const uvOf = (x, y) => [(x + width / 2) / width, (y - y0) / height];
  // side walls sample the photo a little inside the outline, so they take the
  // object's body colour rather than the anti-aliased rim
  const inset = (u, v) => [u + (0.5 - u) * 0.14, v + (0.5 - v) * 0.14];
  const UV = {
    generateTopUV: (g, v, i0, i1, i2) => [i0, i1, i2].map((i) => new THREE.Vector2(...uvOf(v[i * 3], v[i * 3 + 1]))),
    generateSideWallUV: (g, v, i0, i1, i2, i3) => [i0, i1, i2, i3].map((i) => new THREE.Vector2(...inset(...uvOf(v[i * 3], v[i * 3 + 1])))),
  };
  let geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, depth - 2 * bevel), bevelEnabled: bevel > 0.004, bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 3, curveSegments: 4, UVGenerator: UV });
  // ExtrudeGeometry runs from z = 0 to z = depth; floor items are centred, wall items start at the wall
  geo.translate(0, 0, kind === 'wall' ? bevel : -depth / 2 + bevel);
  // regroup: front-facing cap triangles get material 0, everything else material 1
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, uv = geo.attributes.uv.array;
  const n = pos.length / 9, front = [], rest = [];
  for (let t = 0; t < n; t++) (nor[t * 9 + 2] > 0.9 && nor[t * 9 + 5] > 0.9 && nor[t * 9 + 8] > 0.9 ? front : rest).push(t);
  const order = front.concat(rest);
  const P = new Float32Array(pos.length), N = new Float32Array(nor.length), U = new Float32Array(uv.length);
  order.forEach((t, k) => { P.set(pos.subarray(t * 9, t * 9 + 9), k * 9); N.set(nor.subarray(t * 9, t * 9 + 9), k * 9); U.set(uv.subarray(t * 6, t * 6 + 6), k * 6); });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.addGroup(0, front.length * 3, 0);
  out.addGroup(front.length * 3, rest.length * 3, 1);
  return out;
}

export async function makeCustomDef(rec, defs = null, { legacy = false } = {}) {
  const base = rec.match && defs ? defs[rec.match.base] : null;
  if (base) {
    return {
      id: rec.id, name: rec.name, cat: base.cat, kind: base.kind, size: base.size, custom: true, matched: base.id,
      finish: { ...rec.match.finish }, lights: base.lights,
      build: base.build,
    };
  }
  const bmp = await createImageBitmap(rec.blob);
  const tex = new THREE.Texture(bmp);
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; tex.anisotropy = 4;
  const G = legacy ? 72 : GRID;
  const gw = bmp.width >= bmp.height ? G : Math.max(6, Math.round(G * bmp.width / bmp.height));
  const gh = bmp.width >= bmp.height ? Math.max(6, Math.round(G * bmp.height / bmp.width)) : G;
  const c = document.createElement('canvas'); c.width = gw; c.height = gh;
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0, gw, gh);
  const a = ctx.getImageData(0, 0, gw, gh).data;
  const cells = new Uint8Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) cells[i] = a[i * 4 + 3] > 110 ? 1 : 0;
  const wall = rec.kind === 'wall';
  const [width, height, depth] = wall ? [rec.size[0], rec.size[1], rec.size[2]] : [rec.size[0], rec.size[2], rec.size[1]];
  const geo = legacy ? legacyGeometry(cells, gw, gh, { width, height, depth, kind: rec.kind }) : outlineGeometry(bmp, { width, height, depth, kind: rec.kind });
  return {
    id: rec.id, name: rec.name, kind: rec.kind, size: rec.size, custom: true, category: rec.category,
    finish: { mat: rec.finishMat || 'fabric', color: '#ffffff' },
    build(group, P) {
      if (legacy) { const m = P.clone(); m.map = tex; m.needsUpdate = true; const mesh = new THREE.Mesh(geo, m); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh); return; }
      const front = P.clone(); front.map = tex; front.normalMap = null; front.roughnessMap = null; front.needsUpdate = true; // the photo carries its own detail
      // sides and back: the same picture, darkened, so the edges carry the photo's colours
      const side = P.clone(); side.map = tex; side.color.multiplyScalar(0.9); side.roughness = Math.min(1, P.roughness + 0.1); side.needsUpdate = true;
      const mesh = new THREE.Mesh(geo, [front, side]);
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      if (rec.kind === 'floor') group.add(contactShadow(width, depth));
    },
  };
}

export function newCustomId() { return CUSTOM_PREFIX + Math.random().toString(36).slice(2, 10); }
export const isCustomType = (type) => typeof type === 'string' && type.startsWith(CUSTOM_PREFIX);
export const finishIsValid = (f) => !!MATERIAL_BY_ID[f.mat];
