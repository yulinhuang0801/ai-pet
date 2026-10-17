// The simulation: where the pet is, what it is doing, and how it reacts to
// the owner. Everything here is plain data the renderer draws each frame.

import {
  tickNeeds, addNeeds, addBond, portionGrams, sizeScale, mood, addJournal,
} from './pet.js';
import {
  trickChance, reinforce, associate, recognises, recordRoutine, expects,
  noteHabit, bondMilestone, TRICKS,
} from './learning.js';
import { parseUtterance } from './commands.js';

export const VIEW_W = 800;
export const VIEW_H = 450;
export const GROUND = 392;
export const BOWL_X = 108;
export const BED_X = 688;
export const FRONT_X = 400;
export const BALL_R = 9;
export const UNITS_PER_METER = 45;
const MIN_X = 70;
const MAX_X = 730;

const GAITS = { walk: 55, trot: 105, run: 200 };

const POSES = {
  stand: { sit: 0, lie: 0, head: 0, eyes: 0, mouth: 0, ears: 0.55, tailUp: 0.55, wag: 0.15, paw: 0, tilt: 0, groom: 0, chew: 0, crouch: 0 },
  sit: { sit: 1 },
  lie: { lie: 1, head: 0.25, tailUp: 0.2 },
  sleep: { lie: 1, head: 0.85, eyes: 1, wag: 0, tailUp: 0.05, ears: 0.15 },
  eat: { head: 1, chew: 1, ears: 0.4, wag: 0.4 },
  sniff: { head: 0.8, ears: 0.45, wag: 0.3 },
  happy: { wag: 1, mouth: 0.7, ears: 0.85, tailUp: 0.9 },
  petted: { eyes: 0.85, wag: 0.9, ears: 0.15, mouth: 0.3, tailUp: 0.7 },
  sad: { ears: 0.05, tailUp: 0.05, wag: 0, head: 0.3 },
  alert: { ears: 1, tailUp: 0.85, wag: 0.1 },
  crouch: { crouch: 1, ears: 1, tailUp: 0.35, wag: 0.5, head: 0.2 },
};

const SOUNDS = {
  dog: { happy: 'Woof!', excited: 'Arf arf!', beg: 'Hnnn…', alert: 'WOOF!', greet: 'Arf!', yawn: 'Yawn…', content: 'Hmf.' },
  cat: { happy: 'Mrrp!', excited: 'Mrrrow!', beg: 'Meow?', alert: '…', greet: 'Mrrp?', yawn: 'Yawn…', content: 'Prrr…', annoyed: 'Mrrt!' },
};

// Pets are drawn a little larger than their real proportions so faces read well.
export const petScale = (pet) => sizeScale(pet.look, pet.species) * 1.3;

const isNight = (date) => date.getHours() >= 22 || date.getHours() < 6;

