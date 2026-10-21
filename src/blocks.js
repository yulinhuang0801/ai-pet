// The map around a route as blocks, the way Minecraft builds a world: a grid
// of 1 m squares, each one grass, pavement, road, building, water and so on.
// The rules for which map feature becomes which block, and how wide each kind
// of road is, follow Arnis (github.com/louis-e/arnis, Apache 2.0), which
// rebuilds OpenStreetMap places in Minecraft.
//
// Only the squares near the route exist, in chunks of 32 by 32, so a long
// walk stays small. Positions are map metres: x east, y south. Pure, so it
// works in any view and is tested offline.

export const CHUNK = 32;

// Block ids, one byte each. Ground first, then things that stand up.
export const B = {
  NONE: 0,
  GRASS: 1, DIRT: 2, SAND: 3, GRAVEL: 4, PAVEMENT: 5, PAVING: 6, ASPHALT: 7, PARKING: 8,
  WATER: 9, PITCH: 10, PLAYGROUND: 11, FARMLAND: 12, FOREST: 13, CYCLEWAY: 14, RAIL: 15,
  LINE: 16, LINE_YELLOW: 17, ZEBRA: 18, FLOWERS: 19, CEMETERY: 20, WOOD: 21, KERB: 22,
  BUILDING: 32, FENCE: 33, HEDGE: 34,
};

// Squares you can't walk on or through.
export const SOLID = new Set([B.BUILDING, B.FENCE, B.HEDGE, B.WATER]);

// --- what each map feature becomes ---

// Ground for areas of land (Arnis: landuse.rs; residential land is gardens and yards).
const AREA_BLOCK = {
  residential: B.GRASS, commercial: B.PAVING, industrial: B.GRAVEL, farmland: B.FARMLAND, grass: B.GRASS,
  park: B.GRASS, cemetery: B.CEMETERY, woods: B.FOREST, flowerbed: B.FLOWERS, pitch: B.PITCH,
  playground: B.PLAYGROUND, parking: B.PARKING, plaza: B.PAVING, beach: B.SAND, water: B.WATER,
};

// The `surface=*` of a road or path (Arnis: surfaces.rs).
function surfaceBlock(surface) {
  switch (surface) {
    case 'sand': return B.SAND;
    case 'grass': case 'grass_paver': return B.GRASS;
    case 'dirt': case 'ground': case 'earth': case 'soil': case 'unpaved': case 'mud': return B.DIRT;
    case 'mulch': case 'woodchips': return B.DIRT;
    case 'gravel': case 'fine_gravel': case 'compacted': case 'pebblestone': return B.GRAVEL;
    case 'paving_stones': case 'sett': case 'cobblestone': case 'bricks': case 'brick': return B.PAVING;
    case 'concrete': return B.PAVEMENT;
    case 'wood': return B.WOOD;
    case 'asphalt': case 'paved': case 'chipseal': return B.ASPHALT;
    default: return null;
  }
}

