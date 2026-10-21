// The simulation: what the pet is doing, how it decides what to do next, and
// how it reacts to what the owner does. Everything here is plain data that a
// renderer draws each frame.
//
// Behaviour never works with coordinates directly. Where things are and how
// they move is the job of a space (space-side.js for the side-on room), mixed
// into World at the bottom of this file. Activities ask the space questions
// such as approach('bowl'), near(ball, 130) or heldHigh(treat), so a 3D space
// can be swapped in without touching the behaviour. See docs/architecture.md.

import {
  tickNeeds, addNeeds, portionGrams, sizeScale, mood, addJournal,
} from './pet.js';
import {
  trickChance, reinforce, associate, recognises, recordRoutine, expects,
  noteHabit, TRICKS,
} from './learning.js';
import { earn, addHearts, unlocked, today } from './bond.js';
import { pickFind, collect, findById } from './finds.js';
import { parseUtterance } from './commands.js';
import { LANDMARKS } from './route.js';
import { sideSpace } from './space-side.js';
import { mapSpace } from './space-map.js';

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

const article = (name) => `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name.toLowerCase()}`;

// Everything the behaviour asks of a space. A space (space-side.js today, a
// 3D room one day) must provide all of these; a test checks it.
export const SPACE_CONTRACT = [
  // layout
  'placeAtHome', 'placeForWalk', 'placeBackHome',
  // moving and facing
  'goTo', 'approach', 'stop', 'face', 'faceOwner', 'faceAway', 'turnAround', 'near',
  // places
  'placeOf', 'wanderSpot', 'farSide', 'ownerSpot', 'sideOfOwner', 'besideOwner',
  // the pet's head
  'headPoint', 'mouthPoint', 'atMouth', 'heldHigh', 'heldLow',
  // the ball, treats and food
  'ballLanding', 'canGrab', 'shouldLeap', 'dropBall', 'batBall', 'launchBall', 'lobBallTo', 'dropTreat', 'overBowl',
  // the owner's hands
  'hitTest', 'reachFor', 'walkOwnerTo', 'walkDirToward',
  // walks
  'walkedMeters', 'spawnFind', 'scheduleFind', 'spawnCritter', 'routeMeters', 'biomeHere', 'landmarkAhead',
  // each step
  'moveOwner', 'holdLeash', 'moveBody', 'moveBall', 'moveFloorTreat', 'moveParticles',
];

const isNight = (date) => date.getHours() >= 22 || date.getHours() < 6;

