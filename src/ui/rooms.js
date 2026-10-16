// The Rooms drawer: which room, its size (as small floor plans), templates to
// start from, a whole-room style, and, folded away until needed, its walls,
// doors, windows and balcony.
import { el, icon } from './dom.js';
import { t, tn, m, size2, num as fnum } from '../i18n/index.js';
import { roomTypeName, roomTypeTip, styleName, styleTip, tplName, tplTip, tplStyle, openingName, roomName } from '../i18n/names.js';
import { floorPlan } from './pictures.js';
import { activeRoom, uid } from '../state.js';
import { ROOM_TYPE_IDS, roomTypeOf } from '../roomTypes.js';
import { STYLES, applyStyle } from '../styles.js';
import { DEFS } from '../catalog.js';
import { TEMPLATES } from '../templates.js';
import { resizeRoom, wallLength } from '../placement.js';
import { OPENING_DEFS } from '../interaction.js';
import { defaultBalcony, clampBalcony, withBalconyDoor, starterFurniture, refitBalconyItems, BALCONY_LIMITS } from '../balcony.js';

const SIZES = [['small', 0.78], ['medium', 1], ['large', 1.3]];
const WALLS = ['N', 'S', 'W', 'E'], BALCONY_WALLS = ['N', 'W', 'E', 'S'];
const styleUrl = (id) => new URL(`../../assets/ui/styles/${id}.webp`, import.meta.url).href;
const tplUrl = (id) => new URL(`../../assets/templates/${id}.webp`, import.meta.url).href;

