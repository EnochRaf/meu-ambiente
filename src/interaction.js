// Pointer and keyboard behaviour: drag pieces and openings, resize walls with
// grips, select, rotate, duplicate, delete, undo/redo. Talks to the store and
// the scene; the UI listens through callbacks.
import { t, m, num } from './i18n/index.js';
import { pieceName, openingName } from './i18n/names.js';
import { ROT_STEP, findFloorSpot, findWallSpot, isOutsideRoom, findOpeningSpot, resizeRoom, wallLength } from './placement.js';
import { activeRoom, uid } from './state.js';
import { onBalcony, toLocal, toWorld, balconyFrame, findBalconySpot, roomItems } from './balcony.js';

const normRot = (r) => { r = ((r + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return Math.abs(r) < 1e-9 ? 0 : r; };
export const OPENING_DEFS = {
  door: { type: 'door', name: 'Door', width: 0.9, bottom: 0, height: 2.1 },
  window: { type: 'window', name: 'Window', width: 1.2, bottom: 0.9, height: 1.2 },
};

export function setupInteraction({ store, scene, defs, toast, onSelectionChange, onMeasure, onDragState }) {
  const canvas = scene.canvas;
  let drag = null;      // item drag: { source, def, item, origId, grab, ok, over, outside, pointerId }
  let openDrag = null;  // opening drag: { def, origId, wall, offset, ok, pointerId }
  let gripDrag = null;  // wall resize: { wall, base, next, pointerId }
  let pressed = null;   // pointerdown on the canvas, before a drag starts
  let selection = null; // { kind: 'item', id } | { kind: 'surface', key } | { kind: 'opening', id }

  const room = () => activeRoom(store.get());
  const isEditable = (el) => el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
  const dragState = () => onDragState?.(!!(drag || openDrag || gripDrag));

  function select(sel) {
    if (sel?.kind === 'item') {
      const it = room().items.find((i) => i.id === sel.id);
      if (!it) sel = null; else scene.setSelected({ kind: 'item', id: it.id, item: it, def: defs[it.type] });
    }
    if (sel?.kind === 'opening') {
      if (!room().openings.some((o) => o.id === sel.id)) sel = null; else scene.setSelected({ kind: 'opening', id: sel.id });
    }
    if (sel?.kind === 'surface') scene.setSelected({ kind: 'surface', key: sel.key });
    if (!sel) scene.setSelected(null);
    selection = sel;
    onSelectionChange(sel);
  }
  store.subscribe(() => { if (selection) select(selection); });

  // ---- item drag ------------------------------------------------------------------
  function startDrag(d) {
    drag = { ok: false, over: false, outside: false, grab: { dx: 0, dz: 0, du: 0, dy: 0 }, ...d };
    scene.controls.enabled = false;
    document.body.classList.add('dragging');
    select(null); dragState();
  }
  function updateDrag(clientX, clientY) {
    const d = drag; if (!d) return;
    d.over = document.elementFromPoint(clientX, clientY) === canvas;
    if (!d.over) { d.ok = false; scene.setPreview(null); onMeasure(null); return; }
    const r = room(), def = d.def, item = d.item;
    if (def.kind === 'wall') {
      const hit = scene.raycastWalls(clientX, clientY);
      if (!hit) { d.ok = false; scene.setPreview(null); onMeasure(null); return; }
      const spot = findWallSpot(r, defs, r.items, def, hit.wall, hit.u + d.grab.du, hit.y + d.grab.dy, d.origId);
      Object.assign(item, { wall: hit.wall, u: spot.u, y: spot.y });
      d.ok = spot.ok; d.outside = false;
      scene.setPreview(item, def, d.ok);
      onMeasure(t('measure.up', { h: m(spot.y, 2) }), scene.toScreen(...wallPoint(r, hit.wall, spot.u, spot.y + def.size[1] / 2 + 0.15)));
      return;
    }
    const p = scene.raycastFloor(clientX, clientY);
    if (!p) { d.ok = false; scene.setPreview(null); onMeasure(null); return; }
    const px = p.x + d.grab.dx, pz = p.z + d.grab.dz;
    d.worldRot ??= item.zone === 'balcony' && r.balcony ? (item.rot || 0) + balconyFrame(r, r.balcony).theta : item.rot || 0;
    const balc = r.balcony;
    const onB = balc && onBalcony(r, r.balcony, px, pz, 0.35);
    d.outside = d.source === 'scene' && !onB && isOutsideRoom(r, px, pz, 0.5) && !(balc && onBalcony(r, r.balcony, px, pz, 0.9));
    let spot;
    if (onB) {
      const th = balconyFrame(r, r.balcony).theta, l = toLocal(r, r.balcony, px, pz);
      item.zone = 'balcony'; item.rot = d.worldRot - th;
      spot = findBalconySpot(r, defs, def, l.x, l.z, item.rot, d.origId);
      item.x = spot.x; item.z = spot.z;
    } else {
      delete item.zone; item.rot = d.worldRot;
      spot = findFloorSpot(r, defs, roomItems(r), def, px, pz, item.rot, d.origId);
      item.x = d.outside ? px : spot.x; item.z = d.outside ? pz : spot.z;
    }
    d.ok = spot.ok && !d.outside;
    scene.setPreview(item, def, d.ok, d.outside);
    const w = scene.worldOf(item);
    onMeasure(d.outside ? t('measure.release') : !d.ok ? t('measure.noRoom') : onB ? t('measure.onBalcony') : `${num(item.x, 2)} × ${num(item.z, 2)} m`, scene.toScreen(w.x, def.size[2] + 0.2, w.z));
  }
  function endDrag(cancel = false) {
    const d = drag; if (!d) return;
    drag = null; dragState();
    scene.setPreview(null); onMeasure(null);
    scene.controls.enabled = true;
    document.body.classList.remove('dragging');
    if (d.origId) scene.setItemHidden(d.origId, false);
    if (cancel) return;
    if (d.source === 'scene' && d.outside) {
      store.update((p) => { const r = activeRoom(p); r.items = r.items.filter((i) => i.id !== d.origId); });
      toast(t('toast.removed', { name: pieceName(d.def) })); return;
    }
    if (d.over && d.ok) {
      store.update((p) => { const r = activeRoom(p); const it = { ...d.item }; if (!it.zone) delete it.zone; if (d.origId) { const k = r.items.findIndex((i) => i.id === d.origId); if (k >= 0) r.items[k] = it; } else r.items.push(it); });
      select({ kind: 'item', id: d.item.id });
      if (!d.origId) toast(t('toast.added', { name: pieceName(d.def) }));
      return;
    }
    if (d.origId) select({ kind: 'item', id: d.origId });
    if (d.source === 'catalog' && d.over) toast(t('toast.noRoomThere'));
    if (d.source === 'scene' && d.over && !d.ok) toast(t('toast.stayedPut'));
  }
  function wallPoint(r, wall, u, y) {
    switch (wall) { case 'N': return [u, y, 0]; case 'S': return [u, y, r.length]; case 'W': return [0, y, u]; default: return [r.width, y, u]; }
  }

  // ---- opening drag (new from the dock, or an existing one sliding) ----------------
  function startOpeningDrag(d) {
    openDrag = { ok: false, wall: null, offset: 0, ...d };
    scene.controls.enabled = false; document.body.classList.add('dragging'); select(null); dragState();
  }
  function updateOpeningDrag(clientX, clientY) {
    const d = openDrag; if (!d) return;
    const r = room();
    const hit = document.elementFromPoint(clientX, clientY) === canvas ? scene.raycastWalls(clientX, clientY) : null;
    if (!hit || (d.origId && hit.wall !== d.origWall)) { d.ok = false; d.wall = null; scene.previewOpening(null); onMeasure(null); return; }
    const spot = findOpeningSpot(r, hit.wall, hit.u, d.def.width, d.origId);
    d.wall = hit.wall; d.offset = spot.offset; d.ok = spot.ok;
    scene.previewOpening(hit.wall, spot.offset, d.def, spot.ok);
    const fromLeft = spot.offset - d.def.width / 2, fromRight = wallLength(r, hit.wall) - spot.offset - d.def.width / 2;
    const text = spot.ok ? t('measure.fromCorner', { d: m(Math.min(fromLeft, fromRight), 2) }) : t('measure.noRoomWall');
    onMeasure(text, scene.toScreen(...wallPoint(r, hit.wall, spot.offset, d.def.bottom + d.def.height + 0.2)));
  }
  function endOpeningDrag(cancel = false) {
    const d = openDrag; if (!d) return;
    openDrag = null; dragState();
    scene.previewOpening(null); onMeasure(null);
    scene.controls.enabled = true; document.body.classList.remove('dragging');
    if (cancel || !d.wall) { if (d.origId) select({ kind: 'opening', id: d.origId }); return; }
    if (!d.ok) { toast(t('toast.noRoomWall')); if (d.origId) select({ kind: 'opening', id: d.origId }); return; }
    if (d.origId) {
      store.update((p) => { const o = activeRoom(p).openings.find((x) => x.id === d.origId); if (o) { o.wall = d.wall; o.offset = d.offset; } });
      select({ kind: 'opening', id: d.origId });
    } else {
      const o = { id: uid(), wall: d.wall, type: d.def.type, offset: d.offset, width: d.def.width, bottom: d.def.bottom, height: d.def.height };
      store.update((p) => { const r = activeRoom(p); o.height = Math.min(o.height, r.height - o.bottom - 0.05); r.openings.push(o); });
      select({ kind: 'opening', id: o.id });
      toast(t('toast.added', { name: openingName(d.def.type) }));
    }
  }
  function beginOpeningDrag(type, e) {
    if (drag || openDrag || gripDrag) return;
    startOpeningDrag({ def: OPENING_DEFS[type], origId: null, pointerId: e.pointerId });
  }

  // ---- wall grips -------------------------------------------------------------------
  let gripFrame = 0;
  function updateGrip(clientX, clientY) {
    const g = gripDrag; if (!g) return;
    const p = scene.raycastFloor(clientX, clientY); if (!p) return;
    const b = g.base;
    const size = g.wall === 'E' ? p.x : g.wall === 'W' ? b.width - p.x : g.wall === 'S' ? p.z : b.length - p.z;
    const next = resizeRoom(b, g.wall, size);
    if (g.next && next.width === g.next.width && next.length === g.next.length) return;
    g.next = next;
    cancelAnimationFrame(gripFrame);
    gripFrame = requestAnimationFrame(() => {
      const dx = (g.wall === 'W') ? next.width - b.width - (g.shift?.dx || 0) : 0;
      const dz = (g.wall === 'N') ? next.length - b.length - (g.shift?.dz || 0) : 0;
      if (dx || dz) { scene.shiftView(dx, dz); g.shift = { dx: (g.shift?.dx || 0) + dx, dz: (g.shift?.dz || 0) + dz }; }
      scene.setRoom({ ...next, id: b.id }, defs);
      const across = g.wall === 'E' || g.wall === 'W';
      const label = m(across ? next.width : next.length, 2);
      const pt = g.wall === 'E' ? [next.width, 0.4, next.length / 2] : g.wall === 'W' ? [0, 0.4, next.length / 2] : g.wall === 'S' ? [next.width / 2, 0.4, next.length] : [next.width / 2, 0.4, 0];
      onMeasure(label, scene.toScreen(...pt));
    });
  }
  function endGrip(cancel = false) {
    const g = gripDrag; if (!g) return;
    gripDrag = null; dragState(); cancelAnimationFrame(gripFrame);
    scene.controls.enabled = true; document.body.classList.remove('dragging'); onMeasure(null); scene.setGripHover(null);
    if (cancel || !g.next) { scene.setRoom(room(), defs); return; }
    const n = g.next;
    store.update((p) => { const r = activeRoom(p); Object.assign(r, { width: n.width, length: n.length, items: n.items, openings: n.openings }); });
  }

  function rotateItem(item, def, dir) {
    if (def.kind === 'wall') return false;
    const r = room();
    const rot = normRot(item.rot + dir * ROT_STEP);
    const spot = item.zone === 'balcony' ? findBalconySpot(r, defs, def, item.x, item.z, rot, item.id) : findFloorSpot(r, defs, roomItems(r), def, item.x, item.z, rot, item.id, 1.0);
    if (!spot.ok) return false;
    Object.assign(item, { rot, x: spot.x, z: spot.z });
    return true;
  }

  function beginCatalogDrag(def, e) {
    if (drag || openDrag || gripDrag) return;
    const item = def.kind === 'wall' ? { id: uid(), type: def.id, wall: 'N', u: 0, y: def.hang || 1.5 } : { id: uid(), type: def.id, x: 0, z: 0, rot: 0 };
    startDrag({ source: 'catalog', def, item, origId: null, pointerId: e.pointerId });
  }

  // ---- canvas pointer handling ------------------------------------------------
  canvas.addEventListener('pointerdown', (e) => {
    if (drag || openDrag || gripDrag || e.button !== 0 || e.shiftKey) return;
    const hit = scene.pick(e.clientX, e.clientY);
    pressed = { hit, x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    if (hit?.kind === 'grip') {
      pressed = null;
      gripDrag = { wall: hit.wall, base: structuredClone(room()), next: null, pointerId: e.pointerId };
      scene.controls.enabled = false; document.body.classList.add('dragging'); select(null); dragState();
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    if (hit?.kind === 'item' || hit?.kind === 'opening') { scene.controls.enabled = false; try { canvas.setPointerCapture(e.pointerId); } catch {} }
  }, { capture: true });

  let hoverAt = 0, hoverGrip = null;
  window.addEventListener('pointermove', (e) => {
    if (gripDrag) { if (e.pointerId === gripDrag.pointerId) updateGrip(e.clientX, e.clientY); return; }
    if (openDrag) { if (e.pointerId === openDrag.pointerId) updateOpeningDrag(e.clientX, e.clientY); return; }
    if (drag) { if (e.pointerId === drag.pointerId) updateDrag(e.clientX, e.clientY); return; }
    if (!pressed) {
      if (e.target === canvas && performance.now() - hoverAt > 40) {
        hoverAt = performance.now();
        const hit = scene.pick(e.clientX, e.clientY);
        const g = hit?.kind === 'grip' ? hit.wall : null;
        if (g !== hoverGrip) { hoverGrip = g; scene.setGripHover(g); }
        canvas.style.cursor = g ? (g === 'N' || g === 'S' ? 'ns-resize' : 'ew-resize') : hit?.kind === 'item' || hit?.kind === 'opening' ? 'grab' : hit ? 'pointer' : '';
      }
      return;
    }
    if (e.pointerId !== pressed.pointerId || Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 5) return;
    const hit = pressed.hit;
    if (hit?.kind === 'opening') {
      const o = room().openings.find((x) => x.id === hit.id); pressed = null; if (!o) return;
      startOpeningDrag({ def: { ...OPENING_DEFS[o.type], width: o.width, bottom: o.bottom, height: o.height }, origId: o.id, origWall: o.wall, pointerId: e.pointerId });
      updateOpeningDrag(e.clientX, e.clientY); return;
    }
    if (hit?.kind !== 'item') return;
    const orig = room().items.find((i) => i.id === hit.id);
    const def = orig && defs[orig.type];
    if (!def) { pressed = null; return; }
    const grab = { dx: 0, dz: 0, du: 0, dy: 0 };
    if (def.kind === 'wall') {
      const h = scene.raycastWalls(pressed.x, pressed.y);
      if (h && h.wall === orig.wall) { grab.du = orig.u - h.u; grab.dy = orig.y - h.y; }
    } else {
      const p = scene.raycastFloor(pressed.x, pressed.y), w = scene.worldOf(orig);
      if (p) { grab.dx = w.x - p.x; grab.dz = w.z - p.z; }
    }
    scene.setItemHidden(orig.id, true);
    startDrag({ source: 'scene', def, item: { ...orig }, origId: orig.id, grab, pointerId: pressed.pointerId });
    pressed = null;
    updateDrag(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', (e) => {
    if (gripDrag) { if (e.pointerId === gripDrag.pointerId) endGrip(); return; }
    if (openDrag) { if (e.pointerId === openDrag.pointerId) endOpeningDrag(); return; }
    if (drag) { if (e.pointerId === drag.pointerId) endDrag(); return; }
    if (!pressed || e.pointerId !== pressed.pointerId) return;
    const moved = Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) >= 5;
    if (!moved) select(pressed.hit);
    pressed = null;
    scene.controls.enabled = true;
  });
  window.addEventListener('pointercancel', () => { endGrip(true); endOpeningDrag(true); endDrag(true); pressed = null; scene.controls.enabled = true; });

  canvas.addEventListener('wheel', (e) => {
    const dir = e.deltaY > 0 ? 1 : -1;
    if (drag) {
      if (drag.def.kind !== 'wall') { drag.worldRot = normRot((drag.worldRot ?? drag.item.rot) + dir * ROT_STEP); updateDrag(e.clientX, e.clientY); }
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    if (selection?.kind === 'item' && scene.pickItem(e.clientX, e.clientY) === selection.id) { rotateSelected(dir); e.preventDefault(); e.stopImmediatePropagation(); }
  }, { capture: true, passive: false });

  // ---- commands --------------------------------------------------------------------
  function rotateSelected(dir) {
    if (selection?.kind !== 'item') return;
    let turned = false;
    store.update((p) => { const it = activeRoom(p).items.find((i) => i.id === selection.id); if (it) turned = rotateItem(it, defs[it.type], dir); });
    if (!turned) toast(t('toast.noTurn'));
  }
  function deleteSelected() {
    if (!selection || selection.kind === 'surface') return;
    const sel = selection; select(null);
    store.update((p) => {
      const r = activeRoom(p);
      if (sel.kind === 'item') r.items = r.items.filter((i) => i.id !== sel.id);
      else r.openings = r.openings.filter((o) => o.id !== sel.id);
    });
    toast(t('toast.removedShort'));
  }
  function duplicateSelected() {
    if (selection?.kind !== 'item') return;
    const r = room(), it = r.items.find((i) => i.id === selection.id), def = it && defs[it.type];
    if (!def) return;
    const copy = { ...it, id: uid() };
    if (def.kind === 'wall') {
      const spot = findWallSpot(r, defs, r.items, def, it.wall, it.u + def.size[0] + 0.15, it.y);
      if (!spot.ok) { toast(t('toast.noRoomBeside')); return; }
      copy.u = spot.u; copy.y = spot.y;
    } else {
      const spot = it.zone === 'balcony' ? findBalconySpot(r, defs, def, it.x + def.size[0] * 0.6, it.z, it.rot) : findFloorSpot(r, defs, roomItems(r), def, it.x + def.size[0] * 0.6, it.z + def.size[1] * 0.6, it.rot);
      if (!spot.ok) { toast(t('toast.noRoomBeside')); return; }
      copy.x = spot.x; copy.z = spot.z;
    }
    store.update((p) => activeRoom(p).items.push(copy));
    select({ kind: 'item', id: copy.id });
    toast(t('toast.duplicated', { name: pieceName(def) }));
  }
  function undo() { cancelAll(); if (store.undo()) toast(t('toast.undone')); }
  function redo() { cancelAll(); if (store.redo()) toast(t('toast.redone')); }
  function cancelAll() { endGrip(true); endOpeningDrag(true); endDrag(true); }

  window.addEventListener('keydown', (e) => {
    if (isEditable(document.activeElement)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) { e.preventDefault(); if (e.key === 'y' || e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (mod || e.altKey) return;
    const k = e.key;
    if (k === 'Escape') { if (drag || openDrag || gripDrag) cancelAll(); else select(null); return; }
    if (k === 'r' || k === ']') { rotateSelected(1); e.preventDefault(); }
    else if (k === 'R' || k === '[') { rotateSelected(-1); e.preventDefault(); }
    else if (k === 'd') { duplicateSelected(); }
    else if (k === 'Delete' || k === 'Backspace') { deleteSelected(); e.preventDefault(); }
  });

  return { beginCatalogDrag, beginOpeningDrag, rotateSelected, deleteSelected, duplicateSelected, select, undo, redo, get selection() { return selection; }, get busy() { return !!(drag || openDrag || gripDrag); } };
}
