// Surface finishes: a material type (wood, tile, …) plus a colour. Most types
// use a CC0 photo-scanned texture set (Poly Haven, see ASSETS.md) turned into a
// neutral detail map, so our own colour shows through; the rest are generated
// here. All detail maps are linear with their mean at 0.5 and all roughness
// maps are normalised the same way, so a material's colour and roughness are
// exactly what we choose. Floors and tiled walls lay out planks, tiles and
// slabs in the shader (layout.js). Geometry carries UVs in metres (boxUV).
import * as THREE from 'three';
import { Q } from './quality.js';
import { patchLamps } from './lamps.js';
import { LAYOUTS } from './layout.js';
import manifest from '../assets/manifest.json' with { type: 'json' };

export const MATERIALS = [
  { id: 'paint', name: 'Paint', roughness: 0.86, metalness: 0, tile: 1.6, normal: 0.08, reflect: 0 },
  { id: 'wood', name: 'Wood', roughness: 0.42, metalness: 0, tile: 1.4, normal: 0.45, reflect: 0.38, clearcoat: 0.35, clearcoatRoughness: 0.22 },
  { id: 'tile', name: 'Tile', roughness: 0.14, metalness: 0, tile: 0.6, normal: 0.9, reflect: 0.8, clearcoat: 0.8, clearcoatRoughness: 0.08 },
  { id: 'stone', name: 'Stone', roughness: 0.2, metalness: 0, tile: 2.2, normal: 0.35, reflect: 0.7, clearcoat: 0.5, clearcoatRoughness: 0.12 },
  { id: 'concrete', name: 'Concrete', roughness: 0.78, metalness: 0, tile: 1.8, normal: 0.5, reflect: 0.12 },
  { id: 'carpet', name: 'Carpet', roughness: 1, metalness: 0, tile: 0.35, normal: 0.8, reflect: 0, sheen: 0.7 },
  { id: 'fabric', name: 'Fabric', roughness: 0.92, metalness: 0, tile: 0.12, normal: 0.7, reflect: 0, sheen: 0.55 },
  { id: 'leather', name: 'Leather', roughness: 0.48, metalness: 0, tile: 0.18, normal: 0.6, reflect: 0, clearcoat: 0.25, clearcoatRoughness: 0.45 },
  { id: 'ceramic', name: 'Ceramic', roughness: 0.18, metalness: 0, tile: 0.5, normal: 0.1, reflect: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 },
  { id: 'metal', name: 'Metal', roughness: 0.3, metalness: 1, tile: 0.25, normal: 0.25, reflect: 0.4 },
];
export const MATERIAL_BY_ID = Object.fromEntries(MATERIALS.map((m) => [m.id, m]));
export const shineOf = (mat) => MATERIAL_BY_ID[mat]?.reflect ?? 0;

export const SWATCHES = [
  '#f3efe7', '#e8e0d2', '#d9c7a7', '#c8a378', '#9c6b43', '#5a3f2b',
  '#dfe5e8', '#9fb2c2', '#6f7f9e', '#3b4a6b', '#2b2f36', '#f0f0f0',
  '#9fb49b', '#5f7f5a', '#c98368', '#b3473d', '#e1b94a', '#8a7bb5',
];
export function normalizeFinish(f, fallback) {
  const mat = f && MATERIAL_BY_ID[f.mat] ? f.mat : fallback.mat;
  const color = f && /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : fallback.color;
  return { mat, color };
}

// ---- tileable noise ------------------------------------------------------------------
function hash(x, y, p, seed) { x = ((x % p) + p) % p; y = ((y % p) + p) % p; let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041); h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967295; }
function vnoise(x, y, p, seed) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = hash(xi, yi, p, seed), b = hash(xi + 1, yi, p, seed), c = hash(xi, yi + 1, p, seed), d = hash(xi + 1, yi + 1, p, seed); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
// fbm over a periodic lattice: x, y in [0, 1) -> seamless tile
function fbm(x, y, base, oct, seed) { let s = 0, a = 0.5, f = base, n = 0; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, f, seed + i * 31); n += a; a *= 0.5; f *= 2; } return s / n; }
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

