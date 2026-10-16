// Screenshots of a furnished living room once the image has fully refined.
// Usage: node tools/shoot.mjs <url> <outDir> [quality] [shots...]
// A shot is name:time:view[:atmosphere], view = default | close | top | floor | cam_x_y_z_tx_ty_tz; e.g. midday:1:default, cozy:0:close:cozy-night
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const [URL, OUT, QUALITY = 'medium', ...SHOTS] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const shots = (SHOTS.length ? SHOTS : ['midday:1:default', 'evening:2:default', 'night:3:default', 'midday-close:1:close', 'evening-close:2:close', 'night-close:3:close']).map((s) => { const [name, t, view, extra] = s.split(':'); return { name, t: +t, view, extra }; });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${tmpdir()}/chrome-shoot-${Date.now()}`, args: ['--window-size=1400,900', '--no-first-run'], defaultViewport: { width: 1400, height: 900, deviceScaleFactor: Number(process.env.DPR || 1) }, protocolTimeout: 600000 });
const page = await browser.newPage(); page.setDefaultTimeout(300000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); localStorage.setItem('roomsmith:quality2', q); }, QUALITY);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'), { timeout: 60000 });
const furnish = (balcony) => page.evaluate((balcony) => window.__roomsmith.store.update((p) => { const r = p.rooms.find((x) => x.id === p.activeRoomId); r.items = [
  { id: 'm1', type: 'rug', x: 3.0, z: 1.7, rot: 0 }, { id: 'm2', type: 'sofa', x: 3.1, z: 0.46, rot: 0 }, { id: 'm3', type: 'coffee', x: 3.1, z: 1.6, rot: 0 },
  { id: 'm4', type: 'armchair', x: 4.4, z: 2.2, rot: -Math.PI / 2 }, { id: 'm5', type: 'lamp', x: 4.65, z: 0.35, rot: 0 }, { id: 'm6', type: 'plant', x: 0.4, z: 3.6, rot: 0 },
  { id: 'm7', type: 'bookcase', x: 0.2, z: 0.8, rot: Math.PI / 2 }, { id: 'm8', type: 'art', wall: 'N', u: 3.1, y: 1.65 }];
  if (balcony) r.view = balcony; }), balcony);
if (process.env.OLD_LAYOUT) await furnish(process.env.VIEW || null);
await page.evaluate(() => window.__roomsmith.scene.setDrift(false));
if (process.env.SETUP) await page.evaluate(process.env.SETUP);
await page.evaluate(() => { window.__roomsmith.ui.closeDrawer(); window.__roomsmith.interaction.select(null); });
const idle = () => page.waitForFunction(() => window.__roomsmith.scene.idle, { polling: 100 });
for (const s of shots) {
  await page.evaluate((s) => {
    const { store, scene } = window.__roomsmith;
    if (s.extra) { window.__roomsmith.ui.openDrawer('atmosphere'); document.querySelector(`#atmo-picks [data-atmo="${s.extra}"]`).click(); window.__roomsmith.ui.closeDrawer(); } // name:time:view:atmosphere
    else store.update((p) => { p.time = s.t; p.atmosphere = null; p.lamps = null; });
    scene.resetView(false);
    const r = store.get().rooms.find((x) => x.id === store.get().activeRoomId);
    if (s.view === 'close') { scene.camera.position.set(1.7, 1.55, 4.9); scene.controls.target.set(4.1, 0.55, 1.3); }
    if (s.view === 'reading') { scene.camera.position.set(2.6, 1.1, 2.4); scene.controls.target.set(4.6, 0.8, 0.4); }
    if (s.view === 'top') { scene.camera.position.set(r.width / 2 + 0.01, 11, r.length / 2 + 0.6); scene.controls.target.set(r.width / 2, 0, r.length / 2); }
    // cam_x_y_z_tx_ty_tz: any camera position and target
    if (s.view.startsWith('cam_')) { const v = s.view.split('_').slice(1).map(Number); scene.camera.position.set(v[0], v[1], v[2]); scene.controls.target.set(v[3], v[4], v[5]); }
    if (s.view === 'floor') { scene.camera.position.set(1.4, 0.8, 4.6); scene.controls.target.set(4.0, 0.45, 0.9); }
    scene.controls.update(); scene.requestRender();
  }, s);
  await sleep(400); await idle(); await sleep(150);
  const t0 = Date.now();
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  const st = await page.evaluate(() => window.__roomsmith.scene.stats);
  console.log(s.name, JSON.stringify(st));
}
if (errors.length) console.log('ERRORS', [...new Set(errors)].slice(0, 10).join('\n'));
await browser.close();
