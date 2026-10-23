// The map walk's block world in 3D: the same 1 m blocks (blocks.js) the
// bird's-eye view draws, built as geometry. Ground blocks are flat coloured
// tiles (kerbs and pavements a little raised, water sunk), buildings are
// extruded to their height, fences and hedges are low walls, and trees are
// instanced. Each 32 m chunk is one mesh, built once when it first appears.
//
// Metres in this file: x east, z south (map y), y up.

import * as THREE from '../vendor/three/three.module.min.js';
import { CHUNK, B, nearestOpen } from './blocks.js';
import { buildLandmark } from './props3d.js';
import { landmarkName } from './route-art.js';

const rgb = (r, g, b) => [r / 255, g / 255, b / 255];

const GROUND_COLOURS = {
  [B.GRASS]: rgb(118, 176, 84), [B.DIRT]: rgb(150, 112, 74), [B.SAND]: rgb(226, 208, 150), [B.GRAVEL]: rgb(150, 146, 140),
  [B.PAVEMENT]: rgb(214, 211, 204), [B.PAVING]: rgb(196, 178, 158), [B.ASPHALT]: rgb(94, 97, 104), [B.PARKING]: rgb(124, 126, 132),
  [B.WATER]: rgb(72, 136, 212), [B.PITCH]: rgb(92, 168, 82), [B.PLAYGROUND]: rgb(214, 136, 92), [B.FARMLAND]: rgb(160, 128, 72),
  [B.FOREST]: rgb(84, 128, 64), [B.CYCLEWAY]: rgb(176, 92, 82), [B.RAIL]: rgb(86, 74, 62), [B.LINE]: rgb(244, 244, 240),
  [B.LINE_YELLOW]: rgb(238, 196, 64), [B.ZEBRA]: rgb(242, 242, 238), [B.FLOWERS]: rgb(200, 110, 150), [B.CEMETERY]: rgb(108, 140, 92),
  [B.WOOD]: rgb(150, 110, 64), [B.KERB]: rgb(178, 178, 172),
};
const FENCE = rgb(132, 98, 64);
const HEDGE = rgb(58, 118, 52);
const ROOFS = [rgb(186, 104, 84), rgb(160, 88, 72), rgb(128, 132, 142), rgb(176, 120, 88), rgb(204, 140, 96), rgb(112, 118, 130), rgb(190, 128, 108)];
const WALLS = [rgb(243, 230, 208), rgb(234, 220, 197), rgb(246, 239, 226), rgb(231, 214, 192)];
const LEAVES = [rgb(64, 128, 56), rgb(78, 146, 64), rgb(56, 112, 50)];

// How high each ground block sits, in metres. Water is sunk so ponds have banks.
const LEVEL = { [B.KERB]: 0.12, [B.PAVEMENT]: 0.07, [B.WATER]: -0.3 };
const level = (id) => LEVEL[id] ?? 0;
const BUILDING_MIN = 3;

function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// What's in one square: its block, how tall a building is, and which building.
function cell(blocks, i, j) {
  const c = blocks.grid.chunkAt(i, j);
  if (!c) return { id: B.NONE, h: 0, house: 0 };
  const n = (j - c.cj * CHUNK) * CHUNK + (i - c.ci * CHUNK);
  return { id: c.block[n], h: c.height?.[n] ?? 0, house: c.house?.[n] ?? 0 };
}

class Mesher {
  constructor() { this.pos = []; this.nor = []; this.col = []; }

