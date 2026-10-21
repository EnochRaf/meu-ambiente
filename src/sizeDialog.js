// Size of one of the person's own items (a photo or a full 3D model), changed
// after it is in the room: width, depth and height in cm, with the proportions
// kept unless unlocked. The stored item is updated and every placed copy follows.
import { t } from './i18n/index.js';
import { customStore, makeCustomDef } from './customItems.js';
import { $ } from './ui/dom.js';

export function setupSizeDialog({ store, customDefs, defs, thumbs, toast }) {
  const dlg = $('#size-modal');
  let def = null, dims = null, base = null; // dims: { w, d, h } in cm; base: the proportions to keep
  const inputs = { w: $('#sz-w'), d: $('#sz-d'), h: $('#sz-h') };
  const read = (d) => (d.kind === 'wall' ? { w: d.size[0], d: d.size[2], h: d.size[1] } : { w: d.size[0], d: d.size[1], h: d.size[2] });
  const show = () => { for (const k of ['w', 'd', 'h']) inputs[k].value = Math.round(dims[k]); };
  for (const k of ['w', 'd', 'h']) inputs[k].addEventListener('input', () => {
    const v = parseFloat(inputs[k].value); if (!(v > 0)) return;
    if ($('#sz-lock').checked) { const f = v / base[k]; dims = { w: base.w * f, d: base.d * f, h: base.h * f }; show(); inputs[k].value = Math.round(v); }
    else dims[k] = v;
  });
  $('#sz-cancel').onclick = () => dlg.close();
  $('#sz-ok').onclick = async () => {
    if (!def) return;
    const cm = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v))) / 100;
    const w = cm(dims.w, 2, 1000), d = cm(dims.d, 1, 1000), h = cm(dims.h, 2, 600);
    const size = def.kind === 'wall' ? [w, h, d] : [w, d, h];
    const rec = (await customStore.all()).find((r) => r.id === def.id);
    if (!rec) { dlg.close(); return; }
    rec.size = size;
    await customStore.put(rec);
    const next = await makeCustomDef(rec, defs);
    defs[next.id] = next;
    const i = customDefs.indexOf(def); if (i >= 0) customDefs[i] = next;
    thumbs.forget(next.id);
    store.update(() => {}); // the room redraws; the scene rebuilds copies whose size changed
    dlg.close();
    toast(t('size.applied', { w: Math.round(w * 100), d: Math.round(d * 100), h: Math.round(h * 100) }));
  };
  return {
    open(d) {
      def = d; dims = read(d); base = { ...dims };
      $('#size-sub').textContent = d.kind === 'wall' ? t('size.subWall') : t('size.subFloor');
      $('#sz-d-label').textContent = t(d.kind === 'wall' ? 'dim.depthWallCm' : 'dim.depthCm');
      $('#sz-lock').checked = true; show();
      dlg.showModal(); inputs.w.focus(); inputs.w.select();
    },
  };
}
