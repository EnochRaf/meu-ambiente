// Final colour grade, after tone mapping: lift, gain, saturation, contrast and a
// soft vignette, keyed to the time of day (see look.js).
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createGrade() {
  const pass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uLift: { value: new THREE.Vector3() }, uGain: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uCon: { value: 1 }, uVig: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform vec3 uLift, uGain; uniform float uSat, uCon, uVig; varying vec2 vUv;
      void main(){
        vec4 c = texture2D(tDiffuse, vUv);
        vec3 col = c.rgb * uGain + uLift * (1.0 - c.rgb);
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, uSat);
        col = (col - 0.5) * uCon + 0.5;
        vec2 q = vUv - 0.5; col *= 1.0 - uVig * smoothstep(0.3, 0.95, length(q * vec2(1.15, 1.0)));
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
      }`,
  });
  pass.set = (L) => { const u = pass.uniforms; u.uLift.value.set(...L.lift); u.uGain.value.set(...L.gain); u.uSat.value = L.sat; u.uCon.value = L.con; u.uVig.value = L.vig; };
  return pass;
}
