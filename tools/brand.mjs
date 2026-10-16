// The icons and the link preview image, made from the logo (favicon.svg) and a
// render of the app's furnished living room.
// Usage: node tools/brand.mjs [url]   (url: the running app, default http://127.0.0.1:8765/)
// Writes favicon.ico (16, 32, 48 px), apple-touch-icon.png (180 px, full bleed),
// assets/brand/icon-192.png, icon-512.png, maskable-512.png, and
// assets/brand/og-image.jpg (1200 × 630, for WhatsApp, Instagram, LinkedIn, X).
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname, OUT = join(ROOT, 'assets/brand');
const URL_APP = process.argv[2] || 'http://127.0.0.1:8765/';
mkdirSync(OUT, { recursive: true });

// ---- icons -------------------------------------------------------------------------------
const svg = readFileSync(join(ROOT, 'favicon.svg'), 'utf8');
const square = svg.replace('rx="12"', 'rx="0"');                       // iOS and Android round the corners themselves
const maskable = square.replace(/<path /g, '<path transform="translate(4 4) scale(.8)" '); // the mark inside the safe zone
const png = (src, size) => sharp(Buffer.from(src), { density: (72 * size) / 40 * 2 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
await sharp(await png(square, 180)).toFile(join(ROOT, 'apple-touch-icon.png'));
for (const s of [192, 512]) await sharp(await png(svg, s)).toFile(join(OUT, `icon-${s}.png`));
await sharp(await png(maskable, 512)).toFile(join(OUT, 'maskable-512.png'));
// favicon.ico: PNG images inside an ICO container
const sizes = [16, 32, 48], images = await Promise.all(sizes.map((s) => png(svg, s)));
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => { const o = 6 + 16 * i; head.writeUInt8(s, o); head.writeUInt8(s, o + 1); head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6); head.writeUInt32LE(images[i].length, o + 8); head.writeUInt32LE(offset, o + 12); offset += images[i].length; });
writeFileSync(join(ROOT, 'favicon.ico'), Buffer.concat([head, ...images]));
console.log('icons');

// ---- link preview ------------------------------------------------------------------------
const W = 1200, H = 630;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${tmpdir()}/chrome-brand-${Date.now()}`, defaultViewport: { width: W, height: H, deviceScaleFactor: 2 }, protocolTimeout: 600000 });
const page = await browser.newPage(); page.setDefaultTimeout(300000);
await page.goto(URL_APP, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); localStorage.setItem('roomsmith:quality2', 'high'); localStorage.setItem('roomsmith:drawer', JSON.stringify({ current: 'rooms', open: false, hidden: true })); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'));
// only the room: no panels, buttons or messages
await page.addStyleTag({ content: '#rail, #drawer, #show-ui, #reset-view, #piece-bar, #measure, #tip, #tour, #toast, #viewport > :not(canvas) { visibility: hidden !important; }' });
await page.evaluate(() => { const r = window.__roomsmith; r.scene.setDrift(false); r.ui.setHidden(true); r.interaction.select(null); r.scene.resetView(false); });
// leave the left side for the title: the view centres on the right part of the picture
await page.evaluate((w) => {
  const r = window.__roomsmith;
  r.scene.three.traverse((o) => { if (o.userData.grip) o.parent.visible = false; }); // no resize handles
  r.scene.setInsets({ left: w, right: 10, top: 46, bottom: 40 }, { animate: false }); r.scene.resetView(false);
}, 470);
await new Promise((r) => setTimeout(r, 800));
await page.waitForFunction(() => window.__roomsmith.scene.idle, { polling: 200 });
await new Promise((r) => setTimeout(r, 500));
const room = Buffer.from(await page.screenshot({ type: 'png' }));
if (process.env.DEBUG_ROOM) writeFileSync(process.env.DEBUG_ROOM, room);

// the title over the picture, in the app's own type
const logo = svg.replace('<svg ', '<svg width="64" height="64" ');
await page.close();
const card = await browser.newPage(); card.setDefaultTimeout(120000);
await card.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await card.setContent(`<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Plus+Jakarta+Sans:wght@500;600&display=block" rel="stylesheet">
<style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(38,26,18,.62) 0%, rgba(38,26,18,.34) 30%, rgba(38,26,18,0) 52%); }
  .text { position: absolute; left: 64px; bottom: 62px; color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,.25); }
  .brand { display: flex; align-items: center; gap: 18px; }
  .brand svg { border-radius: 16px; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
  h1 { font: 600 60px/1 'Fraunces', serif; letter-spacing: -.01em; margin: 0; }
  p { font: 500 25px/1.35 'Plus Jakarta Sans', sans-serif; margin: 18px 0 0; max-width: 470px; opacity: .95; }
</style></head><body><img class="bg" src="data:image/png;base64,${room.toString('base64')}"><div class="shade"></div>
<div class="text"><div class="brand">${logo}<h1>Meu Ambiente</h1></div><p>Planeje e mobílie seus ambientes em 3D, direto no navegador.</p></div>
</body></html>`, { waitUntil: 'load' });
await card.evaluate(async () => { await document.querySelector('.bg').decode(); await document.fonts.ready; await Promise.all(['600 60px Fraunces', '500 25px "Plus Jakarta Sans"'].map((f) => document.fonts.load(f))); });
const image = await card.screenshot({ type: 'png' });
const info = await sharp(image).jpeg({ quality: 84, mozjpeg: true }).toFile(join(OUT, 'og-image.jpg'));
console.log('og-image', Math.round(info.size / 1024), 'KB');
await browser.close();
