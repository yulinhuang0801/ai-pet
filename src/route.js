// Routes on a real map, turned into walks: how long the route is, what kind
// of place each stretch passes through, and the landmarks along it. Pure
// functions over OpenStreetMap data (the JSON an Overpass "out geom" query
// returns), so this works the same in any view and can be tested offline.

import { simplify, stitchRings, extractMap } from './route-map.js';

export const BIOMES = {
  park: { label: 'park' },
  woods: { label: 'woods' },
  water: { label: 'waterside' },
  beach: { label: 'beach' },
  street: { label: 'streets' },
  town: { label: 'shops' },
};

export const LANDMARKS = {
  dog_park: { label: 'the dog park', rank: 7 },
  playground: { label: 'a playground', rank: 6 },
  fountain: { label: 'a fountain', rank: 5 },
  drinking_water: { label: 'a water fountain', rank: 4 },
  cafe: { label: 'a café', rank: 4 },
  ice_cream: { label: 'an ice cream shop', rank: 4 },
  restaurant: { label: 'a restaurant', rank: 3 },
  bench: { label: 'a bench', rank: 2 },
  shop: { label: 'a shop', rank: 1 },
};

const EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;

// Points are [lat, lon] pairs.
export function haversine([lat1, lon1], [lat2, lon2]) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.sqrt(a));
}

export function routeLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

// Flat metres around a centre point; accurate enough for a walk.
export function projector([lat0, lon0]) {
  const kx = EARTH * Math.cos(rad(lat0)) * (Math.PI / 180);
  const ky = EARTH * (Math.PI / 180);
  return ([lat, lon]) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

// Bounding box around the route, padded by some metres: [south, west, north, east].
export function bbox(points, pad = 80) {
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = pad / 111320;
  const dLon = pad / (111320 * Math.cos(rad(midLat)));
  return [Math.min(...lats) - dLat, Math.min(...lons) - dLon, Math.max(...lats) + dLat, Math.max(...lons) + dLon];
}

// The route, thinned out to at most about `max` points, for queries.
function thinned(points, max = 80) {
  const project = projector(points[0]);
  const pts = points.map((p, i) => Object.assign(project(p), { i }));
  let kept = pts;
  for (let tol = 2; kept.length > max; tol *= 2) kept = simplify(pts, tol);
  return kept.map((xy) => points[xy.i]);
}

// The Overpass query for everything the walk is built from and drawn with:
// whatever lies within `radius` metres of the route.
export function overpassQuery(points, radius = 90) {
  const around = `(around:${radius},${thinned(points).map(([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join(',')})`;
  return `[out:json][timeout:40];
(
  way[~"^(building|highway|landuse|leisure|natural|waterway|railway|amenity|barrier|water)$"~"."]${around};
  relation["type"="multipolygon"][~"^(building|landuse|leisure|natural|water|amenity)$"~"."]${around};
  node["natural"="tree"]${around};
  node["amenity"~"^(bench|cafe|fountain|drinking_water|restaurant|ice_cream)$"]${around};
  node["leisure"~"^(playground|dog_park)$"]${around};
  node["shop"]${around};
);
out geom;`;
}

// --- geometry in flat metres ---

function insidePolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distToLine(p, line) {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, distToSegment(p, line[i - 1], line[i]));
  return d;
}

function boundsOf(pts) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

const nearBounds = (b, [x, y], m) => x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m;

// Points every `step` metres along the route, with their distance from the start.
export function samplesAlong(points, project, step = 10) {
  const out = [];
  let d = 0;
  let next = 0;
  for (let i = 1; i < points.length; i++) {
    const a = project(points[i - 1]);
    const b = project(points[i]);
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (next < d + seg) {
      const t = (next - d) / seg;
      out.push({ d: next, p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] });
      next += step;
    }
    d += seg;
  }
  out.push({ d, p: project(points[points.length - 1]) });
  return out;
}

// How far along the route a point is, and how far off it.
function alongRoute(p, line) {
  let best = { d: 0, off: Infinity };
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    const off = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
    if (off < best.off) best = { d: run + t * Math.sqrt(len2), off };
    run += Math.sqrt(len2);
  }
  return best;
}

// --- reading OpenStreetMap tags ---

