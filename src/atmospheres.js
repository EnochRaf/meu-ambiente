// Atmospheres: one click sets the time of day, how bright the lamps are, the
// warmth of the light, the backdrop palette and the overall tone together.
// Values are our own, tuned by eye. `lamps` is the lamp level the preset sets
// (null = follow the daylight); `lampScale` shapes the automatic level when the
// time is changed afterwards.
import * as THREE from 'three';
import { lookAt } from './look.js';

export const ATMOSPHERES = [
  { id: 'fresh-morning', name: 'Fresh morning', caption: 'Cool early light, crisp and airy', time: 0.3, lamps: 0, lampScale: 0.8,
    warmth: -0.35, exposure: 1.04, sat: 0.97, con: 1.03, lift: [0, 0.006, 0.016], paint: 0.55,
    palette: { top: '#dfe9f3', bottom: '#f4f1ea', haze: '#fff3e2', cool: '#cfe1ef' }, orb: ['#fff6e6', '#d6e6f2'] },
  { id: 'bright-day', name: 'Bright day', caption: 'High sun, clean whites, lamps off', time: 1, lamps: 0, lampScale: 1,
    warmth: 0.06, exposure: 0.97, sat: 1.07, con: 1.08, lift: [0, 0, 0], paint: 0.4, vig: 0.16,
    palette: { top: '#dde8f4', bottom: '#f6f4ef', haze: '#ffffff', cool: '#d3e3f1' }, orb: ['#ffffff', '#cfe0f0'] },
  { id: 'calm', name: 'Calm', caption: 'Soft afternoon, muted and quiet', time: 1.45, lamps: 0.25, lampScale: 0.7,
    warmth: 0.05, exposure: 0.98, sat: 0.84, con: 0.95, lift: [0.016, 0.018, 0.016], paint: 0.65,
    palette: { top: '#e3e6e2', bottom: '#efece6', haze: '#f6f1e8', cool: '#d9e0dc' }, orb: ['#f3efe6', '#cdd8d2'] },
  { id: 'golden-evening', name: 'Golden evening', caption: 'Low warm sun, first lamps on', time: 2, lamps: 0.6, lampScale: 1.1,
    warmth: 0.45, exposure: 1.04, sat: 1.1, con: 1.04, lift: [0.02, 0.008, 0.004], paint: 0.5,
    palette: { top: '#e5d3cf', bottom: '#f6dcc2', haze: '#ffc68e', cool: '#d8c9da' }, orb: ['#ffd29b', '#e3b9b0'] },
  { id: 'cozy-night', name: 'Cozy night', caption: 'Warm lamps, deep blue outside', time: 2.9, lamps: 1.35, lampScale: 1.3,
    warmth: 0.42, exposure: 1.3, sat: 1.0, con: 1.08, lift: [0.01, 0.008, 0.008], paint: 0.6,
    palette: { top: '#1d2230', bottom: '#2f2a2c', haze: '#7a5c4a', cool: '#2a3040' }, orb: ['#ffc98e', '#3a4152'], fog: 0.009, bloomK: 1.25, vig: 0.26 },
];
export const ATMOSPHERE_BY_ID = Object.fromEntries(ATMOSPHERES.map((a) => [a.id, a]));

const WARM = new THREE.Color('#ffc996'), COOL = new THREE.Color('#d5e3ff'), LAMP = new THREE.Color('#ffc890');

// Fold an atmosphere and a lamp setting into a time-of-day look (from look.js).
// Adds L.lampLevel and L.lampColor.
export function withAtmosphere(L, id, lamps = null) {
  const a = ATMOSPHERE_BY_ID[id] || null;
  const auto = L.glow * (a ? a.lampScale : 1);
  L.lampLevel = lamps == null ? auto : lamps;
  L.lampColor = LAMP.clone();
  if (!a) return L;
  const w = a.warmth, tint = w > 0 ? WARM : COOL, k = Math.abs(w);
  L.sunColor.lerp(tint, k * 0.45); L.sky.lerp(tint, k * 0.18);
  if (w > 0) L.lampColor.lerp(new THREE.Color('#ffb070'), w * 0.4); else L.lampColor.lerp(new THREE.Color('#ffe2bf'), k * 0.6);
  L.exposure *= a.exposure; L.sat *= a.sat; L.con *= a.con; L.lift = L.lift.map((v, i) => v + a.lift[i]);
  // white balance in the grade: warm presets lean amber, cool ones lean blue
  L.gain = [L.gain[0] * (1 + 0.05 * w), L.gain[1] * (1 + 0.012 * w), L.gain[2] * (1 - 0.07 * w)];
  L.fog = a.fog ?? L.fog; L.rimK = a.rimK ?? 1; L.bloomK = a.bloomK ?? 1; L.vig = Math.max(L.vig, a.vig ?? 0);
  const night = THREE.MathUtils.smoothstep(L.t, 2.3, 2.9);
  // the backdrop leans towards the preset's palette (less so at night, when the time owns the colour)
  const p = a.paint * (1 - night * 0.5);
  for (const key of ['top', 'bottom', 'haze', 'cool']) L[key].lerp(new THREE.Color(a.palette[key]), key === 'haze' ? p * 0.6 : p);
  return L;
}

// The lamp level a time + atmosphere + lamp setting gives (for labels).
export const lampLevelFor = (time, id, lamps = null) => withAtmosphere(lookAt(time), id, lamps).lampLevel;
