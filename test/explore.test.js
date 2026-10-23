// Walking from a pinned spot: the map loads around you in squares, and the
// walk stands on blocks built from it. Hand-made map data in Overpass format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Explorer, TILE, tileBox } from '../src/explore.js';
import { walkable } from '../src/blocks.js';
import { World } from '../src/world.js';
import { createPet } from '../src/pet.js';
import { MAP_UNITS_PER_METER as U } from '../src/space-map.js';

const LAT = 40.67;
const LON = -73.98;
const kLon = 1 / (111320 * Math.cos((LAT * Math.PI) / 180));
// Metres east and south of the pin, as OSM coordinates.
const at = (x, y) => ({ lat: LAT - y / 111320, lon: LON + x * kLon });
const box = (x0, y0, x1, y1) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

// A street running east past the pin, a house just north of it, and a café.
const osm = {
  elements: [
    { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [at(-300, 2), at(600, 2)] },
    { type: 'way', id: 2, tags: { building: 'house' }, geometry: box(20, -20, 32, -8) },
    { type: 'node', id: 3, tags: { amenity: 'cafe', name: 'Corner Café' }, ...at(40, 8) },
  ],
};

function explorer() {
  const asked = [];
  const ex = new Explorer([LAT, LON], { fetchArea: async (box) => { asked.push(box); return osm; } });
  return { ex, asked };
}

async function loadAround(ex, x, y) {
  for (let i = 0; i < 10; i++) {
    const p = ex.update(x, y);
    if (!p) break;
    await p;
  }
}

test('the map loads in squares around you, nearest first', async () => {
  const { ex, asked } = explorer();
  await ex.update(10, 10);
  assert.equal(asked.length, 1, 'one square to start: the one centred on the pin');
  assert.ok(ex.ready(10, 10), 'the square you start in');
  assert.ok(ex.ready(-100, 100), 'which reaches out all round the pin');
  assert.ok(!ex.ready(10 + TILE, 10), 'not the next one yet');
  await loadAround(ex, 10, 10);
  assert.ok(ex.ready(-10, -10), 'squares within reach of you load too');
  assert.ok(!ex.ready(10 + 2 * TILE, 10), 'but not far ones');
  // Walk east to the edge of the second square: the third loads.
  await loadAround(ex, 2 * TILE - 50, 10);
  assert.ok(ex.ready(2 * TILE + 10, 10));
});

test('loaded squares become blocks, with the landmarks in them', async () => {
  const { ex } = explorer();
  await loadAround(ex, 0, 0);
  const blocks = ex.area.blocks;
  assert.ok(!walkable(blocks, 26, -14), 'the house is solid');
  assert.ok(walkable(blocks, 10, 2), 'the street is not');
  assert.ok(!walkable(blocks, 10, 5 * TILE), 'nor is anywhere not loaded yet');
  assert.equal(ex.area.landmarks.filter((l) => l.kind === 'cafe').length, 1, 'the café, once');
  assert.ok(ex.area.version > 0);
});

test('a failed square is tried again later', async () => {
  let now = 0;
  let fail = true;
  const ex = new Explorer([LAT, LON], { now: () => now, fetchArea: async () => { if (fail) throw new Error('busy'); return osm; } });
  // The pin is in the middle of the first square, the only one within reach of it.
  const mid = 0;
  await ex.update(mid, mid);
  assert.ok(!ex.ready(mid, mid));
  fail = false;
  assert.equal(ex.update(mid, mid), null, 'not straight away');
  now = 30000;
  await ex.update(mid, mid);
  assert.ok(ex.ready(mid, mid));
});

