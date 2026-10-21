// Planar reflection for the floor. The scene is rendered from a camera mirrored
// in the floor plane into a small mip-mapped target (with depth). The floor's
// own material blends it in:
// - weighted by how shiny the finish is (shineOf), by Fresnel, and by the
//   per-pixel gloss after the roughness map, so seams and grout stay matt;
// - blurred by distance: sharp where a leg meets the floor, softer the farther
//   the reflected point is from the floor (read from the mirror's depth);
// - nudged by the normal map, so boards and tiles ripple it slightly.
// Only re-rendered when something changes.
import * as THREE from 'three';
import { patchLamps } from './lamps.js';

export function createFloorReflection() {
  const depth = new THREE.DepthTexture(1, 1); depth.type = THREE.UnsignedIntType;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthTexture: depth });
  const virtual = new THREE.PerspectiveCamera();
  const texMatrix = new THREE.Matrix4();
  const uniforms = {
    tReflect: { value: target.texture }, tReflDepth: { value: depth }, uReflMatrix: { value: texMatrix }, uReflProjInv: { value: new THREE.Matrix4() },
    uReflStrength: { value: 0 }, uReflBlur: { value: 1 }, uReflBase: { value: 0.5 }, uReflSize: { value: new THREE.Vector2(1, 1) },
  };
  const n = new THREE.Vector3(0, 1, 0), o = new THREE.Vector3(), camPos = new THREE.Vector3(), rot = new THREE.Matrix4(), look = new THREE.Vector3(), view = new THREE.Vector3(), tgt = new THREE.Vector3();
  const plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();

  // Patch a (cloned) floor material so it mixes in the reflection (and gets lamps).
  function patch(material) {
    return patchLamps(material, (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform mat4 uReflMatrix; varying vec4 vReflUv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvReflUv = uReflMatrix * modelMatrix * vec4(transformed, 1.0);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tReflect, tReflDepth; uniform mat4 uReflProjInv; uniform float uReflStrength, uReflBlur, uReflBase; uniform vec2 uReflSize; varying vec4 vReflUv;')
        .replace('#include <opaque_fragment>', `
          if (uReflStrength > 0.0) {
            vec2 ruv = vReflUv.xy / vReflUv.w + normal.xy * 0.01;
            // how far behind the floor the reflected point lies: 0 at contact
            float zd = texture(tReflDepth, ruv).r;
            vec4 vp = uReflProjInv * vec4(ruv * 2.0 - 1.0, zd * 2.0 - 1.0, 1.0);
            float gap = max(length(vp.xyz / vp.w) - length(vViewPosition), 0.0);
            float lod = 0.1 + uReflBlur * smoothstep(0.0, 1.4, gap) + 0.7 * smoothstep(0.4, 3.0, gap);
            vec2 px = (0.4 + 0.9 * smoothstep(0.0, 1.0, gap)) * exp2(lod) / uReflSize;
            vec3 refl = 0.36 * textureLod(tReflect, ruv, lod).rgb;
            refl += 0.16 * textureLod(tReflect, ruv + vec2(px.x, px.y * 0.5), lod).rgb;
            refl += 0.16 * textureLod(tReflect, ruv + vec2(-px.x, px.y * 0.5), lod).rgb;
            refl += 0.16 * textureLod(tReflect, ruv + vec2(px.x * 0.5, -px.y), lod).rgb;
            refl += 0.16 * textureLod(tReflect, ruv + vec2(-px.x * 0.5, -px.y), lod).rgb;
            float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
            float fres = 0.38 + 0.62 * pow(1.0 - ndv, 2.5);
            // gloss of this pixel relative to the finish's base roughness: seams stay matt
            float gloss = clamp((1.0 - roughnessFactor) / max(1.0 - uReflBase, 0.05), 0.0, 1.15);
            float k = clamp(uReflStrength * fres * gloss, 0.0, 0.8);
            // the polished layer shows the mirror instead of part of the lit floor
            outgoingLight = mix(outgoingLight, refl, k);
          }
          #include <opaque_fragment>`);
    }, '-floor');
  }

  // Render the mirrored view. `hide` lists objects to leave out (the floor itself, overlays).
  function update(renderer, scene, camera, hide, size, onCamera = null) {
    const w = Math.max(16, Math.round(size.x)), h = Math.max(16, Math.round(size.y));
    if (target.width !== w || target.height !== h) target.setSize(w, h);
    uniforms.uReflSize.value.set(w, h);
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < 0.02) return false;
    view.copy(o).sub(camPos).reflect(n).negate().add(o);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    tgt.copy(o).sub(look).reflect(n).negate().add(o);
    virtual.position.copy(view);
    virtual.up.set(0, 1, 0).applyMatrix4(rot).reflect(n);
    virtual.lookAt(tgt);
    virtual.far = camera.far; virtual.near = camera.near;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);
    // oblique near plane: clip everything below the floor
    plane.setFromNormalAndCoplanarPoint(n, o).applyMatrix4(virtual.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = virtual.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + e[8]) / e[0]; q.y = (Math.sign(clip.y) + e[9]) / e[5]; q.z = -1; q.w = (1 + e[10]) / e[14];
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1 - 0.003; e[14] = clip.w;
    virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
    uniforms.uReflProjInv.value.copy(virtual.projectionMatrixInverse);

    const was = hide.map((x) => x.visible); hide.forEach((x) => { x.visible = false; });
    // (a pending shadow-map update is done here and then reused by the main view)
    const prevTarget = renderer.getRenderTarget();
    try {
      onCamera?.(virtual); // e.g. re-express view-space uniforms for the mirror camera
      renderer.setRenderTarget(target); renderer.clear(); renderer.render(scene, virtual);
    } finally { // put back whatever happens, or the floor stays in the mirror's state
      renderer.setRenderTarget(prevTarget);
      onCamera?.(camera);
      hide.forEach((x, i) => { x.visible = was[i]; });
    }
    return true;
  }
  return { target, uniforms, patch, update, virtual, dispose() { target.dispose(); depth.dispose(); } };
}
