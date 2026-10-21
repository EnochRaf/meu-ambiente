// Full 3D model from a photo: a small server step, because the models that
// invent the back and sides of a piece are far too big for the browser. The
// browser sends the cutout (a PNG with a clear background); this function hands
// it to the provider and reports progress; the key stays here. The finished GLB
// (about 20 MB) is too big for a Vercel function to send, so the browser fetches
// it from the provider's file URL, which needs no key; this function streams it
// only as a fallback (the mock, local work).
//
// Runs as a Vercel function (api/make3d.js) and inside scripts/serve.mjs for
// local work. Everything comes from the environment:
//   MAKE3D_PROVIDER  fal (default when FAL_KEY is set) | mock (serves tmp/mock-model.glb; local work only)
//   FAL_KEY          the fal.ai key (https://fal.ai/dashboard/keys)
//   MAKE3D_MODEL     the fal endpoint; default fal-ai/hunyuan3d-v3/image-to-3d (PBR, 120k faces,
//                    about $0.68 a piece); fal-ai/hunyuan3d/v2 (textured, about $0.5) also works
//   MAKE3D_DAILY_CAP how many generations one server instance accepts per day (default 40)
//   MAKE3D_IP_CAP    how many one address may start per day (default 6)
// The caps live in the instance's memory: enough to stop a loop or a prank on a
// personal site, not an accounting system. Nothing is stored server side; the
// provider keeps results for a while under its own terms.
import { readFile } from 'node:fs/promises';

const MAX_IMAGE = 6 * 1024 * 1024; // bytes of PNG, after base64
const day = () => Math.floor(Date.now() / 86400000);
const usage = { day: day(), total: 0, ips: new Map() };
function allow(ip) {
  if (usage.day !== day()) { usage.day = day(); usage.total = 0; usage.ips.clear(); }
  const cap = +process.env.MAKE3D_DAILY_CAP || 40, ipCap = +process.env.MAKE3D_IP_CAP || 6;
  const mine = usage.ips.get(ip) || 0;
  if (usage.total >= cap || mine >= ipCap) return false;
  usage.total++; usage.ips.set(ip, mine + 1);
  return true;
}