// Each activity: label (status line), enter, tick, optional exit.
// tick returns true when finished; it may also start another activity.
const ACTS = {
  idle: {
    label: (w) => `${w.pet.name} is looking around.`,
    enter(w, a) { a.dur = w.rand(3, 7); a.turnAt = w.rand(1, a.dur); w.setPose('stand'); },
    tick(w, a) {
      w.stop();
      if (a.turnAt && a.t > a.turnAt) { w.body.dir *= -1; a.turnAt = 0; }
      return a.t > a.dur;
    },
  },

  wander: {
    label: (w) => `${w.pet.name} is pottering around.`,
    enter(w, a) { a.x = w.pickSpot(120); w.setPose('stand', { wag: 0.25 }); },
    tick(w, a) { return w.goTo(a.x, 'walk'); },
  },

  sniff: {
    label: (w) => `${w.pet.name} is sniffing something interesting.`,
    enter(w, a) { a.x = w.pickSpot(60); a.phase = 'go'; w.setPose('stand', { head: 0.5 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(a.x, 'walk')) { a.phase = 'sniff'; a.until = a.t + w.rand(2, 4); w.setPose('sniff'); }
        return false;
      }
      w.stop();
      return a.t > a.until;
    },
  },

  sit: {
    label: (w) => `${w.pet.name} is sitting.`,
    enter(w, a) { a.dur = w.rand(5, 12); w.stop(); w.setPose('sit'); w.offerReward('sit', 4); },
    tick(w, a) { w.stop(); return a.t > a.dur; },
  },

  lie: {
    label: (w) => `${w.pet.name} is lying down.`,
    enter(w, a) { a.dur = w.rand(8, 20); w.stop(); w.setPose('lie'); w.offerReward('down', 4); },
    tick(w, a) { w.stop(); return a.t > a.dur; },
  },

  sleep: {
    label: (w) => `${w.pet.name} is fast asleep.`,
    enter(w, a) { a.phase = w.scene === 'home' ? 'go' : 'settle'; a.settleAt = 0; w.setPose('stand'); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(BED_X, 'walk')) { a.phase = 'settle'; }
        return false;
      }
      w.stop();
      if (a.phase === 'settle') {
        w.setPose('lie');
        a.settleAt ||= a.t;
        if (a.t - a.settleAt > 1.5) { a.phase = 'sleep'; a.slept = a.t; w.setPose('sleep'); }
        return false;
      }
      if ((a.t - (a.lastZ ?? 0)) > 1.6) { a.lastZ = a.t; w.emit('z', 1); }
      const target = isNight(w.now()) ? 100 : 95;
      return w.pet.needs.energy >= target && a.t - a.slept > 25;
    },
    exit(w, a) { if (a.phase === 'sleep') w.speak(w.sound('yawn'), 1.5); },
  },

  eat: {
    label: (w) => `${w.pet.name} is eating.`,
    enter(w, a) { a.phase = 'go'; w.setPose('stand', { wag: 0.5, ears: 0.8 }); },
    tick(w, a, dt) {
      const pet = w.pet;
      if (a.phase === 'go') {
        if (w.goTo(BOWL_X + 48 * w.scale, 'trot')) { a.phase = 'eat'; w.body.dir = -1; w.setPose('eat'); }
        return false;
      }
      w.stop();
      const portion = portionGrams(pet);
      const grams = Math.min(pet.bowlGrams, (portion / 16) * dt);
      pet.bowlGrams -= grams;
      a.eaten = (a.eaten ?? 0) + grams;
      addNeeds(pet, { fullness: (grams / portion) * 55 });
      if (w.chance(dt * 2)) w.emit('crumb', 1);
      const done = pet.bowlGrams <= 0.5 || pet.needs.fullness >= 97;
      if (done) {
        if (pet.bowlGrams <= 0.5) pet.bowlGrams = 0;
        pet.memory.stats.meals += 1;
        pet.memory.stats.grams += Math.round(a.eaten);
        w.speak(w.sound('content'), 1.5);
      }
      return done;
    },
  },

  beg: {
    label: (w) => w.pet.species === 'cat'
      ? `${w.pet.name} is sitting by the empty bowl, staring at you.`
      : `${w.pet.name} is waiting by the empty bowl.`,
    enter(w, a) { a.phase = 'go'; a.dur = w.rand(9, 14); w.setPose('stand'); },
    tick(w, a) {
      if (w.pet.bowlGrams > 0) { w.start('eat'); return false; }
      if (a.phase === 'go') {
        if (w.goTo(BOWL_X + 55 * w.scale, 'walk')) { a.phase = 'wait'; a.from = a.t; w.body.dir = 1; w.setPose('sit', { ears: 0.9, tilt: 0.4 }); }
        return false;
      }
      w.stop();
      if (a.t - (a.lastCall ?? -9) > 3.5) { a.lastCall = a.t; w.speak(w.sound('beg'), 1.6); }
      return a.t - a.from > a.dur;
    },
  },

  attention: {
    label: (w) => `${w.pet.name} wants your attention.`,
    enter(w, a) { a.x = FRONT_X + w.rand(-60, 60); a.phase = 'go'; a.dur = w.rand(7, 11); w.setPose('stand', { wag: 0.6 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(a.x, 'trot')) { a.phase = 'wait'; a.from = a.t; w.setPose(w.chance(0.5) ? 'sit' : 'stand', { wag: 0.9, ears: 0.9, mouth: 0.4 }); }
        return false;
      }
      w.stop();
      if (a.t - (a.lastCall ?? -9) > 4) { a.lastCall = a.t; w.speak(w.sound('greet'), 1.4); if (w.pet.species === 'dog' && w.chance(0.5)) w.hop(); }
      return a.t - a.from > a.dur;
    },
  },

  zoomies: {
    label: (w) => `${w.pet.name} has the zoomies!`,
    enter(w, a) { a.laps = Math.round(w.rand(3, 5)); a.x = w.body.x < FRONT_X ? MAX_X - 30 : MIN_X + 30; w.setPose('happy'); },
    tick(w, a) {
      if (w.goTo(a.x, 'run')) {
        a.laps -= 1;
        addNeeds(w.pet, { fun: 3 });
        a.x = a.x > FRONT_X ? MIN_X + 30 : MAX_X - 30;
        if (w.chance(0.4)) w.hop();
      }
      return a.laps <= 0;
    },
  },

  playBall: {
    label: (w) => `${w.pet.name} is playing with the ball.`,
    enter(w, a) { a.bats = Math.round(w.rand(2, 5)); w.setPose('crouch'); },
    tick(w, a) {
      const ball = w.ball;
      if (ball.state !== 'ground' && ball.state !== 'air') return true;
      if (ball.state === 'air') { w.stop(); w.face(ball.x); return false; }
      const side = ball.x > w.body.x ? -1 : 1;
      if (w.goTo(ball.x + side * 26 * w.scale, 'trot')) {
        w.face(ball.x);
        ball.state = 'air';
        ball.vx = w.body.dir * w.rand(140, 320);
        ball.vy = -w.rand(120, 280);
        addNeeds(w.pet, { fun: 4 });
        a.bats -= 1;
      }
      return a.bats <= 0;
    },
  },

  groom: {
    label: (w) => `${w.pet.name} is grooming.`,
    enter(w, a) { a.dur = w.rand(6, 10); w.stop(); w.setPose('sit', { groom: 1, eyes: 0.6 }); },
    tick(w, a) { w.stop(); return a.t > a.dur; },
  },

  // --- Reactions to the owner ---

  chase: {
    label: (w) => `${w.pet.name} is chasing the ball!`,
    enter(w) { w.setPose('happy', { mouth: 0.5 }); },
    tick(w, a) {
      const ball = w.ball;
      if (ball.state !== 'air' && ball.state !== 'ground') return true;
      if (a.t > 14) return true;
      const near = Math.abs(ball.x - w.body.x) < 22 * w.scale;
      if (ball.state === 'ground' && near) {
        ball.state = 'mouth';
        w.setPose('happy', { mouth: 0.2 });
        w.start(a.retrieve ? 'fetchBack' : 'keepBall');
        return false;
      }
      w.goTo(ball.x, 'run');
      return false;
    },
  },

  fetchBack: {
    label: (w) => `${w.pet.name} is bringing the ball back.`,
    enter(w, a) { a.phase = 'go'; },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(FRONT_X, 'trot')) {
          a.phase = 'drop';
          a.from = a.t;
          w.dropBall(40);
          w.setPose('sit', { wag: 1, ears: 0.9, mouth: 0.6 });
          addNeeds(w.pet, { fun: 8, affection: 2 });
          addBond(w.pet, 0.3);
          w.pet.memory.stats.fetches += 1;
          noteHabit(w.pet, 'fetch');
          w.speak(w.sound('happy'), 1.2);
        }
        return false;
      }
      w.stop();
      return a.t - a.from > 4;
    },
  },

  keepBall: {
    label: (w) => `${w.pet.name} decided the ball is theirs now.`,
    enter(w, a) { a.dur = w.rand(4, 7); w.stop(); w.setPose('lie', { wag: 0.5 }); addNeeds(w.pet, { fun: 5 }); },
    tick(w, a) {
      w.stop();
      if (a.t > a.dur) { w.dropBall(0); return true; }
      return false;
    },
  },

  petted: {
    label: (w) => `${w.pet.name} is enjoying the pets.`,
    enter(w, a) {
      w.stop();
      const p = w.pet;
      a.limit = p.species === 'cat' ? 3 + p.traits.cuddly * 10 + p.bond / 15 : 40 + p.traits.cuddly * 40;
      w.setPose(w.body.pose.sit > 0.5 ? 'sit' : 'stand', POSES.petted);
    },
    tick(w, a, dt) {
      w.stop();
      const p = w.pet;
      if (w.petting) {
        addNeeds(p, { affection: 3.2 * dt, fun: 0.3 * dt });
        addBond(p, 0.025 * dt);
        if (a.t - (a.lastHeart ?? -1) > 0.7) { a.lastHeart = a.t; w.emit('heart', 1); }
        if (a.t > a.limit) {
          w.petting = false;
          w.speak(w.sound(p.species === 'cat' ? 'annoyed' : 'content'), 1.4);
          w.start('wander');
          return false;
        }
        a.released = null;
        return false;
      }
      a.released ??= a.t;
      return a.t - a.released > 1.2;
    },
  },

  trick: {
    label: (w, a) => `${w.pet.name} did “${TRICKS[a.trick].label.toLowerCase()}”!`,
    enter(w, a) {
      w.stop();
      const poses = {
        sit: ['sit', {}],
        down: ['lie', { head: 0, ears: 0.8, wag: 0.5 }],
        paw: ['sit', { paw: 1, ears: 0.8, wag: 0.6 }],
        spin: ['stand', { wag: 0.8, mouth: 0.4 }],
      };
      const [pose, extra] = poses[a.trick];
      w.setPose(pose, extra);
      w.offerReward(a.trick, 6);
    },
    tick(w, a) {
      w.stop();
      if (a.trick === 'spin' && a.t < 1.2 && a.t - (a.lastFlip ?? -1) > 0.3) { a.lastFlip = a.t; w.body.dir *= -1; w.hop(140); }
      return a.t > 4;
    },
  },

  confused: {
    label: (w) => `${w.pet.name} tilts their head.`,
    enter(w) { w.stop(); w.setPose('stand', { tilt: 1, ears: 0.9 }); w.speak('?', 1.5); },
    tick(w, a) { w.stop(); return a.t > 2; },
  },

  come: {
    label: (w) => `${w.pet.name} is coming over.`,
    enter(w, a) { a.phase = 'go'; w.setPose('stand', { wag: 0.8, ears: 0.8 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.scene === 'park' || w.goTo(FRONT_X + w.rand(-20, 20), 'trot')) { a.phase = 'wait'; a.from = a.t; w.setPose('sit', { wag: 0.9, ears: 0.9 }); w.offerReward('sit', 4); }
        return false;
      }
      w.stop();
      return a.t - a.from > 3;
    },
  },

  treat: {
    label: (w) => `${w.pet.name} is munching a treat.`,
    enter(w, a) { a.phase = 'go'; w.setPose('happy'); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.scene === 'park' || w.goTo(FRONT_X, 'trot')) { a.phase = 'chew'; a.from = a.t; w.setPose('sit', { chew: 1, wag: 1, eyes: 0.3 }); }
        return false;
      }
      w.stop();
      return a.t - a.from > 2.2;
    },
  },

  excited: {
    label: (w) => `${w.pet.name} is excited!`,
    enter(w, a) { w.stop(); w.setPose('happy'); w.speak(w.sound('excited'), 1.4); a.hops = 0; },
    tick(w, a) {
      w.stop();
      if (w.pet.species === 'dog' && a.t - (a.lastHop ?? -1) > 0.45 && a.hops < 3) { a.lastHop = a.t; a.hops += 1; w.hop(); }
      return a.t > 2.2;
    },
  },

  sulk: {
    label: (w) => `${w.pet.name} is sulking.`,
    enter(w, a) { w.stop(); w.body.dir *= -1; w.setPose('lie', POSES.sad); a.dur = w.rand(4, 7); },
    tick(w, a) { w.stop(); return a.t > a.dur; },
  },

  greet: {
    label: (w) => `${w.pet.name} is happy to see you!`,
    enter(w, a) { a.phase = 'go'; w.setPose('happy'); },
    tick(w, a) {
      const dog = w.pet.species === 'dog';
      if (a.phase === 'go') {
        if (w.goTo(FRONT_X, dog ? 'run' : 'walk')) { a.phase = 'hello'; a.from = a.t; w.speak(w.sound('greet'), 1.6); }
        return false;
      }
      w.stop();
      if (dog && a.t - (a.lastHop ?? -1) > 0.5 && a.t - a.from < 2) { a.lastHop = a.t; w.hop(); }
      if (!dog) w.setPose('sit', { tailUp: 1, ears: 0.9 });
      return a.t - a.from > 3;
    },
  },

  // --- Walks ---

  leash: {
    label: (w, a) => ({
      walk: `${w.pet.name} is trotting along.`,
      sniff: `${w.pet.name} found a very good smell.`,
      squirrel: w.pet.species === 'dog' ? `${w.pet.name} spotted a squirrel!` : `${w.pet.name} is stalking a bird.`,
      look: `${w.pet.name} is taking in the view.`,
      flop: `${w.pet.name} flopped down and refuses to move.`,
      tired: `${w.pet.name} is tired. Time to head home?`,
    })[a.phase],
    enter(w, a) {
      const p = w.pet;
      a.phase = 'walk';
      a.next = w.rand(5, 10);
      // Cats often protest the harness.
      if (p.species === 'cat' && w.chance(0.25 + p.traits.stubborn * 0.4 - p.traits.energy * 0.2)) w.setLeash(a, 'flop', w.rand(4, 7));
      else w.setPose('stand', { wag: 0.6, ears: 0.7, tailUp: 0.75 });
    },
    tick(w, a, dt) {
      const p = w.pet;
      const walk = w.walk;
      addNeeds(p, { fun: 0.12 * dt, affection: 0.04 * dt });
      addBond(p, 0.004 * dt);
      if (a.phase !== 'tired' && p.needs.energy < 12) w.setLeash(a, 'tired', 999);
      switch (a.phase) {
        case 'walk': {
          w.body.vx = GAITS.walk * Math.sqrt(w.scale) * (0.9 + p.traits.energy * 0.4);
          w.body.dir = 1;
          if (a.t > a.next) {
            const r = w.rng();
            if (r < 0.4) w.setLeash(a, 'sniff', w.rand(2, 4));
            else if (r < 0.65) { w.setLeash(a, 'squirrel', 2.5); walk.critter = { x: walk.offset + w.body.x + 260, kind: p.species === 'dog' ? 'squirrel' : 'bird', t: 0 }; }
            else w.setLeash(a, 'look', w.rand(1.5, 3));
          }
          break;
        }
        case 'squirrel': {
          if (p.species === 'dog') {
            w.body.vx = GAITS.trot * 1.4;
            if (a.t - (a.lastBark ?? -9) > 1) { a.lastBark = a.t; w.speak(w.sound('alert'), 0.9); }
            addNeeds(p, { fun: 1.5 * dt });
          } else w.body.vx = 0;
          if (a.t > a.until) w.setLeash(a, 'walk');
          break;
        }
        case 'flop':
          w.body.vx = 0;
          if (a.t > a.until) w.setLeash(a, w.chance(0.6) ? 'walk' : 'flop', w.rand(3, 6));
          break;
        case 'tired':
          w.body.vx = 0;
          break;
        default:
          w.body.vx = 0;
          if (a.t > a.until) w.setLeash(a, 'walk');
      }
      return false;
    },
  },
};

