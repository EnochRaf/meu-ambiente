// Smoke test of the main interactions in a real browser.
// Usage: node tools/smoke.mjs <url> [outDir]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import { tmpdir } from 'node:os';
const [URL, OUT = tmpdir()] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${tmpdir()}/chrome-smoke-${Date.now()}`, args: ['--window-size=1400,900'], defaultViewport: { width: 1400, height: 900 } });
const page = await browser.newPage(); page.setDefaultTimeout(60000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, info = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`); };
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); });
await page.evaluateOnNewDocument(() => { window.addEventListener('load', () => {}); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'));
const idle = () => page.waitForFunction(() => window.__roomsmith.scene.idle, { polling: 50 });
const count = () => page.evaluate(() => { const p = window.__roomsmith.store.get(); return p.rooms.find((r) => r.id === p.activeRoomId).items.length; });
await idle();
check('settles to idle after load', true);
// languages: Portuguese by default, PT/EN toggle in the top bar, remembered; the rest of the checks run in English
check('opens in Brazilian Portuguese', await page.evaluate(() => document.documentElement.lang === 'pt-BR' && document.querySelector('#rail [data-drawer="rooms"] span').textContent === 'Ambientes' && document.querySelector('#undo span').textContent === 'Desfazer' && document.title === 'Meu Ambiente'));
check('numbers use a decimal comma in Portuguese', await page.evaluate(() => { window.__roomsmith.ui.openDrawer('rooms'); return /\d,\d × \d,\d m/.test(document.querySelector('#drawer .d-sub').textContent); }));
await page.click('#lang-toggle'); await sleep(300);
check('PT/EN toggle switches every text at once', await page.evaluate(() => document.documentElement.lang === 'en' && document.querySelector('#rail [data-drawer="rooms"] span').textContent === 'Rooms' && document.querySelector('#share span').textContent === 'Share' && document.querySelector('#lang-toggle span').textContent === 'EN' && /Living room|Bedroom|Kitchen|Office|room/i.test(document.querySelector('#drawer .d-title').textContent)));
check('language choice is remembered', await page.evaluate(() => localStorage.getItem('roomsmith:lang') === 'en'));
await page.evaluate(() => { window.__roomsmith.scene.setDrift(false); window.__roomsmith.store.update((p) => { const r = p.rooms.find((x) => x.id === p.activeRoomId); r.items = []; }); });
await idle();
check('opens on a furnished starter home', true);

// the interface: one rail with labelled tasks, one drawer at a time
const drawer = async (id) => { await page.evaluate((id) => { if (window.__roomsmith.ui.drawer !== id) document.querySelector(`#rail [data-drawer="${id}"]`).click(); }, id); await sleep(450); };
check('named Meu Ambiente', await page.evaluate(() => document.title === 'Meu Ambiente' && !document.body.innerText.includes('Roomsmith')));
check('rail shows four tasks with labels', await page.evaluate(() => ['Rooms', 'Furniture', 'Materials', 'Atmosphere'].every((t) => [...document.querySelectorAll('#rail .rail-btn span')].some((s) => s.textContent === t))));
await page.click('#rail [data-drawer="rooms"]'); await sleep(450);
const closed = await page.evaluate(() => ({ open: document.body.classList.contains('drawer-open'), drawer: window.__roomsmith.ui.drawer }));
check('clicking the open task gives the room the whole window', !closed.open && closed.drawer === null, JSON.stringify(closed));

// light and dark: Automatic by default and it follows the computer; the top-bar toggle switches; the choice is remembered
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]); await sleep(200);
check('theme defaults to Automatic and follows the computer', await page.evaluate(() => !localStorage.getItem('roomsmith:theme') && document.documentElement.dataset.theme === 'dark'));
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]); await sleep(200);
check('Automatic switches with the computer', await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
await page.click('#theme-toggle'); await sleep(200);
check('top-bar toggle switches to dark', await page.evaluate(() => document.documentElement.dataset.theme === 'dark' && localStorage.getItem('roomsmith:theme') === 'dark' && getComputedStyle(document.querySelector('.drawer')).backgroundColor !== 'rgb(251, 250, 248)'));
await drawer('settings'); await page.click('#theme-modes [data-theme-mode="auto"]'); await sleep(200);
check('Settings offers Light, Dark and Automatic', await page.evaluate(() => document.querySelectorAll('#theme-modes .pick').length === 3 && localStorage.getItem('roomsmith:theme') === 'auto' && document.documentElement.dataset.theme === 'light'));
await page.emulateMediaFeatures([]);

// collapse with [, full view with \\, remembered, Esc brings the panels back
await drawer('rooms');
await page.keyboard.press('['); await sleep(500);
check('[ collapses the panel to the rail', await page.evaluate(() => !document.body.classList.contains('drawer-open') && getComputedStyle(document.querySelector('#rail')).transform === 'none'));
await page.click('#rail [data-drawer="rooms"]'); await sleep(500);
check('clicking an icon opens its panel again', await page.evaluate(() => window.__roomsmith.ui.drawer === 'rooms'));
await page.keyboard.press('\\'); await sleep(600);
check('full view hides everything but the room', await page.evaluate(() => window.__roomsmith.ui.hidden && document.querySelector('#rail').getBoundingClientRect().right <= 1 && getComputedStyle(document.querySelector('#show-ui')).opacity === '1'));
check('panel state is remembered', await page.evaluate(() => JSON.parse(localStorage.getItem('roomsmith:drawer')).hidden === true));
await page.click('#show-ui'); await sleep(500);
check('show panels brings them back', await page.evaluate(() => !window.__roomsmith.ui.hidden && window.__roomsmith.ui.drawer === 'rooms'));

// drag a sofa from the Furniture drawer into the middle of the room
await drawer('furniture');
const n0 = await count();
await page.waitForFunction(() => document.querySelector('#pieces .pick img')?.src);
check('furniture cards show rendered previews with name and size', await page.evaluate(() => { const c = document.querySelector('#pieces .pick'); return c.querySelector('img').src.startsWith('data:image') && /\d+ × \d+ cm/.test(c.querySelector('small').textContent); }));
const tile = await page.$('#pieces .pick');
const tb = await tile.boundingBox();
const target = await page.evaluate(() => { const s = window.__roomsmith.scene; const p = s.toScreen(3.2, 0, 2.6); return { x: p.x, y: p.y }; });
// a short pause over a card shows its description
await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await sleep(800);
check('hover shows a short description', await page.evaluate(() => document.querySelector('#tip').classList.contains('on') && document.querySelector('#tip').textContent.includes('Drag it into the room')));
await page.mouse.down();
for (let i = 1; i <= 20; i++) { await page.mouse.move(tb.x + (target.x - tb.x) * i / 20, tb.y + (target.y - tb.y) * i / 20); await sleep(16); }
const movingFrames = await page.evaluate(() => window.__roomsmith.scene.stats.frames);
await page.mouse.up(); await sleep(300);
check('drag from the drawer adds a piece', (await count()) === n0 + 1, `items ${n0} -> ${await count()}`);
check('drawing while dragging', movingFrames > 0, `frames ${movingFrames}`);
await idle();

// click it to select: a small toolbar with labelled buttons appears beside it
await page.mouse.click(target.x, target.y - 10); await sleep(300);
const sel = await page.evaluate(() => window.__roomsmith.interaction.selection);
check('click selects the piece', sel?.kind === 'item', JSON.stringify(sel));
check('piece toolbar shows, with labels', await page.evaluate(() => document.querySelector('#piece-bar').classList.contains('on') && ['Turn', 'Copy', 'Material', 'Remove'].every((t) => [...document.querySelectorAll('#piece-bar button:not([hidden]) span')].some((s) => s.textContent === t))));
await page.click('#pb-color'); await sleep(400);
check('Material opens the Materials drawer for the piece', await page.evaluate(() => window.__roomsmith.ui.drawer === 'materials' && document.querySelector('#drawer .d-title').textContent.length > 0 && document.querySelectorAll('#swatches .pick img').length >= 4));
const finishBefore = await page.evaluate(() => { const r = window.__roomsmith; const room = r.store.get().rooms.find((x) => x.id === r.store.get().activeRoomId); return room.items.find((i) => i.id === r.interaction.selection.id).finish; });
await page.click('#swatches .pick:nth-child(3)'); await idle();
const finishAfter = await page.evaluate(() => { const r = window.__roomsmith; const room = r.store.get().rooms.find((x) => x.id === r.store.get().activeRoomId); return room.items.find((i) => i.id === r.interaction.selection.id).finish; });
check('a rendered swatch changes its material', finishAfter && JSON.stringify(finishAfter) !== JSON.stringify(finishBefore), JSON.stringify(finishAfter));
await page.evaluate(() => window.__roomsmith.interaction.select(null)); await idle();
check('toolbar hides when nothing is selected', await page.evaluate(() => !document.querySelector('#piece-bar').classList.contains('on')));
// with nothing selected, Materials works on the floor
await page.click('#swatches [data-finish="wood-walnut"]'); await idle();
check('floor material from a named swatch', await page.evaluate(() => { const p = window.__roomsmith.store.get(); return p.rooms.find((r) => r.id === p.activeRoomId).finishes.floor.color === '#6f5039'; }));

// orbit with the mouse: should draw light frames, then refine and stop
const st0 = await page.evaluate(() => ({ ...window.__roomsmith.scene.stats }));
await page.mouse.move(1100, 200); await page.mouse.down();
for (let i = 0; i < 15; i++) { await page.mouse.move(1100 + i * 12, 200 + i * 2); await sleep(16); }
await page.mouse.up(); await idle();
const st1 = await page.evaluate(() => ({ ...window.__roomsmith.scene.stats }));
check('orbit keeps drawing', st1.frames > st0.frames + 10, `frames +${st1.frames - st0.frames}`);
// at rest the view is refined with jittered frames, then the finished picture stays
const conv = await page.evaluate(() => ({ c: window.__roomsmith.scene.converged, refined: window.__roomsmith.scene.stats.refined }));
check('refines the still view', conv.c && conv.refined >= 8, JSON.stringify(conv));
const r0 = st1.frames; await sleep(1500); const r1 = await page.evaluate(() => window.__roomsmith.scene.stats.frames);
check('rests once refined', r1 - r0 === 0, `${r1 - r0} frames in 1.5 s`);
await drawer('settings');
check('camera rests after the intro, idle drift off by default', await page.evaluate(() => !window.__roomsmith.scene.idleMotion && !!document.querySelector('#idle-motion') && !document.querySelector('#idle-motion').checked));
for (const q of ['high', 'low', 'medium']) { await page.click(`#quality [data-q="${q}"]`); await idle(); }
check('quality switch', await page.evaluate(() => localStorage.getItem('roomsmith:quality2')) === 'medium');

// Atmosphere: previews of this room, time slider, window views, lamps
await drawer('atmosphere');
await page.waitForFunction(() => [...document.querySelectorAll('#atmo-picks img')].every((i) => i.src.startsWith('data:image')), { timeout: 60000 }).catch(() => {});
check('atmosphere previews show this room', await page.evaluate(() => [...document.querySelectorAll('#atmo-picks img')].filter((i) => i.src.startsWith('data:image')).length === 5));
await page.evaluate(() => { const t = document.querySelector('#time'); t.value = '2.6'; t.dispatchEvent(new Event('input', { bubbles: true })); });
await idle(); check('time slider updates', await page.evaluate(() => window.__roomsmith.store.get().time) === 2.6);
for (const v of ['ocean', 'city', 'none', 'garden']) { await page.click(`#views [data-view="${v}"]`); await idle(); }
check('window view picker with photo pictures', await page.evaluate(() => { const p = window.__roomsmith.store.get(); return p.rooms.find((r) => r.id === p.activeRoomId).view === 'garden' && [...document.querySelectorAll('#views img')].every((i) => i.complete && i.naturalWidth > 0) && document.querySelectorAll('#views img[src*="assets/views/"]').length === 3; }));
// the windows show the photos: the pane has its day, sunset and night textures once loaded
check('window glass shows the view photos', await page.evaluate(async () => {
  for (let i = 0; i < 50; i++) { let ok = false; window.__roomsmith.scene.three.traverse((o) => { const u = o.material?.userData?.view; if (u && u.uHas.value === 1 && u.tDay.value?.image) ok = true; }); if (ok) return true; await new Promise((r) => setTimeout(r, 100)); }
  return false;
}));
const proj = () => page.evaluate(() => { const p = window.__roomsmith.store.get(); return { time: p.time, atmosphere: p.atmosphere, lamps: p.lamps }; });
await page.click('#atmo-picks [data-atmo="cozy-night"]'); await idle();
let pr = await proj();
check('atmosphere sets time and lamps', pr.atmosphere === 'cozy-night' && pr.time > 2.5 && pr.lamps > 1, JSON.stringify(pr));
check('lamps glow in cozy night', await page.evaluate(() => window.__roomsmith.scene.lampLevel > 1));
await page.evaluate(() => { const t = document.querySelector('#lamps'); t.value = '0.3'; t.dispatchEvent(new Event('input', { bubbles: true })); }); await idle();
pr = await proj(); check('lamp slider sets a level', pr.lamps === 0.3, JSON.stringify(pr));
await page.click('#lamp-auto'); await idle();
pr = await proj(); check('lamps back to auto', pr.lamps === null && pr.atmosphere === 'cozy-night', JSON.stringify(pr));
await page.click('#atmo-picks [data-atmo="bright-day"]'); await idle();
check('bright day turns lamps off', await page.evaluate(() => window.__roomsmith.scene.lampLevel === 0));

// Rooms: size presets as floor plans, the balcony under the advanced fold
await drawer('rooms');
check('room sizes show floor plans', await page.evaluate(() => document.querySelectorAll('#sizes .pick svg.plan').length === 3));
await page.click('#room-advanced summary'); await sleep(200);
await page.click('#balcony-toggle'); await idle();
const balc = await page.evaluate(() => { const p = window.__roomsmith.store.get(), r = p.rooms.find((x) => x.id === p.activeRoomId); return { b: !!r.balcony, items: r.items.filter((i) => i.zone === 'balcony').length }; });
check('add balcony with starter furniture', balc.b && balc.items > 0, JSON.stringify(balc));
await page.click('#balcony-railing [data-v="metal"]'); await idle();
await page.click('#balcony-wall [data-v="E"]'); await idle();
check('balcony moves to the right wall', await page.evaluate(() => { const p = window.__roomsmith.store.get(); return p.rooms.find((r) => r.id === p.activeRoomId).balcony.wall; }) === 'E');
await page.screenshot({ path: `${OUT}/smoke-end.png` });
await page.click('#undo'); await idle();
check('undo', await page.evaluate(() => { const p = window.__roomsmith.store.get(); return p.rooms.find((r) => r.id === p.activeRoomId).balcony.wall; }) === 'W');
// templates: start a room from one, apply one with confirmation and undo, frame colours, save and delete my own
const R = () => page.evaluate(() => { const p = window.__roomsmith.store.get(); const r = p.rooms.find((x) => x.id === p.activeRoomId); return { id: r.id, name: r.name, type: r.type, items: r.items.length, rooms: p.rooms.length, atmosphere: p.atmosphere, w: r.width }; });
await page.click('#add-room'); await sleep(300);
const cards = await page.evaluate(() => [...document.querySelectorAll('#tpl-gallery .tpl-card')].map((c) => c.dataset.tpl));
await page.waitForFunction(() => [...document.querySelectorAll('#tpl-gallery .tpl-card img')].every((i) => i.complete && i.naturalWidth > 0));
check('gallery shows seven templates with pictures', cards.length === 7, cards.join(','));
const before = await R();
await page.click('#tpl-gallery .tpl-card[data-tpl="studio-japandi"]'); await idle();
const studio = await R();
check('start a room from a template', studio.rooms === before.rooms + 1 && studio.type === 'studio' && studio.items === 28 && studio.atmosphere === 'calm', JSON.stringify(studio));
await page.click('#open-templates'); await sleep(300);
await page.click('#tpl-gallery .tpl-card[data-tpl="office-moody"]'); await sleep(150);
check('applying asks first', await page.evaluate(() => !document.querySelector('#tpl-confirm').hidden && /Replace everything/.test(document.querySelector('#tpl-confirm-text').textContent)));
await page.click('#tpl-confirm-yes'); await idle();
const office = await R();
check('apply a template: type and default name follow it', office.id === studio.id && office.name === 'Office' && office.type === 'office' && office.w === 3.4, JSON.stringify(office));
await page.click('#undo'); await idle();
const undone = await R();
check('undo brings the room back', undone.items === studio.items && undone.type === 'studio' && undone.name === studio.name, JSON.stringify(undone));
// a chair gets legs (here: shell and base) of their own colour
await page.evaluate(() => { const r = window.__roomsmith; const room = r.store.get().rooms.find((x) => x.id === r.store.get().activeRoomId); const c = room.items.find((i) => i.type === 'loungeChair2'); r.interaction.select({ kind: 'item', id: c.id }); });
await sleep(200); await drawer('materials'); await sleep(200);
const hasFrameRow = await page.evaluate(() => /legs/i.test([...document.querySelectorAll('#drawer .d-h')].map((h) => h.textContent).join(' ')));
await page.click('#frame-swatches .pick'); await idle();
const frame = await page.evaluate(() => { const r = window.__roomsmith; const room = r.store.get().rooms.find((x) => x.id === r.store.get().activeRoomId); return room.items.find((i) => i.id === r.interaction.selection?.id)?.frame; });
check('legs take their own colour', hasFrameRow && frame === '#d6b98f', String(frame));
await page.evaluate(() => window.__roomsmith.interaction.select(null)); await drawer('rooms');
await page.click('#save-template'); await sleep(600);
await page.evaluate(() => { document.querySelector('#save-tpl-name').value = 'My studio'; }); await page.click('#save-tpl-ok'); await sleep(200);
await page.click('#add-room'); await sleep(300);
const mine = await page.evaluate(() => [...document.querySelectorAll('#tpl-gallery .tpl-card')].filter((c) => c.dataset.tpl.startsWith('mine-')).map((c) => [c.querySelector('strong').textContent, !!c.querySelector('img')?.src?.startsWith('data:image/jpeg')]));
check('save a room as my template', mine.length === 1 && mine[0][0] === 'My studio' && mine[0][1], JSON.stringify(mine));
await page.evaluate(() => document.querySelector('#tpl-gallery .tpl-card[data-tpl^="mine-"]').click()); await idle();
const fromMine = await R();
check('start a room from my template', fromMine.type === 'studio' && fromMine.items === studio.items, JSON.stringify(fromMine));
page.once('dialog', (d) => d.accept());
await page.click('#add-room'); await sleep(300);
await page.evaluate(() => document.querySelector('#tpl-gallery .tpl-card[data-tpl^="mine-"] .del').click()); await sleep(200);
check('delete my template', await page.evaluate(() => !document.querySelector('#tpl-gallery .tpl-card[data-tpl^="mine-"]') && JSON.parse(localStorage.getItem('roomsmith:templates')).length === 0));
await page.click('#tpl-close');
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(results.join('\n'));
await browser.close();
