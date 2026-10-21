// three.js scene: the room model, items, lighting by time of day, a soft
// backdrop, floor reflections, preview and selection outlines, picking, camera.
//
// Rendering is continuous and aims for quality: filmic tone mapping, soft sun
// shadows, live ambient occlusion, a fill and a rim light, studio reflections,
// planar floor reflections, lamp light and glow, depth of field, soft fog,
// MSAA plus SMAA edge smoothing and a per-atmosphere colour grade. Lamps cast
// soft shadows of their own. The camera glides in when the page opens, then
// rests; while it rests, jittered frames are averaged into a refined image
// (smoother edges, softer shadows). An optional idle drift can be turned on.
// If frames fall below 30 per second, quality steps down on its own (and back
// up when there is room).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { DofPass } from './dof.js';
import { buildItemMesh, itemFinish } from './catalog.js';
import { shineOf, MATERIAL_BY_ID, clearMaterialCache } from './materials.js';
import { obbCorners, obb, wallLength } from './placement.js';
import { toWorld } from './balcony.js';
import { buildRoom, wallPose, wallSegments, softShadowTexture, modelBounds, WALL_T } from './roomModel.js';
import { lookAt, createBackdrop, createStudioEnv, TIME_LABELS } from './look.js';
import { loadView, setupPanes, viewWeights, setAnisotropy, WALL_AZ } from './views.js';
import { withAtmosphere } from './atmospheres.js';
import { registerLamps, unregisterLamps, updateLampUniforms, lampUniforms } from './lamps.js';
import { createLampShadows } from './lampShadows.js';
import { pendingModels } from './models.js';
import { createGrade } from './grade.js';
import { createFloorReflection } from './reflect.js';
import { Q, setQuality, loadQuality, saveQuality, QUALITY } from './quality.js';
import { report } from './report.js';

export { wallPose, wallSegments, TIME_LABELS };
const ACCENT = '#2563eb', OK = '#22c55e', BAD = '#ef4444';
// inward normal of each wall's interior plane, and which axis u runs along
const WALL_INFO = {
  N: { n: [0, 0, 1], along: 'x' }, S: { n: [0, 0, -1], along: 'x' },
  W: { n: [1, 0, 0], along: 'z' }, E: { n: [-1, 0, 0], along: 'z' },
};
export const SURFACE_NAMES = { floor: 'Floor', N: 'Back wall', S: 'Front wall', W: 'Left wall', E: 'Right wall' };
export const LENS = 26; // degrees: a narrow, calm lens
const NIGHT_GLASS = new THREE.Color('#5d78b8'); // window glass reflects a deep blue night sky

