// Soft shadows from lamps. Each of the strongest few lamps renders the room's
// distances into a small cube once (only when something in the room changes);
// the cube is unfolded into one tile of a shared octahedral atlas, so every
// material reads all lamp shadows from a single texture. Materials filter it
// with a blocker search and a penumbra that widens with distance from the
// blocker (see lamps.js), so shadows are crisp where a chair leg meets the
// floor and soft further away, like light from a real lampshade.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { lampUniforms, MAX_SHADOW_LAMPS, OCT_GLSL } from './lamps.js';

const TILES = 3; // 3 × 3 tiles: room for every lamp the field holds

const distVert = `
varying vec3 vW; varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
  #endif
  vec4 w = modelMatrix * p; vW = w.xyz;
  vUv = (uvTransform * vec3(uv, 1.0)).xy;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const distFrag = `
varying vec3 vW; varying vec2 vUv;
uniform vec3 uLight; uniform sampler2D map;
void main() {
  #ifdef ALPHA_CUT
    if (texture2D(map, vUv).a < 0.5) discard;
  #endif
  gl_FragColor = vec4(distance(vW, uLight));
}`;
export function createLampShadows(renderer, { size = 512 } = {}) {
  const float = renderer.extensions.has('EXT_color_buffer_float');
  const type = float ? THREE.FloatType : THREE.HalfFloatType;
  const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, type };
  const cubeRT = new THREE.WebGLCubeRenderTarget(size, nearest);
  const cubeCam = new THREE.CubeCamera(0.03, 30, cubeRT);
  const atlas = new THREE.WebGLRenderTarget(size * TILES, size * TILES, { ...nearest, depthBuffer: false });
  lampUniforms.uLampShadowMap.value = atlas.texture;
  lampUniforms.uLampShadowInfo.value.set(TILES, 1 / size, 0, 0);

  const plain = new THREE.ShaderMaterial({ vertexShader: distVert, fragmentShader: distFrag, side: THREE.DoubleSide,
    uniforms: { uLight: { value: new THREE.Vector3() }, map: { value: null }, uvTransform: { value: new THREE.Matrix3() } } });
  const cut = new Map(); // map texture -> alpha-cut variant
  const distFor = (m) => {
    if (!(m.alphaTest > 0 && m.map)) return plain;
    if (!cut.has(m.map)) {
      const c = plain.clone(); c.defines = { ALPHA_CUT: '' }; c.uniforms.uLight = plain.uniforms.uLight;
      c.uniforms.map.value = m.map; m.map.updateMatrix(); c.uniforms.uvTransform.value = m.map.matrix; cut.set(m.map, c);
    }
    return cut.get(m.map);
  };
  const unfold = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms: { tCube: { value: cubeRT.texture } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform samplerCube tCube; ${OCT_GLSL}
      void main() { gl_FragColor = vec4(textureCube(tCube, lsOctDecode(vUv)).r); }`,
    depthTest: false, depthWrite: false }));

  const clear = new THREE.Color(), far = new THREE.Color(1000, 1000, 1000);
  // what casts lamp shadows: solid, shadow-casting meshes (walls cut away for the
  // view still count, so lamp light never leaks out of the room)
  const casts = (o) => o.isMesh && o.castShadow && !o.userData.blob && !o.userData.proxy && !o.userData.glow && !o.userData.noLampShadow
    && !(Array.isArray(o.material) ? o.material.some((m) => m.transparent) : o.material?.transparent);

  // positions: Vector4 per lamp (xyz world), count: how many to render
  function update(scene, positions, count) {
    count = Math.min(count, MAX_SHADOW_LAMPS);
    lampUniforms.uLampShadowCount.value = count;
    if (!count) return;
    // Everything swapped or hidden here is put back in `finally`: a failure half
    // way must never leave the room in distance materials, hidden, or drawing
    // into the atlas instead of the screen (a frozen view until a reload).
    const swapped = [], hidden = [];
    const bg = scene.background, fog = scene.fog, auto = renderer.autoClear, alpha = renderer.getClearAlpha(), shadowAuto = renderer.shadowMap.enabled;
    renderer.getClearColor(clear);
    try {
    scene.traverseVisible((o) => {
      if (casts(o)) { swapped.push([o, o.material]); o.material = Array.isArray(o.material) ? o.material.map(distFor) : distFor(o.material); }
      else if (o.isMesh || o.isSprite || o.isLine || o.isPoints) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    scene.background = null; scene.fog = null; renderer.autoClear = true; renderer.shadowMap.enabled = false;
    renderer.setClearColor(far, 1);
    for (let i = 0; i < count; i++) {
      const p = positions[i];
      cubeCam.position.set(p.x, p.y, p.z); cubeCam.updateMatrixWorld();
      plain.uniforms.uLight.value.set(p.x, p.y, p.z);
      cubeCam.update(renderer, scene);
      // draw into this lamp's tile only
      atlas.viewport.set((i % TILES) * size, Math.floor(i / TILES) * size, size, size);
      atlas.scissor.copy(atlas.viewport); atlas.scissorTest = true;
      renderer.setRenderTarget(atlas); renderer.autoClear = false;
      unfold.render(renderer);
      renderer.autoClear = true;
    }
    } finally {
      atlas.scissorTest = false;
      renderer.setRenderTarget(null);
      renderer.setClearColor(clear, alpha); renderer.autoClear = auto; renderer.shadowMap.enabled = shadowAuto;
      scene.background = bg; scene.fog = fog;
      for (const [o, m] of swapped) o.material = m;
      for (const o of hidden) o.visible = true;
    }
  }
  return { update, atlas, dispose() { cubeRT.dispose(); atlas.dispose(); } };
}