// Each generator fills height (0..1), albedo detail (around 1) and roughness
// offset (-0.5..0.5) for an n×n seamless tile.
const GEN = {
  paint(n, H, A, R) { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, x = i / n, y = j / n, v = fbm(x, y, 6, 4, 3); H[k] = v * 0.6 + fbm(x, y, 40, 2, 9) * 0.4; A[k] = 0.97 + v * 0.05; R[k] = (v - 0.5) * 0.15; } },
  wood(n, H, A, R, { planks = true } = {}) {
    // boards run along x; grain is long, gently waving streaks with a few small knots
    const r = rng(7), boards = planks ? 7 : 1, bh = n / boards, base = [], joints = [], knots = [];
    for (let b = 0; b < boards; b++) { base.push(0.86 + r() * 0.14); joints.push(planks ? Math.floor(r() * n) : -1); knots.push(planks && r() < 0.35 ? [r(), 0.3 + r() * 0.4] : null); }
    for (let j = 0; j < n; j++) {
      const b = Math.floor(j / bh), yb = (j - b * bh) / bh;
      for (let i = 0; i < n; i++) {
        const k = j * n + i, x = i / n, y = j / n;
        const warp = fbm(x, y, 2, 3, 11 + b) * 1.6 + fbm(x, y, 8, 2, 5) * 0.25;
        const ring = 0.5 + 0.5 * Math.sin((yb * (planks ? 9 : 22) + warp + b * 0.37) * Math.PI * 2);
        const streak = fbm(x, y * (planks ? 1 : 1), 2, 2, 31 + b) * 0.5 + fbm(x * 0.5, y, 64, 2, 21 + b) * 0.5; // long fibres
        const kn = knots[b], kd = kn ? Math.hypot((x - kn[0]) * 30, (yb - kn[1]) * 6) : 9, knot = Math.max(0, 1 - kd) ** 2;
        let a = base[b] * (0.9 + 0.07 * ring + 0.09 * (streak - 0.5)) - knot * 0.16 - Math.max(0, 1.6 - kd) * 0.03;
        let h = 0.82 + 0.05 * ring + 0.05 * streak;
        if (planks) { const edge = Math.min(yb, 1 - yb) * bh, je = Math.abs(i - joints[b]); if (edge < 1 || je < 1) { h = 0; a *= 0.62; } else if (edge < 2.2 || je < 2.2) { h *= 0.7; a *= 0.94; } }
        H[k] = h; A[k] = a; R[k] = (0.5 - ring) * 0.12 + (1 - h) * 0.3 + (streak - 0.5) * 0.1;
      }
    }
  },
  woodgrain(n, H, A, R) { GEN.wood(n, H, A, R, { planks: false }); },
  tile(n, H, A, R) {
    const t = n / 2, grout = Math.max(2, n / 96), r = rng(3), tint = [r(), r(), r(), r()].map((v) => 0.93 + v * 0.08);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, ti = Math.floor(i / t), tj = Math.floor(j / t), ex = Math.min(i % t, t - (i % t)), ey = Math.min(j % t, t - (j % t)), e = Math.min(ex, ey);
      const sp = fbm(i / n, j / n, 24, 3, 5);
      if (e < grout) { H[k] = 0; A[k] = 0.78; R[k] = 0.5; continue; }
      const bevel = Math.min(1, (e - grout) / (grout * 1.5));
      H[k] = 0.65 + 0.35 * bevel + (sp - 0.5) * 0.04; A[k] = tint[ti * 2 + tj] * (0.97 + sp * 0.05); R[k] = (sp - 0.5) * 0.1;
    }
  },
  stone(n, H, A, R) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, x = i / n, y = j / n, t = fbm(x, y, 3, 5, 17);
      const vein = Math.abs(Math.sin((x * 2 + y * 1 + t * 3.2) * Math.PI * 2)), v = Math.pow(1 - vein, 7), v2 = Math.pow(1 - Math.abs(Math.sin((x * 5 - y * 3 + fbm(x, y, 6, 4, 23) * 4) * Math.PI)), 14);
      const cloud = fbm(x, y, 5, 4, 29);
      A[k] = 0.98 - v * 0.11 - v2 * 0.05 - (cloud - 0.5) * 0.08; H[k] = 0.8 - v * 0.05; R[k] = v * 0.15 + (cloud - 0.5) * 0.08;
    }
  },
  concrete(n, H, A, R) {
    const r = rng(13), pores = new Uint8Array(n * n);
    for (let p = 0; p < n * n * 0.004; p++) { const cx = Math.floor(r() * n), cy = Math.floor(r() * n), rad = 1 + r() * 2; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dy * dy <= rad * rad) pores[((cy + dy + n) % n) * n + ((cx + dx + n) % n)] = 1; }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, x = i / n, y = j / n, b = fbm(x, y, 4, 4, 41), s = fbm(x, y, 48, 2, 43); H[k] = pores[k] ? 0.1 : 0.6 + s * 0.3; A[k] = (0.9 + b * 0.14 + s * 0.04) * (pores[k] ? 0.7 : 1); R[k] = (b - 0.5) * 0.25; }
  },
  carpet(n, H, A, R) { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, x = i / n, y = j / n, f = fbm(x, y, 64, 2, 51), lo = fbm(x, y, 6, 3, 53); H[k] = f; A[k] = 0.88 + f * 0.14 + (lo - 0.5) * 0.06; R[k] = 0.3; } },
  fabric(n, H, A, R) {
    const threads = 24, per = n / threads;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, u = i / per, v = j / per, over = (Math.floor(u) + Math.floor(v)) % 2 === 0;
      const across = over ? Math.sin((v % 1) * Math.PI) : Math.sin((u % 1) * Math.PI), slub = fbm(i / n, j / n, 16, 2, 61);
      H[k] = 0.3 + 0.7 * across * (0.85 + slub * 0.3); A[k] = 0.86 + 0.14 * across + (slub - 0.5) * 0.08; R[k] = 0.2;
    }
  },
  leather(n, H, A, R) { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, x = i / n, y = j / n, c = 1 - Math.abs(fbm(x, y, 18, 3, 71) * 2 - 1), fine = fbm(x, y, 60, 2, 73); H[k] = Math.pow(c, 0.6) * 0.8 + fine * 0.2; A[k] = 0.9 + c * 0.1 - (1 - c) * 0.06; R[k] = (0.5 - c) * 0.3; } },
  ceramic(n, H, A, R) { for (let k = 0; k < n * n; k++) { H[k] = 0.5; A[k] = 1; R[k] = 0; } },
  metal(n, H, A, R) { for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, s = fbm(i / n * 0.25, j / n, 96, 3, 81); H[k] = s; A[k] = 0.95 + s * 0.06; R[k] = (s - 0.5) * 0.25; } },
};

