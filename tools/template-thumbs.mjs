// Renders the gallery thumbnail of every built-in template (its default
// atmosphere, interface hidden, fully refined) into assets/templates/<id>.webp.
// Usage: node tools/template-thumbs.mjs [url] [ids...]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const [PAGE = 'http://127.0.0.1:8765/', ...ONLY] = process.argv.slice(2);
const OUT = new URL('../assets/templates/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${tmpdir()}/chrome-thumbs-${Date.now()}`, args: ['--window-size=1200,820'], defaultViewport: { width: 1200, height: 820 }, protocolTimeout: 600000 });
const page = await browser.newPage(); page.setDefaultTimeout(300000);
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'), { timeout: 60000 });
await page.addStyleTag({ content: 'body > *:not(#viewport) { display: none !important; }' });
const ids = await page.evaluate(() => import('/src/templates.js').then((m) => m.TEMPLATES.map((t) => t.id)));
for (const id of ids.filter((i) => !ONLY.length || ONLY.includes(i))) {
  await page.evaluate(async (id) => {
    const m = await import('/src/templates.js'); const { ATMOSPHERE_BY_ID } = await import('/src/atmospheres.js');
    const r = window.__roomsmith, t = m.TEMPLATE_BY_ID[id], a = ATMOSPHERE_BY_ID[t.atmosphere];
    r.scene.setDrift(false); r.scene.setInsets({ left: 0, right: 0, top: 0, bottom: 0 }); r.scene.setGripsVisible(false); r.interaction.select(null);
    r.store.update((p) => { const room = p.rooms.find((x) => x.id === p.activeRoomId); m.applyTemplateTo(room, t, () => Math.random().toString(36).slice(2)); p.atmosphere = a.id; p.time = a.time; p.lamps = a.lamps; });
    r.scene.resetView(false);
  }, id);
  await new Promise((z) => setTimeout(z, 500));
  await page.waitForFunction(() => window.__roomsmith.scene.idle, { polling: 100 });
  const shot = await page.screenshot();
  // trim the backdrop margins a little and save a compact WebP
  await sharp(shot).extract({ left: 90, top: 40, width: 1020, height: 680 }).resize(720, 480).webp({ quality: 84 }).toFile(`${OUT}${id}.webp`);
  console.log('thumb', id);
}
await browser.close();
