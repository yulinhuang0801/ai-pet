import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPet, tickNeeds, catchUp, serialize, deserialize, mood } from '../src/pet.js';
import { reinforce, trickChance, associate, recognises, recordRoutine, expects } from '../src/learning.js';
import { parseUtterance } from '../src/commands.js';
import { World } from '../src/world.js';

const dog = () => createPet({ name: 'Mochi', species: 'dog' }, 0);
const cat = () => createPet({ name: 'Miso', species: 'cat' }, 0);

test('needs fall while awake and energy returns while asleep', () => {
  const pet = dog();
  const before = { ...pet.needs };
  tickNeeds(pet, 3600, 'rest');
  assert.ok(pet.needs.fullness < before.fullness);
  assert.ok(pet.needs.fun < before.fun);
  const tired = pet.needs.energy;
  tickNeeds(pet, 1800, 'sleep');
  assert.ok(pet.needs.energy > tired);
});

test('a hungry pet reports being hungry', () => {
  const pet = dog();
  pet.needs.fullness = 10;
  assert.equal(mood(pet).id, 'hungry');
});

test('catching up eats food left in the bowl', () => {
  const pet = dog();
  pet.bowlGrams = 180;
  pet.lastSeen = 0;
  const away = catchUp(pet, 10 * 3600 * 1000);
  assert.equal(pet.bowlGrams, 0);
  assert.ok(away.ate > 0);
  assert.match(away.text, /10 hours/);
});

test('save and load round trip', () => {
  const pet = dog();
  pet.memory.tricks.sit = 0.5;
  const loaded = deserialize(serialize(pet));
  assert.equal(loaded.name, 'Mochi');
  assert.equal(loaded.memory.tricks.sit, 0.5);
  assert.equal(deserialize('{"version":0}'), null);
});

test('rewards make tricks more reliable and write milestones', () => {
  const pet = dog();
  const start = trickChance(pet, 'sit');
  const notes = [];
  for (let i = 0; i < 12; i++) {
    const n = reinforce(pet, 'sit', 'treat', i);
    if (n) notes.push(n);
  }
  assert.ok(trickChance(pet, 'sit') > start + 0.4);
  assert.ok(notes.some((n) => n.includes('knows')));
});

test('cats learn more slowly than eager dogs', () => {
  const d = dog();
  const c = cat();
  for (let i = 0; i < 5; i++) { reinforce(d, 'paw', 'treat'); reinforce(c, 'paw', 'treat'); }
  assert.ok(d.memory.tricks.paw > c.memory.tricks.paw);
});

test('words are learned by association', () => {
  const pet = dog();
  assert.equal(recognises(pet, 'walk'), false);
  for (let i = 0; i < 4; i++) associate(pet, 'walk');
  assert.equal(recognises(pet, 'walk'), true);
});

test('routines form after a few days at the same hour', () => {
  const pet = dog();
  const at = (day) => new Date(2026, 0, day, 18, 5);
  assert.equal(expects(pet, 'feed', at(1)), 0);
  for (let d = 1; d <= 5; d++) recordRoutine(pet, 'feed', at(d));
  assert.ok(expects(pet, 'feed', at(6)) > 0.5);
  assert.ok(pet.memory.journal[0].text.includes('6 PM'));
});

test('parses cues, names and tone', () => {
  const u = parseUtterance('Mochi, sit!', 'Mochi');
  assert.equal(u.name, true);
  assert.equal(u.trick, 'sit');
  assert.equal(parseUtterance('sit down', 'x').trick, 'sit');
  assert.equal(parseUtterance('lie down', 'x').trick, 'down');
  assert.equal(parseUtterance('good girl!', 'x').praise, true);
  assert.equal(parseUtterance('no! bad dog', 'x').scold, true);
  assert.equal(parseUtterance('want to go for a walk?', 'x').topic, 'walk');
});

test('the world runs for a simulated day without errors', () => {
  let seed = 1;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const pet of [dog(), cat()]) {
    const w = new World(pet, { rng, clock: () => new Date(2026, 0, 1, 15) });
    for (let i = 0; i < 24 * 3600 / 2; i++) {
      w.update(0.1);
      if (i % 4000 === 0) w.feed();
      if (i % 3000 === 0) w.throwBall();
      if (i % 5000 === 0) w.say(`${pet.name}, sit`);
    }
    w.startWalk();
    for (let i = 0; i < 600; i++) w.update(0.1);
    const walk = w.endWalk();
    assert.ok(walk.meters >= 0);
    for (const v of Object.values(pet.needs)) assert.ok(v >= 0 && v <= 100);
    assert.ok(Number.isFinite(w.body.x));
  }
});

test('feeding a hungry pet sends it to the bowl', () => {
  const pet = dog();
  pet.needs.fullness = 30;
  const w = new World(pet, { rng: () => 0.5 });
  w.feed();
  assert.equal(w.activity.type, 'eat');
  for (let i = 0; i < 400; i++) w.update(0.1);
  assert.ok(pet.needs.fullness > 60);
  assert.equal(pet.memory.stats.meals, 1);
});

test('a flung ball flies, bounces and comes to rest on the floor', () => {
  const w = new World(dog(), { rng: () => 0.99 });
  w.grab('ball', 500, 250);
  w.dragTo(520, 240);
  w.release(600, -400);
  assert.equal(w.ball.state, 'air');
  let maxX = 0;
  let minY = Infinity;
  for (let i = 0; i < 400; i++) {
    w.update(0.02);
    maxX = Math.max(maxX, w.ball.x);
    minY = Math.min(minY, w.ball.y);
  }
  assert.ok(minY < 240, 'ball rises after an upward fling');
  assert.ok(w.ball.x < 800 && w.ball.x > 0, 'walls keep the ball in the room');
  assert.ok(['ground', 'mouth'].includes(w.ball.state));
});

test('pouring from the scoop fills the bowl only while over it', () => {
  const pet = dog();
  const w = new World(pet, { rng: () => 0.5 });
  w.grab('scoop', 40, 340);
  w.dragTo(400, 250);
  w.update(1);
  assert.equal(pet.bowlGrams, 0);
  w.dragTo(150, 320);
  for (let i = 0; i < 20; i++) w.update(0.05);
  assert.ok(pet.bowlGrams > 50);
  w.release();
  assert.equal(w.drag, null);
});

test('a treat held high lures a sit, and handing it over teaches sit', () => {
  const pet = dog();
  const w = new World(pet, { rng: () => 0.1 });
  w.body.x = 400;
  w.grab('treat', 470, 200);
  assert.equal(w.activity.type, 'lure');
  for (let i = 0; i < 60; i++) { w.dragTo(470, 200); w.update(0.05); }
  assert.ok(w.body.pose.sit > 0.7);
  const before = pet.memory.tricks.sit;
  const mouth = w.mouthPoint();
  w.dragTo(mouth.x, mouth.y);
  w.release();
  assert.ok(pet.memory.tricks.sit > before);
  assert.equal(w.activity.type, 'treat');
});

test('on a walk the leash keeps the pet within reach', () => {
  const pet = dog();
  const w = new World(pet, { rng: () => 0.5 });
  w.startWalk();
  w.setWalkInput(1);
  for (let i = 0; i < 400; i++) {
    w.update(0.05);
    assert.ok(Math.abs(w.body.x - w.owner.x) <= 171);
  }
  assert.ok(w.walk.distance > 1000);
  const r = w.endWalk();
  assert.ok(r.meters > 20);
  assert.equal(w.scene, 'home');
});
