// Errors that the app survives but someone should know about. Each is logged
// once to the console and the last few are kept in localStorage
// ('roomsmith:errors'), so a problem seen once on someone's machine can be read
// back afterwards from the same site. Nothing leaves the browser.
const KEY = 'roomsmith:errors', KEEP = 12;
const seen = new Set();

export function report(where, err) {
  const message = String(err?.message || err || 'unknown').slice(0, 300);
  const sig = `${where}: ${message}`;
  if (seen.has(sig)) return;
  seen.add(sig);
  console.error(`[meu-ambiente] ${where}:`, err);
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    list.push({ at: new Date().toISOString(), where, message, stack: String(err?.stack || '').slice(0, 1200), ua: navigator.userAgent.slice(0, 160) });
    localStorage.setItem(KEY, JSON.stringify(list.slice(-KEEP)));
  } catch { /* storage full or blocked: the console has it */ }
}

export function reportedErrors() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

// anything that escapes everywhere else
export function watchUncaught() {
  window.addEventListener('error', (e) => report('uncaught', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report('unhandled promise', e.reason));
}
