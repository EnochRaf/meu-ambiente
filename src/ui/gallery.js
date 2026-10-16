// Templates: the gallery for adding a room (from a template or empty) or laying
// out the current one, and the dialog that saves a room as one of my templates.
import { $, el } from './dom.js';
import { t, size2 } from '../i18n/index.js';
const tr = t; // inside functions whose template parameter is called t
import { tplName, tplTip, tplStyle, roomTypeName, roomTypeTip, roomName, defaultNameKey } from '../i18n/names.js';
import { floorPlan } from './pictures.js';
import { activeRoom, defaultRoom, uid } from '../state.js';
import { ROOM_TYPES, ROOM_TYPE_IDS, templateOpenings } from '../roomTypes.js';
import { ATMOSPHERE_BY_ID } from '../atmospheres.js';
import { TEMPLATES, templateRoom, applyTemplateTo, loadMyTemplates, addMyTemplate, removeMyTemplate, roomAsTemplate } from '../templates.js';

// a name no other room has yet (comparing names as they show in this language)
export function uniqueName(project, base) {
  const names = new Set(project.rooms.map((r) => roomName(r.name)));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function setupGallery({ store, scene, toast }) {
  const tplModal = $('#tpl-modal'), thumbBase = new URL('../../assets/templates/', import.meta.url).href;
  let mode = 'new', picked = null;
  const sizeOf = (r) => size2(r.width, r.length);
  // a template's atmosphere comes with it
  const takeLight = (p, t) => { const a = ATMOSPHERE_BY_ID[t.atmosphere]; if (a) { p.atmosphere = a.id; p.time = a.time; p.lamps = a.lamps; } };

  function card(t) {
    const img = t.mine ? (t.thumb ? el('img', { src: t.thumb, alt: '' }) : el('i', { class: 'noimg' })) : el('img', { src: thumbBase + t.id + '.webp', alt: '', loading: 'lazy' });
    const c = el('button', { class: 'tpl-card', 'data-tpl': t.id, tip: [`${tplName(t)} · ${sizeOf(t.room)}`, tplTip(t)], onclick: () => pick(t, c) }, img,
      el('strong', {}, tplName(t)),
      el('span', { class: 'meta' }, `${tplStyle(t)} · ${sizeOf(t.room)}`, ...(t.palette ? [el('span', { class: 'dots', title: tr('gallery.palette') }, ...t.palette.map((col) => el('i', { style: `background:${col}` })))] : [])),
      ...(tplTip(t) ? [el('p', {}, tplTip(t))] : []));
    if (t.mine) c.append(el('span', { class: 'del', role: 'button', title: tr('gallery.deleteMine'), onclick: (e) => {
      e.stopPropagation();
      if (!confirm(tr('gallery.confirmDelete', { name: t.name }))) return;
      removeMyTemplate(t.id); render(); toast(tr('gallery.deleted'));
    } }, '×'));
    return c;
  }
  function render() {
    const mine = loadMyTemplates();
    $('#tpl-gallery').replaceChildren(
      el('div', { class: 'tpl-grid' }, ...TEMPLATES.map(card)),
      el('h4', {}, t('gallery.mine')),
      mine.length ? el('div', { class: 'tpl-grid' }, ...mine.map(card)) : el('p', { class: 'tpl-empty-note' }, t('gallery.mineEmpty')));
  }
  function showTab(tab) {
    for (const b of document.querySelectorAll('#tpl-tabs button')) { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
    $('#tpl-gallery').hidden = tab !== 'templates'; $('#tpl-empty').hidden = tab !== 'empty';
    $('#tpl-sub').textContent = t(tab === 'templates' ? 'gallery.sub' : 'gallery.emptySub');
  }
  for (const b of document.querySelectorAll('#tpl-tabs button')) b.onclick = () => showTab(b.dataset.tab);
  function open(m, preselect = null) {
    mode = m; picked = null; $('#tpl-confirm').hidden = true;
    $('#tpl-title').textContent = t(m === 'new' ? 'rooms.add' : 'gallery.title');
    $('#tpl-tabs').hidden = m !== 'new';
    render(); showTab('templates');
    if (m === 'apply') $('#tpl-sub').textContent = t('gallery.applySub', { name: roomName(activeRoom(store.get()).name) });
    renderTypes();
    tplModal.showModal();
    if (preselect) { const c = document.querySelector(`#tpl-gallery .tpl-card[data-tpl="${preselect}"]`); const t = TEMPLATES.find((x) => x.id === preselect); if (c && t) { pick(t, c); c.scrollIntoView({ block: 'nearest' }); } }
  }
  function pick(t, c) {
    if (mode === 'new') {
      store.update((p) => { const r = templateRoom({ type: t.type, ...t.room }, uid, uniqueName(p, tplName(t))); p.rooms.push(r); p.activeRoomId = r.id; takeLight(p, t); });
      tplModal.close(); toast(tr('gallery.added', { name: tplName(t) })); return;
    }
    picked = t;
    for (const x of document.querySelectorAll('.tpl-card')) x.classList.toggle('picked', x === c);
    $('#tpl-confirm-text').textContent = tr('gallery.confirmApply', { name: roomName(activeRoom(store.get()).name), template: tplName(t) });
    $('#tpl-confirm').hidden = false; $('#tpl-confirm-yes').focus();
  }
  $('#tpl-confirm-no').onclick = () => { picked = null; $('#tpl-confirm').hidden = true; for (const x of document.querySelectorAll('.tpl-card')) x.classList.remove('picked'); };
  $('#tpl-confirm-yes').onclick = () => {
    const t = picked; if (!t) return;
    store.update((p) => {
      const room = activeRoom(p), wasDefault = !!defaultNameKey(room.name);
      applyTemplateTo(room, t, uid, p.rooms.filter((r) => r !== room).map((r) => roomName(r.name)));
      // a default name follows the new type, in the current language
      if (wasDefault) room.name = uniqueName({ rooms: p.rooms.filter((r) => r !== room) }, roomTypeName(room.type));
      takeLight(p, t);
    });
    tplModal.close(); scene.resetView(); toast(tr('gallery.applied', { template: tplName(t) }));
  };
  $('#tpl-close').onclick = () => tplModal.close();
  // starting empty: each kind of room as a small floor plan
  const renderTypes = () => $('#type-cards').replaceChildren(...ROOM_TYPE_IDS.map((id) => {
    const rt = ROOM_TYPES[id];
    return el('button', { class: 'type-card', 'data-type': id, tip: [roomTypeName(id), `${roomTypeTip(id)}. ${size2(rt.size[0], rt.size[1])}.`], onclick: () => {
      store.update((p) => { const r = defaultRoom(id, uniqueName(p, roomTypeName(id))); p.rooms.push(r); p.activeRoomId = r.id; });
      tplModal.close();
    } }, floorPlan(rt.size[0], rt.size[1], templateOpenings(id, () => ''), { fit: [8, 6] }), el('strong', {}, roomTypeName(id)), el('span', {}, roomTypeTip(id)), el('small', {}, size2(rt.size[0], rt.size[1])));
  }));
  renderTypes();

  // save the current room (with a small picture of the current view) as one of my templates
  const saveModal = $('#save-tpl-modal');
  let thumb = null;
  function openSave() {
    const room = activeRoom(store.get());
    thumb = null; $('#save-tpl-thumb').removeAttribute('src');
    try {
      const src = new Image(); src.src = scene.screenshot();
      src.onload = () => { const c = document.createElement('canvas'); c.width = 480; c.height = 320; const g = c.getContext('2d'); const s = Math.max(480 / src.width, 320 / src.height); g.drawImage(src, (480 - src.width * s) / 2, (320 - src.height * s) / 2, src.width * s, src.height * s); thumb = c.toDataURL('image/jpeg', 0.82); $('#save-tpl-thumb').src = thumb; };
    } catch { thumb = null; }
    $('#save-tpl-name').value = roomName(room.name); $('#save-tpl-blurb').value = '';
    saveModal.showModal(); $('#save-tpl-name').select();
  }
  $('#save-tpl-cancel').onclick = () => saveModal.close();
  $('#save-tpl-ok').onclick = () => {
    const name = $('#save-tpl-name').value.trim(); if (!name) { $('#save-tpl-name').focus(); return; }
    const p = store.get();
    const tpl = roomAsTemplate(activeRoom(p), { name, blurb: $('#save-tpl-blurb').value.trim(), atmosphere: p.atmosphere, thumb }, uid);
    if (!addMyTemplate(tpl)) { toast(tr('gallery.saveFull')); return; }
    saveModal.close(); toast(tr('gallery.saved', { name }));
  };
  return { open, openSave };
}
