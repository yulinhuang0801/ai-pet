// A 3D view of the same simulation, drawn with three.js and free animated
// models. The simulation still works in its side-on units; this file places
// everything on a vertical plane through the room (z = 0) and plays library
// animations that match what the pet and owner are doing. Poses the libraries
// lack (sitting, shaking a paw, wagging) are added by turning bones by hand.

import * as THREE from '../vendor/three/three.module.min.js';
import { GLTFLoader } from '../vendor/three/addons/GLTFLoader.js';
import { clone as cloneSkinned } from '../vendor/three/addons/SkeletonUtils.js';
import { VIEW_W, VIEW_H, GROUND, BOWL_X, BED_X, BAG_X, JAR_X, LEASH } from './space-side.js';
import { darkness, skyColors, drawBubble, drawHeart } from './renderer.js';
import { drawFind } from './finds-art.js';
import { portionGrams } from './pet.js';
import { MAP_UNITS_PER_METER as MU } from './space-map.js';
import { MapLayer } from './scene3d-map.js';

// Metres per simulation unit. The owner (300 units tall) comes out at 1.7 m.
export const U = 0.0057;
const X = (x) => (x - VIEW_W / 2) * U;
const Y = (y) => (GROUND - y) * U;

export const BREEDS = [
  { id: 'shiba', name: 'Shiba Inu' },
  { id: 'husky', name: 'Husky' },
];

const ASSETS = 'assets/models/';
const PET_FILES = { shiba: 'shiba.glb', husky: 'husky.glb', cat: 'cat.glb' };
const OWNER_FILE = 'owner/mannequin.glb';
const OWNER_ANIMS = ['owner/anim-general.glb', 'owner/anim-movementbasic.glb', 'owner/anim-movementadvanced.glb', 'owner/anim-simulation.glb'];

const Z_PET = 0.1;
const Z_OWNER = -0.45;
const Z_PROPS = -0.35;

const loader = new GLTFLoader();
const cache = new Map();
// Hosts that can't serve .glb files get each model packed as base64 in a
// .glb.json file instead; a page opts in with <meta name="ai-pet:packed-models">.
const packed = typeof document !== 'undefined' && Boolean(document.querySelector('meta[name="ai-pet:packed-models"]'));

async function loadPacked(file) {
  const res = await fetch(`${ASSETS}${file}.json`);
  if (!res.ok) throw new Error(`Could not load ${file}`);
  const { glb } = await res.json();
  const bytes = Uint8Array.from(atob(glb), (c) => c.charCodeAt(0));
  return loader.parseAsync(bytes.buffer, '');
}

function load(file) {
  if (!cache.has(file)) cache.set(file, packed ? loadPacked(file) : loader.loadAsync(ASSETS + file));
  return cache.get(file);
}

export function supports3D() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// Turn a bone about an axis given in the model's own space (x = the animal's
// left-right, y = up, z = nose direction), whatever the bone's local axes are.
function turnBone(bone, model, axis, angle) {
  if (!bone || !angle) return;
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(tmpQ);
  model.getWorldQuaternion(tmpQ2);
  const local = tmpV.copy(axis).applyQuaternion(tmpQ2).applyQuaternion(tmpQ.invert()).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(local, angle));
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function hash(i) {
  const v = Math.sin(i * 127.1) * 43758.5453;
  return v - Math.floor(v);
}

// --- Animated characters ---

class Character {
  constructor(gltf, clips) {
    this.root = new THREE.Group();
    this.turn = new THREE.Group();
    this.root.add(this.turn);
    this.model = cloneSkinned(gltf.scene);
    this.turn.add(this.model);
    this.bones = {};
    this.meshes = [];
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        o.material = o.material.clone();
        this.meshes.push(o);
      }
    });
    this.rest = Object.values(this.bones).map((b) => [b, b.quaternion.clone(), b.position.clone()]);
    // Bones turned by hand this frame, with the value the animation gave them.
    this.touched = new Map();
    this.mixer = new THREE.AnimationMixer(this.model);
    this.clips = {};
    for (const c of clips) if (!c.name.includes('|') && !this.clips[c.name]) this.clips[c.name] = c;
    this.current = null;
    this.currentName = '';
    this.oneShot = null;
    this.yaw = 0;
  }

  // Scale so the model is `height` metres tall and stands on y = 0.
  fit(height) {
    this.model.scale.setScalar(1);
    this.model.position.set(0, 0, 0);
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const k = height / Math.max(0.001, box.max.y - box.min.y);
    this.model.scale.setScalar(k);
    this.model.position.y = -box.min.y * k;
    this.height = height;
  }

  play(name, { once = false, fade = 0.25, timeScale = 1 } = {}) {
    const clip = this.clips[name];
    if (!clip) return false;
    if (this.currentName === name && !once) {
      this.current.timeScale = timeScale;
      return true;
    }
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.timeScale = timeScale;
    action.fadeIn(fade).play();
    if (this.current && this.current !== action) this.current.fadeOut(fade);
    this.current = action;
    this.currentName = name;
    return true;
  }

  // Play a clip once, then go back to whatever the state calls for.
  playOnce(name, timeScale = 1) {
    if (this.play(name, { once: true, timeScale, fade: 0.15 })) {
      this.oneShot = { name, until: performance.now() / 1000 + this.clips[name].duration / timeScale - 0.15 };
    }
  }

  busy() { return this.oneShot && performance.now() / 1000 < this.oneShot.until; }

  // A one-off clip that should hold its last frame (lying down, sitting on
  // the floor). Once paused, three.js stops applying it, so freeze it instead.
  holdLastFrame() {
    const a = this.current;
    if (a?.paused && a.clampWhenFinished) {
      a.paused = false;
      a.timeScale = 0;
      a.time = a.getClip().duration - 0.001;
    }
  }

  resetPose() {
    for (const [b, q, p] of this.rest) {
      b.quaternion.copy(q);
      b.position.copy(p);
    }
  }

  // Hand-made adjustments on top of the animation. They are undone before the
  // next mixer update: the mixer skips writing values that haven't changed, so
  // anything left in place would pile up frame after frame.
  bend(bone, axis, angle) {
    if (!bone || !angle) return;
    if (!this.touched.has(bone)) this.touched.set(bone, bone.quaternion.clone());
    turnBone(bone, this.model, axis, angle);
  }

  undoTurns() {
    for (const [bone, q] of this.touched) bone.quaternion.copy(q);
    this.touched.clear();
  }

  // Face along a heading on the map: an angle where 0 is east and a quarter turn is south.
  faceHeading(heading, dt) {
    const d = Math.atan2(Math.sin(Math.PI / 2 - heading - this.yaw), Math.cos(Math.PI / 2 - heading - this.yaw));
    this.yaw += d * (1 - Math.exp(-dt * 10));
    this.turn.rotation.y = this.yaw;
  }

  face(dir, dt) {
    // Three-quarter view: turned toward the camera rather than fully side on.
    const target = dir * (Math.PI / 2 - 0.5);
    this.yaw += (target - this.yaw) * (1 - Math.exp(-dt * 8));
    this.turn.rotation.y = this.yaw;
  }
}