const PATHS = ['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'track', 'bridleway', 'corridor'];

// The block a road or path is made of: by its surface, else by its type.
function wayBlock(line) {
  const hw = line.hw;
  if (line.k === 'sidewalk') return line.s === 'paving_stones' ? B.PAVING : B.PAVEMENT;
  if (line.k === 'crossing') return B.ZEBRA;
  if (hw === 'cycleway' && !line.s) return B.CYCLEWAY;
  const bySurface = surfaceBlock(line.s);
  if (bySurface !== null) return bySurface;
  if (hw === 'path' || hw === 'track' || hw === 'bridleway') return B.DIRT;
  if (hw === 'footway' || hw === 'pedestrian' || hw === 'steps' || hw === 'corridor') return B.PAVEMENT;
  if (line.k === 'path') return B.PAVEMENT;
  return B.ASPHALT;
}

// Lanes a road has when the map doesn't say (Arnis: highway_default_lanes).
function defaultLanes(hw) {
  if (['motorway', 'primary', 'trunk', 'secondary', 'tertiary'].includes(hw)) return 2;
  if (['residential', 'unclassified', 'living_street', 'road'].includes(hw)) return 2;
  return 1;
}

// A road's width in whole metres (Arnis: highway_block_range, 2 × range + 1).
export function wayWidth(line) {
  if (line.w) return Math.max(1, Math.round(line.w));
  const hw = line.hw ?? { major: 'secondary', minor: 'residential', service: 'service', path: 'footway', sidewalk: 'footway', crossing: 'footway' }[line.k];
  if (line.k === 'sidewalk') return 2;
  if (line.k === 'crossing') return 3;
  if (PATHS.includes(hw)) return hw === 'track' || hw === 'pedestrian' ? 3 : 2;
  const base = { motorway: 5, primary: 5, trunk: 5, secondary: 4, tertiary: 2, service: 2, secondary_link: 1, tertiary_link: 1 }[hw] ?? 2;
  const lanes = Math.min(16, Math.max(1, line.l ?? defaultLanes(hw)));
  const range = Math.max(base, Math.round((lanes * 3.5 - 1) / 2));
  return range * 2 + 1;
}

// Painted lane lines: busy roads and any road with three lanes or more.
function painted(line) {
  const hw = line.hw;
  if (!hw || line.k === 'path' || line.k === 'sidewalk' || line.k === 'crossing') return null;
  const lanes = line.l ?? defaultLanes(hw);
  if (['residential', 'living_street', 'service', 'track', 'unclassified', 'road'].includes(hw) && lanes < 3) return null;
  if (lanes < 2) return null;
  return { lanes, yellow: line.k === 'major' };
}

// Which sides of a road get a pavement. Untagged roads get one each side,
// unless the map draws this road's pavements as separate lines alongside it.
function pavementSides(line, separate) {
  if (line.k !== 'major' && line.k !== 'minor') return [];
  const sw = line.sw;
  if (sw === 'no' || sw === 'none' || sw === 'separate') return [];
  if (sw === 'both' || sw === 'yes') return [-1, 1];
  if (sw === 'left') return [-1];
  if (sw === 'right') return [1];
  return separate(line) ? [] : [-1, 1];
}

// Whether a road has pavements drawn as their own lines running beside it.
function separatePavements(sidewalks) {
  const near = new Set();
  for (const l of sidewalks) alongLine(l.p, 3, 0, (x, y) => near.add(`${Math.floor(x / 4)},${Math.floor(y / 4)}`));
  return (road) => {
    const reach = wayWidth(road) / 2 + 5;
    let hits = 0;
    let total = 0;
    alongLine(road.p, 8, 4, (x, y, tx, ty) => {
      total++;
      for (const side of [-1, 1]) {
        let found = false;
        for (let d = 2; d <= reach && !found; d += 2) found = near.has(`${Math.floor((x - ty * d * side) / 4)},${Math.floor((y + tx * d * side) / 4)}`);
        if (found) { hits++; break; }
      }
    });
    return total > 0 && hits / total > 0.4;
  };
}

// --- the grid ---

class Grid {
  constructor() {
    this.chunks = new Map();
    // While a new area is painted, only its own chunks change.
    this.only = null;
  }

  key(ci, cj) { return `${ci},${cj}`; }

  add(ci, cj) {
    const k = this.key(ci, cj);
    if (!this.chunks.has(k)) this.chunks.set(k, { ci, cj, block: new Uint8Array(CHUNK * CHUNK), height: null, house: null });
  }

  chunkAt(i, j) { return this.chunks.get(this.key(Math.floor(i / CHUNK), Math.floor(j / CHUNK))); }

  get(i, j) {
    const c = this.chunkAt(i, j);
    return c ? c.block[(j - c.cj * CHUNK) * CHUNK + (i - c.ci * CHUNK)] : B.NONE;
  }

  set(i, j, id) {
    const c = this.chunkAt(i, j);
    if (c && (!this.only || this.only.has(c))) c.block[(j - c.cj * CHUNK) * CHUNK + (i - c.ci * CHUNK)] = id;
  }

  // A building square: its height in metres and which building it is (for its roof colour).
  setBuilding(i, j, height, index) {
    const c = this.chunkAt(i, j);
    if (!c || (this.only && !this.only.has(c))) return;
    const n = (j - c.cj * CHUNK) * CHUNK + (i - c.ci * CHUNK);
    c.block[n] = B.BUILDING;
    c.height ??= new Uint8Array(CHUNK * CHUNK);
    c.house ??= new Uint16Array(CHUNK * CHUNK);
    c.height[n] = Math.min(255, Math.round(height));
    c.house[n] = index + 1;
  }
}

// Blocks with nothing in them yet. With `outsideSolid`, squares that haven't
// been built count as solid, so nobody walks off the edge of what's loaded.
export function emptyBlocks({ outsideSolid = false } = {}) {
  const grid = new Grid();
  return {
    grid, trees: [], outsideSolid, houses: 0, houseIds: new Map(),
    get chunks() { return [...grid.chunks.values()]; },
    get: (i, j) => grid.get(i, j),
  };
}

// Builds the squares of a box (map metres: x0, y0, x1, y1, on chunk edges)
// from map data that covers it, plus a margin so roads and buildings at the
// edge come out whole. Squares outside the box are left alone.
export function addArea(blocks, map, box) {
  const grid = blocks.grid;
  const fresh = new Set();
  for (let ci = Math.floor(box.x0 / CHUNK); ci < Math.ceil(box.x1 / CHUNK); ci++) {
    for (let cj = Math.floor(box.y0 / CHUNK); cj < Math.ceil(box.y1 / CHUNK); cj++) {
      if (grid.chunks.has(grid.key(ci, cj))) continue;
      grid.add(ci, cj);
      fresh.add(grid.chunks.get(grid.key(ci, cj)));
    }
  }
  grid.only = fresh;
  paint(blocks, map, fresh, box);
  grid.only = null;
}

// Every square whose middle is inside a shape (a flat list of x, y), row by row.
function fillPolygon(p, each) {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 1; i < p.length; i += 2) { y0 = Math.min(y0, p[i]); y1 = Math.max(y1, p[i]); }
  for (let j = Math.floor(y0); j <= Math.ceil(y1); j++) {
    const y = j + 0.5;
    const xs = [];
    for (let a = 0, b = p.length - 2; a < p.length; b = a, a += 2) {
      const [xa, ya, xb, yb] = [p[a], p[a + 1], p[b], p[b + 1]];
      if ((ya > y) !== (yb > y)) xs.push(xa + ((y - ya) * (xb - xa)) / (yb - ya));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let i = Math.ceil(xs[k] - 0.5); i <= Math.floor(xs[k + 1] - 0.5); i++) each(i, j);
    }
  }
}

