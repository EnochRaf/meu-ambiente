// Quality presets. Rendering is continuous; these set how good each frame is.
// High renders above screen resolution (up to `budget` pixels) and scales down.
// The scene lowers quality on its own only if frames drop below 30 per second.
// Once the view is still, `samples` jittered frames are averaged into one
// refined image (smoother edges, softer shadows).
export const QUALITY = {
  low: { name: 'Low', ratio: 1, budget: 1.4e6, aoScale: 0.5, shadow: 2048, shadowRadius: 2, ao: false, aoSamples: 8, reflection: 1, reflectionScale: 0.35, msaa: 0, smaa: true, dof: false, texture: 512, bloom: true, samples: 8, lampShadows: false },
  medium: { name: 'Medium', ratio: 1.5, budget: 2.8e6, aoScale: 0.5, shadow: 2048, shadowRadius: 2.5, ao: true, aoSamples: 12, reflection: 1, reflectionScale: 0.5, msaa: 4, smaa: true, dof: true, texture: 1024, bloom: true, samples: 16, lampShadows: true },
  high: { name: 'High', ratio: 2, budget: 5.2e6, aoScale: 1, shadow: 4096, shadowRadius: 2.5, ao: true, aoSamples: 16, reflection: 1, reflectionScale: 0.75, msaa: 4, smaa: true, dof: true, texture: 1024, bloom: true, samples: 32, lampShadows: true },
};
export const QUALITY_LEVELS = Object.keys(QUALITY);
export const Q = { ...QUALITY.high, level: 'high' };
export function setQuality(level) { Object.assign(Q, QUALITY[level] || QUALITY.high, { level: QUALITY[level] ? level : 'high' }); }
export function loadQuality() { try { const q = localStorage.getItem('roomsmith:quality2'); if (QUALITY[q]) return q; } catch {} return 'high'; }
export function saveQuality(q) { try { localStorage.setItem('roomsmith:quality2', q); } catch {} }