// ---- fal helpers (pure, tested in test/make3d.test.js) ------------------------------------
export const FAL_QUEUE = 'https://queue.fal.run/';
// The browser holds fal's result address as the job id (base64url), so nothing
// needs remembering between calls. It comes back from the browser, and the key
// goes with every request made to it, so only a plain queue.fal.run path is
// accepted; anything else is treated as a bare request id under our own app.
export const jobId = (url) => Buffer.from(url, 'utf8').toString('base64url');
export function resultUrl(id, app) {
  const s = String(id || '');
  if (/^[A-Za-z0-9_-]+$/.test(s)) {
    const url = Buffer.from(s, 'base64url').toString('utf8');
    if (url.startsWith(FAL_QUEUE) && /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\/requests\/[A-Za-z0-9_-]+$/.test(url.slice(FAL_QUEUE.length)) && !url.includes('..')) return url;
  }
  return `${FAL_QUEUE}${app}/requests/${encodeURIComponent(s)}`;
}
// where the GLB is in a result, whichever endpoint made it
export const modelUrl = (out) => out?.model_glb?.url || out?.model_urls?.glb?.url || out?.model_mesh?.url || out?.model?.url || out?.mesh?.url || null;
// fal's reasons come as text, or as a list of { msg, type } (validation)
export function falReason(type, error) {
  let text = '';
  if (typeof error === 'string') text = error;
  else if (Array.isArray(error)) text = error.map((e) => e?.msg || e?.message || (typeof e === 'string' ? e : '')).filter(Boolean).join('; ');
  else if (error && typeof error === 'object') text = error.msg || error.message || '';
  if (!text && !type) return '';
  return (type && !text.toLowerCase().includes(String(type).toLowerCase()) ? `${type}: ` : '') + text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

// ---- providers -------------------------------------------------------------------------
// each: submit(dataUrl) -> id, status(id) -> { state: 'queued'|'running'|'done'|'failed', url?, detail? }
const fal = {
  model: () => process.env.MAKE3D_MODEL || 'fal-ai/hunyuan3d-v3/image-to-3d',
  // what each endpoint wants besides the picture
  input(dataUrl) {
    const m = this.model();
    if (/hunyuan3d-v3/.test(m)) return { input_image_url: dataUrl, enable_pbr: true, face_count: 120000, generate_type: 'Normal' };
    if (/hunyuan3d\/v2/.test(m)) return { input_image_url: dataUrl, textured_mesh: true };
    return { input_image_url: dataUrl, image_url: dataUrl };
  },
  headers: () => ({ Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' }),
  async submit(dataUrl) {
    const r = await fetch(`${FAL_QUEUE}${this.model()}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(this.input(dataUrl)) });
    if (!r.ok) throw new Error(`provider ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    // the job's id for the browser is fal's own result address (fal says to use it rather than build one)
    return jobId(j.response_url || `${FAL_QUEUE}${this.app()}/requests/${j.request_id}`);
  },
  // status and result live under the app id (owner/app), whatever subpath the endpoint has
  app() { return this.model().split('/').slice(0, 2).join('/'); },
  async status(id) {
    const base = resultUrl(id, this.app());
    const s = await fetch(`${base}/status`, { headers: this.headers() });
    if (s.status === 404) return { state: 'failed', detail: 'unknown job' };
    const j = await s.json().catch(() => ({}));
    if (!s.ok) { console.error('make3d status', s.status, JSON.stringify(j).slice(0, 300)); return { state: 'failed', detail: `status ${s.status}` }; }
    if (j.status === 'IN_QUEUE') return { state: 'queued', position: j.queue_position };
    if (j.status === 'IN_PROGRESS') return { state: 'running' };
    if (j.status !== 'COMPLETED') return { state: 'failed', detail: j.status || `status ${s.status}` };
    // a job that failed also ends COMPLETED, with the reason beside it
    if (j.error) { console.error('make3d job failed', j.error_type, j.error); return { state: 'failed', detail: falReason(j.error_type, j.error) }; }
    const r = await fetch(base, { headers: this.headers() });
    const out = await r.json().catch(() => ({}));
    const url = modelUrl(out);
    if (url) return { state: 'done', url };
    console.error('make3d result without a model', r.status, JSON.stringify(out).slice(0, 500));
    return { state: 'failed', detail: falReason(null, out.detail ?? out.error) || (r.ok ? 'no model in the result' : `result ${r.status}`) };
  },
  async fetchModel(url) { return fetch(url); },
};
// local work without a key: a GLB on disk, after a short pretend wait
const mock = {
  jobs: new Map(),
  async submit() { const id = 'mock-' + Math.random().toString(36).slice(2, 10); this.jobs.set(id, Date.now()); return id; },
  async status(id) {
    const t = this.jobs.get(id); if (!t) return { state: 'failed', detail: 'unknown job' };
    const age = Date.now() - t;
    return age < 2500 ? { state: 'queued', position: 1 } : age < 7000 ? { state: 'running' } : { state: 'done', url: 'mock://model' };
  },
  async fetchModel() {
    const file = process.env.MAKE3D_MOCK_FILE || new URL('../tmp/mock-model.glb', import.meta.url);
    const bytes = await readFile(file);
    return new Response(bytes, { status: 200, headers: { 'Content-Type': 'model/gltf-binary', 'Content-Length': String(bytes.length) } });
  },
};
export function provider() {
  // the mock only when asked for (local work); a deployment without a key offers nothing
  const want = process.env.MAKE3D_PROVIDER || (process.env.FAL_KEY ? 'fal' : 'none');
  if (want === 'fal' && process.env.FAL_KEY) return fal;
  if (want === 'mock') return mock;
  return null;
}
export const available = () => !!provider();

// ---- the handler -------------------------------------------------------------------------
// GET  /api/make3d                -> { available }
// POST /api/make3d { image }      -> { id }                 (image: a data: URL of a PNG)
// GET  /api/make3d?id=…           -> { state, position?, detail?, url? }  (url: the provider's file, once done;
//                                    the browser downloads it from there, since a function may send at most 4.5 MB)
// GET  /api/make3d?file=…         -> the GLB (the fallback: the mock and local work, where there is no size cap)
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; // Vercel parses JSON bodies
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > MAX_IMAGE * 1.4) throw new Error('too large'); chunks.push(c); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
const ipOf = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x'), p = provider();
  try {
    if (req.method === 'GET' && !url.search) return json(res, 200, { available: !!p, provider: p === mock ? 'mock' : p ? 'fal' : null });
    if (!p) return json(res, 503, { error: 'not configured' });
    if (req.method === 'POST') {
      const body = await readBody(req);
      const image = typeof body.image === 'string' ? body.image : '';
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE * 1.37) return json(res, 400, { error: 'send a PNG as a data URL' });
      if (!allow(ipOf(req))) return json(res, 429, { error: 'limit reached for today' });
      const id = await p.submit(image);
      return json(res, 202, { id });
    }
    if (req.method === 'GET' && url.searchParams.get('id')) return json(res, 200, await p.status(url.searchParams.get('id')));
    if (req.method === 'GET' && url.searchParams.get('file')) {
      const st = await p.status(url.searchParams.get('file'));
      if (st.state !== 'done') return json(res, 409, { error: 'not ready', state: st.state });
      const r = await p.fetchModel(st.url);
      if (!r.ok) return json(res, 502, { error: `model ${r.status}` });
      res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'private, max-age=3600', ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length') } : {}) });
      const buf = Buffer.from(await r.arrayBuffer());
      return res.end(buf);
    }
    return json(res, 405, { error: 'method' });
  } catch (err) {
    console.error('make3d:', err);
    return json(res, 500, { error: String(err?.message || err).slice(0, 200) });
  }
}