class PetModel extends Character {
  constructor(gltf, species, breed) {
    super(gltf, gltf.animations);
    this.species = species;
    this.breed = breed;
    this.coatMeshes = this.meshes;
    this.originalColors = this.meshes.map((m) => m.material.color.clone());
    this.idleName = 'Idle';
    this.idleSwap = 6;
    const b = this.bones;
    this.rig = species === 'cat'
      ? { back: b.torso_02, head: b.head_018, neck: b.neck_017, tail: [b.tail01_08, b.tail02_09, b.tail03_010], frontR: b['legupperFR_024'], frontL: b['legupperFL_014'], backL: b.thighBL_03, backR: b.thighBR_026 }
      : { back: b.Back, head: b.Head, neck: b.Neck3, tail: [b.Tail1, b.Tail2, b.Tail3], frontL: b.FrontShoulderL, frontR: b.FrontShoulderR, frontUpperR: b.FrontUpperLegR, backL: b.BackLegL, backR: b.BackLegR, earL: b.Ear1L, earR: b.Ear1R };
    if (species === 'cat') {
      this.walk = this.mixer.clipAction(gltf.animations[0]);
      this.walk.play();
    }
  }

  setLook(look) {
    if (this.species === 'cat') {
      // The cat's colours live in a gradient texture; tint it.
      for (const m of this.meshes) m.material.color.set(look.coat).lerp(new THREE.Color('#ffffff'), 0.25);
      return;
    }
    // Material 0 is the main coat, 1 the lighter markings, on both dogs.
    this.meshes.forEach((m) => {
      const name = m.material.name;
      if (name === 'Main' || name === 'Material') m.material.color.set(look.coat);
      if (name === 'Main_Light' || name === 'Material.001') m.material.color.set(look.marking);
    });
  }

  update(dt, w) {
    const b = w.body;
    const p = b.pose;
    if (w.walk?.blocks) {
      this.root.position.set(b.x / MU, b.jump * U, b.y / MU);
      this.faceHeading(b.heading ?? 0, dt);
    } else {
      this.root.position.set(X(b.x), b.jump * U, Z_PET);
      this.face(b.dir, dt);
    }

    if (this.species === 'cat') this.updateCat(dt, b);
    else this.updateDog(dt, b, w);
    this.undoTurns();
    this.mixer.update(dt);
    this.holdLastFrame();
    this.model.updateMatrixWorld(true);
    this.overlayPoses(b, p);
  }

  updateDog(dt, b, w) {
    const p = b.pose;
    this.idleSwap -= dt;
    if (this.idleSwap < 0) {
      this.idleSwap = 5 + Math.random() * 6;
      this.idleName = this.idleName === 'Idle' ? 'Idle_2' : 'Idle';
    }
    // Map walks can be sped up; the gait is chosen by speed as it would be at normal pace,
    // with the legs moving a little quicker.
    const k = w.speedScale ?? 1;
    const sp = b.speed / k;
    const faster = 1 + (k - 1) * 0.5;
    let state;
    if (b.jump > 4) state = ['Gallop_Jump', { timeScale: 1.2 }];
    else if (sp > 150) state = ['Gallop', { timeScale: Math.min(1.6, sp / 200) * faster }];
    else if (b.speed > 8) state = ['Walk', { timeScale: Math.min(1.9, Math.max(0.6, sp / 70)) * faster }];
    else if (p.lie > 0.5) state = ['Death', { once: true, timeScale: 0.6, fade: 0.4 }]; // flops onto its side
    else if (p.chew > 0.5 && p.head > 0.5) state = ['Eating', {}];
    else if (p.head > 0.55) state = ['Idle_2_HeadLow', {}];
    else state = [p.sit > 0.5 || p.crouch > 0.3 ? 'Idle' : this.idleName, {}];
    if (w.activity.type === 'treat' && p.chew > 0.5) state = ['Eating', {}];
    const [name, opts] = state;
    if (this.currentName !== name || !opts.once) this.play(name, opts);
  }

  updateCat(dt, b) {
    // The free cat has a single walk cycle; standing still pauses it mid-step.
    const moving = b.speed > 8;
    this.walk.timeScale = moving ? Math.min(2.4, Math.max(0.7, b.speed / 60)) : 0;
    if (!moving) this.walk.time += (0.1 - this.walk.time) * Math.min(1, dt * 4);
  }

  // Poses the animation libraries don't have, added on top.
  overlayPoses(b, p) {
    const r = this.rig;
    const sit = p.sit * (1 - p.lie);
    const lie = this.species === 'cat' ? p.lie : 0;
    const low = this.species === 'cat' ? p.lie * 0.6 + sit * 0.25 : 0;

    // Sitting: tilt the body nose-up, keep the front legs upright, tuck the back legs.
    if (sit > 0.01 && b.speed < 8) {
      this.bend(r.back, AXIS_X, -0.5 * sit);
      this.bend(r.frontL, AXIS_X, 0.5 * sit);
      this.bend(r.frontR, AXIS_X, 0.5 * sit);
      this.bend(r.backL, AXIS_X, -0.8 * sit);
      this.bend(r.backR, AXIS_X, -0.8 * sit);
      this.model.position.y = this.baseY() - sit * this.height * 0.25;
    } else this.model.position.y = this.baseY() - low * this.height * 0.3;
    if (lie > 0.01) this.bend(r.back, AXIS_Z, 0.6 * lie);

    // Play bow: chest down, rear up.
    if (p.crouch > 0.01) {
      this.bend(r.back, AXIS_X, 0.45 * p.crouch);
      this.bend(r.frontL, AXIS_X, -0.45 * p.crouch);
      this.bend(r.frontR, AXIS_X, -0.45 * p.crouch);
    }
    // Shake a paw.
    if (p.paw > 0.01) this.bend(r.frontUpperR ?? r.frontR, AXIS_X, -1.3 * p.paw);
    // Head tilt.
    this.bend(r.head, AXIS_Z, p.tilt * 0.4);
    // Tail: up or down with mood, and a wag.
    const wag = Math.sin(b.wagPhase) * p.wag * 0.55;
    r.tail.forEach((t, i) => {
      this.bend(t, AXIS_Y, wag * (i + 1) * 0.5);
      if (i === 0) this.bend(t, AXIS_X, (p.tailUp - 0.5) * -0.8);
    });
    // Ears flatten when sad or sleepy.
    if (r.earL) {
      const flat = (0.55 - p.ears) * 0.8;
      this.bend(r.earL, AXIS_X, flat);
      this.bend(r.earR, AXIS_X, flat);
    }
  }