  // A quad from four corners, counter-clockwise seen from the side the normal points to.
  quad(a, b, c, d, n, colour) {
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(colour[0], colour[1], colour[2]);
    }
  }

  // A box between two corners, with chosen faces left out.
  box(x0, y0, z0, x1, y1, z1, colour, { top = colour, skip = {} } = {}) {
    const f = (a, b, c, d, n, col) => this.quad(a, b, c, d, n, col);
    if (!skip.top) f([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], top);
    if (!skip.south) f([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], shade(colour, 0.92));
    if (!skip.north) f([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], shade(colour, 0.86));
    if (!skip.east) f([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], shade(colour, 0.78));
    if (!skip.west) f([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], shade(colour, 0.84));
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// One chunk as a single mesh.
const GLASS = rgb(86, 112, 138);
const GLASS_LIT = rgb(244, 208, 128);

// Windows on one square of an outside wall, one every second square, one per floor.
function windows(m, i, j, height, side, wall) {
  const along = side === 'south' || side === 'north' ? i : j;
  if (along % 2) return;
  const frame = shade(wall, 0.7);
  for (let y = 1.0, floor = 0; y + 1.3 < height; y += 3.2, floor++) {
    const lit = hash(i * 31 + j * 17 + floor * 5) > 0.82;
    const glass = lit ? GLASS_LIT : GLASS;
    const e = 0.02;
    const [a, b] = [0.2, 0.8];
    if (side === 'south') { m.quad([i + a, y, j + 1 + e], [i + b, y, j + 1 + e], [i + b, y + 1.3, j + 1 + e], [i + a, y + 1.3, j + 1 + e], [0, 0, 1], glass); }
    else if (side === 'north') { m.quad([i + b, y, j - e], [i + a, y, j - e], [i + a, y + 1.3, j - e], [i + b, y + 1.3, j - e], [0, 0, -1], glass); }
    else if (side === 'east') { m.quad([i + 1 + e, y, j + b], [i + 1 + e, y, j + a], [i + 1 + e, y + 1.3, j + a], [i + 1 + e, y + 1.3, j + b], [1, 0, 0], glass); }
    else { m.quad([i - e, y, j + a], [i - e, y, j + b], [i - e, y + 1.3, j + b], [i - e, y + 1.3, j + a], [-1, 0, 0], glass); }
    // A sill under each window.
    if (side === 'south') m.box(i + 0.15, y - 0.08, j + 1, i + 0.85, y, j + 1.06, frame);
    else if (side === 'north') m.box(i + 0.15, y - 0.08, j - 0.06, i + 0.85, y, j, frame);
    else if (side === 'east') m.box(i + 1, y - 0.08, j + 0.15, i + 1.06, y, j + 0.85, frame);
    else m.box(i - 0.06, y - 0.08, j + 0.15, i, y, j + 0.85, frame);
  }
}

// One chunk as two meshes: the ground with its low walls and hedges, and the
// buildings, which can be cut through to see you behind them.
function buildChunk(blocks, chunk, buildingMat, groundMat) {
  const m = new Mesher();
  const bm = new Mesher();
  const x0 = chunk.ci * CHUNK;
  const z0 = chunk.cj * CHUNK;
  for (let j = z0; j < z0 + CHUNK; j++) {
    for (let i = x0; i < x0 + CHUNK; i++) {
      const { id, h, house } = cell(blocks, i, j);
      if (id === B.NONE) continue;
      // Slight variation square to square and over larger patches, and a little
      // shade in the corners next to buildings.
      let jitter = 0.95 + hash(i * 7.3 + j * 13.1) * 0.06 + (hash(Math.floor(i / 4) * 3.1 + Math.floor(j / 4) * 5.7) - 0.5) * 0.08;
      if (id !== B.BUILDING && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => cell(blocks, i + di, j + dj).id === B.BUILDING)) jitter *= 0.86;

      if (id === B.BUILDING) {
        const height = Math.max(BUILDING_MIN, h);
        const wall = WALLS[Math.floor(hash(house * 3 + 7) * WALLS.length)];
        const roof = ROOFS[Math.floor(hash(house) * ROOFS.length)];
        // Walls only where the neighbour isn't the same building.
        const open = (di, dj) => { const n = cell(blocks, i + di, j + dj); return !(n.id === B.BUILDING && n.house === house); };
        // A floor, so a hole cut through the walls shows a room, not the sky.
        m.quad([i, 0, j + 1], [i + 1, 0, j + 1], [i + 1, 0, j], [i, 0, j], [0, 1, 0], rgb(96, 88, 80));
        const sides = { south: open(0, 1), north: open(0, -1), east: open(1, 0), west: open(-1, 0) };
        bm.box(i, 0, j, i + 1, height, j + 1, wall, {
          top: shade(roof, jitter),
          skip: { south: !sides.south, north: !sides.north, east: !sides.east, west: !sides.west },
        });
        // A low parapet round the roof edge, and a window for every second square
        // on each floor of an outside wall.
        const trim = shade(wall, 0.8);
        if (sides.south) { bm.box(i, height, j + 0.9, i + 1, height + 0.3, j + 1, trim); windows(bm, i, j, height, 'south', wall); }
        if (sides.north) { bm.box(i, height, j, i + 1, height + 0.3, j + 0.1, trim); windows(bm, i, j, height, 'north', wall); }
        if (sides.east) { bm.box(i + 0.9, height, j, i + 1, height + 0.3, j + 1, trim); windows(bm, i, j, height, 'east', wall); }
        if (sides.west) { bm.box(i, height, j, i + 0.1, height + 0.3, j + 1, trim); windows(bm, i, j, height, 'west', wall); }
        continue;
      }

      // Ground under everything else (fences and hedges stand on grass).
      const gid = id === B.FENCE || id === B.HEDGE ? B.GRASS : id;
      const y = level(gid);
      const base = GROUND_COLOURS[gid] ?? GROUND_COLOURS[B.GRASS];
      m.quad([i, y, j + 1], [i + 1, y, j + 1], [i + 1, y, j], [i, y, j], [0, 1, 0], shade(base, jitter));
      // A step down to lower neighbours: kerbs, pavements, pond banks.
      for (const [di, dj, a, b, n] of [
        [0, 1, [i + 1, 0, j + 1], [i, 0, j + 1], [0, 0, 1]],
        [0, -1, [i, 0, j], [i + 1, 0, j], [0, 0, -1]],
        [1, 0, [i + 1, 0, j], [i + 1, 0, j + 1], [1, 0, 0]],
        [-1, 0, [i, 0, j + 1], [i, 0, j], [-1, 0, 0]],
      ]) {
        const low = level(cell(blocks, i + di, j + dj).id === B.NONE ? gid : cell(blocks, i + di, j + dj).id);
        if (low < y - 0.01) m.quad([a[0], low, a[2]], [b[0], low, b[2]], [b[0], y, b[2]], [a[0], y, a[2]], n, shade(base, 0.8));
      }
      if (id === B.HEDGE) m.box(i + 0.1, 0, j + 0.1, i + 0.9, 1.2, j + 0.9, HEDGE);
      else if (id === B.FENCE) m.box(i + 0.4, 0, j + 0.4, i + 0.6, 1.1, j + 0.6, FENCE);
    }
  }
  const group = new THREE.Group();
  for (const [mesher, mat] of [[m, groundMat], [bm, buildingMat]]) {
    if (!mesher.pos.length) continue;
    const mesh = new THREE.Mesh(mesher.geometry(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// Fragments on the line between the camera and you are dropped, so a
// building (or a tree) in the way shows a hole, not a wall.
function seeThrough(material, cut) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cut);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
        #endif
        vWPos = (modelMatrix * wp).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec3 uCam;\nuniform vec3 uPlayer;\nuniform float uRadius;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        vec3 toPlayer = uPlayer - uCam;
        float reach = length(toPlayer);
        vec3 ray = toPlayer / reach;
        vec3 fromCam = vWPos - uCam;
        float along = dot(fromCam, ray);
        if (along > 0.0 && along < reach - 0.3 && length(fromCam - ray * along) < uRadius) discard;`);
  };
  return material;
}

export class MapLayer {
  constructor() {
    this.group = new THREE.Group();
    this.chunks = new Map();
    this.blocks = null;
    this.treeCount = -1;
    this.treeMeshes = [];
    this.landmarks = new Map();
    this.coneGeo = new THREE.ConeGeometry(1, 1, 8);
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    trunk.translate(0, 0.5, 0);
    this.trunkGeo = trunk;
    this.crownGeo = new THREE.IcosahedronGeometry(1, 1);
    this.trunkMat = new THREE.MeshLambertMaterial({ color: '#6e5038' });
    this.cut = { uCam: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() }, uRadius: { value: 3.5 } };
    this.crownMat = seeThrough(new THREE.MeshLambertMaterial({ color: '#ffffff' }), this.cut);
    this.buildingMat = seeThrough(new THREE.MeshLambertMaterial({ vertexColors: true }), this.cut);
    this.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  // Build up to `budget` chunks that don't have a mesh yet, nearest to (x, z) first.
  sync(blocks, x, z, landmarks = [], budget = 3) {
    if (this.blocks !== blocks) this.reset(blocks);
    const todo = blocks.chunks.filter((c) => !this.chunks.has(c));
    todo.sort((a, b) => Math.hypot((a.ci + 0.5) * CHUNK - x, (a.cj + 0.5) * CHUNK - z) - Math.hypot((b.ci + 0.5) * CHUNK - x, (b.cj + 0.5) * CHUNK - z));
    for (const c of todo.slice(0, budget)) {
      const mesh = buildChunk(blocks, c, this.buildingMat, this.groundMat);
      this.chunks.set(c, mesh);
      this.group.add(mesh);
    }
    if (blocks.trees.length !== this.treeCount) this.buildTrees(blocks.trees);
    if (landmarks.length !== this.landmarks.size) this.addLandmarks(landmarks);
  }

  // Where the camera and the player are, for the see-through hole.
  focus(camera, player) {
    this.cut.uCam.value.copy(camera);
    this.cut.uPlayer.value.copy(player);
  }

  reset(blocks) {
    for (const mesh of this.chunks.values()) { this.group.remove(mesh); mesh.traverse((o) => o.geometry?.dispose()); }
    this.chunks.clear();
    this.clearTrees();
    for (const g of this.landmarks.values()) this.group.remove(g);
    this.landmarks.clear();
    this.blocks = blocks;
    this.treeCount = -1;
  }

  clearTrees() {
    for (const m of this.treeMeshes) { this.group.remove(m); m.dispose(); }
    this.treeMeshes = [];
  }

  // Round trees, and pines in woods and now and then elsewhere. One instanced
  // mesh each, rebuilt when more trees load.
  buildTrees(trees) {
    this.clearTrees();
    this.treeCount = trees.length;
    const round = [];
    const pines = [];
    trees.forEach((t, k) => {
      const ground = this.blocks.get(Math.floor(t.x), Math.floor(t.y));
      (ground === B.FOREST || (!t.street && hash(k + 19) < 0.12) ? pines : round).push([t, k]);
    });
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const colour = new THREE.Color();
    const make = (geo, material, count) => {
      const m = new THREE.InstancedMesh(geo, material, Math.max(1, count));
      m.count = count;
      m.castShadow = true;
      this.treeMeshes.push(m);
      return m;
    };
    const trunks = make(this.trunkGeo, this.trunkMat, trees.length);
    const crowns = make(this.crownGeo, this.crownMat, round.length);
    const cones = make(this.coneGeo, this.crownMat, pines.length);
    let n = 0;
    for (const [t, k] of round) {
      const crown = Math.max(1.1, t.r * 0.5);
      const trunkH = 1.6 + hash(k + 3) * 1.2;
      mat.compose(new THREE.Vector3(t.x, 0, t.y), quat, new THREE.Vector3(1, trunkH, 1));
      trunks.setMatrixAt(n, mat);
      mat.compose(new THREE.Vector3(t.x, trunkH + crown * 0.55, t.y), quat, new THREE.Vector3(crown, crown * 0.9, crown));
      crowns.setMatrixAt(n, mat);
      const l = LEAVES[Math.floor(hash(k + 11) * LEAVES.length)];
      crowns.setColorAt(n, colour.setRGB(l[0], l[1], l[2]));
      n++;
    }
    let c = 0;
    for (const [t, k] of pines) {
      const crown = Math.max(0.9, t.r * 0.38);
      const h = 4 + hash(k + 5) * 3;
      mat.compose(new THREE.Vector3(t.x, 0, t.y), quat, new THREE.Vector3(1, 1.2, 1));
      trunks.setMatrixAt(n, mat);
      mat.compose(new THREE.Vector3(t.x, 1.0 + h / 2, t.y), quat, new THREE.Vector3(crown, h, crown));
      cones.setMatrixAt(c, mat);
      const l = LEAVES[2];
      cones.setColorAt(c, colour.setRGB(l[0] * 0.8, l[1] * 0.85, l[2] * 0.8));
      n++;
      c++;
    }
    trunks.count = n;
    for (const m of [trunks, crowns, cones]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.group.add(m);
    }
  }

  // Models for landmarks as they load: put on open ground near where the map says they are.
  addLandmarks(list) {
    for (const lm of list) {
      const key = `${lm.kind}:${lm.x}:${lm.y}`;
      if (this.landmarks.has(key)) continue;
      const model = buildLandmark(lm.kind, ['bench', 'drinking_water'].includes(lm.kind) ? null : landmarkName(lm));
      if (!model) { this.landmarks.set(key, null); continue; }
      // Cafés and shops are marked inside their building: stand outside it.
      const open = nearestOpen(this.blocks, lm.x, lm.y, 10) ?? { x: lm.x, y: lm.y };
      model.position.set(open.x, 0, open.y);
      model.rotation.y = Math.floor(hash(lm.x * 3 + lm.y) * 4) * (Math.PI / 2);
      this.landmarks.set(key, model);
      this.group.add(model);
    }
  }
}
