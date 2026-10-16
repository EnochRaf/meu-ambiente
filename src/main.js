import { createStore, loadLocal, saveLocal, defaultProject, activeRoom, encodeShare, decodeShare, shareUrl, readShareHash } from './state.js';
import { DEFS } from './catalog.js';
import { createScene } from './scene.js';
import { preloadTextures } from './materials.js';
import { setupInteraction } from './interaction.js';
import { setupUI, toast } from './ui.js';
import { t } from './i18n/index.js';
import { roomName } from './i18n/names.js';
import { customStore, makeCustomDef } from './customItems.js';

async function boot() {
  let project = loadLocal() || defaultProject();
  const code = readShareHash();
  if (code) {
    try {
      const shared = await decodeShare(code);
      if (shared) { project = shared; setTimeout(() => toast(t('toast.linkLoaded')), 300); }
    } catch (err) { console.warn('Could not read the shared layout', err); setTimeout(() => toast(t('toast.linkBad')), 300); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  const customDefs = [];
  try {
    for (const rec of await customStore.all()) { const def = await makeCustomDef(rec, DEFS); customDefs.push(def); DEFS[def.id] = def; }
  } catch (err) { console.warn('Could not load custom items', err); }

  await preloadTextures();
  const store = createStore(project);
  const scene = createScene(document.querySelector('#viewport'));
  let ui;
  const interaction = setupInteraction({
    store, scene, defs: DEFS, toast,
    onSelectionChange: () => ui?.onSelection(),
    onMeasure: (t, at) => ui?.onMeasure(t, at),
    onDragState: (b) => ui?.onDragState(b),
  });
  ui = setupUI({
    store, scene, interaction, customDefs,
    onShare: async () => {
      const url = shareUrl(await encodeShare(store.get()));
      try { await navigator.clipboard.writeText(url); toast(t('toast.linkCopied')); }
      catch { prompt(t('toast.copyLink'), url); }
    },
    onSaveImage: () => {
      const a = document.createElement('a');
      a.href = scene.screenshot();
      a.download = `${roomName(activeRoom(store.get()).name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w-]+/g, '-').toLowerCase() || 'room'}.png`;
      a.click();
      toast(t('toast.imageSaved'));
    },
  });

  let saveTimer = 0;
  const sync = (p) => {
    scene.setLight({ time: p.time, atmosphere: p.atmosphere, lamps: p.lamps });
    scene.setRoom(activeRoom(p), DEFS);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveLocal(p), 150);
  };
  store.subscribe(sync);
  sync(store.get());
  window.__roomsmith = { store, scene, interaction, encodeShare, customDefs, ui, DEFS, custom: { customStore, makeCustomDef } };
  document.querySelector('#loading').classList.add('gone');
}

boot().catch((err) => {
  console.error(err);
  const box = document.querySelector('#loading');
  box.textContent = t('app.startFailed', { error: err?.message || err });
  box.classList.add('error');
});
