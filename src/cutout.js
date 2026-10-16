// Pure image maths for photo items: background removal by region growing from
// the border, edge feathering, cropping, and extruding a silhouette grid into
// mesh arrays. No DOM, no three.js.

// mask[i] = 1 for foreground pixels. Background = everything reachable from the
// image border whose colour stays close to the border's median colour.
export function backgroundMask(data, w, h, tolerance = 40) {
  const n = w * h;
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const ref = [0, 1, 2].map((c) => {
    const vals = border.map((i) => data[i * 4 + c]).sort((a, b) => a - b);
    return vals[vals.length >> 1];
  });
  const dist = (i, r, g, b) => Math.hypot(data[i * 4] - r, data[i * 4 + 1] - g, data[i * 4 + 2] - b);
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const near = tolerance * 0.4;
  for (const i of border) if (!visited[i] && dist(i, ...ref) <= tolerance) { visited[i] = 1; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++], x = i % w, y = (i - x) / w;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (visited[j]) continue;
      if (dist(j, ...ref) <= tolerance || dist(j, r, g, b) <= near) { visited[j] = 1; queue[tail++] = j; }
    }
  }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = visited[i] ? 0 : 1;
  return mask;
}

// 3x3 average of the mask, as 0..255 alpha, so edges fade over one pixel.
export function featherMask(mask, w, h) {
  const alpha = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, cnt = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      sum += mask[ny * w + nx]; cnt++;
    }
    alpha[y * w + x] = Math.round((sum / cnt) * 255);
  }
  return alpha;
}

export function cropBounds(alpha, w, h, pad = 2) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (alpha[y * w + x] > 127) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  return { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(w - 1, x1 + pad), y1: Math.min(h - 1, y1 + pad) };
}

// Fill transparent pixels with the average opaque colour so texture filtering
// never bleeds black or white into the edges.
export function bleedEdges(data, alpha, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (alpha[i] > 127) { r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; n++; }
  if (!n) return;
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  for (let i = 0; i < w * h; i++) if (alpha[i] <= 127) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; }
}

// Extrude a filled-cell grid (gw x gh, row 0 at the top of the picture) into
// quads: picture on the front and back, solid sides where a neighbour is empty.
// Floor items stand on y = 0 and are centred in x and z. Wall items are centred
// in x and y with their back at z = 0, facing +z.
export function extrudeMask(cells, gw, gh, { width, height, depth, kind }) {
  const F = { positions: [], normals: [], uvs: [], indices: [] }, R = { positions: [], normals: [], uvs: [], indices: [] };
  const cw = width / gw, ch = height / gh;
  const y0 = kind === 'wall' ? -height / 2 : 0;
  const zBack = kind === 'wall' ? 0 : -depth / 2, zFront = zBack + depth;
  const filled = (i, j) => i >= 0 && j >= 0 && i < gw && j < gh && cells[j * gw + i];
  const quad = (B, pts, n, uv) => {
    const base = B.positions.length / 3;
    for (let k = 0; k < 4; k++) { B.positions.push(...pts[k]); B.normals.push(...n); B.uvs.push(...uv[k]); }
    B.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (!cells[j * gw + i]) continue;
    const xl = -width / 2 + i * cw, xr = xl + cw;
    const yt = y0 + height - j * ch, yb = yt - ch;
    const ul = i / gw, ur = (i + 1) / gw, vt = 1 - j / gh, vb = 1 - (j + 1) / gh;
    quad(F, [[xl, yb, zFront], [xr, yb, zFront], [xr, yt, zFront], [xl, yt, zFront]], [0, 0, 1], [[ul, vb], [ur, vb], [ur, vt], [ul, vt]]);
    quad(R, [[xr, yb, zBack], [xl, yb, zBack], [xl, yt, zBack], [xr, yt, zBack]], [0, 0, -1], [[ur, vb], [ul, vb], [ul, vt], [ur, vt]]);
    if (!filled(i - 1, j)) quad(R, [[xl, yb, zBack], [xl, yb, zFront], [xl, yt, zFront], [xl, yt, zBack]], [-1, 0, 0], [[ul, vb], [ul, vb], [ul, vt], [ul, vt]]);
    if (!filled(i + 1, j)) quad(R, [[xr, yb, zFront], [xr, yb, zBack], [xr, yt, zBack], [xr, yt, zFront]], [1, 0, 0], [[ur, vb], [ur, vb], [ur, vt], [ur, vt]]);
    if (!filled(i, j - 1)) quad(R, [[xl, yt, zFront], [xr, yt, zFront], [xr, yt, zBack], [xl, yt, zBack]], [0, 1, 0], [[ul, vt], [ur, vt], [ur, vt], [ul, vt]]);
    if (!filled(i, j + 1)) quad(R, [[xl, yb, zBack], [xr, yb, zBack], [xr, yb, zFront], [xl, yb, zFront]], [0, -1, 0], [[ul, vb], [ur, vb], [ur, vb], [ul, vb]]);
  }
  const off = F.positions.length / 3;
  return {
    positions: new Float32Array([...F.positions, ...R.positions]),
    normals: new Float32Array([...F.normals, ...R.normals]),
    uvs: new Float32Array([...F.uvs, ...R.uvs]),
    indices: new Uint32Array([...F.indices, ...R.indices.map((i) => i + off)]),
    frontCount: F.indices.length,
  };
}

