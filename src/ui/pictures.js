// Pictures for choices that are drawn rather than rendered: a room's floor plan
// with its door and windows and its size written under it, and the view seen
// through the windows (a small crop of the same photo the windows show).
import { pickPicture, timeSlot } from '../views.js';

const NS = 'http://www.w3.org/2000/svg';
// width × length in metres, openings as on the room (offset along each wall); doors in mint, windows in blue
// `fit` [w, l]: draw at the scale that fits a room of that size, so a set of plans compares honestly
export function floorPlan(width, length, openings = [], { maxW = 80, maxH = 50, fit = null } = {}) {
  const k = fit ? Math.min(maxW / fit[0], maxH / fit[1]) : Math.min(maxW / width, maxH / length), w = width * k, h = length * k, x0 = (90 - w) / 2, y0 = (56 - h) / 2;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 90 56'); svg.setAttribute('class', 'plan'); svg.setAttribute('aria-hidden', 'true');
  let inner = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="1.5" style="fill:var(--plan-fill);stroke:var(--ink)" stroke-width="1.8"/>`;
  for (const o of openings) {
    const along = (o.offset - o.width / 2) * k, len = o.width * k, col = o.type === 'door' ? 'var(--mint)' : '#7fb6d6';
    const seg = { N: [x0 + along, y0, x0 + along + len, y0], S: [x0 + along, y0 + h, x0 + along + len, y0 + h], W: [x0, y0 + along, x0, y0 + along + len], E: [x0 + w, y0 + along, x0 + w, y0 + along + len] }[o.wall];
    if (seg) inner += `<path d="M${seg[0]} ${seg[1]}L${seg[2]} ${seg[3]}" style="stroke:${col}" stroke-width="3.2" stroke-linecap="round"/>`;
  }
  svg.innerHTML = inner;
  return svg;
}

const NONE = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="#f1eee9"/><stop offset="1" stop-color="#e2ddd5"/></linearGradient></defs><rect width="4" height="3" fill="url(#a)"/></svg>');
// the view at the hour shown: day, sunset or night
export const viewPicture = (view, time) => (view === 'none' ? NONE : pickPicture(view, timeSlot(time)));