const LEASH_POSES = {
  walk: ['stand', { wag: 0.6, ears: 0.7, tailUp: 0.75 }],
  sniff: ['sniff', {}],
  squirrel: ['alert', {}],
  look: ['stand', { ears: 0.9, tilt: 0.3 }],
  flop: ['lie', { ears: 0.3, wag: 0, tailUp: 0.1 }],
  tired: ['lie', { mouth: 0.6, ears: 0.3 }],
};

export class World {
  constructor(pet, { rng = Math.random, clock = () => new Date(), onNote = () => {}, onToast = () => {} } = {}) {
    this.pet = pet;
    this.rng = rng;
    this.clock = clock;
    this.onNote = onNote;
    this.onToast = onToast;
    this.time = 0;
    this.scene = 'home';
    this.scale = petScale(pet);
    this.body = {
      x: 300, dir: 1, vx: 0, speed: 0, gait: 0, wagPhase: 0, jump: 0, jumpV: 0,
      pose: { ...POSES.stand }, target: { ...POSES.stand },
    };
    this.ball = { state: 'hand', x: FRONT_X, y: GROUND - BALL_R, vx: 0, vy: 0, spin: 0 };
    this.particles = [];
    this.bubble = null;
    this.petting = false;
    this.reward = null;
    this.heard = {};
    this.walk = null;
    this.activity = null;
    this.start('idle');
  }

