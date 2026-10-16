// Fetch and prepare the CC0 assets Meu Ambiente uses (all from Poly Haven,
// https://polyhaven.com, licence CC0 1.0; no account needed).
// Usage: node tools/assets.mjs [--rebuild | --force]   (--rebuild re-encodes, --force downloads again)
// Models: 1k glTF -> optimised .glb (meshopt geometry, dense decor simplified,
// WebP textures, 1024 px or 512 px for small decor).
// Textures: 1k diffuse/normal/roughness -> WebP; the diffuse is turned into a
// neutral detail map (luminance around 0.5) so our own colours tint it, and the
// roughness map is normalised around 0.5, so materials keep our tuned values.
// Writes assets/manifest.json with sizes, real-world dimensions and credits.
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { getBounds, textureCompress } from '@gltf-transform/functions';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

// reads and writes the optimised (meshopt-compressed) models
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const glbIO = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const ROOT = new URL('..', import.meta.url).pathname, OUT = join(ROOT, 'assets'), RAW = join(ROOT, 'node_modules/.cache/roomsmith-assets');
const FORCE = process.argv.includes('--force');               // download again
const REBUILD = FORCE || process.argv.includes('--rebuild'); // re-encode from the downloaded files
export const MODELS = [
  'modern_arm_chair_01', 'mid_century_lounge_chair', 'modern_coffee_table_01', 'side_table_01', 'coffee_table_round_01',
  'modern_wooden_cabinet', 'wooden_display_shelves_01', 'potted_plant_01', 'potted_plant_02', 'potted_plant_04',
  'ceramic_vase_01', 'ceramic_vase_02', 'ceramic_vase_03', 'ceramic_vase_04', 'throw_pillows_01',
  'wicker_basket_01', 'wooden_bowl_01', 'standing_picture_frame_01', 'hanging_picture_frame_01', 'hanging_picture_frame_02',
  'hanging_picture_frame_03', 'dining_chair_02', 'round_wooden_table_01', 'sofa_02', 'modern_ceiling_lamp_01', 'Ottoman_01',
  'painted_wooden_nightstand', 'metal_stool_01', 'wall_clock', 'wooden_candlestick', 'painted_wooden_chair_01',
  'stationery_supplies', 'office_notepads',
];
// small decor needs less texture: 512 px keeps GPU memory down
// dense organic decor is simplified (within 0.05% of its size); hard-edged pieces are not,
// since merging their vertices streaks the shading of flat panels
const SIMPLIFY = /wooden_candlestick|potted_plant_01|ceramic_vase_03/;
const SMALL = /vase|pillow|basket|bowl|frame|potted_plant_04|clock|candlestick|stationery|notepads/;
export const TEXTURES = ['oak_veneer_01', 'white_oak_veneer', 'american_walnut_veneer', 'beige_wall_001', 'concrete_floor_02',
  'rough_linen', 'velour_velvet', 'curly_teddy_natural', 'poly_wool_herringbone', 'leather_white', 'cotton_jersey'];

// bounds from the vertices themselves, in world space
function vertexBounds(doc) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const w = [M[0] * v[0] + M[4] * v[1] + M[8] * v[2] + M[12], M[1] * v[0] + M[5] * v[1] + M[9] * v[2] + M[13], M[2] * v[0] + M[6] * v[1] + M[10] * v[2] + M[14]];
        for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], w[j]); mx[j] = Math.max(mx[j], w[j]); }
      }
    }
  }
  return { min: mn, max: mx };
}
const api = async (path) => { const r = await fetch('https://api.polyhaven.com/' + path); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); };
async function download(url, file) {
  if (existsSync(file) && !FORCE) return;
  mkdirSync(dirname(file), { recursive: true });
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
const manifest = existsSync(join(OUT, 'manifest.json')) ? JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) : { models: {}, textures: {} };