// Every square within `half` metres of a line, with how far along the line it is
// and which side of it (for markings and pavements).
function strokeLine(p, half, each) {
  let run = 0;
  for (let a = 2; a < p.length; a += 2) {
    const [ax, ay, bx, by] = [p[a - 2], p[a - 1], p[a], p[a + 1]];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    for (let j = Math.floor(Math.min(ay, by) - half); j <= Math.ceil(Math.max(ay, by) + half); j++) {
      for (let i = Math.floor(Math.min(ax, bx) - half); i <= Math.ceil(Math.max(ax, bx) + half); i++) {
        const cx = i + 0.5;
        const cy = j + 0.5;
        const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / (len * len)));
        const off = ((cx - ax) * dy - (cy - ay) * dx) / len; // signed: which side
        const dist = Math.hypot(cx - (ax + dx * t), cy - (ay + dy * t));
        if (dist <= half) each(i, j, run + t * len, off);
      }
    }
    run += len;
  }
}

// Points along a line every `step` metres, with the direction there.
function alongLine(p, step, from, each) {
  let run = 0;
  let next = from;
  for (let a = 2; a < p.length; a += 2) {
    const [ax, ay, bx, by] = [p[a - 2], p[a - 1], p[a], p[a + 1]];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    while (next <= run + len) {
      const t = (next - run) / len;
      each(ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len, next);
      next += step;
    }
    run += len;
  }
}

function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// The blocks around a route. `map` is the map saved with it (route-map.js) and
// `line` the route itself, both in map metres. Squares within `reach` metres
// of the route exist; the rest don't.
export function buildBlocks(map, line, { reach = 90 } = {}) {
  const blocks = emptyBlocks();
  const grid = blocks.grid;
  // The chunks the route passes near.
  const pad = reach + CHUNK;
  const pts = [];
  for (let a = 0; a < line.length; a += 2) pts.push([line[a], line[a + 1]]);
  pts.forEach(([ax, ay], n) => {
    const [bx, by] = pts[n + 1] ?? pts[n];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CHUNK / 2)));
    for (let s = 0; s <= steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const y = ay + ((by - ay) * s) / steps;
      for (let ci = Math.floor((x - pad) / CHUNK); ci <= Math.floor((x + pad) / CHUNK); ci++) {
        for (let cj = Math.floor((y - pad) / CHUNK); cj <= Math.floor((y + pad) / CHUNK); cj++) {
          // Keep chunks whose nearest point is within reach.
          const nx = Math.max(ci * CHUNK, Math.min(x, (ci + 1) * CHUNK));
          const ny = Math.max(cj * CHUNK, Math.min(y, (cj + 1) * CHUNK));
          if (Math.hypot(nx - x, ny - y) <= reach) grid.add(ci, cj);
        }
      }
    }
  });

  paint(blocks, map, new Set(grid.chunks.values()));
  return blocks;
}

