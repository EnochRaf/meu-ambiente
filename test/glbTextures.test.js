import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGlb, writeGlb, imageRoles, replaceImages } from '../src/glbTextures.js';

// a tiny GLB: one view of "geometry", then a normal map, a colour map and a data map
function sample() {
  const geom = Uint8Array.from({ length: 37 }, (_, i) => i + 1); // odd length: the next view must realign
  const imgs = [new Uint8Array(101).fill(7), new Uint8Array(55).fill(8), new Uint8Array(80).fill(9)];
  const views = [], parts = [];
  let at = 0;
  for (const b of [geom, ...imgs]) { at = (at + 3) & ~3; views.push({ buffer: 0, byteOffset: at, byteLength: b.length }); parts.push([at, b]); at += b.length; }
  const bin = new Uint8Array((at + 3) & ~3);
  for (const [o, b] of parts) bin.set(b, o);
  const json = {
    asset: { version: '2.0' }, buffers: [{ byteLength: bin.length }], bufferViews: views,
    accessors: [{ bufferView: 0, componentType: 5121, count: 37, type: 'SCALAR' }],
    images: [1, 2, 3].map((v) => ({ bufferView: v, mimeType: 'image/png' })),
    textures: [{ source: 0 }, { source: 1 }, { source: 2 }],
    materials: [{ normalTexture: { index: 0 }, pbrMetallicRoughness: { baseColorTexture: { index: 1 }, metallicRoughnessTexture: { index: 2 } } }],
  };
  return { json, bin, geom };
}

test('a GLB survives a write and a read unchanged', () => {
  const { json, bin } = sample();
  const back = readGlb(writeGlb(json, bin));
  assert.deepEqual(back.json, json);
  assert.deepEqual([...back.bin.subarray(0, bin.length)], [...bin]);
  assert.equal(new DataView(writeGlb(json, bin)).getUint32(8, true), writeGlb(json, bin).byteLength); // header length is the file length
});

test('image roles come from the materials', () => {
  const roles = imageRoles(sample().json);
  assert.equal(roles.get(0), 'normal'); assert.equal(roles.get(1), 'colour'); assert.equal(roles.get(2), 'data');
  const blended = sample().json; blended.materials[0].alphaMode = 'BLEND';
  assert.equal(imageRoles(blended).get(1), 'colour-alpha');
});

test('replacing images keeps the geometry byte for byte and realigns every view', () => {
  const s = sample();
  const small = new Uint8Array(13).fill(42);
  const out = replaceImages(s, new Map([[1, { bytes: small, mimeType: 'image/jpeg' }]]));
  const re = readGlb(writeGlb(out.json, out.bin));
  for (const v of re.json.bufferViews) assert.equal(v.byteOffset % 4, 0);
  const view = (k) => { const v = re.json.bufferViews[k]; return [...re.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength)]; };
  assert.deepEqual(view(0), [...s.geom]);
  assert.deepEqual(view(2), [...small]);
  assert.equal(re.json.images[1].mimeType, 'image/jpeg');
  assert.equal(re.json.images[0].mimeType, 'image/png');
  assert.deepEqual(view(1), new Array(101).fill(7));
  assert.deepEqual(view(3), new Array(80).fill(9));
  assert.equal(re.json.buffers[0].byteLength, re.bin.length);
  assert.ok(re.bin.length < s.bin.length);
  assert.equal(s.json.images[1].mimeType, 'image/png'); // the input is left alone
});

test('not a GLB is refused', () => {
  assert.throws(() => readGlb(new Uint8Array(20).buffer), /not a GLB/);
});

test('textures stored as WebP through an extension still get their roles', () => {
  const { json } = sample();
  json.textures = json.textures.map((t) => ({ extensions: { EXT_texture_webp: { source: t.source } } }));
  const roles = imageRoles(json);
  assert.equal(roles.get(0), 'normal'); assert.equal(roles.get(1), 'colour'); assert.equal(roles.get(2), 'data');
});

test('a map that says metal all over is told apart from a mostly matt one', async () => {
  const { metalShare, ALL_METAL } = await import('../src/glbTextures.js');
  const px = (b, n = 64) => Uint8ClampedArray.from({ length: n * 4 }, (_, i) => (i % 4 === 2 ? b : 128));
  assert.ok(metalShare(px(254)) >= ALL_METAL); // Trellis 2's leather sofa
  assert.ok(metalShare(px(254), 0.5) < ALL_METAL); // a half-metallic factor brings it down
  assert.ok(metalShare(px(20)) < ALL_METAL);
  const mixed = new Uint8ClampedArray(64 * 4); for (let i = 0; i < 64; i++) mixed[i * 4 + 2] = i < 16 ? 255 : 0; // metal legs on a fabric chair
  assert.ok(metalShare(mixed) < ALL_METAL);
});
