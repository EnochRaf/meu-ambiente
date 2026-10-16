// The window views: real CC0 panoramas from Poly Haven (https://polyhaven.com,
// licence CC0 1.0, no account needed), one per view and time of day.
// Usage: node tools/views.mjs            build assets/views/*.webp and the picker pictures
//        node tools/views.mjs --preview <dir> id[@ev] ...   labelled strips of candidate panoramas, for choosing
// Each panorama is exposed for a natural photo look, tone-mapped, turned so its
// best direction faces the main window, cut to the band a window can show
// (50° above the horizon to 40° below), slightly softened like a lens focused
// on the room, and saved as WebP. Credits go to assets/manifest.json.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { readHDR } from './hdr.mjs';

const ROOT = new URL('..', import.meta.url).pathname, OUT = join(ROOT, 'assets/views'), RAW = join(ROOT, 'node_modules/.cache/roomsmith-assets/hdri');
const FORCE = process.argv.includes('--force');
export const BAND = { top: 50, bottom: -40 }; // degrees of elevation kept
const SIZE = { width: 3072 };                  // 360° across: about 8.5 px per degree

// view → time → photo. yaw: the azimuth (degrees, 0 = middle of the panorama) that
// faces the main window; ev: exposure in stops on top of the automatic exposure;
// grade: small colour adjustments [r, g, b] multipliers and saturation.
export const VIEWS = {
  garden: {
    day: { id: 'symmetrical_garden_02', yaw: -8, ev: 0 },
    // the same garden in the low warm light before dusk
    sunset: { id: 'symmetrical_garden_02', yaw: -8, ev: -1.1, grade: [1.12, 0.92, 0.7], sat: 0.95, dusk: { horizon: [1.55, 0.95, 0.55], zenith: [0.85, 0.72, 0.85] } },
    night: { id: 'ladybrand_heritage_house', yaw: 8, ev: -2.8 },
  },
  ocean: {
    day: { id: 'illovo_beach_balcony', yaw: 92, ev: 0.1 },
    sunset: { id: 'the_sky_is_on_fire', yaw: 12, ev: -0.2 },
    night: { id: 'blue_lagoon_night', yaw: -150, ev: -2.4 },
  },
  city: {
    day: { id: 'homecoming_center_rooftop', yaw: 62, ev: 0 },
    sunset: { id: 'sunset_jhbcentral', yaw: -48, ev: -0.3, grade: [1.08, 0.97, 0.9] },
    night: { id: 'shanghai_bund', yaw: 22, ev: -2.2 },
  },
};