// Each activity: label (status line), enter, tick, optional exit.
// tick returns true when finished; it may also start another activity.
const ACTS = {
  idle: {
    label: (w) => `${w.pet.name} is looking around.`,
    enter(w, a) { a.dur = w.rand(3, 7); a.turnAt = w.rand(1, a.dur); w.setPose('stand'); },
    tick(w, a) {
      w.stop();
      if (a.turnAt && a.t > a.turnAt) { w.turnAround(); a.turnAt = 0; }
      return a.t > a.dur;
    },
  },

  wander: {
    label: (w) => `${w.pet.name} is pottering around.`,
    enter(w, a) { a.spot = w.wanderSpot(120); w.setPose('stand', { wag: 0.25 }); },
    tick(w, a) { return w.goTo(a.spot, 'walk'); },
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
    enter(w, a) { a.spot = w.wanderSpot(60); a.phase = 'go'; w.setPose('stand', { head: 0.5 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(a.spot, 'walk')) { a.phase = 'sniff'; a.until = a.t + w.rand(2, 4); w.setPose('sniff'); }
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
    enter(w, a) {
      a.phase = w.scene === 'home' ? 'go' : 'settle';
      a.settleAt = 0;
      // Best friends sometimes curl up at your feet instead of in their bed.
      a.atFeet = unlocked(w.pet, 'nap') && w.chance(0.5);
      w.setPose('stand');
    },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(a.atFeet ? w.ownerSpot() : w.placeOf('bed'), 'walk')) a.phase = 'settle';
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
        if (w.approach('bowl', 48, 'trot')) { a.phase = 'eat'; w.setPose('eat'); }
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
        if (w.approach('bowl', 55, 'walk')) { a.phase = 'wait'; a.from = a.t; w.faceOwner(); w.setPose('sit', { ears: 0.9, tilt: 0.4 }); }
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
    enter(w, a) { a.laps = Math.round(w.rand(3, 5)); a.spot = w.farSide(); w.setPose('happy'); },
    tick(w, a) {
      if (w.goTo(a.spot, 'run')) {
        a.laps -= 1;
        addNeeds(w.pet, { fun: 3 });
        a.spot = w.farSide(a.spot);
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
      if (ball.state === 'air') { w.stop(); w.face(ball); return false; }
      if (w.approach(ball, 26, 'trot')) {
        w.batBall();
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
      w.face(w.ball);
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
      if (ball.state === 'air') {
        // Leap for a ball coming down nearby; catch it if it reaches the mouth.
        if (w.atMouth(ball, 24)) { w.pickUp(true, a); return false; }
        if (w.pet.species === 'dog' && w.shouldLeap(ball)) w.hop(330);
        w.approach(w.ballLanding(), 75, 'run');
        return false;
      }
      // Ball on the floor: run up, lower the head and grab it.
      const close = w.near(ball, 130);
      w.body.target.head = close ? 0.8 : 0;
      if (w.canGrab(ball)) { w.pickUp(false, a); return false; }
      w.approach(ball, 85, close ? 'trot' : 'run');
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
          w.earn('play', 1);
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
        w.earn('pet', dt * (0.6 + stroke * 0.8));
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
      const near = w.approach(d, 42, 'trot') || w.near(d, 70);
      if (!near) { a.pose = 'stand'; return false; }
      w.stop();
      w.face(d);
      let pose = 'stand';
      if (w.heldHigh(d)) pose = 'sit';
      else if (w.heldLow(d)) pose = 'down';
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
        if (w.approach(t, 45, 'trot')) { a.phase = 'eat'; a.from = a.t; w.setPose('eat'); }
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
      if (a.trick === 'spin' && a.t < 1.2 && a.t - (a.lastFlip ?? -1) > 0.3) { a.lastFlip = a.t; w.turnAround(); w.hop(140); }
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
    enter(w, a) { w.stop(); w.faceAway(w.owner); w.setPose('lie', POSES.sad); a.dur = w.rand(4, 7); },
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

  gift: {
    label: (w) => `${w.pet.name} brought you something.`,
    enter(w, a) { a.phase = 'go'; w.setPose('happy', { mouth: 0.2 }); },
    tick(w, a) {
      if (a.phase === 'go') {
        if (w.goTo(w.ownerSpot(), 'trot')) {
          a.phase = 'give';
          a.from = a.t;
          w.faceOwner();
          w.setPose('sit', { wag: 1, ears: 0.9 });
          w.giveGift(a.item);
        }
        return a.t > 12;
      }
      w.stop();
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
      found: `${w.pet.name} is sniffing out something.`,
      visit: a.landmark ? visitLabel(w.pet.name, a.landmark) : `${w.pet.name} is exploring.`,
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
      const moving = o.walkInput !== 0;
      if (moving) {
        addNeeds(p, { fun: 0.12 * dt, affection: 0.04 * dt });
      }
      if (a.phase !== 'tired' && p.needs.energy < 12) w.setLeash(a, 'tired', 999);
      const f = w.walk.find;
      if (f && (a.phase === 'walk' || a.phase === 'wait') && w.near(f, 185)) w.setLeash(a, 'found');
      // Landmarks on a real route get checked out on the way past.
      if (a.phase === 'walk' && moving) {
        const lm = w.landmarkAhead();
        if (lm) { w.walk.visited.add(lm.d); a.landmark = lm; w.setLeash(a, 'visit'); }
      }
      const ahead = moving ? o.walkInput : w.sideOfOwner();
      const tight = w.walk.tension > 0.85;

      switch (a.phase) {
        case 'walk':
        case 'wait': {
          const spot = w.besideOwner(ahead, 70);
          if (!w.near(spot, 14)) {
            if (a.phase === 'wait') w.setLeash(a, 'walk');
            w.goTo(spot, w.near(spot, 70) ? 'trot' : 'run');
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
              w.spawnCritter(ahead);
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
            w.goTo(c, 'run');
            if (a.t - (a.lastBark ?? -9) > 0.9) { a.lastBark = a.t; w.vocal('alert', 0.8); }
            addNeeds(p, { fun: 1.5 * dt });
          } else { w.stop(); if (c) w.face(c); }
          if (a.t > a.until || !c) w.setLeash(a, 'walk');
          break;
        }
        case 'found': {
          if (!f) { w.setLeash(a, 'walk'); break; }
          if (a.sniffFrom === undefined) {
            if (w.approach(f, 80, 'trot')) { a.sniffFrom = a.t; w.setPose('sniff'); }
          } else {
            w.stop();
            if (a.t - a.sniffFrom > 1.4) { w.pickUpFind(); w.setLeash(a, 'walk'); }
          }
          break;
        }
        case 'visit': {
          const lm = a.landmark;
          if (a.sniffFrom === undefined) {
            if (w.approach(lm, 40, 'trot') || a.t > 4) {
              a.sniffFrom = a.t;
              w.reactToLandmark(lm);
            }
          } else {
            w.stop();
            if (a.t - a.sniffFrom > 2.6) w.setLeash(a, 'walk');
          }
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

// What the status line says while the pet checks out a landmark.
function visitLabel(name, lm) {
  const place = lm.name ? `${LANDMARKS[lm.kind].label.replace(/^an? /, 'the ')} (${lm.name})` : LANDMARKS[lm.kind].label;
  return {
    dog_park: `${name} is thrilled about the dog park!`,
    playground: `${name} is watching the playground.`,
    cafe: `${name} is hoping for crumbs at ${place}.`,
    restaurant: `${name} is sniffing the air outside ${place}.`,
    ice_cream: `${name} is staring at ${place}.`,
    fountain: `${name} is checking out ${place}.`,
    drinking_water: `${name} is having a drink.`,
    bench: `${name} is sniffing around ${place}.`,
    shop: `${name} is peering into ${place}.`,
  }[lm.kind] ?? `${name} is exploring.`;
}

const LEASH_POSES = {
  visit: ['sniff', {}],
  found: ['stand', { ears: 1, wag: 0.9, head: 0.35 }],
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
    this.space = sideSpace;
    this.cam = 0;
    this.scale = petScale(pet);
    this.body = {
      x: 0, dir: 1, vx: 0, speed: 0, gait: 0, wagPhase: 0, jump: 0, jumpV: 0,
      pose: { ...POSES.stand }, target: { ...POSES.stand },
    };
    this.owner = {
      x: 0, dir: -1, vx: 0, speed: 0, phase: 0, crouch: 0, hand: null,
      targetX: null, walkInput: 0, lastMoved: -99, bubble: null,
    };
    this.ball = { state: 'ground', x: 0, y: 0, vx: 0, vy: 0, spin: 0 };
    this.drag = null; // { item: 'ball' | 'scoop' | 'treat', x, y, poured }
    this.floorTreat = null;
    this.particles = [];
    this.bubble = null;
    this.petting = null; // { x, y, stroke }
    this.reward = null;
    this.heard = {};
    this.walk = null;
    this.shownGift = null; // a gift lying at the owner's feet
    this.activity = null;
    this.placeAtHome();
    this.start('idle');
  }

  // --- helpers used by activities ---
  now() { return this.clock(); }
  rand(a, b) { return a + (b - a) * this.rng(); }
  chance(p) { return this.rng() < p; }

  setPose(name, extra = {}) {
    this.body.target = { ...POSES.stand, ...POSES[name], ...extra };
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

  isAsleep() { return this.activity?.type === 'sleep' && this.activity.phase === 'sleep'; }

  isBusy() { return ['eat', 'chase', 'fetchBack', 'petted', 'trick', 'treat', 'floorTreat'].includes(this.activity.type); }

  offerReward(trick, secs) { this.reward = { trick, until: this.time + secs }; }

  setLeash(a, phase, secs = 0) {
    a.phase = phase;
    a.sniffFrom = undefined;
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
    // Only fetching and keeping the ball involve carrying it; anything else
    // that interrupts means the pet lets go.
    if (this.ball.state === 'mouth' && type !== 'fetchBack' && type !== 'keepBall') this.dropBall(20);
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
      this.earn('train', 1);
      this.reward = null;
      return true;
    }
    return false;
  }

  positive() {
    this.learnWord('name');
  }

  // Hearts for time spent together; announces a new bond level.
  earn(kind, amount) {
    const note = earn(this.pet, kind, amount, this.now());
    if (note) this.onNote(note);
  }

  // --- what the owner's hands do ---

  grab(item, x, y) {
    if (this.scene !== 'home' && item !== 'treat') return false;
    if (item === 'ball') {
      if (this.ball.state === 'mouth') {
        // Taking the ball from the pet's mouth: it lets go and gets ready to chase.
        this.ball.state = 'drag';
        this.start('idle');
      }
      if (this.ball.state !== 'ground' && this.ball.state !== 'drag') return false;
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
      if (this.atMouth(d, 60) && !this.isAsleep()) this.handTreat();
      else {
        this.dropTreat(d, vy);
        if (this.activity.type === 'lure' || (!this.isAsleep() && !this.isBusy())) this.start('floorTreat');
      }
    }
  }

  throwFromHand(x, y, vx, vy) {
    if (!this.launchBall(x, y, vx, vy)) {
      // Just dropped it.
      if (this.activity.type === 'watchBall') this.start('idle');
      return;
    }
    this.reactToThrow(this.ballLanding());
  }

  reactToThrow(landing) {
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
      this.face(landing);
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
    if (this.ball.state === 'mouth') this.start('idle'); // asks the pet to let go
    const t = this.lobBallTo(targetX);
    this.ball.state = 'drag';
    this.throwFromHand(t.x, t.y, t.vx, t.vy);
  }

  // Pour from the scoop into the bowl while it is held over it.
  pour(dt) {
    const d = this.drag;
    if (!d || d.item !== 'scoop') return;
    if (!this.overBowl(d)) return;
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
    this.earn('meal', 1);
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
      addHearts(p, -0.3);
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
    this.floorTreat = null;
    this.scene = 'park';
    this.walk = {
      place, distance: 0, startedAt: this.time, critter: null, tension: 0,
      find: null, nextFindAt: 0, offLeash: false,
      route: place.route ?? null, area: place.area ?? null, visited: new Set(), arrived: false,
    };
    // A route with its map is walked from above; anywhere else, side-on.
    this.space = place.route?.map || place.area ? mapSpace : sideSpace;
    this.scheduleFind(70, 140);
    this.placeForWalk();
    noteHabit(p, 'walks');
    const note = recordRoutine(p, 'walk', this.now());
    if (note) this.onNote(note);
    this.learnWord('walk');
    this.positive();
    this.start('leash');
  }

  setWalkInput(dir) {
    const o = this.owner;
    o.walkInput = this.scene === 'park' ? dir : 0;
    o.steer = null;
    o.goal = null;
  }

  // On a map walk you can also leave the route: walk in a direction (x, y)
  // while it's held, or walk to a spot.
  steer(x, y) {
    if (this.scene !== 'park') return;
    const o = this.owner;
    o.goal = null;
    o.steer = x || y ? { x, y } : null;
    o.walkInput = o.steer ? 1 : 0;
  }

  walkToward(point) {
    if (this.scene !== 'park') return;
    const o = this.owner;
    o.steer = null;
    o.goal = point ? { x: point.x, y: point.y } : null;
    o.walkInput = point ? 1 : 0;
  }

  // Walk or jog.
  setJog(on) { this.owner.jog = on; }

  endWalk() {
    if (this.scene !== 'park') return null;
    const meters = Math.round(this.walkedMeters());
    const minutes = Math.max(1, Math.round((this.time - this.walk.startedAt) / 60));
    const stats = this.pet.memory.stats;
    stats.walkMeters += meters;
    stats.walks += 1;
    if (stats.walks === 1) addJournal(this.pet, `First walk together: ${meters} m.`);
    this.scene = 'home';
    this.walk = null;
    this.owner.jog = false;
    this.space = sideSpace;
    this.placeBackHome();
    this.start('idle');
    return { meters, minutes };
  }

  // How the pet takes in a landmark on a real route.
  reactToLandmark(lm) {
    const p = this.pet;
    if (lm.kind === 'dog_park') {
      this.setPose('happy');
      this.vocal('excited', 1.2);
      this.hop();
      addNeeds(p, { fun: 6 });
    } else if (lm.kind === 'drinking_water' || lm.kind === 'fountain') {
      this.setPose('eat');
      addNeeds(p, { energy: 2 });
    } else if (['cafe', 'restaurant', 'ice_cream'].includes(lm.kind)) {
      this.setPose('sit', { tilt: -0.4, ears: 0.9 });
      if (p.species === 'dog') this.vocal('beg', 1.2);
    } else if (lm.kind === 'bench' || lm.kind === 'playground') {
      this.setPose('sit', { ears: 0.8 });
    } else this.setPose('sniff');
    addNeeds(p, { fun: 2 });
  }

  // The owner reached the end of a real route.
  reachedRouteEnd() {
    const w = this.walk;
    const name = w.place.name ?? 'your route';
    addNeeds(this.pet, { fun: 6, affection: 3 });
    this.vocal('happy', 1.4);
    const note = this.milestone(`route:${w.place.id}`, `Walked all of ${name} together (${w.route.length} m).`);
    if (note) this.onNote(note);
    else this.onToast(`You made it to the end of ${name}.`);
  }

  greet() {
    if (!this.maybeGift()) this.start('greet');
  }

  setOffLeash(on) {
    if (!this.walk || !unlocked(this.pet, 'offLeash')) return false;
    this.walk.offLeash = on;
    return true;
  }

  pickUpFind() {
    const w = this.walk;
    const f = w.find;
    if (!f) return;
    w.find = null;
    this.scheduleFind(120, 260);
    const first = collect(this.pet, f.item.id, w.place.name ?? 'The park');
    this.vocal('happy', 1);
    const text = `${this.pet.name} found ${article(f.item.name)}!`;
    if (first) {
      addJournal(this.pet, `First find of its kind: ${f.item.name.toLowerCase()}, on a walk at ${w.place.name ?? 'the park'}.`);
      this.onNote(text);
    } else this.onToast(text);
  }

  // Once a day, a pet that counts you as a friend brings you something.
  maybeGift() {
    const p = this.pet;
    if (this.scene !== 'home' || this.isAsleep() || !unlocked(p, 'spin')) return false;
    if (p.memory.lastGiftDay === today(this.now())) return false;
    const owned = Object.keys(p.memory.finds);
    const item = owned.length && this.chance(0.6) ? findById(owned[Math.floor(this.rng() * owned.length)]) : pickFind(p.species, this.rng);
    this.start('gift', { item });
    return true;
  }

  giveGift(item) {
    const p = this.pet;
    p.memory.lastGiftDay = today(this.now());
    collect(p, item.id, 'A gift');
    this.shownGift = { id: item.id, ...this.mouthPoint(), until: this.time + 8 };
    this.vocal('greet', 1.4);
    const text = `${p.name} brought you ${article(item.name)}.`;
    if (this.milestone('gift', `${p.name} brought you a gift for the first time: ${item.name.toLowerCase()}.`)) this.onNote(text);
    else this.onToast(text);
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
    if (this.shownGift && this.time > this.shownGift.until) this.shownGift = null;
  }
}

// Where things are and how they move. Each method asks the space the world
// is in right now: the side-on room, or a real route seen from above.
for (const name of Object.keys(sideSpace)) {
  World.prototype[name] = function (...args) { return this.space[name].apply(this, args); };
}
