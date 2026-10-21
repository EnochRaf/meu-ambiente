// A full 3D model from a photo, through the site's own /api/make3d (see
// api/make3d.js). The cutout goes up as a PNG; a GLB comes back a minute later.
// This is the one path in the app that leaves the browser, so the dialog says
// so before anything is sent. `onStatus` gets 'sending' | 'queued' | 'running'
// | 'downloading' as things move.
import { shrinkModelBlob } from './glbTextures.js';

// the route beside the site (a server function, not a file: built without new URL so the build's file scan skips it)
const API = import.meta.url.replace(/\/src\/[^/]*$/, '') .replace(/^[a-z]+:\/\/[^/]+/, '') + '/api/make3d';

let availability = null;
export async function modelServiceAvailable() {
  if (availability !== null) return availability;
  try { const r = await fetch(API, { cache: 'no-store' }); const j = await r.json(); availability = !!j.available; }
  catch { availability = false; }
  return availability;
}

const toDataUrl = (blob) => new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(blob); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vercel functions take at most 4.5 MB in and send at most 4.5 MB out. The
// cutout goes up as base64 JSON, so it is made smaller (keeping its alpha) until
// it fits with room to spare; 3D services work from about 1000 px anyway.
export const UPLOAD_LIMIT = 3_800_000; // characters of data URL
async function fitForUpload(blob) {
  let url = await toDataUrl(blob);
  if (url.length <= UPLOAD_LIMIT) return url;
  const bmp = await createImageBitmap(blob);
  let scale = Math.sqrt(UPLOAD_LIMIT / url.length) * 0.95;
  for (let i = 0; i < 6 && url.length > UPLOAD_LIMIT; i++, scale *= 0.85) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL('image/png');
  }
  bmp.close?.();
  if (url.length > UPLOAD_LIMIT) throw new ModelError('failed', 'photo too large');
  return url;
}

// The finished model is far bigger than a function may send (Hunyuan3D v3 with
// PBR is about 20 MB), so the browser fetches it from the provider's own file
// URL, which carries no key. Our ?file= route stays as the fallback: the mock,
// local work, or a provider host that does not allow cross-origin reads.
async function download(id, url, signal) {
  if (/^https:\/\//.test(url || '')) {
    try { const r = await fetch(url, { signal }); if (r.ok) return await r.blob(); console.warn('model download', r.status); }
    catch (err) { if (signal?.aborted) throw new ModelError('cancelled'); console.warn('model download direct failed, trying the site:', err?.message); }
  }
  const file = await fetch(`${API}?file=${encodeURIComponent(id)}`, { signal });
  if (!file.ok) throw new ModelError('failed', `download ${file.status}`);
  return file.blob();
}

export class ModelError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

// cutout: a PNG blob with a clear background -> a GLB blob
export async function makeModel(cutout, onStatus = () => {}, { signal } = {}) {
  onStatus('sending');
  const image = await fitForUpload(cutout);
  const start = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal });
  if (start.status === 429) throw new ModelError('limit');
  if (start.status === 503) throw new ModelError('unavailable');
  if (start.status === 413) throw new ModelError('failed', 'photo too large');
  if (!start.ok) throw new ModelError('failed', (await start.json().catch(() => ({}))).error || `status ${start.status}`);
  const { id } = await start.json();
  const began = Date.now();
  let url = null;
  for (;;) {
    if (signal?.aborted) throw new ModelError('cancelled');
    await sleep(2500);
    const r = await fetch(`${API}?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
    const st = await r.json().catch(() => ({ state: 'failed' }));
    if (st.state === 'done') { url = st.url; break; }
    if (st.state === 'failed') throw new ModelError('failed', st.detail);
    onStatus(st.state, st.position);
    if (Date.now() - began > 8 * 60 * 1000) throw new ModelError('timeout');
  }
  onStatus('downloading');
  const blob = await download(id, url, signal);
  if (blob.size < 1000) throw new ModelError('failed', 'empty model');
  const glb = new Blob([blob], { type: 'model/gltf-binary' });
  try { return await shrinkModelBlob(glb); } // 4096 px textures down to 1024 (see glbTextures.js)
  catch (err) { console.warn('could not shrink the model, keeping it as it came:', err?.message); return glb; }
}
