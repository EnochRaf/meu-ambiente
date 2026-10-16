// Measure redraws, GPU work and memory for a furnished living room.
// Usage: node tools/measure.mjs <url> <label> <quality> [profileDir]
// Instruments WebGL from outside the app (no app changes needed), so it works
// on any version. Prints one JSON line.
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
const [URL, LABEL, QUALITY = 'medium', DIR = tmpdir()] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${DIR}/chrome-measure-${LABEL}-${QUALITY}-${Date.now()}`, args: ['--window-size=1400,900', '--no-first-run', '--enable-precise-memory-info'], defaultViewport: { width: 1400, height: 900 }, protocolTimeout: 600000 });
const page = await browser.newPage(); page.setDefaultTimeout(300000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.evaluateOnNewDocument(() => {
  const P = WebGL2RenderingContext.prototype, st = (window.__gl = { draws: 0, verts: 0, frames: 0, rafs: 0, bytes: 0, buffers: 0, textures: 0 });
  let drew = false; const tick = () => { st.rafs++; if (drew) st.frames++; drew = false; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  for (const [n, c, k] of [['drawArrays', 2, -1], ['drawElements', 1, -1], ['drawArraysInstanced', 2, 3], ['drawElementsInstanced', 1, 4]]) {
    const o = P[n]; P[n] = function (...a) { st.draws++; st.verts += a[c] * (k >= 0 ? a[k] : 1); drew = true; return o.apply(this, a); };
  }
  const size = new WeakMap(), bufBind = {}, texBind = {}, rbBind = {}; let unit = 0;
  const set = (obj, bytes) => { if (!obj) return; const prev = size.get(obj) || 0; st.bytes += bytes - prev; size.set(obj, bytes); };
  const bpp = (f) => ({ 0x881A: 8, 0x8814: 16, 0x822F: 4, 0x8230: 8, 0x81A6: 3, 0x81A5: 2, 0x8CAC: 4, 0x88F0: 4, 0x1909: 1, 0x8229: 1, 0x822B: 2, 0x8C43: 4, 0x8058: 4, 0x8051: 3 }[f] || 4);
  const wrap = (n, fn) => { const o = P[n]; P[n] = function (...a) { fn.call(this, a); return o.apply(this, a); }; };
  wrap('createBuffer', () => st.buffers++); wrap('deleteBuffer', (a) => { st.buffers--; set(a[0], 0); });
  wrap('createTexture', () => st.textures++); wrap('deleteTexture', (a) => { st.textures--; set(a[0], 0); });
  wrap('bindBuffer', (a) => { bufBind[a[0]] = a[1]; });
  wrap('bufferData', (a) => set(bufBind[a[0]], typeof a[1] === 'number' ? a[1] : a[1]?.byteLength || 0));
  wrap('activeTexture', (a) => { unit = a[0]; });
  wrap('bindTexture', (a) => { texBind[unit + ':' + a[0]] = a[1]; });
  wrap('texStorage2D', (a) => { const [t, levels, f, w, h] = a; let b = 0, ww = w, hh = h; for (let i = 0; i < levels; i++) { b += ww * hh * bpp(f); ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); } set(texBind[unit + ':' + t], b); });
  wrap('texImage2D', (a) => { if (a[1] !== 0) return; let w, h; const f = a[2]; if (a.length >= 8) { w = a[3]; h = a[4]; } else { w = a[5]?.width || 0; h = a[5]?.height || 0; } const tex = texBind[unit + ':' + a[0]]; if (a[0] !== 0x0DE1) { set(tex, (size.get(tex) || 0) + w * h * bpp(f)); return; } set(tex, w * h * bpp(f)); });
  wrap('generateMipmap', (a) => { const tex = texBind[unit + ':' + a[0]]; set(tex, Math.round((size.get(tex) || 0) * 1.333)); });
  wrap('bindRenderbuffer', (a) => { rbBind[a[0]] = a[1]; });
  wrap('renderbufferStorage', (a) => set(rbBind[a[0]], a[2] * a[3] * bpp(a[1])));
  wrap('renderbufferStorageMultisample', (a) => set(rbBind[a[0]], a[1] * a[3] * a[4] * bpp(a[2])));
});
const cdp = await page.target().createCDPSession();
await cdp.send('Performance.enable');
const bcdp = await browser.target().createCDPSession();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cpu = async () => { const { processInfo: p } = await bcdp.send('SystemInfo.getProcessInfo'); const by = (re) => p.filter((x) => re.test(x.type)).reduce((s, x) => s + x.cpuTime, 0); return { gpu: by(/gpu/i), renderer: by(/^renderer$/), pids: p.map((x) => [x.type, x.id]) }; };
const rss = (pid) => { try { return Number(execSync(`ps -o rss= -p ${pid}`).toString().trim()) * 1024; } catch { return 0; } };
const gl = () => page.evaluate(() => ({ ...window.__gl }));
const heap = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); return metrics.find((m) => m.name === 'JSHeapUsedSize').value; };

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.evaluate((q) => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); localStorage.setItem('roomsmith:quality2', q); }, QUALITY);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'), { timeout: 60000 });
await page.evaluate(() => window.__roomsmith.scene.settings?.ready);
await page.evaluate(() => window.__roomsmith.store.update((p) => { const r = p.rooms.find((x) => x.id === p.activeRoomId); p.time = 1; r.items = [
  { id: 'm1', type: 'rug', x: 3.0, z: 1.7, rot: 0 }, { id: 'm2', type: 'sofa', x: 3.1, z: 0.46, rot: 0 }, { id: 'm3', type: 'coffee', x: 3.1, z: 1.6, rot: 0 },
  { id: 'm4', type: 'armchair', x: 4.4, z: 2.2, rot: -Math.PI / 2 }, { id: 'm5', type: 'lamp', x: 4.65, z: 0.35, rot: 0 }, { id: 'm6', type: 'plant', x: 0.4, z: 3.6, rot: 0 },
  { id: 'm7', type: 'bookcase', x: 0.2, z: 0.8, rot: Math.PI / 2 }, { id: 'm8', type: 'art', wall: 'N', u: 3.1, y: 1.65 }]; }));
await page.evaluate(() => { window.__roomsmith.ui.closeDrawer(); window.__roomsmith.interaction.select(null); window.__roomsmith.scene.resetView(false); });
await sleep(8000);
const measureWindow = async (ms, during) => {
  const g0 = await gl(), c0 = await cpu(), t0 = Date.now();
  if (during) await page.evaluate(during, ms); else await sleep(ms);
  const g1 = await gl(), c1 = await cpu(), dt = (Date.now() - t0) / 1000;
  return { seconds: +dt.toFixed(2), fps: +((g1.rafs - g0.rafs) / dt).toFixed(1), redrawsPerSec: +((g1.frames - g0.frames) / dt).toFixed(1), drawCallsPerSec: Math.round((g1.draws - g0.draws) / dt), vertsPerSec: Math.round((g1.verts - g0.verts) / dt), gpuProcessCpuPct: +((c1.gpu - c0.gpu) / dt * 100).toFixed(1), rendererCpuPct: +((c1.renderer - c0.renderer) / dt * 100).toFixed(1) };
};
const idle = await measureWindow(6000);
const orbit = await measureWindow(6000, (ms) => new Promise((resolve) => {
  const s = window.__roomsmith.scene, t = s.controls.target, t0 = performance.now();
  const step = () => { const p = s.camera.position.clone().sub(t); const a = 0.01, c = Math.cos(a), sn = Math.sin(a); const x = p.x * c - p.z * sn, z = p.x * sn + p.z * c; s.camera.position.set(t.x + x, t.y + p.y, t.z + z); s.controls.dispatchEvent({ type: 'start' }); s.controls.dispatchEvent({ type: 'change' }); if (performance.now() - t0 < ms) requestAnimationFrame(step); else { s.controls.dispatchEvent({ type: 'end' }); resolve(); } };
  requestAnimationFrame(step);
}));
await sleep(2500);
const afterStop = await measureWindow(4000);
const g = await gl(), c = await cpu();
const gpuPid = c.pids.find(([t]) => /gpu/i.test(t))?.[1], rPid = c.pids.find(([t]) => t === 'renderer')?.[1];
console.log(JSON.stringify({ label: LABEL, quality: QUALITY, idle, orbit, afterStop,
  memory: { jsHeapMB: +((await heap()) / 1048576).toFixed(1), gpuAllocMB: +(g.bytes / 1048576).toFixed(1), glTextures: g.textures, glBuffers: g.buffers, gpuProcessRssMB: Math.round(rss(gpuPid) / 1048576), rendererRssMB: Math.round(rss(rPid) / 1048576) },
  errors }));
await browser.close();
