// The landmarks of a real place as small 3D models for the map walk: benches,
// fountains, playgrounds, dog parks, cafés and shops. They are built from a
// few boxes and cylinders, a metre or so across, standing on y = 0.

import * as THREE from '../vendor/three/three.module.min.js';

const mats = new Map();
const mat = (color, extra = {}) => {
  const key = color + JSON.stringify(extra);
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, ...extra }));
  return mats.get(key);
};

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

function cylinder(rTop, rBottom, h, color, x = 0, y = 0, z = 0, segments = 16, extra = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat(color, extra));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  return m;
}

// A name on a signboard that always faces the camera.
export function label(text, y, color = '#1d6d64') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '700 26px Figtree, system-ui, sans-serif';
  const w = Math.min(244, ctx.measureText(text).width + 28);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 8, w, 48, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33, 232);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, fog: false }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = y;
  return sprite;
}

function bench() {
  const g = new THREE.Group();
  g.add(box(1.7, 0.07, 0.45, '#9a6b3f', 0, 0.45));
  g.add(box(1.7, 0.4, 0.06, '#9a6b3f', 0, 0.62, -0.22));
  for (const x of [-0.7, 0.7]) g.add(box(0.07, 0.45, 0.4, '#3d3a36', x, 0));
  return g;
}

// A stick between two points.
function strut(x1, y1, z1, x2, y2, z2, r, color, segments = 8) {
  const from = new THREE.Vector3(x1, y1, z1);
  const to = new THREE.Vector3(x2, y2, z2);
  const len = from.distanceTo(to);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, segments), mat(color));
  m.position.copy(from).lerp(to, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  m.castShadow = true;
  return m;
}

function lathe(points, color, extra = {}, segments = 32) {
  const m = new THREE.Mesh(
    new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments),
    mat(color, { side: THREE.DoubleSide, ...extra }),
  );
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A tiered stone fountain: a basin with a rim and a step round it, two bowls
// on a column, and a ring of jets arching into the water.
function fountain() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [1.75, 0], [1.75, 0.14], [0, 0.14]], '#a9a79f'));
  g.add(lathe([[1.4, 0.1], [1.5, 0.1], [1.5, 0.55], [1.38, 0.55], [1.38, 0.1]], '#c7c5bd'));
  g.add(lathe([[0, 0.1], [1.4, 0.1], [1.4, 0.45], [0, 0.45]], '#7fb7de', { transparent: true, opacity: 0.88 }));
  g.add(cylinder(0.22, 0.3, 1.0, '#c7c5bd', 0, 0.1, 0, 14));
  g.add(lathe([[0, 1.0], [0.75, 1.15], [0.8, 1.25], [0.7, 1.25], [0.0, 1.1]], '#c7c5bd'));
  g.add(lathe([[0, 1.08], [0.62, 1.2], [0, 1.2]], '#8cc4e8', { transparent: true, opacity: 0.85 }));
  g.add(cylinder(0.12, 0.18, 0.5, '#c7c5bd', 0, 1.15, 0, 10));
  g.add(lathe([[0, 1.6], [0.35, 1.72], [0.38, 1.78], [0.3, 1.78], [0, 1.68]], '#c7c5bd'));
  // Water arching from the top bowl and the middle one into the basin.
  const water = { transparent: true, opacity: 0.55 };
  g.add(cylinder(0.05, 0.1, 0.7, '#cfeaf8', 0, 1.7, 0, 8, water));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.add(strut(Math.cos(a) * 0.55, 1.15, Math.sin(a) * 0.55, Math.cos(a) * 1.15, 0.45, Math.sin(a) * 1.15, 0.025, '#cfeaf8', 6).clone());
  }
  for (const o of g.children) if (o.material?.color?.getHexString() === 'cfeaf8') o.material = mat('#cfeaf8', water);
  return g;
}

function drinkingWater() {
  const g = new THREE.Group();
  g.add(cylinder(0.12, 0.15, 1.0, '#7e8791'));
  g.add(cylinder(0.2, 0.2, 0.08, '#4fa3d9', 0, 1.0));
  return g;
}