function areaBiome(tags) {
  const { leisure, landuse, natural, waterway } = tags;
  if (natural === 'water' || landuse === 'reservoir' || waterway === 'riverbank') return 'water';
  if (natural === 'wood' || landuse === 'forest' || natural === 'scrub') return 'woods';
  if (natural === 'beach' || natural === 'sand') return 'beach';
  if (['park', 'garden', 'dog_park', 'playground', 'recreation_ground', 'common', 'nature_reserve'].includes(leisure)) return 'park';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'cemetery'].includes(landuse) || natural === 'grassland') return 'park';
  if (landuse === 'commercial' || landuse === 'retail') return 'town';
  if (landuse === 'residential') return 'street';
  return null;
}

function landmarkKind(tags) {
  if (tags.leisure === 'dog_park' || tags.leisure === 'playground') return tags.leisure;
  if (LANDMARKS[tags.amenity]) return tags.amenity;
  if (tags.shop) return 'shop';
  return null;
}

// Split OSM elements into the shapes the classifier needs, in flat metres.
function readOsm(osm, project) {
  const areas = [];
  const rivers = [];
  const buildings = [];
  const trees = [];
  const points = [];
  const shapeOf = (geom) => geom.map((g) => project([g.lat, g.lon]));
  for (const el of osm.elements ?? []) {
    const tags = el.tags ?? {};
    if (el.type === 'node') {
      const p = project([el.lat, el.lon]);
      if (tags.natural === 'tree') trees.push(p);
      const kind = landmarkKind(tags);
      if (kind) points.push({ p, kind, name: tags.name ?? null });
      continue;
    }
    const outlines = el.type === 'relation'
      ? stitchRings((el.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry)).map(shapeOf)
      : el.geometry ? [shapeOf(el.geometry)] : [];
    for (const shape of outlines) {
      if (shape.length < 2) continue;
      if (tags.building) { buildings.push(boundsOf(shape)); continue; }
      if (tags.highway || tags.railway || tags.barrier) continue;
      if (tags.waterway && tags.waterway !== 'riverbank') { rivers.push({ line: shape, b: boundsOf(shape) }); continue; }
      const biome = areaBiome(tags);
      if (biome && shape.length >= 3) areas.push({ biome, poly: shape, b: boundsOf(shape) });
      const kind = landmarkKind(tags);
      if (kind && shape.length >= 3) {
        const b = boundsOf(shape);
        points.push({ p: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2], kind, name: tags.name ?? null });
      }
    }
  }
  return { areas, rivers, buildings, trees, points };
}

function classify(p, osm) {
  const inside = new Set();
  for (const a of osm.areas) if (nearBounds(a.b, p, 0) && insidePolygon(p, a.poly)) inside.add(a.biome);
  let nearWater = inside.has('water');
  for (const a of osm.areas) {
    if (nearWater) break;
    if (a.biome === 'water' && nearBounds(a.b, p, 30) && distToLine(p, [...a.poly, a.poly[0]]) < 30) nearWater = true;
  }
  for (const r of osm.rivers) {
    if (nearWater) break;
    if (nearBounds(r.b, p, 35) && distToLine(p, r.line) < 35) nearWater = true;
  }
  if (inside.has('beach')) return 'beach';
  if (nearWater) return 'water';
  if (inside.has('woods')) return 'woods';
  if (inside.has('park')) return 'park';
  let buildings = 0;
  for (const b of osm.buildings) if (nearBounds(b, p, 40)) buildings++;
  let shops = 0;
  for (const pt of osm.points) if ((pt.kind === 'shop' || pt.kind === 'restaurant' || pt.kind === 'cafe') && Math.hypot(pt.p[0] - p[0], pt.p[1] - p[1]) < 50) shops++;
  if (inside.has('town') || shops >= 3) return 'town';
  if (inside.has('street') || buildings >= 2) return 'street';
  return buildings === 0 && osm.trees.length ? 'park' : 'street';
}

