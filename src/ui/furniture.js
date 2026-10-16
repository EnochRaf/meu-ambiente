// The Furniture drawer: large rendered previews of the real pieces, with their
// name and size, grouped by kind and searchable. Drag a card into the room.
import { el, icon } from './dom.js';
import { t, num } from '../i18n/index.js';
import { pieceName, pieceTip } from '../i18n/names.js';
import { activeRoom } from '../state.js';
import { CATALOG, DEFS } from '../catalog.js';
import { roomTypeOf } from '../roomTypes.js';
import { customStore } from '../customItems.js';

const TABS = ['suggested', 'seating', 'tables', 'beds', 'storage', 'lights', 'decor', 'kitchen', 'bath', 'balcony', 'mine'];

export function furnitureDrawer(ctx) {
  const { store, thumbs, interaction, customDefs } = ctx;
  let tab = 'suggested', query = '';

  function entries(room) {
    // search in the current language, and in English as well
    if (query) return [...CATALOG, ...customDefs].filter((d) => [pieceName(d), d.name, pieceTip(d)].some((s) => s.toLowerCase().includes(query)));
    if (tab === 'suggested') { const ids = roomTypeOf(room.type).catalog; return ids ? ids.map((id) => DEFS[id]).filter(Boolean) : CATALOG; }
    if (tab === 'mine') return customDefs;
    return CATALOG.filter((d) => d.cat === tab);
  }
  const size = (d) => `${num(d.size[0] * 100, 0)} × ${num(d.size[1] * 100, 0)} cm`;
  function card(def, mine) {
    const img = el('img', { class: 'pic contain', alt: '', draggable: false });
    thumbs.thumbnail(def).then((url) => { if (url) img.src = url; });
    const c = el('div', { class: 'pick drag-card', tabindex: 0, 'data-piece': def.id,
      tip: [`${pieceName(def)} · ${size(def)}`, `${pieceTip(def)} ${t('furniture.dragIn')}`.trim()] },
      img, el('b', {}, pieceName(def)), el('small', {}, size(def)));
    c.addEventListener('pointerdown', (e) => { if (e.button === 0 && !e.target.closest('.x')) { e.preventDefault(); interaction.beginCatalogDrag(def, e); } });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') ctx.toast(t('furniture.dragHint')); });
    if (mine) c.append(el('button', { class: 'x', title: t('furniture.removeMine'), onclick: async (e) => {
      e.stopPropagation();
      if (!confirm(t('furniture.confirmRemoveMine', { name: def.name }))) return;
      await customStore.remove(def.id);
      customDefs.splice(customDefs.indexOf(def), 1); delete DEFS[def.id]; thumbs.forget(def.id);
      store.update((p) => { for (const r of p.rooms) r.items = r.items.filter((i) => i.type !== def.id); });
    } }, icon('close')));
    return c;
  }

  return {
    id: 'furniture',
    render(project) {
      const room = activeRoom(project), list = entries(room);
      const search = el('input', { type: 'search', placeholder: t('furniture.search'), value: query, 'aria-label': t('furniture.searchLabel'), id: 'search',
        oninput: (e) => { query = e.target.value.trim().toLowerCase(); ctx.rerender(); } });
      return [
        el('div', { class: 'eyebrow' }, t('nav.furniture')),
        el('h1', { class: 'd-title' }, t('furniture.title')),
        el('div', { class: 'd-sub' }, t('furniture.sub')),
        el('label', { class: 'search' }, icon('search'), search),
        query ? null : el('div', { class: 'chips', role: 'tablist', id: 'furniture-tabs' }, ...TABS.map((id) => el('button', { class: 'chip' + (id === tab ? ' on' : ''), role: 'tab', 'aria-selected': id === tab, 'data-tab': id, onclick: () => { tab = id; ctx.rerender(); } }, t(`cat.${id}`)))),
        list.length ? el('div', { class: 'grid2', id: 'pieces' }, ...list.map((d) => card(d, customDefs.includes(d))))
          : el('p', { class: 'hint' }, query ? t('furniture.noMatch', { query }) : tab === 'mine' ? t('furniture.noMine') : t('furniture.empty')),
        el('button', { class: 'wide-btn', id: 'add-photo', tip: [t('furniture.fromPhoto.tipTitle'), t('furniture.fromPhoto.tip')], onclick: () => ctx.openPhotoDialog() }, icon('photo'), t('furniture.fromPhoto')),
      ];
    },
    // keep typing in the search field while the list updates
    keepFocus: () => document.activeElement?.id === 'search',
    showMine() { tab = 'mine'; query = ''; },
  };
}