  baseY() {
    if (this._baseY === undefined) this._baseY = this.model.position.y;
    return this._baseY;
  }

  headWorld(out) {
    return (this.rig.head ?? this.model).getWorldPosition(out);
  }

  mouthWorld(out) {
    this.headWorld(out);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.turn.getWorldQuaternion(tmpQ));
    return out.addScaledVector(fwd, this.height * 0.22).add(new THREE.Vector3(0, -this.height * 0.08, 0));
  }

  neckWorld(out) {
    return (this.rig.neck ?? this.model).getWorldPosition(out);
  }
}

class OwnerModel extends Character {
  constructor(gltf, clips) {
    super(gltf, clips);
    const byName = Object.fromEntries(this.meshes.map((m) => [m.name, m]));
    // The mannequin's own head is a faceless helmet; we build a face instead.
    byName.Mannequin_Medium_Head.visible = false;
    this.parts = {
      top: [byName.Mannequin_Medium_Body, byName.Mannequin_Medium_ArmLeft, byName.Mannequin_Medium_ArmRight],
      bottom: [byName.Mannequin_Medium_LegLeft, byName.Mannequin_Medium_LegRight],
    };
    this.fit(1.75);
    this.measureHead(byName.Mannequin_Medium_Head);
    this.hair = new THREE.Group();
    this.idleTime = 0;
    this.play('Idle_A');
  }

  // The head's centre and size in the model's own space (y up, z forward),
  // measured in the bind pose, so hair and a face can be built around it.
  measureHead(mesh) {
    this.model.updateMatrixWorld(true);
    mesh.geometry.computeBoundingBox();
    const toModel = new THREE.Matrix4().copy(this.model.matrixWorld).invert().multiply(mesh.matrixWorld);
    const box = mesh.geometry.boundingBox.clone().applyMatrix4(toModel);
    this.headCentre = box.getCenter(new THREE.Vector3());
    this.headSize = box.getSize(new THREE.Vector3());
  }

  setLook(look) {
    // Flat colours read better than tinting the mannequin's texture.
    const tint = (meshes, color) => meshes.forEach((m) => {
      m.material.map = null;
      m.material.color.set(color);
      m.material.needsUpdate = true;
    });
    tint(this.parts.top, look.top);
    tint(this.parts.bottom, look.bottom);
    this.buildHair(look);
  }

  buildHair(look) {
    // Build in model space at the rest pose, then hand over to the head bone
    // (attach keeps the placement while the bone moves).
    this.hair.parent?.remove(this.hair);
    this.hair.clear();
    this.hair.position.set(0, 0, 0);
    this.hair.quaternion.identity();
    this.hair.scale.setScalar(1);
    const c = this.headCentre;
    const s = this.headSize;
    const mat = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.85 });
    const add = (geo, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.x + x * s.x, c.y + y * s.y, c.z + z * s.z);
      mesh.scale.set(sx * s.x, sy * s.y, sz * s.z);
      mesh.castShadow = true;
      this.hair.add(mesh);
      return mesh;
    };
    // Head: a slightly smaller, rounder head than the mannequin's, with a face.
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.7 });
    const ball = new THREE.SphereGeometry(0.5, 24, 18);
    const head = add(ball, 0, -0.05, 0, 0.78, 0.8, 0.8);
    head.material = skin;
    for (const side of [-1, 1]) {
      const ear = add(ball, side * 0.39, -0.08, 0, 0.12, 0.17, 0.1);
      ear.material = skin;
    }
    const dark = new THREE.MeshStandardMaterial({ color: '#231a16', roughness: 0.4 });
    for (const side of [-1, 1]) {
      const eye = add(ball, side * 0.15, -0.02, 0.37, 0.07, 0.1, 0.05);
      eye.material = dark;
    }
    const smile = add(new THREE.TorusGeometry(0.5, 0.12, 6, 16, Math.PI), 0, -0.2, 0.38, 0.16, 0.16, 0.1);
    smile.rotation.z = Math.PI;
    smile.material = new THREE.MeshStandardMaterial({ color: '#8a3b2e' });

    const cap = new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.5);
    switch (look.hair) {
      case 'buzz':
        add(cap, 0, -0.02, -0.01, 0.8, 0.8, 0.82).rotation.x = -0.25;
        break;
      case 'curly':
        for (const [x, y, z] of [[-0.22, 0.25, 0.05], [0.22, 0.25, 0.05], [0, 0.33, 0.12], [0, 0.28, -0.2], [-0.32, 0.08, -0.15], [0.32, 0.08, -0.15], [0, 0.1, -0.35]]) add(ball, x, y, z, 0.32, 0.32, 0.32);
        break;
      default: {
        add(cap, 0, 0.0, -0.03, 0.84, 0.86, 0.86).rotation.x = -0.35;
        if (look.hair === 'long') add(new THREE.BoxGeometry(1, 1, 1), 0, -0.3, -0.28, 0.76, 0.75, 0.22);
        if (look.hair === 'bun') add(ball, 0, 0.36, -0.28, 0.3, 0.3, 0.3);
      }
    }
    this.resetPose();
    this.model.add(this.hair);
    this.model.updateMatrixWorld(true);
    this.bones.head.attach(this.hair);
  }

  update(dt, w, events) {
    const o = w.owner;
    if (w.walk?.blocks) {
      this.root.position.set(o.x / MU, 0, o.y / MU);
      this.faceHeading(o.heading ?? 0, dt);
    } else {
      this.root.position.set(X(o.x), 0, Z_OWNER);
      this.face(o.dir, dt);
    }
    if (events.throw) this.playOnce('Throw', 1.4);
    else if (events.pickUp) this.playOnce('PickUp', 1.5);
    else if (events.wave) this.playOnce('Waving', 1.2);
    else if (events.cheer) this.playOnce('Cheering', 1.2);

    if (!this.busy()) {
      const d = w.drag;
      const still = o.speed < 5 && !d && !w.petting && w.scene === 'home';
      this.idleTime = still ? this.idleTime + dt : 0;
      const k = w.speedScale ?? 1;
      if (o.speed > 5) this.play('Walking_A', { timeScale: Math.min(1.6, o.speed / k / 90) * (1 + (k - 1) * 0.5) });
      else if (w.petting) this.play(w.petting.y > GROUND - 120 ? 'Crouching' : 'Interact', {});
      else if (d?.item === 'scoop') this.play('Use_Item', {});
      else if (d) this.play('Interact', { timeScale: 0.5 });
      else if (this.idleTime > 25) this.play(this.idleTime > 26.2 ? 'Sit_Floor_Idle' : 'Sit_Floor_Down', { once: this.idleTime <= 26.2 });
      else this.play('Idle_A', {});
    }
    this.mixer.update(dt);
    this.holdLastFrame();
    this.model.updateMatrixWorld(true);
  }

  handWorld(out) {
    return this.bones.handr.getWorldPosition(out);
  }

  headWorld(out) {
    return this.bones.head.getWorldPosition(out).add(new THREE.Vector3(0, this.headSize.y * 0.9 * this.model.scale.y, 0));
  }
}

