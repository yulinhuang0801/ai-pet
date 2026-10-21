// The block grid built from a route's map: what each feature becomes, road
// widths, pavements, markings, buildings and trees. A hand-made map in the
// format route-map.js saves (metres east and south of the centre).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlocks, wayWidth, walkable, B, CHUNK } from '../src/blocks.js';

const flat = (pts) => pts.flat();
const square = (x0, y0, x1, y1) => flat([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);

// A residential street running east, a main road crossing it going south, a
// park, a house, a footpath and a mapped tree.
const map = {
  areas: [
    { k: 'residential', p: square(-60, -60, 0, 0) },
    { k: 'park', p: square(10, 10, 50, 50) },
  ],
  lines: [
    { k: 'minor', hw: 'residential', p: flat([[-60, 0.5], [60, 0.5]]) },
    { k: 'major', hw: 'secondary', p: flat([[0.5, -60], [0.5, 60]]), sw: 'no' },
    { k: 'path', hw: 'path', p: flat([[20, 20], [40, 40]]) },
    { k: 'crossing', hw: 'footway', p: flat([[-20.5, -6], [-20.5, 6]]) },
  ],
  buildings: [{ p: square(-40, -20, -30, -10), h: 10 }],
  trees: [30, 15],
};
const line = flat([[-50, 0], [50, 0]]);
const blocks = buildBlocks(map, line);
const at = (x, y) => blocks.get(Math.floor(x), Math.floor(y));

test('road widths follow the road type and lanes', () => {
  assert.equal(wayWidth({ k: 'minor', hw: 'residential' }), 7); // two lanes of 3.5 m
  assert.equal(wayWidth({ k: 'major', hw: 'primary' }), 11);
  assert.equal(wayWidth({ k: 'major', hw: 'primary', l: 4 }), 15);
  assert.equal(wayWidth({ k: 'path', hw: 'footway' }), 2);
  assert.equal(wayWidth({ k: 'minor', hw: 'residential', w: 5.4 }), 5, 'a mapped width wins');
});

test('roads, pavements and land become the right blocks', () => {
  assert.equal(at(-50, 0.5), B.ASPHALT, 'the street');
  assert.equal(at(-50, -4.5), B.PAVEMENT, 'a pavement beside it');
  assert.equal(at(-50, 5.5), B.PAVEMENT, 'and on the other side');
  assert.equal(at(-50, -20), B.GRASS, 'gardens in the residential area');
  assert.equal(at(30, 30), B.DIRT, 'the park path is a dirt path');
  assert.equal(at(45, 20), B.GRASS, 'the park is grass');
  assert.equal(at(-2.5, -40), B.ASPHALT, 'the main road');
  assert.equal(at(-5, -40), B.GRASS, 'no pavement where the map says there is none');
});

test('main roads get a solid centre line; side streets are left plain', () => {
  assert.equal(at(0.5, 0.5), B.ASPHALT, 'no line across the junction');
  // A secondary road has two lanes: the line between them is the centre.
  const centre = [];
  for (let y = -50; y < -40; y++) centre.push(at(0.5, y + 0.5));
  assert.ok(centre.every((b) => b === B.LINE_YELLOW), centre.join());
  assert.ok(![...Array(20)].some((_, x) => [B.LINE, B.LINE_YELLOW].includes(at(-50 + x, 0.5))), 'no lines on the residential street');
});

test('a crossing has zebra stripes', () => {
  const across = [];
  for (let y = -3; y < 3; y++) across.push(at(-20.5, y + 0.5));
  assert.ok(across.includes(B.ZEBRA) && across.includes(B.ASPHALT), across.join());
});

test('buildings are solid, with their height', () => {
  assert.equal(at(-35, -15), B.BUILDING);
  assert.ok(!walkable(blocks, -35, -15));
  assert.ok(walkable(blocks, -50, 0.5));
  const c = blocks.grid.chunkAt(-35, -15);
  const n = (-15 - c.cj * CHUNK) * CHUNK + (-35 - c.ci * CHUNK);
  assert.equal(c.height[n], 10);
});

test('only the squares near the route exist', () => {
  assert.equal(blocks.get(0, 400), B.NONE);
  assert.ok(blocks.chunks.length > 4 && blocks.chunks.length < 60, `${blocks.chunks.length} chunks`);
});

test('mapped trees stay; streets without any get a row', () => {
  assert.ok(blocks.trees.some((t) => t.x === 30 && t.y === 15 && !t.street));
  const street = blocks.trees.filter((t) => t.street);
  assert.ok(street.length >= 4, `${street.length} street trees`);
  for (const t of street) assert.notEqual(at(t.x, t.y), B.ASPHALT, 'not in the road');
});
