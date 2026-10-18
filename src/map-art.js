// Draws a walk along a real route from above, in the 2D view: the streets,
// footpaths, houses, parks, water and trees that are really there (from
// OpenStreetMap, saved with the route), your route across them, and you and
// your pet walking it. A small map in the corner shows the whole route.
//
// Two looks: drawn from the map data, or on satellite photos of the real
// place (which need a key for the photo service; see setImagery).

import { VIEW_W, VIEW_H } from './space-side.js';
import { MAP_UNITS_PER_METER as U } from './space-map.js';
import { drawPet } from './pet-art.js';
import { drawOwner } from './owner-art.js';
import { unlocked } from './bond.js';
import {
  darkness, drawBubble, drawParticles, drawCritter, drawLeash, drawBone, drawImageItem, drawSparkleFind,
} from './renderer.js';
import { drawLandmark, sign, landmarkHeight, landmarkName } from './route-art.js';
import { projector } from './route.js';

// Screen pixels per map unit, which the mouse wheel changes.
let zoom = 0.2;
export function zoomMap(factor) { zoom = Math.min(0.5, Math.max(0.1, zoom * factor)); }

// Buildings look this tall compared with their real height, so they don't hide too much.
const HEIGHT = 0.35;

const AREA_COLOURS = {
  residential: '#e7e6dc', commercial: '#eedfd8', farmland: '#ebe3bb', grass: '#bfe09c', park: '#acd88d',
  cemetery: '#bad6a6', woods: '#86b96f', pitch: '#93d27c', playground: '#d7eec4', parking: '#d9d5cc', beach: '#f2e2b4', water: '#8fc6ec',
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
  if (m) return m;
  const map = route.map;
  m = {
    areas: map.areas.map((a) => ({ k: a.k, box: boxOf(a.p), path: pathOf(a.p, true) })),
    lines: map.lines.map((l) => ({ k: l.k, box: boxOf(l.p), path: pathOf(l.p, false) })),
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

function drawFlag(ctx, p, finish) {
  ctx.fillStyle = '#3d3a36';
  ctx.fillRect(p.x - 6, p.y - 200, 12, 200);
  ctx.fillStyle = finish ? '#1f2a24' : '#1d6d64';
  ctx.fillRect(p.x + 6, p.y - 200, 110, 64);
  if (finish) {
    ctx.fillStyle = '#f4f7f4';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2) ctx.fillRect(p.x + 6 + c * 27.5, p.y - 200 + r * 32, 27.5, 32);
  }
}

function drawMapCritter(ctx, c, time) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.scale(1.6, 1.6);
  // The side-on critter is drawn with its feet at 0; a bird rises as it flies off.
  drawCritter(ctx, c, 0, time, 0, -40);
  ctx.restore();
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

// Draws the photo tiles covering the view. While some are still loading, the
// drawn look (`fallback`) shows underneath.
function drawImagery(ctx, m, cam, fallback) {
  const [lat0, lon0] = m.origin;
  const toLatLon = (x, y) => [lat0 - y / U / m.perDegree.y, lon0 + x / U / m.perDegree.x];
  const toWorld = (lat, lon) => ({ x: (lon - lon0) * m.perDegree.x * U, y: -(lat - lat0) * m.perDegree.y * U });
  // A zoom level whose pixels are about as fine as the screen's.
  const metresPerPixel = 1 / (zoom * U * (window.devicePixelRatio || 1));
  const z = Math.max(12, Math.min(imagery.maxZoom, Math.round(Math.log2((156543.03 * Math.cos((lat0 * Math.PI) / 180)) / metresPerPixel))));
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

// --- the whole scene ---

export function drawMapWalk(ctx, world, { date = new Date(), time = world.time, images = {} } = {}) {
  const route = world.walk.route;
  const m = prepare(route);
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
  if (photo) drawImagery(ctx, m, cam, () => drawGround(ctx, m, visible, lines));
  else drawGround(ctx, m, visible, lines);

  // Your route: dashed ahead, a soft trail where you've been.
  ctx.strokeStyle = 'rgba(29, 109, 100, 0.55)';
  ctx.lineWidth = 0.7 * U;
  ctx.setLineDash([2 * U, 1.6 * U]);
  ctx.stroke(m.route);
  ctx.setLineDash([]);

  // Shadows on the ground (a photo has its own).
  ctx.fillStyle = 'rgba(40, 50, 30, 0.16)';
  for (const t of photo ? [] : m.trees) {
    if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
    ctx.beginPath();
    ctx.ellipse(t.x + t.r * 0.25, t.y, t.r * 0.95, t.r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Everything standing up, back to front.
  const things = [];
  const see = [world.owner, world.body];
  for (const b of photo ? [] : m.buildings) if (visible(b.box)) things.push({ y: b.box.y1, draw: () => drawBuilding(ctx, b, see) });
  for (const t of photo ? [] : m.trees) {
    if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
    things.push({ y: t.y, draw: () => drawTree(ctx, t, dark > 0.5) });
  }
  const near = [];
  for (const lm of route.landmarks) {
    const p = { x: lm.x * U, y: lm.y * U };
    if (p.x < view.x0 || p.x > view.x1 || p.y < view.y0 || p.y > view.y1) continue;
    near.push({ lm, p });
    things.push({
      y: p.y,
      draw: () => { ctx.save(); ctx.translate(p.x, p.y); ctx.scale(2.2, 2.2); drawLandmark(ctx, lm, 0, 0, false); ctx.restore(); },
    });
  }
  const start = { x: route.line[0] * U, y: route.line[1] * U };
  const end = { x: route.line[route.line.length - 2] * U, y: route.line[route.line.length - 1] * U };
  things.push({ y: start.y, draw: () => drawFlag(ctx, start, false) });
  things.push({ y: end.y, draw: () => drawFlag(ctx, end, true) });

  const w = world.walk;
  if (w.find) {
    const f = w.find;
    things.push({ y: f.y, draw: () => { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(1.6, 1.6); drawSparkleFind(ctx, { ...f, x: 0 }, time, 0); ctx.restore(); } });
  }
  if (w.critter) things.push({ y: w.critter.y, draw: () => drawMapCritter(ctx, w.critter, time) });
  const treat = (x, y, size, angle) => (images.treat ? drawImageItem(ctx, images.treat, x, y, size * 16) : drawBone(ctx, x, y, size, angle));
  if (world.floorTreat) things.push({ y: world.floorTreat.y, draw: () => treat(world.floorTreat.x, world.floorTreat.y, 1.2, 0.2) });

  const o = world.owner;
  const b = world.body;
  const leashed = !w.offLeash;
  let handPos = null;
  things.push({
    y: o.y,
    draw: () => {
      let hand = o.hand;
      if (leashed && !hand) {
        const toward = Math.sign(b.x - o.x) || o.dir;
        hand = { x: o.x + toward * (34 + w.tension * 24), y: o.y - 150 + w.tension * 20 };
      }
      handPos = drawOwner(ctx, world.pet.owner, { x: o.x, dir: o.dir, phase: o.phase, speed: o.speed, crouch: o.crouch, time, hand }, o.y);
    },
  });
  things.push({
    y: b.y + 1,
    draw: () => drawPet(ctx, world.pet, {
      x: b.x, y: b.y - b.jump, jump: b.jump, scale: world.scale, dir: b.dir, pose: b.pose,
      gait: b.gait, speed: b.speed, wagPhase: b.wagPhase, time, holdingBall: false, goldTag: unlocked(world.pet, 'goldTag'),
    }),
  });
  things.sort((p, q) => p.y - q.y);
  for (const t of things) t.draw();
  if (leashed && handPos) drawLeash(ctx, world, handPos);

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
    if (Math.hypot(p.x - o.x, p.y - o.y) > 14 * U) continue;
    const s = toScreen(world, { x: p.x, y: p.y - landmarkHeight(lm) * 2.2 });
    sign(ctx, s.x, s.y, landmarkName(lm));
  }
  drawMinimap(ctx, world, m);

  if (world.bubble) {
    const head = world.headPoint();
    const s = toScreen(world, { x: head.x, y: head.y - 26 * world.scale });
    drawBubble(ctx, world.bubble.text, s.x, s.y, 'pet');
  }
  if (o.bubble) {
    const s = toScreen(world, { x: o.x + o.dir * 10, y: o.y - 330 + o.crouch * 52 });
    drawBubble(ctx, o.bubble.text, s.x, s.y, 'owner');
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