  // --- helpers used by activities ---
  now() { return this.clock(); }
  rand(a, b) { return a + (b - a) * this.rng(); }
  chance(p) { return this.rng() < p; }
  sound(kind) { return SOUNDS[this.pet.species][kind] ?? SOUNDS[this.pet.species].happy; }

  setPose(name, extra = {}) {
    this.body.target = { ...POSES.stand, ...POSES[name], ...extra };
  }

  stop() { this.body.vx = 0; }

  face(x) { if (Math.abs(x - this.body.x) > 2) this.body.dir = x > this.body.x ? 1 : -1; }

  goTo(x, gait = 'walk') {
    const b = this.body;
    const dx = x - b.x;
    if (Math.abs(dx) < 6) { b.vx = 0; return true; }
    const speed = GAITS[gait] * Math.sqrt(this.scale);
    b.dir = Math.sign(dx);
    // Ease in when arriving so the pet does not skid to a stop.
    b.vx = b.dir * Math.min(speed, Math.max(30, Math.abs(dx) * 3));
    return false;
  }

  pickSpot(minDistance) {
    for (let i = 0; i < 8; i++) {
      const x = this.rand(MIN_X + 40, MAX_X - 40);
      if (Math.abs(x - this.body.x) >= minDistance) return x;
    }
    return this.body.x > FRONT_X ? MIN_X + 60 : MAX_X - 60;
  }

