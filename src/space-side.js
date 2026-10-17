// The side-on space: where everything is and how it moves when the world is
// a single line across a room, seen from the side. This is the only part of
// the simulation that knows about coordinates, the floor height, where the
// bowl is, ball physics and the leash. The pet's behaviour (world.js) asks
// it questions through a small vocabulary (approach, near, placeOf,
// wanderSpot, heldHigh, atMouth...), so a different space, such as a real 3D
// room, can answer the same questions without the behaviour changing.
// See docs/architecture.md for the full list.
//
// Positions are objects with an x (and, for things off the floor, a y in
// view units, y pointing down). Methods are mixed into World, so `this` is
// the world.

import { shoulderPoint, OWNER } from './owner-art.js';
import { pickFind } from './finds.js';

export const VIEW_W = 800;
export const VIEW_H = 450;
export const GROUND = 392;
export const BAG_X = 38;
export const JAR_X = 88;
export const BOWL_X = 150;
export const BED_X = 688;
export const BALL_R = 9;
export const UNITS_PER_METER = 45;
export const LEASH = 170;
export const GRAVITY = 980;
export const MIN_X = 60;
export const MAX_X = 745;
const ARM_REACH = OWNER.upperArm + OWNER.forearm - 6;

const GAITS = { walk: 55, trot: 105, run: 210 };
const OWNER_SPEED = 130;
const OWNER_WALK_SPEED = 95;
const PLACES = { bowl: BOWL_X, bed: BED_X, bag: BAG_X, jar: JAR_X };

const clampX = (x) => Math.min(MAX_X, Math.max(MIN_X, x));
const lerp = (a, b, t) => a + (b - a) * t;
const xOf = (target) => (typeof target === 'number' ? target : target.x);

// Where a ball in flight will land on the floor, ignoring walls.
function landingX(ball) {
  const floor = GROUND - BALL_R;
  const disc = ball.vy * ball.vy + 2 * GRAVITY * Math.max(0, floor - ball.y);
  const t = (ball.vy + Math.sqrt(disc)) / GRAVITY;
  return ball.x + ball.vx * t;
}

