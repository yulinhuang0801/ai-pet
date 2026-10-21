// Draws a walk along a real route from above, in the 2D view: the streets,
// footpaths, houses, parks, water and trees that are really there (from
// OpenStreetMap, saved with the route), your route across them, and you and
// your pet walking it. A small map in the corner shows the whole route.
//
// Two looks: drawn from the map data, or on satellite photos of the real
// place (which need a key for the photo service; see setImagery).

import { VIEW_W, VIEW_H, LEASH } from './space-side.js';
import { MAP_UNITS_PER_METER as U } from './space-map.js';
import { drawOwnerTop, drawPetTop, drawCritterTop, OWNER_SPAN } from './topdown-art.js';
import {
  darkness, drawBubble, drawParticles, drawBone, drawImageItem, drawSparkleFind,
} from './renderer.js';
import { sign, landmarkName } from './route-art.js';
import { projector } from './route.js';
import { buildBlocks, B, CHUNK } from './blocks.js';
import { TILE, tileBox } from './explore.js';

// Screen pixels per map unit, which the mouse wheel changes. On satellite
// photos it can't go closer than the photos are sharp (`photoCap`).
let zoom = 0.2;
let photoCap = Infinity;
export function zoomMap(factor) { zoom = Math.min(0.5, photoCap, Math.max(0.06, zoom * factor)); }

// Buildings look this tall compared with their real height, so they don't hide too much.
const HEIGHT = 0.35;

const AREA_COLOURS = {
  residential: '#e7e6dc', commercial: '#eedfd8', farmland: '#ebe3bb', grass: '#bfe09c', park: '#acd88d',
  cemetery: '#bad6a6', woods: '#86b96f', pitch: '#93d27c', playground: '#d7eec4', parking: '#d9d5cc', beach: '#f2e2b4', water: '#8fc6ec',
  industrial: '#e2dcdc', flowerbed: '#c9a27e', plaza: '#e9e4da',
};
// Road widths in metres (when the map doesn't say) and colours.
const ROAD = {
  major: { w: 12, fill: '#c9cdd2', edge: '#adb2b8', centre: '#f3d98b' },
  minor: { w: 8, fill: '#d3d6da', edge: '#b8bcc1', centre: 'rgba(255,255,255,0.8)' },
  service: { w: 4, fill: '#d9dad8', edge: '#c3c4c1' },
  sidewalk: { w: 2.2, fill: '#f0eee8', edge: '#d8d4ca' },
  crossing: { w: 3, fill: '#f0eee8', edge: null },
  path: { w: 2, fill: '#e7d7ad', edge: null },
};
const ROAD_ORDER = ['path', 'sidewalk', 'service', 'minor', 'major', 'crossing'];
const ROOFS = ['#c8664a', '#b75a43', '#8c8f9a', '#a46e52', '#d38a5c', '#7b828e', '#c27a62'];
const WALLS = ['#f3e6d0', '#eadcc5', '#f6efe2', '#e7d6c0'];

function hash(i) {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// --- shapes, prepared once per route ---

const prepared = new WeakMap();

function boxOf(flat) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    x0 = Math.min(x0, flat[i]); x1 = Math.max(x1, flat[i]);
    y0 = Math.min(y0, flat[i + 1]); y1 = Math.max(y1, flat[i + 1]);
  }
  return { x0: x0 * U, y0: y0 * U, x1: x1 * U, y1: y1 * U };
}

function pathOf(flat, close) {
  const p = new Path2D();
  for (let i = 0; i < flat.length; i += 2) p[i ? 'lineTo' : 'moveTo'](flat[i] * U, flat[i + 1] * U);
  if (close) p.closePath();
  return p;
}

function prepare(route) {
  let m = prepared.get(route);
  // An explored area grows as you walk; draw it afresh when it does.
  if (m && m.version === route.version) return m;
  const map = route.map;
  m = {
    areas: map.areas.map((a) => ({ k: a.k, box: boxOf(a.p), path: pathOf(a.p, true) })),
    lines: map.lines.map((l) => ({ k: l.k, w: l.w, box: boxOf(l.p), path: pathOf(l.p, false) })),
    buildings: map.buildings.map((b, i) => {
      const pts = [];
      for (let k = 0; k < b.p.length; k += 2) pts.push([b.p[k] * U, b.p[k + 1] * U]);
      let area = 0;
      for (let k = 0; k < pts.length; k++) {
        const [x0, y0] = pts[k];
        const [x1, y1] = pts[(k + 1) % pts.length];
        area += x0 * y1 - x1 * y0;
      }
      const big = Math.abs(area / 2) / (U * U) > 600;
      return {
        pts, box: boxOf(b.p), lift: b.h * U * HEIGHT, clockwise: area > 0,
        roof: big ? '#b9b6b0' : ROOFS[Math.floor(hash(i) * ROOFS.length)],
        wall: big ? '#dedbd4' : WALLS[Math.floor(hash(i + 7) * WALLS.length)],
      };
    }),
    trees: [],
    route: pathOf(route.line, false),
    line: route.line,
  };
  for (let i = 0; i < map.trees.length; i += 2) m.trees.push({ x: map.trees[i] * U, y: map.trees[i + 1] * U, r: (2 + hash(i) * 1.2) * U });
  m.trees.push(...streetTrees(map));
  // Where the map's metres sit on the globe, for satellite photos (the same centre buildWalk used).
  const lats = route.points.map((p) => p[0]);
  const lons = route.points.map((p) => p[1]);
  m.origin = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lons) + Math.max(...lons)) / 2];
  const one = projector(m.origin)([m.origin[0] + 0.001, m.origin[1] + 0.001]);
  m.perDegree = { x: one[0] / 0.001, y: one[1] / 0.001 };
  m.version = route.version;
  prepared.set(route, m);
  return m;
}

