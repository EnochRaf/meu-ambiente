// Lamp light without three.js lights. Every lamp registers a soft light source;
// each frame the nearest few are written into a small fixed-size uniform array
// that our materials read (see patchLamps). Adding lamps never adds shader cost
// or recompiles, and light ends softly at each lamp's reach instead of burning
// a hot spot into the nearest wall.
//
// Light model (our own): a soft-cored inverse square that fades to nothing at
// the lamp's reach, a slightly wrapped Lambert term, a downward lobe under
// shades, and a gentle specular glint for glossy surfaces.
import * as THREE from 'three';
import { applyLayout } from './layout.js';

export const MAX_LAMPS = 8;
export const MAX_SHADOW_LAMPS = 8; // every lamp in the field also casts soft shadows (lampShadows.js)
const pos = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -999, 0, 0));
const col = Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4());
// World space, so nothing needs re-sending while the camera moves.
export const lampUniforms = {
  uLampPos: { value: pos },  // world position, w = reach
  uLampCol: { value: col },  // linear colour × strength, w = downward focus 0..1
  uLampCount: { value: 0 },
  // shadows of the first uLampShadowCount lamps: an octahedral distance atlas
  uLampShadowMap: { value: null },
  uLampShadowCount: { value: 0 },
  uLampShadowInfo: { value: new THREE.Vector4(3, 1 / 512, 0, 0) }, // tiles per row, texel size
  uLampShadowSeed: { value: 0 },  // rotates the filter each refining frame
  uLampShadowTaps: { value: new THREE.Vector2(6, 8) }, // blocker search and filter taps (0 and 4 while moving)
  uLampShadowR: { value: Array(MAX_SHADOW_LAMPS).fill(0.11) }, // size of each lamp's glowing part (m)
};

// octahedral unfold: direction -> [0,1]² and back (y is "up" on the map)
export const OCT_GLSL = `
vec2 lsOctEncode(vec3 v) {
  v /= abs(v.x) + abs(v.y) + abs(v.z);
  vec2 e = v.xz;
  if (v.y < 0.0) e = (1.0 - abs(v.zx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.z >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}
vec3 lsOctDecode(vec2 uv) {
  vec2 e = uv * 2.0 - 1.0;
  vec3 v = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (v.y < 0.0) v.xz = (1.0 - abs(v.zx)) * vec2(v.x >= 0.0 ? 1.0 : -1.0, v.z >= 0.0 ? 1.0 : -1.0);
  return normalize(v);
}`;
// Soft lamp shadow: a blocker search sets how wide the penumbra is (narrow
// near the blocker, wide far from it), then a rotated disc of taps filters it.
// Each tap is compared against the receiver's own plane, so flat surfaces never
// shadow themselves however wide the filter.
const SHADOW_GLSL = `
uniform sampler2D uLampShadowMap; uniform int uLampShadowCount; uniform vec4 uLampShadowInfo; uniform float uLampShadowSeed; uniform float uLampShadowR[${MAX_SHADOW_LAMPS}]; uniform vec2 uLampShadowTaps;
float lsDepth(int i, vec3 dir) {
  float tiles = uLampShadowInfo.x, h = uLampShadowInfo.y * 0.5;
  vec2 uv = clamp(lsOctEncode(dir), h, 1.0 - h);
  vec2 tile = vec2(mod(float(i), tiles), floor(float(i) / tiles));
  return texture2D(uLampShadowMap, (tile + uv) / tiles).r;
}
float lampShadow(int i, vec3 P, vec3 Ng, vec3 lightPos) {
  vec3 d = P - lightPos; float dist = length(d); vec3 n = d / dist;
  float dn = dot(d, Ng);
  vec3 t = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), b = cross(n, t);
  float a0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uLampShadowSeed) * 6.2831853;
  float R = uLampShadowR[i], minA = uLampShadowInfo.y * 2.2;
  float search = clamp(R * (dist - 0.3) / (dist * 0.3), minA, 0.3);
  float sumB = 0.0, nB = 0.0, NB = uLampShadowTaps.x, NF = uLampShadowTaps.y;
  for (int k = 0; k < 16; k++) {
    if (float(k) >= NB) break;
    float r = sqrt((float(k) + 0.5) / NB) * search, a = a0 + float(k) * 2.3999632;
    vec3 dir = normalize(n + (t * cos(a) + b * sin(a)) * r);
    float dd = dot(dir, Ng), zr = dd < -0.02 ? dn / dd : dist;  // the receiver plane along this tap
    float z = lsDepth(i, dir);
    if (z < zr * 0.985 - 0.012) { sumB += z; nB += 1.0; }
  }
  if (NB > 0.5 && nB < 0.5) return 1.0;
  // without a search (moving frames) assume a blocker part-way to the lamp
  float dB = NB > 0.5 ? sumB / nB : dist * 0.6;
  float pen = clamp(R * (dist - dB) / (dB * dist), minA, 0.35);
  float lit = 0.0;
  for (int k = 0; k < 24; k++) {
    if (float(k) >= NF) break;
    float r = sqrt((float(k) + 0.5) / NF) * pen, a = a0 * 1.618 + float(k) * 2.3999632;
    vec3 dir = normalize(n + (t * cos(a) + b * sin(a)) * r);
    float dd = dot(dir, Ng), zr = dd < -0.02 ? dn / dd : dist;
    lit += step(zr * 0.985 - 0.012, lsDepth(i, dir));
  }
  return lit / NF;
}`;


