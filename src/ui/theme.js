// Interface theme: Light, Dark or Automatic (follows the computer's setting).
// Only the interface changes; the 3D room keeps its own look. The page head
// applies the saved choice before first paint, so the page never flashes.
const KEY = 'roomsmith:theme'; // internal key, as for the other saved settings
const media = matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set();

// names and descriptions: theme.<id> and theme.<id>.tip in the translation files
export const THEMES = [{ id: 'light' }, { id: 'dark' }, { id: 'auto' }];
export function themeMode() { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } }
export const resolvedTheme = (mode = themeMode()) => (mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode);
function apply() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  for (const fn of listeners) fn(t, themeMode());
}
export function setThemeMode(mode) { try { localStorage.setItem(KEY, mode); } catch {} apply(); }
export function onTheme(fn) { listeners.add(fn); return () => listeners.delete(fn); }
media.addEventListener('change', () => { if (themeMode() === 'auto') apply(); });
apply();
