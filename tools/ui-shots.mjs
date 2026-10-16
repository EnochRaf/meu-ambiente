// Screenshots of the interface: each drawer, a selected piece with its toolbar,
// and a hover description. Usage: node tools/ui-shots.mjs <outDir> [url] [width height]
// THEME=light|dark picks the interface theme (default: the saved or automatic one);
// LANG_UI=pt-BR|en the language (default: Portuguese); PHOTO=a photo for the photo steps.
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const [OUT, PAGE = 'http://127.0.0.1:8765/', W = '1440', H = '900'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${tmpdir()}/chrome-ui-${Date.now()}`, defaultViewport: { width: +W, height: +H }, protocolTimeout: 600000 });
const page = await browser.newPage(); page.setDefaultTimeout(300000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.evaluate((t, l) => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); if (t) localStorage.setItem('roomsmith:theme', t); if (l) localStorage.setItem('roomsmith:lang', l); }, process.env.THEME || '', process.env.LANG_UI || '');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'), { timeout: 120000 });
// the living room template, golden evening
await page.evaluate(async () => {
  const m = await import('/src/templates.js'); const r = window.__roomsmith;
  r.scene.setDrift(false);
  r.store.update((p) => { const room = p.rooms.find((x) => x.id === p.activeRoomId); m.applyTemplateTo(room, m.TEMPLATE_BY_ID['living-warm-modern'], () => Math.random().toString(36).slice(2)); room.name = 'Living room'; p.atmosphere = 'golden-evening'; p.time = 2; p.lamps = 0.6; });
  r.scene.resetView(false);
});
const idle = () => page.waitForFunction(() => window.__roomsmith.scene.idle, { polling: 100 });
const shot = async (name) => { await sleep(500); await idle(); await sleep(250); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(name); };
const drawer = async (id) => { await page.evaluate((id) => window.__roomsmith.ui.openDrawer(id), id); await page.evaluate(() => window.__roomsmith.scene.resetView(false)); };
await drawer('rooms'); await page.waitForFunction(() => [...document.querySelectorAll('#drawer img')].every((i) => i.complete)); await shot('rooms');
await drawer('furniture'); await sleep(2500); await shot('furniture');
await drawer('atmosphere'); await sleep(400); await idle(); await page.waitForFunction(() => [...document.querySelectorAll('#atmo-picks img')].every((i) => i.src.startsWith('data:')), { timeout: 60000 }).catch(() => console.log('no previews')); await shot('atmosphere');
// select the sofa and open materials from its toolbar
await page.evaluate(() => { const r = window.__roomsmith; const room = r.store.get().rooms.find((x) => x.id === r.store.get().activeRoomId); const s = room.items.find((i) => i.type === 'sofa'); r.interaction.select({ kind: 'item', id: s.id }); });
await sleep(300); await page.click('#pb-color'); await sleep(300); await shot('materials-sofa');
await page.evaluate(() => window.__roomsmith.interaction.select(null)); await drawer('materials'); await shot('materials-floor');
await drawer('settings'); await shot('settings');
// a hover description on a furniture card, with the drawer open
await drawer('furniture'); await sleep(1500);
const card = await page.$('#pieces .pick:nth-child(2)'); const box = await card.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await sleep(900); await page.screenshot({ path: `${OUT}/hover.png` }); console.log('hover');
// nothing open: the room takes the whole window
await page.evaluate(() => window.__roomsmith.ui.closeDrawer()); await page.mouse.move(5, 890); await page.evaluate(() => window.__roomsmith.scene.resetView(false)); await shot('closed');
// the toolbar beside a selected piece, closed drawer
await page.evaluate(() => { const r = window.__roomsmith; const room = r.store.get().rooms.find((x) => x.id === r.store.get().activeRoomId); const s = room.items.find((i) => i.type === 'loungeChair2'); r.interaction.select({ kind: 'item', id: s.id }); });
await sleep(400); await page.screenshot({ path: `${OUT}/toolbar.png` }); console.log('toolbar');
await page.evaluate(() => window.__roomsmith.interaction.select(null));
// the tour
await page.evaluate(() => { window.__roomsmith.ui.openDrawer('settings'); document.querySelector('#help').click(); });
await sleep(600); await page.screenshot({ path: `${OUT}/tour.png` }); console.log('tour');
await page.click('#tour-skip'); await sleep(300);
// adding a room: templates, or an empty room of a chosen kind with its floor plan
await page.evaluate(() => { window.__roomsmith.ui.openDrawer('rooms'); document.querySelector('#add-room').click(); });
await page.waitForFunction(() => [...document.querySelectorAll('#tpl-gallery img')].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete && i.naturalWidth)); await sleep(400);
await page.screenshot({ path: `${OUT}/gallery-templates.png` }); console.log('gallery-templates');
await page.click('#tpl-tabs [data-tab="empty"]'); await sleep(400);
await page.screenshot({ path: `${OUT}/gallery-empty.png` }); console.log('gallery-empty');
await page.click('#tpl-close');
// applying a template asks first
await page.evaluate(() => { window.__roomsmith.ui.openDrawer('rooms'); document.querySelector('#open-templates').click(); }); await sleep(400);
await page.click('#tpl-gallery .tpl-card[data-tpl="kitchen-scandi"]'); await sleep(300);
await page.screenshot({ path: `${OUT}/gallery-confirm.png` }); console.log('gallery-confirm');
await page.click('#tpl-close');
// save as template
await page.evaluate(() => document.querySelector('#save-template').click()); await sleep(800);
await page.screenshot({ path: `${OUT}/save-template.png` }); console.log('save-template');
await page.click('#save-tpl-cancel');
// adding from a photo
await page.evaluate(() => { window.__roomsmith.ui.openDrawer('furniture'); document.querySelector('#add-photo').click(); }); await sleep(500);
await page.screenshot({ path: `${OUT}/photo.png` }); console.log('photo');
// the photo steps (cutout, then size and preview), with a photo of your own: PHOTO=path/to/photo.jpg
if (process.env.PHOTO) {
  const input = await page.$('#ph-file'); await input.uploadFile(process.env.PHOTO);
  await page.waitForFunction(() => !document.querySelector('#ph-next1').disabled); await page.click('#ph-next1'); await sleep(1500);
  await page.screenshot({ path: `${OUT}/photo-cutout.png` }); console.log('photo-cutout');
  await page.click('#ph-next2'); await sleep(2500);
  await page.screenshot({ path: `${OUT}/photo-size.png` }); console.log('photo-size');
}
if (errors.length) console.log('ERRORS\n' + [...new Set(errors)].slice(0, 10).join('\n'));
await browser.close();