const api = async (path) => { const r = await fetch('https://api.polyhaven.com/' + path); if (!r.ok) throw new Error(path + ' ' + r.status); return r.json(); };
async function fetchHDR(id, res) {
  const file = join(RAW, `${id}_${res}.hdr`);
  if (!existsSync(file) || FORCE) {
    const files = await api('files/' + id), url = files.hdri[res].hdr.url;
    mkdirSync(dirname(file), { recursive: true });
    const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  return readHDR(readFileSync(file));
}

// three.js's ACES filmic fit, so the baked photo has the same tonal character as the room
const mul = (m, r, g, b) => [m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b];
const IN = [0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777];
const OUTM = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const fit = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
function aces(r, g, b) { [r, g, b] = mul(IN, r / 0.6, g / 0.6, b / 0.6); return mul(OUTM, fit(r), fit(g), fit(b)).map((v) => Math.min(1, Math.max(0, v))); }
const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// the band, turned and exposed, as 8-bit sRGB at the source resolution
function band(hdr, { yaw = 0, ev = 0, grade = [1, 1, 1], sat = 1, dusk = null }, top = BAND.top, bottom = BAND.bottom) {
  const { width: W, height: H, data } = hdr;
  const y0 = Math.round((90 - top) / 180 * H), y1 = Math.round((90 - bottom) / 180 * H), h = y1 - y0;
  // automatic exposure: geometric mean luminance near the horizon, brought to a mid grey
  let sum = 0, n = 0;
  for (let y = Math.round(75 / 180 * H); y < Math.round(100 / 180 * H); y += 2) for (let x = 0; x < W; x += 2) { const o = (y * W + x) * 3; sum += Math.log(1e-4 + lum(data[o], data[o + 1], data[o + 2])); n++; }
  const k = 0.2 / Math.exp(sum / n) * Math.pow(2, ev);
  const shift = Math.round((yaw / 360) * W), out = Buffer.alloc(W * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
    const sx = ((x + shift) % W + W) % W, o = ((y + y0) * W + sx) * 3;
    let r = data[o] * k * grade[0], g = data[o + 1] * k * grade[1], b = data[o + 2] * k * grade[2];
    if (dusk) { // a low sun: the sky warm near the horizon and deeper above, the ground in its glow
      const el = top - (y / h) * (top - bottom), f = Math.min(1, Math.max(0, el / 35)), m = dusk.horizon.map((v, i) => v + (dusk.zenith[i] - v) * f);
      r *= m[0]; g *= m[1]; b *= m[2];
    }
    if (sat !== 1) { const l = lum(r, g, b); r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat; }
    const c = aces(Math.max(0, r), Math.max(0, g), Math.max(0, b)), d = (y * W + x) * 3;
    out[d] = Math.round(srgb(c[0]) * 255); out[d + 1] = Math.round(srgb(c[1]) * 255); out[d + 2] = Math.round(srgb(c[2]) * 255);
  }
  return { buf: out, width: W, height: h };
}
const raw = (b) => sharp(b.buf, { raw: { width: b.width, height: b.height, channels: 3 } });

if (process.argv.includes('--preview')) {
  // candidates: a labelled strip per panorama, azimuth marks every 45°
  const dir = process.argv[process.argv.indexOf('--preview') + 1];
  mkdirSync(dir, { recursive: true });
  for (const arg of process.argv.slice(process.argv.indexOf('--preview') + 2)) {
    const [id, ev = '0'] = arg.split('@');
    const b = band(await fetchHDR(id, '2k'), { ev: +ev }, 40, -35);
    const w = 1800, h = Math.round(b.height * w / b.width);
    let marks = '';
    for (let a = -180; a < 180; a += 45) { const x = ((a + 180) / 360) * w; marks += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="white" stroke-opacity="0.35"/><text x="${x + 4}" y="18" font-size="16" fill="white" font-family="Helvetica">${a}</text>`; }
    marks += `<line x1="0" y1="${(40 / 75) * h}" x2="${w}" y2="${(40 / 75) * h}" stroke="yellow" stroke-opacity="0.4"/><text x="8" y="${h - 10}" font-size="20" fill="white" font-family="Helvetica">${id} ev ${ev}</text>`;
    await raw(b).resize(w, h).composite([{ input: Buffer.from(`<svg width="${w}" height="${h}">${marks}</svg>`) }]).jpeg({ quality: 82 }).toFile(join(dir, `${id}@${ev}.jpg`));
    console.log('preview', id);
  }
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const manifestFile = join(ROOT, 'assets/manifest.json'), manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
manifest.views = {};
const credits = {};
for (const [view, times] of Object.entries(VIEWS)) {
  manifest.views[view] = {};
  for (const [time, p] of Object.entries(times)) {
    const hdr = await fetchHDR(p.id, '4k'), b = band(hdr, p);
    const height = Math.round(b.height * SIZE.width / b.width), file = `${view}-${time}.webp`;
    // softened a little, as if the lens were focused on the room
    const info = await raw(b).resize(SIZE.width, height, { kernel: 'lanczos3' }).blur(p.blur ?? 1.1).webp({ quality: 80, smartSubsample: true }).toFile(join(OUT, file));
    // the picker's picture: the part that faces the main window
    const pw = Math.round(b.width * 64 / 360), ph = Math.round(pw * 3 / 4), py = Math.round((BAND.top - 24) / 180 * hdr.height);
    await raw(b).extract({ left: Math.round(b.width / 2 - pw / 2), top: py, width: pw, height: ph }).resize(240, 180).blur(0.6).webp({ quality: 78 }).toFile(join(OUT, `${view}-${time}-pick.webp`));
    if (!credits[p.id]) { const i = await api('info/' + p.id); credits[p.id] = { name: i.name, authors: Object.keys(i.authors), source: `https://polyhaven.com/a/${p.id}` }; }
    manifest.views[view][time] = { file, id: p.id, size: info.size, width: SIZE.width, height };
    console.log(view, time, p.id, Math.round(info.size / 1024) + ' KB');
  }
}
manifest.viewBand = BAND; manifest.viewCredits = credits;
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
