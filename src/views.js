// The views through the windows: real panoramic photos (CC0, Poly Haven; see
// ASSETS.md and tools/views.mjs), one per view and time of day, softened a
// little like a photo focused on the room. Glass projects them onto a large
// sphere around the room, so near things shift against far ones as the camera
// moves. The main window looks at the best part of each photo; other walls
// look a little to either side of it. A faint reflection of the room's light
// lies on top, and the frames and curtains stay in front, as real geometry.
import * as THREE from 'three';

const BASE = new URL('../assets/views/', import.meta.url).href;
export const VIEW_IDS = ['garden', 'ocean', 'city', 'none'];
const TIMES = ['day', 'sunset', 'night'];
const BAND = { top: 50, bottom: -40 };   // degrees of elevation in the files (tools/views.mjs)
// radius: distance of the projection sphere (m), smaller = more parallax; spread: how far
// (as a fraction of the real angle) a window on another wall turns from the main view;
// pitch: degrees the horizon sits below the window's middle line
const LOOK = {
  garden: { radius: 16, spread: 0.55, pitch: 7 },
  ocean: { radius: 28, spread: 0.3, pitch: 3 },
  city: { radius: 30, spread: 0.45, pitch: 4 },
};
export const pickPicture = (view, time) => `${BASE}${view}-${time}-pick.webp`;
export const timeSlot = (t) => (t > 2.55 ? 'night' : t > 1.55 ? 'sunset' : 'day');

// photos load when a view is first shown; each resolves to its texture
const loader = new THREE.TextureLoader(), cache = new Map();
let anisotropy = 4;
export const setAnisotropy = (a) => { anisotropy = a; };
export function loadView(view) {
  if (!LOOK[view]) return Promise.resolve(null);
  if (!cache.has(view)) {
    cache.set(view, Promise.all(TIMES.map((t) => loader.loadAsync(`${BASE}${view}-${t}.webp`).then((tex) => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = anisotropy; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
      return tex;
    }))).then((list) => Object.fromEntries(TIMES.map((t, i) => [t, list[i]]))).catch((e) => { cache.delete(view); console.warn('view', view, e); return null; }));
  }
  return cache.get(view);
}

// how much of each photo shows at time t (0 morning, 1 midday, 2 evening, 3 night)
export function viewWeights(t) {
  const s = THREE.MathUtils.smoothstep;
  const night = s(t, 2.3, 2.8), sunset = s(t, 1.25, 1.9) * (1 - night);
  return new THREE.Vector3(Math.max(0, 1 - sunset - night), sunset, night);
}

// three.js's ACES fit, undone: the glass writes the radiance that the tone
// mapping turns back into the photo as it is, so the view keeps its natural
// colour and contrast instead of being flattened a second time.
const IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777);
const OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602);
const IN_INV = IN.clone().invert(), OUT_INV = OUT.clone().invert();

// azimuth of a wall's outward direction (0 = north, -z)
export const WALL_AZ = { N: 0, E: Math.PI / 2, S: Math.PI, W: -Math.PI / 2 };