test('walking from a pin: the arrow keys take you anywhere, but not through the house', async () => {
  const { ex } = explorer();
  await loadAround(ex, 0, 0);
  const pet = createPet({ name: 'Mochi', species: 'dog' }, 0);
  let seed = 9;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const w = new World(pet, { rng, clock: () => new Date(2026, 0, 9, 12) });
  w.startWalk({ id: 's1', kind: 'spot', name: 'The corner', area: ex.area });
  assert.ok(w.walk.blocks === ex.area.blocks, 'walking on the explored blocks');
  // East along the street.
  w.steer(1, 0);
  for (let i = 0; i < 200; i++) w.update(0.05);
  assert.ok(w.owner.x / U > 12, `walked east (${(w.owner.x / U).toFixed(1)} m)`);
  assert.ok(w.walkedMeters() > 12);
  // Then north, into the house.
  w.steer(0, -1);
  let inside = 0;
  for (let i = 0; i < 300; i++) {
    w.update(0.05);
    if (!walkable(ex.area.blocks, w.owner.x / U, w.owner.y / U) || !walkable(ex.area.blocks, w.body.x / U, w.body.y / U)) inside++;
  }
  assert.equal(inside, 0, 'you and your pet stayed out of the house');
  w.steer(0, 0);
  const end = w.endWalk();
  assert.ok(end.meters > 12);
});

test('a pin dropped on a house starts you on open ground beside it', async () => {
  const onHouse = { elements: [{ type: 'way', id: 9, tags: { building: 'yes' }, geometry: box(-6, -6, 6, 6) }] };
  const ex = new Explorer([LAT, LON], { fetchArea: async () => onHouse });
  const pet = createPet({ name: 'Mochi', species: 'dog' }, 0);
  const w = new World(pet, { rng: () => 0.5, clock: () => new Date(2026, 0, 9, 12) });
  w.startWalk({ id: 's2', kind: 'spot', name: 'The house', area: ex.area });
  w.update(0.05);
  assert.equal(w.owner.x, 0, 'waits for the map');
  await loadAround(ex, 0, 0);
  w.update(0.05);
  assert.ok(walkable(ex.area.blocks, w.owner.x / U, w.owner.y / U), 'outside the house');
  assert.ok(Math.hypot(w.owner.x, w.owner.y) / U < 9, `right next to it (${(w.owner.x / U).toFixed(1)}, ${(w.owner.y / U).toFixed(1)})`);
  assert.ok(walkable(ex.area.blocks, w.body.x / U, w.body.y / U), 'and so is your pet');
});

test('a building split between two squares of map stays one house', async () => {
  // A house across the line between the first two squares, east of the pin.
  const edge = tileBox(0, 0).x1;
  const across = { elements: [{ type: 'way', id: 7, tags: { building: 'yes' }, geometry: box(edge - 10, 20, edge + 10, 30) }] };
  const ex = new Explorer([LAT, LON], { fetchArea: async () => across });
  await loadAround(ex, edge, 25);
  const grid = ex.area.blocks.grid;
  const houseAt = (x, y) => { const c = grid.chunkAt(x, y); return c.house[(y - c.cj * 32) * 32 + (x - c.ci * 32)]; };
  assert.equal(houseAt(edge - 5, 25), houseAt(edge + 5, 25));
});

test('up to three squares are fetched at once, and no more', async () => {
  let started = 0;
  const release = [];
  const ex = new Explorer([LAT, LON], { fetchArea: () => { started++; return new Promise((resolve) => release.push(() => resolve(osm))); } });
  // Standing on a corner, four squares are within reach.
  const loads = [ex.update(TILE / 2, TILE / 2), ex.update(TILE / 2, TILE / 2), ex.update(TILE / 2, TILE / 2), ex.update(TILE / 2, TILE / 2)];
  assert.equal(started, 3, 'three started');
  assert.equal(loads[3], null, 'the fourth waits');
  assert.ok(ex.loading);
  release.forEach((r) => r());
  await Promise.all(loads.filter(Boolean));
  assert.ok(!ex.loading);
  assert.ok(ex.update(TILE / 2, TILE / 2), 'then the last one goes');
});