// A play area: a rubber pad with a swing set, a tower with a ladder and slide, and a sandpit.
function playground() {
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [4.6, 0], [4.6, 0.05], [0, 0.05]], '#c86f4f', {}, 40));

  // Swing set: two A-frames, a top bar, two swings on chains.
  const swings = new THREE.Group();
  for (const x of [-1.3, 1.3]) {
    swings.add(strut(x, 2.25, 0, x, 0, -0.8, 0.05, '#d6584a'));
    swings.add(strut(x, 2.25, 0, x, 0, 0.8, 0.05, '#d6584a'));
  }
  swings.add(strut(-1.4, 2.25, 0, 1.4, 2.25, 0, 0.06, '#b8453a'));
  for (const x of [-0.5, 0.5]) {
    for (const dx of [-0.17, 0.17]) swings.add(strut(x + dx, 2.2, 0, x + dx, 0.5, 0, 0.012, '#4a4a4a', 4));
    swings.add(box(0.4, 0.05, 0.2, '#2f6db5', x, 0.45));
  }
  swings.position.set(-1.2, 0, 0.6);
  g.add(swings);

  // Tower with a roof, a ladder at the back and a slide at the front.
  const tower = new THREE.Group();
  for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) tower.add(box(0.1, 2.4, 0.1, '#3a9d5d', x - 0.05, 0, z - 0.05));
  tower.add(box(1.4, 0.08, 1.4, '#8a6a3f', -0.7, 1.2, -0.7));
  for (const x of [-0.6, 0.6]) tower.add(box(0.06, 0.4, 1.3, '#3a9d5d', x - 0.03, 1.28, -0.65));
  tower.add(box(1.5, 0.06, 1.5, '#e0a82c', -0.75, 2.4, -0.75));
  tower.add(strut(-0.6, 2.4, -0.6, 0, 2.7, 0, 0.03, '#e0a82c'));
  tower.add(strut(0.6, 2.4, -0.6, 0, 2.7, 0, 0.03, '#e0a82c'));
  tower.add(strut(-0.6, 2.4, 0.6, 0, 2.7, 0, 0.03, '#e0a82c'));
  tower.add(strut(0.6, 2.4, 0.6, 0, 2.7, 0, 0.03, '#e0a82c'));
  // Ladder.
  for (const x of [-0.25, 0.25]) tower.add(strut(x, 1.2, -0.7, x, 0, -1.3, 0.03, '#b88a4a'));
  for (let k = 1; k < 5; k++) tower.add(strut(-0.25, k * 0.24, -1.3 + (1 - k / 5) * 0.6, 0.25, k * 0.24, -1.3 + (1 - k / 5) * 0.6, 0.02, '#b88a4a', 6));
  // Slide.
  const slide = new THREE.Group();
  const ramp = box(0.7, 0.05, 2.5, '#f2c13d');
  ramp.rotation.x = Math.atan2(1.2, 2.2);
  ramp.position.set(0, 0.62, 0.0);
  slide.add(ramp);
  for (const x of [-0.37, 0.37]) { const rail = box(0.05, 0.14, 2.5, '#d9a82a'); rail.rotation.x = ramp.rotation.x; rail.position.set(x, 0.7, 0.0); slide.add(rail); }
  slide.position.set(0, 0, 1.95);
  tower.add(slide);
  tower.position.set(2.2, 0, -0.3);
  g.add(tower);

  // Sandpit.
  const sand = new THREE.Group();
  sand.add(box(1.6, 0.06, 1.6, '#e2cf96'));
  for (const [w, d, x, z] of [[1.8, 0.1, 0, 0.85], [1.8, 0.1, 0, -0.85], [0.1, 1.6, 0.85, 0], [0.1, 1.6, -0.85, 0]]) sand.add(box(w, 0.2, d, '#8a6a3f', x, 0, z));
  sand.position.set(-0.4, 0, -2.5);
  g.add(sand);
  return g;
}

