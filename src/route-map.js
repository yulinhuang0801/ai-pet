// The real map around a route, kept with the route so the walk can be drawn
// from above, street by street, and works offline later. Pure functions over
// OpenStreetMap data (the JSON an Overpass "out geom" query returns).
//
// Map positions are in metres: x to the east and y to the south of the
// route's centre, so they read like a picture with north at the top.

// --- shapes in metres ---

// Douglas–Peucker: drop points that bend the line by less than `tol` metres.
export function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = pts[k];
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > worst) { worst = d; at = k; }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

// Sutherland–Hodgman: the part of a polygon inside a box {x0, y0, x1, y1}.
export function clipPolygon(poly, box) {
  const edges = [
    (p) => p[0] >= box.x0, (p) => p[0] <= box.x1, (p) => p[1] >= box.y0, (p) => p[1] <= box.y1,
  ];
  const cuts = [
    (a, b) => cutAt(a, b, 0, box.x0), (a, b) => cutAt(a, b, 0, box.x1),
    (a, b) => cutAt(a, b, 1, box.y0), (a, b) => cutAt(a, b, 1, box.y1),
  ];
  let out = poly;
  for (let e = 0; e < 4 && out.length; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const inCur = edges[e](cur);
      const inPrev = edges[e](prev);
      if (inCur) {
        if (!inPrev) out.push(cuts[e](prev, cur));
        out.push(cur);
      } else if (inPrev) out.push(cuts[e](prev, cur));
    }
  }
  return out;
}

function cutAt(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// The parts of a line inside a box, as separate lines.
export function clipLine(line, box) {
  const parts = [];
  let cur = null;
  for (let i = 1; i < line.length; i++) {
    const seg = clipSegment(line[i - 1], line[i], box);
    if (!seg) { if (cur) { parts.push(cur); cur = null; } continue; }
    const [a, b] = seg;
    if (cur && (cur[cur.length - 1][0] !== a[0] || cur[cur.length - 1][1] !== a[1])) { parts.push(cur); cur = null; }
    if (!cur) cur = [a];
    cur.push(b);
    // The line left the box partway along this piece.
    if (b !== line[i]) { parts.push(cur); cur = null; }
  }
  if (cur) parts.push(cur);
  return parts;
}

// Liang–Barsky: the part of the segment a–b inside the box, or null.
function clipSegment(a, b, box) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a[0] - box.x0], [dx, box.x1 - a[0]], [-dy, a[1] - box.y0], [dy, box.y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
  }
  return [t0 === 0 ? a : [a[0] + dx * t0, a[1] + dy * t0], t1 === 1 ? b : [a[0] + dx * t1, a[1] + dy * t1]];
}

// Join the pieces of a multipolygon's outline into closed rings. Pieces are
// lists of {lat, lon} that meet end to end, possibly reversed.
export function stitchRings(pieces) {
  const key = (g) => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;
  const left = pieces.filter((p) => p.length >= 2).map((p) => [...p]);
  const rings = [];
  while (left.length) {
    let ring = left.shift();
    for (let grew = true; grew && key(ring[0]) !== key(ring[ring.length - 1]);) {
      grew = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        if (key(p[0]) === end) ring = ring.concat(p.slice(1));
        else if (key(p[p.length - 1]) === end) ring = ring.concat([...p].reverse().slice(1));
        else continue;
        left.splice(i, 1);
        grew = true;
        break;
      }
    }
    // An outline cut off by missing pieces is closed with a straight line.
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

// --- reading tags ---

const AREA_KINDS = [
  // Drawn in this order, so later kinds lie on top.
  'residential', 'commercial', 'industrial', 'farmland', 'grass', 'park', 'cemetery', 'woods', 'flowerbed', 'pitch', 'playground', 'parking', 'plaza', 'beach', 'water',
];

function areaKind(t) {
  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin' || t.waterway === 'riverbank' || t.leisure === 'swimming_pool') return 'water';
  if (t.natural === 'beach' || t.natural === 'sand') return 'beach';
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub') return 'woods';
  if (t.leisure === 'pitch' || t.leisure === 'track') return 'pitch';
  if (t.leisure === 'playground' || t.leisure === 'dog_park') return 'playground';
  if (t.amenity === 'parking') return 'parking';
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return 'cemetery';
  if (['park', 'garden', 'recreation_ground', 'common', 'nature_reserve', 'golf_course'].includes(t.leisure)) return 'park';
  if (t.landuse === 'flowerbed') return 'flowerbed';
  if (['grass', 'meadow', 'village_green', 'recreation_ground', 'allotments'].includes(t.landuse) || t.natural === 'grassland' || t.natural === 'heath') return 'grass';
  if (['farmland', 'orchard', 'vineyard', 'farmyard'].includes(t.landuse)) return 'farmland';
  if (['commercial', 'retail'].includes(t.landuse) || t.amenity === 'marketplace') return 'commercial';
  if (t.landuse === 'residential') return 'residential';
  if (['industrial', 'railway', 'construction', 'brownfield'].includes(t.landuse)) return 'industrial';
  if ((t.highway === 'pedestrian' && t.area === 'yes') || t.place === 'square' || t.highway === 'footway' && t.area === 'yes') return 'plaza';
  return null;
}

const ROADS = {
  major: ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'],
  minor: ['residential', 'unclassified', 'living_street', 'road'],
  service: ['service'],
  path: ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'bridleway', 'corridor'],
};

