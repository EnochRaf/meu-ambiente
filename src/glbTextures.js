// Generated models come with 4096 px textures (Hunyuan3D v3: colour, normal and
// metal/roughness maps, about 19 MB of a 21 MB GLB). A piece in a room fills a
// few hundred pixels, and on the GPU each such map takes about 85 MB, enough to
// crash a phone's tab with two or three photo pieces. So the textures are
// scaled down (1024 px) and re-encoded before the model is stored: colour and
// metal/roughness as JPEG, normals as PNG (JPEG blocks would read as creases).
// The geometry is left exactly as it is.
//
// readGlb / writeGlb / replaceImages are pure and tested (test/glbTextures.test.js);
// shrinkModelBlob is the browser part.

const GLB_MAGIC = 0x46546c67, JSON_CHUNK = 0x4e4f534a, BIN_CHUNK = 0x004e4942;
export const MAX_TEXTURE = 1024;
export const SHRINK_ABOVE = 4 * 1024 * 1024; // stored models bigger than this get shrunk once on load

export function readGlb(buf) {
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer, buf.byteOffset || 0, buf.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  let p = 12, json = null, bin = null;
  while (p + 8 <= dv.byteLength) {
    const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true), start = dv.byteOffset + p + 8;
    const bytes = new Uint8Array(dv.buffer, start, len);
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(bytes));
    else if (type === BIN_CHUNK && !bin) bin = bytes;
    p += 8 + len;
  }
  if (!json) throw new Error('GLB without JSON');
  return { json, bin: bin || new Uint8Array(0) };
}

const pad4 = (n) => (n + 3) & ~3;
export function writeGlb(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jlen = pad4(text.length), blen = pad4(bin.length), hasBin = bin.length > 0;
  const total = 12 + 8 + jlen + (hasBin ? 8 + blen : 0);
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, GLB_MAGIC, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jlen, true); dv.setUint32(16, JSON_CHUNK, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + jlen); // the JSON chunk is padded with spaces
  if (hasBin) { const b = 20 + jlen; dv.setUint32(b, blen, true); dv.setUint32(b + 4, BIN_CHUNK, true); out.set(bin, b + 8); }
  return out.buffer;
}

// What each image is for, from the materials that use it: 'normal', 'data'
// (metal/roughness, occlusion: linear values) or 'colour'.
export function imageRoles(json) {
  const roles = new Map(), texSource = (ref) => ref && json.textures?.[ref.index]?.source;
  const mark = (ref, role) => { const s = texSource(ref); if (s === undefined) return; if (!roles.has(s) || role === 'normal') roles.set(s, role); };
  for (const m of json.materials || []) {
    mark(m.normalTexture, 'normal');
    mark(m.occlusionTexture, 'data'); mark(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'data');
    mark(m.pbrMetallicRoughness?.baseColorTexture, m.alphaMode && m.alphaMode !== 'OPAQUE' ? 'colour-alpha' : 'colour');
    mark(m.emissiveTexture, 'colour');
  }
  return roles;
}

// Rebuild the binary chunk with some images replaced. `replacements` maps an
// image index to { bytes, mimeType }. Every buffer view keeps its data (or gets
// the new image) at a fresh 4-aligned offset; accessors point at views, so they
// need nothing. Returns a new { json, bin }.
export function replaceImages({ json, bin }, replacements) {
  const j = structuredClone(json);
  const newBytes = new Map(); // bufferView index -> bytes
  for (const [i, r] of replacements) {
    const img = j.images[i]; if (img?.bufferView === undefined) continue;
    newBytes.set(img.bufferView, r.bytes); img.mimeType = r.mimeType;
  }
  const views = j.bufferViews || [];
  let size = 0;
  const parts = views.map((v, k) => {
    if ((v.buffer ?? 0) !== 0) return null; // only the GLB's own buffer is rewritten
    const bytes = newBytes.get(k) || bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    const at = pad4(size); size = at + bytes.length;
    return { v, bytes, at };
  });
  const out = new Uint8Array(pad4(size));
  for (const p of parts) if (p) { out.set(p.bytes, p.at); p.v.byteOffset = p.at; p.v.byteLength = p.bytes.length; }
  if (j.buffers?.[0]) j.buffers[0].byteLength = out.length;
  return { json: j, bin: out };
}

// ---- in the browser ---------------------------------------------------------------------
const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// a GLB blob in, a GLB blob with textures at most `maxSide` px out (the same blob if nothing needed it)
export async function shrinkModelBlob(blob, { maxSide = MAX_TEXTURE } = {}) {
  const glb = readGlb(await blob.arrayBuffer());
  const roles = imageRoles(glb.json), replacements = new Map();
  for (const [i, img] of (glb.json.images || []).entries()) {
    if (img.bufferView === undefined) continue;
    const v = glb.json.bufferViews[img.bufferView], bytes = glb.bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    // raw values, no colour management: normal and roughness maps are data, not pictures
    const bmp = await createImageBitmap(new Blob([bytes], { type: img.mimeType || 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const k = maxSide / Math.max(bmp.width, bmp.height);
    if (k >= 1) { bmp.close?.(); continue; }
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
    const role = roles.get(i) || 'colour';
    const type = role === 'normal' || role === 'colour-alpha' ? 'image/png' : 'image/jpeg';
    const out = await toBlob(c, type, 0.92);
    if (!out) continue;
    replacements.set(i, { bytes: new Uint8Array(await out.arrayBuffer()), mimeType: type });
  }
  if (!replacements.size) return blob;
  const next = replaceImages(glb, replacements);
  return new Blob([writeGlb(next.json, next.bin)], { type: 'model/gltf-binary' });
}