function dogPark() {
  const g = new THREE.Group();
  for (const x of [-1.4, 1.4]) g.add(cylinder(0.08, 0.08, 2.2, '#6b4a2f', x));
  g.add(box(3.1, 0.12, 0.12, '#6b4a2f', 0, 2.15));
  // A bone shape on the arch.
  g.add(box(0.9, 0.12, 0.1, '#f4f0e6', 0, 1.8, 0.08));
  for (const x of [-0.5, 0.5]) for (const z of [-0.08, 0.08]) {
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat('#f4f0e6'));
    knob.position.set(x, 1.86, 0.08 + z * 0.4);
    g.add(knob);
  }
  return g;
}

function parasolTable(color) {
  const g = new THREE.Group();
  g.add(cylinder(0.45, 0.45, 0.05, '#f2ece0', 0, 0.72, 0, 16));
  g.add(cylinder(0.04, 0.04, 0.72, '#3d3a36'));
  g.add(cylinder(0.02, 0.02, 1.9, '#3d3a36', 0, 0));
  g.add(cylinder(0.02, 1.15, 0.5, color, 0, 1.75, 0, 12));
  return g;
}

function shopFront(awning) {
  const g = new THREE.Group();
  g.add(box(2.4, 0.08, 1.0, awning, 0, 2.3, 0.55).rotateX(0.35));
  for (const x of [-1.15, 1.15]) g.add(cylinder(0.03, 0.03, 2.3, '#3d3a36', x, 0, 1.0, 6));
  return g;
}

function iceCream() {
  const g = new THREE.Group();
  g.add(cylinder(0.02, 0.02, 1.0, '#3d3a36'));
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 12), mat('#d9a35b'));
  cone.rotation.x = Math.PI;
  cone.position.y = 1.35;
  cone.castShadow = true;
  g.add(cone);
  const scoop = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), mat('#f6a9c2'));
  scoop.position.y = 1.85;
  scoop.castShadow = true;
  g.add(scoop);
  return g;
}

// The start or finish of a walk along a saved route.
export function routePost(text, finish) {
  const g = new THREE.Group();
  g.add(cylinder(0.05, 0.05, 2.6, '#3d3a36'));
  g.add(box(0.9, 0.5, 0.04, finish ? '#1f2a24' : '#1d6d64', 0.47, 2.0));
  if (finish) for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2) g.add(box(0.225, 0.25, 0.05, '#f4f7f4', 0.14 + c * 0.225, 2.0 + r * 0.25));
  g.add(label(text, 3.1, finish ? '#1f2a24' : '#1d6d64'));
  return g;
}

const SIGN_HEIGHT = { dog_park: 2.9, playground: 3.0, fountain: 3.0, cafe: 2.8, restaurant: 2.8, ice_cream: 2.6, shop: 2.9 };
const SIGN_COLOUR = { dog_park: '#8a5a32', playground: '#d6584a', fountain: '#2f6db5', cafe: '#8a5a32', restaurant: '#a33a3a', ice_cream: '#d6629a', shop: '#1d6d64' };

// A landmark's model, or null for kinds that have none. `name` is shown on a sign
// for the bigger ones.
export function buildLandmark(kind, name) {
  const g = new THREE.Group();
  switch (kind) {
    case 'bench': g.add(bench()); break;
    case 'fountain': g.add(fountain()); break;
    case 'drinking_water': g.add(drinkingWater()); break;
    case 'playground': g.add(playground()); break;
    case 'dog_park': g.add(dogPark()); break;
    case 'cafe': case 'restaurant': {
      g.add(shopFront(kind === 'cafe' ? '#3a7d5c' : '#b84a3a'));
      const t = parasolTable(kind === 'cafe' ? '#e8a23d' : '#c8553d');
      t.position.set(2.2, 0, 1.6);
      g.add(t);
      break;
    }
    case 'ice_cream': g.add(iceCream()); break;
    case 'shop': g.add(shopFront('#3f6fa8')); break;
    default: return null;
  }
  if (name && SIGN_HEIGHT[kind]) g.add(label(name, SIGN_HEIGHT[kind], SIGN_COLOUR[kind]));
  return g;
}
