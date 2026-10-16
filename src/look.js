// The look of each time of day: lights, the soft backdrop behind the room and the
// studio environment for reflections. The backdrop is a small canvas painting,
// a gentle gradient with soft blurred light. (The window views are photos: views.js.)
import * as THREE from 'three';

const dirFrom = (el, az) => { const e = THREE.MathUtils.degToRad(el), a = THREE.MathUtils.degToRad(az); return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)); };
// Azimuth: 0 = back wall (north), 90 = right wall (east), 180 = front, 270 = left.
// 0 morning, 1 midday, 2 evening, 3 night
const KEYS = [
  { el: 20, az: 110, sun: '#ffd6aa', sunI: 2.8, sky: '#dfe8f4', ground: '#cdbfae', hemiI: 0.42, env: 0.16, exposure: 1.05, glow: 0,
    top: '#e5ebf3', bottom: '#f6ece1', haze: '#ffe9d0', hazeAt: [0.82, 0.6], hazeI: 0.9, cool: '#d9e4f1',
    lift: [0.012, 0.006, 0], gain: [1.02, 1.0, 0.97], sat: 1.04, con: 1.03, vig: 0.12 },
  { el: 50, az: 222, sun: '#fff5e8', sunI: 3.4, sky: '#e6eefa', ground: '#d3cdc2', hemiI: 0.48, env: 0.18, exposure: 1.02, glow: 0,
    top: '#d6dee8', bottom: '#e6e2db', haze: '#fbf7f0', hazeAt: [0.3, 0.3], hazeI: 0.75, cool: '#cbd8e6',
    lift: [0, 0, 0.004], gain: [1, 1, 1], sat: 1.05, con: 1.05, vig: 0.1 },
  { el: 13, az: 240, sun: '#ffa05e', sunI: 3.0, sky: '#e6cbbd', ground: '#8f7a70', hemiI: 0.32, env: 0.12, exposure: 1.12, glow: 0.55,
    top: '#d8d0d8', bottom: '#f1dccb', haze: '#ffc9a0', hazeAt: [0.14, 0.66], hazeI: 0.7, cool: '#cdc8de',
    lift: [0.02, 0.006, 0.02], gain: [1.06, 0.99, 0.92], sat: 1.08, con: 1.05, vig: 0.16 },
  { el: 38, az: 300, sun: '#9fb1e0', sunI: 0.1, sky: '#3f3d47', ground: '#33281f', hemiI: 0.17, env: 0.05, exposure: 1.25, glow: 1,
    top: '#2c3445', bottom: '#454554', haze: '#6c7486', hazeAt: [0.8, 0.24], hazeI: 0.55, cool: '#3d4556',
    lift: [0, 0.006, 0.02], gain: [0.98, 0.98, 1.03], sat: 0.98, con: 1.05, vig: 0.2 },
];
export const TIME_LABELS = ['Morning', 'Midday', 'Evening', 'Night'];

export function lookAt(t) {
  t = Math.min(3, Math.max(0, t));
  const i = Math.min(2, Math.floor(t)), f = t - i, a = KEYS[i], b = KEYS[i + 1];
  const n = (k) => a[k] + (b[k] - a[k]) * f, c = (k) => new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), f), v = (k) => a[k].map((x, j) => x + (b[k][j] - x) * f);
  return {
    t, sun: dirFrom(n('el'), n('az')).normalize(), sunColor: c('sun'), sunI: n('sunI'), sky: c('sky'), ground: c('ground'), hemiI: n('hemiI'),
    env: n('env'), exposure: n('exposure'), glow: n('glow'), top: c('top'), bottom: c('bottom'), haze: c('haze'), hazeAt: v('hazeAt'), hazeI: n('hazeI'), cool: c('cool'),
    lift: v('lift'), gain: v('gain'), sat: n('sat'), con: n('con'), vig: n('vig'),
  };
}

const css = (col, a = 1) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
function dither(ctx, w, h, amt = 3) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const r = (Math.random() - 0.5) * amt; d[i] += r; d[i + 1] += r; d[i + 2] += r; }
  ctx.putImageData(img, 0, 0);
}

