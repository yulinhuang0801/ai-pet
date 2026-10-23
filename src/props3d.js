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

function fountain() {
  const g = new THREE.Group();
  g.add(cylinder(2.0, 2.1, 0.55, '#b9b7b0', 0, 0, 0, 28));
  g.add(cylinder(1.75, 1.75, 0.03, '#6fb7e6', 0, 0.5, 0, 28, { transparent: true, opacity: 0.85 }));
  g.add(cylinder(0.25, 0.35, 1.2, '#c9c7c0', 0, 0.4, 0, 12));
  g.add(cylinder(0.7, 0.3, 0.2, '#c9c7c0', 0, 1.5, 0, 16));
  g.add(cylinder(0.04, 0.04, 0.6, '#a9dcf5', 0, 1.7, 0, 6, { transparent: true, opacity: 0.8 }));
  return g;
}

function drinkingWater() {
  const g = new THREE.Group();
  g.add(cylinder(0.12, 0.15, 1.0, '#7e8791'));
  g.add(cylinder(0.2, 0.2, 0.08, '#4fa3d9', 0, 1.0));
  return g;
}

function playground() {
  const g = new THREE.Group();
  // Swing frame.
  for (const x of [-1.1, 1.1]) {
    for (const z of [-0.5, 0.5]) {
      const leg = cylinder(0.04, 0.04, 2.4, '#d6584a', x * 1.0 + z * 0.2, 0, z);
      leg.rotation.z = -x * 0.08;
      g.add(leg);
    }
  }
  g.add(cylinder(0.05, 0.05, 2.5, '#d6584a', 0, 2.3, 0, 8).rotateZ(Math.PI / 2));
  for (const x of [-0.5, 0.5]) g.add(box(0.4, 0.05, 0.2, '#2f6db5', x, 0.55));
  // Slide.
  const slide = new THREE.Group();
  const ramp = box(0.7, 0.06, 2.4, '#f2c13d');
  ramp.rotation.x = 0.55;
  ramp.position.set(0, 0.95, 0.9);
  slide.add(ramp);
  slide.add(box(0.8, 1.7, 0.8, '#3a9d5d', 0, 0, -0.6));
  slide.position.set(3, 0, 0);
  g.add(slide);
  // Soft ground under it.
  g.add(cylinder(3.8, 3.8, 0.04, '#d98d5d', 1.5, 0, 0, 24));
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
