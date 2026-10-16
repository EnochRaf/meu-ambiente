// Meu Ambiente's interface ("side drawer"): a slim rail with one labelled place
// for each task (rooms, furniture, materials, atmosphere), one drawer open at a
// time beside the room, a small toolbar next to whatever is selected, and short
// descriptions on hover or long-press. The room stays the hero.
import { $, el, toast, setupTips } from './ui/dom.js';
import { roomsDrawer } from './ui/rooms.js';
import { furnitureDrawer } from './ui/furniture.js';
import { materialsDrawer } from './ui/materials.js';
import { atmosphereDrawer } from './ui/atmosphere.js';
import { settingsDrawer } from './ui/settings.js';
import { setupGallery } from './ui/gallery.js';
import { activeRoom } from './state.js';
import { DEFS } from './catalog.js';
import { setupPhotoDialog } from './photoDialog.js';
import { createThumbnailer } from './thumbs.js';
import { themeMode, resolvedTheme, setThemeMode, onTheme } from './ui/theme.js';
import { t, lang, setLang, onLang, translatePage, LANGUAGES } from './i18n/index.js';
import { pieceName, surfaceName, openingName } from './i18n/names.js';

export { toast };
const DRAWER_KEY = 'roomsmith:drawer'; // internal storage key, kept from before the rename
const TOUR = ['tasks', 'furniture', 'change', 'look']; // tour.<id>.title / tour.<id>.text

