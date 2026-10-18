// The map saved with a route, finding walkable paths, and walking a route
// from above. Hand-made samples in Overpass "out geom" format (not real map data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simplify, clipPolygon, clipLine, stitchRings, measureLine, pointAlong, distanceAlong,
} from '../src/route-map.js';
import { pathGraph, findPath, loopPoints } from '../src/paths.js';
import { buildWalk, routeLength } from '../src/route.js';
import { World } from '../src/world.js';
import { createPet } from '../src/pet.js';
import { LEASH } from '../src/space-side.js';
import { MAP_UNITS_PER_METER as U } from '../src/space-map.js';

const LAT = 51.5;
const LON = -0.1;
const kLon = 1 / (111320 * Math.cos((LAT * Math.PI) / 180));
const at = (east, north = 0) => ({ lat: LAT + north / 111320, lon: LON + east * kLon });
const ll = (east, north = 0) => { const p = at(east, north); return [p.lat, p.lon]; };

test('simplify keeps corners and drops points on straight stretches', () => {
  const line = [[0, 0], [5, 0.1], [10, 0], [10, 10]];
  assert.deepEqual(simplify(line, 0.5), [[0, 0], [10, 0], [10, 10]]);
});

test('polygons and lines are clipped to the box around the route', () => {
  const box = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const clipped = clipPolygon([[-5, -5], [5, -5], [5, 5], [-5, 5]], box);
  const xs = clipped.map((p) => p[0]);
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= 5);
  // A street crossing the whole box, with no point inside it, is kept.
  const parts = clipLine([[-20, 5], [30, 5]], box);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0], [[0, 5], [10, 5]]);
  // A line that leaves and comes back becomes two lines.
  assert.equal(clipLine([[2, 2], [20, 2], [20, 8], [2, 8]], box).length, 2);
});

