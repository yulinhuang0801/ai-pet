// The map space: a walk along a real route, seen from above, on the route's
// block grid (blocks.js). You can follow the route (Walk on / Walk back) or
// walk anywhere you like; houses, fences, hedges and water are in the way
// for you and your pet alike. Your pet moves freely around you on the leash,
// sniffing at the verge, checking out real landmarks and chasing squirrels
// across the grass.
//
// It answers the same questions as the side-on room (see world.js,
// SPACE_CONTRACT), so the pet's behaviour doesn't change. Positions are
// {x, y} in map units: x to the east, y to the south, with things above the
// ground drawn higher up, at a smaller y, as in a top-down game. Pets and
// people keep the size they have in the room, about twice life size next to
// the streets and houses.
//
// Only route walks use this space. Things that only happen at home (the
// bowl, the ball) keep the side-on room's answers.

import { sideSpace, GROUND, LEASH } from './space-side.js';
import { measureLine, pointAlong, distanceAlong } from './route-map.js';
import { biomeAt } from './route.js';
import { pickFind } from './finds.js';
import { buildBlocks, walkable, nearestOpen, STREETS, B } from './blocks.js';

export const MAP_UNITS_PER_METER = 64;
const U = MAP_UNITS_PER_METER;
// A brisk walk, about 1.6 m/s, or a jog at about 3 m/s; the pet's gaits keep up.
const OWNER_WALK_SPEED = 105;
const JOG = 1.9;
const GAITS = { walk: 58, trot: 110, run: 218 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pointOf = (w, target) => (typeof target === 'number' ? { x: target, y: w.body.y } : target);

// A point `s` units along the route, with the way the route runs there.
function routePoint(w, s) {
  const p = pointAlong(w.walk.track, s / U);
  return { x: p.x * U, y: p.y * U, tx: p.tx, ty: p.ty };
}

// --- Walls ---

// Roughly how much room you and your pet take up, in metres from the middle.
const OWNER_RADIUS = 0.35;
const PET_RADIUS = 0.3;

// Is a spot (in map units) in or against something solid?
function blocked(w, x, y, r) {
  const blocks = w.walk.blocks;
  if (!blocks) return false;
  const m = r * U;
  for (const [dx, dy] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) {
    if (!walkable(blocks, (x + dx) / U, (y + dy) / U)) return true;
  }
  return false;
}

// Move something by (dx, dy), sliding along walls instead of going through.
// Anything already stuck inside a wall may move freely, to get out.
function slide(w, thing, dx, dy, r) {
  if (blocked(w, thing.x, thing.y, r)) { thing.x += dx; thing.y += dy; return; }
  if (!blocked(w, thing.x + dx, thing.y, r)) thing.x += dx;
  if (!blocked(w, thing.x, thing.y + dy, r)) thing.y += dy;
}

// The way you're facing, as a unit vector.
const facing = (o) => ({ x: Math.cos(o.heading), y: Math.sin(o.heading) });

// You and your pet are seen from above here, facing along a heading (an
// angle). The pet's length from nose to rump, in metres, as it's drawn.
export const petLength = (pet, scale) => (pet.species === 'cat' ? 1.0 : 1.25) * scale;

// Turn a heading smoothly toward another angle.
function turnToward(from, to, k) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * k;
}