// Paints map data onto the blocks: the `fresh` chunks start as grass. Trees are
// kept only inside `box`, when given, so pieces of map that overlap don't
// plant the same tree twice.
function paint(blocks, map, fresh, box = null) {
  const grid = blocks.grid;
  // Buildings are numbered across every piece of map, for their roof colours.
  const firstHouse = blocks.houses;
  blocks.houses += map.buildings.length;

  // 1. Ground: grass everywhere (Arnis's default), then land use on top in order.
  for (const c of fresh) c.block.fill(B.GRASS);
  for (const a of map.areas) {
    const id = AREA_BLOCK[a.k];
    if (id) fillPolygon(a.p, (i, j) => grid.set(i, j, id));
  }

  // 2. Water lines, then paths, pavements, roads and their markings, narrowest first
  //    so a road always wins where it meets a path.
  for (const l of map.lines) {
    if (l.k === 'river' || l.k === 'stream') strokeLine(l.p, (l.w ?? (l.k === 'river' ? 9 : 2)) / 2, (i, j) => grid.set(i, j, B.WATER));
  }
  const separate = separatePavements(map.lines.filter((l) => l.k === 'sidewalk'));
  const ways = map.lines.filter((l) => ['path', 'sidewalk', 'crossing', 'service', 'minor', 'major'].includes(l.k));
  const order = { path: 0, sidewalk: 1, service: 2, minor: 3, major: 4, crossing: 5 };
  ways.sort((p, q) => order[p.k] - order[q.k]);
  // Pavements beside roads go down before any road, so crossing roads cut through them.
  for (const l of ways) {
    const sides = pavementSides(l, separate);
    if (!sides.length) continue;
    const half = wayWidth(l) / 2;
    strokeLine(l.p, half + 2, (i, j, d, off) => {
      if (Math.abs(off) > half && sides.includes(Math.sign(off))) grid.set(i, j, Math.abs(off) <= half + 0.6 ? B.KERB : B.PAVEMENT);
    });
  }
  // Which road each square belongs to, to leave lane lines out of junctions.
  const owner = new Map();
  ways.forEach((l, n) => {
    if (!['service', 'minor', 'major'].includes(l.k)) return;
    const half = wayWidth(l) / 2;
    strokeLine(l.p, half, (i, j) => {
      const key = i * 100003 + j;
      const was = owner.get(key);
      owner.set(key, was === undefined || was === n ? n : -1);
    });
  });
  for (const l of ways) {
    const id = wayBlock(l);
    const half = wayWidth(l) / 2;
    if (l.k === 'crossing') {
      // Zebra stripes across the road, half a metre each.
      strokeLine(l.p, half, (i, j, d) => grid.set(i, j, Math.floor(d / 0.7) % 2 ? B.ZEBRA : B.ASPHALT));
      continue;
    }
    strokeLine(l.p, half, (i, j) => grid.set(i, j, id));
  }
  for (const l of ways) {
    const paint = painted(l);
    if (!paint) continue;
    const width = wayWidth(l);
    const laneW = width / paint.lanes;
    // Lines between lanes: the middle one solid (yellow on main roads), the rest dashed.
    strokeLine(l.p, width / 2, (i, j, d, off) => {
      if (owner.get(i * 100003 + j) === -1) return;
      const from = off + width / 2;
      for (let n = 1; n < paint.lanes; n++) {
        if (Math.abs(from - n * laneW) > 0.45) continue;
        const middle = n * 2 === paint.lanes;
        if (middle || d % 6 < 3) grid.set(i, j, middle && paint.yellow ? B.LINE_YELLOW : B.LINE);
      }
    });
  }
  for (const l of map.lines) {
    if (l.k === 'rail') strokeLine(l.p, 1.5, (i, j, d, off) => grid.set(i, j, Math.abs(Math.abs(off) - 0.7) < 0.3 ? B.RAIL : B.GRAVEL));
  }

  // 3. Buildings, then fences and hedges.
  map.buildings.forEach((b, index) => {
    // The same building in two pieces of map gets the same number, so it stays one house.
    let n = firstHouse + index;
    if (b.id) {
      if (!blocks.houseIds.has(b.id)) blocks.houseIds.set(b.id, n);
      n = blocks.houseIds.get(b.id);
    }
    fillPolygon(b.p, (i, j) => grid.setBuilding(i, j, b.h ?? 7, n));
  });
  for (const l of map.lines) {
    if (l.k === 'fence' || l.k === 'hedge') strokeLine(l.p, l.k === 'hedge' ? 0.6 : 0.35, (i, j) => grid.set(i, j, l.k === 'hedge' ? B.HEDGE : B.FENCE));
  }

  const inBox = (t) => !box || (t.x >= box.x0 && t.x < box.x1 && t.y >= box.y0 && t.y < box.y1);
  blocks.trees.push(...placeTrees(map, grid).filter(inBox));
}

