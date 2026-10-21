// Depth for photo items, in the browser, loaded on demand: Depth Anything V2
// small (Apache 2.0) through transformers.js. fp16 on WebGPU when it works,
// otherwise the 8-bit model on WASM. The result is relative depth (bigger =
// nearer), which relief.js turns into the sculpted front of the piece. Nothing
// is downloaded until a photo reaches the size step; nothing is uploaded.
//
// Unlike the cutout model, this one is happy with the 10 storage buffers per
// stage that Apple GPUs report (measured: 0.2 s a picture on an M-series Mac),
// so WebGPU is tried whenever there is an adapter and a probe run decides.

const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const ID = 'onnx-community/depth-anything-v2-small';
export const DEPTH_MODELS = {
  webgpu: { id: ID, dtype: 'fp16', device: 'webgpu', name: 'Depth Anything V2 small', licence: 'Apache 2.0', size: '50 MB' },
  wasm: { id: ID, dtype: 'q8', device: 'wasm', name: 'Depth Anything V2 small', licence: 'Apache 2.0', size: '27 MB' },
};
let gpu = null;
export const depthModelInfo = () => (gpu !== false && typeof navigator !== 'undefined' && navigator.gpu ? DEPTH_MODELS.webgpu : DEPTH_MODELS.wasm);
async function hasAdapter() {
  try { return !!(typeof navigator !== 'undefined' && navigator.gpu && (await navigator.gpu.requestAdapter())); } catch { return false; }
}
// the longest side the model sees; more costs time on WASM for little gain
const MAX_SIDE = 640;

async function build(tf, cfg, onProgress) {
  const progress_callback = (p) => { if (p.status === 'progress' && p.total) onProgress(Math.min(1, p.loaded / p.total), cfg); };
  const pipe = await tf.pipeline('depth-estimation', cfg.id, { dtype: cfg.dtype, device: cfg.device, progress_callback });
  // -> Float32Array (canvas.width × canvas.height), relative depth, bigger = nearer
  const estimate = async (canvas) => {
    const s = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
    let src = canvas;
    if (s < 1) { src = document.createElement('canvas'); src.width = Math.round(canvas.width * s); src.height = Math.round(canvas.height * s); const g = src.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(canvas, 0, 0, src.width, src.height); }
    const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
    const image = await tf.RawImage.fromBlob(blob);
    const { predicted_depth } = await pipe(image);
    const [h, w] = predicted_depth.dims.slice(-2);
    const d = predicted_depth.data;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < d.length; i++) { const v = d[i]; if (v !== v) throw new Error('depth is NaN'); if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!(hi - lo > 1e-6)) throw new Error('depth is flat');
    if (w === canvas.width && h === canvas.height) return Float32Array.from(d);
    // back to the canvas size, bilinear
    const out = new Float32Array(canvas.width * canvas.height);
    for (let y = 0; y < canvas.height; y++) {
      const fy = Math.min(h - 1, ((y + 0.5) * h) / canvas.height - 0.5), y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(h - 1, y0 + 1), ty = Math.max(0, fy - y0);
      for (let x = 0; x < canvas.width; x++) {
        const fx = Math.min(w - 1, ((x + 0.5) * w) / canvas.width - 0.5), x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(w - 1, x0 + 1), tx = Math.max(0, fx - x0);
        const a = d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx, b = d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx;
        out[y * canvas.width + x] = a * (1 - ty) + b * ty;
      }
    }
    return out;
  };
  // run once on a small picture so a broken GPU path fails here, not in front of the user
  const probe = document.createElement('canvas'); probe.width = 64; probe.height = 48;
  const g = probe.getContext('2d'); const grad = g.createLinearGradient(0, 0, 64, 48); grad.addColorStop(0, '#888'); grad.addColorStop(1, '#eee'); g.fillStyle = grad; g.fillRect(0, 0, 64, 48);
  await estimate(probe);
  return { model: cfg, estimate };
}

let loading = null;
export function loadDepth(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    const tf = await import(/* @vite-ignore */ TRANSFORMERS);
    gpu = await hasAdapter();
    if (gpu) {
      try { return await build(tf, DEPTH_MODELS.webgpu, onProgress); }
      catch (err) { console.warn('WebGPU depth unavailable, using the WASM model', err?.message); gpu = false; }
    }
    return build(tf, DEPTH_MODELS.wasm, onProgress);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