export const mapSpace = {
  ...sideSpace,

  // --- Starting layout ---

  placeForWalk() {
    const w = this.walk;
    w.side = 1; // which side of the path the pet trots on
    if (!w.route) {
      // Exploring from a pinned spot: no route, the map loads around you.
      w.track = null;
      w.length = 0;
      w.blocks = w.area.blocks;
      Object.assign(this.owner, {
        x: 0, y: 0, s: 0, dir: 1, heading: 0, vx: 0, targetX: null, walkInput: 0, hand: null, steer: null, goal: null,
      });
      Object.assign(this.body, { x: 1.7 * U, y: 0.6 * U, vx: 0, vy: 0, dir: 1, heading: 0 });
      this.mapCam = { x: 0, y: 0 };
      if (this.ball.state === 'mouth' || this.ball.state === 'air') { this.ball.state = 'ground'; this.ball.y = GROUND - 9; }
      return;
    }
    w.track = measureLine(w.route.line);
    w.length = w.track.length * U;
    w.blocks = buildBlocks(w.route.map, w.route.line);
    const start = routePoint(this, 0);
    const heading = Math.atan2(start.ty, start.tx);
    Object.assign(this.owner, {
      x: start.x, y: start.y, s: 0, dir: start.tx >= 0 ? 1 : -1, heading, vx: 0, targetX: null, walkInput: 0, hand: null, steer: null, goal: null,
    });
    const ahead = routePoint(this, 110);
    Object.assign(this.body, { x: ahead.x, y: ahead.y, vx: 0, vy: 0, dir: ahead.x >= start.x ? 1 : -1, heading });
    this.mapCam = { x: start.x, y: start.y };
    if (this.ball.state === 'mouth' || this.ball.state === 'air') { this.ball.state = 'ground'; this.ball.y = GROUND - 9; }
  },

  // --- Moving the pet ---

  goTo(target, gait = 'walk') {
    const b = this.body;
    const t = pointOf(this, target);
    const dx = t.x - b.x;
    const dy = t.y - b.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) { b.vx = 0; b.vy = 0; return true; }
    const k = this.speedScale ?? 1;
    const speed = Math.min(GAITS[gait] * Math.sqrt(this.scale) * k, Math.max(30, dist * 3) * k);
    b.vx = (dx / dist) * speed;
    b.vy = (dy / dist) * speed;
    // Facing left or right: keep the old facing while heading mostly up or down.
    if (Math.abs(dx) > dist * 0.25) b.dir = Math.sign(dx);
    return false;
  },

  approach(target, gap, gait = 'trot') {
    const t = pointOf(this, typeof target === 'string' ? this.placeOf(target) : target);
    const b = this.body;
    const dx = b.x - t.x;
    const dy = b.y - t.y;
    const d = Math.hypot(dx, dy) || 1;
    const g = gap * this.scale;
    const there = this.goTo({ x: t.x + (dx / d) * g, y: t.y + (dy / d) * g }, gait);
    if (there) this.face(t);
    return there;
  },

  stop() { this.body.vx = 0; this.body.vy = 0; },

  near(target, dist) {
    const t = pointOf(this, target);
    return Math.hypot(t.x - this.body.x, t.y - this.body.y) < dist * this.scale;
  },

  // Anywhere close by, within the leash.
  wanderSpot() {
    const o = this.owner;
    const a = this.rand(0, Math.PI * 2);
    return { x: o.x + Math.cos(a) * LEASH * 0.7, y: o.y + Math.sin(a) * LEASH * 0.4 };
  },

  farSide() { return this.wanderSpot(); },

  ownerSpot() {
    const o = this.owner;
    const side = this.body.x < o.x ? -1 : 1;
    return { x: o.x + side * 85 * this.scale, y: o.y + 12 };
  },

  // In front of you (1) or behind (-1).
  sideOfOwner() {
    const o = this.owner;
    const f = facing(o);
    return (this.body.x - o.x) * f.x + (this.body.y - o.y) * f.y >= 0 ? 1 : -1;
  },

  // A little in front of you (or behind, when you're standing and it's behind),
  // to one side, and never inside a wall.
  besideOwner(ahead, gap) {
    const o = this.owner;
    const f = facing(o);
    const k = (o.walkInput ? 1 : ahead) * gap * this.scale;
    const off = this.walk.side * 75;
    for (const side of [off, 0]) {
      const p = { x: o.x + f.x * k - f.y * side, y: o.y + f.y * k + f.x * side };
      if (!blocked(this, p.x, p.y, PET_RADIUS)) return p;
    }
    return { x: o.x, y: o.y };
  },

  // --- The pet's head ---

  // From above, the head is just in front of the body; the mouth a little further.
  headPoint() {
    const b = this.body;
    const d = petLength(this.pet, this.scale) * 0.42 * U;
    return { x: b.x + Math.cos(b.heading) * d, y: b.y + Math.sin(b.heading) * d };
  },

  mouthPoint() {
    const b = this.body;
    const d = petLength(this.pet, this.scale) * 0.55 * U;
    return { x: b.x + Math.cos(b.heading) * d, y: b.y + Math.sin(b.heading) * d };
  },

  // Seen from above there's no high or low, so treats don't lure sits and downs on walks.
  heldHigh() { return false; },
  heldLow() { return false; },

  // --- Treats ---

  dropTreat(point) {
    // Seen from above, it lands where you let go.
    this.floorTreat = { x: point.x, y: point.y, vy: 0, landY: point.y };
  },

  // --- What the owner's hands can touch ---

  hitTest(x, y) { return petHit(this, x, y) ? 'pet' : 'ground'; },

  reachFor(x, y) { this.owner.hand = { x, y }; },

  walkOwnerTo() {},

  // Which way along the route a point is from the owner: 1 onward, -1 back.
  walkDirToward(point) {
    const o = this.owner;
    if (!this.walk.track) return point.x >= o.x ? 1 : -1;
    const here = routePoint(this, o.s);
    const along = (point.x - o.x) * here.tx + (point.y - o.y) * here.ty;
    return along >= 0 ? 1 : -1;
  },

  // --- Walks ---

  walkedMeters() { return this.walk.distance / U; },

  // How far along the route you are, or (exploring) how far you've walked.
  routeMeters() { return this.walk.track ? this.owner.s / U : this.walk.distance / U; },

  biomeHere() {
    const w = this.walk;
    return w.route ? biomeAt(w.route, this.routeMeters()) : blockBiome(w.blocks, this.owner.x / U, this.owner.y / U);
  },

  // A landmark the pet hasn't checked out yet, close by and not behind you.
  landmarkAhead() {
    const w = this.walk;
    const o = this.owner;
    const f = facing(o);
    const lm = (w.route ?? w.area).landmarks.find((l) => {
      if (w.visited.has(l.d) || l.x === undefined) return false;
      const dx = l.x * U - o.x;
      const dy = l.y * U - o.y;
      return Math.hypot(dx, dy) < 30 * U && dx * f.x + dy * f.y > -2 * U && dx * f.x + dy * f.y < 12 * U;
    });
    return lm ? { ...lm, x: lm.x * U, y: lm.y * U } : null;
  },

  // Something to find a little way ahead of you, somewhere it can lie.
  spawnFind() {
    const o = this.owner;
    const f = facing(o);
    for (let tries = 0; tries < 8; tries++) {
      const ahead = this.rand(6, 10) * U;
      const side = this.rand(-2.5, 2.5) * U;
      const p = { x: o.x + f.x * ahead - f.y * side, y: o.y + f.y * ahead + f.x * side };
      if (blocked(this, p.x, p.y, 0.2)) continue;
      this.walk.find = { ...p, item: pickFind(this.pet.species, this.rng, this.biomeHere()) };
      return;
    }
    this.scheduleFind(20, 40);
  },

  scheduleFind(minMeters, maxMeters) {
    this.walk.nextFindAt = this.walk.distance + this.rand(minMeters, maxMeters) * U;
  },

  // A squirrel (or a bird) off to one side ahead, which bolts away from you.
  spawnCritter(ahead) {
    const o = this.owner;
    const f = facing(o);
    const k = (o.walkInput ? 1 : ahead) * 6 * U;
    const p = { x: o.x + f.x * k, y: o.y + f.y * k, tx: f.x, ty: f.y };
    const side = this.chance(0.5) ? 1 : -1;
    const off = side * this.rand(3, 5) * U;
    const blocks = this.walk.blocks;
    const ground = blocks?.get(Math.floor((p.x - p.ty * off) / U), Math.floor((p.y + p.tx * off) / U));
    const leafy = ['park', 'woods'].includes(this.biomeHere()) || ground === B.GRASS || ground === B.FOREST;
    const away = { x: -p.ty * side, y: p.tx * side };
    this.walk.critter = {
      x: p.x - p.ty * off, y: p.y + p.tx * off, ax: away.x, ay: away.y, dir: Math.sign(away.x) || 1,
      kind: this.pet.species === 'dog' && leafy ? 'squirrel' : 'bird', t: 0,
    };
    this.walk.side = side;
  },

  // --- Simulation steps ---

  // You walk along the route (Walk on / Walk back), in a direction (the arrow
  // keys), or to a spot you pressed. Off the route, walls are in the way.
  moveOwner(dt) {
    const o = this.owner;
    const w = this.walk;
    // Exploring: wait for the map under you, then start on open ground near the pin.
    if (w.area) {
      const explore = w.area.explore;
      if (!w.placed && explore.ready(0, 0)) {
        w.placed = true;
        // The nearest street or pavement, so you're not shut in a back garden; else any open ground.
        const open = nearestOpen(w.blocks, o.x / U, o.y / U, 60, STREETS) ?? nearestOpen(w.blocks, o.x / U, o.y / U);
        if (open) {
          const dx = open.x * U - o.x;
          const dy = open.y * U - o.y;
          o.x += dx;
          o.y += dy;
          this.body.x += dx;
          this.body.y += dy;
          this.mapCam.x += dx;
          this.mapCam.y += dy;
          const pet = nearestOpen(w.blocks, this.body.x / U, this.body.y / U, 6);
          if (pet) { this.body.x = pet.x * U; this.body.y = pet.y * U; }
        }
      }
      if (!explore.ready(o.x / U, o.y / U)) { o.speed = 0; return; }
    }
    let dir = null;
    let onRoute = false;
    if (o.goal) {
      const dx = o.goal.x - o.x;
      const dy = o.goal.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.4 * U) { o.goal = null; o.walkInput = 0; } else dir = { x: dx / d, y: dy / d };
    } else if (o.steer) {
      const d = Math.hypot(o.steer.x, o.steer.y) || 1;
      dir = { x: o.steer.x / d, y: o.steer.y / d };
    } else if (o.walkInput && w.track) {
      // Head for a spot a few metres along the route, which brings you back to it if you wandered off.
      const target = routePoint(this, clamp(o.s + o.walkInput * 3 * U, 0, w.length));
      const dx = target.x - o.x;
      const dy = target.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d > 2) dir = { x: dx / d, y: dy / d };
      onRoute = true;
    }
    const before = { x: o.x, y: o.y };
    if (dir) {
      const resisting = w.tension > 0.8 && ['flop', 'sniff'].includes(this.activity.phase) && (this.body.x - o.x) * dir.x + (this.body.y - o.y) * dir.y < 0;
      const step = OWNER_WALK_SPEED * (this.speedScale ?? 1) * (o.jog ? JOG : 1) * (resisting ? 0.45 : 1) * dt;
      // The route follows streets and paths, so walking it needs no checks for walls.
      if (onRoute) { o.x += dir.x * step; o.y += dir.y * step; } else slide(this, o, dir.x * step, dir.y * step, OWNER_RADIUS);
      o.heading = turnToward(o.heading, Math.atan2(dir.y, dir.x), 1 - Math.exp(-dt * 10));
      o.dir = Math.cos(o.heading) >= 0 ? 1 : -1;
    }
    const moved = Math.hypot(o.x - before.x, o.y - before.y);
    // How far along the route you are: the nearest point of it, near where you were.
    if (w.track) o.s = distanceAlong(w.track, o.x / U, o.y / U, o.s / U - 25, o.s / U + 25) * U;
    w.distance += moved;
    this.earn('walk', moved / U);
    if (!w.find && w.distance >= w.nextFindAt) this.spawnFind();
    if (w.find && Math.hypot(w.find.x - o.x, w.find.y - o.y) > 25 * U) {
      w.find = null;
      this.scheduleFind(60, 120);
    }
    if (w.track && !w.arrived && o.s >= w.length - U) {
      const end = routePoint(this, w.length);
      if (Math.hypot(end.x - o.x, end.y - o.y) < 6 * U) {
        w.arrived = true;
        this.reachedRouteEnd();
      }
    }
    o.speed = dt > 0 ? moved / dt : 0;
    o.vx = o.speed * (o.dir ?? 1);
    o.phase += dt * o.speed / 22;
    if (o.speed > 5) o.lastMoved = this.time;
    if (o.hand && o.speed < 5) o.heading = turnToward(o.heading, Math.atan2(o.hand.y - o.y, o.hand.x - o.x), 1 - Math.exp(-dt * 6));
    // The camera follows, looking a little ahead.
    const f = facing(o);
    const look = o.speed > 5 ? 4 * U : 0;
    const k = 1 - Math.exp(-dt * 2.5);
    this.mapCam.x += (o.x + f.x * look / 2 - this.mapCam.x) * k;
    this.mapCam.y += (o.y + f.y * look / 2 - 60 - this.mapCam.y) * k;
  },

  holdLeash(dt) {
    const o = this.owner;
    const b = this.body;
    const dx = b.x - o.x;
    const dy = b.y - o.y;
    const dist = Math.hypot(dx, dy);
    const limit = this.walk.offLeash ? LEASH * 1.6 : LEASH;
    if (dist > limit) {
      const ux = dx / dist;
      const uy = dy / dist;
      const excess = dist - limit;
      const lunging = !this.walk.offLeash && this.activity.phase === 'squirrel' && this.pet.species === 'dog';
      // A lunging dog drags you along.
      if (lunging) slide(this, o, ux * excess * 0.6, uy * excess * 0.6, OWNER_RADIUS);
      const ex = b.x - o.x;
      const ey = b.y - o.y;
      const d = Math.hypot(ex, ey) || 1;
      if (d > limit) {
        b.x = o.x + (ex / d) * limit;
        b.y = o.y + (ey / d) * limit;
        // Pulled against a wall: come round toward you instead.
        for (let i = 0; i < 8 && blocked(this, b.x, b.y, PET_RADIUS); i++) {
          b.x += (o.x - b.x) * 0.25;
          b.y += (o.y - b.y) * 0.25;
        }
      }
    }
    const now = Math.hypot(b.x - o.x, b.y - o.y);
    this.walk.tension = this.walk.offLeash ? 0 : clamp((now - (LEASH - 40)) / 40, 0, 1);
    const c = this.walk.critter;
    if (c) {
      c.t += dt;
      const fleeing = Math.hypot(c.x - b.x, c.y - b.y) < 260 || c.t > 1;
      const v = (c.kind === 'squirrel' ? 260 : 120) * dt * (fleeing ? 1.6 : 0.2);
      c.x += c.ax * v;
      c.y += c.ay * v;
      if (c.t > 5) this.walk.critter = null;
    }
  },

  moveBody(dt) {
    const b = this.body;
    b.vy ??= 0;
    const before = { x: b.x, y: b.y };
    slide(this, b, b.vx * dt, b.vy * dt, PET_RADIUS);
    // Speed is how fast it really went, so it doesn't run on the spot against a wall.
    b.speed = dt > 0 ? Math.hypot(b.x - before.x, b.y - before.y) / dt : 0;
    // The pet faces the way it moves; standing beside you while you walk, it
    // faces the way you're going.
    const o = this.owner;
    const want = b.speed > 12 ? Math.atan2(b.y - before.y, b.x - before.x) : o.speed > 5 ? o.heading : b.heading;
    b.heading = turnToward(b.heading ?? want, want, 1 - Math.exp(-dt * 8));
    b.dir = Math.cos(b.heading) >= 0 ? 1 : -1;
    b.gait += dt * b.speed / (11 * this.scale);
    const k = 1 - Math.exp(-dt * 7);
    for (const key of Object.keys(b.target)) b.pose[key] += (b.target[key] - b.pose[key]) * k;
    b.wagPhase += dt * (5 + b.pose.wag * 13);
    if (b.jump > 0 || b.jumpV > 0) {
      b.jump += b.jumpV * dt;
      b.jumpV -= 1300 * dt;
      if (b.jump <= 0) { b.jump = 0; b.jumpV = 0; }
    }
  },

  moveFloorTreat(dt) {
    const t = this.floorTreat;
    if (!t || t.y >= t.landY) return;
    t.vy += 980 * dt;
    t.y = Math.min(t.landY, t.y + t.vy * dt);
  },
};

// What kind of place you're in, from the blocks around you: for finds and critters.
function blockBiome(blocks, x, y) {
  const n = {};
  for (let dy = -12; dy <= 12; dy += 3) {
    for (let dx = -12; dx <= 12; dx += 3) {
      const id = blocks.get(Math.floor(x + dx), Math.floor(y + dy));
      n[id] = (n[id] ?? 0) + 1;
    }
  }
  if ((n[B.WATER] ?? 0) > 3) return 'water';
  if ((n[B.SAND] ?? 0) > 8) return 'beach';
  if ((n[B.FOREST] ?? 0) > 10) return 'woods';
  if ((n[B.BUILDING] ?? 0) > 12) return (n[B.PAVING] ?? 0) > 6 ? 'town' : 'street';
  if ((n[B.GRASS] ?? 0) + (n[B.PITCH] ?? 0) > 45) return 'park';
  return 'street';
}

// Pressing on the pet: anywhere on its body or head, with a little room to spare.
function petHit(w, x, y) {
  const b = w.body;
  const L = petLength(w.pet, w.scale) * U;
  const head = w.headPoint();
  return Math.hypot(x - b.x, y - b.y) < L * 0.45 || Math.hypot(x - head.x, y - head.y) < L * 0.3;
}
