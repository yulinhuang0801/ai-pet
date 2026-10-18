// Draws a walk along a real route from above, in the 2D view: the streets,
// footpaths, houses, parks, water and trees that are really there (from
// OpenStreetMap, saved with the route), your route across them, and you and
// your pet walking it. A small map in the corner shows the whole route.

import { VIEW_W, VIEW_H } from './space-side.js';
import { MAP_UNITS_PER_METER as U } from './space-map.js';
import { drawPet } from './pet-art.js';
import { drawOwner } from './owner-art.js';
import { unlocked } from './bond.js';
import {
  darkness, drawBubble, drawParticles, drawCritter, drawLeash, drawBone, drawImageItem, drawSparkleFind,
} from './renderer.js';
import { drawLandmark, sign, landmarkHeight, landmarkName } from './route-art.js';

// Screen pixels per map unit, which the mouse wheel changes.
let zoom = 0.22;
export function zoomMap(factor) { zoom = Math.min(0.5, Math.max(0.1, zoom * factor)); }

// Buildings look this tall compared with their real height, so they don't hide too much.
const HEIGHT = 0.55;

const AREA_COLOURS = {
  residential: '#e6e1d2', commercial: '#eedfd8', farmland: '#ebe3bb', grass: '#bfe09c', park: '#acd88d',
  cemetery: '#bad6a6', woods: '#86b96f', pitch: '#93d27c', playground: '#d7eec4', parking: '#d9d5cc', beach: '#f2e2b4', water: '#8fc6ec',
};
const ROAD = {
  major: { w: 11, fill: '#fbf1d9', edge: '#d1c3a6' },
  minor: { w: 7, fill: '#ffffff', edge: '#cdc6b8' },
  service: { w: 4, fill: '#f8f6f1', edge: '#d3cdc1' },
  path: { w: 2, fill: '#ecdcb6', edge: null },
};
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
  prepared.set(route, m);
  return m;
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

function drawBuilding(ctx, b) {
  const { pts, lift } = b;
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

  // The ground: land use, then water and roads on top.
  for (const a of m.areas) {
    if (!visible(a.box)) continue;
    ctx.fillStyle = AREA_COLOURS[a.k];
    ctx.fill(a.path);
    if (a.k === 'pitch') { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.25 * U; ctx.stroke(a.path); }
    if (a.k === 'water') { ctx.strokeStyle = '#74b2dd'; ctx.lineWidth = 0.5 * U; ctx.stroke(a.path); }
  }
  const lines = m.lines.filter((l) => visible(l.box));
  for (const l of lines) {
    if (l.k === 'river' || l.k === 'stream') {
      ctx.strokeStyle = AREA_COLOURS.water;
      ctx.lineWidth = (l.k === 'river' ? 9 : 2.5) * U;
      ctx.stroke(l.path);
    }
  }
  // Road edges first, then all the road surfaces, so crossings join up.
  for (const kind of ['path', 'service', 'minor', 'major']) {
    const r = ROAD[kind];
    if (!r.edge) continue;
    ctx.strokeStyle = r.edge;
    ctx.lineWidth = (r.w + 0.8) * U;
    for (const l of lines) if (l.k === kind) ctx.stroke(l.path);
  }
  for (const kind of ['path', 'service', 'minor', 'major']) {
    const r = ROAD[kind];
    ctx.strokeStyle = r.fill;
    ctx.lineWidth = r.w * U;
    for (const l of lines) if (l.k === kind) ctx.stroke(l.path);
  }
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

  // Your route: dashed ahead, a soft trail where you've been.
  ctx.strokeStyle = 'rgba(29, 109, 100, 0.55)';
  ctx.lineWidth = 0.7 * U;
  ctx.setLineDash([2 * U, 1.6 * U]);
  ctx.stroke(m.route);
  ctx.setLineDash([]);

  // Shadows on the ground.
  ctx.fillStyle = 'rgba(40, 50, 30, 0.16)';
  for (const t of m.trees) {
    if (t.x < view.x0 || t.x > view.x1 || t.y < view.y0 || t.y > view.y1) continue;
    ctx.beginPath();
    ctx.ellipse(t.x + t.r * 0.25, t.y, t.r * 0.95, t.r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Everything standing up, back to front.
  const things = [];
  for (const b of m.buildings) if (visible(b.box)) things.push({ y: b.box.y1, draw: () => drawBuilding(ctx, b) });
  for (const t of m.trees) {
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
  ctx.font = '500 10px Figtree, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(31, 42, 36, 0.7)';
  ctx.textAlign = 'right';
  ctx.fillText('© OpenStreetMap contributors', VIEW_W - 8, VIEW_H - 8);
  ctx.textAlign = 'left';
}