// Smooth out flicker, then merge into stretches at least `min` metres long.
function toSegments(samples, labels, length, min = 30) {
  const smooth = labels.map((_, i) => {
    const counts = {};
    for (let k = Math.max(0, i - 2); k <= Math.min(labels.length - 1, i + 2); k++) counts[labels[k]] = (counts[labels[k]] ?? 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || (a[0] === labels[i] ? -1 : 1))[0][0];
  });
  const segs = [];
  smooth.forEach((biome, i) => {
    const from = samples[i].d;
    if (segs.length && segs[segs.length - 1].biome === biome) return;
    if (segs.length) segs[segs.length - 1].to = from;
    segs.push({ from, to: length, biome });
  });
  // Fold short stretches into the longer neighbour.
  for (let i = 0; i < segs.length && segs.length > 1;) {
    const s = segs[i];
    if (s.to - s.from >= min) { i++; continue; }
    const prev = segs[i - 1];
    const next = segs[i + 1];
    const into = !prev ? next : !next ? prev : (prev.to - prev.from >= next.to - next.from ? prev : next);
    into.from = Math.min(into.from, s.from);
    into.to = Math.max(into.to, s.to);
    segs.splice(i, 1);
    i = Math.max(0, i - 1);
    // Neighbours of the same kind join up.
    for (let k = 1; k < segs.length; k++) {
      if (segs[k].biome === segs[k - 1].biome) { segs[k - 1].to = segs[k].to; segs.splice(k, 1); k--; }
    }
  }
  return segs;
}

// Turn a route (and the points it was planned through) and the map data
// around it into a walk.
export function buildWalk(points, osmJson, { waypoints = null } = {}) {
  if (points.length < 2) throw new Error('A route needs at least two points.');
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const project = projector([(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2]);
  const osm = readOsm(osmJson, project);
  const line = points.map(project);
  const samples = samplesAlong(points, project, 10);
  const length = samples[samples.length - 1].d;
  const segments = toSegments(samples, samples.map((s) => classify(s.p, osm)), length);

  // Landmarks close to the path, at most one every 15 m, best first.
  const candidates = osm.points
    .map((pt) => ({ ...pt, ...alongRoute(pt.p, line) }))
    .filter((pt) => pt.off < 30)
    .sort((a, b) => LANDMARKS[b.kind].rank - LANDMARKS[a.kind].rank || (b.name ? 1 : 0) - (a.name ? 1 : 0));
  const landmarks = [];
  for (const c of candidates) {
    if (landmarks.some((l) => Math.abs(l.d - c.d) < 15)) continue;
    landmarks.push({ d: Math.round(c.d), kind: c.kind, name: c.name, x: Math.round(c.p[0] * 10) / 10, y: Math.round(-c.p[1] * 10) / 10 });
  }
  landmarks.sort((a, b) => a.d - b.d);

  // How leafy each stretch is: trees within 25 m per 100 m of path.
  for (const s of segments) {
    let n = 0;
    for (const t of osm.trees) {
      const a = alongRoute(t, line);
      if (a.off < 25 && a.d >= s.from && a.d < s.to) n++;
    }
    s.trees = Math.round((n / Math.max(10, s.to - s.from)) * 100);
  }

  for (const seg of segments) { seg.from = Math.round(seg.from); seg.to = Math.round(seg.to); }
  // The route and the map around it, in metres east and south of the centre.
  const flatLine = line.flatMap(([e, n]) => [Math.round(e * 10) / 10, Math.round(-n * 10) / 10]);
  return {
    points, waypoints: waypoints ?? [points[0], points[points.length - 1]], length: Math.round(length), segments, landmarks,
    line: flatLine, map: extractMap(osmJson, project, line),
  };
}

export function biomeAt(walk, metres) {
  return walk.segments.find((s) => metres >= s.from && metres < s.to)?.biome ?? walk.segments[walk.segments.length - 1]?.biome ?? 'park';
}

// "860 m through park, streets and waterside, past a café and 2 benches."
export function describeWalk(walk) {
  const share = {};
  for (const s of walk.segments) share[s.biome] = (share[s.biome] ?? 0) + (s.to - s.from);
  const kinds = Object.entries(share).sort((a, b) => b[1] - a[1]).map(([k]) => BIOMES[k].label);
  const list = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
  const counts = {};
  for (const l of walk.landmarks) counts[l.kind] = (counts[l.kind] ?? 0) + 1;
  const past = Object.entries(counts).sort((a, b) => LANDMARKS[b[0]].rank - LANDMARKS[a[0]].rank).slice(0, 4)
    .map(([k, n]) => (n === 1 ? LANDMARKS[k].label : `${n} ${k === 'bench' ? 'benches' : `${k.replace('_', ' ')}s`}`));
  const len = walk.length >= 1000 ? `${(walk.length / 1000).toFixed(1)} km` : `${walk.length} m`;
  return `${len} through ${list(kinds)}${past.length ? `, past ${list(past)}` : ''}.`;
}