export function roomsDrawer(ctx) {
  const { store, toast } = ctx;
  let advOpen = false, renaming = false;
  const set = (fn, opts) => store.update((p) => fn(activeRoom(p)), opts);

  function scaled(room, f) {
    const rt = roomTypeOf(room.type), w = rt.size[0] * f, l = rt.size[1] * f;
    const ops = room.openings.map((o) => ({ ...o, offset: o.offset * ((o.wall === 'N' || o.wall === 'S') ? w / room.width : l / room.length) }));
    return { w, l, ops };
  }
  function addBalcony(r, wall) {
    r.balcony = clampBalcony(r, defaultBalcony(r, wall));
    const ops = withBalconyDoor(r, r.balcony, uid); if (ops) r.openings = ops;
    r.items.push(...starterFurniture(r, DEFS, uid));
  }
  function changeBalcony(fn, opts) {
    let dropped = [];
    store.update((p) => {
      const r = activeRoom(p); if (!r.balcony) return;
      const prevWall = r.balcony.wall;
      r.balcony = clampBalcony(r, { ...r.balcony, ...fn(r.balcony, r) });
      if (r.balcony.wall !== prevWall) { const ops = withBalconyDoor(r, r.balcony, uid); if (ops) r.openings = ops; }
      const res = refitBalconyItems(r, DEFS); r.items = res.items; dropped = res.dropped;
    }, opts);
    if (dropped.length) toast(tn('balcony.dropped', dropped.length));
  }
  const seg = (opts, on, onPick, id) => el('div', { class: 'seg', id }, ...opts.map(([v, label]) => el('button', { class: v === on ? 'on' : '', 'data-v': v, onclick: () => onPick(v) }, label)));
  const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
  const num = (value, { min, max, step = 0.1, onChange }) => el('input', { type: 'number', value: String(Math.round(value * 100) / 100), min, max, step,
    onchange: (e) => { const v = parseFloat(e.target.value); if (isFinite(v)) onChange(Math.min(max, Math.max(min, v))); } });
  const find = (r, o) => r.openings.find((x) => x.id === o.id);
  function clampOpenings(r) {
    for (const o of r.openings) {
      const len = wallLength(r, o.wall);
      o.width = Math.min(o.width, len); o.offset = Math.min(Math.max(o.offset, o.width / 2), len - o.width / 2);
      o.height = Math.min(o.height, r.height - o.bottom); if (o.type === 'door') o.bottom = 0;
    }
  }

  function advanced(room, project) {
    const b = room.balcony;
    const balcony = [el('div', { class: 'row-between' }, el('span', { class: 'muted' }, b ? size2(b.width, b.depth) : t('balcony.none')),
      el('button', { class: 'link', id: 'balcony-toggle', onclick: () => {
        if (b) { if (!confirm(t('balcony.confirmRemove'))) return; set((r) => { r.balcony = null; r.items = r.items.filter((i) => i.zone !== 'balcony'); }); }
        else store.update((p) => addBalcony(activeRoom(p), 'W'));
      } }, b ? t('action.remove') : t('balcony.add')))];
    if (b) {
      const maxW = Math.min(BALCONY_LIMITS.width[1], wallLength(room, b.wall));
      const slider = (label, key, min, max, val) => el('label', { class: 'field slider' }, el('span', {}, label, el('em', {}, m(val))),
        el('input', { type: 'range', min, max, step: 0.1, value: val, 'data-k': key, oninput: (e) => changeBalcony(() => ({ [key]: parseFloat(e.target.value) }), { coalesce: 'balcony-' + key }) }));
      balcony.push(
        el('div', { class: 'sub' }, t('balcony.onWall')), seg(BALCONY_WALLS.map((w) => [w, t(`wallShort.${w}`)]), b.wall, (w) => changeBalcony((bb, r) => ({ wall: w, offset: wallLength(r, w) / 2 })), 'balcony-wall'),
        slider(t('dim.width'), 'width', BALCONY_LIMITS.width[0], maxW, b.width), slider(t('dim.depth'), 'depth', BALCONY_LIMITS.depth[0], BALCONY_LIMITS.depth[1], b.depth),
        el('div', { class: 'sub' }, t('balcony.railing')), seg(['glass', 'metal', 'concrete'].map((v) => [v, t(`railing.${v}`)]), b.railing, (v) => changeBalcony(() => ({ railing: v })), 'balcony-railing'),
        el('div', { class: 'sub' }, t('balcony.floor')), seg(['wood', 'tiles', 'concrete'].map((v) => [v, t(`balconyFloor.${v}`)]), b.floor, (v) => changeBalcony(() => ({ floor: v })), 'balcony-floor'));
    }
    const openingTile = (o) => {
      const c = el('div', { class: 'pick drag-card', tabindex: 0, tip: [openingName(o.type), t('opening.tip', { width: m(o.width) })] }, el('div', { class: 'opening-icon ' + o.type }), el('b', {}, openingName(o.type)));
      c.addEventListener('pointerdown', (e) => { if (e.button === 0) { e.preventDefault(); ctx.interaction.beginOpeningDrag(o.type, e); } });
      return c;
    };
    const details = el('details', { class: 'adv', id: 'room-advanced', ontoggle: (e) => { advOpen = e.target.open; } },
      el('summary', {}, t('rooms.advanced'), icon('chev')),
      el('h4', {}, t('rooms.sizeAndKind')),
      el('div', { class: 'row3' },
        field(t('dim.widthM'), num(room.width, { min: 1.5, max: 30, onChange: (v) => set((r) => { r.width = v; clampOpenings(r); }) })),
        field(t('dim.lengthM'), num(room.length, { min: 1.5, max: 30, onChange: (v) => set((r) => { r.length = v; clampOpenings(r); }) })),
        field(t('dim.ceilingM'), num(room.height, { min: 2, max: 6, onChange: (v) => set((r) => { r.height = v; clampOpenings(r); }) }))),
      el('div', { class: 'row2' }, field(t('rooms.kind'), el('select', { onchange: (e) => set((r) => { r.type = e.target.value; }) }, ...ROOM_TYPE_IDS.map((id) => el('option', { value: id, selected: id === room.type }, roomTypeName(id)))))),
      el('h4', {}, t('rooms.addOpening')),
      el('div', { class: 'opening-tiles' }, ...Object.values(OPENING_DEFS).map(openingTile)),
      el('h4', {}, t('rooms.openings')),
      ...(room.openings.length ? room.openings.map((o) => el('div', { class: 'opening' },
        el('div', { class: 'opening-head' },
          el('select', { 'aria-label': t('rooms.wall'), onchange: (e) => set((r) => { find(r, o).wall = e.target.value; clampOpenings(r); }) }, ...WALLS.map((k) => el('option', { value: k, selected: k === o.wall }, t(`surface.${k}`)))),
          el('span', { class: 'tag' }, openingName(o.type)),
          el('button', { class: 'icon-btn', title: t('action.remove'), onclick: () => set((r) => { r.openings = r.openings.filter((x) => x.id !== o.id); }) }, icon('close'))),
        el('div', { class: o.type === 'window' ? 'row4' : 'row2' },
          field(t('dim.position'), num(o.offset, { min: 0, max: 30, onChange: (v) => set((r) => { find(r, o).offset = v; clampOpenings(r); }) })),
          field(t('dim.width'), num(o.width, { min: 0.3, max: 10, onChange: (v) => set((r) => { find(r, o).width = v; clampOpenings(r); }) })),
          ...(o.type === 'window' ? [
            field(t('dim.sill'), num(o.bottom, { min: 0, max: 5, onChange: (v) => set((r) => { find(r, o).bottom = v; clampOpenings(r); }) })),
            field(t('dim.height'), num(o.height, { min: 0.2, max: 6, onChange: (v) => set((r) => { find(r, o).height = v; clampOpenings(r); }) }))] : []))))
        : [el('p', { class: 'hint' }, t('rooms.noOpenings'))]),
      el('h4', {}, t('balcony.title')), el('div', { id: 'balcony-controls' }, ...balcony),
      el('div', { class: 'btn-row' }, el('button', { class: 'btn small danger', id: 'delete-room', disabled: project.rooms.length === 1, onclick: () => {
        if (project.rooms.length === 1 || !confirm(t('rooms.confirmDelete', { name: roomName(room.name) }))) return;
        store.update((p) => { p.rooms = p.rooms.filter((x) => x.id !== room.id); p.activeRoomId = p.rooms[0].id; });
      } }, icon('trash'), t('rooms.delete'))));
    details.open = advOpen;
    return details;
  }

  function title(room) {
    if (renaming) {
      const input = el('input', { value: roomName(room.name), maxlength: 40, 'aria-label': t('rooms.name'),
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { renaming = false; ctx.rerender(); } },
        onblur: (e) => { renaming = false; const v = e.target.value.trim(); if (v && v !== roomName(room.name)) set((r) => { r.name = v; }); else ctx.rerender(); } });
      setTimeout(() => { input.focus(); input.select(); });
      return el('h1', { class: 'd-title' }, input);
    }
    return el('h1', { class: 'd-title' }, el('button', { tip: [t('rooms.rename'), t('rooms.rename.tip')], onclick: () => { renaming = true; ctx.rerender(); } }, roomName(room.name)));
  }

  return {
    id: 'rooms',
    render(project) {
      const room = activeRoom(project), rt = roomTypeOf(room.type);
      const style = STYLES.find((st) => st.id === room.style);
      const sizes = SIZES.map(([id, f]) => {
        const { w, l, ops } = scaled(room, f), on = Math.abs(room.width - w) < 0.051 && Math.abs(room.length - l) < 0.051;
        return el('button', { class: 'pick' + (on ? ' on' : ''), 'data-size': id, tip: [t(`size.${id}.of`, { room: roomTypeName(room.type).toLowerCase() }), t('size.tip', { size: size2(w, l), area: fnum(w * l, 0) })],
          onclick: () => set((r) => { let next = resizeRoom(r, 'E', w); next = resizeRoom(next, 'S', l); Object.assign(r, { width: next.width, length: next.length, items: next.items, openings: next.openings }); }) },
          floorPlan(w, l, ops, { fit: [rt.size[0] * 1.3, rt.size[1] * 1.3] }), el('b', { style: 'text-align:center' }, t(`size.${id}`)), el('small', { style: 'text-align:center' }, size2(w, l)));
      });
      // templates: this kind of room first
      const tpls = [...TEMPLATES].sort((a, b) => (b.type === room.type) - (a.type === room.type)).slice(0, 4);
      return [
        el('div', { class: 'eyebrow' }, t('rooms.eyebrow')),
        title(room),
        el('div', { class: 'd-sub' }, [style && styleName(style), roomTypeName(room.type), size2(room.width, room.length), t('rooms.ceiling', { h: m(room.height) })].filter(Boolean).join(' · ')),
        el('div', { class: 'rooms-row', role: 'tablist', 'aria-label': t('rooms.yours') },
          ...(project.rooms.length > 1 ? project.rooms.map((r) => el('button', { class: 'room-chip' + (r.id === room.id ? ' on' : ''), role: 'tab', 'aria-selected': r.id === room.id, tip: [roomName(r.name), `${roomTypeName(r.type)} · ${size2(r.width, r.length)}`], onclick: () => store.update((p) => { p.activeRoomId = r.id; }, { undoable: false }) }, roomName(r.name))) : []),
          el('button', { class: 'room-chip add', id: 'add-room', tip: [t('rooms.add'), t('rooms.add.tip')], onclick: () => ctx.openGallery('new') }, icon('plus'), t('rooms.add'))),
        el('h2', { class: 'd-h' }, t('rooms.size'), el('button', { class: 'link', onclick: () => { advOpen = true; ctx.rerender(); document.querySelector('#room-advanced input')?.focus(); } }, t('rooms.customSize'))),
        el('div', { class: 'grid3', id: 'sizes' }, ...sizes),
        el('h2', { class: 'd-h' }, t('rooms.startTemplate'), el('button', { class: 'link', id: 'open-templates', onclick: () => ctx.openGallery('apply') }, t('rooms.seeAll', { n: TEMPLATES.length }))),
        el('div', { class: 'grid2' }, ...tpls.map((tp) => el('button', { class: 'pick', 'data-tpl': tp.id, tip: [`${tplName(tp)} · ${size2(tp.room.width, tp.room.length)}`, tplTip(tp)], onclick: () => ctx.openGallery('apply', tp.id) },
          el('img', { class: 'pic', src: tplUrl(tp.id), alt: '', loading: 'lazy' }), el('b', {}, tplName(tp)), el('small', {}, tplStyle(tp))))),
        el('button', { class: 'wide-btn', id: 'save-template', tip: [t('rooms.saveTemplate'), t('rooms.saveTemplate.tip')], onclick: () => ctx.openSaveTemplate() }, icon('save'), t('rooms.saveTemplate')),
        el('h2', { class: 'd-h' }, t('rooms.style')),
        el('div', { class: 'grid3', id: 'styles' }, ...STYLES.map((st) => el('button', { class: 'pick mini' + (room.style === st.id ? ' on' : ''), 'data-style': st.id, tip: [styleName(st), styleTip(st)],
          onclick: () => { store.update((p) => applyStyle(activeRoom(p), st, DEFS)); toast(t('rooms.styleApplied', { style: styleName(st) })); } },
          el('img', { class: 'pic', src: styleUrl(st.id), alt: '', loading: 'lazy', style: 'aspect-ratio:4/3' }), el('b', {}, styleName(st))))),
        advanced(room, project),
      ];
    },
    openAdvanced() { advOpen = true; },
  };
}
