// AI background removal in the browser, loaded on demand. Both models allow
// commercial use. Preferred: BiRefNet lite (MIT) in fp16 on WebGPU, through
// transformers.js. Fallback, or when WebGPU is missing or fails: U²-Net-p
// (Apache 2.0, 4.6 MB, served with the app) on WASM through onnxruntime-web.
// Nothing is downloaded until the user asks for the AI cutout.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs';
export const MODELS = {
  webgpu: { id: 'onnx-community/BiRefNet_lite-ONNX', dtype: 'fp16', device: 'webgpu', input: 'input_image', output: 'output_image', name: 'BiRefNet lite', licence: 'MIT', size: '115 MB', sigmoid: true },
  wasm: { id: 'u2netp', url: new URL('../assets/ai/u2netp.onnx', import.meta.url).href, device: 'wasm', name: 'U²-Net-p', licence: 'Apache 2.0', size: '4.6 MB', side: 320 },
};
export const hasWebGPU = () => typeof navigator !== 'undefined' && !!navigator.gpu;
// onnxruntime's WebGPU kernels need more than 10 storage buffers per stage; some
// GPUs (and headless Chrome) report exactly 10, and a failed GPU session also
// breaks later WASM sessions. Decide once, before any session exists.
let gpuOk = null;
export async function webgpuUsable() {
  if (gpuOk !== null) return gpuOk;
  try {
    const adapter = hasWebGPU() ? await navigator.gpu.requestAdapter() : null;
    gpuOk = !!adapter && adapter.limits.maxStorageBuffersPerShaderStage >= 16;
  } catch { gpuOk = false; }
  return gpuOk;
}
export const aiModelInfo = () => (gpuOk ? MODELS.webgpu : MODELS.wasm);

async function build(tf, cfg, onProgress) {
  const progress_callback = (p) => { if (p.status === 'progress' && p.total) onProgress(Math.min(1, p.loaded / p.total), cfg); };
  const model = await tf.AutoModel.from_pretrained(cfg.id, { dtype: cfg.dtype, device: cfg.device, progress_callback });
  const processor = await tf.AutoProcessor.from_pretrained(cfg.id, { progress_callback });
  const segment = async (canvas) => {
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const image = await tf.RawImage.fromBlob(blob);
    const { pixel_values } = await processor(image);
    const out = await model({ [cfg.input]: pixel_values });
    let t = out[cfg.output];
    if (t.dims.length === 4) t = t[0];
    if (cfg.sigmoid) t = t.sigmoid();
    const mask = await tf.RawImage.fromTensor(t.mul(255).to('uint8')).resize(canvas.width, canvas.height);
    const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
    const d = mask.data, ch = mask.channels;
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * ch];
    return alpha;
  };
  // run once on a tiny canvas so a broken GPU path fails here, not in front of the user
  const probe = document.createElement('canvas'); probe.width = probe.height = 64;
  await segment(probe);
  return { model: cfg, segment };
}

// U²-Net-p: a 320 × 320 ImageNet-normalised picture in, a saliency map out (stretched to 0–1)
async function buildU2net(cfg, onProgress) {
  const ort = await import(/* @vite-ignore */ ORT);
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
  const res = await fetch(cfg.url); if (!res.ok) throw new Error('model ' + res.status);
  const total = +res.headers.get('content-length') || 0, reader = res.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (total) onProgress(Math.min(1, got / total), cfg); }
  const bytes = new Uint8Array(got); let o = 0; for (const c of chunks) { bytes.set(c, o); o += c.length; }
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  const S = cfg.side, mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const segment = async (canvas) => {
    const small = document.createElement('canvas'); small.width = small.height = S;
    const g = small.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, S, S);
    const px = g.getImageData(0, 0, S, S).data, input = new Float32Array(3 * S * S);
    let mx = 1; for (let i = 0; i < px.length; i += 4) mx = Math.max(mx, px[i], px[i + 1], px[i + 2]);
    for (let i = 0; i < S * S; i++) for (let c = 0; c < 3; c++) input[c * S * S + i] = (px[i * 4 + c] / mx - mean[c]) / std[c];
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) });
    const d = out[session.outputNames[0]].data;
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < S * S; i++) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    const mask = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) { const v = Math.round(((d[i] - lo) / Math.max(1e-6, hi - lo)) * 255); mask.data[i * 4] = v; mask.data[i * 4 + 3] = 255; }
    g.putImageData(mask, 0, 0);
    // back to the photo's size, smoothly
    const big = document.createElement('canvas'); big.width = canvas.width; big.height = canvas.height;
    const bg = big.getContext('2d', { willReadFrequently: true }); bg.imageSmoothingQuality = 'high'; bg.drawImage(small, 0, 0, big.width, big.height);
    const up = bg.getImageData(0, 0, big.width, big.height).data, alpha = new Uint8ClampedArray(big.width * big.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = up[i * 4];
    return alpha;
  };
  return { model: cfg, segment };
}

let loading = null;
export function loadSegmenter(onProgress = () => {}) {
  if (loading) return loading;
  loading = (async () => {
    if (await webgpuUsable()) {
      try { return await build(await import(/* @vite-ignore */ TRANSFORMERS), MODELS.webgpu, onProgress); }
      catch (err) { console.warn('WebGPU cutout unavailable, using the WASM model', err?.message); }
    }
    return buildU2net(MODELS.wasm, onProgress);
  })();
  loading.catch(() => { loading = null; });
  return loading;
}
