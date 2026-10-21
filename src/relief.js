// Relief for photo items: the cutout's alpha and a depth map, sampled on a
// small grid, become a solid with a sculpted front, a flat back and sides that
// follow the outline. Depth is the kind an on-device model gives (relative,
// larger = nearer). Pure maths: no DOM, no three.js (customItems.js wraps the
// arrays into a mesh).

// Average full-size alpha (0..255) and depth onto a gw × gh grid. Depth is
// weighted by alpha so the background never leaks into the object's edge.
export function sampleGrid(alpha, depth, w, h, gw, gh) {
  const a = new Uint8Array(gw * gh), d = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const y0 = Math.floor((j * h) / gh), y1 = Math.max(y0 + 1, Math.floor(((j + 1) * h) / gh));
    for (let i = 0; i < gw; i++) {
      const x0 = Math.floor((i * w) / gw), x1 = Math.max(x0 + 1, Math.floor(((i + 1) * w) / gw));
      let sa = 0, n = 0, sd = 0, wd = 0, sdAll = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const k = y * w + x, av = alpha[k];
        sa += av; n++;
        if (depth) { sdAll += depth[k]; if (av > 127) { sd += depth[k] * av; wd += av; } }
      }
      a[j * gw + i] = Math.round(sa / n);
      if (depth) d[j * gw + i] = wd ? sd / wd : sdAll / n;
    }
  }
  return { alpha: a, depth: d };
}

// Depth as 0 (far) .. 1 (near) over the object, with the extremes clipped so a
// stray pixel cannot flatten everything else, then smoothed within the object.
export function normalizeDepth(depth, alpha, gw, gh, { threshold = 110, lo = 0.02, hi = 0.98, blur = 1, passes = 2 } = {}) {
  const n = gw * gh, inside = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) if (alpha[i] >= threshold) { inside[i] = 1; count++; }
  const out = new Float32Array(n);
  if (count < 4) return out;
  // percentiles from a sample of the object's values (enough for a stable range)
  const stride = Math.max(1, Math.floor(count / 20000)), vals = [];
  for (let i = 0, k = 0; i < n; i++) if (inside[i] && k++ % stride === 0) vals.push(depth[i]);
  vals.sort((x, y) => x - y);
  const vlo = vals[Math.floor(lo * (vals.length - 1))], vhi = vals[Math.floor(hi * (vals.length - 1))];
  const span = vhi - vlo;
  for (let i = 0; i < n; i++) out[i] = inside[i] && span > 1e-9 ? Math.min(1, Math.max(0, (depth[i] - vlo) / span)) : inside[i] ? 0.5 : 0;
  // nodes just outside the object take their nearest inside value so a snapped
  // edge never reads a background depth
  let cur = out;
  for (let p = 0; p < passes && blur > 0; p++) {
    const next = new Float32Array(n);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      let s = 0, c = 0;
      for (let dy = -blur; dy <= blur; dy++) for (let dx = -blur; dx <= blur; dx++) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        const q = y * gw + x;
        if (inside[q]) { s += cur[q]; c++; }
      }
      next[k] = c ? s / c : 0;
    }
    cur = next;
  }
  return cur;
}

// Connected parts of the object, 4-connected; tiny flecks (shadows, crumbs of
// background) are dropped so they never float beside the piece.
export function keepMainParts(inside, gw, gh, minShare = 0.015) {
  const n = gw * gh, label = new Int32Array(n).fill(-1), sizes = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (!inside[s] || label[s] >= 0) continue;
    const id = sizes.length; let head = 0, tail = 0, count = 0;
    queue[tail++] = s; label[s] = id;
    while (head < tail) {
      const k = queue[head++], x = k % gw, y = (k - x) / gw; count++;
      if (x > 0 && inside[k - 1] && label[k - 1] < 0) { label[k - 1] = id; queue[tail++] = k - 1; }
      if (x < gw - 1 && inside[k + 1] && label[k + 1] < 0) { label[k + 1] = id; queue[tail++] = k + 1; }
      if (y > 0 && inside[k - gw] && label[k - gw] < 0) { label[k - gw] = id; queue[tail++] = k - gw; }
      if (y < gh - 1 && inside[k + gw] && label[k + gw] < 0) { label[k + gw] = id; queue[tail++] = k + gw; }
    }
    sizes.push(count);
  }
  if (!sizes.length) return inside;
  const largest = Math.max(...sizes), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = inside[i] && sizes[label[i]] >= Math.max(4, largest * minShare) ? 1 : 0;
  return out;
}