  hop(v = 240) { if (this.body.jump <= 0) this.body.jumpV = v; }

  speak(text, secs = 1.5) { this.bubble = { text, until: this.time + secs }; }

  emit(type, count = 1) {
    const head = this.headPoint();
    for (let i = 0; i < count; i++) {
      this.particles.push({
        type, x: head.x + this.rand(-8, 8), y: head.y - 10,
        vx: this.rand(-12, 12), vy: type === 'crumb' ? this.rand(-40, -10) : this.rand(-38, -24),
        age: 0, life: type === 'crumb' ? 0.7 : 1.8,
      });
    }
  }

  // Rough head position in view space, for bubbles and particles.
  headPoint() {
    const b = this.body;
    const s = this.scale;
    const lowered = Math.max(b.pose.head, b.pose.lie * 0.6);
    return { x: b.x + b.dir * 60 * s, y: GROUND - b.jump - (100 - lowered * 60) * s };
  }

  isAsleep() { return this.activity?.type === 'sleep' && this.activity.phase === 'sleep'; }

  offerReward(trick, secs) { this.reward = { trick, until: this.time + secs }; }

  setLeash(a, phase, secs = 0) {
    a.phase = phase;
    a.until = a.t + secs;
    a.next = a.t + this.rand(6, 12);
    const [pose, extra] = LEASH_POSES[phase];
    this.setPose(pose, extra);
  }

