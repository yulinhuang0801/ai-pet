// The simulation: where the pet and its owner are, what the pet is doing,
// and how it reacts to what the owner does with their hands. Everything here
// is plain data that the renderer draws each frame.

import {
  tickNeeds, addNeeds, addBond, portionGrams, sizeScale, mood, addJournal,
} from './pet.js';
import {
  trickChance, reinforce, associate, recognises, recordRoutine, expects,
  noteHabit, bondMilestone, TRICKS,
} from './learning.js';
import { parseUtterance } from './commands.js';
import { shoulderPoint, OWNER } from './owner.js';

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
const MIN_X = 60;
const MAX_X = 745;
const ARM_REACH = OWNER.upperArm + OWNER.forearm - 6;

const GAITS = { walk: 55, trot: 105, run: 210 };
const OWNER_SPEED = 130;
const OWNER_WALK_SPEED = 95;

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
  playBow: { crouch: 0.75, ears: 1, tailUp: 0.95, wag: 1, mouth: 0.5 },
  beg: { tilt: -0.35, ears: 0.9, wag: 0.8, mouth: 0.3 },
};

export const VOICE_LINES = {
  dog: { happy: 'Woof!', excited: 'Arf arf!', beg: 'Hnnn…', alert: 'WOOF!', greet: 'Arf!', yawn: 'Yawn…', content: 'Hmf.' },
  cat: { happy: 'Mrrp!', excited: 'Mrrrow!', beg: 'Meow?', alert: '…', greet: 'Mrrp?', yawn: 'Yawn…', content: 'Prrr…', annoyed: 'Mrrt!' },
};

// Pets are drawn a little larger than their real proportions so faces read well.
export const petScale = (pet) => sizeScale(pet.look, pet.species) * 1.3;

const isNight = (date) => date.getHours() >= 22 || date.getHours() < 6;
const clampX = (x) => Math.min(MAX_X, Math.max(MIN_X, x));
const lerp = (a, b, t) => a + (b - a) * t;