for (const id of MODELS) {
  const out = join(OUT, 'models', id + '.glb');
  const info = await api('info/' + id), files = await api('files/' + id);
  const g = files.gltf['1k'].gltf, dir = join(RAW, 'models', id);
  await download(g.url, join(dir, id + '.gltf'));
  for (const [rel, f] of Object.entries(g.include || {})) await download(f.url, join(dir, rel));
  if (!existsSync(out) || REBUILD) {
    mkdirSync(dirname(out), { recursive: true });
    execFileSync(join(ROOT, 'node_modules/.bin/gltf-transform'), ['optimize', join(dir, id + '.gltf'), out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', SMALL.test(id) ? '512' : '1024', '--simplify', SIMPLIFY.test(id) ? 'true' : 'false', '--simplify-error', '0.0005', '--join', 'true', '--flatten', 'true', '--instance', 'false'], { stdio: 'pipe' });
    // roughness and metalness vary slowly: half the resolution is enough
    const glb = await glbIO.read(out);
    await glb.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^metallicRoughness/, resize: SMALL.test(id) ? [256, 256] : [512, 512], quality: 80 }));
    await glbIO.write(out, glb);
  }
  // real-world bounds (metres) from the unoptimised file, for footprints before load
  const doc = await new NodeIO().read(join(dir, id + '.gltf'));
  let b = getBounds(doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]);
  if (!isFinite(b.min[0])) b = vertexBounds(doc); // accessors without min/max: measure the vertices
  // (vintage_wooden_drawer_01 was dropped: its hosted .bin does not match the size its glTF declares)
  const bounds = { min: b.min.map((v) => +v.toFixed(4)), max: b.max.map((v) => +v.toFixed(4)) };
  manifest.models[id] = { name: info.name, bounds, authors: Object.keys(info.authors || {}), dims_mm: info.dimensions, polycount: info.polycount, bytes: statSync(out).size, source: `https://polyhaven.com/a/${id}`, licence: 'CC0 1.0' };
  console.log('model', id, (statSync(out).size / 1024).toFixed(0), 'KB');
}

for (const id of TEXTURES) {
  const info = await api('info/' + id), files = await api('files/' + id), dir = join(RAW, 'textures', id), out = join(OUT, 'textures', id);
  mkdirSync(out, { recursive: true });
  const pick = (k) => files[k]?.['1k']?.jpg?.url || files[k]?.['1k']?.png?.url;
  const src = { albedo: pick('Diffuse'), normal: pick('nor_gl'), rough: pick('Rough') };
  for (const [k, url] of Object.entries(src)) if (url) await download(url, join(dir, k + url.slice(url.lastIndexOf('.'))));
  const raw = (k) => join(dir, k + src[k].slice(src[k].lastIndexOf('.')));
  const stats = {};
  // neutral detail: luminance scaled so its mean sits at 0.5 (linear texture)
  {
    const { data, info: im } = await sharp(raw('albedo')).resize(1024, 1024).greyscale().raw().toBuffer({ resolveWithObject: true });
    let sum = 0; for (const v of data) sum += v; const mean = sum / data.length;
    const outBuf = Buffer.alloc(data.length); for (let i = 0; i < data.length; i++) outBuf[i] = Math.max(0, Math.min(255, Math.round((data[i] / mean) * 128)));
    await sharp(outBuf, { raw: { width: im.width, height: im.height, channels: 1 } }).webp({ quality: 82 }).toFile(join(out, 'detail.webp'));
    stats.albedoMean = +(mean / 255).toFixed(3);
  }
  if (src.normal) await sharp(raw('normal')).resize(1024, 1024).webp({ quality: 86 }).toFile(join(out, 'normal.webp'));
  if (src.rough) {
    // roughness varies slowly: half the resolution is enough
    const { data, info: im } = await sharp(raw('rough')).resize(512, 512).greyscale().raw().toBuffer({ resolveWithObject: true });
    let sum = 0; for (const v of data) sum += v; const mean = sum / data.length;
    const outBuf = Buffer.alloc(data.length); for (let i = 0; i < data.length; i++) outBuf[i] = Math.max(0, Math.min(255, Math.round((data[i] / mean) * 128)));
    await sharp(outBuf, { raw: { width: im.width, height: im.height, channels: 1 } }).webp({ quality: 80 }).toFile(join(out, 'rough.webp'));
    stats.roughMean = +(mean / 255).toFixed(3);
  }
  const bytes = ['detail', 'normal', 'rough'].reduce((s, k) => s + (existsSync(join(out, k + '.webp')) ? statSync(join(out, k + '.webp')).size : 0), 0);
  manifest.textures[id] = { name: info.name, authors: Object.keys(info.authors || {}), size_m: (info.dimensions || [1000, 1000]).map((v) => v / 1000), ...stats, bytes, source: `https://polyhaven.com/a/${id}`, licence: 'CC0 1.0' };
  console.log('texture', id, (bytes / 1024).toFixed(0), 'KB', JSON.stringify(manifest.textures[id].size_m));
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