  dropBall(forward) {
    const b = this.body;
    this.ball.state = 'ground';
    this.ball.x = Math.min(MAX_X, Math.max(MIN_X, b.x + b.dir * 55 * this.scale));
    this.ball.y = GROUND - 30;
    this.ball.vx = b.dir * forward * 0.5;
    this.ball.vy = -40;
  }

  start(type, params = {}) {
    const prev = this.activity;
    if (prev) ACTS[prev.type].exit?.(this, prev);
    const a = { type, t: 0, ...params };
    this.activity = a;
    ACTS[type].enter?.(this, a);
    return a;
  }

  status() {
    const a = this.activity;
    if (this.isAsleep()) return ACTS.sleep.label(this, a);
    if (a.type === 'sleep') return `${this.pet.name} is settling down for a nap.`;
    return ACTS[a.type].label(this, a);
  }

  mood() { return mood(this.pet, this.isAsleep()); }

  // Pick what to do next, weighing needs, personality and habits.
  next() {
    if (this.scene === 'park') { this.start('leash'); return; }
    const p = this.pet;
    const n = p.needs;
    const t = p.traits;
    const cat = p.species === 'cat';
    const date = this.now();
    const night = isNight(date);
    const deficit = (v) => (100 - v) / 100;
    const expectFood = p.bowlGrams === 0 && n.fullness < 85 ? expects(p, 'feed', date) : 0;

    const scores = {
      idle: 0.35,
      wander: 0.25 + t.energy * 0.35,
      sit: 0.3,
      lie: 0.1 + deficit(n.energy) * 0.7 + (1 - t.energy) * 0.35 + (cat ? 0.2 : 0),
      sleep: (n.energy < 50 ? deficit(n.energy) ** 2 * 3.5 : 0) + (night && n.energy < 97 ? 1.6 : 0) + (cat && n.energy < 75 ? 0.4 : 0),
      eat: p.bowlGrams > 0 && n.fullness < 85 ? deficit(n.fullness) * 3 + 0.3 : 0,
      beg: (p.bowlGrams === 0 && n.fullness < 45 ? deficit(n.fullness) * 1.8 : 0) + expectFood * 1.6,
      attention: deficit(n.affection) * (0.3 + t.cuddly * 1.3) * (cat ? 0.6 : 1) + expects(p, 'walk', date) * (cat ? 0.2 : 1.2),
      zoomies: n.energy > 60 && !night ? deficit(n.fun) * t.energy * t.playful * 1.8 : 0,
      playBall: this.ball.state === 'ground' && n.energy > 30 ? deficit(n.fun) * t.playful * (cat ? 2.2 : 1.6) : 0,
      groom: cat ? 0.4 : 0,
      sniff: cat ? 0 : 0.3,
    };
    if (this.lastChoice) scores[this.lastChoice] *= 0.4;

    const entries = Object.entries(scores).filter(([, v]) => v > 0);
    const total = entries.reduce((s, [, v]) => s + v * v, 0);
    let r = this.rng() * total;
    let choice = entries[0][0];
    for (const [k, v] of entries) {
      r -= v * v;
      if (r <= 0) { choice = k; break; }
    }
    this.lastChoice = choice;
    this.start(choice);
  }

  // --- owner actions ---

  wake() {
    if (this.activity.type !== 'sleep') return true;
    this.start('idle');
    return true;
  }

  // Remember words the owner said, so a following action can teach them.
  hear(word) { this.heard[word] = this.time; }

  heardRecently(word, secs = 30) {
    const t = this.heard[word];
    return t !== undefined && this.time - t <= secs;
  }

  learnWord(word) {
    if (this.heardRecently(word)) {
      const note = associate(this.pet, word);
      if (note) this.onNote(note);
      delete this.heard[word];
    }
  }

  rewardIfEarned(kind) {
    if (this.reward && this.time <= this.reward.until) {
      const note = reinforce(this.pet, this.reward.trick, kind);
      if (note) this.onNote(note);
      this.reward = null;
      return true;
    }
    return false;
  }

  positive() {
    this.learnWord('name');
    const note = bondMilestone(this.pet);
    if (note) this.onNote(note);
  }