// ---- edge cleanup ----------------------------------------------------------------
// Shrink the mask by `px` pixels so no background ring survives at the edge.
export function erodeMask(mask, w, h, px = 1) {
  let cur = mask;
  for (let n = 0; n < px; n++) {
    const next = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!cur[i]) continue;
      const keep = x > 0 && y > 0 && x < w - 1 && y < h - 1 && cur[i - 1] && cur[i + 1] && cur[i - w] && cur[i + w];
      next[i] = keep ? 1 : 0;
    }
    cur = next;
  }
  return cur;
}

// Feather with a (2r+1)² box average, as 0..255 alpha.
export function featherMaskRadius(mask, w, h, r = 2) {
  const alpha = new Uint8ClampedArray(w * h);
  const row = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dx = -r; dx <= r; dx++) { const nx = x + dx; if (nx >= 0 && nx < w) { s += mask[y * w + nx]; c++; } }
    row[y * w + x] = s / c;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let dy = -r; dy <= r; dy++) { const ny = y + dy; if (ny >= 0 && ny < h) { s += row[ny * w + x]; c++; } }
    alpha[y * w + x] = Math.round((s / c) * 255);
  }
  return alpha;
}

// Replace the colour of every semi-transparent pixel with the average of the
// nearest fully opaque pixels, so the fringe stops carrying background colour.
export function defringe(data, alpha, w, h, radius = 3) {
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (alpha[i] === 0 || alpha[i] >= 250) continue;
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -radius; dy <= radius && n < 12; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (alpha[j] >= 250) { r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; n++; }
    }
    if (n) { out[i * 4] = r / n; out[i * 4 + 1] = g / n; out[i * 4 + 2] = b / n; }
  }
  return out;
}

// ---- photo quality hints -----------------------------------------------------------
// Variance of a 3x3 Laplacian over the grey image: low means soft or blurry.
export function sharpness(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const v = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
    sum += v; sum2 += v * v; n++;
  }
  const mean = sum / n;
  return sum2 / n - mean * mean;
}

// How level the object's underside is: compares the lowest filled row in the
// left and right thirds. Returns 0 (level) .. 1 (one side a whole height lower).
export function tiltHint(alpha, w, h) {
  const bottom = (x0, x1) => { let best = -1; for (let y = h - 1; y >= 0 && best < 0; y--) for (let x = x0; x < x1; x++) if (alpha[y * w + x] > 127) { best = y; break; } return best; };
  const b = cropBounds(alpha, w, h, 0);
  if (!b) return 0;
  const third = Math.max(1, Math.floor((b.x1 - b.x0 + 1) / 3));
  const l = bottom(b.x0, b.x0 + third), r = bottom(b.x1 - third + 1, b.x1 + 1);
  if (l < 0 || r < 0) return 0;
  return Math.abs(l - r) / Math.max(1, b.y1 - b.y0 + 1);
}