// Enclosed gaps smaller than `maxShare` of the object (a shadow line the matte
// missed, a crack between cushions) are closed; real openings stay open.
export function fillSmallHoles(inside, gw, gh, maxShare = 0.006) {
  const n = gw * gh, label = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let solid = 0; for (let i = 0; i < n; i++) solid += inside[i];
  const limit = Math.max(6, solid * maxShare);
  const out = new Uint8Array(inside);
  const holes = [];
  for (let s = 0; s < n; s++) {
    if (inside[s] || label[s] >= 0) continue;
    const id = holes.length, cells = []; let head = 0, tail = 0, touches = false;
    queue[tail++] = s; label[s] = id;
    while (head < tail) {
      const k = queue[head++], x = k % gw, y = (k - x) / gw; cells.push(k);
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) touches = true;
      if (x > 0 && !inside[k - 1] && label[k - 1] < 0) { label[k - 1] = id; queue[tail++] = k - 1; }
      if (x < gw - 1 && !inside[k + 1] && label[k + 1] < 0) { label[k + 1] = id; queue[tail++] = k + 1; }
      if (y > 0 && !inside[k - gw] && label[k - gw] < 0) { label[k - gw] = id; queue[tail++] = k - gw; }
      if (y < gh - 1 && !inside[k + gw] && label[k + gw] < 0) { label[k + gw] = id; queue[tail++] = k + gw; }
    }
    holes.push({ cells, touches });
  }
  for (const h of holes) if (!h.touches && h.cells.length <= limit) for (const k of h.cells) out[k] = 1;
  return out;
}

// Nodes that became solid by filling a gap have no depth of their own: they take
// the average of the known depth around them, spreading inwards.
export function fillDepth(depth, known, inside, gw, gh) {
  const n = gw * gh, have = new Uint8Array(known);
  let out = Float32Array.from(depth), todo = 0;
  for (let i = 0; i < n; i++) if (inside[i] && !have[i]) todo++;
  for (let pass = 0; pass < 12 && todo; pass++) {
    const next = Float32Array.from(out), nh = new Uint8Array(have);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i;
      if (!inside[k] || have[k]) continue;
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = i + dx, y = j + dy;
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        const q = y * gw + x;
        if (have[q]) { s += out[q]; c++; }
      }
      if (c) { next[k] = s / c; nh[k] = 1; todo--; }
    }
    out = next; have.set(nh);
  }
  return out;
}

const smooth = (t) => t * t * (3 - 2 * t);

