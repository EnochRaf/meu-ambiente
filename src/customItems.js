// Photo items: turn an uploaded picture into a cutout, keep it in IndexedDB and
// expose catalog definitions. Two flavours: the photo as a solid with real
// depth (a relief built from an on-device depth model, see relief.js and
// depth.js), or a catalog piece recoloured from the photo ("matched 3D").
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { backgroundMask, cropBounds, bleedEdges, erodeMask, featherMaskRadius, defringe, sharpness, tiltHint, dominantColors, rgbToHex } from './cutout.js';
import { sampleGrid, normalizeDepth, reliefMesh, pillowDepth } from './relief.js';
import { MATERIAL_BY_ID } from './materials.js';
import { patchLamps } from './lamps.js';

const DB = 'roomsmith', STORE = 'customItems', MAX_SIDE = 1024, RELIEF_GRID = 160;
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

// ---- depth --------------------------------------------------------------------------
// Relative depth from the model (bigger = nearer) for a region of the photo,
// made 0..1 over the object and packed into a PNG (16 bits: high byte in red,
// low byte in green) so it can be stored with the item without banding.
// `alpha` is the cutout's alpha at the same size.
export function depthToBlob(depth, alpha, w, h) {
  const d = normalizeDepth(depth, alpha, w, h, { blur: 2, passes: 1 });
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const img = c.getContext('2d').createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = Math.round(d[i] * 65535); img.data[i * 4] = v >> 8; img.data[i * 4 + 1] = v & 255; img.data[i * 4 + 2] = 0; img.data[i * 4 + 3] = 255; }
  c.getContext('2d').putImageData(img, 0, 0);
  return canvasToBlob(c);
}
// the stored depth back to 0..1 (also reads the older 8-bit grey form)
function decodeDepth(px, n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; out[i] = b === r && g === r ? r / 255 : (r * 256 + g) / 65535; }
  return out;
}

// ---- full 3D models ----------------------------------------------------------------------
// A GLB made from the photo (see make3d.js): parsed once per blob, stood on the
// floor and centred, with our lamp field on its materials. `proportions` is the
// model's own width : depth : height so the size step can keep them.
const parsed = new Map(); // key (item id, or the blob itself) -> Promise<{ scene, size }>
let gltfLoader = null;
export function loadModelBlob(blob, key = blob) {
  if (parsed.has(key)) return parsed.get(key);
  const pr = (async () => {
    gltfLoader ??= new GLTFLoader();
    const buf = await blob.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => gltfLoader.parse(buf, '', resolve, reject));
    const root = gltf.scene; root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    // some generators export z-up: a model much flatter than it is tall, lying on z = 0
    if (Math.abs(box.max.z) < 1e-3 && size.z > size.y * 1.6) { root.rotation.x = -Math.PI / 2; root.updateMatrixWorld(true); box.setFromObject(root); box.getSize(size); box.getCenter(c); }
    root.position.set(-c.x, -box.min.y, -c.z); // centred, standing on y = 0
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) { if (m.map) m.map.anisotropy = 8; m.envMapIntensity = 1; if (m.transparent && m.opacity > 0.95) { m.transparent = false; m.alphaTest = 0.5; } patchLamps(m, null, '-model'); }
    });
    const holder = new THREE.Group(); holder.add(root);
    return { scene: holder, size: [size.x, size.z, size.y] }; // width, depth, height in the model's units
  })();
  parsed.set(key, pr);
  return pr;
}
export const forgetModel = (key) => parsed.delete(key);
export const modelProportions = async (blob) => (await loadModelBlob(blob)).size;

// ---- catalog definitions -------------------------------------------------------------
// rec: { id, name, kind, size (metres: floor [w,d,h], wall [w,h,d]), blob, depth?, model?, category?,
//        match?: { base: 'sofa', finish: {mat,color} } }
// Grid-sampled alpha (and depth, when there is one) of a cutout bitmap: read at
// full size, averaged onto the grid, then the depth is smoothed a little so the
// model's fine ripples never show as ridges under a low sun.
function gridOf(bmp, depthBmp) {
  const w = bmp.width, h = bmp.height;
  const gw = w >= h ? RELIEF_GRID : Math.max(8, Math.round(RELIEF_GRID * w / h));
  const gh = w >= h ? Math.max(8, Math.round(RELIEF_GRID * h / w)) : RELIEF_GRID;
  const read = (image) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const a = read(bmp), alpha = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = a[i * 4 + 3];
  if (!depthBmp) { const g = sampleGrid(alpha, null, w, h, gw, gh); return { gw, gh, alpha: g.alpha, depth: normalizeDepth(pillowDepth(g.alpha, gw, gh), g.alpha, gw, gh) }; }
  const g = sampleGrid(alpha, decodeDepth(read(depthBmp), w * h), w, h, gw, gh);
  return { gw, gh, alpha: g.alpha, depth: normalizeDepth(g.depth, g.alpha, gw, gh, { blur: 2, passes: 3 }) };
}