test('the pieces of a multipolygon join into a ring', () => {
  const a = [at(0, 0), at(10, 0)];
  const b = [at(10, 10), at(10, 0)]; // reversed
  const c = [at(10, 10), at(0, 10), at(0, 0)];
  const rings = stitchRings([a, c, b]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
});

test('points along a route, and how far along a point is', () => {
  const m = measureLine([0, 0, 100, 0, 100, 50]);
  assert.equal(m.length, 150);
  const p = pointAlong(m, 120);
  assert.deepEqual([p.x, p.y, p.tx, p.ty], [100, 20, 0, 1]);
  assert.ok(Math.abs(distanceAlong(m, 40, 3) - 40) < 1e-9);
  // An out-and-back route is read near where you are.
  const back = measureLine([0, 0, 100, 0, 0, 0]);
  assert.ok(Math.abs(distanceAlong(back, 30, 0, 150, 200) - 170) < 1e-9);
});

// Two streets meeting at a corner, and a footpath cutting across.
const streets = {
  elements: [
    { type: 'way', tags: { highway: 'residential' }, nodes: [1, 2, 3], geometry: [at(0, 0), at(100, 0), at(200, 0)] },
    { type: 'way', tags: { highway: 'residential' }, nodes: [3, 4, 5], geometry: [at(200, 0), at(200, 100), at(200, 200)] },
    { type: 'way', tags: { highway: 'footway' }, nodes: [2, 6, 5], geometry: [at(100, 0), at(150, 100), at(200, 200)] },
    { type: 'way', tags: { building: 'yes' }, nodes: [7, 8, 9, 7], geometry: [at(50, 50), at(60, 50), at(60, 60), at(50, 50)] },
  ],
};

test('paths follow streets and footpaths instead of cutting through houses', () => {
  const g = pathGraph(streets);
  const path = findPath(g, ll(5, -3), ll(198, 195));
  assert.ok(path, 'found a way');
  // From the start, along the street, then the footpath (shorter than going round the corner).
  assert.deepEqual(path.map(([lat, lon]) => [Math.round((lon - LON) / kLon), Math.round((lat - LAT) * 111320)]), [[0, 0], [100, 0], [150, 100], [200, 200]]);
  assert.equal(findPath(g, ll(5, 0), ll(1000, 1000)), null, 'too far from any path');
});

test('a suggested loop starts and ends in the same place', () => {
  const pts = loopPoints(ll(0, 0), 2000, () => 0.25);
  assert.equal(pts.length, 5);
  assert.deepEqual(pts[0], pts[4]);
  const len = routeLength(pts);
  assert.ok(len > 1200 && len < 2000, `about the right size: ${len}`);
});

// A walk along the two streets, with a park, houses, trees and a bench.
const box = (e0, e1, n0, n1) => [at(e0, n0), at(e1, n0), at(e1, n1), at(e0, n1), at(e0, n0)];
const area = {
  elements: [
    ...streets.elements,
    { type: 'way', tags: { leisure: 'park' }, geometry: box(-50, 120, 5, 120) },
    { type: 'way', tags: { building: 'house', 'building:levels': '2' }, geometry: box(150, 180, -30, -10) },
    { type: 'node', tags: { natural: 'tree' }, ...at(60, 20) },
    { type: 'node', tags: { amenity: 'bench' }, ...at(120, 4) },
    { type: 'node', tags: { amenity: 'cafe', name: 'Corner Café' }, ...at(206, 90) },
  ],
};
const routePts = [ll(0, 0), ll(100, 0), ll(200, 0), ll(200, 100), ll(200, 200)];

test('a walk keeps the map around the route', () => {
  const walk = buildWalk(routePts, area, { waypoints: [routePts[0], routePts[4]] });
  const { map } = walk;
  assert.ok(map.lines.some((l) => l.k === 'minor') && map.lines.some((l) => l.k === 'path'));
  assert.ok(map.areas.some((a) => a.k === 'park'));
  assert.equal(map.buildings.length, 2);
  assert.ok(map.buildings.some((b) => b.h === 7 && b.p.length >= 8), 'a house with 2 levels is 7 m tall');
  assert.equal(map.trees.length, 2);
  assert.equal(walk.line.length, routePts.length * 2);
  const cafe = walk.landmarks.find((l) => l.kind === 'cafe');
  assert.ok(cafe && Math.abs(cafe.d - 290) < 2, 'the café is near 290 m');
  assert.ok(Math.abs(cafe.x - 106) < 1 && Math.abs(cafe.y - 10) < 1, 'and has its place on the map: 106 m east and 10 m south of the centre');
});

function walker(walk, seed = 5) {
  const pet = createPet({ name: 'Mochi', species: 'dog' }, 0);
  let s = seed;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const w = new World(pet, { rng, clock: () => new Date(2026, 0, 9, 12) });
  w.startWalk({ id: 'r1', kind: 'route', name: 'Corner loop', route: walk });
  return w;
}

test('walking a route from above turns its corners and keeps the pet on the leash', () => {
  const w = walker(buildWalk(routePts, area));
  assert.ok(w.walk.track, 'walked on the map');
  w.setWalkInput(1);
  let maxGap = 0;
  let turned = false;
  let northbound = 0;
  let sameWay = 0;
  for (let i = 0; i < 6000 && !w.walk.arrived; i++) {
    w.update(0.05);
    maxGap = Math.max(maxGap, Math.hypot(w.body.x - w.owner.x, w.body.y - w.owner.y));
    if (w.routeMeters() > 220 && Math.abs(w.owner.x - 100 * U) < 20) {
      turned = true;
      if (w.activity.phase === 'walk' && w.body.speed > 5) { northbound++; if (w.body.dir === w.owner.dir) sameWay++; }
    }
  }
  assert.ok(w.walk.arrived, 'reached the end');
  assert.ok(turned, 'went round the corner and north up the second street');
  assert.ok(maxGap <= LEASH + 1, `stayed within the leash (${Math.round(maxGap)})`);
  assert.ok(w.walk.visited.size >= 1, 'stopped at a landmark');
  assert.ok(sameWay > 0.9 * northbound, `faced the same way as you while walking north (${sameWay} of ${northbound})`);
  assert.ok(w.walkedMeters() > 395 && w.walkedMeters() < 405, 'the route is 400 m');
  const end = w.endWalk();
  assert.ok(end.meters >= 395);
  assert.equal(w.walkDirToward({ x: w.owner.x + 10 }), 1, 'back home, side-on again');
});

test('the way you point decides which way along the route you walk', () => {
  const w = walker(buildWalk(routePts, area));
  w.owner.s = 250 * U;
  w.setWalkInput(0);
  w.update(0.05);
  // The route runs north here (up the screen).
  assert.equal(w.walkDirToward({ x: w.owner.x, y: w.owner.y - 300 }), 1);
  assert.equal(w.walkDirToward({ x: w.owner.x, y: w.owner.y + 300 }), -1);
});

test('a route saved without its map is still walked side-on', () => {
  const walk = buildWalk(routePts, area);
  delete walk.map;
  const w = walker(walk);
  assert.ok(!w.walk.track);
  w.setWalkInput(1);
  for (let i = 0; i < 200; i++) w.update(0.05);
  assert.ok(w.routeMeters() > 5);
});