export function createScene(container) {
  setQuality(loadQuality());
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  renderer.toneMappingExposure = 1;
  container.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  const scene = new THREE.Scene();
  const backdrop = createBackdrop();
  scene.background = backdrop.texture;
  // a soft studio environment for reflections, rebuilt as the light changes
  const studio = createStudioEnv(renderer);
  const camera = new THREE.PerspectiveCamera(LENS, 1, 0.1, 200);

  const hemi = new THREE.HemisphereLight('#ffffff', '#c8ccd2', 1.0);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.5);
  sun.castShadow = true;
  sun.shadow.normalBias = 0.02; sun.shadow.bias = -0.00025; sun.shadow.radius = 5;
  // a soft fill from the viewer's side and a rim from behind that outlines silhouettes
  const fill = new THREE.DirectionalLight('#eef3ff', 0.3);
  const rim = new THREE.DirectionalLight('#ffe6c8', 0.6);
  scene.add(hemi, sun, sun.target, fill, fill.target, rim, rim.target);
  scene.fog = new THREE.FogExp2('#d8dde4', 0.01);

  const roomGroup = new THREE.Group(), itemsGroup = new THREE.Group(), previewGroup = new THREE.Group();
  scene.add(roomGroup, itemsGroup, previewGroup);
  const hiddenMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const blobMat = new THREE.MeshBasicMaterial({ color: '#1f1b17', alphaMap: softShadowTexture(), transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  let walls = {}, floorMesh = null, panes = [];
  const itemMeshes = new Map();   // id -> { group, sig, wall }
  let room = null, roomSig = '', roomId = null, light = { time: 1, atmosphere: null, lamps: null }, L = withAtmosphere(lookAt(1), null), view = 'garden', freeCamera = false, viewTex = null;

  // ---- render scheduling ------------------------------------------------------
  let raf = 0, interacting = false, lastMotion = -1e9, shadowsDirty = true, tween = null, changedAt = 0;
  const listeners = new Set();
  function wake() { if (!raf) raf = requestAnimationFrame(frame); }
  // something in the scene changed: shadows and lamp data need refreshing
  function invalidate({ shadows = true } = {}) { lampsDirty = true; changedAt = performance.now(); sample = 0; if (shadows) { shadowsDirty = true; lampShadowsDirty = true; } wake(); }
  // a model arrived: its shades may glow, and it casts shadows
  window.addEventListener('roomsmith:model-loaded', () => { for (const rec of itemMeshes.values()) applyGlow(rec.group); invalidate(); });
  let lampShadowsDirty = true, lampShadowsAt = 0, sample = 0;
  let lampsDirty = true;
  const lampCentre = () => (room ? new THREE.Vector3((room.width) / 2, 1, room.length / 2) : new THREE.Vector3());
  // the view is moving: render light frames until it settles
  function motion() { lastMotion = performance.now(); sample = 0; wake(); }
  const requestRender = () => invalidate();

  // ---- outlines (preview + selection) ---------------------------------------
  function makeOutline(color, opacity) {
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3)),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    line.renderOrder = 10; line.visible = false;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    fill.visible = false; fill.renderOrder = 9; fill.rotation.order = 'YXZ';
    scene.add(line, fill);
    return { line, fill, setColor(c) { line.material.color.set(c); fill.material.color.set(c); },
      show(v) { line.visible = fill.visible = v; } };
  }
  const preview = makeOutline(OK, 0.18);
  const selection = makeOutline(ACCENT, 0.15);

  function layoutRect(o, corners, center, rotY, w, h, flat) {
    const pos = o.line.geometry.attributes.position;
    corners.forEach(([x, y, z], i) => pos.setXYZ(i, x, y, z));
    pos.needsUpdate = true;
    o.fill.position.set(...center);
    o.fill.rotation.set(flat ? -Math.PI / 2 : 0, rotY, 0);
    o.fill.scale.set(w, h, 1);
  }
  function layoutItem(o, item, def) {
    if (def.kind === 'wall') {
      const { pos: p, rotY } = wallPose(room, item.wall || 'N', item.u, item.y, -0.006);
      const hw = def.size[0] / 2, hh = def.size[1] / 2, c = Math.cos(rotY), s = Math.sin(rotY);
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [p[0] + lx * c, p[1] + ly, p[2] - lx * s]);
      layoutRect(o, corners, p, rotY, def.size[0], def.size[1], false);
    } else {
      const w = worldOf(item);
      const corners = obbCorners(obb(w.x, w.z, def.size[0], def.size[1], w.rot)).map(([x, z]) => [x, 0.012, z]);
      layoutRect(o, corners, [w.x, 0.01, w.z], w.rot, def.size[0], def.size[1], true);
    }
  }
  function layoutOpening(o, wall, offset, width, bottom, height) {
    const { pos: p, rotY } = wallPose(room, wall, offset, bottom + height / 2, -0.01);
    const c = Math.cos(rotY), s = Math.sin(rotY), hw = width / 2, hh = height / 2;
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [p[0] + lx * c, p[1] + ly, p[2] - lx * s]);
    layoutRect(o, corners, p, rotY, width, height, false);
  }
  function layoutSurface(o, key) {
    const { width: W, length: Lr, height: H } = room;
    if (key === 'floor') {
      layoutRect(o, [[0, 0.012, 0], [W, 0.012, 0], [W, 0.012, Lr], [0, 0.012, Lr]], [W / 2, 0.01, Lr / 2], 0, W, Lr, true);
    } else {
      const len = wallLength(room, key);
      const { pos: p, rotY } = wallPose(room, key, len / 2, H / 2, -0.008);
      const c = Math.cos(rotY), s = Math.sin(rotY), hw = len / 2, hh = H / 2;
      const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => [p[0] + lx * c, p[1] + ly, p[2] - lx * s]);
      layoutRect(o, corners, p, rotY, len, H, false);
    }
  }

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  controls.minDistance = 1.5; controls.maxDistance = 90; // the narrow lens needs room to step back in tall windows
  controls.screenSpacePanning = true; controls.zoomSpeed = 0.8; controls.rotateSpeed = 0.7;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.addEventListener('start', () => { interacting = true; atDefault = false; motion(); });
  controls.addEventListener('end', () => { interacting = false; motion(); });
  controls.addEventListener('change', motion);

  // ---- post-processing: ambient occlusion, glow, tone mapping, colour grade --------
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: Q.msaa }));
  composer.addPass(new RenderPass(scene, camera));
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.updateGtaoMaterial({ radius: 0.38, distanceExponent: 1.4, thickness: 1.1, scale: 1.45, samples: Q.aoSamples, distanceFallOff: 0.85 });
  ao.updatePdMaterial({ lumaPhi: 8, depthPhi: 2.5, normalPhi: 4, radius: 9, rings: 3, samples: 20 });
  ao.blendIntensity = 1;
  // the occlusion pass draws everything with its own material, so leave out what
  // is not really there: hidden walls, soft shadow decals, light pools
  const aoRender = ao.render.bind(ao);
  ao.render = (...args) => {
    const off = [];
    scene.traverse((o) => { if (o.visible && (o.userData.hidden || o.userData.noAO || o.userData.blob || o.isSprite || (o.isMesh && o.material?.transparent))) { o.visible = false; off.push(o); } });
    try { aoRender(...args); } finally { for (const o of off) o.visible = true; }
  };
  const aoSetSize = ao.setSize.bind(ao);
  ao.setSize = (w, h) => aoSetSize(Math.ceil(w * Q.aoScale), Math.ceil(h * Q.aoScale));
  composer.addPass(ao);
  const dof = new DofPass(camera);
  composer.addPass(dof);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.6, 0.85);
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.ceil(w / 2), Math.ceil(h / 2));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  composer.addPass(smaa);
  const grade = createGrade();
  composer.addPass(grade);

  const reflection = createFloorReflection();
  const lampShadows = createLampShadows(renderer);

  // refinement while the view rests: a running average of jittered frames
  let accum = null;
  const fsVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const blendQuad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uW: { value: 1 } }, vertexShader: fsVert,
    fragmentShader: 'uniform sampler2D tSrc; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, uW); }',
    transparent: true, depthTest: false, depthWrite: false }));
  const copyQuad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, vertexShader: fsVert,
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }', depthTest: false, depthWrite: false }));
  const halton = (i, b) => { let f = 1, r = 0; for (let n = i; n > 0; n = Math.floor(n / b)) { f /= b; r += f * (n % b); } return r; };

  // ---- wall grips (drag to resize) -------------------------------------------
  const gripGroup = new THREE.Group();
  scene.add(gripGroup);
  const gripMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, emissive: '#1fa98a', emissiveIntensity: 0 });
  const gripHotMat = new THREE.MeshStandardMaterial({ color: '#1fa98a', roughness: 0.35, emissive: '#1fa98a', emissiveIntensity: 0.6 });
  const grips = {};
  for (const wall of ['N', 'S', 'W', 'E']) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), gripMat);
    m.userData.grip = wall; m.userData.noLampShadow = true; m.castShadow = true; grips[wall] = m; gripGroup.add(m);
  }
  function placeGrips() {
    const { width: W, length: Lr } = room, o = WALL_T + 0.14;
    grips.N.position.set(W / 2, 0.11, -o); grips.S.position.set(W / 2, 0.11, Lr + o);
    grips.W.position.set(-o, 0.11, Lr / 2); grips.E.position.set(W + o, 0.11, Lr / 2);
  }

  // ---- room shell ----------------------------------------------------------
  function disposeTree(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) if (m.userData?.disposable) m.dispose();
    });
  }
  function rebuildRoom() {
    for (const c of [...roomGroup.children]) { roomGroup.remove(c); disposeTree(c); }
    const built = buildRoom(room, { view });
    walls = built.walls; floorMesh = built.floor; panes = built.panes;
    floorMesh.material.userData.disposable = true;
    for (const p of panes) p.material.userData.disposable = true;
    // the main window (the largest) looks at the best part of the view
    const main = panes.reduce((a, p) => (!a || p.userData.area > a.userData.area + 0.01 ? p : a), null);
    setupPanes(panes, view, room, WALL_AZ[main?.userData.surface] ?? 0);
    const want = view;
    loadView(view).then((tex) => { if (!tex || want !== view) return; viewTex = { view: want, ...tex }; applyViewLight(); invalidate({ shadows: false }); });
    reflection.patch(floorMesh.material);
    roomGroup.add(built.group);
    placeGrips();
    const fm = MATERIAL_BY_ID[room.finishes.floor.mat];
    reflection.uniforms.uReflStrength.value = shineOf(room.finishes.floor.mat) * Q.reflection;
    reflection.uniforms.uReflBlur.value = 0.4 + (fm?.roughness ?? 0.5) * 6;
    reflection.uniforms.uReflBase.value = fm?.roughness ?? 0.5;
    applyTime();
  }

  // ---- items ----------------------------------------------------------------
  function worldOf(item) {
    if (item.zone === 'balcony' && room.balcony) return toWorld(room, room.balcony, item.x, item.z, item.rot || 0);
    return { x: item.x, z: item.z, rot: item.rot || 0 };
  }
  function placeGroup(group, item, def) {
    if (def.kind === 'wall') {
      const { pos, rotY } = wallPose(room, item.wall || 'N', item.u, item.y, 0);
      group.position.set(...pos); group.rotation.y = rotY;
    } else {
      const w = worldOf(item);
      // hanging pieces (pendants) are built downwards from the ceiling
      group.position.set(w.x, def.kind === 'hanging' ? room.height : 0, w.z); group.rotation.y = w.rot;
    }
  }
  // shades warm up and glow with the lamp level; bulbs and halos appear
  function applyGlow(group) {
    const k = L.lampLevel;
    group.traverse((o) => {
      if (o.isMesh && o.userData.glow) { o.material.emissiveIntensity = k * 1.6 * (o.userData.glowK ?? 1); o.material.emissive.copy(L.lampColor); }
      if (o.isMesh && o.userData.bulb) o.visible = k > 0.25;
      if (o.isSprite && o.userData.halo) { o.material.opacity = Math.min(1, k) * 0.42; o.material.color.copy(L.lampColor); o.visible = k > 0.02; }
    });
  }
  // soft ambient shadow under a piece that stands on the floor
  function contactBlob(def) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), blobMat);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.002; m.scale.set(def.size[0] * 1.45 + 0.1, def.size[1] * 1.45 + 0.1, 1);
    m.raycast = () => {}; m.userData.blob = true;
    return m;
  }
  function syncItems(defs) {
    const seen = new Set();
    for (const item of room.items) {
      const def = defs[item.type];
      if (!def) continue;
      seen.add(item.id);
      const finish = itemFinish(item, def);
      const sig = `${item.type}|${finish.mat}|${finish.color}|${finish.frame || ''}|${Q.texture}|${def.size.join()}`;
      let rec = itemMeshes.get(item.id);
      if (!rec || rec.sig !== sig) {
        if (rec) { itemsGroup.remove(rec.group); unregisterLamps(rec.group); disposeTree(rec.group); }
        const group = buildItemMesh(def, finish);
        registerLamps(group);
        if (def.kind === 'floor') group.add(contactBlob(def));
        group.traverse((o) => { o.userData.itemId = item.id; });
        itemsGroup.add(group);
        rec = { group, sig };
        itemMeshes.set(item.id, rec);
        applyGlow(group);
      }
      rec.wall = def.kind === 'wall' ? item.wall : null;
      rec.offstage = item.zone === 'balcony' && !room.balcony;
      if (rec.offstage) rec.group.visible = false;
      placeGroup(rec.group, item, def);
    }
    for (const [id, rec] of itemMeshes) if (!seen.has(id)) { itemsGroup.remove(rec.group); unregisterLamps(rec.group); disposeTree(rec.group); itemMeshes.delete(id); }
  }

  // ---- selection highlight -----------------------------------------------------
  let selected = null; // { kind: 'item', id, item, def } | { kind: 'surface', key }
  function refreshSelection() {
    if (!selected) { selection.show(false); return; }
    if (selected.kind === 'item') {
      const rec = itemMeshes.get(selected.id);
      if (!rec || !rec.group.visible) { selection.show(false); return; }
      layoutItem(selection, selected.item, selected.def);
    } else if (selected.kind === 'opening') {
      const o = room.openings.find((x) => x.id === selected.id);
      if (!o || walls[o.wall]?.userData.hidden) { selection.show(false); return; }
      layoutOpening(selection, o.wall, o.offset, o.width, o.bottom, o.height);
    } else {
      if (selected.key !== 'floor' && walls[selected.key]?.userData.hidden) { selection.show(false); return; }
      layoutSurface(selection, selected.key);
    }
    selection.show(true);
  }

  // ---- preview (dragged item) -----------------------------------------------
  let previewRec = null;
  function setPreview(item, def, ok, outside = false) {
    if (!item) { previewGroup.visible = false; preview.show(false); invalidate(); return; }
    shadowsDirty = true; motion();
    const sig = def.id + '|' + JSON.stringify(item.finish || null);
    if (!previewRec || previewRec.sig !== sig) {
      for (const c of [...previewGroup.children]) { previewGroup.remove(c); disposeTree(c); }
      const group = buildItemMesh(def, itemFinish(item, def));
      group.traverse((o) => { if (o.isMesh) { const ghost = (m) => { const c = m.clone(); c.transparent = true; c.opacity = 0.7; c.userData = { disposable: true }; return c; }; o.material = Array.isArray(o.material) ? o.material.map(ghost) : ghost(o.material); o.castShadow = false; } });
      previewGroup.add(group);
      previewRec = { group, sig };
    }
    previewGroup.visible = true;
    placeGroup(previewRec.group, item, def);
    layoutItem(preview, item, def);
    preview.setColor(ok && !outside ? OK : BAD);
    preview.show(true);
  }

  // ---- picking --------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function setRay(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    raycaster.setFromCamera(ndc, camera);
  }
  function raycastFloor(cx, cy) {
    setRay(cx, cy);
    const p = raycaster.ray.intersectPlane(floorPlane, new THREE.Vector3());
    return p ? { x: p.x, z: p.z } : null;
  }
  function raycastWalls(cx, cy) {
    setRay(cx, cy);
    let best = null;
    for (const wall of ['N', 'S', 'W', 'E']) {
      if (walls[wall]?.userData.hidden) continue;
      const n = new THREE.Vector3(...WALL_INFO[wall].n);
      if (raycaster.ray.direction.dot(n) >= 0) continue;
      const { pos } = wallPose(room, wall, 0, 0, 0);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(...pos));
      const p = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!p) continue;
      const u = WALL_INFO[wall].along === 'x' ? p.x : p.z;
      if (u < -0.3 || u > wallLength(room, wall) + 0.3 || p.y < -0.3 || p.y > room.height + 0.3) continue;
      const d = p.distanceTo(raycaster.ray.origin);
      if (!best || d < best.d) best = { wall, u, y: p.y, d };
    }
    return best;
  }
  // nearest grip, item, opening or surface under the pointer
  function pick(cx, cy) {
    setRay(cx, cy);
    if (gripGroup.visible) {
      const g = raycaster.intersectObjects(gripGroup.children, false)[0];
      if (g) return { kind: 'grip', wall: g.object.userData.grip };
    }
    for (const hit of raycaster.intersectObjects([itemsGroup, roomGroup], true)) {
      const o = hit.object;
      if (!o.isMesh || o.userData.hidden) continue;
      let p = o, visible = true;
      while (p) { if (p.visible === false) visible = false; p = p.parent; }
      if (!visible) continue;
      let q = o;
      while (q && !q.userData.itemId && !q.userData.opening) q = q.parent;
      if (q?.userData.itemId) return { kind: 'item', id: q.userData.itemId };
      if (q?.userData.opening) return { kind: 'opening', id: q.userData.opening, wall: o.userData.surface };
      if (o.userData.surface) return { kind: 'surface', key: o.userData.surface };
    }
    return null;
  }
  const pickItem = (cx, cy) => { const p = pick(cx, cy); return p?.kind === 'item' ? p.id : null; };

  // ---- camera ---------------------------------------------------------------
  function bounds() {
    const { x0, x1, z0, z1 } = modelBounds(room);
    return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, d: Math.max(x1 - x0, z1 - z0) };
  }
  // a three-quarter view from the front right, framed to fit the narrow lens
  function defaultView() {
    // a three-quarter view from the front right; the distance makes every corner
    // of the room (walls and base) fit the part of the window the panels leave free
    const b = bounds(), H = room?.height ?? 2.6;
    const freeW = Math.max(1, cssW - insets.left - insets.right), freeH = Math.max(1, cssH - insets.top - insets.bottom);
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * freeH / cssH, th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * freeW / cssH;
    const yaw = THREE.MathUtils.degToRad(38), pitch = THREE.MathUtils.degToRad(31);
    const target = new THREE.Vector3(b.cx, H * 0.3, b.cz);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right).normalize(), q = new THREE.Vector3();
    let dist = 1;
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [-0.3, H]) {
      q.set(x, y, z).sub(target);
      const along = q.dot(dir); // towards the camera
      dist = Math.max(dist, along + Math.abs(q.dot(right)) / th, along + Math.abs(q.dot(up)) / tv);
    }
    dist *= 1.02;
    const pos = target.clone().addScaledVector(dir, dist);
    return { pos, target };
  }
  function flyTo({ pos, target }, ms = 800) {
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms };
    motion();
  }
  // true while the camera shows the default overview (until someone moves it)
  let atDefault = true;
  function resetView(animate = true) {
    atDefault = true;
    const v = defaultView();
    if (!animate) { camera.position.copy(v.pos); controls.target.copy(v.target); controls.update(); motion(); }
    else flyTo(v);
    drift.base = null;
  }

  // The camera glides slowly into the default view when the page opens, then
  // rests so the refining frames can sharpen the picture. An optional idle
  // drift (off by default) starts after a while without input. Any input stops
  // either at once, where it is.
  const IDLE_KEY = 'roomsmith:idleMotion';
  let idleMotion = false; try { idleMotion = localStorage.getItem(IDLE_KEY) === '1'; } catch {}
  const drift = { enabled: true, idle: idleMotion, active: false, base: null, start: 0, lastInput: performance.now(), idleAfter: 12000, intro: null };
  const stopDrift = () => { drift.lastInput = performance.now(); drift.intro = null; if (drift.active) { drift.active = false; drift.base = null; } };
  for (const ev of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(ev, stopDrift, { capture: true, passive: true });
  const sph = new THREE.Spherical(), tmpV = new THREE.Vector3();
  // glide in: orbit from a wider, higher angle into the default view
  function startIntro() {
    const v = defaultView();
    const to = new THREE.Spherical().setFromVector3(tmpV.copy(v.pos).sub(v.target));
    const from = new THREE.Spherical(to.radius * 1.12, to.phi - 0.07, to.theta + 0.32);
    // the glide waits (holding its first pose) until the furniture has arrived
    drift.intro = { from, to, target: v.target.clone(), start: null, made: performance.now(), ms: 6500 };
    camera.position.copy(v.target).add(tmpV.setFromSpherical(from)); controls.target.copy(v.target); camera.lookAt(v.target);
  }
  function updateIntro(now) {
    const I = drift.intro; if (!I) return false;
    if (I.start == null) { if (pendingModels() > 0 && now - I.made < 15000) { lastMotion = now; sample = 0; return true; } I.start = now + 400; }
    const f = Math.min(1, Math.max(0, (now - I.start) / I.ms)), e = f * f * f * (f * (f * 6 - 15) + 10); // smoother start and stop
    sph.set(I.from.radius + (I.to.radius - I.from.radius) * e, I.from.phi + (I.to.phi - I.from.phi) * e, I.from.theta + (I.to.theta - I.from.theta) * e);
    camera.position.copy(I.target).add(tmpV.setFromSpherical(sph)); controls.target.copy(I.target); camera.lookAt(I.target);
    lastMotion = now; sample = 0;
    if (f >= 1) { drift.intro = null; atDefault = true; }
    return true;
  }
  function updateDrift(now) {
    if (!drift.enabled || !drift.idle || !room || tween || interacting) return;
    if (!drift.active) {
      if (now - drift.lastInput < drift.idleAfter) return;
      drift.active = true; drift.start = now;
      sph.setFromVector3(tmpV.copy(camera.position).sub(controls.target));
      drift.base = { r: sph.radius, theta: sph.theta, phi: sph.phi, target: controls.target.clone() };
    }
    const t = (now - drift.start) / 1000, e = Math.min(1, t / 6); // ease in over six seconds
    const B = drift.base;
    sph.set(B.r * (1 - 0.035 * e * Math.sin(t * 0.11)), B.phi + 0.03 * e * Math.sin(t * 0.083 + 1.3), B.theta + 0.17 * e * Math.sin(t * 0.06));
    camera.position.copy(B.target).add(tmpV.setFromSpherical(sph));
    camera.lookAt(controls.target);
    lastMotion = now; sample = 0;
  }

  function setWallHidden(g, hidden) {
    g.userData.hidden = hidden;
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (hidden) { o.userData.mat = o.material; o.material = hiddenMat; o.userData.hidden = true; }
      else { o.material = o.userData.mat || o.material; o.userData.hidden = false; }
    });
  }
  function updateWallVisibility() {
    let changed = false;
    for (const wall of ['N', 'S', 'W', 'E']) {
      const g = walls[wall]; if (!g) continue;
      const [nx, , nz] = WALL_INFO[wall].n;
      const { pos } = wallPose(room, wall, 0, 0, 0);
      const hide = (camera.position.x - pos[0]) * nx + (camera.position.z - pos[2]) * nz < 0;
      if (!!g.userData.hidden !== hide) { setWallHidden(g, hide); changed = true; }
    }
    for (const rec of itemMeshes.values()) { if (rec.offstage) { rec.group.visible = false; continue; } if (rec.wall) rec.group.visible = !walls[rec.wall]?.userData.hidden; }
    if (changed) shadowsDirty = true; // lamp shadows keep cut-away walls, so they need no refresh
  }

  // ---- lighting -----------------------------------------------------------------
  function applyTime() {
    L = withAtmosphere(lookAt(light.time), light.atmosphere, light.lamps);
    const c = room ? bounds() : { cx: 2, cz: 2, d: 5 };
    placeSun();
    sun.color.copy(L.sunColor); sun.intensity = L.sunI;
    hemi.color.copy(L.sky); hemi.groundColor.copy(L.ground); hemi.intensity = L.hemiI;
    const night = THREE.MathUtils.smoothstep(light.time, 2.2, 2.9);
    // fill from the viewer's side, rim from behind: cool by day, a little warmer at dusk
    fill.color.copy(L.sky).lerp(new THREE.Color('#ffffff'), 0.4); fill.intensity = (0.28 - 0.2 * night) * (L.fillK ?? 1);
    rim.color.copy(L.sunColor).lerp(new THREE.Color(night > 0.5 ? '#ffd2a8' : '#ffffff'), 0.5); rim.intensity = (0.75 - 0.6 * night) * (L.rimK ?? 1);
    fill.position.set(c.cx + 9, 4, c.cz + 7); fill.target.position.set(c.cx, 0.5, c.cz);
    rim.position.set(c.cx - 6, 7, c.cz - 9); rim.target.position.set(c.cx, 0.6, c.cz);
    fill.target.updateMatrixWorld(); rim.target.updateMatrixWorld();
    scene.environmentIntensity = L.env;
    renderer.toneMappingExposure = L.exposure;
    backdrop.paint(L); scene.backgroundIntensity = 1.0;
    scene.environment = studio.update(L);
    grade.set(L);
    // soft haze in the backdrop's colour
    scene.fog.color.copy(L.bottom).lerp(L.top, 0.35); scene.fog.density = (L.fog ?? 0.006);
    // glow only on genuinely bright light: lamps, bulbs, sun glints
    bloom.threshold = 0.95 + 1.6 * (1 - night); bloom.strength = 0.08 + 0.26 * Math.min(1.2, L.lampLevel) * (L.bloomK ?? 1); bloom.radius = 0.5;
    applyViewLight();
    for (const rec of itemMeshes.values()) { try { applyGlow(rec.group); } catch (err) { report('lamp glow', err); } }
    const ext = c.d * 0.85 + 1.2;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 0.5, far: c.d * 6 + 30 });
    sun.shadow.camera.updateProjectionMatrix();
    shadowsDirty = true; lampsDirty = true; lampShadowsDirty = true;
  }
  // the photos in the windows follow the hour: day, sunset or night, a little warmer in the early morning
  const MORNING = new THREE.Color('#ffe2c4'), WHITE = new THREE.Color('#ffffff'), SHEEN_LAMP = new THREE.Color(), LAMP_WARM = new THREE.Color('#ffc890');
  function applyViewLight() {
    const t = light.time, w = viewWeights(t), tex = viewTex?.view === view ? viewTex : null;
    const morning = 1 - THREE.MathUtils.smoothstep(t, 0, 0.7), night = THREE.MathUtils.smoothstep(t, 2.2, 2.9);
    for (const p of panes) {
      const u = p.material.userData.view;
      u.tDay.value = tex?.day ?? null; u.tSunset.value = tex?.sunset ?? null; u.tNight.value = tex?.night ?? null; u.uHas.value = tex ? 1 : 0;
      u.uW.value.copy(w); u.uExposure.value = renderer.toneMappingExposure;
      u.uBright.value = 0.94 - 0.06 * w.y - 0.36 * w.z - 0.1 * morning;
      u.uTint.value.copy(WHITE).lerp(MORNING, morning * 0.55);
      u.uFallback.value.copy(L.sky).lerp(NIGHT_GLASS, night * 0.85).multiplyScalar(1 - 0.75 * night);
      // the glass reflects the bright room by day and the lamps at night
      u.uSheen.value.copy(L.top).multiplyScalar(0.16 * (1 - night)).add(SHEEN_LAMP.copy(L.lampColor || LAMP_WARM).multiplyScalar(0.1 * Math.min(1.2, L.lampLevel || 0) * (0.3 + 0.7 * night)));
    }
  }
  // the sun, optionally nudged within its disc (refining frames soften its shadow)
  const sunTmp = new THREE.Vector3(), sunU = new THREE.Vector3(), sunV = new THREE.Vector3();
  function placeSun(jx = 0, jy = 0) {
    const c = room ? bounds() : { cx: 2, cz: 2, d: 5 }, dist = c.d * 3 + 10;
    sunTmp.copy(L.sun);
    if (jx || jy) { sunU.set(0, 1, 0).cross(sunTmp).normalize(); sunV.copy(sunTmp).cross(sunU).normalize(); sunTmp.addScaledVector(sunU, jx).addScaledVector(sunV, jy).normalize(); }
    sun.position.set(c.cx + sunTmp.x * dist, sunTmp.y * dist, c.cz + sunTmp.z * dist);
    sun.target.position.set(c.cx, 0, c.cz); sun.target.updateMatrixWorld();
  }

  // ---- size, quality and the automatic step-down ----------------------------------
  let cssW = 1, cssH = 1;
  const drawSize = new THREE.Vector2();
  // window space taken by floating panels: the picture centres on what is left
  const insets = { left: 0, right: 0, top: 0, bottom: 0 };
  // the insets as currently shown: they glide to new values while panels open or close
  const shown = { left: 0, right: 0, top: 0, bottom: 0 };
  let insetAnim = null;
  function applyInsets() {
    // three.js moves the frustum window by near * filmOffset / filmWidth; solve for a shift of sx pixels
    const sx = (shown.left - shown.right) / 2, t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    camera.filmOffset = 0;
    camera.filmOffset = -sx * camera.aspect * 2 * t * camera.getFilmWidth() / Math.max(1, cssW);
    camera.updateProjectionMatrix();
  }
  // runtime reductions applied on top of the preset when frames are slow
  const gov = { step: 0, slow: 0, fast: 0, ema: 16.7, last: 0 };
  // lamp shadows get cheaper while moving ('lampTaps') and at last are left to the refining
  // frames only ('lampMoving'): the still picture always has them
  const STEPS = ['ratio', 'lampTaps', 'ratio', 'reflection', 'aoSamples', 'dof', 'msaa', 'ao', 'lampMoving'];
  function eff() {
    const s = STEPS.slice(0, gov.step), dpr = devicePixelRatio || 1;
    const ratioCuts = s.filter((x) => x === 'ratio').length;
    return {
      // supersample up to the preset's pixel budget, never below the screen's own density (unless slow)
      ratio: Math.max(0.75, Math.min(Q.ratio, Math.max(dpr, Math.sqrt(Q.budget / Math.max(1, cssW * cssH)))) * Math.pow(0.8, ratioCuts)),
      reflectionScale: Q.reflectionScale * (s.includes('reflection') ? 0.5 : 1),
      aoSamples: s.includes('aoSamples') ? Math.min(8, Q.aoSamples) : Q.aoSamples,
      dof: Q.dof && !s.includes('dof'), msaa: s.includes('msaa') ? 0 : Q.msaa, ao: Q.ao && !s.includes('ao'),
      lampTaps: s.includes('lampMoving') ? 0 : s.includes('lampTaps') ? 2 : 4,
    };
  }
  function applySize() {
    const E = eff();
    for (const rt of [composer.renderTarget1, composer.renderTarget2]) if (rt.samples !== E.msaa) { rt.samples = E.msaa; rt.dispose(); }
    renderer.setPixelRatio(E.ratio); composer.setPixelRatio(E.ratio);
    renderer.setSize(cssW, cssH, false); composer.setSize(cssW, cssH);
    ao.updateGtaoMaterial({ samples: E.aoSamples });
    renderer.getDrawingBufferSize(drawSize);
    if (Q.samples > 1) { if (!accum) accum = new THREE.WebGLRenderTarget(drawSize.x, drawSize.y, { type: THREE.HalfFloatType, depthBuffer: false }); else accum.setSize(drawSize.x, drawSize.y); }
    else if (accum) { accum.dispose(); accum = null; }
    sample = 0;
  }
  function resize() {
    cssW = container.clientWidth || 1; cssH = container.clientHeight || 1;
    camera.aspect = cssW / cssH; applyInsets();
    applySize();
    invalidate({ shadows: false });
  }
  new ResizeObserver(resize).observe(container);
  function applyQuality() {
    sun.shadow.mapSize.set(Q.shadow, Q.shadow); sun.shadow.radius = Q.shadowRadius;
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    if (!Q.reflection) reflection.target.setSize(1, 1);
    gov.step = 0; applySize();
    if (room) reflection.uniforms.uReflStrength.value = shineOf(room.finishes.floor.mat) * Q.reflection;
    shadowsDirty = true; lampShadowsDirty = true;
  }
  resize();
  applyQuality();
  function govern(now) {
    const dt = gov.last ? now - gov.last : 16.7; gov.last = now;
    if (dt > 2000) return; // tab was hidden or the page was busy loading
    gov.ema = gov.ema * 0.93 + dt * 0.07;
    const fps = 1000 / gov.ema;
    if (fps < 30) { gov.slow += dt; gov.fast = 0; } else if (fps > 55) { gov.fast += dt; gov.slow = 0; } else { gov.slow = 0; gov.fast = 0; }
    if (gov.slow > 1500 && gov.step < STEPS.length) { gov.step++; gov.slow = 0; applySize(); }
    else if (gov.fast > 8000 && gov.step > 0) { gov.step--; gov.fast = 0; applySize(); }
  }

  // ---- frame ------------------------------------------------------------------------
  const hideInReflection = () => [floorMesh, preview.line, preview.fill, selection.line, selection.fill, gripGroup].filter(Boolean);
  function prepare() {
    if (room) { updateWallVisibility(); refreshSelection(); }
    if (lampsDirty) { scene.updateMatrixWorld(); updateLampUniforms(lampCentre(), L.lampLevel); lampsDirty = false; }
  }
  const stats = { frames: 0, refined: 0, lampShadowUpdates: 0 };
  // lamp shadows only change with the furniture or the lamps; while something is
  // being dragged they refresh a few times a second
  function updateLampShadows(now) {
    if (!lampShadowsDirty) return;
    const n = Q.lampShadows && L.lampLevel > 0.001 ? lampUniforms.uLampCount.value : 0;
    if (n && (previewGroup.visible || pendingModels() > 0) && now - lampShadowsAt < (previewGroup.visible ? 150 : 600)) return; // dragging, or models still arriving
    lampShadowsDirty = false; lampShadowsAt = now; stats.lampShadowUpdates++;
    scene.updateMatrixWorld();
    lampShadows.update(scene, lampUniforms.uLampPos.value, n);
  }
  // one frame through the full chain; k > 0 is a jittered refining sample
  function renderFrame(k = 0) {
    const E = eff(), now = performance.now();
    ao.enabled = E.ao; dof.enabled = E.ao && E.dof; bloom.enabled = Q.bloom; smaa.enabled = Q.smaa;
    prepare();
    updateLampShadows(now);
    renderer.getDrawingBufferSize(drawSize);
    if (k > 0) {
      // sub-pixel camera offset, the sun nudged within its disc, a new lamp-shadow filter rotation
      camera.setViewOffset(drawSize.x, drawSize.y, halton(k, 2) - 0.5, halton(k, 3) - 0.5, drawSize.x, drawSize.y);
      const a = halton(k, 5) * Math.PI * 2, r = Math.sqrt(halton(k, 7)) * 0.03;
      placeSun(Math.cos(a) * r, Math.sin(a) * r); renderer.shadowMap.needsUpdate = true; shadowsDirty = true;
      lampUniforms.uLampShadowSeed.value = halton(k, 11); lampUniforms.uLampShadowTaps.value.set(6, 8);
    } else {
      lampUniforms.uLampShadowSeed.value = 0; lampUniforms.uLampShadowTaps.value.set(accum ? 0 : 6, accum ? E.lampTaps : 10);
      if (shadowsDirty) { placeSun(); renderer.shadowMap.needsUpdate = true; shadowsDirty = false; }
    }
    // focus on the room: everything within it stays sharp
    const b = bounds();
    dof.uniforms.tDepth.value = ao.depthTexture;
    dof.uniforms.uFocus.value = camera.position.distanceTo(controls.target);
    dof.uniforms.uRange.value = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) * 0.5 + 0.4;
    dof.uniforms.uMaxBlur.value = 5 * renderer.getPixelRatio();
    if (Q.reflection && floorMesh && reflection.uniforms.uReflStrength.value > 0) {
      const rs = drawSize.clone().multiplyScalar(E.reflectionScale);
      reflection.update(renderer, scene, camera, hideInReflection(), rs);
    }
    if (!accum) { composer.renderToScreen = true; composer.render(); camera.clearViewOffset(); return; }
    composer.renderToScreen = false;
    composer.render();
    camera.clearViewOffset();
    // running average: sample k weighs 1 / (k + 1)
    blendQuad.material.uniforms.tSrc.value = composer.readBuffer.texture;
    blendQuad.material.uniforms.uW.value = 1 / (k + 1);
    renderer.setRenderTarget(accum); renderer.autoClear = false; blendQuad.render(renderer); renderer.autoClear = true;
    renderer.setRenderTarget(null);
    present();
  }
  function present() { copyQuad.material.uniforms.tSrc.value = accum.texture; copyQuad.render(renderer); }

  // a frame that throws is reported and skipped, never the end of the loop
  function drawSafely(k) {
    try { renderFrame(k); }
    catch (err) {
      report('drawing the room', err);
      // start the next frame from a clean slate: drawing to the screen, everything to be redone
      try { renderer.setRenderTarget(null); renderer.autoClear = true; } catch {}
      shadowsDirty = true; lampShadowsDirty = true; lampsDirty = true; sample = 0;
    }
  }
  // true once the resting view has been fully refined
  const converged = () => !accum || sample >= Q.samples;
  function frame(now) {
    raf = 0;
    wake(); // continuous
    if (tween) {
      const f = Math.min(1, (now - tween.start) / tween.ms), e = 1 - Math.pow(1 - f, 3);
      camera.position.lerpVectors(tween.p0, tween.p1, e);
      controls.target.lerpVectors(tween.t0, tween.t1, e);
      if (f >= 1) tween = null;
      lastMotion = now; sample = 0;
    }
    if (insetAnim) {
      const f = Math.min(1, (now - insetAnim.start) / insetAnim.ms), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      for (const k of ['left', 'right', 'top', 'bottom']) shown[k] = insetAnim.from[k] + (insets[k] - insetAnim.from[k]) * e;
      applyInsets(); lastMotion = now; sample = 0;
      if (f >= 1) insetAnim = null;
    }
    const t = controls.target;
    if (room && !freeCamera) { const b = bounds(); t.x = Math.min(Math.max(t.x, b.x0 - 3), b.x1 + 3); t.z = Math.min(Math.max(t.z, b.z0 - 3), b.z1 + 3); t.y = Math.min(Math.max(t.y, 0.15), 3); }
    const intro = room && drift.enabled && !interacting && !tween && updateIntro(now);
    if (!intro) { if (drift.active || (!interacting && !tween)) updateDrift(now); if (!drift.active) controls.update(); }
    if (!room) return;
    const moving = interacting || !!tween || intro || drift.active || now - lastMotion < 120;
    if (moving || !accum) {
      sample = 0;
      govern(now);
      drawSafely(0); stats.frames++;
    } else if (sample < Q.samples) {
      gov.last = 0; // refining frames are not counted by the governor
      drawSafely(sample); sample++; stats.frames++; stats.refined++;
      if (sample === Q.samples) { placeSun(); shadowsDirty = true; } // the next moving frame starts from the true sun
    } else return; // refined and still: the canvas keeps the finished picture
    for (const fn of listeners) fn();
  }
  // the part of the picture the room covers (drawing-buffer pixels), widened to an aspect ratio
  function roomCrop(aspect) {
    renderer.getDrawingBufferSize(drawSize);
    const b = bounds(), H = room.height, v = new THREE.Vector3();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [0, H]) {
      v.set(x, y, z).project(camera);
      const px = (v.x + 1) / 2 * drawSize.x, py = (1 - v.y) / 2 * drawSize.y;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    let w = (x1 - x0) * 1.02, h = (y1 - y0) * 1.02;
    if (w / h < aspect) w = h * aspect; else h = w / aspect;
    w = Math.min(w, drawSize.x); h = Math.min(h, drawSize.y);
    const cx = Math.min(Math.max((x0 + x1) / 2, w / 2), drawSize.x - w / 2), cy = Math.min(Math.max((y0 + y1) / 2, h / 2), drawSize.y - h / 2);
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }
  function anchorFor(sel) {
    if (!sel || !room) return null;
    if (sel.kind === 'item') {
      const it = room.items.find((i) => i.id === sel.id); const def = sel.def; if (!it || !def) return null;
      if (def.kind === 'wall') { const { pos } = wallPose(room, it.wall, it.u, it.y + def.size[1] / 2, 0); return toScreen(...pos); }
      const w = worldOf(it);
      return toScreen(w.x, def.size[2] + 0.05, w.z);
    }
    if (sel.kind === 'opening') { const o = room.openings.find((x) => x.id === sel.id); if (!o) return null; const { pos } = wallPose(room, o.wall, o.offset, o.bottom + o.height, 0); return toScreen(...pos); }
    if (sel.kind === 'surface') {
      if (sel.key === 'floor') return toScreen(room.width / 2, 0, room.length / 2);
      const { pos } = wallPose(room, sel.key, wallLength(room, sel.key) / 2, room.height, 0); return toScreen(...pos);
    }
    return null;
  }
  function toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, behind: v.z > 1 };
  }

  return {
    canvas, controls, camera, three: scene, composer, renderer, stats, reflection,
    setRoom(next, defs) {
      room = next;
      const nextView = next.view || 'garden';
      const sig = JSON.stringify([next.width, next.length, next.height, next.openings, next.finishes, next.balcony, nextView, Q.texture]);
      if (sig !== roomSig) { roomSig = sig; view = nextView; rebuildRoom(); }
      syncItems(defs);
      if (next.id !== roomId) { const first = roomId === null; roomId = next.id; if (first && drift.enabled) startIntro(); else resetView(!first); }
      invalidate();
    },
    get quality() { return Q.level; },
    setQuality(level) {
      setQuality(level); saveQuality(Q.level);
      clearMaterialCache(); roomSig = '';
      for (const rec of itemMeshes.values()) rec.sig = '';
      applyQuality();
      invalidate();
      return QUALITY[Q.level];
    },
    worldOf: (item) => worldOf(item),
    // debug: lift the camera limits for inspection screenshots
    setFreeCamera(on) { freeCamera = on; controls.maxDistance = on ? 200 : 90; },
    // time of day (0 morning .. 3 night), atmosphere id or null, lamp level or null (follow daylight)
    setLight(next) { const n = { time: next.time ?? 1, atmosphere: next.atmosphere ?? null, lamps: next.lamps ?? null }; if (JSON.stringify(n) === JSON.stringify(light)) return; light = n; try { applyTime(); } catch (err) { report('change of light', err); } invalidate(); },
    setTime(t) { this.setLight({ ...light, time: t }); },
    get lampLevel() { return L.lampLevel; },
    setPreview, resetView, raycastFloor, raycastWalls, pick, pickItem,
    setSelected(sel) { selected = sel; refreshSelection(); invalidate({ shadows: false }); },
    anchorFor, requestRender,
    // called after every drawn frame (keeps floating UI attached)
    onFrame(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // true once every model has loaded, nothing changed for a moment and the view is refined (for tools)
    get idle() { return pendingModels() === 0 && performance.now() - changedAt > 700 && !tween && !drift.intro && !drift.active && converged(); },
    get converged() { return converged(); },
    // tools: turn all camera motion (intro glide and idle drift) off or back on
    setDrift(on) { if (!on && drift.intro) { drift.intro.start = -1e9; updateIntro(performance.now()); } drift.enabled = on; if (!on) { drift.active = false; drift.base = null; drift.intro = null; } else drift.lastInput = performance.now(); },
    // the optional slow drift after a while without input
    get idleMotion() { return drift.idle; },
    setIdleMotion(on) { drift.idle = !!on; drift.lastInput = performance.now(); if (!on && drift.active) { drift.active = false; drift.base = null; } try { localStorage.setItem(IDLE_KEY, on ? '1' : '0'); } catch {} },
    get qualityStep() { return gov.step; },
    shiftView(dx, dz) { atDefault = false; camera.position.x += dx; camera.position.z += dz; controls.target.x += dx; controls.target.z += dz; controls.update(); motion(); },
    setGripHover(wall) { for (const [k, m] of Object.entries(grips)) m.material = k === wall ? gripHotMat : gripMat; invalidate({ shadows: false }); },
    // floating panels cover these margins (css px); the view centres on the rest
    // Panels opening or closing: the picture glides to centre on the space that is
    // left, and if the camera is still at its overview it moves to fill that space.
    setInsets(next, { animate = true } = {}) {
      const changed = ['left', 'right', 'top', 'bottom'].some((k) => (next[k] ?? insets[k]) !== insets[k]); Object.assign(insets, next);
      if (!changed) return;
      if (!animate || !room) { Object.assign(shown, insets); insetAnim = null; applyInsets(); }
      else insetAnim = { from: { ...shown }, start: performance.now(), ms: 420 };
      // the opening glide aims at the newly framed view
      if (drift.intro && room) { const v = defaultView(); drift.intro.to.setFromVector3(tmpV.copy(v.pos).sub(v.target)); drift.intro.target.copy(v.target); }
      else if (room && atDefault && !interacting && animate) { flyTo(defaultView(), 420); atDefault = true; }
      motion();
    },
    setGripsVisible(v) { gripGroup.visible = v; invalidate(); },
    previewOpening(wall, offset, def, ok) { if (!wall) { preview.show(false); invalidate({ shadows: false }); return; } layoutOpening(preview, wall, offset, def.width, def.bottom, def.height); preview.setColor(ok ? OK : BAD); preview.show(true); motion(); },
    // Small pictures of the room as it is now under other lights (the atmosphere
    // chooser). All frames are drawn in one go and the real view is drawn last,
    // so the window never shows them.
    // If one picture fails it comes back empty (the card keeps its colours), and
    // the room is always put back as it was: a failure half way used to leave
    // the scene on the first preview's light with refining switched off, so
    // every later change of light went nowhere until a reload.
    previews(lights, { width = 360, height = 240 } = {}) {
      if (!room) return [];
      const keepLight = light, keepSel = selected, keepGrips = gripGroup.visible, keepAccum = accum;
      const out = [];
      try {
        selected = null; selection.show(false); gripGroup.visible = false; accum = null;
        const crop = roomCrop(width / height), c = document.createElement('canvas'); c.width = width; c.height = height;
        const g = c.getContext('2d');
        for (const l of lights) {
          try {
            light = { time: l.time ?? 1, atmosphere: l.atmosphere ?? null, lamps: l.lamps ?? null }; applyTime();
            renderFrame(0);
            g.drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, width, height);
            out.push(c.toDataURL('image/jpeg', 0.86));
          } catch (err) { report('atmosphere preview', err); out.push(''); }
        }
      } finally {
        light = keepLight; accum = keepAccum; gripGroup.visible = keepGrips; selected = keepSel;
        try { applyTime(); } catch (err) { report('light after previews', err); }
        sample = 0; drawSafely(0); sample = 1;
      }
      return out;
    },
    // a full-quality still of the current view
    screenshot() { if (accum && converged()) present(); else renderFrame(0); return canvas.toDataURL('image/png'); },
    setItemHidden(id, hidden) { const rec = itemMeshes.get(id); if (rec) rec.group.visible = !hidden; invalidate(); },
    toScreen,
  };
}