const DECL = `uniform vec4 uLampPos[${MAX_LAMPS}]; uniform vec4 uLampCol[${MAX_LAMPS}]; uniform int uLampCount; varying vec3 vLampWorld;` + OCT_GLSL + SHADOW_GLSL;
const LOOP = `
if (uLampCount > 0) {
  vec3 lp_n = inverseTransformDirection(normal, viewMatrix), lp_v = normalize(cameraPosition - vLampWorld);
  vec3 lp_g = inverseTransformDirection(nonPerturbedNormal, viewMatrix);
  for (int i = 0; i < ${MAX_LAMPS}; i++) {
    if (i >= uLampCount) break;
    vec4 L = uLampPos[i];
    vec3 d = L.xyz - vLampWorld; float dist = length(d); vec3 l = d / max(dist, 1e-4);
    float core = 0.12;                                    // soft core: no singularity at the bulb
    float fall = core / (dist * dist + core) * smoothstep(L.w, L.w * 0.3, dist);
    float below = clamp(-l.y, 0.0, 1.0);                  // 1 straight under the lamp
    float lobe = 1.0 + uLampCol[i].w * (below * 1.4 - 0.45);
    float wrap = clamp((dot(lp_n, l) + 0.3) / 1.3, 0.0, 1.0);
    vec3 E = uLampCol[i].rgb * fall * max(lobe, 0.15);
    if (i < uLampShadowCount && uLampShadowTaps.y > 0.5 && wrap > 0.0 && max(E.r, E.g) * wrap > 0.004) {
      // light from behind the surface (wrap) is left unshadowed rather than self-shadowed
      vec3 Ng = dot(lp_g, l) > 0.0 ? lp_g : -lp_g;
      E *= lampShadow(i, vLampWorld + Ng * 0.006, Ng, L.xyz);
    }
    reflectedLight.directDiffuse += E * wrap * BRDF_Lambert(material.diffuseContribution);
    float gl = 1.0 - material.roughness;
    float sp = pow(max(dot(lp_n, normalize(l + lp_v)), 0.0), 4.0 + 220.0 * gl * gl);
    reflectedLight.directSpecular += E * wrap * sp * gl * gl * 0.6 * material.specularColor;
  }
}`;

// Inject the lamp field into a MeshStandard/MeshPhysical material. `extra`
// (optional) receives the shader to add its own changes.
export function patchLamps(material, extra = null, key = '') {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lampUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLampWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + DECL)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + LOOP);
    if (material.userData.layout) applyLayout(shader, material.userData.layout);
    else if (material.userData.detail != null) {
      // detail maps are linear with mean 0.5: colour = our colour × detail, at the chosen strength
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `#ifdef USE_MAP\n  diffuseColor.rgb *= mix(1.0, texture2D(map, vMapUv).r * 2.0, ${material.userData.detail.toFixed(3)});\n#endif`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness;\n#ifdef USE_ROUGHNESSMAP\n  roughnessFactor *= texture2D(roughnessMap, vRoughnessMapUv).g * 2.0;\n#endif');
    }
    extra?.(shader);
  };
  material.customProgramCacheKey = () => 'lamps' + key + (material.userData.layout ? '-layout' : material.userData.detail != null ? '-d' + material.userData.detail.toFixed(3) : '');
  return material;
}

// ---- the registry -------------------------------------------------------------------
const lamps = new Set();
// a lamp source: local position in its object, colour, strength, reach, focus
// `size`: radius of the glowing part, which sets how soft its shadows are
export function makeLampSource({ pos: p, color, strength, reach, focus = 0, size = 0.11 }) {
  return { local: new THREE.Vector3(...p), color: new THREE.Color(color), strength, reach, focus, size, world: new THREE.Vector3(), object: null };
}
export function registerLamps(object) { object.traverse((o) => { for (const s of o.userData.lampSources || []) { s.object = o; lamps.add(s); } }); }
export function unregisterLamps(object) { object.traverse((o) => { for (const s of o.userData.lampSources || []) lamps.delete(s); }); }
export const lampCount = () => lamps.size;

// Write the lamps nearest the room's centre into the uniforms. Values only
// change when lamps, the room or the level change (not as the camera moves).
export function updateLampUniforms(focusPoint, level) {
  const list = [];
  for (const s of lamps) {
    if (!s.object || !visibleChain(s.object)) continue;
    s.world.copy(s.local).applyMatrix4(s.object.matrixWorld);
    list.push({ s, score: s.strength * s.reach / (1 + s.world.distanceToSquared(focusPoint) * 0.05) });
  }
  list.sort((a, b) => b.score - a.score);
  const n = level > 0.001 ? Math.min(MAX_LAMPS, list.length) : 0;
  for (let i = 0; i < MAX_LAMPS; i++) {
    const e = list[i];
    if (i >= n) { pos[i].set(0, -999, 0, 0); col[i].set(0, 0, 0, 0); continue; }
    pos[i].set(e.s.world.x, e.s.world.y, e.s.world.z, e.s.reach);
    const k = e.s.strength * level;
    col[i].set(e.s.color.r * k, e.s.color.g * k, e.s.color.b * k, e.s.focus);
    if (i < MAX_SHADOW_LAMPS) lampUniforms.uLampShadowR.value[i] = e.s.size;
  }
  lampUniforms.uLampCount.value = n;
}
function visibleChain(o) { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; }