// Trees: the ones the map has, plus a row along residential streets where it
// has none nearby, standing in the pavement or verge next to the kerb.
function placeTrees(map, grid) {
  const trees = [];
  const mapped = [];
  for (let i = 0; i < map.trees.length; i += 2) {
    trees.push({ x: map.trees[i], y: map.trees[i + 1], r: 2 + hash(i) * 1.2 });
    mapped.push([map.trees[i], map.trees[i + 1]]);
  }
  const hasMappedNear = (x, y) => mapped.some(([tx, ty]) => Math.abs(tx - x) < 25 && Math.abs(ty - y) < 25);
  for (const l of map.lines) {
    if (l.k !== 'minor' || l.hw === 'service') continue;
    const half = wayWidth(l) / 2;
    alongLine(l.p, 9, 6, (x, y, tx, ty, d) => {
      for (const side of [-1, 1]) {
        const seed = Math.round(x * 7 + y * 13 + d + side);
        if (hash(seed) < 0.25) continue;
        const off = half + 1.2;
        const px = x - ty * off * side;
        const py = y + tx * off * side;
        const here = grid.get(Math.floor(px), Math.floor(py));
        if (here !== B.PAVEMENT && here !== B.KERB && here !== B.GRASS) continue;
        if (hasMappedNear(px, py)) continue;
        // Not at a junction: no other road within a few metres.
        let clear = true;
        for (let dj = -3; dj <= 3 && clear; dj++) {
          for (let di = -3; di <= 3; di++) {
            const b = grid.get(Math.floor(px) + di, Math.floor(py) + dj);
            if (b === B.ZEBRA || b === B.BUILDING) { clear = false; break; }
          }
        }
        const across = grid.get(Math.floor(px + tx * 4), Math.floor(py + ty * 4)) === B.ASPHALT && grid.get(Math.floor(px - tx * 4), Math.floor(py - ty * 4)) === B.ASPHALT;
        if (clear && !across) trees.push({ x: px, y: py, r: 1.8 + hash(seed + 2), street: true });
      }
    });
  }
  return trees;
}

// Can you stand on this square? (Off the grid counts as open ground.)
// Streets, pavements and paths: where a walk can always go on from.
export const STREETS = new Set([B.ASPHALT, B.PAVEMENT, B.KERB, B.PAVING, B.DIRT, B.GRAVEL, B.CYCLEWAY, B.ZEBRA, B.LINE, B.LINE_YELLOW, B.PARKING]);

// The open square nearest a point (map metres), searching out to `reach`
// metres, or null. Its middle is returned. With `only`, just squares of those kinds.
export function nearestOpen(blocks, x, y, reach = 40, only = null) {
  let best = null;
  // Rings of squares outward; a square in a later ring can still be nearer, so look one ring on.
  for (let r = 0; r <= reach && !(best && r > best.d + 1); r++) {
    for (let j = Math.floor(y) - r; j <= Math.floor(y) + r; j++) {
      for (let i = Math.floor(x) - r; i <= Math.floor(x) + r; i++) {
        if (Math.max(Math.abs(i - Math.floor(x)), Math.abs(j - Math.floor(y))) !== r) continue;
        if (!walkable(blocks, i + 0.5, j + 0.5)) continue;
        if (only && !only.has(blocks.get(i, j))) continue;
        // Somewhere with room to stand, not a gap between two houses.
        if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([di, dj]) => walkable(blocks, i + di + 0.5, j + dj + 0.5))) continue;
        const d = Math.hypot(i + 0.5 - x, j + 0.5 - y);
        if (!best || d < best.d) best = { x: i + 0.5, y: j + 0.5, d };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

export function walkable(blocks, x, y) {
  const id = blocks.get(Math.floor(x), Math.floor(y));
  if (id === B.NONE) return !blocks.outsideSolid;
  return !SOLID.has(id);
}