// The mesh. alpha (0..255) and depth (0..1, 1 = near) are gw × gh, row 0 at
// the top of the picture. Floor items stand on y = 0, centred in x and z; wall
// items are centred in x and y with their back on z = 0, facing +z. Returns
// flat arrays plus `frontCount` (the photo face comes first in `indices`), or
// null when nothing solid is left.
export function reliefMesh(alpha, depth, gw, gh, { width, height, depth: D, kind, threshold = 110, minThick = 0.24, edgeThick = 0.55, bevel = null, inset = 2.5, smoothPasses = 8 } = {}) {
  const n = gw * gh;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) raw[i] = alpha[i] >= threshold ? 1 : 0;
  const inside = fillSmallHoles(keepMainParts(raw, gw, gh), gw, gh);
  depth = fillDepth(depth, raw, inside, gw, gh);
  const cw = width / gw, ch = height / gh;
  const y0 = kind === 'wall' ? -height / 2 : 0;
  const zBack = kind === 'wall' ? 0 : -D / 2;
  const at = (i, j) => (i >= 0 && j >= 0 && i < gw && j < gh ? inside[j * gw + i] : 0);
  // cells with all four corners inside
  const cellIn = (i, j) => i >= 0 && j >= 0 && i < gw - 1 && j < gh - 1 && at(i, j) && at(i + 1, j) && at(i, j + 1) && at(i + 1, j + 1);
  // nodes used by at least one cell
  const used = new Uint8Array(n);
  let cells = 0;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) if (cellIn(i, j)) { cells++; used[j * gw + i] = used[j * gw + i + 1] = used[(j + 1) * gw + i] = used[(j + 1) * gw + i + 1] = 1; }
  if (!cells) return null;

  // the rounded rim: how much of the object surrounds each node (the solid
  // mask softened over the bevel's width, a separable triangle blur), which
  // falls from 1 deep inside to about 0.5 at the outline, smoothly whatever
  // angle the outline takes across the grid
  const bevelM = bevel ?? Math.min(0.05, D * 0.35, width / 14, height / 14);
  const B = Math.max(0, bevelM / Math.min(cw, ch));
  const cover = new Float32Array(n);
  if (B >= 0.5) {
    const r = Math.max(1, Math.round(B));
    let cur = Float32Array.from(inside);
    for (let pass = 0; pass < 2; pass++) {
      const tmp = new Float32Array(n), out = new Float32Array(n);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { let sum = 0; for (let dx = -r; dx <= r; dx++) { const x = i + dx; if (x >= 0 && x < gw) sum += cur[j * gw + x]; } tmp[j * gw + i] = sum / (2 * r + 1); }
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { let sum = 0; for (let dy = -r; dy <= r; dy++) { const y = j + dy; if (y >= 0 && y < gh) sum += tmp[y * gw + i]; } out[j * gw + i] = sum / (2 * r + 1); }
      cur = out;
    }
    cover.set(cur);
  } else cover.fill(1);

  // node positions: snapped outward where the picture's edge lies between nodes
  const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n), ox = new Float32Array(n), oy = new Float32Array(n);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    if (!used[k]) continue;
    let sx = 0, sy = 0;
    const a = alpha[k];
    const step = (ni, nj) => { if (ni < 0 || nj < 0 || ni >= gw || nj >= gh) return 0; if (inside[nj * gw + ni]) return 0; const b = alpha[nj * gw + ni]; return Math.min(0.9, Math.max(0, (a - threshold) / Math.max(1, a - b))); };
    sx += step(i + 1, j) - step(i - 1, j); sy += step(i, j + 1) - step(i, j - 1);
    ox[k] = sx; oy[k] = sy;
    px[k] = -width / 2 + (i + 0.5 + sx) * cw;
    py[k] = y0 + height - (j + 0.5 + sy) * ch;
    let thick = D * (minThick + (1 - minThick) * depth[k]);
    if (B >= 0.5) { const f = Math.min(1, Math.max(0, (cover[k] - 0.4) / 0.6)); thick *= edgeThick + (1 - edgeThick) * smooth(f); }
    pz[k] = zBack + thick;
  }
  // a light pass over the front height so the rim rounds without facets
  for (let pass = 0; pass < 2; pass++) {
    const nz = Float32Array.from(pz);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
      const k = j * gw + i; if (!used[k]) continue;
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = i + dx, y = j + dy; if (x < 0 || y < 0 || x >= gw || y >= gh) continue; const m = y * gw + x; if (used[m]) { s += pz[m]; c++; } }
      nz[k] = s / c;
    }
    pz.set(nz);
  }

  // The outline as loops of boundary nodes (each cell edge with nothing beyond
  // it, counter-clockwise seen from the front), then smoothed along the loop so
  // the grid's stair steps become a continuous edge. Taubin's pair of passes
  // (shrink, then swell) keeps corners where they are while the steps go.
  const next = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1), multi = new Uint8Array(n);
  const link = (p, q) => { if (next[p] >= 0 || prev[q] >= 0) { multi[p] = multi[q] = 1; return; } next[p] = q; prev[q] = p; };
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    if (!cellIn(i, j)) continue;
    const a = j * gw + i, b = a + 1, c = a + gw + 1, d = a + gw;
    if (!cellIn(i - 1, j)) link(a, d);
    if (!cellIn(i, j + 1)) link(d, c);
    if (!cellIn(i + 1, j)) link(c, b);
    if (!cellIn(i, j - 1)) link(b, a);
  }
  const ring2 = (k) => { const p1 = prev[k], n1 = next[k]; if (p1 < 0 || n1 < 0 || multi[k]) return null; const p2 = prev[p1], n2 = next[n1]; return p2 >= 0 && n2 >= 0 && !multi[p1] && !multi[n1] ? [p2, p1, n1, n2] : [p1, p1, n1, n1]; };
  for (let pass = 0; pass < smoothPasses * 2; pass++) {
    const f = pass % 2 === 0 ? 0.6 : -0.62;
    const nx = Float32Array.from(px), ny = Float32Array.from(py);
    for (let k = 0; k < n; k++) {
      const r = ring2(k); if (!r) continue;
      // a wider stencil (two nodes each way, weights 1 2 2 1) reaches the long shallow steps too
      const ax = (px[r[0]] + 2 * px[r[1]] + 2 * px[r[2]] + px[r[3]]) / 6, ay = (py[r[0]] + 2 * py[r[1]] + 2 * py[r[2]] + py[r[3]]) / 6;
      nx[k] = px[k] + f * (ax - px[k]); ny[k] = py[k] + f * (ay - py[k]);
    }
    px.set(nx); py.set(ny);
  }
  // an outward normal per outline node, averaged over its two edges and then
  // along the loop, so the sides shade smoothly instead of facet by facet
  const rnx = new Float32Array(n), rny = new Float32Array(n), hasRim = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (next[k] < 0 || prev[k] < 0 || multi[k]) continue;
    const ex = px[next[k]] - px[prev[k]], ey = py[next[k]] - py[prev[k]], len = Math.hypot(ex, ey) || 1;
    rnx[k] = ey / len; rny[k] = -ex / len; hasRim[k] = 1;
  }
  for (let pass = 0; pass < 2; pass++) {
    const sx = Float32Array.from(rnx), sy = Float32Array.from(rny);
    for (let k = 0; k < n; k++) {
      if (!hasRim[k] || !hasRim[prev[k]] || !hasRim[next[k]]) continue;
      const x = rnx[prev[k]] + 2 * rnx[k] + rnx[next[k]], y = rny[prev[k]] + 2 * rny[k] + rny[next[k]], len = Math.hypot(x, y) || 1;
      sx[k] = x / len; sy[k] = y / len;
    }
    rnx.set(sx); rny.set(sy);
  }

  // front vertices (shared), back vertices (shared), then skirt quads
  const frontIdx = new Int32Array(n).fill(-1);
  const P = [], N = [], U = [], I = [];
  const uvOf = (k) => [(px[k] + width / 2) / width, (py[k] - y0) / height];
  let count = 0;
  for (let k = 0; k < n; k++) if (used[k]) { frontIdx[k] = count++; P.push(px[k], py[k], pz[k]); U.push(...uvOf(k)); }
  // front normals from the slope of the relief
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    if (!used[k]) continue;
    const l = i > 0 && used[k - 1] ? k - 1 : k, r = i < gw - 1 && used[k + 1] ? k + 1 : k;
    const u = j > 0 && used[k - gw] ? k - gw : k, d = j < gh - 1 && used[k + gw] ? k + gw : k;
    // slopes over the regular grid spacing (not the snapped positions), so the
    // shading stays even where the outline nodes were moved
    const dzdx = r !== l ? (pz[r] - pz[l]) / ((r - l) * cw) : 0;
    const dzdy = u !== d ? (pz[u] - pz[d]) / ((d - u) / gw * ch) : 0;
    const len = Math.hypot(dzdx, dzdy, 1);
    N.push(-dzdx / len, -dzdy / len, 1 / len);
  }
  const backBase = count;
  for (let k = 0; k < n; k++) if (used[k]) { P.push(px[k], py[k], zBack); N.push(0, 0, -1); U.push(...uvOf(k)); }
  // faces
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    if (!cellIn(i, j)) continue;
    const a = frontIdx[j * gw + i], b = frontIdx[j * gw + i + 1], c = frontIdx[(j + 1) * gw + i + 1], d = frontIdx[(j + 1) * gw + i];
    I.push(a, d, c, a, c, b);
  }
  const frontCount = I.length;
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    if (!cellIn(i, j)) continue;
    const a = frontIdx[j * gw + i] + backBase, b = frontIdx[j * gw + i + 1] + backBase, c = frontIdx[(j + 1) * gw + i + 1] + backBase, d = frontIdx[(j + 1) * gw + i] + backBase;
    I.push(a, c, d, a, b, c);
  }
  // skirts along every cell edge with no filled cell beyond it, facing outward
  let vcount = 2 * count;
  const skirt = (kp, kq) => {
    const dx = px[kq] - px[kp], dy = py[kq] - py[kp], len = Math.hypot(dx, dy) || 1;
    const nx = dy / len, ny = -dx / len; // right of the direction of travel: outward on a counter-clockwise loop
    const [up, vp] = uvOf(kp), [uq, vq] = uvOf(kq);
    const du = -nx * inset / gw, dv = -ny * inset / gh; // sample a little inside the outline for a solid body colour
    const verts = [[px[kp], py[kp], pz[kp]], [px[kp], py[kp], zBack], [px[kq], py[kq], zBack], [px[kq], py[kq], pz[kq]]];
    const uvs = [[up + du, vp + dv], [up + du, vp + dv], [uq + du, vq + dv], [uq + du, vq + dv]];
    const np = hasRim[kp] ? [rnx[kp], rny[kp]] : [nx, ny], nq = hasRim[kq] ? [rnx[kq], rny[kq]] : [nx, ny];
    const norms = [np, np, nq, nq];
    for (let v = 0; v < 4; v++) { P.push(...verts[v]); N.push(norms[v][0], norms[v][1], 0); U.push(...uvs[v]); }
    I.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
    vcount += 4;
  };
  for (let j = 0; j < gh - 1; j++) for (let i = 0; i < gw - 1; i++) {
    if (!cellIn(i, j)) continue;
    const a = j * gw + i, b = a + 1, c = a + gw + 1, d = a + gw;
    if (!cellIn(i - 1, j)) skirt(a, d); // left edge, travelling down
    if (!cellIn(i, j + 1)) skirt(d, c); // bottom edge, travelling right
    if (!cellIn(i + 1, j)) skirt(c, b); // right edge, travelling up
    if (!cellIn(i, j - 1)) skirt(b, a); // top edge, travelling left
  }
  return { positions: new Float32Array(P), normals: new Float32Array(N), uvs: new Float32Array(U), indices: new Uint32Array(I), frontCount, cells, grid: [gw, gh] };
}