const mapCache = new Map();
// procedural maps in the shared convention (linear, mean 0.5)
function maps(kind) {
  const n = Math.max(128, Math.min(Q.texture, kind === 'stone' || kind === 'tile' || kind === 'concrete' ? Q.texture : Q.texture / 2));
  const key = kind + n;
  if (mapCache.has(key)) return mapCache.get(key);
  const H = new Float32Array(n * n), A = new Float32Array(n * n), R = new Float32Array(n * n);
  GEN[kind](n, H, A, R);
  const mk = (fill) => { const data = new Uint8Array(n * n * 4); fill(data); const t = new THREE.DataTexture(data, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true; return t; };
  const albedo = mk((d) => { for (let k = 0; k < n * n; k++) { const v = Math.max(0, Math.min(255, A[k] * 128)); d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v; d[k * 4 + 3] = 255; } });
  const normal = mk((d) => { const s = 3.0; for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const hx = H[j * n + ((i + 1) % n)] - H[j * n + ((i - 1 + n) % n)], hy = H[((j + 1) % n) * n + i] - H[((j - 1 + n) % n) * n + i]; let x = -hx * s, y = -hy * s, z = 1; const l = Math.hypot(x, y, z); const k = (j * n + i) * 4; d[k] = (x / l * 0.5 + 0.5) * 255; d[k + 1] = (y / l * 0.5 + 0.5) * 255; d[k + 2] = (z / l * 0.5 + 0.5) * 255; d[k + 3] = 255; } });
  const rough = mk((d) => { for (let k = 0; k < n * n; k++) { const v = Math.max(0, Math.min(255, (1 + R[k]) * 128)); d[k * 4] = d[k * 4 + 1] = d[k * 4 + 2] = v; d[k * 4 + 3] = 255; } });
  const out = { albedo, normal, rough, size: 1 };
  mapCache.set(key, out);
  return out;
}

