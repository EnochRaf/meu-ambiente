// "From photo" dialog: photo in, cutout and touch-up, size and kind, preview,
// then a catalog item out. Three steps in one glass dialog. On the last step a
// depth model gives the cutout its shape (see depth.js and relief.js).
import { t, num } from './i18n/index.js';
import { pieceName, materialName, photoKindName } from './i18n/names.js';
import { DEFS } from './catalog.js';
import { loadPhoto, analyzePhoto, quickMask, alphaToMask, rotateCanvas, finishCutout, canvasToBlob, depthToBlob, makeCustomDef, customStore, newCustomId } from './customItems.js';
import { loadSegmenter, aiModelInfo, webgpuUsable } from './segment.js';
import { loadDepth, depthModelInfo } from './depth.js';
import { makeModel, modelServiceAvailable } from './make3d.js';
import { modelProportions } from './customItems.js';
import { CATEGORIES, CATEGORY_BY_ID, categoryFromLabels, guessByShape, guessMaterial, loadClassifier, CLASSIFIER } from './classify.js';
import { MATERIAL_BY_ID } from './materials.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v; else if (k === 'style') n.style.cssText = v; else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) n.append(c);
  return n;
};
const TIPS = ['photo.tip1', 'photo.tip2', 'photo.tip3', 'photo.tip4'];
const PERSON_CM = 170;

