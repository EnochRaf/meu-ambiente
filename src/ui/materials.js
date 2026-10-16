// The Materials drawer: one place to choose what things are made of. It works on
// what is selected (a piece, the floor or a wall); with nothing selected it
// offers the floor or all the walls. Every choice is a rendered swatch with a name.
import { el } from './dom.js';
import { t } from '../i18n/index.js';
import { pieceName, secondLabel, materialName, groupName, finishName, finishTip, surfaceName } from '../i18n/names.js';
import { activeRoom } from '../state.js';
import { GROUP_BY_MAT, FAMILIES, swatchUrl, namedFinish, secondFinishes } from '../finishes.js';
import { itemFinish } from '../catalog.js';

export function materialsDrawer(ctx) {
  const { store, interaction } = ctx;
  let idle = 'floor';          // what to show with nothing selected: 'floor' or 'walls'
  const family = {};           // remembered family per target

  function targetOf(project) {
    const room = activeRoom(project), sel = interaction.selection;
    if (sel?.kind === 'item') {
      const item = room.items.find((i) => i.id === sel.id), def = item && ctx.defs[item.type];
      if (def) return { key: 'item:' + def.id, kind: 'item', name: pieceName(def), finish: itemFinish(item, def), item, def };
    }
    if (sel?.kind === 'surface') return { key: sel.key === 'floor' ? 'floor' : 'wall', kind: sel.key === 'floor' ? 'floor' : 'wall', surface: sel.key, name: surfaceName(sel.key), finish: room.finishes[sel.key] };
    if (idle === 'walls') return { key: 'wall', kind: 'walls', name: t('materials.walls'), finish: room.finishes.N };
    return { key: 'floor', kind: 'floor', name: surfaceName('floor'), finish: room.finishes.floor };
  }
  function apply(tg, f, opts) {
    store.update((p) => {
      const r = activeRoom(p);
      if (tg.kind === 'item') { const it = r.items.find((i) => i.id === tg.item.id); if (it) it.finish = { mat: f.mat, color: f.color }; }
      else if (tg.kind === 'walls') for (const k of ['N', 'S', 'W', 'E']) r.finishes[k] = { mat: f.mat, color: f.color };
      else r.finishes[tg.surface || 'floor'] = { mat: f.mat, color: f.color };
    }, opts);
  }
  const setFrame = (tg, color, opts) => store.update((p) => { const it = activeRoom(p).items.find((i) => i.id === tg.item.id); if (it) it.frame = color.toLowerCase(); }, opts);

  function swatch(f, on, onPick) {
    return el('button', { class: 'pick mini' + (on ? ' on' : ''), 'data-finish': `${f.mat}-${f.id}`, tip: [finishName(f), finishTip(f)], onclick: onPick },
      el('img', { class: 'pic', src: swatchUrl(f), alt: '', loading: 'lazy' }), el('b', {}, finishName(f)));
  }
  function custom(color, onPick, label = t('materials.yourColour')) {
    return el('label', { class: 'pick mini custom-color', tip: [label, t('materials.yourColour.tip')] },
      el('span', { class: 'pic', style: 'display:block' }), el('b', {}, label),
      el('input', { type: 'color', value: color, 'aria-label': label, oninput: (e) => onPick(e.target.value) }));
  }

  return {
    id: 'materials',
    render(project) {
      const tg = targetOf(project), cur = tg.finish;
      const families = tg.kind === 'item' ? [...new Set([cur.mat, ...FAMILIES.item])] : FAMILIES[tg.kind === 'walls' ? 'wall' : tg.kind];
      const fam = families.includes(family[tg.key]) ? family[tg.key] : families.includes(cur.mat) ? cur.mat : families[0];
      const group = GROUP_BY_MAT[fam] || { id: fam, mat: fam, items: [] };
      const named = namedFinish(cur.mat, cur.color);
      const out = [
        el('div', { class: 'eyebrow' }, t('nav.materials')),
        el('h1', { class: 'd-title' }, tg.name),
        el('div', { class: 'd-sub', id: 'material-now' }, named ? `${finishName(named)} · ${groupName(named.mat)}` : t('materials.ownColour', { material: materialName(cur.mat) })),
      ];
      if (tg.kind === 'floor' || tg.kind === 'walls') {
        out.push(el('div', { class: 'seg', style: 'margin-top:12px', id: 'material-target' },
          el('button', { class: tg.kind === 'floor' ? 'on' : '', onclick: () => { idle = 'floor'; ctx.rerender(); } }, surfaceName('floor')),
          el('button', { class: tg.kind === 'walls' ? 'on' : '', onclick: () => { idle = 'walls'; ctx.rerender(); } }, t('materials.allWalls'))),
        el('p', { class: 'hint' }, t('materials.pickInRoom')));
      }
      out.push(
        el('div', { class: 'chips', role: 'tablist', id: 'material-families' }, ...families.map((mt) => el('button', { class: 'chip' + (mt === fam ? ' on' : ''), role: 'tab', 'aria-selected': mt === fam, 'data-mat': mt,
          onclick: () => { family[tg.key] = mt; ctx.rerender(); } }, groupName(mt)))),
        el('div', { class: 'grid3', id: 'swatches' },
          ...group.items.map((f) => swatch(f, f.mat === cur.mat && f.color.toLowerCase() === cur.color.toLowerCase(), () => apply(tg, f))),
          custom(cur.mat === fam ? cur.color : (group.items[0]?.color || '#cccccc'), (c) => apply(tg, { mat: fam, color: c }, { coalesce: 'custom-colour' }))));
      if (tg.kind === 'wall') out.push(el('div', { class: 'btn-row' }, el('button', { class: 'btn small', onclick: () => store.update((p) => { const r = activeRoom(p); for (const k of ['N', 'S', 'W', 'E']) r.finishes[k] = { ...cur }; }) }, t('materials.useOnAllWalls'))));
      if (tg.kind === 'item' && tg.def.frameable) {
        const fr = cur.frame || '';
        const list = secondFinishes(tg.def.frameKind), named2 = list.find((f) => f.color.toLowerCase() === fr.toLowerCase());
        out.push(el('h2', { class: 'd-h' }, secondLabel(tg.def), named2 ? el('span', { class: 'muted' }, finishName(named2)) : null),
          el('div', { class: 'grid4', id: 'frame-swatches' }, ...list.map((f) => swatch(f, f.color.toLowerCase() === fr.toLowerCase(), () => setFrame(tg, f.color))),
            custom(fr || '#6f5039', (c) => setFrame(tg, c, { coalesce: 'custom-frame' }), t('materials.other'))));
      }
      if (tg.kind === 'item' && (tg.item.finish || tg.item.frame)) out.push(el('div', { class: 'btn-row' }, el('button', { class: 'btn small', onclick: () => store.update((p) => { const it = activeRoom(p).items.find((i) => i.id === tg.item.id); if (it) { delete it.finish; delete it.frame; } }) }, t('materials.reset'))));
      return out;
    },
  };
}