  feed() {
    if (this.scene !== 'home') return this.onToast('The food bowl is at home.');
    const p = this.pet;
    const portion = portionGrams(p);
    if (p.bowlGrams >= portion * 1.5) return this.onToast(`The bowl is already full.`);
    p.bowlGrams = Math.min(portion * 2, p.bowlGrams + portion);
    addBond(p, 0.5);
    const note = recordRoutine(p, 'feed', this.now());
    if (note) this.onNote(note);
    this.learnWord('dinner');
    this.positive();
    if (this.isAsleep()) {
      if (p.needs.fullness < 60 && this.chance(0.75)) { this.wake(); this.start('eat'); }
      return;
    }
    if (p.needs.fullness < 92) {
      if (p.species === 'dog' && p.needs.fullness < 60) this.speak(this.sound('excited'), 1);
      this.start('eat');
    } else this.onToast(`${p.name} isn't hungry right now. The food will wait in the bowl.`);
  }

  giveTreat() {
    const p = this.pet;
    const day = this.now().toDateString();
    const tt = p.memory.treatsToday;
    if (tt.day !== day) { tt.day = day; tt.count = 0; }
    tt.count += 1;
    const plenty = tt.count > 8;
    addNeeds(p, plenty ? { fullness: 1 } : { fullness: 3, affection: 4, fun: 1 });
    if (!plenty) addBond(p, 0.3);
    noteHabit(p, 'treats');
    this.learnWord('treat');
    this.positive();
    if (plenty && tt.count === 9) this.onToast(`${p.name} has had plenty of treats today.`);
    this.rewardIfEarned('treat');
    if (this.isAsleep() && !this.chance(0.8)) return;
    this.start('treat');
  }

  throwBall(targetX) {
    if (this.scene !== 'home') return this.onToast('Save the ball for the living room.');
    if (this.ball.state === 'mouth') return this.onToast(`${this.pet.name} has the ball.`);
    const p = this.pet;
    const tx = Math.min(MAX_X - 20, Math.max(MIN_X + 20, targetX ?? this.rand(MIN_X + 60, MAX_X - 60)));
    const T = 0.9;
    const ball = this.ball;
    ball.state = 'air';
    ball.x = FRONT_X;
    ball.y = VIEW_H + 10;
    ball.vx = (tx - FRONT_X) / T;
    ball.vy = (GROUND - BALL_R - ball.y - 0.5 * 900 * T * T) / T;
    this.learnWord('ball');

    if (this.isAsleep() && !this.chance(0.15)) return;
    const t = p.traits;
    const n = p.needs;
    const cat = p.species === 'cat';
    let want = cat ? 0.15 + t.playful * 0.5 : 0.35 + t.playful * 0.55;
    want *= n.energy < 20 ? 0.3 : 1;
    want += (p.memory.words.ball ?? 0) * 0.15;
    if (!this.chance(want)) {
      this.face(tx);
      if (this.activity.type === 'sleep') this.wake();
      this.speak(cat ? '…' : this.sound('content'), 1.2);
      return;
    }
    const fetches = p.memory.habits.fetch ?? 0;
    const retrieve = this.chance(cat
      ? 0.04 + Math.min(0.3, fetches * 0.006)
      : 0.5 + p.bond / 250 + Math.min(0.25, fetches * 0.01) - t.stubborn * 0.3);
    this.start('chase', { retrieve });
  }

  pickUpBall() {
    if (this.ball.state === 'ground') { this.ball.state = 'hand'; return true; }
    return false;
  }

  startPetting() {
    this.petting = true;
    noteHabit(this.pet, 'petting');
    this.positive();
    this.rewardIfEarned('praise');
    if (this.activity.type === 'sleep') return; // a sleeping pet just enjoys it
    if (this.activity.type !== 'petted') this.start('petted');
  }

  stopPetting() { this.petting = false; }

  say(text) {
    const p = this.pet;
    const u = parseUtterance(text, p.name);
    noteHabit(p, 'talk');
    if (u.name) this.hear('name');
    if (u.topic) this.hear(u.topic);

    if (u.praise) {
      addNeeds(p, { affection: 3 });
      this.positive();
      if (!this.rewardIfEarned('praise') && !this.isAsleep()) {
        this.body.target.wag = 1;
        this.speak(this.sound('happy'), 1);
      }
    }
    if (u.scold) {
      addNeeds(p, { affection: -4 });
      addBond(p, -0.3);
      this.reward = null;
      if (!this.isAsleep()) this.start('sulk');
      return;
    }
    if (this.isAsleep()) {
      // A sleeping pet only stirs for its name or a word it loves.
      const stirs = (u.name && this.chance(p.memory.words.name * 0.7)) || (u.topic && recognises(p, u.topic) && this.chance(0.6));
      if (!stirs) return;
      this.wake();
    }

    // Does the pet notice it is being talked to?
    const attentive = u.name ? this.chance(0.35 + p.memory.words.name * 0.6) : this.chance(0.75);
    if (u.trick) {
      if (attentive && this.chance(trickChance(p, u.trick))) this.start('trick', { trick: u.trick });
      else if (this.chance(0.5)) this.start('confused');
      return;
    }
    if (u.come || (u.name && !u.topic && !u.praise)) {
      const comes = this.chance((p.species === 'cat' ? 0.2 + p.bond / 200 : 0.4 + p.bond / 150) * (1 - p.traits.stubborn * 0.3));
      if (attentive && comes && this.scene === 'home') this.start('come');
      else if (attentive) { this.body.target.ears = 1; this.face(FRONT_X); }
      return;
    }
    if (u.topic) {
      if (recognises(p, u.topic)) {
        if (u.topic === 'dinner' && this.scene === 'home') this.start('beg');
        else this.start('excited');
      } else if (attentive && this.chance(0.5)) this.start('confused');
    }
  }

