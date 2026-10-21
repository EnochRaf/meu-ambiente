// A full 3D model from a photo, through the site's own /api/make3d (see
// api/make3d.js). The cutout goes up as a PNG; a GLB comes back a minute later.
// This is the one path in the app that leaves the browser, so the dialog says
// so before anything is sent. `onStatus` gets 'sending' | 'queued' | 'running'
// | 'downloading' as things move.
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

export class ModelError extends Error { constructor(code, message) { super(message || code); this.code = code; } }

// cutout: a PNG blob with a clear background -> a GLB blob
export async function makeModel(cutout, onStatus = () => {}, { signal } = {}) {
  onStatus('sending');
  const image = await toDataUrl(cutout);
  const start = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal });
  if (start.status === 429) throw new ModelError('limit');
  if (start.status === 503) throw new ModelError('unavailable');
  if (!start.ok) throw new ModelError('failed', (await start.json().catch(() => ({}))).error);
  const { id } = await start.json();
  const began = Date.now();
  for (;;) {
    if (signal?.aborted) throw new ModelError('cancelled');
    await sleep(2500);
    const r = await fetch(`${API}?id=${encodeURIComponent(id)}`, { cache: 'no-store', signal });
    const st = await r.json().catch(() => ({ state: 'failed' }));
    if (st.state === 'done') break;
    if (st.state === 'failed') throw new ModelError('failed', st.detail);
    onStatus(st.state, st.position);
    if (Date.now() - began > 8 * 60 * 1000) throw new ModelError('timeout');
  }
  onStatus('downloading');
  const file = await fetch(`${API}?file=${encodeURIComponent(id)}`, { signal });
  if (!file.ok) throw new ModelError('failed', `download ${file.status}`);
  const blob = await file.blob();
  if (blob.size < 1000) throw new ModelError('failed', 'empty model');
  return new Blob([blob], { type: 'model/gltf-binary' });
}