// ---- colour ------------------------------------------------------------------------------
// Up to k dominant opaque colours by a few k-means rounds on a pixel sample.
export function dominantColors(data, alpha, w, h, k = 4) {
  const pts = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const i = y * w + x;
    if (alpha[i] > 200) pts.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  }
  if (!pts.length) return [];
  let centers = Array.from({ length: Math.min(k, pts.length) }, (_, j) => pts[Math.floor((j + 0.5) * pts.length / Math.min(k, pts.length))].slice());
  let assign = new Int32Array(pts.length);
  for (let it = 0; it < 8; it++) {
    for (let p = 0; p < pts.length; p++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = (pts[p][0] - centers[c][0]) ** 2 + (pts[p][1] - centers[c][1]) ** 2 + (pts[p][2] - centers[c][2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      assign[p] = best;
    }
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let p = 0; p < pts.length; p++) { const s = sums[assign[p]]; s[0] += pts[p][0]; s[1] += pts[p][1]; s[2] += pts[p][2]; s[3]++; }
    centers = sums.map((s, c) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[c]);
  }
  const counts = centers.map(() => 0);
  for (let p = 0; p < pts.length; p++) counts[assign[p]]++;
  return centers.map((c, i) => ({ rgb: c.map(Math.round), share: counts[i] / pts.length })).filter((c) => c.share > 0).sort((a, b) => b.share - a.share);
}
export const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// ---- silhouette outline ---------------------------------------------------------------
// Trace the boundary of a filled-cell grid into closed loops of [x, y] points in
// cell units (x right, y down, row 0 at the top). Each loop keeps the filled
// region on its left. The largest loop is the outline; the rest are holes.
export function traceContours(cells, gw, gh) {
  const filled = (i, j) => i >= 0 && j >= 0 && i < gw && j < gh && cells[j * gw + i];
  const edges = new Map(); // "x,y" start -> [ex, ey]
  const key = (x, y) => x + ',' + y;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    if (!cells[j * gw + i]) continue;
    // directed edges with the cell on the left (y grows downward, so "left" is clockwise on screen)
    if (!filled(i, j - 1)) edges.set(key(i, j), [i + 1, j]);          // top edge, left -> right
    if (!filled(i + 1, j)) edges.set(key(i + 1, j), [i + 1, j + 1]);  // right edge, top -> bottom
    if (!filled(i, j + 1)) edges.set(key(i + 1, j + 1), [i, j + 1]);  // bottom edge, right -> left
    if (!filled(i - 1, j)) edges.set(key(i, j + 1), [i, j]);          // left edge, bottom -> top
  }
  const loops = [];
  while (edges.size) {
    const [startKey, first] = edges.entries().next().value;
    const start = startKey.split(',').map(Number);
    const loop = [start];
    let cur = first; edges.delete(startKey);
    while (cur && !(cur[0] === start[0] && cur[1] === start[1]) && loop.length < 100000) {
      loop.push(cur);
      const k = key(cur[0], cur[1]);
      const next = edges.get(k); edges.delete(k);
      cur = next;
    }
    if (loop.length >= 4) loops.push(loop);
  }
  return loops;
}

export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length]; a += x0 * y1 - x1 * y0; }
  return a / 2;
}

// Ramer-Douglas-Peucker on a closed loop.
export function simplifyLoop(pts, epsilon = 0.8) {
  if (pts.length <= 4) return pts;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const rdp = (arr) => {
    if (arr.length < 3) return arr;
    let idx = 0, max = 0;
    for (let i = 1; i < arr.length - 1; i++) { const d = dist(arr[i], arr[0], arr[arr.length - 1]); if (d > max) { max = d; idx = i; } }
    if (max <= epsilon) return [arr[0], arr[arr.length - 1]];
    const left = rdp(arr.slice(0, idx + 1)), right = rdp(arr.slice(idx));
    return left.slice(0, -1).concat(right);
  };
  // split the closed loop at the two farthest-apart points so RDP has two open runs
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < pts.length; i += Math.max(1, Math.floor(pts.length / 64))) for (let j = i + 1; j < pts.length; j += Math.max(1, Math.floor(pts.length / 64))) {
    const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2; if (d > best) { best = d; a = i; b = j; }
  }
  const run1 = rdp(pts.slice(a, b + 1)), run2 = rdp(pts.slice(b).concat(pts.slice(0, a + 1)));
  const out = run1.slice(0, -1).concat(run2.slice(0, -1));
  return out.length >= 3 ? out : pts;
}

// Outline + holes ready for extrusion: largest loop first, holes inside it that
// cover more than `minHole` of its area. Points simplified.
export function silhouette(cells, gw, gh, { epsilon = 0.8, minHole = 0.004 } = {}) {
  const loops = traceContours(cells, gw, gh).map((l) => ({ pts: l, area: polygonArea(l) }));
  if (!loops.length) return null;
  loops.sort((x, y) => Math.abs(y.area) - Math.abs(x.area));
  const outer = loops[0];
  const inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if (((yi > p[1]) !== (yj > p[1])) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const holes = loops.slice(1).filter((l) => Math.sign(l.area) !== Math.sign(outer.area) && Math.abs(l.area) > minHole * Math.abs(outer.area) && inside(l.pts[0], outer.pts));
  return { outer: simplifyLoop(outer.pts, epsilon), holes: holes.map((h) => simplifyLoop(h.pts, epsilon)) };
}
