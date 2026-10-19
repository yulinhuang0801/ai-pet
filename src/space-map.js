// The map space: a walk along a real route, seen from above. The owner walks
// the route's actual streets and paths, turning its corners; the pet moves
// freely around them on the leash, sniffing at the verge, checking out real
// landmarks and chasing squirrels across the grass.
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

// How far along the route the pet is, looking near the owner.
function petAlong(w) {
  const s = w.owner.s / U;
  return distanceAlong(w.walk.track, w.body.x / U, w.body.y / U, s - 15, s + 15) * U;
}

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
    w.track = measureLine(w.route.line);
    w.length = w.track.length * U;
    w.side = 1; // which side of the path the pet trots on
    const start = routePoint(this, 0);
    const heading = Math.atan2(start.ty, start.tx);
    Object.assign(this.owner, {
      x: start.x, y: start.y, s: 0, dir: start.tx >= 0 ? 1 : -1, heading, vx: 0, targetX: null, walkInput: 0, hand: null,
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
    const speed = Math.min(GAITS[gait] * Math.sqrt(this.scale), Math.max(30, dist * 3));
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

  // Ahead of the owner along the route (1) or behind (-1).
  sideOfOwner() { return petAlong(this) >= this.owner.s ? 1 : -1; },

  // On the route a little ahead of (or behind) the owner, on the pet's side of the path.
  besideOwner(ahead, gap) {
    const p = routePoint(this, this.owner.s + ahead * gap * this.scale);
    const off = this.walk.side * 75;
    return { x: p.x - p.ty * off, y: p.y + p.tx * off };
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
    const here = routePoint(this, o.s);
    const along = (point.x - o.x) * here.tx + (point.y - o.y) * here.ty;
    return along >= 0 ? 1 : -1;
  },

  // --- Walks ---

  walkedMeters() { return this.walk.distance / U; },

  routeMeters() { return this.owner.s / U; },

  biomeHere() { return biomeAt(this.walk.route, this.routeMeters()); },

  landmarkAhead() {
    const w = this.walk;
    const here = this.routeMeters();
    const lm = w.route.landmarks.find((l) => !w.visited.has(l.d) && l.d > here - 2 && l.d < here + 10);
    return lm ? { ...lm, x: lm.x * U, y: lm.y * U } : null;
  },

  // Something to find, at the edge of the path a little way ahead.
  spawnFind() {
    const o = this.owner;
    const p = routePoint(this, o.s + (o.walkInput || 1) * this.rand(7, 11) * U);
    const off = (this.chance(0.5) ? 1 : -1) * this.rand(0.6, 1.4) * U;
    this.walk.find = { x: p.x - p.ty * off, y: p.y + p.tx * off, item: pickFind(this.pet.species, this.rng, this.biomeHere()) };
  },

  scheduleFind(minMeters, maxMeters) {
    this.walk.nextFindAt = this.walk.distance + this.rand(minMeters, maxMeters) * U;
  },

  // A squirrel (or a bird) off to one side ahead, which bolts away from the path.
  spawnCritter(ahead) {
    const p = routePoint(this, this.owner.s + ahead * 6 * U);
    const side = this.chance(0.5) ? 1 : -1;
    const off = side * this.rand(3, 5) * U;
    const leafy = ['park', 'woods'].includes(this.biomeHere());
    const away = { x: -p.ty * side, y: p.tx * side };
    this.walk.critter = {
      x: p.x - p.ty * off, y: p.y + p.tx * off, ax: away.x, ay: away.y, dir: Math.sign(away.x) || 1,
      kind: this.pet.species === 'dog' && leafy ? 'squirrel' : 'bird', t: 0,
    };
    this.walk.side = side;
  },

  // --- Simulation steps ---

  moveOwner(dt) {
    const o = this.owner;
    const w = this.walk;
    const resisting = w.tension > 0.8 && ['flop', 'sniff'].includes(this.activity.phase) && Math.sign(petAlong(this) - o.s) !== o.walkInput;
    const before = o.s;
    o.s = clamp(o.s + o.walkInput * OWNER_WALK_SPEED * (o.jog ? JOG : 1) * (resisting ? 0.45 : 1) * dt, 0, w.length);
    const step = Math.abs(o.s - before);
    w.distance += step;
    this.earn('walk', step / U);
    if (!w.find && w.distance >= w.nextFindAt) this.spawnFind();
    if (w.find && Math.hypot(w.find.x - o.x, w.find.y - o.y) > 25 * U) {
      w.find = null;
      this.scheduleFind(60, 120);
    }
    placeOwner(this);
    if (!w.arrived && o.s >= w.length - 1) {
      w.arrived = true;
      this.reachedRouteEnd();
    }
    o.speed = dt > 0 ? step / dt : 0;
    o.vx = o.speed * o.walkInput;
    o.phase += dt * o.speed / 22;
    if (o.speed > 5) o.lastMoved = this.time;
    if (o.hand && o.speed < 5) o.heading = turnToward(o.heading, Math.atan2(o.hand.y - o.y, o.hand.x - o.x), 1 - Math.exp(-dt * 6));
    // The camera follows, looking a little ahead.
    const ahead = routePoint(this, o.s + (o.walkInput || 0) * 4 * U);
    const k = 1 - Math.exp(-dt * 2.5);
    this.mapCam.x += ((o.x + ahead.x) / 2 - this.mapCam.x) * k;
    this.mapCam.y += ((o.y + ahead.y) / 2 - 60 - this.mapCam.y) * k;
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
      if (lunging) {
        // A lunging dog drags its owner along the path.
        const here = routePoint(this, o.s);
        o.s = clamp(o.s + (ux * here.tx + uy * here.ty) * excess * 0.6, 0, this.walk.length);
        placeOwner(this);
      }
      const ex = b.x - o.x;
      const ey = b.y - o.y;
      const d = Math.hypot(ex, ey) || 1;
      if (d > limit) { b.x = o.x + (ex / d) * limit; b.y = o.y + (ey / d) * limit; }
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
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.speed = Math.hypot(b.vx, b.vy);
    // The pet faces the way it moves; standing beside you while you walk, it
    // faces the way you're going.
    const o = this.owner;
    const want = b.speed > 12 ? Math.atan2(b.vy, b.vx) : o.speed > 5 ? o.heading : b.heading;
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

// Put the owner on the route at their distance along it, facing the way they walk.
function placeOwner(w) {
  const o = w.owner;
  const p = routePoint(w, o.s);
  o.x = p.x;
  o.y = p.y;
  if (o.walkInput) {
    const want = Math.atan2(p.ty * o.walkInput, p.tx * o.walkInput);
    o.heading = turnToward(o.heading ?? want, want, 0.25);
    o.dir = Math.cos(o.heading) >= 0 ? 1 : -1;
  }
}

// Pressing on the pet: anywhere on its body or head, with a little room to spare.
function petHit(w, x, y) {
  const b = w.body;
  const L = petLength(w.pet, w.scale) * U;
  const head = w.headPoint();
  return Math.hypot(x - b.x, y - b.y) < L * 0.45 || Math.hypot(x - head.x, y - head.y) < L * 0.3;
}