function lineKind(t) {
  if (t.highway === 'footway' && (t.footway === 'sidewalk' || t.footway === 'crossing')) return t.footway;
  if (t.highway && t.area !== 'yes') {
    for (const [k, list] of Object.entries(ROADS)) if (list.includes(t.highway)) return k;
    return null;
  }
  if (t.waterway === 'river' || t.waterway === 'canal') return 'river';
  if (t.waterway === 'stream' || t.waterway === 'ditch' || t.waterway === 'drain') return 'stream';
  if (t.railway === 'rail' || t.railway === 'light_rail' || t.railway === 'tram') return 'rail';
  if (t.barrier === 'fence' || t.barrier === 'wall' || t.barrier === 'hedge') return t.barrier === 'hedge' ? 'hedge' : 'fence';
  return null;
}

// A road's width in metres, when the map says how wide it is or how many lanes it has.
function roadWidth(t) {
  if (!t.highway) return null;
  const w = parseFloat(t.width);
  if (w > 1 && w < 40) return w;
  const lanes = parseInt(t.lanes, 10);
  if (lanes > 0 && lanes < 10) return lanes * 3.3 + 1;
  return null;
}

function buildingHeight(t) {
  const h = parseFloat(t.height);
  if (h > 0) return Math.min(40, h);
  const levels = parseFloat(t['building:levels']);
  if (levels > 0) return Math.min(40, levels * 3 + 1);
  return ['garage', 'garages', 'shed', 'hut', 'roof', 'carport', 'kiosk'].includes(t.building) ? 3 : 7;
}

// --- the map ---

const round = (v) => Math.round(v * 10) / 10;
const flat = (pts) => pts.flatMap(([x, y]) => [round(x), round(y)]);

