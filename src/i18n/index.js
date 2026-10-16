// Languages. Every piece of text the interface shows lives in a translation
// file (src/i18n/<language>.json, flat "key": "text" pairs); adding a language
// means adding a file and a line to LANGUAGES. Brazilian Portuguese is the
// default. Text may contain {placeholders}; plurals use "key.one"/"key.other".
import en from './en.json' with { type: 'json' };
import ptBR from './pt-BR.json' with { type: 'json' };

export const LANGUAGES = [
  { id: 'pt-BR', name: 'Português', short: 'PT' },
  { id: 'en', name: 'English', short: 'EN' },
];
const DICTS = { 'pt-BR': ptBR, en };
export const DEFAULT_LANG = 'pt-BR';
const KEY = 'roomsmith:lang'; // internal key, as for the other saved settings
const listeners = new Set();

function saved() { try { const v = globalThis.localStorage?.getItem(KEY); return DICTS[v] ? v : null; } catch { return null; } }
let current = saved() || DEFAULT_LANG;
export const lang = () => current;

const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m)) : s);
// the text for a key in the current language (English if missing, the key itself as a last resort)
export function t(key, vars) { const s = DICTS[current][key] ?? en[key]; return s == null ? key : fill(s, vars); }
// a key that may not exist (names of things): falls back to the given text
export function tx(key, fallback, vars) { const s = DICTS[current][key] ?? en[key]; return s == null ? fallback : fill(s, vars); }
export function tn(key, n, vars) { return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n: num(n, 0), ...vars }); }
export const has = (key) => key in en;

// numbers in the local style: 4,5 in Portuguese, 4.5 in English
const fmt = new Map();
export function num(v, digits = 1) {
  const k = current + digits;
  if (!fmt.has(k)) fmt.set(k, new Intl.NumberFormat(current, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return fmt.get(k).format(+v);
}
// a length in metres, and a size as "w × l m"
export const m = (v, digits = 1) => `${num(v, digits)} m`;
export const size2 = (w, l, digits = 1) => `${num(w, digits)} × ${num(l, digits)} m`;

export function setLang(id) {
  if (!DICTS[id] || id === current) return;
  current = id; fmt.clear();
  try { globalThis.localStorage?.setItem(KEY, id); } catch {}
  if (globalThis.document?.documentElement) document.documentElement.lang = id;
  for (const fn of listeners) fn(id);
}
export function onLang(fn) { listeners.add(fn); return () => listeners.delete(fn); }
if (globalThis.document?.documentElement) document.documentElement.lang = current;

// all translations of a key (to recognise default names in any language)
export const allTexts = (key) => Object.values(DICTS).map((d) => d[key]).filter(Boolean);

// Text written into the page itself: data-i18n="key" sets the text;
// data-i18n-attr="placeholder:key;aria-label:key;data-tip:key" sets attributes.
export function translatePage(root = document) {
  for (const n of root.querySelectorAll('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of root.querySelectorAll('[data-i18n-html]')) n.innerHTML = t(n.dataset.i18nHtml);
  for (const n of root.querySelectorAll('[data-i18n-attr]')) for (const pair of n.dataset.i18nAttr.split(';')) { const [a, k] = pair.split(':'); if (a && k) n.setAttribute(a.trim(), t(k.trim())); }
  document.title = t('app.name');
}
