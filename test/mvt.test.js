// Reading vector tiles: a small tile written by hand, in the same format the
// map CDN serves, turned into OpenStreetMap-style elements.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTile, tileElements, tilesFor } from '../src/mvt.js';

// --- a tiny protocol-buffer writer for the test ---
const varint = (n) => { const out = []; while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128); } out.push(n); return out; };
const key = (field, type) => varint((field << 3) | type);
const bytesField = (field, bytes) => [...key(field, 2), ...varint(bytes.length), ...bytes];
const str = (field, s) => bytesField(field, [...new TextEncoder().encode(s)]);
const packed = (field, nums) => bytesField(field, nums.flatMap(varint));
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const cmd = (id, count) => (count << 3) | id;

// A geometry: MoveTo the first point, LineTo the rest, ClosePath for rings.
function geometry(points, close) {
  const out = [cmd(1, 1)];
  let x = 0; let y = 0;
  points.forEach(([px, py], i) => {
    if (i === 1) out.push(cmd(2, points.length - 1));
    out.push(zz(px - x), zz(py - y));
    x = px; y = py;
  });
  if (close) out.push(cmd(7, 1));
  return out;
}

function layer(name, features, keys, values) {
  return bytesField(3, [
    ...str(1, name),
    ...features.flatMap((f) => bytesField(2, [...packed(2, f.tags), ...key(3, 0), ...varint(f.type), ...packed(4, f.geom)])),
    ...keys.flatMap((k) => str(3, k)),
    ...values.flatMap((v) => bytesField(4, str(1, v))),
    ...key(5, 0), ...varint(4096),
    ...key(15, 0), ...varint(2),
  ]);
}

// A building (a square, clockwise with y down), a residential street, a café.
const tile = new Uint8Array([
  ...layer('building', [{ type: 3, tags: [], geom: geometry([[100, 100], [200, 100], [200, 200], [100, 200]], true) }], [], []),
  ...layer('transportation', [{ type: 2, tags: [0, 0, 1, 1], geom: geometry([[0, 2048], [4096, 2048]]) }], ['class', 'subclass'], ['minor', 'residential']),
  ...layer('poi', [{ type: 1, tags: [0, 0, 1, 0, 2, 1], geom: geometry([[1000, 1000]]) }], ['class', 'subclass', 'name'], ['cafe', 'Corner Café']),
]);

test('a tile decodes into layers of features', () => {
  const layers = decodeTile(tile);
  assert.deepEqual(Object.keys(layers), ['building', 'transportation', 'poi']);
  assert.equal(layers.transportation.features[0].tags.class, 'minor');
  assert.deepEqual(layers.building.features[0].parts[0].slice(0, 3), [[100, 100], [200, 100], [200, 200]]);
  assert.equal(layers.building.features[0].parts[0].length, 5, 'the ring is closed');
});

test('features become OpenStreetMap-style elements on the globe', () => {
  const els = tileElements(decodeTile(tile), 14, 4825, 6162);
  const house = els.find((e) => e.tags.building);
  const street = els.find((e) => e.tags.highway);
  const cafe = els.find((e) => e.tags.amenity);
  assert.ok(house && street && cafe);
  assert.equal(street.tags.highway, 'residential');
  assert.equal(cafe.tags.name, 'Corner Café');
  // Tile 14/4825/6162 is in Brooklyn.
  assert.ok(Math.abs(cafe.lat - 40.67) < 0.02 && Math.abs(cafe.lon + 73.97) < 0.02, `${cafe.lat}, ${cafe.lon}`);
  assert.equal(house.geometry.length, 5);
  assert.ok(house.geometry[0].lat > house.geometry[2].lat, 'y runs south');
  // The same tile read twice gives the same ids.
  assert.deepEqual(tileElements(decodeTile(tile), 14, 4825, 6162).map((e) => e.id), els.map((e) => e.id));
});

test('the tiles covering a box', () => {
  assert.deepEqual(tilesFor([40.672, -73.977, 40.673, -73.976], 14), [[4825, 6162]]);
  assert.equal(tilesFor([40.66, -73.99, 40.68, -73.96], 14).length, 4);
});