// Everything drawn on a walk, within `pad` metres of the route's box.
// `project` turns [lat, lon] into [east, north] metres; `line` is the route in those.
export function extractMap(osm, project, line, pad = 110) {
  const xy = (g) => { const [e, n] = project([g.lat, g.lon]); return [e, -n]; };
  const pts = line.map(([e, n]) => [e, -n]);
  const box = {
    x0: Math.min(...pts.map((p) => p[0])) - pad, x1: Math.max(...pts.map((p) => p[0])) + pad,
    y0: Math.min(...pts.map((p) => p[1])) - pad, y1: Math.max(...pts.map((p) => p[1])) + pad,
  };
  const areas = [];
  const lines = [];
  const buildings = [];
  const trees = [];

  const addArea = (kind, ring, extra = {}) => {
    const shape = clipPolygon(simplify(ring.map(xy), kind === 'building' ? 0.25 : 0.8), box);
    if (shape.length < 3) return;
    // A building keeps its map id, so pieces of it in neighbouring squares of map stay one house.
    if (kind === 'building') buildings.push(extra.id ? { p: flat(shape), h: extra.h, id: extra.id } : { p: flat(shape), h: extra.h });
    else areas.push({ k: kind, p: flat(shape) });
  };

  for (const el of osm.elements ?? []) {
    const t = el.tags ?? {};
    if (el.type === 'node') {
      if (t.natural === 'tree') {
        const [x, y] = xy(el);
        if (x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1) trees.push(round(x), round(y));
      }
      continue;
    }
    if (el.type === 'relation') {
      const kind = t.building ? 'building' : areaKind(t);
      if (!kind) continue;
      const outers = (el.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry);
      for (const ring of stitchRings(outers)) addArea(kind, ring, { h: buildingHeight(t), id: `r${el.id}` });
      continue;
    }
    const geom = el.geometry;
    if (!geom || geom.length < 2) continue;
    const closed = geom.length > 3 && geom[0].lat === geom[geom.length - 1].lat && geom[0].lon === geom[geom.length - 1].lon;
    if (t.building && closed) { addArea('building', geom, { h: buildingHeight(t), id: el.id ? `w${el.id}` : undefined }); continue; }
    const area = closed ? areaKind(t) : null;
    if (area) { addArea(area, geom); continue; }
    const kind = lineKind(t);
    if (!kind) continue;
    // Details the block view uses: the road type, its surface, lanes and pavements.
    const extra = {};
    const width = roadWidth(t);
    if (width) extra.w = width;
    if (t.highway) extra.hw = t.highway;
    if (t.surface) extra.s = t.surface;
    const lanes = parseInt(t.lanes, 10);
    if (lanes > 0 && lanes < 10) extra.l = lanes;
    const sidewalk = t.sidewalk ?? (t['sidewalk:both'] ? 'both' : t['sidewalk:left'] === 'yes' ? 'left' : t['sidewalk:right'] === 'yes' ? 'right' : undefined);
    if (sidewalk) extra.sw = sidewalk;
    for (const part of clipLine(simplify(geom.map(xy), 0.5), box)) lines.push({ k: kind, p: flat(part), ...extra });
  }
  areas.sort((a, b) => AREA_KINDS.indexOf(a.k) - AREA_KINDS.indexOf(b.k));
  return { areas, lines, buildings, trees };
}

// --- moving along the route ---

// A route line in map metres, measured, for finding points along it.
export function measureLine(flatLine) {
  const xs = [];
  const ys = [];
  for (let i = 0; i < flatLine.length; i += 2) {
    // Skip repeated points so every piece has a direction.
    if (xs.length && xs[xs.length - 1] === flatLine[i] && ys[ys.length - 1] === flatLine[i + 1]) continue;
    xs.push(flatLine[i]);
    ys.push(flatLine[i + 1]);
  }
  const at = [0];
  for (let i = 1; i < xs.length; i++) at.push(at[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  return { xs, ys, at, length: at[at.length - 1] };
}

// The point `d` metres along the route, and which way the route runs there.
export function pointAlong(m, d) {
  const { xs, ys, at } = m;
  if (xs.length === 1) return { x: xs[0], y: ys[0], tx: 1, ty: 0 };
  d = Math.max(0, Math.min(m.length, d));
  let lo = 0;
  let hi = at.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= d) lo = mid; else hi = mid;
  }
  const len = at[hi] - at[lo] || 1;
  const t = (d - at[lo]) / len;
  return {
    x: xs[lo] + (xs[hi] - xs[lo]) * t,
    y: ys[lo] + (ys[hi] - ys[lo]) * t,
    tx: (xs[hi] - xs[lo]) / len,
    ty: (ys[hi] - ys[lo]) / len,
  };
}

// How far along the route a point is, looking only between `from` and `to`
// metres (so a route that doubles back is read the right way).
export function distanceAlong(m, x, y, from = 0, to = m.length) {
  const { xs, ys, at } = m;
  let best = from;
  let bestOff = Infinity;
  for (let i = 1; i < xs.length; i++) {
    if (at[i] < from || at[i - 1] > to) continue;
    const dx = xs[i] - xs[i - 1];
    const dy = ys[i] - ys[i - 1];
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - xs[i - 1]) * dx + (y - ys[i - 1]) * dy) / len2));
    const off = Math.hypot(x - (xs[i - 1] + dx * t), y - (ys[i - 1] + dy * t));
    if (off < bestOff) { bestOff = off; best = at[i - 1] + t * (at[i] - at[i - 1]); }
  }
  return Math.max(from, Math.min(to, best));
}