// A depth map when no model is available: the object swells towards its middle
// (distance from the outline), which already beats a flat slab.
export function pillowDepth(alpha, gw, gh, threshold = 110) {
  const n = gw * gh, inside = new Uint8Array(n), dist = new Float32Array(n).fill(1e9), q = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) inside[i] = alpha[i] >= threshold ? 1 : 0;
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const k = j * gw + i;
    if (!inside[k]) continue;
    const edge = i === 0 || j === 0 || i === gw - 1 || j === gh - 1 || !inside[k - 1] || !inside[k + 1] || !inside[k - gw] || !inside[k + gw];
    if (edge) { dist[k] = 0; q[tail++] = k; }
  }
  while (head < tail) {
    const k = q[head++], x = k % gw, y = (k - x) / gw, dn = dist[k] + 1;
    for (const m of [x > 0 ? k - 1 : -1, x < gw - 1 ? k + 1 : -1, y > 0 ? k - gw : -1, y < gh - 1 ? k + gw : -1]) if (m >= 0 && inside[m] && dist[m] > dn) { dist[m] = dn; q[tail++] = m; }
  }
  let max = 0;
  for (let i = 0; i < n; i++) if (inside[i] && dist[i] < 1e9) max = Math.max(max, dist[i]);
  const out = new Float32Array(n);
  const reach = Math.max(1, Math.min(max, Math.min(gw, gh) * 0.18));
  for (let i = 0; i < n; i++) out[i] = inside[i] ? Math.sqrt(Math.min(1, dist[i] / reach)) : 0;
  return out;
}