// ---- backdrop ------------------------------------------------------------------------
// One small canvas, used as scene.background (drawn as a screen-filling quad).
export function createBackdrop() {
  const W = 384, H = 240, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  function paint(L) {
    const g = canvas.getContext('2d', { willReadFrequently: true }); if (!g || !g.createLinearGradient) return;
    const lin = g.createLinearGradient(0, 0, 0, H); lin.addColorStop(0, css(L.top)); lin.addColorStop(1, css(L.bottom));
    g.filter = 'none'; g.fillStyle = lin; g.fillRect(0, 0, W, H);
    g.filter = 'blur(28px)';
    // a broad soft light where the sun (or moon) sits, a cool counter-glow opposite,
    // and a pale pool below the room that grounds it
    const blob = (x, y, rx, ry, col, a) => { g.fillStyle = css(col, a); g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
    blob(L.hazeAt[0] * W, L.hazeAt[1] * H, W * 0.32, H * 0.3, L.haze, 0.55 * L.hazeI);
    blob(L.hazeAt[0] * W, L.hazeAt[1] * H, W * 0.14, H * 0.12, L.haze, 0.5 * L.hazeI);
    blob((1 - L.hazeAt[0]) * W, H * 0.3, W * 0.3, H * 0.26, L.cool, 0.45);
    const floorGlow = L.glow > 0.8 ? new THREE.Color('#4b4d58') : L.bottom.clone().lerp(new THREE.Color('#ffffff'), 0.5);
    blob(W * 0.5, H * 0.86, W * 0.42, H * 0.16, floorGlow, 0.6);
    g.filter = 'none'; dither(g, W, H, 2.5);
    tex.needsUpdate = true;
  }
  return { texture: tex, paint };
}

// ---- studio environment for reflections ------------------------------------------------
// Our own small scene, rendered into a prefiltered environment map: a soft
// gradient dome, a broad daylight panel and a small warm panel that stands for
// the lamps. Rebuilt (at low resolution) when the look changes, so glossy
// floors, ceramics and metal pick up highlights that match the hour and mood.
export function createStudioEnv(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const dome = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uLow: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uTop, uHor, uLow; varying vec3 vDir; void main(){ float y = vDir.y; vec3 c = y > 0.0 ? mix(uHor, uTop, pow(y, 0.6)) : mix(uHor, uLow, pow(-y, 0.5)); gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), dome));
  const panel = (w, h, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#fff', side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); scene.add(m); return m; };
  const day = panel(7, 4.5, -6.5, 3.5, 3), day2 = panel(3, 6, 4, 2.5, -7.5), lamp = panel(1.6, 1.6, 6, 1.2, 4);
  let rt = null, key = '';
  function update(L) {
    const k = [L.t.toFixed(2), L.lampLevel?.toFixed(2), L.top.getHexString(), L.exposure.toFixed(2)].join('|');
    if (k === key && rt) return rt.texture;
    key = k;
    const night = THREE.MathUtils.smoothstep(L.t, 2.2, 2.9);
    dome.uniforms.uTop.value.copy(L.sky).multiplyScalar(0.9);
    dome.uniforms.uHor.value.copy(L.top).lerp(L.bottom, 0.5);
    dome.uniforms.uLow.value.copy(L.ground).multiplyScalar(0.7);
    day.material.color.copy(L.sunColor).multiplyScalar(5 * (1 - night) + 0.2);
    day2.material.color.copy(L.sky).multiplyScalar(2.5 * (1 - night) + 0.15);
    lamp.material.color.copy(L.lampColor || new THREE.Color('#ffc890')).multiplyScalar(6 * (L.lampLevel || 0));
    lamp.visible = (L.lampLevel || 0) > 0.02;
    const next = pmrem.fromScene(scene, 0.03, 0.1, 30, { size: 128 });
    rt?.dispose(); rt = next;
    return rt.texture;
  }
  return { update };
}