  startWalk() {
    if (this.scene === 'park') return;
    const p = this.pet;
    if (this.ball.state === 'mouth') this.dropBall(0);
    this.scene = 'park';
    this.walk = { offset: 0, startedAt: this.time, critter: null };
    this.body.x = 330;
    this.body.vx = 0;
    noteHabit(p, 'walks');
    const note = recordRoutine(p, 'walk', this.now());
    if (note) this.onNote(note);
    this.learnWord('walk');
    this.positive();
    this.start('leash');
  }

  endWalk() {
    if (this.scene !== 'park') return null;
    const meters = Math.round(this.walk.offset / UNITS_PER_METER);
    const minutes = Math.max(1, Math.round((this.time - this.walk.startedAt) / 60));
    const stats = this.pet.memory.stats;
    stats.walkMeters += meters;
    stats.walks += 1;
    if (stats.walks === 1) addJournal(this.pet, `First walk together: ${meters} m.`);
    this.scene = 'home';
    this.walk = null;
    this.body.x = FRONT_X;
    this.body.vx = 0;
    this.start('idle');
    return { meters, minutes };
  }

  greet() { this.start('greet'); }

  petHit(x, y) {
    const s = this.scale;
    const b = this.body;
    return Math.abs(x - b.x) < 75 * s && y > GROUND - b.jump - 125 * s && y < GROUND + 6;
  }

  ballHit(x, y) {
    const ball = this.ball;
    return ball.state === 'ground' && Math.hypot(x - ball.x, y - ball.y) < 26;
  }

  // --- simulation step ---

  update(dt) {
    this.time += dt;
    const a = this.activity;
    a.t += dt;
    const exert = this.isAsleep() ? 'sleep' : this.body.speed > 140 ? 'run' : this.body.speed > 10 ? 'walk' : 'rest';
    tickNeeds(this.pet, dt, exert);
    if (this.petting && this.isAsleep()) {
      addNeeds(this.pet, { affection: 2 * dt });
      if (Math.floor(this.time / 0.9) !== Math.floor((this.time - dt) / 0.9)) this.emit('heart', 1);
    }

    const done = ACTS[a.type].tick(this, a, dt);
    if (done && this.activity === a) this.next();

    this.moveBody(dt);
    this.moveBall(dt);
    this.moveParticles(dt);
    if (this.bubble && this.time > this.bubble.until) this.bubble = null;
    if (this.reward && this.time > this.reward.until) this.reward = null;
  }

  moveBody(dt) {
    const b = this.body;
    if (this.scene === 'park') {
      this.walk.offset += b.vx * dt;
      if (this.walk.critter) {
        const c = this.walk.critter;
        c.t += dt;
        c.x += (c.kind === 'squirrel' ? 140 : 60) * dt * (c.t > 1 ? 2 : 0.3);
        if (c.t > 4) this.walk.critter = null;
      }
    } else {
      b.x = Math.min(MAX_X, Math.max(MIN_X, b.x + b.vx * dt));
    }
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
  }

  moveBall(dt) {
    const ball = this.ball;
    if (ball.state !== 'air' && ball.state !== 'ground') return;
    ball.vy += 900 * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.spin += ball.vx * dt / BALL_R;
    const floor = GROUND - BALL_R;
    if (ball.y >= floor) {
      ball.y = floor;
      if (ball.vy > 90) { ball.vy *= -0.5; ball.vx *= 0.85; } else { ball.vy = 0; ball.state = 'ground'; }
    }
    if (ball.state === 'ground') ball.vx *= Math.exp(-2.2 * dt);
    if (ball.x < 30 || ball.x > VIEW_W - 30) { ball.vx *= -0.5; ball.x = Math.min(VIEW_W - 30, Math.max(30, ball.x)); }
  }

  moveParticles(dt) {
    for (const pt of this.particles) {
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.type === 'crumb') pt.vy += 300 * dt;
    }
    this.particles = this.particles.filter((pt) => pt.age < pt.life);
  }
}
