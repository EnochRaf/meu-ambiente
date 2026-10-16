// Names and descriptions of things (furniture, finishes, templates, rooms…) in
// the current language. The data keeps stable ids; the words live in the
// translation files. Things people named themselves keep their own names.
import { t, tx, allTexts } from './index.js';

const own = (def) => def?.custom || String(def?.id || '').startsWith('c_');
export const pieceName = (def) => (own(def) ? def.name : tx(`piece.${def.id}`, def.name));
export const pieceTip = (def) => (own(def) ? t('piece.mine.tip') : tx(`piece.${def.id}.tip`, ''));
export const secondLabel = (def) => tx(`piece.${def.id}.second`, def.frameLabel || t('materials.legs'));
export const materialName = (id) => tx(`material.${id}`, id);
export const groupName = (id) => tx(`group.${id}`, materialName(id));
export const finishName = (f) => tx(`finish.${f.mat}.${f.id}`, f.name);
export const finishTip = (f) => tx(`finish.${f.mat}.${f.id}.tip`, f.tip || '');
export const styleName = (s) => tx(`style.${s.id}`, s.name);
export const styleTip = (s) => tx(`style.${s.id}.tip`, s.blurb || '');
export const atmoName = (a) => tx(`atmo.${a.id}`, a.name);
export const atmoTip = (a) => tx(`atmo.${a.id}.tip`, a.caption || '');
export const roomTypeName = (id) => tx(`roomType.${id}`, id);
export const roomTypeTip = (id) => tx(`roomType.${id}.tip`, '');
export const tplName = (tp) => (tp.mine ? tp.name : tx(`template.${tp.id}`, tp.name));
export const tplTip = (tp) => (tp.mine ? tp.blurb || t('gallery.mineTip') : tx(`template.${tp.id}.tip`, tp.blurb || ''));
export const tplStyle = (tp) => (tp.mine ? roomTypeName(tp.type) : tx(`template.${tp.id}.style`, tp.style || ''));
export const viewName = (id) => tx(`view.${id}`, id);
export const viewTip = (id) => tx(`view.${id}.tip`, '');
export const qualityName = (id) => tx(`quality.${id}`, id);
export const qualityTip = (id) => tx(`quality.${id}.tip`, '');
export const surfaceName = (key) => t(`surface.${key}`);
export const openingName = (type) => t(`opening.${type}`);
export const photoKindName = (c) => tx(`photoKind.${c.id}`, c.name);

// Room names the app gave (a room type's or a template's name, maybe numbered)
// show in the current language; names people chose stay as they are.
const TYPES = ['living', 'bedroom', 'bathroom', 'kitchen', 'office', 'dining', 'studio', 'empty'];
const TEMPLATE_IDS = ['living-warm-modern', 'studio-japandi', 'bedroom-soft-minimal', 'bathroom-spa', 'kitchen-scandi', 'dining-mid-century', 'office-moody'];
export function defaultNameKey(name) {
  const m = String(name || '').trim().match(/^(.*?)(?:\s+(\d+))?$/), base = (m?.[1] || '').toLowerCase();
  for (const id of TYPES) if (allTexts(`roomType.${id}`).some((s) => s.toLowerCase() === base)) return { key: `roomType.${id}`, n: m[2] };
  for (const id of TEMPLATE_IDS) if (allTexts(`template.${id}`).some((s) => s.toLowerCase() === base)) return { key: `template.${id}`, n: m[2] };
  return null;
}
export function roomName(name) {
  const d = defaultNameKey(name);
  return d ? `${t(d.key)}${d.n ? ' ' + d.n : ''}` : name;
}