// The piece as a solid: the photo on a sculpted front, sides and a flat back
// that carry the edge colours. Falls back to a box when nothing is left.
function reliefGeometry(bmp, depthBmp, { width, height, depth, kind }) {
  const g = gridOf(bmp, depthBmp);
  const m = reliefMesh(g.alpha, g.depth, g.gw, g.gh, { width, height, depth, kind });
  if (!m) return new THREE.BoxGeometry(width, height, depth);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  geo.addGroup(0, m.frontCount, 0);
  geo.addGroup(m.frontCount, m.indices.length - m.frontCount, 1);
  return geo;
}

// The photo as the surface itself: an sRGB colour map on a matt, lamp-lit
// material (the photo already carries its own highlights and texture). The
// finish chosen in the room tints it and sets how glossy it is; white keeps the
// photo's own colours.
function photoMaterials(tex, finish) {
  const def = MATERIAL_BY_ID[finish?.mat] || MATERIAL_BY_ID.fabric;
  const color = new THREE.Color(/^#[0-9a-f]{6}$/i.test(finish?.color || '') ? finish.color : '#ffffff');
  const rough = Math.max(0.45, def.roughness);
  const front = new THREE.MeshPhysicalMaterial({ map: tex, color, roughness: rough, metalness: 0, sheen: def.sheen ? 0.18 : 0, sheenRoughness: 0.8, sheenColor: new THREE.Color('#ffffff'), clearcoat: def.clearcoat ? 0.15 : 0, clearcoatRoughness: 0.4, envMapIntensity: 0.65 });
  const side = new THREE.MeshPhysicalMaterial({ map: tex, color: color.clone().multiplyScalar(0.82), roughness: Math.min(1, rough + 0.1), metalness: 0, envMapIntensity: 0.5 });
  for (const m of [front, side]) { m.userData.matId = 'photo'; m.userData.reflect = 0; patchLamps(m, null, '-photo'); }
  return [front, side];
}

export async function makeCustomDef(rec, defs = null) {
  const base = rec.match && defs ? defs[rec.match.base] : null;
  if (base) {
    return {
      id: rec.id, name: rec.name, cat: base.cat, kind: base.kind, size: base.size, custom: true, matched: base.id,
      finish: { ...rec.match.finish }, lights: base.lights,
      build: base.build,
    };
  }
  if (rec.model) {
    const { scene, size } = await loadModelBlob(rec.model, rec.id); // parsed once per item, however often it is rebuilt
    const wall = rec.kind === 'wall';
    const [W, D, H] = wall ? [rec.size[0], rec.size[2], rec.size[1]] : rec.size;
    // one uniform scale: the width is what the person set, depth and height follow the model
    const k = Math.min(W / Math.max(size[0], 1e-6), H / Math.max(size[2], 1e-6), D / Math.max(size[1], 1e-6));
    return {
      id: rec.id, name: rec.name, kind: rec.kind, size: rec.size, custom: true, category: rec.category, model: true,
      finish: { mat: rec.finishMat || 'fabric', color: '#ffffff' },
      build(group) {
        const inst = scene.clone(true); inst.scale.setScalar(k);
        if (wall) inst.position.set(0, -H / 2, size[1] * k / 2);
        group.add(inst);
      },
    };
  }
  const bmp = await createImageBitmap(rec.blob);
  const depthBmp = rec.depth ? await createImageBitmap(rec.depth).catch(() => null) : null;
  const tex = new THREE.Texture(bmp);
  tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true; tex.anisotropy = 8;
  const wall = rec.kind === 'wall';
  const [width, height, depth] = wall ? [rec.size[0], rec.size[1], rec.size[2]] : [rec.size[0], rec.size[2], rec.size[1]];
  const geo = reliefGeometry(bmp, depthBmp, { width, height, depth, kind: rec.kind });
  const materials = new Map(); // one pair per finish, shared by every copy in the room
  const own = { mat: rec.finishMat || 'fabric', color: '#ffffff' };
  return {
    id: rec.id, name: rec.name, kind: rec.kind, size: rec.size, custom: true, category: rec.category, relief: !!depthBmp,
    finish: own,
    build(group, _P, finish = own) {
      const key = `${finish.mat}|${finish.color}`;
      if (!materials.has(key)) materials.set(key, photoMaterials(tex, finish));
      const mesh = new THREE.Mesh(geo, materials.get(key));
      // casts shadows but does not take the sun's: the photo carries its own shading, and the
      // shadow map would stripe the relief's shallow slopes (lamp shadows are unaffected)
      mesh.castShadow = true; mesh.receiveShadow = false;
      group.add(mesh);
    },
  };
}

export function newCustomId() { return CUSTOM_PREFIX + Math.random().toString(36).slice(2, 10); }
export const isCustomType = (type) => typeof type === 'string' && type.startsWith(CUSTOM_PREFIX);
export const finishIsValid = (f) => !!MATERIAL_BY_ID[f.mat];
