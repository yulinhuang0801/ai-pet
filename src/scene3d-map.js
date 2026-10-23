// The map walk's block world in 3D: the same 1 m blocks (blocks.js) the
// bird's-eye view draws, built as geometry. Ground blocks are flat coloured
// tiles (kerbs and pavements a little raised, water sunk), buildings are
// extruded to their height, fences and hedges are low walls, and trees are
// instanced. Each 32 m chunk is one mesh, built once when it first appears.
//
// Metres in this file: x east, z south (map y), y up.

import * as THREE from '../vendor/three/three.module.min.js';
import { CHUNK, B } from './blocks.js';

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
      const jitter = 0.96 + hash(i * 7.3 + j * 13.1) * 0.08;

      if (id === B.BUILDING) {
        const height = Math.max(BUILDING_MIN, h);
        const wall = WALLS[Math.floor(hash(house * 3 + 7) * WALLS.length)];
        const roof = ROOFS[Math.floor(hash(house) * ROOFS.length)];
        // Walls only where the neighbour isn't the same building.
        const open = (di, dj) => { const n = cell(blocks, i + di, j + dj); return !(n.id === B.BUILDING && n.house === house); };
        bm.box(i, 0, j, i + 1, height, j + 1, wall, {
          top: shade(roof, jitter),
          skip: { south: !open(0, 1), north: !open(0, -1), east: !open(1, 0), west: !open(-1, 0) },
        });
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
    const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1, 6);
    trunk.translate(0, 0.5, 0);
    this.trunkGeo = trunk;
    this.crownGeo = new THREE.IcosahedronGeometry(1, 1);
    this.trunkMat = new THREE.MeshLambertMaterial({ color: '#6e5038' });
    this.cut = { uCam: { value: new THREE.Vector3() }, uPlayer: { value: new THREE.Vector3() }, uRadius: { value: 4 } };
    this.crownMat = seeThrough(new THREE.MeshLambertMaterial({ color: '#ffffff' }), this.cut);
    this.buildingMat = seeThrough(new THREE.MeshLambertMaterial({ vertexColors: true }), this.cut);
    this.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  // Build up to `budget` chunks that don't have a mesh yet, nearest to (x, z) first.
  sync(blocks, x, z, budget = 3) {
    if (this.blocks !== blocks) this.reset(blocks);
    const todo = blocks.chunks.filter((c) => !this.chunks.has(c));
    todo.sort((a, b) => Math.hypot((a.ci + 0.5) * CHUNK - x, (a.cj + 0.5) * CHUNK - z) - Math.hypot((b.ci + 0.5) * CHUNK - x, (b.cj + 0.5) * CHUNK - z));
    for (const c of todo.slice(0, budget)) {
      const mesh = buildChunk(blocks, c, this.buildingMat, this.groundMat);
      this.chunks.set(c, mesh);
      this.group.add(mesh);
    }
    if (blocks.trees.length !== this.treeCount) this.buildTrees(blocks.trees);
  }

  // Where the camera and the player are, for the see-through hole.
  focus(camera, player) {
    this.cut.uCam.value.copy(camera);
    this.cut.uPlayer.value.copy(player);
  }

  reset(blocks) {
    for (const mesh of this.chunks.values()) { this.group.remove(mesh); mesh.traverse((o) => o.geometry?.dispose()); }
    this.chunks.clear();
    if (this.trunks) { this.group.remove(this.trunks, this.crowns); this.trunks.dispose(); this.crowns.dispose(); this.trunks = null; }
    this.blocks = blocks;
    this.treeCount = -1;
  }

  buildTrees(trees) {
    if (this.trunks) { this.group.remove(this.trunks, this.crowns); this.trunks.dispose(); this.crowns.dispose(); }
    const n = trees.length;
    this.treeCount = n;
    this.trunks = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, Math.max(1, n));
    this.crowns = new THREE.InstancedMesh(this.crownGeo, this.crownMat, Math.max(1, n));
    this.trunks.count = this.crowns.count = n;
    this.trunks.castShadow = this.crowns.castShadow = true;
    const mat = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const colour = new THREE.Color();
    trees.forEach((t, k) => {
      const crown = Math.max(1.1, t.r * 0.5);
      const trunkH = 1.6 + hash(k + 3) * 1.2;
      mat.compose(new THREE.Vector3(t.x, 0, t.y), quat, new THREE.Vector3(1, trunkH, 1));
      this.trunks.setMatrixAt(k, mat);
      mat.compose(new THREE.Vector3(t.x, trunkH + crown * 0.55, t.y), quat, new THREE.Vector3(crown, crown * 0.9, crown));
      this.crowns.setMatrixAt(k, mat);
      const l = LEAVES[Math.floor(hash(k + 11) * LEAVES.length)];
      this.crowns.setColorAt(k, colour.setRGB(l[0], l[1], l[2]));
    });
    this.trunks.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
    if (this.crowns.instanceColor) this.crowns.instanceColor.needsUpdate = true;
    this.group.add(this.trunks, this.crowns);
  }
}
