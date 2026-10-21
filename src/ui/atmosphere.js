// The Atmosphere drawer: your own room shown in each atmosphere (small renders
// of the current view), then fine-tuning with daylight and lamps, and the view
// through the windows.
import { el } from './dom.js';
import { viewPicture } from './pictures.js';
import { t } from '../i18n/index.js';
import { atmoName, atmoTip, viewName, viewTip } from '../i18n/names.js';
import { activeRoom } from '../state.js';
import { ATMOSPHERES, ATMOSPHERE_BY_ID, lampLevelFor } from '../atmospheres.js';
import { VIEW_IDS } from '../views.js';
import { report } from '../report.js';

const TIME_WORDS = [[0.5, 'morning'], [1.5, 'midday'], [2.35, 'evening'], [9, 'night']];
const lampWord = (v) => t(`lamps.${v < 0.04 ? 'off' : v < 0.35 ? 'dim' : v < 0.75 ? 'soft' : v < 1.15 ? 'warm' : 'bright'}`);

export function atmosphereDrawer(ctx) {
  const { store, scene } = ctx;
  let pics = {}, picSig = '', timer = 0;

  // renders the previews a moment after the room settles, only while the drawer shows them
  function sigOf(project) {
    const room = activeRoom(project), c = scene.camera.position;
    return JSON.stringify([room.id, room.width, room.length, room.height, room.finishes, room.items.map((i) => [i.type, i.x, i.z, i.rot, i.u, i.y, i.finish, i.frame]), room.view, room.openings.length, c.x.toFixed(1), c.y.toFixed(1), c.z.toFixed(1)]);
  }
  function schedule(project) {
    const sig = sigOf(project);
    if (sig === picSig) return;
    clearTimeout(timer);
    timer = setTimeout(function attempt() {
      if (!ctx.isOpen('atmosphere')) return;
      if (!scene.idle && !scene.converged) { timer = setTimeout(attempt, 400); return; }
      let urls = [];
      try { urls = scene.previews(ATMOSPHERES.map((a) => ({ time: a.time, atmosphere: a.id, lamps: a.lamps })), { width: 300, height: 210 }); }
      catch (err) { report('atmosphere previews', err); }
      pics = Object.fromEntries(ATMOSPHERES.map((a, i) => [a.id, urls[i] || '']));
      picSig = sigOf(store.get());
      // a picture that could not be drawn leaves the card with its colours, never a broken image
      for (const a of ATMOSPHERES) { const img = document.querySelector(`#atmo-picks [data-atmo="${a.id}"] img`); if (img && pics[a.id]) { img.src = pics[a.id]; img.style.background = ''; } }
    }, 700);
  }

  return {
    id: 'atmosphere',
    render(project) {
      const room = activeRoom(project), atmo = ATMOSPHERE_BY_ID[project.atmosphere];
      const level = lampLevelFor(project.time, project.atmosphere, project.lamps);
      const timeWord = t(`time.${TIME_WORDS.find(([at]) => project.time <= at)[1]}`);
      schedule(project);
      const card = (a) => el('button', { class: 'pick' + (a.id === project.atmosphere ? ' on' : ''), 'data-atmo': a.id, role: 'radio', 'aria-checked': a.id === project.atmosphere, tip: [atmoName(a), atmoTip(a)],
        onclick: () => store.update((p) => { p.atmosphere = a.id; p.time = a.time; p.lamps = a.lamps; }) },
        el('img', { class: 'pic', alt: '', src: pics[a.id] || undefined, style: pics[a.id] ? '' : `background:linear-gradient(160deg, ${a.palette.top}, ${a.palette.bottom})` }),
        el('b', {}, atmoName(a)), el('small', {}, atmoTip(a)));
      return [
        el('div', { class: 'eyebrow' }, t('nav.atmosphere')),
        el('h1', { class: 'd-title' }, t('atmo.title')),
        el('div', { class: 'd-sub' }, atmo ? `${atmoName(atmo)}: ${atmoTip(atmo).toLowerCase()}` : t('atmo.sub')),
        el('div', { class: 'grid2', id: 'atmo-picks', role: 'radiogroup', 'aria-label': t('nav.atmosphere'), style: 'margin-top:14px' }, ...ATMOSPHERES.map(card)),
        el('h2', { class: 'd-h' }, t('atmo.fineTune')),
        el('div', { class: 'slider-row' },
          el('div', { class: 'lbl' }, t('atmo.daylight'), el('em', {}, timeWord)),
          el('input', { type: 'range', id: 'time', min: 0, max: 3, step: 0.01, value: project.time, 'aria-label': t('atmo.timeOfDay'),
            oninput: (e) => store.update((p) => { p.time = parseFloat(e.target.value); p.lamps = null; }, { coalesce: 'time' }) }),
          el('div', { class: 'slider-ends' }, el('span', {}, t('time.morning')), el('span', {}, t('time.night')))),
        el('div', { class: 'slider-row lamps', style: 'margin-top:12px' },
          el('div', { class: 'lbl' }, t('atmo.lamps'), el('em', {}, project.lamps == null ? t('lamps.auto', { level: lampWord(level) }) : lampWord(project.lamps)),
            project.lamps == null ? null : el('button', { class: 'link', id: 'lamp-auto', onclick: () => store.update((p) => { p.lamps = null; }) }, t('lamps.follow'))),
          el('input', { type: 'range', id: 'lamps', min: 0, max: 1.5, step: 0.01, value: project.lamps ?? level, 'aria-label': t('atmo.lampBrightness'),
            oninput: (e) => store.update((p) => { p.lamps = parseFloat(e.target.value); }, { coalesce: 'lamps' }) }),
          el('div', { class: 'slider-ends' }, el('span', {}, t('lamps.off')), el('span', {}, t('lamps.bright')))),
        el('h2', { class: 'd-h' }, t('atmo.view')),
        el('div', { class: 'grid4', id: 'views' }, ...VIEW_IDS.map((id) => el('button', { class: 'pick mini' + ((room.view || 'garden') === id ? ' on' : ''), 'data-view': id, tip: [viewName(id), viewTip(id)],
          onclick: () => store.update((p) => { activeRoom(p).view = id; }) },
          el('img', { class: 'pic', src: viewPicture(id, project.time), alt: '' }), el('b', {}, viewName(id))))),
      ];
    },
    // sliders keep their place while dragging
    live: true,
  };
}