// Where a ball in flight will land on the floor, ignoring walls.
function landingX(ball) {
  const floor = GROUND - BALL_R;
  const disc = ball.vy * ball.vy + 2 * GRAVITY * Math.max(0, floor - ball.y);
  const t = (ball.vy + Math.sqrt(disc)) / GRAVITY;
  return ball.x + ball.vx * t;
}

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

  follow: {
    label: (w) => `${w.pet.name} is following you.`,
    enter(w, a) { a.phase = 'go'; w.setPose('stand', { wag: 0.7, ears: 0.7 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(w.ownerSpot(), 'trot')) { a.phase = 'wait'; a.from = a.t; w.faceOwner(); w.setPose('sit', { wag: 0.6 }); }
        return a.t > 10;
      }
      w.stop();
      return a.t - a.from > 4;
    },
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
        if (w.goTo(BED_X, 'walk')) a.phase = 'settle';
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
    exit(w, a) { if (a.phase === 'sleep') w.vocal('yawn', 1.5); },
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
      // Keep eating while the owner is still pouring.
      const pouring = w.drag?.item === 'scoop';
      const done = !pouring && (pet.bowlGrams <= 0.5 || pet.needs.fullness >= 97);
      if (done) {
        if (pet.bowlGrams <= 0.5) pet.bowlGrams = 0;
        pet.memory.stats.meals += 1;
        pet.memory.stats.grams += Math.round(a.eaten);
        w.vocal('content', 1.5);
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
        if (w.goTo(BOWL_X + 55 * w.scale, 'walk')) { a.phase = 'wait'; a.from = a.t; w.faceOwner(); w.setPose('sit', { ears: 0.9, tilt: 0.4 }); }
        return false;
      }
      w.stop();
      if (a.t - (a.lastCall ?? -9) > 3.5) { a.lastCall = a.t; w.vocal('beg', 1.6); }
      return a.t - a.from > a.dur;
    },
  },

  attention: {
    label: (w) => `${w.pet.name} wants your attention.`,
    enter(w, a) { a.phase = 'go'; a.dur = w.rand(7, 11); w.setPose('stand', { wag: 0.6 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(w.ownerSpot(), 'trot')) {
          a.phase = 'wait';
          a.from = a.t;
          w.faceOwner();
          w.setPose(w.chance(0.5) ? 'sit' : 'stand', { wag: 0.9, ears: 0.9, mouth: 0.4 });
        }
        return a.t > 12;
      }
      w.stop();
      if (a.t - (a.lastCall ?? -9) > 4) { a.lastCall = a.t; w.vocal('greet', 1.4); if (w.pet.species === 'dog' && w.chance(0.5)) w.hop(); }
      return a.t - a.from > a.dur;
    },
  },

  zoomies: {
    label: (w) => `${w.pet.name} has the zoomies!`,
    enter(w, a) { a.laps = Math.round(w.rand(3, 5)); a.x = w.body.x < 400 ? MAX_X - 30 : MIN_X + 60; w.setPose('happy'); },
    tick(w, a) {
      if (w.goTo(a.x, 'run')) {
        a.laps -= 1;
        addNeeds(w.pet, { fun: 3 });
        a.x = a.x > 400 ? MIN_X + 60 : MAX_X - 30;
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

  // Ball in the owner's hand: a keen dog play-bows, a cat stalks.
  watchBall: {
    label: (w) => w.pet.species === 'cat' ? `${w.pet.name} is eyeing the ball.` : `${w.pet.name} is ready for the throw!`,
    enter(w) { w.stop(); w.setPose(w.pet.species === 'cat' ? 'crouch' : 'playBow'); },
    tick(w, a) {
      w.stop();
      w.face(w.ball.x);
      if (w.pet.species === 'dog' && a.t - (a.lastBark ?? -9) > 3 && w.chance(0.02)) { a.lastBark = a.t; w.vocal('excited', 1); }
      return w.ball.state !== 'drag';
    },
  },

  chase: {
    label: (w) => `${w.pet.name} is chasing the ball!`,
    enter(w) { w.setPose('happy', { mouth: 0.5 }); },
    tick(w, a) {
      const ball = w.ball;
      if (ball.state !== 'air' && ball.state !== 'ground') return true;
      if (a.t > 14) return true;
      const s = w.scale;
      const mouth = w.mouthPoint();

      if (ball.state === 'air') {
        // Leap for a ball coming down nearby; catch it if it reaches the mouth.
        if (Math.hypot(ball.x - mouth.x, ball.y - mouth.y) < 24 * s) { w.pickUp(true, a); return false; }
        const above = mouth.y - ball.y;
        if (w.pet.species === 'dog' && ball.vy > 0 && Math.abs(ball.x - mouth.x) < 50 * s && above > 10 && above < 140 * s) w.hop(330);
        const land = clampX(landingX(ball));
        w.goTo(land - Math.sign(land - w.body.x || 1) * 75 * s, 'run');
        return false;
      }
      // Ball on the floor: run up, lower the head and grab it.
      const side = Math.sign(ball.x - w.body.x || 1);
      const close = Math.abs(ball.x - w.body.x) < 130 * s;
      w.body.target.head = close ? 0.8 : 0;
      if (Math.abs(ball.x - mouth.x) < 34 * s && side === w.body.dir) { w.pickUp(false, a); return false; }
      if (w.goTo(ball.x - side * 85 * s, close ? 'trot' : 'run')) w.face(ball.x);
      return false;
    },
  },

  fetchBack: {
    label: (w) => `${w.pet.name} is bringing the ball back.`,
    enter(w, a) { a.phase = 'go'; },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(w.ownerSpot(), 'trot')) {
          a.phase = 'drop';
          a.from = a.t;
          w.faceOwner();
          w.dropBall(30);
          w.setPose('sit', { wag: 1, ears: 0.9, mouth: 0.6 });
          addNeeds(w.pet, { fun: 8, affection: 2 });
          addBond(w.pet, 0.3);
          w.pet.memory.stats.fetches += 1;
          noteHabit(w.pet, 'fetch');
          w.vocal('happy', 1.2);
        }
        return a.t > 12;
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
      if (p.species === 'cat') w.vocal('content', 1.6);
    },
    tick(w, a, dt) {
      w.stop();
      const p = w.pet;
      if (w.petting) {
        // Stroking feels better than a hand resting still.
        const stroke = Math.min(1, w.petting.stroke / 300);
        addNeeds(p, { affection: (1.6 + stroke * 3.2) * dt, fun: 0.3 * dt });
        addBond(p, (0.015 + stroke * 0.02) * dt);
        if (a.t - (a.lastHeart ?? -1) > 0.9 - stroke * 0.5) { a.lastHeart = a.t; w.emit('heart', 1); }
        if (a.t > a.limit) {
          w.stopPetting();
          w.vocal(p.species === 'cat' ? 'annoyed' : 'content', 1.4);
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

  // Following a treat in the owner's hand. Held high, a pet sits to look up;
  // held at the floor, it lies down. That is how real lure training works.
  lure: {
    label: (w, a) => a.pose === 'sit' ? `${w.pet.name} sat for the treat.`
      : a.pose === 'down' ? `${w.pet.name} lay down for the treat.`
      : `${w.pet.name} is following the treat.`,
    enter(w, a) { a.pose = 'stand'; w.setPose('stand', POSES.beg); },
    tick(w, a) {
      const d = w.drag;
      if (!d || d.item !== 'treat') return true;
      const s = w.scale;
      const side = d.x >= w.body.x ? 1 : -1;
      const near = w.goTo(d.x - side * 42 * s, 'trot') || Math.abs(d.x - w.body.x) < 70 * s;
      if (!near) { a.pose = 'stand'; return false; }
      w.stop();
      w.face(d.x);
      const head = w.headPoint();
      let pose = 'stand';
      if (d.y < head.y - 30 * s) pose = 'sit';
      else if (d.y > GROUND - 40 * s) pose = 'down';
      if (pose !== a.pose) {
        a.pose = pose;
        if (pose === 'sit') w.setPose('sit', { ...POSES.beg, tilt: -0.5 });
        else if (pose === 'down') w.setPose('lie', { head: 0.1, ears: 0.8, wag: 0.6 });
        else w.setPose('stand', POSES.beg);
      }
      // A treat given while in position rewards that position.
      if (pose === 'sit' && w.body.pose.sit > 0.7) w.offerReward('sit', 1.5);
      if (pose === 'down' && w.body.pose.lie > 0.7) w.offerReward('down', 1.5);
      return false;
    },
  },

  floorTreat: {
    label: (w) => `${w.pet.name} found a treat on the floor.`,
    enter(w, a) { a.phase = 'go'; w.setPose('happy'); },
    tick(w, a) {
      const t = w.floorTreat;
      if (!t) return true;
      if (a.phase === 'go') {
        const side = t.x >= w.body.x ? 1 : -1;
        if (w.goTo(t.x - side * 45 * w.scale, 'trot')) { a.phase = 'eat'; a.from = a.t; w.face(t.x); w.setPose('eat'); }
        return a.t > 10;
      }
      w.stop();
      if (a.t - a.from > 0.8 && w.floorTreat) { w.floorTreat = null; w.treatEffects(); w.setPose('stand', { chew: 1, wag: 0.8 }); }
      return a.t - a.from > 2.2;
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
    enter(w) { w.stop(); w.faceOwner(); w.setPose('stand', { tilt: 1, ears: 0.9 }); w.speak('?', 1.5); },
    tick(w, a) { w.stop(); return a.t > 2; },
  },

  come: {
    label: (w) => `${w.pet.name} is coming over.`,
    enter(w, a) { a.phase = 'go'; w.setPose('stand', { wag: 0.8, ears: 0.8 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.scene === 'park' || w.goTo(w.ownerSpot(), 'trot')) {
          a.phase = 'wait';
          a.from = a.t;
          w.faceOwner();
          w.setPose('sit', { wag: 0.9, ears: 0.9 });
          w.offerReward('sit', 4);
        }
        return a.t > 12;
      }
      w.stop();
      return a.t - a.from > 3;
    },
  },

  treat: {
    label: (w) => `${w.pet.name} is munching a treat.`,
    enter(w) { w.stop(); w.setPose(w.body.pose.lie > 0.5 ? 'lie' : 'sit', { chew: 1, wag: 1, eyes: 0.3 }); },
    tick(w, a) { w.stop(); return a.t > 2.2; },
  },

  excited: {
    label: (w) => `${w.pet.name} is excited!`,
    enter(w, a) { w.stop(); w.faceOwner(); w.setPose('happy'); w.vocal('excited', 1.4); a.hops = 0; },
    tick(w, a) {
      w.stop();
      if (w.pet.species === 'dog' && a.t - (a.lastHop ?? -1) > 0.45 && a.hops < 3) { a.lastHop = a.t; a.hops += 1; w.hop(); }
      return a.t > 2.2;
    },
  },

  sulk: {
    label: (w) => `${w.pet.name} is sulking.`,
    enter(w, a) { w.stop(); w.body.dir = w.owner.x > w.body.x ? -1 : 1; w.setPose('lie', POSES.sad); a.dur = w.rand(4, 7); },
    tick(w, a) { w.stop(); return a.t > a.dur; },
  },

  greet: {
    label: (w) => `${w.pet.name} is happy to see you!`,
    enter(w, a) { a.phase = 'go'; w.setPose('happy'); },
    tick(w, a) {
      const dog = w.pet.species === 'dog';
      if (a.phase === 'go') {
        if (w.goTo(w.ownerSpot(), dog ? 'run' : 'walk')) { a.phase = 'hello'; a.from = a.t; w.faceOwner(); w.vocal('greet', 1.6); }
        return a.t > 12;
      }
      w.stop();
      if (dog && a.t - (a.lastHop ?? -1) > 0.5 && a.t - a.from < 2) { a.lastHop = a.t; w.hop(); }
      if (!dog) w.setPose('sit', { tailUp: 1, ears: 0.9 });
      return a.t - a.from > 3;
    },
  },

  // --- Walks: the owner walks, the pet goes along on the leash ---

  leash: {
    label: (w, a) => ({
      walk: `${w.pet.name} is trotting along.`,
      wait: `${w.pet.name} is waiting for you.`,
      sniff: `${w.pet.name} found a very good smell.`,
      squirrel: w.pet.species === 'dog' ? `${w.pet.name} spotted a squirrel!` : `${w.pet.name} is stalking a bird.`,
      flop: `${w.pet.name} flopped down and refuses to move.`,
      tired: `${w.pet.name} is tired. Time to head home?`,
    })[a.phase],
    enter(w, a) {
      const p = w.pet;
      w.setLeash(a, 'walk');
      a.next = w.rand(4, 8);
      // Cats often protest the harness.
      if (p.species === 'cat' && w.chance(0.25 + p.traits.stubborn * 0.4 - p.traits.energy * 0.2)) w.setLeash(a, 'flop', w.rand(4, 7));
    },
    tick(w, a, dt) {
      const p = w.pet;
      const o = w.owner;
      const s = w.scale;
      const moving = o.walkInput !== 0;
      if (moving) {
        addNeeds(p, { fun: 0.12 * dt, affection: 0.04 * dt });
        addBond(p, 0.004 * dt);
      }
      if (a.phase !== 'tired' && p.needs.energy < 12) w.setLeash(a, 'tired', 999);
      const ahead = moving ? o.walkInput : (w.body.x >= o.x ? 1 : -1);
      const tight = w.walk.tension > 0.85;

      switch (a.phase) {
        case 'walk':
        case 'wait': {
          const spot = o.x + ahead * 70 * s;
          if (Math.abs(spot - w.body.x) > 18) {
            if (a.phase === 'wait') w.setLeash(a, 'walk');
            w.goTo(spot, Math.abs(spot - w.body.x) > 90 ? 'run' : 'trot');
          } else {
            w.stop();
            if (!moving && a.phase === 'walk' && a.t > (a.stillSince ?? (a.stillSince = a.t)) + 2.5) w.setLeash(a, 'wait');
          }
          if (moving) a.stillSince = undefined;
          if (moving && a.t > a.next) {
            const r = w.rng();
            if (r < 0.45) w.setLeash(a, 'sniff', w.rand(2, 4));
            else if (r < 0.75) {
              w.setLeash(a, 'squirrel', 2.8);
              w.walk.critter = { x: o.x + ahead * 380, dir: ahead, kind: p.species === 'dog' ? 'squirrel' : 'bird', t: 0 };
            } else a.next = a.t + w.rand(5, 9);
          }
          break;
        }
        case 'sniff':
          w.stop();
          // A firm tug on the leash ends the sniffing.
          a.tug = tight ? (a.tug ?? 0) + dt : 0;
          if (a.t > a.until || a.tug > 0.7) w.setLeash(a, 'walk');
          break;
        case 'squirrel': {
          const c = w.walk.critter;
          if (p.species === 'dog' && c) {
            w.goTo(c.x, 'run');
            if (a.t - (a.lastBark ?? -9) > 0.9) { a.lastBark = a.t; w.vocal('alert', 0.8); }
            addNeeds(p, { fun: 1.5 * dt });
          } else { w.stop(); if (c) w.face(c.x); }
          if (a.t > a.until || !c) w.setLeash(a, 'walk');
          break;
        }
        case 'flop':
          w.stop();
          if (a.t > a.until) w.setLeash(a, w.chance(0.6) ? 'walk' : 'flop', w.rand(3, 6));
          break;
        default:
          w.stop();
      }
      return false;
    },
  },
};

const LEASH_POSES = {
  walk: ['stand', { wag: 0.6, ears: 0.7, tailUp: 0.75 }],
  wait: ['sit', { wag: 0.4, ears: 0.8 }],
  sniff: ['sniff', {}],
  squirrel: ['alert', { mouth: 0.4 }],
  flop: ['lie', { ears: 0.3, wag: 0, tailUp: 0.1 }],
  tired: ['lie', { mouth: 0.6, ears: 0.3 }],
};

export class World {
  constructor(pet, {
    rng = Math.random, clock = () => new Date(), onNote = () => {}, onToast = () => {}, onSound = () => {},
  } = {}) {
    this.pet = pet;
    this.rng = rng;
    this.clock = clock;
    this.onNote = onNote;
    this.onToast = onToast;
    this.onSound = onSound;
    this.time = 0;
    this.scene = 'home';
    this.cam = 0;
    this.scale = petScale(pet);
    this.body = {
      x: 330, dir: 1, vx: 0, speed: 0, gait: 0, wagPhase: 0, jump: 0, jumpV: 0,
      pose: { ...POSES.stand }, target: { ...POSES.stand },
    };
    this.owner = {
      x: 560, dir: -1, vx: 0, speed: 0, phase: 0, crouch: 0, hand: null,
      targetX: null, walkInput: 0, lastMoved: -99, bubble: null,
    };
    this.ball = { state: 'ground', x: 470, y: GROUND - BALL_R, vx: 0, vy: 0, spin: 0 };
    this.drag = null; // { item: 'ball' | 'scoop' | 'treat', x, y, poured }
    this.floorTreat = null;
    this.particles = [];
    this.bubble = null;
    this.petting = null; // { x, y, stroke }
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

  setPose(name, extra = {}) {
    this.body.target = { ...POSES.stand, ...POSES[name], ...extra };
  }

  stop() { this.body.vx = 0; }

  face(x) { if (Math.abs(x - this.body.x) > 2) this.body.dir = x > this.body.x ? 1 : -1; }

  faceOwner() { this.face(this.owner.x); }

  goTo(x, gait = 'walk') {
    const b = this.body;
    const target = this.scene === 'home' ? clampX(x) : x;
    const dx = target - b.x;
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
    return this.body.x > 400 ? MIN_X + 60 : MAX_X - 60;
  }

  // A spot right next to the owner, on whichever side the pet is.
  ownerSpot() {
    const o = this.owner;
    const side = this.body.x < o.x ? -1 : 1;
    const x = o.x + side * 85 * this.scale;
    if (this.scene !== 'home') return x;
    return x < MIN_X || x > MAX_X ? o.x - side * 85 * this.scale : x;
  }

  hop(v = 240) { if (this.body.jump <= 0) this.body.jumpV = v; }

  speak(text, secs = 1.5) { this.bubble = { text, until: this.time + secs }; }

  // A sound the pet makes: shown in a bubble and played out loud.
  vocal(kind, secs = 1.5) {
    const lines = VOICE_LINES[this.pet.species];
    this.speak(lines[kind] ?? lines.happy, secs);
    this.onSound(kind);
  }

  emit(type, count = 1, at = null) {
    const from = at ?? this.headPoint();
    for (let i = 0; i < count; i++) {
      this.particles.push({
        type, x: from.x + this.rand(-8, 8), y: from.y - (at ? 0 : 10),
        vx: this.rand(-12, 12), vy: type === 'crumb' ? this.rand(-40, -10) : type === 'kibble' ? this.rand(10, 60) : this.rand(-38, -24),
        age: 0, life: type === 'crumb' ? 0.7 : type === 'kibble' ? 1.2 : 1.8,
      });
    }
  }

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
  }

  mouthPoint() {
    const h = this.headPoint();
    const s = this.scale;
    return { x: h.x + this.body.dir * 26 * s, y: h.y + 10 * s };
  }

  isAsleep() { return this.activity?.type === 'sleep' && this.activity.phase === 'sleep'; }

  isBusy() { return ['eat', 'chase', 'fetchBack', 'petted', 'trick', 'treat', 'floorTreat'].includes(this.activity.type); }

  offerReward(trick, secs) { this.reward = { trick, until: this.time + secs }; }

  setLeash(a, phase, secs = 0) {
    a.phase = phase;
    a.until = a.t + secs;
    a.next = a.t + this.rand(6, 12);
    const [pose, extra] = LEASH_POSES[phase];
    this.setPose(pose, extra);
  }

  pickUp(inAir, a) {
    this.ball.state = 'mouth';
    this.setPose('happy', { mouth: 0.2 });
    if (inAir) {
      addNeeds(this.pet, { fun: 4 });
      const note = this.milestone('catch', `${this.pet.name} caught the ball in mid-air!`);
      if (note) this.onNote(note);
    }
    this.start(a.retrieve ? 'fetchBack' : 'keepBall');
  }

  dropBall(forward) {
    const b = this.body;
    const mouth = this.mouthPoint();
    this.ball.state = 'air';
    this.ball.x = clampX(mouth.x);
    this.ball.y = Math.min(GROUND - BALL_R, mouth.y);
    this.ball.vx = b.dir * forward;
    this.ball.vy = -60;
  }

  milestone(key, text) {
    const m = this.pet.memory.milestones;
    if (m[key]) return null;
    m[key] = Date.now();
    addJournal(this.pet, text);
    return text;
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
    const ownerMoved = this.time - this.owner.lastMoved < 6;

    const scores = {
      idle: 0.35,
      wander: 0.25 + t.energy * 0.35,
      follow: ownerMoved ? t.cuddly * (cat ? 0.4 : 1.2) + p.bond / 200 : 0,
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
    if (this.floorTreat) scores.floorTreat = 5;
    if (this.lastChoice) scores[this.lastChoice] *= 0.4;

    const entries = Object.entries(scores).filter(([, v]) => v > 0);
    const total = entries.reduce((sum, [, v]) => sum + v * v, 0);
    let r = this.rng() * total;
    let choice = entries[0][0];
    for (const [k, v] of entries) {
      r -= v * v;
      if (r <= 0) { choice = k; break; }
    }
    this.lastChoice = choice;
    this.start(choice);
  }

  // --- learning hooks ---

  wake() {
    if (this.activity.type === 'sleep') this.start('idle');
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

  // --- what the owner's hands can touch ---

  hitTest(x, y) {
    if (this.scene === 'home') {
      if (Math.abs(x - BAG_X) < 28 && y > GROUND - 78 && y < GROUND + 4) return 'bag';
      if (Math.abs(x - JAR_X) < 20 && y > GROUND - 52 && y < GROUND + 4) return 'jar';
    }
    if (this.ballHit(x, y)) return 'ball';
    if (this.petHit(x, y)) return 'pet';
    if (this.scene !== 'home') return 'ground';
    if (y > 296) return 'floor';
    return 'wall';
  }

  petHit(x, y) {
    const s = this.scale;
    const b = this.body;
    const head = this.headPoint();
    const inBody = Math.abs(x - (b.x + b.dir * 10 * s)) < 70 * s && y > GROUND - b.jump - 95 * s && y < GROUND + 6;
    const inHead = Math.hypot(x - head.x, y - head.y) < 34 * s;
    return inBody || inHead;
  }

  ballHit(x, y) {
    const ball = this.ball;
    return this.scene === 'home' && ball.state === 'ground' && Math.hypot(x - ball.x, y - ball.y) < 30;
  }

  shoulder() { return shoulderPoint(this.owner, GROUND); }

  // Keep the owner close enough to reach a point, walking over if needed.
  reachFor(x, y) {
    const o = this.owner;
    o.hand = { x, y };
    const sh = this.shoulder();
    if (Math.hypot(x - sh.x, y - sh.y) > ARM_REACH + 10 && this.scene === 'home') {
      const side = x >= o.x ? 1 : -1;
      o.targetX = Math.min(MAX_X, Math.max(MIN_X, x - side * 70));
    }
  }

  walkOwnerTo(x) {
    if (this.scene !== 'home') return;
    this.owner.targetX = Math.min(MAX_X, Math.max(MIN_X, x));
  }

  grab(item, x, y) {
    if (this.scene !== 'home' && item !== 'treat') return false;
    if (item === 'ball') {
      if (this.ball.state !== 'ground') return false;
      this.ball.state = 'drag';
      this.learnWord('ball');
      const p = this.pet;
      const keen = p.species === 'dog' ? 0.4 + p.traits.playful * 0.6 : p.traits.playful * 0.6;
      if (!this.isAsleep() && !this.isBusy() && p.needs.energy > 20 && this.chance(keen)) this.start('watchBall');
    }
    this.drag = { item, x, y, poured: 0, vx: 0, vy: 0 };
    this.reachFor(x, y);
    if (item === 'treat') this.offerTreat();
    return true;
  }

  dragTo(x, y) {
    if (!this.drag) return;
    this.drag.x = x;
    this.drag.y = y;
    this.reachFor(x, y);
    if (this.drag.item === 'ball') { this.ball.x = x; this.ball.y = y; }
  }

  // Let go of whatever is in hand, with the hand's velocity at release.
  release(vx = 0, vy = 0) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.owner.hand = null;
    if (d.item === 'ball') this.throwFromHand(d.x, d.y, vx, vy);
    if (d.item === 'treat') {
      const mouth = this.mouthPoint();
      if (Math.hypot(d.x - mouth.x, d.y - mouth.y) < 60 * this.scale && !this.isAsleep()) this.handTreat();
      else {
        this.floorTreat = { x: d.x, y: d.y, vy: vy * 0.3 };
        if (this.activity.type === 'lure' || (!this.isAsleep() && !this.isBusy())) this.start('floorTreat');
      }
    }
  }

  throwFromHand(x, y, vx, vy) {
    const ball = this.ball;
    const speed = Math.hypot(vx, vy);
    const max = 1300;
    const k = speed > max ? max / speed : 1;
    ball.state = 'air';
    ball.x = x;
    ball.y = Math.min(y, GROUND - BALL_R);
    ball.vx = vx * k;
    ball.vy = vy * k;
    if (speed < 150) {
      // Just dropped it.
      if (this.activity.type === 'watchBall') this.start('idle');
      return;
    }
    this.reactToThrow(landingX(ball));
  }

  reactToThrow(landX) {
    const p = this.pet;
    if (this.isAsleep() && !this.chance(0.15)) return;
    const t = p.traits;
    const n = p.needs;
    const cat = p.species === 'cat';
    let want = cat ? 0.15 + t.playful * 0.5 : 0.35 + t.playful * 0.55;
    if (this.activity.type === 'watchBall') want += 0.3;
    want *= n.energy < 20 ? 0.3 : 1;
    want += (p.memory.words.ball ?? 0) * 0.15;
    if (!this.chance(want)) {
      this.wake();
      this.face(landX);
      if (this.activity.type === 'watchBall') this.start('idle');
      this.speak(cat ? '…' : VOICE_LINES.dog.content, 1.2);
      return;
    }
    const fetches = p.memory.habits.fetch ?? 0;
    const retrieve = this.chance(cat
      ? 0.04 + Math.min(0.3, fetches * 0.006)
      : 0.5 + p.bond / 250 + Math.min(0.25, fetches * 0.01) - t.stubborn * 0.3);
    this.start('chase', { retrieve });
  }

  // For the keyboard and tests: throw toward a spot on the floor.
  throwBall(targetX) {
    if (this.scene !== 'home') return this.onToast('Save the ball for the living room.');
    if (this.ball.state === 'mouth') return this.onToast(`${this.pet.name} has the ball.`);
    const o = this.owner;
    const tx = clampX(targetX ?? this.rand(MIN_X + 60, MAX_X - 60));
    const x0 = o.x + o.dir * 30;
    const y0 = GROUND - 200;
    const T = 1;
    this.ball.state = 'drag';
    this.throwFromHand(x0, y0, (tx - x0) / T, (GROUND - BALL_R - y0 - 0.5 * GRAVITY * T * T) / T);
  }

  // Pour from the scoop into the bowl while it is held over it.
  pour(dt) {
    const d = this.drag;
    if (!d || d.item !== 'scoop') return;
    const over = Math.abs(d.x - BOWL_X) < 48 && d.y < GROUND - 15 && d.y > GROUND - 220;
    if (!over) return;
    const p = this.pet;
    const portion = portionGrams(p);
    const cap = portion * 2;
    const grams = Math.min((portion / 1.4) * dt, Math.max(0, cap - p.bowlGrams));
    if (this.chance(dt * 25)) this.emit('kibble', 1, { x: d.x + 6, y: d.y + 8 });
    if (grams <= 0) {
      if (!d.full) { d.full = true; this.onToast('The bowl is full.'); }
      return;
    }
    const before = d.poured;
    p.bowlGrams += grams;
    d.poured += grams;
    if (before < 5 && d.poured >= 5) this.fed();
  }

  // Food went in the bowl: the moment a pet learns about.
  fed() {
    const p = this.pet;
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
      if (p.species === 'dog' && p.needs.fullness < 60) this.vocal('excited', 1);
      if (this.activity.type !== 'eat') this.start('eat');
    } else this.onToast(`${p.name} isn't hungry right now. The food will wait in the bowl.`);
  }

  // For the keyboard and tests: pour a full meal at once.
  feed() {
    if (this.scene !== 'home') return this.onToast('The food bowl is at home.');
    const p = this.pet;
    const portion = portionGrams(p);
    if (p.bowlGrams >= portion * 1.5) return this.onToast('The bowl is already full.');
    p.bowlGrams = Math.min(portion * 2, p.bowlGrams + portion);
    this.fed();
  }

  // A treat came out of the jar: interested pets come over to follow it.
  offerTreat() {
    const p = this.pet;
    this.learnWord('treat');
    if (this.isAsleep()) {
      if (this.chance(0.7)) this.wake(); else return;
    }
    if (['eat', 'chase', 'fetchBack'].includes(this.activity.type)) return;
    const interest = p.species === 'dog' ? 0.95 : 0.55 + p.traits.cuddly * 0.3;
    if (this.chance(interest)) this.start('lure');
  }

  treatEffects() {
    const p = this.pet;
    const day = this.now().toDateString();
    const tt = p.memory.treatsToday;
    if (tt.day !== day) { tt.day = day; tt.count = 0; }
    tt.count += 1;
    const plenty = tt.count > 8;
    addNeeds(p, plenty ? { fullness: 1 } : { fullness: 3, affection: 4, fun: 1 });
    if (!plenty) addBond(p, 0.3);
    noteHabit(p, 'treats');
    this.positive();
    if (plenty && tt.count === 9) this.onToast(`${p.name} has had plenty of treats today.`);
  }

  // Treat taken straight from the owner's hand.
  handTreat() {
    this.treatEffects();
    this.rewardIfEarned('treat');
    this.start('treat');
  }

  // For the keyboard and tests: hand over a treat wherever the pet is.
  giveTreat() {
    this.learnWord('treat');
    if (this.isAsleep() && !this.chance(0.8)) { this.treatEffects(); return; }
    this.handTreat();
  }

  startPetting(x, y) {
    this.petting = { x, y, stroke: 0 };
    this.reachFor(x, y);
    noteHabit(this.pet, 'petting');
    this.positive();
    this.rewardIfEarned('praise');
    if (this.activity.type === 'sleep') return; // a sleeping pet just enjoys it
    if (this.activity.type !== 'petted') this.start('petted');
  }

  strokeTo(x, y) {
    const pt = this.petting;
    if (!pt) return;
    pt.stroke += Math.hypot(x - pt.x, y - pt.y);
    pt.x = x;
    pt.y = y;
    this.reachFor(x, y);
  }

  stopPetting() {
    this.petting = null;
    if (!this.drag) this.owner.hand = null;
  }

  say(text) {
    const p = this.pet;
    const u = parseUtterance(text, p.name);
    this.owner.bubble = { text, until: this.time + 2.5 };
    noteHabit(p, 'talk');
    if (u.name) this.hear('name');
    if (u.topic) this.hear(u.topic);

    if (u.praise) {
      addNeeds(p, { affection: 3 });
      this.positive();
      if (!this.rewardIfEarned('praise') && !this.isAsleep()) {
        this.body.target.wag = 1;
        this.vocal('happy', 1);
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
      else if (attentive) {
        this.body.target.ears = 1;
        this.faceOwner();
        if (this.chance(0.5)) this.vocal(p.species === 'cat' ? 'greet' : 'happy', 1);
      }
      return;
    }
    if (u.topic) {
      if (recognises(p, u.topic)) {
        if (u.topic === 'dinner' && this.scene === 'home') this.start('beg');
        else this.start('excited');
      } else if (attentive && this.chance(0.5)) this.start('confused');
    }
  }

  // --- walks ---

  startWalk(place = { id: 'park', kind: 'park' }) {
    if (this.scene === 'park') return;
    const p = this.pet;
    if (this.drag) this.release();
    this.stopPetting();
    if (this.ball.state === 'mouth' || this.ball.state === 'air') { this.ball.state = 'ground'; this.ball.y = GROUND - BALL_R; }
    this.floorTreat = null;
    this.scene = 'park';
    this.walk = { place, distance: 0, startedAt: this.time, critter: null, tension: 0 };
    Object.assign(this.owner, { x: 260, dir: 1, vx: 0, targetX: null, walkInput: 0, hand: null });
    this.body.x = 350;
    this.body.vx = 0;
    this.cam = 0;
    noteHabit(p, 'walks');
    const note = recordRoutine(p, 'walk', this.now());
    if (note) this.onNote(note);
    this.learnWord('walk');
    this.positive();
    this.start('leash');
  }

  setWalkInput(dir) { this.owner.walkInput = this.scene === 'park' ? dir : 0; }

  endWalk() {
    if (this.scene !== 'park') return null;
    const meters = Math.round(this.walk.distance / UNITS_PER_METER);
    const minutes = Math.max(1, Math.round((this.time - this.walk.startedAt) / 60));
    const stats = this.pet.memory.stats;
    stats.walkMeters += meters;
    stats.walks += 1;
    if (stats.walks === 1) addJournal(this.pet, `First walk together: ${meters} m.`);
    this.scene = 'home';
    this.walk = null;
    this.cam = 0;
    Object.assign(this.owner, { x: 560, dir: -1, vx: 0, walkInput: 0, targetX: null });
    this.body.x = 440;
    this.body.vx = 0;
    this.start('idle');
    return { meters, minutes };
  }

  greet() { this.start('greet'); }

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
    if (this.petting) this.petting.stroke *= Math.exp(-dt * 2.5);

    this.moveOwner(dt);
    const done = ACTS[a.type].tick(this, a, dt);
    if (done && this.activity === a) this.next();

    this.moveBody(dt);
    if (this.scene === 'park') this.holdLeash(dt);
    this.pour(dt);
    this.moveBall(dt);
    this.moveFloorTreat(dt);
    this.moveParticles(dt);
    if (this.bubble && this.time > this.bubble.until) this.bubble = null;
    if (this.owner.bubble && this.time > this.owner.bubble.until) this.owner.bubble = null;
    if (this.reward && this.time > this.reward.until) this.reward = null;
  }

  moveOwner(dt) {
    const o = this.owner;
    if (this.scene === 'park') {
      const resisting = this.walk.tension > 0.8 && ['flop', 'sniff'].includes(this.activity.phase) && Math.sign(this.body.x - o.x) !== o.walkInput;
      o.vx = o.walkInput * OWNER_WALK_SPEED * (resisting ? 0.45 : 1);
      if (o.walkInput) o.dir = o.walkInput;
      this.walk.distance += Math.abs(o.vx * dt);
    } else if (o.targetX !== null) {
      const dx = o.targetX - o.x;
      if (Math.abs(dx) < 4) { o.targetX = null; o.vx = 0; } else {
        o.vx = Math.sign(dx) * Math.min(OWNER_SPEED, Math.abs(dx) * 4);
        o.dir = Math.sign(dx);
      }
    } else o.vx = 0;
    o.x += o.vx * dt;
    if (this.scene === 'home') o.x = Math.min(MAX_X, Math.max(MIN_X, o.x));
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
  }

  // The leash keeps the pet and owner within reach of each other. A lunging
  // dog pulls its owner along; otherwise the owner tows the pet.
  holdLeash(dt) {
    const o = this.owner;
    const b = this.body;
    const d = b.x - o.x;
    const dist = Math.abs(d);
    if (dist > LEASH) {
      const excess = dist - LEASH;
      const lunging = this.activity.phase === 'squirrel' && this.pet.species === 'dog';
      if (lunging) o.x += Math.sign(d) * excess * 0.6;
      b.x = o.x + Math.sign(d) * LEASH;
    }
    this.walk.tension = Math.min(1, Math.max(0, (Math.abs(b.x - o.x) - (LEASH - 40)) / 40));
    const c = this.walk.critter;
    if (c) {
      c.t += dt;
      const fleeing = Math.abs(c.x - b.x) < 260 || c.t > 1;
      c.x += c.dir * (c.kind === 'squirrel' ? 150 : 70) * dt * (fleeing ? 1.6 : 0.2);
      if (c.t > 5) this.walk.critter = null;
    }
  }

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
  }

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
  }

  moveFloorTreat(dt) {
    const t = this.floorTreat;
    if (!t) return;
    if (t.y < GROUND - 4) {
      t.vy += GRAVITY * dt;
      t.y = Math.min(GROUND - 4, t.y + t.vy * dt);
    }
  }

  moveParticles(dt) {
    for (const pt of this.particles) {
      pt.age += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      if (pt.type === 'crumb' || pt.type === 'kibble') pt.vy += 600 * dt;
      if (pt.type === 'kibble' && pt.y > GROUND - 14) { pt.y = GROUND - 14; pt.vy = 0; pt.vx = 0; }
    }
    this.particles = this.particles.filter((pt) => pt.age < pt.life);
  }
}
