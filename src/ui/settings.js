// The Settings drawer: language, appearance, picture quality, the optional idle
// drift, help, and about and credits.
import { el, icon } from './dom.js';
import { QUALITY_LEVELS } from '../quality.js';
import { THEMES, themeMode, setThemeMode } from './theme.js';
import { t, lang, setLang, LANGUAGES } from '../i18n/index.js';
import { qualityName, qualityTip } from '../i18n/names.js';
import { CREDITS, polyHaven } from '../credits.js';

export function settingsDrawer(ctx) {
  const { scene, toast } = ctx;
  return {
    id: 'settings',
    render() {
      return [
        el('div', { class: 'eyebrow' }, t('app.name')),
        el('h1', { class: 'd-title' }, t('nav.settings')),
        el('h2', { class: 'd-h' }, t('settings.language')),
        el('div', { class: 'grid2', id: 'languages', role: 'radiogroup', 'aria-label': t('settings.language') }, ...LANGUAGES.map((l) => el('button', { class: 'pick lang-pick' + (lang() === l.id ? ' on' : ''), role: 'radio', 'aria-checked': lang() === l.id, 'data-lang': l.id, lang: l.id,
          tip: [l.name, t(`settings.language.${l.id}.tip`)], onclick: () => setLang(l.id) }, el('span', { class: 'lang-badge' }, l.short), el('b', {}, l.name)))),
        el('h2', { class: 'd-h' }, t('settings.appearance')),
        el('div', { class: 'grid3', id: 'theme-modes', role: 'radiogroup', 'aria-label': t('settings.appearance') }, ...THEMES.map((th) => el('button', { class: 'pick' + (themeMode() === th.id ? ' on' : ''), role: 'radio', 'aria-checked': themeMode() === th.id, 'data-theme-mode': th.id, tip: [t(`theme.${th.id}`), t(`theme.${th.id}.tip`)],
          onclick: () => { setThemeMode(th.id); ctx.rerender(); } },
          el('span', { class: 'theme-pic ' + th.id }, el('i', { class: 'r' }, el('i', { class: 'dot' })), el('i', { class: 'd' }), el('i', { class: 'v' })), el('b', {}, t(`theme.${th.id}`))))),
        el('p', { class: 'hint' }, t('settings.appearance.hint')),
        el('h2', { class: 'd-h' }, t('settings.quality')),
        el('div', { class: 'grid3 quality', id: 'quality' }, ...QUALITY_LEVELS.map((q) => el('button', { class: 'pick' + (q === scene.quality ? ' on' : ''), 'data-q': q, tip: [qualityName(q), qualityTip(q)],
          onclick: () => { scene.setQuality(q); toast(t('settings.quality.toast', { quality: qualityName(q) })); ctx.rerender(); } }, el('b', {}, qualityName(q)), el('small', {}, t(`quality.${q}.short`))))),
        el('p', { class: 'hint' }, t('settings.quality.hint')),
        el('h2', { class: 'd-h' }, t('settings.camera')),
        el('label', { class: 'switch-row', tip: [t('settings.drift'), t('settings.drift.tip')] }, el('span', {}, t('settings.drift')),
          el('input', { id: 'idle-motion', type: 'checkbox', role: 'switch', checked: scene.idleMotion, onchange: (e) => { scene.setIdleMotion(e.target.checked); toast(t(e.target.checked ? 'settings.drift.on' : 'settings.drift.off')); } }), el('i', { 'aria-hidden': 'true' })),
        el('h2', { class: 'd-h' }, t('nav.help')),
        el('div', { class: 'btn-row' }, el('button', { class: 'btn small', onclick: () => ctx.startTour() }, icon('help'), t('settings.tour'))),
        el('p', { class: 'hint' }, t('settings.controls')),
        el('h2', { class: 'd-h', id: 'credits' }, t('settings.credits')),
        el('p', { class: 'about' }, t('settings.about')),
        el('p', { class: 'about' }, t('settings.credits.text')),
        ...creditList(),
      ];
    },
  };
}

// the credits: each thing with its authors and licence, linked to its source
const KIND = { model: () => t('credits.kind.model'), texture: () => t('credits.kind.texture'), view: () => t('credits.kind.view') };
const link = (c) => el('a', { href: c.url, target: '_blank', rel: 'noopener' }, c.name);
function creditList() {
  const group = (key, items) => [el('h3', { class: 'credit-h' }, t(key)),
    el('ul', { class: 'credits' }, ...items.map((c) => el('li', {}, link(c), el('span', {}, ` · ${c.by} · ${c.licence}`))))];
  const ph = polyHaven();
  return [
    ...group('credits.ai', CREDITS.ai), ...group('credits.libraries', CREDITS.libraries), ...group('credits.fonts', CREDITS.fonts),
    el('h3', { class: 'credit-h' }, t('credits.polyHaven')),
    el('details', { class: 'credits-more' }, el('summary', {}, t('credits.polyHaven.count', { n: ph.length })),
      el('ul', { class: 'credits' }, ...ph.map((c) => el('li', {}, link(c), el('span', {}, ` · ${KIND[c.kind]()} · ${c.authors.join(', ')}`))))),
  ];
}