export function setupUI({ store, scene, interaction, onShare, onSaveImage, customDefs }) {
  const tips = setupTips();
  const thumbs = createThumbnailer({ width: 300, height: 225 });
  const gallery = setupGallery({ store, scene, toast });
  const body = $('#drawer-body'), rail = $('#rail'), drawerEl = $('#drawer');
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(DRAWER_KEY)) || {}; } catch {}
  let current = saved.current || 'rooms', isOpen = saved.open ?? true, hidden = !!saved.hidden, lastSig = '', lastDrawer = '', pending = false;

  const ctx = {
    store, scene, interaction, thumbs, customDefs, toast, defs: DEFS,
    rerender: () => renderDrawer(true),
    openGallery: (mode, pre) => gallery.open(mode, pre), openSaveTemplate: () => gallery.openSave(),
    openPhotoDialog: () => photoDialog.open(), startTour: () => startTour(),
    isOpen: (id) => isOpen && current === id,
  };
  const drawers = { rooms: roomsDrawer(ctx), furniture: furnitureDrawer(ctx), materials: materialsDrawer(ctx), atmosphere: atmosphereDrawer(ctx), settings: settingsDrawer(ctx) };
  // what each drawer depends on: it is rebuilt only when this changes
  const sigs = {
    rooms: (p) => { const r = activeRoom(p); return [p.rooms.map((x) => [x.id, x.name]), p.activeRoomId, r.width, r.length, r.height, r.type, r.style, r.openings, r.balcony, r.name]; },
    furniture: (p) => [activeRoom(p).type, customDefs.length],
    materials: (p) => { const r = activeRoom(p), s = interaction.selection, it = s?.kind === 'item' ? r.items.find((i) => i.id === s.id) : null; return [s, r.finishes, it?.finish, it?.frame]; },
    atmosphere: (p) => [p.atmosphere, p.time, p.lamps, activeRoom(p).view, activeRoom(p).id],
    settings: () => [scene.quality, scene.idleMotion, themeMode()],
  };

  // ---- rail and drawer ------------------------------------------------------------------
  // remembered for next time: which task, whether its panel is open, whether everything is hidden
  function persist() { try { localStorage.setItem(DRAWER_KEY, JSON.stringify({ current, open: isOpen, hidden })); } catch {} }
  function syncInsets() {
    const narrow = innerWidth <= 760, railW = rail.getBoundingClientRect().width;
    if (hidden) { scene.setInsets({ left: 0, right: 0, top: 0, bottom: 0 }); return; }
    scene.setInsets({ left: railW + (isOpen && !narrow ? drawerEl.getBoundingClientRect().width : 0), right: 0, top: 64, bottom: 0 });
  }
  function openDrawer(id) {
    if (id && drawers[id]) current = id;
    isOpen = true; hidden = false; persist(); showDrawer();
  }
  // everything but the room hidden (full view), or back
  function setHidden(v) { hidden = v; persist(); showDrawer(); if (v) toast(t('fullView.toast')); }
  const toggleDrawer = () => (hidden ? setHidden(false) : isOpen ? closeDrawer() : openDrawer());
  function closeDrawer() { isOpen = false; persist(); showDrawer(); }
  function showDrawer() {
    document.body.classList.toggle('drawer-open', isOpen);
    document.body.classList.toggle('ui-hidden', hidden);
    for (const b of rail.querySelectorAll('.rail-btn[data-drawer]')) { const on = isOpen && b.dataset.drawer === current; b.classList.toggle('on', on); b.setAttribute('aria-expanded', on); }
    $('#pb-color').classList.toggle('on', isOpen && current === 'materials');
    renderDrawer(true); syncInsets(); tips.hide(); onSelection();
  }
  for (const b of rail.querySelectorAll('.rail-btn[data-drawer]')) b.onclick = () => (isOpen && current === b.dataset.drawer ? closeDrawer() : openDrawer(b.dataset.drawer));
  $('#drawer-close').onclick = closeDrawer;
  $('#full-view').onclick = () => setHidden(true);
  $('#show-ui').onclick = () => setHidden(false);
  const railTips = () => { for (const b of rail.querySelectorAll('.rail-btn[data-drawer]')) { b.dataset.tip = t(`nav.${b.dataset.drawer}`); b.dataset.tipSub = t('nav.tip'); } };
  railTips();
  drawerEl.addEventListener('transitionend', syncInsets);
  addEventListener('resize', syncInsets);

  function renderDrawer(force = false) {
    if (!isOpen) return;
    const project = store.get(), d = drawers[current];
    const sig = JSON.stringify([current, sigs[current](project)]);
    if (!force && sig === lastSig) return;
    // never rebuild under a slider, colour picker or text field that is in use
    const a = document.activeElement;
    if (!force && a && body.contains(a) && a.matches('input, select, textarea')) { pending = true; return; }
    const focusId = a && body.contains(a) ? a.id : null, caret = focusId && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null;
    const scroll = current === lastDrawer ? body.scrollTop : 0;
    body.replaceChildren(...d.render(project).filter(Boolean));
    body.scrollTop = scroll; lastSig = sig; lastDrawer = current;
    if (focusId) { const n = document.getElementById(focusId); if (n) { n.focus(); if (caret && n.setSelectionRange) try { n.setSelectionRange(...caret); } catch {} } }
  }
  const flush = () => { if (pending) { pending = false; setTimeout(() => renderDrawer()); } };
  body.addEventListener('focusout', flush); body.addEventListener('change', flush);

  // ---- actions ------------------------------------------------------------------------------
  $('#undo').onclick = () => interaction.undo();
  $('#redo').onclick = () => interaction.redo();
  $('#share').onclick = onShare;
  $('#save-image').onclick = onSaveImage;
  $('#reset-view').onclick = () => scene.resetView();
  // light or dark at a click (Settings also offers Automatic)
  const themeBtn = $('#theme-toggle');
  function themeTip() {
    const dark = resolvedTheme() === 'dark', mode = themeMode();
    themeBtn.dataset.tip = t(dark ? 'theme.toLight' : 'theme.toDark');
    themeBtn.dataset.tipSub = t('theme.now', { mode: t(`theme.${mode}`) + (mode === 'auto' ? t('theme.now.auto') : '') });
    themeBtn.setAttribute('aria-label', themeBtn.dataset.tip);
  }
  themeBtn.onclick = () => { setThemeMode(resolvedTheme() === 'dark' ? 'light' : 'dark'); toast(t(resolvedTheme() === 'dark' ? 'theme.darkOn' : 'theme.lightOn')); };
  onTheme(() => { themeTip(); if (isOpen && current === 'settings') renderDrawer(true); });
  themeTip();
  // PT/EN at a click (Settings has the full list); every text follows at once
  const langBtn = $('#lang-toggle');
  function langTip() {
    const next = LANGUAGES[(LANGUAGES.findIndex((l) => l.id === lang()) + 1) % LANGUAGES.length];
    langBtn.querySelector('span').textContent = LANGUAGES.find((l) => l.id === lang()).short;
    langBtn.dataset.tip = t('lang.switchTo', { language: next.name }); langBtn.dataset.tipSub = t('lang.more');
    langBtn.setAttribute('aria-label', langBtn.dataset.tip);
  }
  langBtn.onclick = () => { const i = LANGUAGES.findIndex((l) => l.id === lang()); setLang(LANGUAGES[(i + 1) % LANGUAGES.length].id); toast(t('lang.changed')); };
  onLang(() => { translatePage(); railTips(); themeTip(); langTip(); renderDrawer(true); onSelection(); renderTour(); });
  translatePage(); langTip();
  $('#help').onclick = () => startTour();
  // [ opens or collapses the panel, \ hides everything but the room, Esc brings it back
  addEventListener('keydown', (e) => {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]');
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === '[') { e.preventDefault(); toggleDrawer(); return; }
      if (e.key === '\\') { e.preventDefault(); setHidden(!hidden); return; }
    }
    if (e.key === 'Escape' && hidden && !typing) { setHidden(false); return; }
    if (e.key !== 'Escape' || document.querySelector('dialog[open]') || interaction.selection || !isOpen) return;
    if (document.activeElement && body.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
    closeDrawer();
  });

  // ---- the selected piece: a small toolbar beside it -------------------------------------------
  const bar = $('#piece-bar'), measure = $('#measure');
  $('#pb-rot').onclick = (e) => interaction.rotateSelected(e.shiftKey ? -1 : 1);
  $('#pb-dup').onclick = () => interaction.duplicateSelected();
  $('#pb-color').onclick = () => (isOpen && current === 'materials' ? closeDrawer() : openDrawer('materials'));
  $('#pb-edit').onclick = () => { drawers.rooms.openAdvanced(); openDrawer('rooms'); setTimeout(() => $('#room-advanced')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80); };
  $('#pb-delete').onclick = () => interaction.deleteSelected();
  function selectionInfo() {
    const sel = interaction.selection, room = activeRoom(store.get());
    if (!sel) return null;
    if (sel.kind === 'surface') return { name: surfaceName(sel.key), color: true };
    if (sel.kind === 'opening') { const o = room.openings.find((x) => x.id === sel.id); return o ? { name: openingName(o.type), edit: true, del: true } : null; }
    const item = room.items.find((i) => i.id === sel.id), def = item && DEFS[item.type];
    return def ? { name: pieceName(def), def, rotate: def.kind !== 'wall', dup: true, color: true, del: true } : null;
  }
  // on a phone the open drawer covers the room, so the toolbar waits until it closes
  const covered = () => hidden || (isOpen && innerWidth <= 760);
  function onSelection() {
    const info = selectionInfo();
    bar.classList.toggle('on', !!info && !covered());
    if (info) {
      $('#pb-name').textContent = info.name;
      $('#pb-rot').hidden = !info.rotate; $('#pb-dup').hidden = !info.dup; $('#pb-color').hidden = !info.color; $('#pb-edit').hidden = !info.edit; $('#pb-delete').hidden = !info.del;
      follow();
    }
    if (isOpen && current === 'materials') renderDrawer();
  }
  // keep the toolbar beside the selection as the view moves
  function follow() {
    const sel = interaction.selection;
    if (sel && bar.classList.contains('on') && !interaction.busy) {
      const info = selectionInfo(), a = info && scene.anchorFor({ ...sel, def: info.def });
      if (a && !a.behind) {
        const left = rail.getBoundingClientRect().width + (isOpen && innerWidth > 760 ? drawerEl.getBoundingClientRect().width : 0);
        const w = bar.offsetWidth, x = Math.min(Math.max(a.x - w / 2, left + 12), innerWidth - w - 12), y = Math.max(a.y - 70, 76);
        bar.style.transform = `translate(${x}px, ${y}px)`;
      }
    } else if (interaction.busy) bar.classList.remove('on');
  }
  scene.onFrame(follow);
  function onMeasure(text, at) {
    if (!text || !at) { measure.classList.remove('on'); return; }
    measure.textContent = text; measure.classList.add('on');
    measure.style.transform = `translate(${at.x}px, ${at.y}px) translate(-50%, -100%)`;
  }

  // ---- tour ---------------------------------------------------------------------------------
  let tourStep = -1;
  function renderTour() {
    const box = $('#tour');
    if (tourStep < 0 || tourStep >= TOUR.length) { box.classList.remove('on'); return; }
    const id = TOUR[tourStep];
    $('#tour-step').textContent = t('tour.step', { n: tourStep + 1, of: TOUR.length });
    $('#tour-title').textContent = t(`tour.${id}.title`); $('#tour-body').textContent = t(`tour.${id}.text`);
    $('#tour-next').textContent = t(tourStep === TOUR.length - 1 ? 'tour.done' : 'tour.next');
    box.classList.add('on');
  }
  function startTour() { tourStep = 0; renderTour(); }
  function endTour() { tourStep = -1; renderTour(); try { localStorage.setItem('roomsmith:tour', '1'); } catch {} }
  $('#tour-skip').onclick = endTour;
  $('#tour-next').onclick = () => { tourStep++; if (tourStep >= TOUR.length) endTour(); else renderTour(); };
  let seen = false; try { seen = localStorage.getItem('roomsmith:tour') === '1'; } catch {}
  if (!seen) setTimeout(startTour, 900);

  // ---- photo dialog ----------------------------------------------------------------------------
  const photoDialog = setupPhotoDialog({ thumbs, toast, onAdded: (def) => { customDefs.push(def); drawers.furniture.showMine(); openDrawer('furniture'); } });

  // ---- render on every change -------------------------------------------------------------------
  function render(project) {
    $('#undo').disabled = !store.canUndo(); $('#redo').disabled = !store.canRedo();
    renderDrawer();
    onSelection();
  }
  store.subscribe(render);
  showDrawer();
  render(store.get());
  return {
    photoDialog, onSelection, onMeasure,
    onDragState: (busy) => { document.body.classList.toggle('busy', busy); if (busy) { bar.classList.remove('on'); tips.hide(); } },
    openDrawer, closeDrawer, setHidden, toggleDrawer, get drawer() { return isOpen && !hidden ? current : null; }, get hidden() { return hidden; },
  };
}