export const sideSpace = {
  // --- Starting layout ---

  placeAtHome() {
    this.body.x = 330;
    this.body.dir = 1;
    Object.assign(this.owner, { x: 560, dir: -1, vx: 0, targetX: null, walkInput: 0 });
    Object.assign(this.ball, { state: 'ground', x: 470, y: GROUND - BALL_R, vx: 0, vy: 0, spin: 0 });
    this.cam = 0;
  },

  placeForWalk() {
    Object.assign(this.owner, { x: 260, dir: 1, vx: 0, targetX: null, walkInput: 0, hand: null });
    this.body.x = 350;
    this.body.vx = 0;
    this.cam = 0;
    // The ball stays at home, on the floor.
    if (this.ball.state === 'mouth' || this.ball.state === 'air') { this.ball.state = 'ground'; this.ball.y = GROUND - BALL_R; }
  },

  placeBackHome() {
    Object.assign(this.owner, { x: 560, dir: -1, vx: 0, walkInput: 0, targetX: null });
    this.body.x = 440;
    this.body.vx = 0;
    this.cam = 0;
  },

  // --- Moving the pet ---

  // Head for a place or point; true once there.
  goTo(target, gait = 'walk') {
    const b = this.body;
    const x = this.scene === 'home' ? clampX(xOf(target)) : xOf(target);
    const dx = x - b.x;
    if (Math.abs(dx) < 6) { b.vx = 0; return true; }
    const speed = GAITS[gait] * Math.sqrt(this.scale);
    b.dir = Math.sign(dx);
    // Ease in when arriving so the pet does not skid to a stop.
    b.vx = b.dir * Math.min(speed, Math.max(30, Math.abs(dx) * 3));
    return false;
  },

  // Go and stand `gap` (in pet-sized units) from a target, on the side the pet
  // is coming from, then face it. True once there.
  approach(target, gap, gait = 'trot') {
    const t = typeof target === 'string' ? this.placeOf(target) : target;
    const x = xOf(t);
    const side = Math.sign(x - this.body.x) || 1;
    const there = this.goTo(x - side * gap * this.scale, gait);
    if (there) this.face(t);
    return there;
  },

  stop() { this.body.vx = 0; },

  face(target) {
    const x = xOf(target);
    if (Math.abs(x - this.body.x) > 2) this.body.dir = x > this.body.x ? 1 : -1;
  },

  faceOwner() { this.face(this.owner); },

  turnAround() { this.body.dir *= -1; },

  faceAway(target) { this.body.dir = xOf(target) > this.body.x ? -1 : 1; },

  // Within `dist` pet-sized units of a target, along the ground.
  near(target, dist) {
    return Math.abs(xOf(target) - this.body.x) < dist * this.scale;
  },

  placeOf(name) { return { x: PLACES[name] }; },

  // Somewhere else in the room, at least `minDistance` away.
  wanderSpot(minDistance) {
    for (let i = 0; i < 8; i++) {
      const x = this.rand(MIN_X + 40, MAX_X - 40);
      if (Math.abs(x - this.body.x) >= minDistance) return { x };
    }
    return { x: this.body.x > 400 ? MIN_X + 60 : MAX_X - 60 };
  },

  // The far end of the room from where the pet is now (for the zoomies).
  farSide(from = this.body) {
    return { x: xOf(from) < 400 ? MAX_X - 30 : MIN_X + 60 };
  },

  // A spot right next to the owner, on whichever side the pet is.
  ownerSpot() {
    const o = this.owner;
    const side = this.body.x < o.x ? -1 : 1;
    const x = o.x + side * 85 * this.scale;
    if (this.scene !== 'home') return { x };
    return { x: x < MIN_X || x > MAX_X ? o.x - side * 85 * this.scale : x };
  },

  // Which side of the owner the pet is on: 1 or -1.
  sideOfOwner() { return this.body.x >= this.owner.x ? 1 : -1; },

  // On a walk: where the pet trots, a little ahead of the owner.
  besideOwner(ahead, gap) {
    return { x: this.owner.x + ahead * gap * this.scale };
  },

  // --- The pet's head ---

  // Centre of the pet's head, from the blend of standing, sitting, lying and lowered poses.
  headPoint() {
    const b = this.body;
    const p = b.pose;
    const s = this.scale;
    const cat = this.pet.species === 'cat';
    const sit = p.sit * (1 - p.lie);
    let dx = cat ? 50 : 58;
    let dy = cat ? 80 : 95;
    dx = lerp(dx, cat ? 38 : 45, sit);
    dy = lerp(dy, cat ? 95 : 112, sit);
    dx = lerp(dx, cat ? 54 : 62, p.lie);
    dy = lerp(dy, cat ? 42 : 50, p.lie);
    dx = lerp(dx, dx + 20, p.head);
    dy = lerp(dy, 22, p.head);
    return { x: b.x + b.dir * dx * s, y: GROUND - b.jump - dy * s };
  },

  mouthPoint() {
    const h = this.headPoint();
    const s = this.scale;
    return { x: h.x + this.body.dir * 26 * s, y: h.y + 10 * s };
  },

  // Is a point (a treat, a ball) within `dist` pet-sized units of the mouth?
  atMouth(point, dist) {
    const m = this.mouthPoint();
    return Math.hypot(point.x - m.x, point.y - m.y) < dist * this.scale;
  },

  // A treat held well above the pet's head lures a sit; one at floor level, a down.
  heldHigh(point) { return point.y < this.headPoint().y - 30 * this.scale; },
  heldLow(point) { return point.y > GROUND - 40 * this.scale; },

  // --- The ball ---

  ballLanding() { return { x: clampX(landingX(this.ball)) }; },

  // A ball on the floor right in front of the mouth, which the pet is facing.
  canGrab(ball) {
    const m = this.mouthPoint();
    const side = Math.sign(ball.x - this.body.x || 1);
    return Math.abs(ball.x - m.x) < 34 * this.scale && side === this.body.dir;
  },

  // Worth a leap: a ball coming down just above the pet's head.
  shouldLeap(ball) {
    const m = this.mouthPoint();
    const above = m.y - ball.y;
    return ball.vy > 0 && Math.abs(ball.x - m.x) < 50 * this.scale && above > 10 && above < 140 * this.scale;
  },

  // A paw swipe sends the ball skittering the way the pet faces.
  batBall() {
    const ball = this.ball;
    ball.state = 'air';
    ball.vx = this.body.dir * this.rand(140, 320);
    ball.vy = -this.rand(120, 280);
  },

  // A treat let go of in mid-air falls to the floor.
  dropTreat(point, vy = 0) {
    this.floorTreat = { x: point.x, y: point.y, vy: vy * 0.3 };
  },

  dropBall(forward) {
    const b = this.body;
    const mouth = this.mouthPoint();
    this.ball.state = 'air';
    this.ball.x = clampX(mouth.x);
    this.ball.y = Math.min(GROUND - BALL_R, mouth.y);
    this.ball.vx = b.dir * forward;
    this.ball.vy = -60;
  },

  // Let the ball fly from the hand. Returns false for a gentle drop.
  launchBall(x, y, vx, vy) {
    const ball = this.ball;
    const speed = Math.hypot(vx, vy);
    const max = 1300;
    const k = speed > max ? max / speed : 1;
    ball.state = 'air';
    ball.x = x;
    ball.y = Math.min(y, GROUND - BALL_R);
    ball.vx = vx * k;
    ball.vy = vy * k;
    return speed >= 150;
  },

  // For the keyboard and tests: a throw from the owner's hand that lands near a spot.
  lobBallTo(targetX) {
    const o = this.owner;
    const tx = clampX(targetX ?? this.rand(MIN_X + 60, MAX_X - 60));
    const x0 = o.x + o.dir * 30;
    const y0 = GROUND - 200;
    const T = 1;
    return { x: x0, y: y0, vx: (tx - x0) / T, vy: (GROUND - BALL_R - y0 - 0.5 * GRAVITY * T * T) / T };
  },

  // --- What the owner's hands can touch ---

  hitTest(x, y) {
    if (this.scene === 'home') {
      if (Math.abs(x - BAG_X) < 28 && y > GROUND - 78 && y < GROUND + 4) return 'bag';
      if (Math.abs(x - JAR_X) < 20 && y > GROUND - 52 && y < GROUND + 4) return 'jar';
    }
    if (this.ballHit(x, y)) return 'ball';
    if (this.petHit(x, y)) return 'pet';
    if (this.scene !== 'home') return 'ground';
    if (Math.abs(x - this.owner.x) < 30 && y > GROUND - 320 && y < GROUND - 40) return 'owner';
    if (y > 296) return 'floor';
    return 'wall';
  },

  petHit(x, y) {
    const s = this.scale;
    const b = this.body;
    const head = this.headPoint();
    const inBody = Math.abs(x - (b.x + b.dir * 10 * s)) < 70 * s && y > GROUND - b.jump - 95 * s && y < GROUND + 6;
    const inHead = Math.hypot(x - head.x, y - head.y) < 34 * s;
    return inBody || inHead;
  },

  ballHit(x, y) {
    const ball = this.ball;
    if (this.scene !== 'home') return false;
    if (ball.state === 'mouth') return this.atMouth({ x, y }, 30);
    return ball.state === 'ground' && Math.hypot(x - ball.x, y - ball.y) < 30;
  },

  // Is the scoop held over the bowl, where pouring lands in it?
  overBowl(point) {
    return Math.abs(point.x - BOWL_X) < 48 && point.y < GROUND - 15 && point.y > GROUND - 220;
  },

  shoulder() { return shoulderPoint(this.owner, GROUND); },

  // Keep the owner close enough to reach a point, walking over if needed.
  reachFor(x, y) {
    const o = this.owner;
    o.hand = { x, y };
    const sh = this.shoulder();
    if (Math.hypot(x - sh.x, y - sh.y) > ARM_REACH + 10 && this.scene === 'home') {
      const side = x >= o.x ? 1 : -1;
      o.targetX = clampX(x - side * 70);
    }
  },

  walkOwnerTo(x) {
    if (this.scene !== 'home') return;
    this.owner.targetX = clampX(x);
  },

  // --- Walks ---

  walkedMeters() { return this.walk.distance / UNITS_PER_METER; },

  // Something to find, placed on the path ahead.
  spawnFind() {
    const o = this.owner;
    this.walk.find = { x: o.x + (o.walkInput || o.dir) * 360, item: pickFind(this.pet.species, this.rng) };
  },

  scheduleFind(minMeters, maxMeters) {
    this.walk.nextFindAt = this.walk.distance + this.rand(minMeters, maxMeters) * UNITS_PER_METER;
  },

  // A squirrel (or, for cats, a bird) appears ahead.
  spawnCritter(ahead) {
    this.walk.critter = { x: this.owner.x + ahead * 380, dir: ahead, kind: this.pet.species === 'dog' ? 'squirrel' : 'bird', t: 0 };
  },

  // --- Simulation steps ---

  moveOwner(dt) {
    const o = this.owner;
    if (this.scene === 'park') {
      const resisting = this.walk.tension > 0.8 && ['flop', 'sniff'].includes(this.activity.phase) && Math.sign(this.body.x - o.x) !== o.walkInput;
      o.vx = o.walkInput * OWNER_WALK_SPEED * (resisting ? 0.45 : 1);
      if (o.walkInput) o.dir = o.walkInput;
      const step = Math.abs(o.vx * dt);
      this.walk.distance += step;
      this.earn('walk', step / UNITS_PER_METER);
      const w = this.walk;
      if (!w.find && w.distance >= w.nextFindAt) this.spawnFind();
      if (w.find && Math.abs(w.find.x - o.x) > 700) {
        w.find = null;
        this.scheduleFind(60, 120);
      }
    } else if (o.targetX !== null) {
      const dx = o.targetX - o.x;
      if (Math.abs(dx) < 4) { o.targetX = null; o.vx = 0; } else {
        o.vx = Math.sign(dx) * Math.min(OWNER_SPEED, Math.abs(dx) * 4);
        o.dir = Math.sign(dx);
      }
    } else o.vx = 0;
    o.x += o.vx * dt;
    if (this.scene === 'home') o.x = clampX(o.x);
    o.speed = Math.abs(o.vx);
    o.phase += dt * o.speed / 22;
    if (o.speed > 5) o.lastMoved = this.time;
    if (o.hand && o.speed < 5) o.dir = o.hand.x >= o.x ? 1 : -1;
    // Crouch to reach low things.
    const want = o.hand ? Math.min(1, Math.max(0, (o.hand.y - (GROUND - 150)) / 110)) : 0;
    o.crouch += (want - o.crouch) * (1 - Math.exp(-dt * 6));
    if (this.scene === 'park') {
      const target = o.x - 330 + o.walkInput * 40;
      this.cam += (target - this.cam) * (1 - Math.exp(-dt * 3));
    }
  },

  // The leash keeps the pet and owner within reach of each other. A lunging
  // dog pulls its owner along; otherwise the owner tows the pet.
  holdLeash(dt) {
    const o = this.owner;
    const b = this.body;
    const d = b.x - o.x;
    const dist = Math.abs(d);
    // Off the leash, a well-bonded pet still stays within calling distance.
    const limit = this.walk.offLeash ? LEASH * 1.6 : LEASH;
    if (dist > limit) {
      const excess = dist - limit;
      const lunging = !this.walk.offLeash && this.activity.phase === 'squirrel' && this.pet.species === 'dog';
      if (lunging) o.x += Math.sign(d) * excess * 0.6;
      b.x = o.x + Math.sign(d) * limit;
    }
    this.walk.tension = this.walk.offLeash ? 0 : Math.min(1, Math.max(0, (Math.abs(b.x - o.x) - (LEASH - 40)) / 40));
    const c = this.walk.critter;
    if (c) {
      c.t += dt;
      const fleeing = Math.abs(c.x - b.x) < 260 || c.t > 1;
      c.x += c.dir * (c.kind === 'squirrel' ? 150 : 70) * dt * (fleeing ? 1.6 : 0.2);
      if (c.t > 5) this.walk.critter = null;
    }
  },

  moveBody(dt) {
    const b = this.body;
    b.x += b.vx * dt;
    if (this.scene === 'home') b.x = clampX(b.x);
    b.speed = Math.abs(b.vx);
    b.gait += dt * b.speed / (11 * this.scale);
    // Ease the pose toward its target.
    const k = 1 - Math.exp(-dt * 7);
    for (const key of Object.keys(b.target)) b.pose[key] += (b.target[key] - b.pose[key]) * k;
    b.wagPhase += dt * (5 + b.pose.wag * 13);
    if (b.jump > 0 || b.jumpV > 0) {
      b.jump += b.jumpV * dt;
      b.jumpV -= 1300 * dt;
      if (b.jump <= 0) { b.jump = 0; b.jumpV = 0; }
    }
  },

  moveBall(dt) {
    const ball = this.ball;
    if (this.scene !== 'home' || (ball.state !== 'air' && ball.state !== 'ground')) return;
    ball.vy += GRAVITY * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.spin += (ball.vx * dt) / BALL_R;
    const floor = GROUND - BALL_R;
    if (ball.y >= floor) {
      ball.y = floor;
      if (ball.vy > 90) {
        ball.vy *= -0.55;
        ball.vx *= 0.82;
        ball.state = 'air';
      } else {
        ball.vy = 0;
        ball.state = 'ground';
      }
    }
    if (ball.state === 'ground') ball.vx *= Math.exp(-1.8 * dt);
    if (ball.x < 14 + BALL_R || ball.x > VIEW_W - 14 - BALL_R) {
      ball.vx *= -0.6;
      ball.x = Math.min(VIEW_W - 14 - BALL_R, Math.max(14 + BALL_R, ball.x));
    }
  },

  moveFloorTreat(dt) {
    const t = this.floorTreat;
    if (!t) return;
    if (t.y < GROUND - 4) {
      t.vy += GRAVITY * dt;
      t.y = Math.min(GROUND - 4, t.y + t.vy * dt);
    }
  },

  moveParticles(dt) {
    for (const pt of this.particles) {
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.type === 'crumb' || pt.type === 'kibble') pt.vy += 600 * dt;
      if (pt.type === 'kibble' && pt.y > GROUND - 14) { pt.y = GROUND - 14; pt.vy = 0; pt.vx = 0; }
    }
    this.particles = this.particles.filter((pt) => pt.age < pt.life);
  },
};