// --- The 3D scene ---

// Two camera presets for map walks: from above, and low behind you.
const BIRDS_EYE = { pitch: 1.0, dist: 13 };
const SIDE_VIEW = { pitch: 0.2, dist: 6.5 };

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(36, VIEW_W / VIEW_H, 0.1, 200);
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.pet = null;
    this.owner = null;
    this.petKey = '';
    this.ready = false;
    this.prev = { ball: 'ground', bubble: null };
    this.buildLights();
    this.home = this.buildHome();
    this.park = this.buildPark();
    this.scene.add(this.home, this.park);
    this.buildItems();
    this.findTextures = {};
    // The block world for map walks (see renderMap).
    this.mapLayer = new MapLayer();
    this.mapLayer.group.visible = false;
    this.scene.add(this.mapLayer.group);
    this.mapCam = { x: 0, z: 0, yaw: 0, pitch: BIRDS_EYE.pitch, dist: BIRDS_EYE.dist, ready: false };
    // Pets are drawn bigger than life on map walks, so they read next to streets and houses.
    this.petBoost = 1;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight('#eef4ff', '#8a6a4a', 1.2);
    this.sun = new THREE.DirectionalLight('#fff4e0', 1.8);
    this.sun.position.set(2.5, 6, 4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -6, right: 6, top: 4, bottom: -2, near: 1, far: 20 });
    this.sun.shadow.bias = -0.0005;
    this.lamp = new THREE.PointLight('#ffcf8a', 0, 7, 1.5);
    this.lamp.position.set(X(770), 1.45, -0.9);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.lamp);
  }

  buildHome() {
    const g = new THREE.Group();
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

    const planks = canvasTexture(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#c4935e';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(90,55,25,0.08)' : 'rgba(255,240,210,0.06)';
        ctx.fillRect(0, i * 64, w, 64);
        ctx.fillStyle = 'rgba(90,55,25,0.3)';
        ctx.fillRect(0, i * 64, w, 2);
        ctx.fillRect(((i * 197) % w), i * 64, 2, 64);
      }
    });
    planks.wrapS = planks.wrapT = THREE.RepeatWrapping;
    planks.repeat.set(3, 2.5);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), std('#ffffff', { map: planks }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = 0.6;
    floor.receiveShadow = true;
    g.add(floor);

    this.wallMat = std('#d6dfcf');
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), this.wallMat);
    wall.position.set(0, 1.6, -1.6);
    wall.receiveShadow = true;
    g.add(wall);
    this.wallDecor = new THREE.Group();
    const wainscot = new THREE.Mesh(new THREE.BoxGeometry(7, 0.75, 0.03), std('#bccab3'));
    wainscot.position.set(0, 0.375, -1.58);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(7, 0.05, 0.05), std('#ece7da'));
    rail.position.set(0, 0.77, -1.56);
    const skirting = new THREE.Mesh(new THREE.BoxGeometry(7, 0.08, 0.04), std('#ece7da'));
    skirting.position.set(0, 0.04, -1.56);
    this.wallDecor.add(wainscot, rail, skirting);

    // Window onto the real sky.
    this.skyTex = canvasTexture(64, 64, () => {});
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.95, 0.06), std('#f1eee5'));
    frame.position.set(X(540), 1.75, -1.57);
    this.windowSky = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.8), new THREE.MeshBasicMaterial({ map: this.skyTex }));
    this.windowSky.position.set(X(540), 1.75, -1.53);
    const mullionV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.8, 0.02), std('#f1eee5'));
    mullionV.position.set(X(540), 1.75, -1.52);
    const mullionH = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.04, 0.02), std('#f1eee5'));
    mullionH.position.set(X(540), 1.75, -1.52);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 0.14), std('#e2dccc'));
    sill.position.set(X(540), 1.27, -1.52);
    // A framed print.
    const print = canvasTexture(128, 96, (ctx, w, h) => {
      ctx.fillStyle = '#e9e2cf';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#9fbf8f';
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(w * 0.35, h * 0.45);
      ctx.lineTo(w * 0.6, h * 0.75);
      ctx.lineTo(w * 0.78, h * 0.55);
      ctx.lineTo(w, h);
      ctx.fill();
      ctx.fillStyle = '#e8b04a';
      ctx.beginPath();
      ctx.arc(w * 0.75, h * 0.25, 9, 0, Math.PI * 2);
      ctx.fill();
    });
    const pic = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.48, 0.04), [std('#8a6a4a'), std('#8a6a4a'), std('#8a6a4a'), std('#8a6a4a'), std('#ffffff', { map: print }), std('#8a6a4a')]);
    pic.position.set(X(215), 1.8, -1.57);
    this.wallDecor.add(frame, this.windowSky, mullionV, mullionH, sill, pic);
    g.add(this.wallDecor);

    // Side walls close the room in.
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 3.2), std('#cdd8c5'));
      sw.rotation.y = -side * Math.PI / 2;
      sw.position.set(side * 3.2, 1.6, 0.6);
      sw.receiveShadow = true;
      g.add(sw);
    }

    // Rug.
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1, 48), std('#7f97b8'));
    rug.rotation.x = -Math.PI / 2;
    rug.scale.set(1.5, 0.75, 1);
    rug.position.set(0, 0.004, 0.35);
    rug.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.88, 48), std('#a9bcd6'));
    ring.rotation.x = -Math.PI / 2;
    ring.scale.set(1.5, 0.75, 1);
    ring.position.set(0, 0.006, 0.35);
    g.add(rug, ring);

    // Bed.
    const bed = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.1, 12, 32), std('#3f5f8a'));
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(1.15, 0.85, 1);
    rim.position.y = 0.1;
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.08, 32), std('#9db8dc'));
    cushion.scale.set(1.15, 1, 0.85);
    cushion.position.y = 0.05;
    bed.add(rim, cushion);
    bed.traverse((o) => { o.castShadow = o.receiveShadow = true; });
    bed.position.set(X(BED_X), 0, Z_PET);
    g.add(bed);

    // Food bowl with kibble that fills up.
    const bowlShape = [new THREE.Vector2(0.0, 0), new THREE.Vector2(0.11, 0), new THREE.Vector2(0.15, 0.07), new THREE.Vector2(0.14, 0.075), new THREE.Vector2(0.1, 0.012)];
    const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlShape, 32), std('#b8c3cd', { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }));
    bowl.castShadow = true;
    bowl.position.set(X(BOWL_X), 0, Z_PET);
    g.add(bowl);
    this.kibble = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 6, 5), std('#8a5a32'), 40);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4;
      const r = 0.1 * Math.sqrt(i / 40);
      m.makeTranslation(X(BOWL_X) + Math.cos(a) * r, 0.03 + (i / 40) * 0.035, Z_PET + Math.sin(a) * r);
      this.kibble.setMatrixAt(i, m);
    }
    this.kibble.count = 0;
    g.add(this.kibble);

    // Food bag and treat jar.
    const bag = new THREE.Group();
    const sack = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, 0.16), std('#c99f62'));
    sack.position.y = 0.2;
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.12), std('#b58a4f'));
    fold.position.y = 0.43;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.14), std('#f3ead8'));
    label.position.set(0, 0.2, 0.081);
    bag.add(sack, fold, label);
    bag.traverse((o) => { o.castShadow = true; });
    bag.position.set(X(BAG_X), 0, Z_PROPS);
    g.add(bag);
    const jar = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.24, 24), new THREE.MeshPhysicalMaterial({ color: '#dfeef3', transparent: true, opacity: 0.45, roughness: 0.1 }));
    glass.position.y = 0.12;
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 24), std('#c4473a'));
    lid.position.y = 0.265;
    const bones = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.14, 12), std('#c98a4a'));
    bones.position.y = 0.075;
    jar.add(bones, glass, lid);
    jar.position.set(X(JAR_X), 0, Z_PROPS);
    g.add(jar);

    // Floor lamp; glows at night.
    const lamp = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.45, 8), std('#3d3a36'));
    pole.position.y = 0.72;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.03, 20), std('#3d3a36'));
    this.lampShadeMat = std('#e9dfc6', { emissive: '#ffcf8a', emissiveIntensity: 0 });
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 0.26, 20, 1, true), this.lampShadeMat);
    shade.position.y = 1.5;
    lamp.add(pole, base, shade);
    lamp.position.set(X(770), 0, -0.9);
    g.add(lamp);
    return g;
  }

  buildPark() {
    const g = new THREE.Group();
    const std = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
    this.grassMat = std('#8dbd6e');
    this.parkGround = new THREE.Mesh(new THREE.PlaneGeometry(120, 60), this.grassMat);
    this.parkGround.rotation.x = -Math.PI / 2;
    this.parkGround.position.z = -20;
    this.parkGround.receiveShadow = true;
    this.path = new THREE.Mesh(new THREE.PlaneGeometry(120, 1.3), std('#d8c6a0'));
    this.path.rotation.x = -Math.PI / 2;
    this.path.position.set(0, 0.003, 0);
    this.path.receiveShadow = true;
    g.add(this.parkGround, this.path);

    this.hills = [];
    for (let i = 0; i < 6; i++) {
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), std(i % 2 ? '#9fc28c' : '#a9c999'));
      hill.scale.set(14 + hash(i) * 8, 4 + hash(i + 3) * 3, 6);
      hill.position.set(i * 20 - 50, -1, -32);
      this.hills.push(hill);
      g.add(hill);
    }
    this.trees = [];
    const trunkGeo = new THREE.CylinderGeometry(0.09, 0.13, 1, 8);
    const crownGeo = new THREE.IcosahedronGeometry(0.8, 1);
    const trunkMat = std('#6e5038');
    const crownMats = [std('#5c8f4c'), std('#6f9e55'), std('#4f8644')];
    for (let i = 0; i < 26; i++) {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 0.5;
      const crown = new THREE.Mesh(crownGeo, crownMats[i % 3]);
      crown.position.y = 1.5;
      t.add(trunk, crown);
      t.traverse((o) => { o.castShadow = true; });
      this.trees.push(t);
      g.add(t);
    }
    this.photoBackdrop = new THREE.Mesh(new THREE.PlaneGeometry(30, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    // Bottom edge on the ground, so the photo's own ground meets ours.
    this.photoBackdrop.position.set(0, 6, -9);
    this.photoBackdrop.visible = false;
    g.add(this.photoBackdrop);
    this.critter = new THREE.Group();
    const fur = std('#9a5b34');
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), fur);
    body.scale.set(1.4, 1, 1);
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), fur);
    tail.scale.set(0.7, 1.6, 0.7);
    tail.position.set(-0.09, 0.08, 0);
    body.position.y = 0.06;
    this.critter.add(body, tail);
    g.add(this.critter);
    return g;
  }

  buildItems() {
    const ballTex = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#e3483d';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#ffd34d';
      ctx.fillRect(0, h * 0.42, w, h * 0.16);
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 20, 14), new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.5 }));
    this.ball.castShadow = true;
    this.scoop = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.055, 0.07, 16, 1, true), new THREE.MeshStandardMaterial({ color: '#b8c2cc', metalness: 0.5, roughness: 0.4, side: THREE.DoubleSide }));
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), new THREE.MeshStandardMaterial({ color: '#8f99a3' }));
    handle.rotation.z = Math.PI / 2.6;
    handle.position.set(-0.1, 0.03, 0);
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12), new THREE.MeshStandardMaterial({ color: '#8a5a32' }));
    food.position.y = 0.025;
    this.scoop.add(cup, handle, food);
    this.treatTex = canvasTexture(64, 64, (ctx) => {
      ctx.translate(32, 32);
      ctx.rotate(-0.4);
      ctx.fillStyle = '#c98a4a';
      ctx.strokeStyle = 'rgba(90,50,15,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-16, -6, 32, 12, 4);
      for (const [x, y] of [[-16, -6], [-16, 6], [16, -6], [16, 6]]) { ctx.moveTo(x + 7, y); ctx.arc(x, y, 7, 0, Math.PI * 2); }
      ctx.fill();
      ctx.stroke();
    });
    this.treatSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.treatTex }));
    this.treatSprite.scale.setScalar(0.12);
    this.floorTreat = this.treatSprite.clone();
    this.findSprite = new THREE.Sprite(new THREE.SpriteMaterial());
    this.findSprite.scale.setScalar(0.13);
    this.giftSprite = new THREE.Sprite(new THREE.SpriteMaterial());
    this.giftSprite.scale.setScalar(0.13);
    this.leashMat = new THREE.MeshStandardMaterial({ color: '#d0443c' });
    this.leash = new THREE.Mesh(new THREE.BufferGeometry(), this.leashMat);
    this.scene.add(this.ball, this.scoop, this.treatSprite, this.floorTreat, this.findSprite, this.giftSprite, this.leash);
  }

  findTexture(id) {
    this.findTextures[id] ??= canvasTexture(64, 64, (ctx) => drawFind(ctx, id, 32, 32, 2.4));
    return this.findTextures[id];
  }

  // Load (or reuse) the pet and owner models for this pet.
  async setPet(pet) {
    const breed = pet.species === 'cat' ? 'cat' : (pet.look.breed ?? 'shiba');
    const key = breed;
    if (this.petKey !== key) {
      this.petKey = key;
      const gltf = await load(PET_FILES[breed]);
      if (this.petKey !== key) return;
      if (this.pet) this.scene.remove(this.pet.root);
      this.pet = new PetModel(gltf, pet.species, breed);
      this.scene.add(this.pet.root);
    }
    if (!this.owner) {
      const [base, ...anims] = await Promise.all([load(OWNER_FILE), ...OWNER_ANIMS.map(load)]);
      if (!this.owner) {
        this.owner = new OwnerModel(base, anims.flatMap((a) => a.animations));
        this.scene.add(this.owner.root);
      }
    }
    this.ready = true;
  }

  applyLooks(world) {
    const look = world.pet.look;
    const key = JSON.stringify([look, world.pet.owner, world.scale, this.petBoost]);
    if (key === this.lookKey || !this.pet || !this.owner) return;
    this.lookKey = key;
    this.pet.fit((world.pet.species === 'cat' ? 0.4 : 0.52) * world.scale * this.petBoost);
    this.pet._baseY = undefined;
    this.pet.setLook(look);
    this.owner.setLook(world.pet.owner);
    this.leashMat.color.set(look.collar ?? '#d0443c');
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.size !== `${w}x${h}x${dpr}`) {
      this.size = `${w}x${h}x${dpr}`;
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(w, h, false);
    }
  }

  // Screen position -> simulation units on the plane where everything lives,
  // plus whether the pointer is on the pet's or owner's model.
  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(this.plane, hit);
    const onPet = this.pet ? this.raycaster.intersectObject(this.pet.model, true).length > 0 : false;
    const onOwner = this.owner ? this.raycaster.intersectObject(this.owner.model, true).length > 0 : false;
    return { x: hit.x / U + VIEW_W / 2, y: GROUND - hit.y / U, onPet, onOwner };
  }

  // Simulation units -> browser pixels, for tests that drive the pointer.
  clientPoint(x, y, z = 0) {
    const r = this.canvas.getBoundingClientRect();
    const p = this.project(new THREE.Vector3(X(x), Y(y), z));
    return { x: r.left + (p.x / VIEW_W) * r.width, y: r.top + (p.y / VIEW_H) * r.height };
  }

  // A point in the world -> view coordinates on the 800 x 450 overlay.
  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * VIEW_W, y: (1 - p.y) / 2 * VIEW_H };
  }

  updateSky(dark) {
    const k = Math.round(dark * 20);
    if (k === this.skyKey) return;
    this.skyKey = k;
    const [top, bottom] = skyColors(dark);
    const draw = (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, top);
      g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    };
    this.skyTex.dispose();
    this.skyTex = canvasTexture(64, 64, draw);
    this.windowSky.material.map = this.skyTex;
    this.windowSky.material.needsUpdate = true;
    this.skyBg?.dispose();
    this.skyBg = canvasTexture(16, 128, draw);
    this.hemi.intensity = 1.25 - dark * 0.85;
    this.sun.intensity = 1.9 - dark * 1.75;
    this.sun.color.set(dark > 0.2 && dark < 0.8 ? '#ffc690' : '#fff4e0');
    this.lamp.intensity = dark * 6;
    this.lampShadeMat.emissiveIntensity = dark * 1.2;
  }

  photoTexture(img) {
    if (!img) return null;
    this.photoTex ??= new Map();
    if (!this.photoTex.has(img)) {
      const t = new THREE.Texture(img);
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      this.photoTex.set(img, t);
    }
    return this.photoTex.get(img);
  }

  // Work out one-off owner gestures from changes in the simulation.
  events(world) {
    const ev = {};
    const ball = world.ball.state;
    if (this.prev.ball === 'drag' && ball === 'air') ev.throw = true;
    if (this.prev.ball === 'ground' && ball === 'drag') ev.pickUp = true;
    const bubble = world.owner.bubble?.text ?? null;
    if (bubble && bubble !== this.prev.bubble) {
      if (/\b(good|clever|yes|well done|love)\b/i.test(bubble)) ev.cheer = true;
      else if (bubble.toLowerCase().includes(world.pet.name.toLowerCase())) ev.wave = true;
    }
    this.prev = { ball, bubble };
    return ev;
  }

  render(world, { date = new Date(), dt = 1 / 60, backdrops = {}, images = {} } = {}) {
    this.resize();
    const home = world.scene === 'home';
    const dark = darkness(date);
    this.updateSky(dark);
    this.home.visible = home;
    this.park.visible = !home;
    this.mapLayer.group.visible = false;
    if (this.pet && this.owner) this.pet.root.visible = this.owner.root.visible = true;
    this.scene.fog = null;
    this.setShadowArea('room');
    this.petBoost = 1;
    if (this.camera.fov !== 36) Object.assign(this.camera, { fov: 36, near: 0.1, far: 200 });
    this.camera.updateProjectionMatrix();
    this.lamp.visible = home;

    // Camera: fixed on the room; follows the owner on walks.
    const camX = world.cam * U;
    this.camera.position.set(camX, 1.15, 4.4);
    this.camera.lookAt(camX, 0.72, 0);
    this.sun.position.set(camX + 2.5, 6, 4);
    this.sun.target.position.set(camX, 0, 0);

    const photo = this.photoTexture(home ? backdrops.home : backdrops.walk);
    if (home) {
      this.scene.background = new THREE.Color('#cbd6c3');
      this.wallDecor.visible = !photo;
      if (photo) {
        this.wallMat.map = photo;
        this.wallMat.color.set('#ffffff');
        const img = photo.image;
        const wallAspect = 7 / 3.2;
        const a = img.width / img.height;
        photo.repeat.set(a > wallAspect ? wallAspect / a : 1, a > wallAspect ? 1 : a / wallAspect);
        photo.offset.set((1 - photo.repeat.x) / 2, (1 - photo.repeat.y) / 2);
      } else {
        this.wallMat.map = null;
        this.wallMat.color.set('#d6dfcf');
      }
      this.wallMat.needsUpdate = true;
    } else {
      this.scene.background = this.skyBg;
      this.layoutPark(world, camX, photo);
    }

    const portion = portionGrams(world.pet);
    this.kibble.count = Math.round(Math.min(1, world.pet.bowlGrams / portion) * 40);

    if (this.pet && this.owner) {
      this.applyLooks(world);
      this.owner.update(dt, world, this.events(world));
      this.pet.update(dt, world);
    }
    this.placeItems(world, images);
    this.renderer.render(this.scene, this.camera);
  }

  // The room and the map walk light and shadow different areas.
  setShadowArea(kind) {
    if (this.shadowArea === kind) return;
    this.shadowArea = kind;
    const cam = this.sun.shadow.camera;
    if (kind === 'map') Object.assign(cam, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 140 });
    else Object.assign(cam, { left: -6, right: 6, top: 4, bottom: -2, near: 1, far: 20 });
    // A finer shadow map outdoors, where the shadows cover a street.
    this.sun.shadow.mapSize.set(kind === 'map' ? 2048 : 1024, kind === 'map' ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    cam.updateProjectionMatrix();
  }

  // A map walk: the block world around you, with the camera behind and above.
  renderMap(world, { date = new Date(), dt = 1 / 60 } = {}) {
    this.resize();
    const dark = darkness(date);
    this.updateSky(dark);
    this.home.visible = false;
    this.park.visible = false;
    this.lamp.visible = false;
    for (const v of [this.ball, this.scoop, this.treatSprite, this.floorTreat, this.giftSprite]) v.visible = false;
    this.scene.background = this.skyBg;
    this.scene.fog = new THREE.Fog(skyColors(dark)[1], 70, 190);
    this.setShadowArea('map');
    this.petBoost = 1.55;

    const o = world.owner;
    const cam = this.mapCam;
    const tx = o.x / MU;
    const tz = o.y / MU;
    if (this.mapLayer.blocks !== world.walk.blocks) cam.ready = false;
    if (!cam.ready) { cam.x = tx; cam.z = tz; cam.ready = true; }
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 4);
    cam.x += (tx - cam.x) * k;
    cam.z += (tz - cam.z) * k;
    this.mapLayer.group.visible = true;
    this.mapLayer.sync(world.walk.blocks, tx, tz, world.walk.area?.landmarks ?? world.walk.route?.landmarks ?? []);
    this.mapLayer.setRoute(world.walk.route);

    const pitch = cam.pitch;
    this.camera.fov = 45;
    this.camera.aspect = VIEW_W / VIEW_H;
    this.camera.near = 0.2;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      cam.x + Math.sin(cam.yaw) * Math.cos(pitch) * cam.dist,
      0.9 + Math.sin(pitch) * cam.dist,
      cam.z + Math.cos(cam.yaw) * Math.cos(pitch) * cam.dist,
    );
    this.camera.lookAt(cam.x, 0.9, cam.z);
    this.mapLayer.focus(this.camera.position, new THREE.Vector3(tx, 1, tz));
    this.sun.position.set(cam.x + 18, 32, cam.z + 12);
    this.sun.target.position.set(cam.x, 0, cam.z);
    this.hemi.intensity = 1.25 - dark * 0.85;

    if (this.pet && this.owner) {
      // Until the map under you has loaded, there's nowhere to stand.
      const waiting = Boolean(world.walk.area) && !world.walk.placed;
      this.pet.root.visible = this.owner.root.visible = !waiting;
      this.applyLooks(world);
      this.owner.update(dt, world, this.events(world));
      this.pet.update(dt, world);
    }
    const f = world.walk.find;
    this.findSprite.visible = Boolean(f);
    if (f) {
      this.findSprite.material.map = this.findTexture(f.item.id);
      this.findSprite.scale.setScalar(0.45);
      this.findSprite.position.set(f.x / MU, 0.35 + Math.abs(Math.sin(world.time * 3)) * 0.12, f.y / MU);
    }
    this.loadingMap = Boolean(world.walk.area) && !world.walk.placed;
    this.updateLeash(world, !world.walk.offLeash && !this.loadingMap && this.pet && this.owner, LEASH / MU);
    this.renderer.render(this.scene, this.camera);
  }

  // A press on the map view: the spot on the ground (in map units), and whether it's on the pet or you.
  pickMap(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2), hit);
    const onPet = this.pet ? this.raycaster.intersectObject(this.pet.model, true).length > 0 : false;
    const onOwner = this.owner ? this.raycaster.intersectObject(this.owner.model, true).length > 0 : false;
    return { x: hit.x * MU, y: hit.z * MU, onPet, onOwner };
  }

  zoomMap(factor) { this.mapCam.dist = Math.min(24, Math.max(3.5, this.mapCam.dist / factor)); }

  turnMap(angle) { this.mapCam.yaw += angle; }

  // Tilt the view: up lifts the camera toward a bird's eye view, down brings it
  // near the ground for a view from the side.
  tiltMap(angle) { this.mapCam.pitch = Math.min(1.4, Math.max(0.08, this.mapCam.pitch + angle)); }

  // Switch between looking along the street at ground level and from above.
  toggleSideView() {
    const c = this.mapCam;
    const next = c.pitch > 0.6 ? SIDE_VIEW : BIRDS_EYE;
    c.pitch = next.pitch;
    c.dist = next.dist;
  }

  get sideView() { return this.mapCam.pitch <= 0.6; }

  // Which way the arrow keys go on the map, given how the camera is turned:
  // up is away from the camera. Takes x (right) and y (down) as keys give them.
  mapDirection(x, y) {
    const c = Math.cos(this.mapCam.yaw);
    const s = Math.sin(this.mapCam.yaw);
    return { x: x * c + y * s, y: -x * s + y * c };
  }

  // Speech bubbles and little effects over the map view.
  drawMapOverlay(ctx, world) {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (this.loadingMap) {
      ctx.font = '600 22px Figtree, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(31, 42, 36, 0.8)';
      ctx.fillText('Loading the map around you…', VIEW_W / 2, VIEW_H / 2);
      ctx.textAlign = 'left';
    }
    if (!this.pet || !this.owner) return;
    const head = this.project(this.pet.headWorld(new THREE.Vector3()));
    for (const p of world.particles) {
      const a = 1 - p.age / p.life;
      const sx = head.x + (p.x % 7) - 3;
      const sy = head.y - 8 - p.age * 26;
      if (p.type === 'heart') {
        ctx.fillStyle = `rgba(232, 86, 120, ${a})`;
        drawHeart(ctx, sx, sy, 9);
      } else if (p.type === 'z') {
        ctx.fillStyle = `rgba(70, 80, 120, ${a})`;
        ctx.font = `700 ${14 + p.age * 6}px Grandstander, system-ui, sans-serif`;
        ctx.fillText('z', sx + p.age * 10, sy);
      }
    }
    if (world.bubble) drawBubble(ctx, world.bubble.text, head.x, head.y - 18, 'pet');
    if (world.owner.bubble) {
      const oh = this.project(this.owner.headWorld(new THREE.Vector3()));
      drawBubble(ctx, world.owner.bubble.text, oh.x, oh.y - 6, 'owner');
    }
  }

  layoutPark(world, camX, photo) {
    this.photoBackdrop.visible = Boolean(photo);
    for (const t of this.trees) t.visible = !photo;
    for (const h of this.hills) h.visible = !photo;
    if (photo) {
      const img = photo.image;
      photo.wrapS = THREE.MirroredRepeatWrapping;
      const a = img.width / img.height;
      photo.repeat.set((30 / 12) / a, 1);
      photo.offset.x = (camX * 0.06) / a;
      photo.needsUpdate = photo.version === 0;
      this.photoBackdrop.material.map = photo;
      this.photoBackdrop.material.needsUpdate = true;
      this.photoBackdrop.position.x = camX;
      this.grassMat.color.set('#9a9a8c');
    } else {
      this.grassMat.color.set('#8dbd6e');
      const spacing = 2.4;
      const first = Math.floor((camX - 14) / spacing);
      this.trees.forEach((t, k) => {
        const i = first + k;
        const s = 0.8 + hash(i + 5) * 0.8;
        t.position.set(i * spacing + hash(i) * 1.4, 0, -2.4 - hash(i + 7) * 7);
        t.scale.setScalar(s);
      });
      this.hills.forEach((h, i) => { h.position.x = camX * 0.8 + (i - 2.5) * 22; });
    }
    this.parkGround.position.x = camX;
    this.path.position.x = camX;
    const c = world.walk?.critter;
    this.critter.visible = Boolean(c);
    if (c) {
      this.critter.position.set(X(c.x), Math.abs(Math.sin(world.time * 12)) * 0.05, Z_PET - 0.4);
      this.critter.rotation.y = c.dir > 0 ? 0 : Math.PI;
    }
  }

  placeItems(world, images) {
    const ball = world.ball;
    const home = world.scene === 'home';
    this.ball.visible = home;
    if (ball.state === 'mouth' && this.pet) this.pet.mouthWorld(this.ball.position);
    else this.ball.position.set(X(ball.x), Y(ball.y), ball.state === 'drag' ? 0.25 : Z_PET);
    this.ball.rotation.z = -ball.spin;

    const d = world.drag;
    const at = (v, x, y, z = 0.2) => v.position.set(X(x), Y(y), z);
    this.scoop.visible = d?.item === 'scoop';
    if (this.scoop.visible) at(this.scoop, d.x, d.y);
    if (images.treat && this.treatSprite.material.map !== this.customTreat(images.treat)) {
      this.treatSprite.material.map = this.customTreat(images.treat);
      this.floorTreat.material = this.treatSprite.material;
    } else if (!images.treat && this.treatSprite.material.map !== this.treatTex) {
      this.treatSprite.material.map = this.treatTex;
    }
    this.treatSprite.material.needsUpdate = true;
    this.treatSprite.visible = d?.item === 'treat';
    if (this.treatSprite.visible) at(this.treatSprite, d.x, d.y);
    this.floorTreat.visible = Boolean(world.floorTreat);
    if (world.floorTreat) at(this.floorTreat, world.floorTreat.x, world.floorTreat.y - 4, Z_PET);

    const f = world.walk?.find;
    this.findSprite.visible = Boolean(f);
    if (f) {
      this.findSprite.material.map = this.findTexture(f.item.id);
      this.findSprite.scale.setScalar(0.13);
      at(this.findSprite, f.x, GROUND - 10 - Math.abs(Math.sin(world.time * 3)) * 6, Z_PET);
    }
    const g = home && world.shownGift;
    this.giftSprite.visible = Boolean(g);
    if (g) {
      this.giftSprite.material.map = this.findTexture(g.id);
      at(this.giftSprite, g.x, GROUND - 10, Z_PET + 0.1);
    }

    this.updateLeash(world, !home && !world.walk.offLeash && this.pet && this.owner, LEASH * U);
  }

  // Leash: sags when slack, straight when tight. `length` is how long it is, in metres.
  updateLeash(world, leashed, length) {
    this.leash.visible = Boolean(leashed);
    if (leashed) {
      const a = this.owner.handWorld(new THREE.Vector3());
      const b = this.pet.neckWorld(new THREE.Vector3());
      const sag = (1 - world.walk.tension) * Math.max(0, length * 1.1 - a.distanceTo(b)) * 0.8 + 0.02;
      const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -sag, 0));
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      this.leash.geometry.dispose();
      this.leash.geometry = new THREE.TubeGeometry(curve, 20, 0.008, 6, false);
    }
  }

  customTreat(img) {
    if (this.customTreatImg !== img) {
      this.customTreatImg = img;
      this.customTreatTex = new THREE.Texture(img);
      this.customTreatTex.colorSpace = THREE.SRGBColorSpace;
      this.customTreatTex.needsUpdate = true;
    }
    return this.customTreatTex;
  }

  // Speech bubbles and little effects, drawn flat on top of the 3D view.
  drawOverlay(ctx, world) {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    if (!this.pet || !this.owner) return;
    const head = this.project(this.pet.headWorld(new THREE.Vector3()));
    // The simulation emits effects at its own idea of the head; shift them to the model's.
    const simHead = world.headPoint();
    const simHeadScreen = this.project(new THREE.Vector3(X(simHead.x), Y(simHead.y), Z_PET));
    const dx = head.x - simHeadScreen.x;
    const dy = head.y - simHeadScreen.y;
    for (const p of world.particles) {
      const s = this.project(new THREE.Vector3(X(p.x), Y(p.y), Z_PET));
      const a = 1 - p.age / p.life;
      const sx = s.x + (p.type === 'kibble' ? 0 : dx);
      const sy = s.y + (p.type === 'kibble' ? 0 : dy);
      if (p.type === 'heart') {
        ctx.fillStyle = `rgba(232, 86, 120, ${a})`;
        drawHeart(ctx, sx, sy, 9);
      } else if (p.type === 'z') {
        ctx.fillStyle = `rgba(70, 80, 120, ${a})`;
        ctx.font = `700 ${14 + p.age * 6}px Grandstander, system-ui, sans-serif`;
        ctx.fillText('z', sx + p.age * 10, sy);
      } else {
        ctx.fillStyle = `rgba(138, 90, 50, ${p.type === 'kibble' ? 1 : a})`;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (world.bubble) drawBubble(ctx, world.bubble.text, head.x, head.y - 18, 'pet');
    const o = world.owner;
    if (o.bubble) {
      const oh = this.project(this.owner.headWorld(new THREE.Vector3()));
      drawBubble(ctx, o.bubble.text, oh.x, oh.y - 6, 'owner');
    }
  }
}
