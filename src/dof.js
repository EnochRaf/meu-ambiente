// Depth of field: a gentle lens blur that keeps the whole room in focus and
// softens what lies in front of or beyond it (the base, the backdrop). Reads
// the depth the ambient-occlusion pass already renders, gathers a golden-angle
// disc whose radius grows with distance from the focus band, and keeps sharp
// foreground pixels from smearing into blurred background.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export class DofPass extends Pass {
  constructor(camera) {
    super();
    this.camera = camera;
    this.uniforms = {
      tDiffuse: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 200 },
      uFocus: { value: 8 }, uRange: { value: 3 }, uMaxBlur: { value: 6 }, uRes: { value: new THREE.Vector2(1, 1) },
    };
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse, tDepth; uniform float uNear, uFar, uFocus, uRange, uMaxBlur; uniform vec2 uRes; varying vec2 vUv;
        float dist(vec2 uv) { float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float coc(float d) { return d > uFar * 0.98 ? 1.0 : clamp((abs(d - uFocus) - uRange) / (uRange * 1.4 + 0.01), 0.0, 1.0); }
        void main() {
          float d0 = dist(vUv), c0 = coc(d0) * uMaxBlur;
          vec4 base = texture2D(tDiffuse, vUv);
          if (c0 < 0.4) { gl_FragColor = base; return; }
          vec4 sum = base; float wsum = 1.0;
          for (int i = 0; i < 28; i++) {
            float fi = float(i) + 0.5, a = fi * 2.39996, r = sqrt(fi / 28.0) * c0;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uRes;
            float d = dist(uv), c = coc(d) * uMaxBlur;
            float w = d < d0 - 0.15 ? clamp(c / c0, 0.0, 1.0) : 1.0; // a sharp nearer pixel stays out of the blur
            sum += texture2D(tDiffuse, uv) * w; wsum += w;
          }
          gl_FragColor = sum / wsum;
        }`,
      depthTest: false, depthWrite: false,
    }));
  }
  setSize(w, h) { this.uniforms.uRes.value.set(w, h); }
  render(renderer, writeBuffer, readBuffer) {
    const u = this.uniforms; u.tDiffuse.value = readBuffer.texture; u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.quad.dispose(); }
}