// Most streets have trees that the map doesn't record one by one. In the
// drawn look, residential streets without any mapped trees nearby get a row
// on each side, between the road and the pavement, wherever there's room.
function streetTrees(map) {
  const CELL = 10;
  const grid = new Map();
  const put = (x, y, item) => {
    const k = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push({ ...item, x, y });
  };
  const near = (x, y) => {
    const out = [];
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${cx + i},${cy + j}`) ?? []));
    return out;
  };
  // Mapped trees count from further away: if there are any around, the map has this street's trees.
  const mappedNear = (x, y) => {
    for (let i = 0; i < map.trees.length; i += 2) if (Math.abs(map.trees[i] - x) < 25 && Math.abs(map.trees[i + 1] - y) < 25) return true;
    return false;
  };
  // Every road, every 2 m, with half its width, so trees stay off the tarmac.
  for (const l of map.lines) {
    const half = (l.w ?? ROAD[l.k]?.w ?? 0) / 2;
    if (!half) continue;
    for (let i = 2; i < l.p.length; i += 2) {
      const [ax, ay, bx, by] = [l.p[i - 2], l.p[i - 1], l.p[i], l.p[i + 1]];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
      for (let k = 0; k <= n; k++) put(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, { road: half });
    }
  }
  // Buildings are found by their corners and the points along their walls.
  map.buildings.forEach((b, idx) => {
    for (let i = 0; i < b.p.length; i += 2) {
      const j = (i + 2) % b.p.length;
      const n = Math.max(1, Math.ceil(Math.hypot(b.p[j] - b.p[i], b.p[j + 1] - b.p[i + 1]) / 8));
      for (let k = 0; k < n; k++) put(b.p[i] + ((b.p[j] - b.p[i]) * k) / n, b.p[i + 1] + ((b.p[j + 1] - b.p[i + 1]) * k) / n, { building: idx });
    }
  });
  for (let i = 0; i < map.trees.length; i += 2) put(map.trees[i], map.trees[i + 1], { tree: true });
  const trees = [];
  for (const l of map.lines) {
    if (l.k !== 'minor') continue;
    const half = (l.w ?? ROAD.minor.w) / 2;
    for (let i = 2; i < l.p.length; i += 2) {
      const [ax, ay, bx, by] = [l.p[i - 2], l.p[i - 1], l.p[i], l.p[i + 1]];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 12) continue;
      const tx = (bx - ax) / len;
      const ty = (by - ay) / len;
      // Not right at junctions, roughly every 9 m.
      for (let d = 7; d < len - 7; d += 9) {
        for (const side of [-1, 1]) {
          const seed = Math.round(ax * 7 + ay * 13 + d * 3 + side);
          if (hash(seed) < 0.3) continue;
          const off = half + 1.1;
          const x = ax + tx * (d + hash(seed + 1) * 2) - ty * off * side;
          const y = ay + ty * (d + hash(seed + 1) * 2) + tx * off * side;
          const around = near(x, y);
          // Not where the map has trees already, not in a house, and not on
          // another road (which means a junction).
          if (mappedNear(x, y)) continue;
          if (around.some((it) => it.tree)) continue;
          const houses = new Set(around.filter((it) => it.building !== undefined).map((it) => it.building));
          if ([...houses].some((idx) => nearShape(map.buildings[idx].p, x, y, 1.5))) continue;
          if (around.some((it) => it.road && Math.hypot(it.x - x, it.y - y) < it.road + 0.8)) continue;
          trees.push({ x: x * U, y: y * U, r: (1.7 + hash(seed + 2) * 1) * U });
        }
      }
    }
  }
  return trees;
}

// Inside a shape (a flat list of x, y), or within `gap` metres of its outline.
function nearShape(p, x, y, gap) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [p[i], p[i + 1], p[j], p[j + 1]];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xj - xi;
    const dy = yj - yi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - (xi + dx * t), y - (yi + dy * t)) < gap) return true;
  }
  return inside;
}

// --- the camera ---

function camera(world) {
  const c = world.mapCam;
  return { x: c.x - VIEW_W / 2 / zoom, y: c.y - VIEW_H / 2 / zoom };
}

// A point on the screen (in view pixels) to a map position.
export function mapToWorld(world, vx, vy) {
  const c = camera(world);
  return { x: c.x + vx / zoom, y: c.y + vy / zoom };
}

function toScreen(world, p) {
  const c = camera(world);
  return { x: (p.x - c.x) * zoom, y: (p.y - c.y) * zoom };
}

// --- drawing pieces, in map units ---

function drawBuilding(ctx, b, see) {
  const { pts, lift } = b;
  // A building between the viewer and you or your pet fades, so you can see them.
  const hides = (p) => p.x > b.box.x0 && p.x < b.box.x1 && p.y < b.box.y1 && p.y > b.box.y0 - lift;
  ctx.save();
  if (see.some(hides)) ctx.globalAlpha = 0.4;
  // Walls: only those facing south (toward the viewer) show.
  ctx.fillStyle = b.wall;
  ctx.strokeStyle = 'rgba(90, 70, 50, 0.25)';
  ctx.lineWidth = 6;
  for (let k = 0; k < pts.length; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[(k + 1) % pts.length];
    const outY = b.clockwise ? -(bx - ax) : bx - ax;
    if (outY <= 0) continue;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx, by - lift);
    ctx.lineTo(ax, ay - lift);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Windows along longer walls.
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.floor(len / (2.6 * U));
    if (n >= 1 && lift > 2.5 * U * HEIGHT) {
      ctx.fillStyle = 'rgba(70, 95, 120, 0.55)';
      for (let w = 0; w < n; w++) {
        const t = (w + 0.5) / n;
        const wx = ax + (bx - ax) * t;
        const wy = ay + (by - ay) * t;
        for (let f = 0.35; f < 0.95; f += 0.4) ctx.fillRect(wx - 0.35 * U, wy - lift * f - 0.4 * U, 0.7 * U, 0.8 * U);
      }
      ctx.fillStyle = b.wall;
    }
  }
  // Roof.
  ctx.beginPath();
  pts.forEach(([x, y], k) => ctx[k ? 'lineTo' : 'moveTo'](x, y - lift));
  ctx.closePath();
  ctx.fillStyle = b.roof;
  ctx.fill();
  ctx.strokeStyle = 'rgba(60, 40, 30, 0.35)';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();
}

function drawTree(ctx, t, dark) {
  const lift = t.r * 0.9;
  ctx.fillStyle = '#7a5a3e';
  ctx.fillRect(t.x - 0.18 * U, t.y - lift, 0.36 * U, lift);
  ctx.fillStyle = dark ? '#4f8a45' : '#5e9c4e';
  ctx.beginPath();
  ctx.arc(t.x, t.y - lift - t.r * 0.6, t.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dark ? '#5f9a52' : '#78b763';
  ctx.beginPath();
  ctx.arc(t.x - t.r * 0.28, t.y - lift - t.r * 0.85, t.r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

// Landmarks are round badges on the map, the same size on screen at any zoom.
const LANDMARK_ICONS = {
  dog_park: '🐕', playground: '🛝', fountain: '⛲', drinking_water: '🚰', cafe: '☕', ice_cream: '🍦',
  restaurant: '🍽️', bench: '🪑', shop: '🛍️',
};

function drawBadge(ctx, p, icon, fill = '#ffffff') {
  const r = 13 / zoom;
  ctx.fillStyle = 'rgba(30, 30, 20, 0.25)';
  ctx.beginPath();
  ctx.arc(p.x, p.y + 2 / zoom, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#1d6d64';
  ctx.lineWidth = 2 / zoom;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (icon) {
    ctx.font = `${15 / zoom}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(icon, p.x, p.y + 1 / zoom);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

// Start and finish: a teal dot and a chequered one.
function drawEnd(ctx, p, finish) {
  const r = 9 / zoom;
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = finish ? '#ffffff' : '#1d6d64';
  ctx.fill();
  if (finish) {
    ctx.clip();
    ctx.fillStyle = '#1f2a24';
    const c = r / 2;
    for (let i = -2; i < 2; i++) for (let j = -2; j < 2; j++) if ((i + j) % 2 === 0) ctx.fillRect(p.x + i * c, p.y + j * c, c, c);
  }
  ctx.restore();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5 / zoom;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// The leash, seen from above: it bows to one side when slack and pulls straight when tight.
function drawLeashTop(ctx, hand, collar, tension, colour, width) {
  const dx = collar.x - hand.x;
  const dy = collar.y - hand.y;
  const len = Math.hypot(dx, dy) || 1;
  const slack = Math.max(0, LEASH * 1.1 - len) * 0.35 * (1 - tension);
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hand.x, hand.y);
  ctx.quadraticCurveTo((hand.x + collar.x) / 2 - (dy / len) * slack, (hand.y + collar.y) / 2 + (dx / len) * slack, collar.x, collar.y);
  ctx.stroke();
}

// --- the small map in the corner ---

function drawMinimap(ctx, world, m) {
  const w = 150;
  const h = 104;
  const x0 = VIEW_W - w - 12;
  const y0 = 12;
  const line = m.line;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (let i = 0; i < line.length; i += 2) {
    minX = Math.min(minX, line[i]); maxX = Math.max(maxX, line[i]);
    minY = Math.min(minY, line[i + 1]); maxY = Math.max(maxY, line[i + 1]);
  }
  const k = Math.min((w - 20) / (maxX - minX || 1), (h - 20) / (maxY - minY || 1));
  const ox = x0 + (w - (maxX - minX) * k) / 2;
  const oy = y0 + (h - (maxY - minY) * k) / 2;
  const at = (x, y) => [ox + (x - minX) * k, oy + (y - minY) * k];
  ctx.fillStyle = 'rgba(250, 248, 240, 0.88)';
  ctx.strokeStyle = 'rgba(31, 42, 36, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#9fbdb7';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i < line.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](...at(line[i], line[i + 1]));
  ctx.stroke();
  // The part walked so far.
  const walked = world.owner.s / U;
  ctx.strokeStyle = '#1d6d64';
  ctx.beginPath();
  let d = 0;
  for (let i = 0; i < line.length; i += 2) {
    if (i) {
      const seg = Math.hypot(line[i] - line[i - 2], line[i + 1] - line[i - 1]);
      if (d + seg > walked) {
        const t = (walked - d) / (seg || 1);
        ctx.lineTo(...at(line[i - 2] + (line[i] - line[i - 2]) * t, line[i - 1] + (line[i + 1] - line[i - 1]) * t));
        break;
      }
      d += seg;
      ctx.lineTo(...at(line[i], line[i + 1]));
    } else ctx.moveTo(...at(line[0], line[1]));
  }
  ctx.stroke();
  const [fx, fy] = at(line[line.length - 2], line[line.length - 1]);
  ctx.fillStyle = '#1f2a24';
  ctx.fillRect(fx - 3, fy - 3, 6, 6);
  const [px, py] = at(world.owner.x / U, world.owner.y / U);
  ctx.fillStyle = '#e8566f';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

// --- the drawn look ---

function drawGround(ctx, m, visible, lines) {
  // Land use, then water and roads on top.
  for (const a of m.areas) {
    if (!visible(a.box)) continue;
    ctx.fillStyle = AREA_COLOURS[a.k];
    ctx.fill(a.path);
    if (a.k === 'pitch') { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.25 * U; ctx.stroke(a.path); }
    if (a.k === 'water') { ctx.strokeStyle = '#74b2dd'; ctx.lineWidth = 0.5 * U; ctx.stroke(a.path); }
  }
  for (const l of lines) {
    if (l.k === 'river' || l.k === 'stream') {
      ctx.strokeStyle = AREA_COLOURS.water;
      ctx.lineWidth = (l.w ?? (l.k === 'river' ? 9 : 2.5)) * U;
      ctx.stroke(l.path);
    }
  }
  // Kerbs first, then all the surfaces, so junctions join up.
  const width = (l) => (l.w ?? ROAD[l.k].w) * U;
  for (const kind of ROAD_ORDER) {
    const r = ROAD[kind];
    if (!r.edge) continue;
    ctx.strokeStyle = r.edge;
    for (const l of lines) if (l.k === kind) { ctx.lineWidth = width(l) + 0.6 * U; ctx.stroke(l.path); }
  }
  for (const kind of ROAD_ORDER) {
    const r = ROAD[kind];
    ctx.strokeStyle = r.fill;
    for (const l of lines) if (l.k === kind) { ctx.lineWidth = width(l); ctx.stroke(l.path); }
  }
  // Markings: a dashed line down the middle of streets, stripes on crossings.
  ctx.lineCap = 'butt';
  for (const l of lines) {
    const r = ROAD[l.k];
    if (r?.centre && width(l) >= 6 * U) {
      ctx.strokeStyle = r.centre;
      ctx.lineWidth = 0.15 * U;
      ctx.setLineDash(l.k === 'major' ? [] : [2.5 * U, 3 * U]);
      ctx.stroke(l.path);
    } else if (l.k === 'crossing') {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = width(l);
      ctx.setLineDash([0.5 * U, 0.6 * U]);
      ctx.stroke(l.path);
    }
  }
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  for (const l of lines) {
    if (l.k === 'rail') {
      ctx.strokeStyle = '#8f897e';
      ctx.lineWidth = 1.6 * U;
      ctx.setLineDash([0.3 * U, 0.9 * U]);
      ctx.stroke(l.path);
      ctx.setLineDash([]);
      ctx.lineWidth = 0.35 * U;
      ctx.stroke(l.path);
    } else if (l.k === 'fence' || l.k === 'hedge') {
      ctx.strokeStyle = l.k === 'hedge' ? '#6aa257' : 'rgba(120, 96, 70, 0.6)';
      ctx.lineWidth = (l.k === 'hedge' ? 0.9 : 0.15) * U;
      ctx.stroke(l.path);
    }
  }
}

// --- the satellite look ---

// The photo service in use, or null for the drawn look: { tileUrl(z, x, y), maxZoom, credit }.
let imagery = null;
const tileCache = new Map();
export function setImagery(source) {
  imagery = source;
  tileCache.clear();
}

function tileImage(url) {
  let img = tileCache.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    tileCache.set(url, img);
    // Keep the most recent few hundred.
    if (tileCache.size > 300) tileCache.delete(tileCache.keys().next().value);
  }
  return img;
}

// The sharpest photo level a route's place has, asked once per route and service.
const levels = new WeakMap();
function photoLevel(m) {
  if (!imagery.best) return imagery.maxZoom;
  let known = levels.get(m);
  if (!known || known.source !== imagery) {
    known = { source: imagery, z: imagery.maxZoom };
    levels.set(m, known);
    imagery.best(...m.origin).then((z) => { known.z = z; });
  }
  return known.z;
}

// Draws the photo tiles covering the view. While some are still loading, the
// drawn look (`fallback`) shows underneath.
function drawImagery(ctx, m, cam, fallback) {
  const [lat0, lon0] = m.origin;
  const toLatLon = (x, y) => [lat0 - y / U / m.perDegree.y, lon0 + x / U / m.perDegree.x];
  const toWorld = (lat, lon) => ({ x: (lon - lon0) * m.perDegree.x * U, y: -(lat - lat0) * m.perDegree.y * U });
  // A zoom level whose pixels are about as fine as the screen's, up to the sharpest there is.
  const ground = 156543.03 * Math.cos((lat0 * Math.PI) / 180); // metres per pixel at level 0
  const screenPx = ctx.canvas.width / VIEW_W; // device pixels per view pixel
  const maxZ = photoLevel(m);
  const z = Math.max(12, Math.min(maxZ, Math.round(Math.log2(ground * zoom * U * screenPx))));
  const n = 2 ** z;
  const tx = (lon) => ((lon + 180) / 360) * n;
  const ty = (lat) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const lonOf = (x) => (x / n) * 360 - 180;
  const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const [north, west] = toLatLon(cam.x, cam.y);
  const [south, east] = toLatLon(cam.x + VIEW_W / zoom, cam.y + VIEW_H / zoom);
  const ready = [];
  let missing = false;
  for (let x = Math.floor(tx(west)); x <= Math.floor(tx(east)); x++) {
    for (let y = Math.floor(ty(north)); y <= Math.floor(ty(south)); y++) {
      const img = tileImage(imagery.tileUrl(z, x, y));
      if (img.complete && img.naturalWidth) ready.push({ img, x, y });
      else missing = true;
    }
  }
  if (missing) fallback();
  for (const { img, x, y } of ready) {
    const a = toWorld(latOf(y), lonOf(x));
    const b = toWorld(latOf(y + 1), lonOf(x + 1));
    // A hair of overlap hides the seams between tiles.
    ctx.drawImage(img, a.x, a.y, b.x - a.x + 1 / zoom, b.y - a.y + 1 / zoom);
  }
}

export const imageryOn = () => Boolean(imagery);

// --- the block look ---

// Shown as blocks (true) or drawn from the map's shapes (false), when not on photos.
let blockLook = true;
export function setBlockLook(on) { blockLook = on; }

const BLOCK_COLOURS = {
  [B.GRASS]: [118, 176, 84], [B.DIRT]: [150, 112, 74], [B.SAND]: [226, 208, 150], [B.GRAVEL]: [150, 146, 140],
  [B.PAVEMENT]: [214, 211, 204], [B.PAVING]: [196, 178, 158], [B.ASPHALT]: [94, 97, 104], [B.PARKING]: [124, 126, 132],
  [B.WATER]: [72, 136, 212], [B.PITCH]: [92, 168, 82], [B.PLAYGROUND]: [214, 136, 92], [B.FARMLAND]: [160, 128, 72],
  [B.FOREST]: [84, 128, 64], [B.CYCLEWAY]: [176, 92, 82], [B.RAIL]: [86, 74, 62], [B.LINE]: [244, 244, 240],
  [B.LINE_YELLOW]: [238, 196, 64], [B.ZEBRA]: [242, 242, 238], [B.FLOWERS]: [200, 110, 150], [B.CEMETERY]: [108, 140, 92],
  [B.WOOD]: [150, 110, 64], [B.KERB]: [178, 178, 172], [B.FENCE]: [120, 90, 60], [B.HEDGE]: [58, 118, 52],
};
const ROOF_COLOURS = [[186, 104, 84], [160, 88, 72], [128, 132, 142], [176, 120, 88], [204, 140, 96], [112, 118, 130], [190, 128, 108]];
const LEAVES = [[64, 128, 56], [78, 146, 64], [56, 112, 50]];

// The blocks for a route, built once and kept.
function blocksFor(m, route, built) {
  m.blocks ??= built ?? buildBlocks(route.map, route.line);
  m.chunkImages ??= new Map();
  return m.blocks;
}

// Each block is an 8 by 8 pixel picture, drawn by rules: grass has blades,
// asphalt has grit, pavements are slabs, roofs have rows of tiles. Every
// pixel varies a little, so no two blocks look quite the same.
const PX = 8;
const KEEP_CHUNKS = 80;

const pick = (n) => hash(n);
function mix(rgb, k) { return [rgb[0] * k, rgb[1] * k, rgb[2] * k]; }

function texel(id, x, y, i, j, r, base) {
  const edge = x === 0 || y === 0;
  switch (id) {
    case B.GRASS: case B.FOREST: case B.CEMETERY:
      if (id === B.FOREST && r > 0.86) return [120, 96, 60];
      if (id === B.CEMETERY && (i * 3 + j) % 11 === 0 && x > 2 && x < 6 && y > 1 && y < 6) return [170, 170, 165];
      return mix(base, r < 0.22 ? 0.84 : r > 0.92 ? 1.14 : 1);
    case B.PITCH: return mix(base, (j % 4 < 2 ? 1.06 : 0.94) * (r < 0.2 ? 0.92 : 1));
    case B.FLOWERS:
      if (r > 0.8) return [[236, 120, 170], [246, 210, 80], [250, 250, 245]][Math.floor(pick(r * 1000) * 3)];
      return mix(BLOCK_COLOURS[B.GRASS], r < 0.3 ? 0.85 : 1);
    case B.PAVEMENT: return mix(base, edge ? 0.86 : r < 0.15 ? 0.95 : 1);
    case B.KERB: return mix(base, y === PX - 1 ? 0.8 : 1.05);
    case B.PAVING: {
      const row = Math.floor(y / 4);
      const mortar = y % 4 === 0 || (x + (row % 2) * 4 + (j % 2) * 2) % PX === 0;
      return mix(base, mortar ? 0.8 : 0.96 + r * 0.08);
    }
    case B.ASPHALT: case B.PARKING: case B.CYCLEWAY:
      return mix(base, r < 0.18 ? 0.86 : r > 0.94 ? 1.18 : 1);
    case B.LINE: case B.LINE_YELLOW: case B.ZEBRA: return mix(base, r < 0.12 ? 0.9 : 1);
    case B.WATER: return mix(base, (y + Math.floor(i * 3 + j * 5)) % 4 === 0 && (x + y) % 6 < 3 ? 1.18 : r < 0.2 ? 0.93 : 1);
    case B.DIRT: case B.SAND: case B.PLAYGROUND: return mix(base, r < 0.2 ? 0.85 : r > 0.9 ? 1.12 : 1);
    case B.GRAVEL: return mix(base, [0.8, 0.95, 1.1, 1.22][Math.floor(r * 4)]);
    case B.FARMLAND: return mix(base, y % 3 === 0 ? 0.78 : r < 0.2 ? 0.9 : 1);
    case B.RAIL: return y % 3 === 0 ? [112, 82, 56] : x === 2 || x === 5 ? [150, 150, 158] : mix(BLOCK_COLOURS[B.GRAVEL], 0.85 + r * 0.3);
    case B.WOOD: case B.FENCE: return mix(base, x % 4 === 0 ? 0.78 : 0.95 + r * 0.1);
    case B.HEDGE: return mix(base, r < 0.3 ? 0.8 : r > 0.85 ? 1.2 : 1);
    default: return mix(base, r < 0.2 ? 0.9 : 1);
  }
}

// One picture per chunk, built when first seen and kept while it's useful.
function chunkImage(m, c) {
  const key = `${c.ci},${c.cj}`;
  let canvas = m.chunkImages.get(key);
  if (canvas) {
    // Most recently used last.
    m.chunkImages.delete(key);
    m.chunkImages.set(key, canvas);
    return canvas;
  }
  canvas = document.createElement('canvas');
  canvas.width = CHUNK * PX;
  canvas.height = CHUNK * PX;
  const g = canvas.getContext('2d');
  const W = CHUNK * PX;
  const img = g.createImageData(W, W);
  const blocks = m.blocks;
  const grid = blocks.grid;
  const i0 = c.ci * CHUNK;
  const j0 = c.cj * CHUNK;
  const houseAt = (i, j) => {
    const nb = grid.chunkAt(i, j);
    if (!nb) return 0;
    const n = (j - nb.cj * CHUNK) * CHUNK + (i - nb.ci * CHUNK);
    return nb.block[n] === B.BUILDING ? nb.house[n] : 0;
  };
  const put = (i, j, x, y, rgb) => img.data.set([rgb[0], rgb[1], rgb[2], 255], (((j - j0) * PX + y) * W + (i - i0) * PX + x) * 4);
  for (let n = 0; n < CHUNK * CHUNK; n++) {
    const i = i0 + (n % CHUNK);
    const j = j0 + Math.floor(n / CHUNK);
    const id = c.block[n];
    if (id === B.BUILDING) {
      const house = c.house[n];
      const roof = ROOF_COLOURS[Math.floor(hash(house - 1) * ROOF_COLOURS.length)];
      // Outline where this house meets anything else; the south edge is darker, like a wall in shade.
      const n0 = houseAt(i, j - 1) !== house;
      const s0 = houseAt(i, j + 1) !== house;
      const w0 = houseAt(i - 1, j) !== house;
      const e0 = houseAt(i + 1, j) !== house;
      for (let y = 0; y < PX; y++) {
        for (let x = 0; x < PX; x++) {
          const r = hash((i * 8 + x) * 7919 + (j * 8 + y) * 104729);
          let k = (y + (j % 2) * 4) % 4 === 0 ? 0.86 : 0.97 + r * 0.06; // rows of tiles
          if ((n0 && y === 0) || (w0 && x === 0) || (e0 && x === PX - 1)) k = 0.66;
          if (s0 && y >= PX - 2) k = 0.55;
          put(i, j, x, y, mix(roof, k));
        }
      }
      continue;
    }
    const base = BLOCK_COLOURS[id] ?? BLOCK_COLOURS[B.GRASS];
    // Buildings cast a short shadow onto the ground to their south.
    const shade = houseAt(i, j - 1) ? 0.72 : houseAt(i - 1, j - 1) ? 0.85 : 1;
    for (let y = 0; y < PX; y++) {
      for (let x = 0; x < PX; x++) {
        const r = hash((i * 8 + x) * 7919 + (j * 8 + y) * 104729);
        put(i, j, x, y, mix(texel(id, x, y, i, j, r, base), shade));
      }
    }
  }
  // Tree tops, as blocky clumps of leaves.
  for (const t of blocks.trees) {
    if (t.x + t.r < i0 || t.x - t.r > i0 + CHUNK || t.y + t.r < j0 || t.y - t.r > j0 + CHUNK) continue;
    for (let j = Math.floor(t.y - t.r); j <= Math.ceil(t.y + t.r); j++) {
      for (let i = Math.floor(t.x - t.r); i <= Math.ceil(t.x + t.r); i++) {
        if (i < i0 || i >= i0 + CHUNK || j < j0 || j >= j0 + CHUNK) continue;
        const d = Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y);
        if (d > t.r) continue;
        const rim = d > t.r - 0.9;
        for (let y = 0; y < PX; y++) {
          for (let x = 0; x < PX; x++) {
            const r = hash((i * 8 + x) * 7919 + (j * 8 + y) * 104729 + 17);
            const leaf = LEAVES[Math.floor(r * LEAVES.length)];
            // Lit from the top left.
            const light = (i + x / PX - t.x) + (j + y / PX - t.y) < -t.r * 0.4 ? 1.15 : 1;
            put(i, j, x, y, mix(leaf, (rim ? 0.8 : 1) * light * (r > 0.9 ? 1.2 : 1)));
          }
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  m.chunkImages.set(key, canvas);
  if (m.chunkImages.size > KEEP_CHUNKS) m.chunkImages.delete(m.chunkImages.keys().next().value);
  return canvas;
}

function drawBlocks(ctx, m, route, cam, built) {
  const blocks = blocksFor(m, route, built);
  ctx.fillStyle = '#c9cebf';
  ctx.fillRect(cam.x, cam.y, VIEW_W / zoom, VIEW_H / zoom);
  const size = CHUNK * U;
  const ci0 = Math.floor(cam.x / size);
  const cj0 = Math.floor(cam.y / size);
  const ci1 = Math.floor((cam.x + VIEW_W / zoom) / size);
  const cj1 = Math.floor((cam.y + VIEW_H / zoom) / size);
  ctx.imageSmoothingEnabled = false;
  for (let ci = ci0; ci <= ci1; ci++) {
    for (let cj = cj0; cj <= cj1; cj++) {
      const c = blocks.grid.chunks.get(`${ci},${cj}`);
      // A hair of overlap hides the seams between chunks.
      if (c) ctx.drawImage(chunkImage(m, c), ci * size, cj * size, size + 1 / zoom, size + 1 / zoom);
    }
  }
  ctx.imageSmoothingEnabled = true;
}

// Exploring: a small map of what's loaded around you, your start, and you.
function drawAreaMap(ctx, world, area) {
  const w = 150;
  const h = 104;
  const x0 = VIEW_W - w - 12;
  const y0 = 12;
  const o = world.owner;
  const span = 600; // metres across
  const k = w / span;
  const at = (x, y) => [x0 + w / 2 + (x - o.x / U) * k, y0 + h / 2 + (y - o.y / U) * k];
  ctx.save();
  ctx.fillStyle = 'rgba(250, 248, 240, 0.88)';
  ctx.strokeStyle = 'rgba(31, 42, 36, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.clip();
  // Each loaded square, and roads in it.
  ctx.fillStyle = 'rgba(118, 176, 84, 0.45)';
  for (const [key, t] of area.explore.tiles) {
    if (t.state !== 'ready') continue;
    const [i, j] = key.split(',').map(Number);
    const b = tileBox(i, j);
    const [ax, ay] = at(b.x0, b.y0);
    ctx.fillRect(ax, ay, TILE * k, TILE * k);
  }
  ctx.strokeStyle = 'rgba(80, 84, 92, 0.7)';
  ctx.lineWidth = 1.2;
  for (const l of area.map.lines) {
    if (l.k !== 'major' && l.k !== 'minor') continue;
    ctx.beginPath();
    for (let i = 0; i < l.p.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](...at(l.p[i], l.p[i + 1]));
    ctx.stroke();
  }
  const [sx, sy] = at(0, 0);
  ctx.fillStyle = '#1d6d64';
  ctx.beginPath();
  ctx.arc(sx, sy, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8566f';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x0 + w / 2, y0 + h / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// --- the whole scene ---

export function drawMapWalk(ctx, world, { date = new Date(), time = world.time, images = {} } = {}) {
  // A saved route, or the area explored from a pinned spot: both have a map, landmarks and a line.
  const route = world.walk.route ?? world.walk.area;
  const m = prepare(route);
  if (imagery) {
    // Never enlarge the sharpest photos more than about two times.
    const ground = 156543.03 * Math.cos((m.origin[0] * Math.PI) / 180);
    photoCap = (2.2 * 2 ** photoLevel(m)) / (ground * U * (ctx.canvas.width / VIEW_W));
    zoom = Math.min(zoom, photoCap);
  } else photoCap = Infinity;
  const dark = darkness(date);
  const cam = camera(world);
  const view = { x0: cam.x - 600, y0: cam.y - 200, x1: cam.x + VIEW_W / zoom + 600, y1: cam.y + VIEW_H / zoom + 900 };
  const visible = (b) => b.x1 > view.x0 && b.x0 < view.x1 && b.y1 > view.y0 && b.y0 < view.y1;

  ctx.save();
  ctx.fillStyle = '#ebe7d8';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.scale(zoom, zoom);
  ctx.translate(-cam.x, -cam.y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const lines = m.lines.filter((l) => visible(l.box));
  const photo = Boolean(imagery);
  const blocky = !photo && blockLook;
  if (photo) drawImagery(ctx, m, cam, () => drawGround(ctx, m, visible, lines));
  else if (blocky) drawBlocks(ctx, m, route, cam, world.walk.blocks);
  else drawGround(ctx, m, visible, lines);
  // The photo or the blocks already show buildings and trees.
  const flat = photo || blocky;

  // Your route: dashed ahead, a soft trail where you've been.
  ctx.strokeStyle = 'rgba(29, 109, 100, 0.55)';
  ctx.lineWidth = 0.7 * U;
  ctx.setLineDash([2 * U, 1.6 * U]);
  ctx.stroke(m.route);
  ctx.setLineDash([]);

  // Shadows on the ground (a photo has its own).
  ctx.fillStyle = 'rgba(40, 50, 30, 0.16)';
  for (const t of flat ? [] : m.trees) {
    if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
    ctx.beginPath();
    ctx.ellipse(t.x + t.r * 0.25, t.y, t.r * 0.95, t.r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Everything standing up, back to front.
  const things = [];
  const see = [world.owner, world.body];
  for (const b of flat ? [] : m.buildings) if (visible(b.box)) things.push({ y: b.box.y1, draw: () => drawBuilding(ctx, b, see) });
  for (const t of flat ? [] : m.trees) {
    if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
    things.push({ y: t.y, draw: () => drawTree(ctx, t, dark > 0.5) });
  }
  const near = [];
  for (const lm of route.landmarks) {
    const p = { x: lm.x * U, y: lm.y * U };
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    near.push({ lm, p });
  }
  // Where the route starts and ends; exploring, where you started.
  const start = route.line.length ? { x: route.line[0] * U, y: route.line[1] * U } : { x: 0, y: 0 };
  const end = route.line.length ? { x: route.line[route.line.length - 2] * U, y: route.line[route.line.length - 1] * U } : null;

  const w = world.walk;
  if (w.find) {
    const f = w.find;
    things.push({ y: f.y, draw: () => { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1.6, 1.6); drawSparkleFind(ctx, { ...f, x: 0 }, time, 0); ctx.restore(); } });
  }
  if (w.critter) things.push({ y: w.critter.y, draw: () => drawCritterTop(ctx, w.critter, time, Math.max(U * 1.8, 18 / zoom)) });
  const treat = (x, y, size, angle) => (images.treat ? drawImageItem(ctx, images.treat, x, y, size * 16) : drawBone(ctx, x, y, size, angle));
  if (world.floorTreat) things.push({ y: world.floorTreat.y, draw: () => treat(world.floorTreat.x, world.floorTreat.y, 1.2, 0.2) });

  const o = world.owner;
  const b = world.body;
  const leashed = !w.offLeash;
  // Figures grow when the view is far out, so you can always see them.
  const k = U * Math.max(1, 34 / (OWNER_SPAN * U * zoom));
  let handPos = null;
  let collar = null;
  // The pet first, so you hold the leash above it.
  things.push({
    y: Math.min(b.y, o.y) - 1,
    draw: () => {
      collar = drawPetTop(ctx, world.pet, {
        x: b.x, y: b.y, heading: b.heading, pose: b.pose, gait: b.gait, speed: b.speed, wagPhase: b.wagPhase, jump: b.jump, time, scale: world.scale,
      }, k);
    },
  });
  things.push({
    y: Math.min(b.y, o.y),
    draw: () => {
      const hand = o.hand ?? (leashed ? collar : null);
      handPos = drawOwnerTop(ctx, world.pet.owner, { x: o.x, y: o.y, heading: o.heading, phase: o.phase, speed: o.speed, hand }, k);
      if (leashed && collar) drawLeashTop(ctx, handPos, collar, w.tension, world.pet.look.collar ?? '#d0443c', 0.07 * k);
    },
  });
  things.sort((p, q) => p.y - q.y);
  for (const t of things) t.draw();
  // Landmarks, start and finish on top, as markers.
  for (const { lm, p } of near) drawBadge(ctx, p, LANDMARK_ICONS[lm.kind]);
  drawEnd(ctx, start, false);
  if (end) drawEnd(ctx, end, true);

  if (world.drag?.item === 'treat') treat(world.drag.x, world.drag.y, 1.7, -0.3);
  drawParticles(ctx, world);
  ctx.restore();

  // Night.
  if (dark > 0) {
    ctx.fillStyle = `rgba(18, 24, 58, ${dark * 0.45})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // Names of the landmarks you're passing.
  for (const { lm, p } of near) {
    if (Math.hypot(p.x - o.x, p.y - o.y) > 20 * U) continue;
    const s = toScreen(world, p);
    sign(ctx, s.x, s.y - 16, landmarkName(lm));
  }
  if (route.explore) {
    drawAreaMap(ctx, world, route);
    if (!route.explore.ready(o.x / U, o.y / U) || route.explore.loading) {
      ctx.font = '600 13px Figtree, system-ui, sans-serif';
      const text = route.explore.ready(o.x / U, o.y / U) ? 'Loading more of the map…' : 'Loading the map around you…';
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(31, 42, 36, 0.82)';
      ctx.beginPath();
      ctx.roundRect(VIEW_W / 2 - tw / 2 - 12, 12, tw + 24, 28, 14);
      ctx.fill();
      ctx.fillStyle = '#f4f7f4';
      ctx.textAlign = 'center';
      ctx.fillText(text, VIEW_W / 2, 31);
      ctx.textAlign = 'left';
    }
  } else drawMinimap(ctx, world, m);

  if (world.bubble) {
    const s = toScreen(world, world.headPoint());
    drawBubble(ctx, world.bubble.text, s.x, s.y - 14, 'pet');
  }
  if (o.bubble) {
    const s = toScreen(world, o);
    drawBubble(ctx, o.bubble.text, s.x, s.y - 18, 'owner');
  }
  const credit = photo ? `${imagery.credit} · © OpenStreetMap contributors` : '© OpenStreetMap contributors';
  ctx.font = '500 10px Figtree, system-ui, sans-serif';
  const cw = ctx.measureText(credit).width;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(VIEW_W - cw - 12, VIEW_H - 18, cw + 12, 18);
  ctx.fillStyle = 'rgba(31, 42, 36, 0.8)';
  ctx.textAlign = 'right';
  ctx.fillText(credit, VIEW_W - 6, VIEW_H - 6);
  ctx.textAlign = 'left';
}
