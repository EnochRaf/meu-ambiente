// Offscreen renderer that turns a catalog definition into a small PNG thumbnail.
import * as THREE from 'three';
import { buildItemMesh } from './catalog.js';

export function createThumbnailer({ width = 176, height = 132 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(2);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b7bcc4', 1.2));
  const key = new THREE.DirectionalLight('#fff3e2', 2.2); key.position.set(2, 4, 3); key.castShadow = true;
  key.shadow.mapSize.set(512, 512); key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#dfe8ff', 0.7); fill.position.set(-3, 2, -2); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.ShadowMaterial({ opacity: 0.18 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(28, width / height, 0.05, 50);
  const cache = new Map();
  const queue = [];
  let running = false;

  function renderNow(def, finish) {
    const group = buildItemMesh(def, finish);
    group.traverse((o) => { if (o.isLight) o.intensity = 0; });
    if (def.kind === 'wall') { group.rotation.y = 0; }
    scene.add(group);
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    floor.position.y = def.kind === 'wall' ? box.min.y - 0.02 : -0.001;
    const r = Math.max(size.x, size.y, size.z) * 0.62 + 0.05;
    const dist = r / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
    camera.position.set(center.x + dist * 0.62, center.y + dist * 0.5, center.z + dist * 0.72);
    camera.lookAt(center);
    Object.assign(key.shadow.camera, { left: -r * 2, right: r * 2, top: r * 2, bottom: -r * 2, near: 0.1, far: 20 });
    key.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(group);
    return url;
  }

  function pump() {
    if (!queue.length) { running = false; return; }
    running = true;
    const start = performance.now();
    while (queue.length && performance.now() - start < 12) {
      const { def, finish, key: k, resolve } = queue.shift();
      try { const url = renderNow(def, finish); cache.set(k, url); resolve(url); } catch (e) { resolve(null); }
    }
    requestAnimationFrame(pump);
  }

  return {
    thumbnail(def, finish = def.finish) {
      const k = `${def.id}|${finish.mat}|${finish.color}`;
      if (cache.has(k)) return Promise.resolve(cache.get(k));
      return Promise.resolve(def.preload?.()).catch(() => {}).then(() => new Promise((resolve) => { queue.push({ def, finish, key: k, resolve }); if (!running) pump(); }));
    },
    forget(id) { for (const k of [...cache.keys()]) if (k.startsWith(id + '|')) cache.delete(k); },
  };
}
