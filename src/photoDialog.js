// "From photo" dialog: photo in, cutout and touch-up, size and kind, preview,
// then a catalog item out. Three steps in one glass dialog.
import { t, num } from './i18n/index.js';
import { pieceName, materialName, photoKindName } from './i18n/names.js';
import { DEFS } from './catalog.js';
import { loadPhoto, analyzePhoto, quickMask, alphaToMask, rotateCanvas, finishCutout, canvasToBlob, makeCustomDef, customStore, newCustomId } from './customItems.js';
import { loadSegmenter, aiModelInfo, webgpuUsable } from './segment.js';
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
      result: null, category: null, lockRatio: true, dims: { w: 80, d: 40, h: 80 }, variant: 'photo', match: null, ai: null, busy: false };
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
    const thumb = $('#ph-thumb'); const c = S.photo.canvas, s = Math.min(240 / c.width, 240 / c.height, 1);
    thumb.width = Math.round(c.width * s); thumb.height = Math.round(c.height * s); thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
    dlg.classList.add('has-photo');
    $('#ph-next1').disabled = false;
    S.angle = 0; S.crop = null; S.base = null; S.edits = null; S.result = null; S.category = null; S.match = null;
    S.aiAlpha = null; S.aiAngle = null; S.src = null; S.mode = 'quick';
    for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.classList.toggle('on', b.dataset.mode === 'quick');
    $('#ph-ai-note').textContent = '';
  }

  // ---- step 2: cutout ---------------------------------------------------------------
  const pv = $('#ph-canvas'), pctx = pv.getContext('2d');
  let view = { scale: 1, ox: 0, oy: 0 };
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
      pctx.save(); pctx.setLineDash([6, 4]); pctx.strokeStyle = '#1fa98a'; pctx.lineWidth = 2;
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
    const x = (p.x - view.ox) / view.scale, y = (p.y - view.oy) / view.scale, r = S.brush / 2 / view.scale, v = S.tool === 'erase' ? 1 : 2;
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
  $('#ph-cat').addEventListener('change', () => applyCategory($('#ph-cat').value, true));
  $('#ph-detect').onclick = detect;
  for (const id of ['w', 'd', 'h']) $(`#ph-${id}`).addEventListener('input', (e) => { S.dims[id] = parseFloat(e.target.value) || S.dims[id]; if (S.lockRatio && id !== 'd') syncRatio(id); renderScale(); });
  $('#ph-lock').addEventListener('change', (e) => { S.lockRatio = e.target.checked; if (S.lockRatio) syncRatio('w'); renderScale(); });
  for (const b of document.querySelectorAll('#ph-variant [data-variant]')) b.onclick = () => { S.variant = b.dataset.variant; syncVariant(); };
  const aspect = () => S.result ? S.result.canvas.height / S.result.canvas.width : 1;
  function syncRatio(from) {
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
    const c = $('#ph-scale'), ctx = c.getContext('2d'), W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    if (!S.result) return;
    const itemH = S.dims.h, itemW = S.dims.w;
    const pxPerCm = (H - 30) / Math.max(PERSON_CM, itemH) ;
    const floorY = H - 14;
    ctx.strokeStyle = 'rgba(29,36,51,.25)'; ctx.beginPath(); ctx.moveTo(10, floorY + 0.5); ctx.lineTo(W - 10, floorY + 0.5); ctx.stroke();
    // person
    const ph = PERSON_CM * pxPerCm, px = 46, headR = ph * 0.065;
    ctx.fillStyle = 'rgba(29,36,51,.28)';
    ctx.beginPath(); ctx.arc(px, floorY - ph + headR, headR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px - ph * 0.085, floorY - ph + headR * 2.2, ph * 0.17, ph * 0.36, headR * 0.6); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px - ph * 0.08, floorY - ph * 0.44, ph * 0.065, ph * 0.44, 4); ctx.fill();
    ctx.beginPath(); ctx.roundRect(px + ph * 0.015, floorY - ph * 0.44, ph * 0.065, ph * 0.44, 4); ctx.fill();
    ctx.fillStyle = 'rgba(29,36,51,.6)'; ctx.font = '600 10px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${PERSON_CM} cm`, px, floorY + 11);
    // item
    const iw = itemW * pxPerCm, ih = itemH * pxPerCm, ix = 100 + Math.max(0, (W - 110 - iw) / 2);
    const y = S.category?.kind === 'wall' ? floorY - (S.category.hang || 1.5) * 100 * pxPerCm - ih / 2 : floorY - ih;
    ctx.drawImage(S.result.canvas, ix, y, iw, ih);
    ctx.fillText(`${Math.round(itemW)} × ${Math.round(itemH)} cm`, ix + iw / 2, floorY + 11);
  }
  let previewToken = 0;
  async function renderPreviews() {
    const token = ++previewToken;
    const photoImg = $('#ph-prev-photo'), matchImg = $('#ph-prev-3d');
    photoImg.removeAttribute('src'); matchImg.removeAttribute('src');
    $('#ph-match-note').textContent = S.match ? t('photo.match', { piece: pieceName(DEFS[S.match.base]), material: materialName(S.match.finish.mat).toLowerCase(), colour: S.match.finish.color }) : t('photo.noMatch');
    const def = await tempDef();
    if (token !== previewToken) return;
    thumbs.thumbnail(def).then((u) => { if (token === previewToken && u) photoImg.src = u; });
    if (S.match) thumbs.thumbnail({ ...DEFS[S.match.base], id: 'preview-' + S.match.base }, S.match.finish).then((u) => { if (token === previewToken && u) matchImg.src = u; });
  }
  async function tempDef() {
    const rec = recFor('preview', await canvasToBlob(S.result.canvas));
    return makeCustomDef(rec, DEFS);
  }
  function recFor(id, blob) {
    const wall = $('#ph-kind').value === 'wall';
    const cm = (v) => Math.max(0.02, v / 100);
    const size = wall ? [cm(S.dims.w), cm(S.dims.h), cm(S.dims.d)] : [cm(S.dims.w), cm(S.dims.d), cm(S.dims.h)];
    const rec = { id, name: $('#ph-name').value.trim() || (S.category ? photoKindName(S.category) : '') || t('photo.myItem'), kind: wall ? 'wall' : 'floor', size, blob, category: S.category?.id, finishMat: S.category ? guessMaterial(S.category, S.result.colors[0]?.rgb || [128, 128, 128]) : 'fabric', hang: S.category?.hang, created: Date.now() };
    if (S.variant === '3d' && S.match) rec.match = S.match;
    return rec;
  }
  function syncVariant() {
    for (const b of document.querySelectorAll('#ph-variant [data-variant]')) b.classList.toggle('on', b.dataset.variant === S.variant);
    $('#ph-dims').classList.toggle('dim', S.variant === '3d');
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
    }
  }
  $('#ph-next1').onclick = () => show(2);
  $('#ph-back2').onclick = () => show(1);
  $('#ph-next2').onclick = () => show(3);
  $('#ph-back3').onclick = () => show(2);
  $('#ph-cancel').onclick = () => dlg.close();
  $('#ph-save').onclick = async () => {
    if (!S.result) return;
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
      for (const b of document.querySelectorAll('#ph-mode [data-mode]')) b.classList.toggle('on', b.dataset.mode === 'quick');
      localise(); show(1); dlg.showModal();
    },
    state,
  };
}
