// Route building, tested against a small hand-made sample in the format an
// Overpass "out geom" query returns (not real map data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, routeLength, buildWalk, biomeAt, describeWalk, overpassQuery } from '../src/route.js';

// A straight route heading east from a made-up point.
const LAT = 51.5;
const LON = -0.1;
const metresEast = (m) => LON + m / (111320 * Math.cos((LAT * Math.PI) / 180));
const metresNorth = (m) => LAT + m / 111320;
const at = (east, north = 0) => ({ lat: metresNorth(north), lon: metresEast(east) });
const box = (e0, e1, n0, n1) => [at(e0, n0), at(e1, n0), at(e1, n1), at(e0, n1), at(e0, n0)];

const route = [[LAT, metresEast(0)], [LAT, metresEast(200)], [LAT, metresEast(420)]];
const sample = {
  elements: [
    { type: 'way', tags: { leisure: 'park', name: 'Sample Park' }, geometry: box(-20, 150, -60, 60) },
    ...[0, 1, 2, 3, 4].map((i) => ({ type: 'way', tags: { building: 'yes' }, geometry: box(180 + i * 25, 195 + i * 25, 12, 25) })),
    { type: 'way', tags: { waterway: 'river' }, geometry: [at(310, 20), at(450, 20)] },
    { type: 'node', tags: { natural: 'tree' }, ...at(40, 8) },
    { type: 'node', tags: { natural: 'tree' }, ...at(90, -10) },
    { type: 'node', tags: { amenity: 'bench' }, ...at(60, 4) },
    { type: 'node', tags: { amenity: 'cafe', name: 'Corner Café' }, ...at(250, 15) },
    { type: 'node', tags: { amenity: 'bench' }, ...at(255, 3) },
    { type: 'node', tags: { amenity: 'cafe' }, ...at(250, 300) },
  ],
};

test('distances on the globe', () => {
  assert.ok(Math.abs(haversine([LAT, metresEast(0)], [LAT, metresEast(100)]) - 100) < 0.5);
  assert.ok(Math.abs(routeLength(route) - 420) < 1);
});

test('a route becomes park, then streets, then waterside', () => {
  const walk = buildWalk(route, sample);
  assert.ok(Math.abs(walk.length - 420) <= 1);
  assert.equal(biomeAt(walk, 50), 'park');
  assert.equal(biomeAt(walk, 230), 'street');
  assert.equal(biomeAt(walk, 380), 'water');
  assert.equal(walk.segments[0].from, 0);
  assert.equal(walk.segments[walk.segments.length - 1].to, walk.length);
  assert.ok(walk.segments[0].trees > 0, 'the park stretch has trees');
});

test('landmarks near the path are kept, far ones and crowded ones are not', () => {
  const walk = buildWalk(route, sample);
  const kinds = walk.landmarks.map((l) => `${l.kind}@${l.d}`);
  assert.ok(walk.landmarks.some((l) => l.kind === 'bench' && Math.abs(l.d - 60) < 2), kinds.join());
  const cafe = walk.landmarks.find((l) => l.kind === 'cafe');
  assert.equal(cafe.name, 'Corner Café');
  assert.ok(!walk.landmarks.some((l) => l.kind === 'bench' && Math.abs(l.d - 255) < 2), 'the café wins over a bench 5 m away');
  assert.equal(walk.landmarks.filter((l) => l.kind === 'cafe').length, 1, 'the far café is ignored');
});

test('describes the walk in plain words', () => {
  const text = describeWalk(buildWalk(route, sample));
  assert.match(text, /^420 m through /);
  assert.match(text, /park/);
  assert.match(text, /a café/);
});

test('the query covers the route with padding', () => {
  const q = overpassQuery(route);
  assert.match(q, /out geom;/);
  assert.match(q, /node\["amenity"/);
});

test('walking a route visits its landmarks and ends at its end', async () => {
  const { World } = await import('../src/world.js');
  const { createPet } = await import('../src/pet.js');
  const pet = createPet({ name: 'Mochi', species: 'dog' }, 0);
  const walk = buildWalk(route, sample);
  let seed = 3;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const w = new World(pet, { rng, clock: () => new Date(2026, 0, 9, 12) });
  w.startWalk({ id: 'r1', kind: 'route', name: 'Test loop', route: walk });
  w.setWalkInput(1);
  const statuses = new Set();
  for (let i = 0; i < 6000 && !w.walk.arrived; i++) {
    w.update(0.05);
    statuses.add(w.status());
  }
  assert.ok(w.walk.arrived, 'reached the end');
  assert.ok(w.walk.visited.size >= 2, `visited ${w.walk.visited.size} landmarks`);
  assert.ok([...statuses].some((s) => /Corner Café/.test(s)), 'mentions the named café');
  for (let i = 0; i < 200; i++) w.update(0.05);
  assert.ok(w.routeMeters(w.owner.x) <= walk.length + 0.5, 'cannot walk past the end');
  assert.ok(pet.memory.journal.some((j) => /Walked all of Test loop/.test(j.text)));
});