export function viewGlassMaterial(wall) {
  const m = new THREE.MeshStandardMaterial({ color: '#000000', roughness: 0.05, metalness: 0, envMapIntensity: 6 });
  const u = {
    tDay: { value: null }, tSunset: { value: null }, tNight: { value: null }, uW: { value: new THREE.Vector3(1, 0, 0) }, uHas: { value: 0 },
    uCenter: { value: new THREE.Vector3() }, uRadius: { value: 20 }, uLift: { value: 0.06 }, uNear: { value: 0.5 }, uWide: { value: 1.6 },
    uWallAz: { value: 0 }, uYaw: { value: 0 }, uPitch: { value: 0 }, uBand: { value: new THREE.Vector2(THREE.MathUtils.degToRad(BAND.top), THREE.MathUtils.degToRad(BAND.bottom)) },
    uBright: { value: 1 }, uTint: { value: new THREE.Color('#ffffff') }, uExposure: { value: 1 }, uFallback: { value: new THREE.Color('#c9d6df') },
    uInM: { value: IN_INV }, uOutM: { value: OUT_INV }, uSheen: { value: new THREE.Color('#000000') },
  };
  m.userData.view = u; m.userData.wallAz = WALL_AZ[wall] ?? 0;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vViewWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvViewWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vViewWorld;
      uniform sampler2D tDay, tSunset, tNight; uniform vec3 uW, uCenter, uTint, uFallback, uSheen; uniform float uHas, uRadius, uLift, uNear, uWide, uWallAz, uYaw, uPitch, uBright, uExposure;
      uniform vec2 uBand; uniform mat3 uInM, uOutM;
      vec3 acesFitInv(vec3 y) {
        vec3 A = y * 0.983729 - 1.0, B = y * 0.4329510 - 0.0245786, C = y * 0.238081 + 0.000090537;
        return (-B - sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);
      }
      // radiance that three.js's ACES tone mapping shows as the colour c
      vec3 untonemap(vec3 c) {
        vec3 y = max(uOutM * clamp(c, 0.0, 0.93), 0.0);
        return max(uInM * acesFitInv(y), 0.0) * 0.6 / uExposure;
      }
      vec3 viewColour() {
        // the viewer, brought in towards the room and down to eye height (the camera floats high
        // outside the room, but the view should look as it does standing inside), then from there
        // through this point of the glass to the sphere
        vec3 eye = vec3(mix(uCenter.x, cameraPosition.x, uNear), mix(uCenter.y, cameraPosition.y, uLift), mix(uCenter.z, cameraPosition.z, uNear));
        vec3 d = normalize(vViewWorld - eye), o = vViewWorld - uCenter;
        float b = dot(o, d), c = dot(o, o) - uRadius * uRadius, t = -b + sqrt(max(b * b - c, 0.0));
        vec3 dir = normalize(o + d * t);
        // angles from straight out of this wall, widened a little like a wide lens, then turned to this wall's part of the photo
        float rel = atan(dir.x, -dir.z) - uWallAz;
        rel = mod(rel + PI, 2.0 * PI) - PI; // continuous across the window; the seam lies behind it
        float az = rel * uWide + uYaw, el = asin(clamp(dir.y, -1.0, 1.0)) * uWide + radians(uPitch);
        vec2 uv = vec2(0.5 + az / (2.0 * PI), (el - uBand.y) / (uBand.x - uBand.y));
        vec3 col = vec3(0.0);
        if (uW.x > 0.001) col += uW.x * texture2D(tDay, uv).rgb;
        if (uW.y > 0.001) col += uW.y * texture2D(tSunset, uv).rgb;
        if (uW.z > 0.001) col += uW.z * texture2D(tNight, uv).rgb;
        return col;
      }`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 view = uHas > 0.5 ? viewColour() * uTint * uBright : uFallback * uBright;
        // a faint reflection of the room: stronger at a slant, brighter towards the top of the pane
        float fres = 0.05 + 0.95 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 5.0);
        float up = smoothstep(0.5, 2.6, vViewWorld.y);
        view += uSheen * (0.55 + 0.45 * up) * min(1.0, fres * 2.2);
        totalEmissiveRadiance = untonemap(view);
      }`);
  };
  m.customProgramCacheKey = () => 'view-glass';
  return m;
}

// per-view settings for the panes of a room: the sphere's centre and the main window's direction
export function setupPanes(panes, view, room, mainAz) {
  const look = LOOK[view];
  for (const p of panes) {
    const u = p.material.userData.view;
    u.uCenter.value.set(room.width / 2, 1.55, room.length / 2);
    if (!look) { u.uHas.value = 0; continue; }
    u.uRadius.value = look.radius + Math.max(room.width, room.length) / 2; u.uPitch.value = look.pitch;
    // the main window faces the photo's best part; others turn a share of their real angle away from it
    let rel = p.material.userData.wallAz - mainAz; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    u.uWallAz.value = p.material.userData.wallAz; u.uYaw.value = rel * look.spread;
  }
}
