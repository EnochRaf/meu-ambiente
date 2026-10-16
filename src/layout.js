// Floor and wall patterns drawn in the shader: planks, tiles and stone slabs
// are laid out per pixel from metre UVs, so seams stay razor-sharp at any
// distance (anti-aliased with screen derivatives) and nothing visibly repeats.
// Every board or tile gets its own texture offset, a slightly different tone
// and roughness, softly bevelled edges, and (tiles) a hint of lippage that
// breaks reflections the way real floors do.
//
// The parameters live in material.userData.layout (plain data, so clones keep
// them); patchLamps() calls applyLayout() when compiling.

import * as THREE from 'three';

export const LAYOUTS = {
  // our own dimensions, in metres
  planks: { kind: 1, cell: [1.45, 0.19], gap: 0.0011, bevel: 0.003, toneVar: 0.06, roughVar: 0.25, tilt: 0.0, seam: 0.7, swap: 1 },
  tiles: { kind: 2, cell: [0.6, 0.6], gap: 0.0032, bevel: 0.0025, toneVar: 0.05, roughVar: 0.18, tilt: 0.035, seam: 0.78, swap: 0 },
  slabs: { kind: 3, cell: [0.9, 0.6], gap: 0.0022, bevel: 0.002, toneVar: 0.07, roughVar: 0.2, tilt: 0.02, seam: 0.7, swap: 0 },
  panels: { kind: 2, cell: [1.8, 1.8], gap: 0.0012, bevel: 0.0, toneVar: 0.05, roughVar: 0.15, tilt: 0.0, seam: 0.85, swap: 0 },
};

const COMMON = `
uniform vec4 uLay;     // kind, cell x, cell y, gap
uniform vec4 uLay2;    // bevel, tone variation, roughness variation, lippage
uniform vec4 uLay3;    // seam darkening, swap grain axes, texture scale (1/m), detail strength
float layHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
vec2 lay_st; float lay_seam, lay_edge, lay_h1, lay_h2, lay_h3; vec2 lay_dir;
`;

// map_fragment: compute the cell, sample the detail at a per-cell offset
const MAP = `
{
  vec2 P = vMapUv;
  int kind = int(uLay.x + 0.5);
  vec2 cellSize = uLay.yz, id, local;
  if (kind == 1) {            // planks: rows of boards, random stagger and lengths
    float row = floor(P.y / cellSize.y);
    float len = cellSize.x * (0.75 + 0.5 * layHash(vec2(row, 3.7)));
    float x = P.x + layHash(vec2(row, 1.3)) * len;
    float col = floor(x / len);
    id = vec2(col, row); local = vec2(x - col * len, P.y - row * cellSize.y); cellSize.x = len;
  } else if (kind == 3) {     // slabs: running bond
    float row = floor(P.y / cellSize.y);
    float x = P.x + mod(row, 2.0) * cellSize.x * 0.5;
    float col = floor(x / cellSize.x);
    id = vec2(col, row); local = vec2(x - col * cellSize.x, P.y - row * cellSize.y);
  } else {                    // tiles
    id = floor(P / cellSize); local = P - id * cellSize;
  }
  lay_h1 = layHash(id + 0.17); lay_h2 = layHash(id * 1.71 + 5.3); lay_h3 = layHash(id * 2.37 + 11.1);
  vec2 off = vec2(lay_h1, lay_h2) * vec2(5.3, 3.1);
  vec2 q = local + off;
  lay_st = (uLay3.y > 0.5 ? q.yx : q) * uLay3.z;
  // distance to the nearest edge, and which way that edge lies
  vec2 dl = vec2(min(local.x, cellSize.x - local.x), min(local.y, cellSize.y - local.y));
  lay_edge = min(dl.x, dl.y);
  lay_dir = dl.x < dl.y ? vec2(local.x < cellSize.x * 0.5 ? -1.0 : 1.0, 0.0) : vec2(0.0, local.y < cellSize.y * 0.5 ? -1.0 : 1.0);
  float aa = max(fwidth(P.x), fwidth(P.y)) * 1.2;
  lay_seam = (1.0 - smoothstep(uLay.w * 0.5, uLay.w * 0.5 + aa, lay_edge)) * clamp(uLay.w * 1.6 / max(aa, 1e-5), 0.25, 1.0);
  #ifdef USE_MAP
    float detail = mix(1.0, texture2D(map, lay_st).r * 2.0, uLay3.w);
    diffuseColor.rgb *= detail;
  #endif
  diffuseColor.rgb *= 1.0 + (lay_h3 - 0.5) * uLay2.y * clamp(0.02 / max(aa, 1e-5), 0.4, 1.0);
  diffuseColor.rgb *= mix(1.0, uLay3.x, lay_seam);
}
`;

const ROUGH = `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= texture2D(roughnessMap, lay_st).g * 2.0;
#endif
roughnessFactor *= 1.0 + (lay_h2 - 0.5) * uLay2.z;
roughnessFactor = mix(roughnessFactor, 0.95, lay_seam);
`;

const NORMAL = `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D(normalMap, lay_st).xyz * 2.0 - 1.0;
  if (uLay3.y > 0.5) mapN.xy = mapN.yx;
  mapN.xy *= normalScale;
  // bevelled edges lean away from the board, lippage tilts each tile a little
  float bev = uLay2.x > 0.0 ? 1.0 - smoothstep(uLay.w * 0.5, uLay.w * 0.5 + uLay2.x, lay_edge) : 0.0;
  mapN.xy += lay_dir * bev * 0.55 + (vec2(lay_h1, lay_h3) - 0.5) * uLay2.w;
  normal = normalize(tbn * mapN);
#endif
`;

export function applyLayout(shader, L) {
  shader.uniforms.uLay = { value: new THREE.Vector4(L.kind, L.cell[0], L.cell[1], L.gap) };
  shader.uniforms.uLay2 = { value: new THREE.Vector4(L.bevel, L.toneVar, L.roughVar, L.tilt) };
  shader.uniforms.uLay3 = { value: new THREE.Vector4(L.seam, L.swap, L.texScale || 1, L.gain || 1) };
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + COMMON)
    .replace('#include <map_fragment>', MAP)
    .replace('#include <roughnessmap_fragment>', ROUGH)
    .replace('#include <normal_fragment_maps>', NORMAL);
}
