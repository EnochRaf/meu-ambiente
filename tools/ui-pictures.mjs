// Renders the pictures the interface shows for its choices:
//  - a swatch for every named finish (src/finishes.js): a small sample of the
//    real material under soft studio light -> assets/ui/swatches/<mat>-<id>.webp
//  - a preview of each style applied to a furnished room -> assets/ui/styles/<id>.webp
// Usage: node tools/ui-pictures.mjs [url] [swatches|styles]
import puppeteer from 'puppeteer-core';
import { CHROME } from './chrome.mjs';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
const [PAGE = 'http://127.0.0.1:8765/', ONLY = ''] = process.argv.slice(2);
const OUT = new URL('../assets/ui/', import.meta.url).pathname;
mkdirSync(OUT + 'swatches', { recursive: true }); mkdirSync(OUT + 'styles', { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: `${tmpdir()}/chrome-uipics-${Date.now()}`, args: ['--window-size=1200,820'], defaultViewport: { width: 1200, height: 820 }, protocolTimeout: 900000 });
const page = await browser.newPage(); page.setDefaultTimeout(600000);
await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('roomsmith:tour', '1'); });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__roomsmith && document.querySelector('#loading').classList.contains('gone'), { timeout: 120000 });
const webp = (dataUrl, file, w, h) => sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).resize(w, h).webp({ quality: 86 }).toFile(file);

if (!ONLY || ONLY === 'swatches') {
  const shots = await page.evaluate(async () => {
    const THREE = await import('three'), { RoundedBoxGeometry } = await import('three/addons/geometries/RoundedBoxGeometry.js');
    const { makeMaterial, boxUV } = await import('/src/materials.js'), { createStudioEnv, lookAt } = await import('/src/look.js'), { FINISHES } = await import('/src/finishes.js');
    const S = 220, renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(S, S, false); renderer.setPixelRatio(2); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.85;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const scene = new THREE.Scene(); scene.environment = createStudioEnv(renderer).update(lookAt(1)); scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight('#ffffff', '#c9c2b8', 0.85));
    const key = new THREE.DirectionalLight('#fff1dc', 2.3); key.position.set(-1.5, 3, 1.2); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.normalBias = 0.01; scene.add(key);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.ShadowMaterial({ opacity: 0.16 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    const out = {};
    for (const f of FINISHES) {
      // floors and walls as a 80 cm sample laid out like the room, soft goods as a small cushion, the rest as a plate
      const surface = ['wood', 'stone', 'tile', 'concrete', 'paint'].includes(f.mat), soft = ['fabric', 'leather', 'carpet'].includes(f.mat);
      const s = surface ? 0.8 : soft ? 0.22 : 0.26;
      const geo = soft ? new RoundedBoxGeometry(s, s * 0.32, s, 7, s * 0.13) : new RoundedBoxGeometry(s, s * 0.07, s, 4, s * 0.025);
      if (surface) { const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) + s / 2, p.getZ(i) + s / 2); } else boxUV(geo);
      if (soft) { const p = geo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (s / 2), z = p.getZ(i) / (s / 2), y = p.getY(i); p.setY(i, y + Math.sign(y) * Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z) * s * 0.05); } geo.computeVertexNormals(); }
      const mesh = new THREE.Mesh(geo, makeMaterial({ mat: f.mat, color: f.color }, surface ? 'surface' : 'object'));
      mesh.castShadow = mesh.receiveShadow = true; mesh.rotation.y = 0.35; mesh.position.y = soft ? s * 0.18 : s * 0.035; scene.add(mesh);
      const k = s / 0.8 * 1.38; cam.position.set(0.78 * k, 1.12 * k, 1.08 * k); cam.lookAt(0, mesh.position.y * 0.4, 0);
      Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.01, far: 8 }); key.shadow.camera.updateProjectionMatrix();
      renderer.render(scene, cam); out[`${f.mat}-${f.id}`] = renderer.domElement.toDataURL('image/png');
      scene.remove(mesh); geo.dispose();
    }
    return out;
  });
  for (const [name, url] of Object.entries(shots)) await webp(url, `${OUT}swatches/${name}.webp`, 200, 200);
  console.log('swatches', Object.keys(shots).length);
}

if (!ONLY || ONLY === 'styles') {
  await page.addStyleTag({ content: 'body > *:not(#viewport) { display: none !important; }' });
  const ids = await page.evaluate(() => import('/src/styles.js').then((m) => m.STYLES.map((s) => s.id)));
  for (const sid of ids) {
    await page.evaluate(async (sid) => {
      const st = await import('/src/styles.js'), cat = await import('/src/catalog.js'), m = await import('/src/templates.js'); const r = window.__roomsmith;
      r.scene.setDrift(false); r.scene.setGripsVisible(false); r.scene.setInsets({ left: 0, right: 0, top: 0, bottom: 0 }); r.interaction.select(null);
      r.store.update((p) => { const room = p.rooms.find((x) => x.id === p.activeRoomId); m.applyTemplateTo(room, m.TEMPLATE_BY_ID['living-warm-modern'], () => Math.random().toString(36).slice(2)); st.applyStyle(room, st.STYLE_BY_ID[sid], cat.DEFS); p.atmosphere = 'bright-day'; p.time = 1; p.lamps = 0; });
      r.scene.resetView(false);
    }, sid);
    await new Promise((z) => setTimeout(z, 500));
    await page.waitForFunction(() => window.__roomsmith.scene.idle, { polling: 100 });
    const shot = await page.screenshot({ clip: { x: 230, y: 120, width: 740, height: 555 } });
    await sharp(shot).resize(360, 270).webp({ quality: 84 }).toFile(`${OUT}styles/${sid}.webp`);
    console.log('style', sid);
  }
}
await browser.close();