// CC0 photo-scanned sets (see tools/assets.mjs), loaded once before the scene.
const PHOTO_BASE = new URL('../assets/textures/', import.meta.url).href;
const photoCache = new Map();
const canLoad = () => typeof document !== 'undefined' && typeof Image !== 'undefined';
function photoMaps(id) {
  if (!canLoad() || !manifest.textures[id]) return null;
  if (photoCache.has(id)) return photoCache.get(id);
  const loader = new THREE.TextureLoader(), info = manifest.textures[id];
  const tex = (name) => { const t = loader.load(PHOTO_BASE + id + '/' + name + '.webp'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.NoColorSpace; return t; };
  const out = { albedo: tex('detail'), normal: tex('normal'), rough: tex('rough'), size: info.size_m[0] };
  photoCache.set(id, out);
  return out;
}
// which photo set each material uses (object pieces / room surfaces), and how strongly
const PHOTO = {
  paint: { set: 'beige_wall_001', detail: 0.35, normal: 0.35 },
  wood: { set: 'oak_veneer_01', detail: 0.55, normal: 0.4, objectScale: 0.45 },
  fabric: { set: 'rough_linen', detail: 0.75, normal: 0.9 },
  leather: { set: 'leather_white', detail: 0.7, normal: 0.8 },
  carpet: { set: 'poly_wool_herringbone', detail: 0.85, normal: 1.0 },
  concrete: { set: 'concrete_floor_02', detail: 0.55, normal: 0.6 },
};
export function preloadTextures() {
  if (!canLoad()) return Promise.resolve();
  const sets = Object.values(PHOTO).map((p) => photoMaps(p.set)).filter(Boolean);
  const all = sets.flatMap((s) => [s.albedo, s.normal, s.rough]);
  return Promise.all(all.map((t) => new Promise((resolve) => { if (t.image) return resolve(); const i = setInterval(() => { if (t.image) { clearInterval(i); resolve(); } }, 20); setTimeout(() => { clearInterval(i); resolve(); }, 8000); })));
}

// UVs in metres from the dominant axis of each face's normal (box mapping).
export function boxUV(geo, tile = 1) {
  const g = geo.index ? geo : geo, p = g.attributes.position, nrm = g.attributes.normal || (g.computeVertexNormals(), g.attributes.normal);
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i)), x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ny >= nx && ny >= nz) { uv[i * 2] = x / tile; uv[i * 2 + 1] = z / tile; } else if (nx >= nz) { uv[i * 2] = z / tile; uv[i * 2 + 1] = y / tile; } else { uv[i * 2] = x / tile; uv[i * 2 + 1] = y / tile; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

const matCache = new Map();
// which layout a room surface gets
const SURFACE_LAYOUT = { wood: 'planks', tile: 'tiles', stone: 'slabs', concrete: 'panels' };
// context: 'surface' for floors and walls (laid-out planks, tiles at room scale), 'object' for furniture.
export function makeMaterial(finish, context = 'object') {
  if (Array.isArray(context)) context = 'surface';
  const def = MATERIAL_BY_ID[finish.mat] || MATERIAL_BY_ID.paint;
  const key = `${def.id}|${finish.color}|${context}|${Q.texture}`;
  if (matCache.has(key)) return matCache.get(key);
  const surface = context === 'surface', photo = PHOTO[def.id], pm = photo && photoMaps(photo.set);
  // procedural fallbacks: wood grain on objects, glaze under laid-out tiles, marble under slabs
  const kind = def.id === 'wood' && !surface ? 'woodgrain' : surface && def.id === 'tile' ? 'ceramic' : def.id;
  const m = pm || maps(kind);
  const layoutName = surface ? SURFACE_LAYOUT[def.id] : null;
  const size = pm ? m.size * (!surface && photo.objectScale ? photo.objectScale : 1) : kind === 'woodgrain' ? 0.6 : def.tile;
  const repeat = layoutName ? 1 : 1 / size;
  const tex = (t) => { const c = t.clone(); c.repeat.set(repeat, repeat); c.needsUpdate = !!t.image; return c; };
  const color = new THREE.Color(finish.color);
  const normalK = pm ? photo.normal : def.normal;
  const mat = new THREE.MeshPhysicalMaterial({
    color, roughness: def.roughness, metalness: def.metalness,
    map: tex(m.albedo), normalMap: tex(m.normal), roughnessMap: tex(m.rough), normalScale: new THREE.Vector2(normalK, normalK),
    clearcoat: def.clearcoat || 0, clearcoatRoughness: def.clearcoatRoughness ?? 0.2,
    sheen: def.sheen || 0, sheenRoughness: 0.75, sheenColor: color.clone().lerp(new THREE.Color('#ffffff'), 0.35),
    envMapIntensity: def.metalness > 0.5 ? 1.15 : 0.9,
  });
  mat.userData.reflect = def.reflect; mat.userData.matId = def.id;
  mat.userData.detail = pm ? photo.detail : 1;
  if (layoutName) mat.userData.layout = { ...LAYOUTS[layoutName], texScale: 1 / (pm ? m.size : kind === 'stone' ? 2.2 : 1.2), gain: mat.userData.detail };
  patchLamps(mat);
  matCache.set(key, mat);
  return mat;
}
export function clearMaterialCache() { matCache.clear(); }