export function setupPhotoDialog({ thumbs, toast, onAdded }) {
  const dlg = $('#photo-modal');
  const st = reset();
  function reset() {
    return { step: 1, photo: null, src: null, angle: 0, mode: 'quick', tol: 40, keep: false, base: null, edits: null, crop: null, tool: 'none', brush: 28,
      result: null, category: null, lockRatio: true, dims: { w: 80, d: 40, h: 80 }, variant: 'photo', match: null, ai: null, busy: false,
      srcDepth: null, srcDepthAngle: null, depthModel: '', depth: null, depthFor: null, depthPromise: null,
      model: null, modelFor: null, modelProps: null, modelBusy: false };
  }
  const state = () => st;
  let S = st;

  // ---- step 1: photo ---------------------------------------------------------------
  // texts that depend on the language are filled in each time the dialog opens
  function localise() {
    $('#ph-tips').replaceChildren(...TIPS.map((k) => el('li', {}, t(k))));
    const cat = $('#ph-cat').value;
    $('#ph-cat').replaceChildren(...CATEGORIES.map((c) => el('option', { value: c.id }, photoKindName(c))));
    if (cat) $('#ph-cat').value = cat;
  }
  $('#ph-drop').onclick = () => $('#ph-file').click();
  $('#ph-file').addEventListener('change', async (e) => { const f = e.target.files[0]; if (f) await usePhoto(f); });
  dlg.addEventListener('dragover', (e) => { e.preventDefault(); });
  dlg.addEventListener('drop', async (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f && f.type.startsWith('image/')) await usePhoto(f); });
  async function usePhoto(file) {
    try {
      S.photo = await loadPhoto(file);
    } catch { toast(t('photo.unreadable')); return; }
    S.name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').slice(0, 40);
    const a = analyzePhoto(S.photo.canvas, S.photo.original);
    S.warnings = a.warnings;
    $('#ph-warnings').replaceChildren(...a.warnings.map((w) => el('div', { class: 'warn' }, t(`photo.warn.${w.id}`))));
    // the thumbnail, centred in the drop zone and drawn at the screen's density
    const thumb = $('#ph-thumb'), c = S.photo.canvas, dpr = Math.min(2, window.devicePixelRatio || 1), s = Math.min(240 / c.width, 240 / c.height, 1);
    const tw = Math.round(c.width * s), th = Math.round(c.height * s);
    thumb.width = Math.round(tw * dpr); thumb.height = Math.round(th * dpr); thumb.style.width = tw + 'px'; thumb.style.height = th + 'px';
    const tg = thumb.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(c, 0, 0, thumb.width, thumb.height);
    dlg.classList.add('has-photo');
    $('#ph-next1').disabled = false;
    S.angle = 0; S.crop = null; S.base = null; S.edits = null; S.result = null; S.category = null; S.match = null;
    S.aiAlpha = null; S.aiAngle = null; S.src = null; S.mode = 'quick';
    S.srcDepth = null; S.srcDepthAngle = null; S.depth = null; S.depthFor = null;
    S.model = null; S.modelFor = null; S.modelProps = null;
    for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.classList.toggle('on', b.dataset.mode === 'quick');
    $('#ph-ai-note').textContent = '';
  }

  // ---- step 2: cutout ---------------------------------------------------------------
  const pv = $('#ph-canvas'), pctx = pv.getContext('2d');
  let view = { scale: 1, ox: 0, oy: 0, k: 1 };
  // draw at the screen's density: the backing store follows the on-screen size
  function fitCanvas(c, w0, h0) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), css = c.clientWidth || w0, k = (css * dpr) / w0;
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return k;
  }
  function prepareSource() {
    S.src = rotateCanvas(S.photo.canvas, S.angle);
    S.edits = new Uint8Array(S.src.width * S.src.height);
    S.crop = null;
    if (S.mode === 'quick' || !S.aiAlpha || S.aiAngle !== S.angle) S.base = quickMask(S.src, S.tol);
    if (S.mode === 'ai' && S.aiAlpha && S.aiAngle === S.angle) S.base = alphaToMask(S.aiAlpha);
  }
  function composeMask() {
    const m = new Uint8Array(S.base);
    const e = S.edits;
    for (let i = 0; i < m.length; i++) if (e[i] === 1) m[i] = 0; else if (e[i] === 2) m[i] = 1;
    return m;
  }
  let renderTimer = 0;
  function scheduleRender(ms = 40) { clearTimeout(renderTimer); renderTimer = setTimeout(renderCutout, ms); }
  function renderCutout() {
    if (!S.src) return;
    S.result = finishCutout(S.src, composeMask(), { crop: S.crop, keepBackground: S.keep });
    S.rev = (S.rev || 0) + 1; // every cutout change gets its own depth map
    view.k = fitCanvas(pv, 520, 440);
    const W = pv.width, H = pv.height;
    pctx.clearRect(0, 0, W, H);
    view.scale = Math.min(W / S.src.width, H / S.src.height);
    view.ox = (W - S.src.width * view.scale) / 2; view.oy = (H - S.src.height * view.scale) / 2;
    pctx.save(); pctx.globalAlpha = 0.18; pctx.drawImage(S.src, view.ox, view.oy, S.src.width * view.scale, S.src.height * view.scale); pctx.restore();
    if (S.result) {
      const b = S.result.bounds;
      pctx.drawImage(S.result.canvas, view.ox + b.x0 * view.scale, view.oy + b.y0 * view.scale, S.result.canvas.width * view.scale, S.result.canvas.height * view.scale);
    }
    if (S.crop) {
      pctx.save(); pctx.setLineDash([6 * view.k, 4 * view.k]); pctx.strokeStyle = '#1fa98a'; pctx.lineWidth = 2 * view.k;
      pctx.strokeRect(view.ox + S.crop.x0 * view.scale, view.oy + S.crop.y0 * view.scale, (S.crop.x1 - S.crop.x0) * view.scale, (S.crop.y1 - S.crop.y0) * view.scale); pctx.restore();
    }
    const notes = [];
    if (!S.result) notes.push({ cls: 'warn', text: t('photo.nothingLeft') });
    else { notes.push({ cls: 'ok', text: t('photo.trimmed', { w: S.result.canvas.width, h: S.result.canvas.height }) }); if (S.result.tilt > 0.3) notes.push({ cls: 'warn', text: t('photo.slanted') }); }
    $('#ph-cutnote').replaceChildren(...notes.map((n) => el('div', { class: n.cls }, n.text)));
    $('#ph-next2').disabled = !S.result;
  }
  function toSrc(e) { const r = pv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (pv.width / r.width), y: (e.clientY - r.top) * (pv.height / r.height) }; }
  function paint(p) {
    const x = (p.x - view.ox) / view.scale, y = (p.y - view.oy) / view.scale, r = (S.brush * view.k) / 2 / view.scale, v = S.tool === 'erase' ? 1 : 2;
    const w = S.src.width, h = S.src.height;
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(h - 1, Math.ceil(y + r)); yy++) for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, Math.ceil(x + r)); xx++)
      if ((xx - x) ** 2 + (yy - y) ** 2 <= r * r) S.edits[yy * w + xx] = v;
  }
  let painting = false, cropStart = null;
  pv.addEventListener('pointerdown', (e) => {
    if (!S.src || S.tool === 'none') return;
    pv.setPointerCapture(e.pointerId); e.preventDefault();
    const p = toSrc(e);
    if (S.tool === 'crop') { cropStart = p; S.crop = null; return; }
    painting = true; paint(p); scheduleRender(30);
  });
  pv.addEventListener('pointermove', (e) => {
    if (S.tool === 'crop' && cropStart) {
      const p = toSrc(e);
      const sx = (v) => Math.max(0, Math.min(S.src.width - 1, Math.round((v - view.ox) / view.scale)));
      const sy = (v) => Math.max(0, Math.min(S.src.height - 1, Math.round((v - view.oy) / view.scale)));
      S.crop = { x0: Math.min(sx(cropStart.x), sx(p.x)), x1: Math.max(sx(cropStart.x), sx(p.x)), y0: Math.min(sy(cropStart.y), sy(p.y)), y1: Math.max(sy(cropStart.y), sy(p.y)) };
      scheduleRender(30); return;
    }
    if (painting) { paint(toSrc(e)); scheduleRender(30); }
  });
  const stopPaint = () => { painting = false; cropStart = null; };
  pv.addEventListener('pointerup', stopPaint); pv.addEventListener('pointercancel', stopPaint);

  for (const b of document.querySelectorAll('#ph-tools [data-tool]')) b.onclick = () => { S.tool = S.tool === b.dataset.tool ? 'none' : b.dataset.tool; syncTools(); };
  function syncTools() {
    for (const b of document.querySelectorAll('#ph-tools [data-tool]')) b.classList.toggle('on', b.dataset.tool === S.tool);
    pv.classList.toggle('brushing', S.tool === 'erase' || S.tool === 'restore'); pv.classList.toggle('cropping', S.tool === 'crop');
    $('#ph-brush-row').hidden = !(S.tool === 'erase' || S.tool === 'restore');
  }
  $('#ph-brush').addEventListener('input', (e) => { S.brush = parseInt(e.target.value, 10); });
  $('#ph-clear-edits').onclick = () => { S.edits.fill(0); S.crop = null; scheduleRender(0); };
  $('#ph-tol').addEventListener('input', (e) => { S.tol = parseInt(e.target.value, 10); if (S.mode === 'quick') { S.base = quickMask(S.src, S.tol); scheduleRender(60); } });
  $('#ph-angle').addEventListener('input', (e) => { S.angle = parseFloat(e.target.value); $('#ph-angle-v').textContent = `${num(S.angle, 1)}°`; prepareSource(); scheduleRender(60); });
  $('#ph-keep').addEventListener('change', (e) => { S.keep = e.target.checked; scheduleRender(0); });
  for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.onclick = () => setMode(b.dataset.mode);
  async function setMode(mode) {
    S.mode = mode;
    for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
    $('#ph-tol-row').hidden = mode !== 'quick';
    if (mode === 'quick') { S.base = quickMask(S.src, S.tol); scheduleRender(0); return; }
    if (S.aiAlpha && S.aiAngle === S.angle) { S.base = alphaToMask(S.aiAlpha); $('#ph-ai-note').textContent = t('photo.cutWith', { model: aiModelInfo().name }); scheduleRender(0); return; }
    await runAI();
  }
  async function runAI() {
    await webgpuUsable();
    const info = aiModelInfo();
    const note = $('#ph-ai-note');
    note.textContent = t('photo.loadingModel', { model: info.name, size: info.size, licence: info.licence });
    S.busy = true; $('#ph-next2').disabled = true;
    try {
      const seg = await loadSegmenter((p) => { note.textContent = t('photo.loadingProgress', { model: info.name, pct: Math.round(p * 100) }); });
      note.textContent = t('photo.finding', { model: seg.model.name });
      S.aiAlpha = await seg.segment(S.src); S.aiAngle = S.angle;
      S.base = alphaToMask(S.aiAlpha);
      note.textContent = t('photo.cutWith', { model: seg.model.name });
    } catch (err) {
      console.warn('AI cutout failed:', err?.message || err);
      note.textContent = t('photo.aiFailed');
      S.mode = 'quick'; for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.classList.toggle('on', b.dataset.mode === 'quick');
      $('#ph-tol-row').hidden = false; S.base = quickMask(S.src, S.tol);
    }
    S.busy = false; scheduleRender(0);
  }

  // ---- step 3: size, kind, preview -----------------------------------------------------
  // The piece's shape: relative depth from an on-device model, worked out once
  // per photo and cut to the cutout's bounds. Previews refresh when it is ready.
  function depthSig() { const b = S.result.bounds; return [S.angle, b.x0, b.y0, b.x1, b.y1, S.keep ? 'k' : 'c', S.rev].join('/'); }
  async function ensureDepth() {
    while (S.depthPromise) await S.depthPromise.catch(() => {});
    if (!S.result || S.depthFor === depthSig()) return;
    const sig = depthSig(), note = $('#ph-depth-note');
    S.depthPromise = (async () => {
      try {
        if (!S.srcDepth || S.srcDepthAngle !== S.angle) {
          const info = depthModelInfo();
          note.textContent = t('photo.loadingModel', { model: info.name, size: info.size, licence: info.licence });
          const dep = await loadDepth((p, cfg) => { note.textContent = t('photo.loadingProgress', { model: cfg.name, pct: Math.round(p * 100) }); });
          note.textContent = t('photo.depthWorking', { model: dep.model.name });
          S.srcDepth = await dep.estimate(S.src); S.srcDepthAngle = S.angle; S.depthModel = dep.model.name;
        }
        const b = S.result.bounds, w = S.result.canvas.width, h = S.result.canvas.height, sw = S.src.width;
        const d = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = S.srcDepth[(b.y0 + y) * sw + (b.x0 + x)];
        const px = S.result.canvas.getContext('2d').getImageData(0, 0, w, h).data, alpha = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) alpha[i] = px[i * 4 + 3];
        S.depth = await depthToBlob(d, alpha, w, h);
        note.textContent = t('photo.depthDone', { model: S.depthModel });
      } catch (err) {
        console.warn('depth failed:', err?.message || err);
        S.depth = null;
        note.textContent = t('photo.depthFailed');
      }
      S.depthFor = sig;
    })().finally(() => { S.depthPromise = null; });
    await S.depthPromise;
    renderPreviews();
  }
  $('#ph-cat').addEventListener('change', () => applyCategory($('#ph-cat').value, true));
  $('#ph-detect').onclick = detect;
  for (const id of ['w', 'd', 'h']) $(`#ph-${id}`).addEventListener('input', (e) => { S.dims[id] = parseFloat(e.target.value) || S.dims[id]; if (S.lockRatio && (id !== 'd' || usingModel())) syncRatio(id); renderScale(); });
  $('#ph-lock').addEventListener('change', (e) => { S.lockRatio = e.target.checked; if (S.lockRatio) syncRatio('w'); renderScale(); });
  for (const b of document.querySelectorAll('#ph-variant [data-variant]')) b.onclick = () => {
    if (b.dataset.variant === 'model' && !S.model) { if (!S.modelBusy) makeFullModel(); return; } // the card is the button until there is a model
    S.variant = b.dataset.variant; syncVariant(); if (S.lockRatio) syncRatio('w'); renderScale();
  };
  // The full 3D model: the one step that leaves the browser, so it only runs on a
  // click. The card shows a ring filling over the expected minute (the service
  // reports stages, not a percentage, so the ring follows the clock within each
  // stage and never reaches the end until the model is really here).
  const modelCard = $('#ph-var-model'), ring = modelCard.querySelector('.ring .bar'), pct = modelCard.querySelector('.pct'), modelLabel = $('#ph-model-label');
  const setModelState = (state, label) => { modelCard.dataset.state = state; modelLabel.textContent = label; };
  const setProgress = (f) => { const v = Math.max(0, Math.min(1, f)); ring.style.strokeDashoffset = (125.7 * (1 - v)).toFixed(1); pct.textContent = Math.round(v * 100) + '%'; };
  const resetModelCard = () => { setModelState('idle', t('photo.makeModel')); setProgress(0); $('#ph-prev-model').removeAttribute('src'); };
  async function makeFullModel() {
    if (!S.result || S.modelBusy) return;
    const note = $('#ph-model-note');
    S.modelBusy = true; note.hidden = false; note.classList.remove('bad'); $('#ph-match-note').hidden = $('#ph-depth-note').hidden = true;
    $('#ph-save').disabled = true; // nothing gets added while the model is on its way
    const sig = depthSig(), t0 = performance.now();
    // where each stage sits on the ring, and how long it usually takes
    const STAGES = { sending: [0, 0.06, 4], queued: [0.06, 0.18, 20], running: [0.18, 0.9, 75], downloading: [0.9, 0.98, 8] };
    let stage = 'sending', stageAt = t0;
    const tick = setInterval(() => { const [a, b, secs] = STAGES[stage] || [0.9, 0.98, 8]; const f = 1 - Math.exp(-((performance.now() - stageAt) / 1000) / secs * 2.2); setProgress(a + (b - a) * f); }, 250);
    setModelState('working', t('photo.model.sending')); setProgress(0.01);
    note.textContent = t('photo.makeModelHint');
    try {
      const blob = await makeModel(await canvasToBlob(S.result.canvas), (state) => { if (state !== stage) { stage = state; stageAt = performance.now(); } modelLabel.textContent = t(`photo.model.${state}`); });
      clearInterval(tick); setProgress(1);
      S.model = blob; S.modelFor = sig; S.modelProps = await modelProportions(blob);
      S.variant = 'model';
      setModelState('done', t('photo.modelVariant'));
      note.textContent = t('photo.modelDone');
      syncVariant(); if (S.lockRatio) syncRatio('w'); renderScale(); renderPreviews();
    } catch (err) {
      clearInterval(tick);
      console.warn('full model failed:', err?.code, err?.message);
      resetModelCard();
      note.textContent = t(err?.code === 'limit' ? 'photo.modelLimit' : 'photo.modelFailed') + (err?.message && err.message !== err.code ? ` (${err.message})` : '');
      note.classList.add('bad'); note.hidden = false;
      syncVariant(); note.hidden = false;
    }
    S.modelBusy = false; $('#ph-save').disabled = false;
  }
  const aspect = () => S.result ? S.result.canvas.height / S.result.canvas.width : 1;
  const usingModel = () => S.variant === 'model' && S.model && S.modelProps;
  function syncRatio(from) {
    if (usingModel()) {
      // the model has all three: whichever changed sets the scale of the other two
      const [pw, pd, ph] = S.modelProps, k = from === 'h' ? S.dims.h / ph : from === 'd' ? S.dims.d / pd : S.dims.w / pw;
      S.dims = { w: Math.round(pw * k), d: Math.round(pd * k), h: Math.round(ph * k) };
      $('#ph-w').value = S.dims.w; $('#ph-d').value = S.dims.d; $('#ph-h').value = S.dims.h; return;
    }
    if (from === 'h') S.dims.w = Math.round(S.dims.h / aspect()); else S.dims.h = Math.round(S.dims.w * aspect());
    $('#ph-w').value = S.dims.w; $('#ph-h').value = S.dims.h;
  }
  function applyCategory(id, userPicked) {
    const c = CATEGORY_BY_ID[id] || CATEGORY_BY_ID['other-floor'];
    S.category = c; $('#ph-cat').value = c.id;
    $('#ph-kind').value = c.kind === 'wall' ? 'wall' : 'floor';
    // typical size, then keep the photo's proportions from the width
    const typicalH = c.kind === 'wall' ? c.size[1] : c.size[2];
    S.dims = { w: c.size[0], d: c.kind === 'wall' ? c.size[2] : c.size[1], h: typicalH };
    // keep the photo's proportions, anchored on whichever typical dimension is larger
    if (S.lockRatio) { if (typicalH > c.size[0]) S.dims.w = Math.round(typicalH / aspect()); else S.dims.h = Math.round(S.dims.w * aspect()); }
    $('#ph-w').value = S.dims.w; $('#ph-d').value = S.dims.d; $('#ph-h').value = S.dims.h;
    $('#ph-d-label').textContent = t(c.kind === 'wall' ? 'dim.depthWallCm' : 'dim.depthCm');
    $('#ph-typical').textContent = t('photo.typical', { kind: photoKindName(c).toLowerCase(), size: `${c.size[0]} × ${c.size[1]} × ${c.size[2]} cm` });
    const color = S.result?.colors?.[0]?.rgb || [160, 150, 140];
    const mat = guessMaterial(c, color);
    S.match = c.match && DEFS[c.match] ? { base: c.match, finish: { mat, color: S.result.colors[0].hex } } : null;
    $('#ph-var-3d').disabled = !S.match;
    if (!S.match && S.variant === '3d') S.variant = 'photo';
    syncVariant(); renderScale(); renderPreviews();
  }
  $('#ph-kind').addEventListener('change', () => {
    const wall = $('#ph-kind').value === 'wall';
    if (S.category.kind === 'wall' !== wall) applyCategory(wall ? 'other-wall' : 'other-floor', true);
  });
  async function detect() {
    const btn = $('#ph-detect'); btn.disabled = true; btn.textContent = t('photo.looking');
    try {
      const clf = await loadClassifier((p) => { btn.textContent = t('photo.loadingPct', { pct: Math.round(p * 100) }); });
      const labels = await clf.classify(S.result.canvas);
      const id = categoryFromLabels(labels);
      const best = CATEGORY_BY_ID[labels[0].id], what = best ? photoKindName(best).toLowerCase() : labels[0].label, pct = Math.round(labels[0].score * 100);
      $('#ph-detect-note').textContent = id ? t('photo.looksLike', { kind: what, pct }) : t('photo.notSure', { kind: what, pct });
      if (id) applyCategory(id, false);
    } catch (err) { console.warn('classifier failed:', err?.message || err); $('#ph-detect-note').textContent = t('photo.detectUnavailable'); }
    btn.disabled = false; btn.textContent = t('photo.detect');
  }
  function renderScale() {
    // drawn in CSS pixels at the screen's density; a 170 cm person beside the piece at the same scale
    const c = $('#ph-scale'), ctx = c.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth || 550, H = Math.round(W / 2);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!S.result) return;
    const ink = (getComputedStyle(c).color.match(/[\d.]+/g) || [29, 36, 51]).slice(0, 3).join(',');
    const itemH = S.dims.h, itemW = S.dims.w, pad = 18, label = 22;
    const top = S.category?.kind === 'wall' ? Math.max(itemH, (S.category.hang || 1.5) * 100 + itemH / 2) : itemH;
    const pxPerCm = (H - pad - label - 10) / Math.max(PERSON_CM, top);
    const floorY = H - label;
    ctx.strokeStyle = `rgba(${ink},.22)`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, floorY + 0.5); ctx.lineTo(W - pad, floorY + 0.5); ctx.stroke();
    // person
    const ph = PERSON_CM * pxPerCm, px = pad + Math.max(26, ph * 0.12), headR = ph * 0.065;
    ctx.fillStyle = `rgba(${ink},.26)`;
    ctx.beginPath(); ctx.arc(px, floorY - ph + headR, headR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px - ph * 0.085, floorY - ph + headR * 2.2, ph * 0.17, ph * 0.36, headR * 0.6); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px - ph * 0.08, floorY - ph * 0.44, ph * 0.065, ph * 0.44, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px + ph * 0.015, floorY - ph * 0.44, ph * 0.065, ph * 0.44, 4); ctx.fill();
    ctx.fillStyle = `rgba(${ink},.62)`; ctx.font = '600 12px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${PERSON_CM} cm`, px, floorY + 16);
    // the piece, centred in the room that is left
    const iw = itemW * pxPerCm, ih = itemH * pxPerCm, left = px + ph * 0.14 + 16, ix = left + Math.max(0, (W - pad - left - iw) / 2);
    const y = S.category?.kind === 'wall' ? floorY - (S.category.hang || 1.5) * 100 * pxPerCm - ih / 2 : floorY - ih;
    // the photo, or the full model's own picture when that is the chosen version
    const pic = usingModel() && $('#ph-prev-model').complete && $('#ph-prev-model').naturalWidth ? $('#ph-prev-model') : S.result.canvas;
    ctx.drawImage(pic, ix, y, iw, ih);
    ctx.fillText(`${Math.round(itemW)} × ${Math.round(itemH)} cm`, ix + iw / 2, floorY + 16);
  }
  let previewToken = 0;
  async function renderPreviews() {
    const token = ++previewToken;
    const photoImg = $('#ph-prev-photo'), matchImg = $('#ph-prev-3d'), modelImg = $('#ph-prev-model');
    photoImg.removeAttribute('src'); matchImg.removeAttribute('src'); modelImg.removeAttribute('src');
    thumbs.forget('preview'); thumbs.forget('preview-model'); // the piece changes with every size, kind or depth; never show a stale picture
    if (S.model) makeCustomDef({ ...recFor('preview-model', null), model: S.model }, DEFS).then((d) => thumbs.thumbnail(d)).then((u) => { if (token === previewToken && u) modelImg.src = u; });
    $('#ph-match-note').textContent = S.match ? t('photo.match', { piece: pieceName(DEFS[S.match.base]), material: materialName(S.match.finish.mat).toLowerCase(), colour: S.match.finish.color }) : t('photo.noMatch');
    const def = await tempDef();
    if (token !== previewToken) return;
    thumbs.thumbnail(def).then((u) => { if (token === previewToken && u) photoImg.src = u; });
    if (S.match) thumbs.thumbnail({ ...DEFS[S.match.base], id: 'preview-' + S.match.base }, S.match.finish).then((u) => { if (token === previewToken && u) matchImg.src = u; });
  }
  async function tempDef() {
    const rec = recFor('preview', await canvasToBlob(S.result.canvas));
    delete rec.model; // the photo card shows the photo version
    return makeCustomDef(rec, DEFS);
  }
  function recFor(id, blob) {
    const wall = $('#ph-kind').value === 'wall';
    const cm = (v) => Math.max(0.02, v / 100);
    const size = wall ? [cm(S.dims.w), cm(S.dims.h), cm(S.dims.d)] : [cm(S.dims.w), cm(S.dims.d), cm(S.dims.h)];
    const rec = { id, name: $('#ph-name').value.trim() || (S.category ? photoKindName(S.category) : '') || t('photo.myItem'), kind: wall ? 'wall' : 'floor', size, blob, category: S.category?.id, finishMat: S.category ? guessMaterial(S.category, S.result.colors[0]?.rgb || [128, 128, 128]) : 'fabric', hang: S.category?.hang, created: Date.now() };
    if (S.depth) rec.depth = S.depth;
    if (S.variant === 'model' && S.model) rec.model = S.model;
    if (S.variant === '3d' && S.match) rec.match = S.match;
    return rec;
  }
  function syncVariant() {
    for (const b of document.querySelectorAll('#ph-variant [data-variant]')) b.classList.toggle('on', b.dataset.variant === S.variant);
    $('#ph-dims').classList.toggle('dim', S.variant === '3d');
    $('#ph-depth-note').hidden = S.variant !== 'photo'; $('#ph-match-note').hidden = S.variant !== '3d'; $('#ph-model-note').hidden = (S.variant !== 'model' && !S.modelBusy) || !$('#ph-model-note').textContent;
  }

  // ---- steps -----------------------------------------------------------------------------
  function show(step) {
    S.step = step;
    for (const s of dlg.querySelectorAll('[data-step]')) s.hidden = parseInt(s.dataset.step, 10) !== step;
    for (const t of dlg.querySelectorAll('.steps b')) t.classList.toggle('on', parseInt(t.dataset.step, 10) <= step);
    if (step === 2) { if (!S.src) { prepareSource(); } syncTools(); $('#ph-tol-row').hidden = S.mode !== 'quick'; renderCutout(); }
    if (step === 3) {
      if (!S.category) { const id = S.warnings && S.result ? guessByShape(S.result.canvas.width / S.result.canvas.height) : 'other-floor'; applyCategory(id, false); }
      else applyCategory(S.category.id, false);
      if (!$('#ph-name').value) $('#ph-name').value = S.name || '';
      $('#ph-detect-note').textContent = t('photo.shapeGuess', { kind: photoKindName(S.category).toLowerCase(), size: CLASSIFIER.size });
      ensureDepth();
      if (S.model && S.modelFor !== depthSig()) { S.model = null; S.modelProps = null; resetModelCard(); $('#ph-model-note').textContent = ''; if (S.variant === 'model') S.variant = 'photo'; syncVariant(); }
      modelServiceAvailable().then((ok) => { modelCard.hidden = !ok; });
    }
  }
  $('#ph-next1').onclick = () => show(2);
  $('#ph-back2').onclick = () => show(1);
  $('#ph-next2').onclick = () => show(3);
  $('#ph-back3').onclick = () => show(2);
  $('#ph-cancel').onclick = () => dlg.close();
  $('#ph-save').onclick = async () => {
    if (!S.result) return;
    const btn = $('#ph-save');
    if (S.depthPromise) { btn.disabled = true; btn.textContent = t('photo.finishing'); await S.depthPromise.catch(() => {}); btn.disabled = false; btn.textContent = t('photo.save'); }
    const rec = recFor(newCustomId(), await canvasToBlob(S.result.canvas));
    await customStore.put(rec);
    const def = await makeCustomDef(rec, DEFS);
    DEFS[def.id] = def;
    dlg.close();
    onAdded(def);
    toast(t('photo.added', { name: rec.name }));
  };

  return {
    open() {
      S = Object.assign(st, reset(), { aiAlpha: null, aiAngle: null, src: null, warnings: null, name: '' });
      dlg.classList.remove('has-photo'); $('#ph-file').value = ''; $('#ph-name').value = ''; $('#ph-warnings').replaceChildren(); $('#ph-next1').disabled = true;
      $('#ph-angle').value = 0; $('#ph-angle-v').textContent = `${num(0, 1)}°`; $('#ph-tol').value = 40; $('#ph-keep').checked = false; $('#ph-lock').checked = true; $('#ph-ai-note').textContent = '';
      $('#ph-depth-note').textContent = ''; $('#ph-model-note').textContent = ''; resetModelCard(); $('#ph-save').disabled = false; $('#ph-save').textContent = t('photo.save');
      for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.classList.toggle('on', b.dataset.mode === 'quick');
      localise(); show(1); dlg.showModal();
    },
    state,
  };
}
