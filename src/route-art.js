// Draws a walk along a real route in the 2D view: each stretch of the route
// in its own setting (park, woods, waterside, beach, streets, shops), the
// landmarks where they really are, and start and finish posts.

import { VIEW_W, VIEW_H, UNITS_PER_METER } from './space-side.js';
import { drawSky } from './renderer.js';
import { LANDMARKS } from './route.js';

const HORIZON = 300;
const PATH_TOP = 352;
const PATH_BOTTOM = 408;

function hash(i) {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

const GROUND = {
  park: '#8dbd6e', woods: '#6f9e55', water: '#8dbd6e', beach: '#e8d6a5', street: '#9fb58c', town: '#a7a39a',
};
const PATH = {
  park: '#d8c6a0', woods: '#b59a6e', water: '#cfc6b4', beach: '#c9a46a', street: '#c8c8c4', town: '#d2cdc4',
};

function tree(ctx, x, h, dark) {
  ctx.fillStyle = '#6e5038';
  ctx.fillRect(x - 5, HORIZON - h * 0.45, 10, h * 0.45 + 30);
  ctx.fillStyle = dark ? '#4f8644' : '#6f9e55';
  ctx.beginPath();
  ctx.arc(x, HORIZON - h * 0.6, h * 0.36, 0, Math.PI * 2);
  ctx.arc(x - h * 0.2, HORIZON - h * 0.45, h * 0.26, 0, Math.PI * 2);
  ctx.arc(x + h * 0.22, HORIZON - h * 0.47, h * 0.25, 0, Math.PI * 2);
  ctx.fill();
}

function pine(ctx, x, h, shade) {
  ctx.fillStyle = '#5a4030';
  ctx.fillRect(x - 4, HORIZON - 20, 8, 40);
  ctx.fillStyle = shade;
  for (let k = 0; k < 3; k++) {
    const w = h * (0.45 - k * 0.1);
    const top = HORIZON - h * (0.5 + k * 0.28);
    ctx.beginPath();
    ctx.moveTo(x - w, top + h * 0.38);
    ctx.lineTo(x + w, top + h * 0.38);
    ctx.lineTo(x, top);
    ctx.fill();
  }
}

function house(ctx, x, i, shop) {
  const w = 110 + hash(i + 3) * 40;
  const h = 95 + hash(i + 5) * 60;
  const colours = shop ? ['#e2c7a8', '#cfd8dc', '#f0dcc0', '#d9c2cf'] : ['#d98c6a', '#c9b48e', '#e3d3b8', '#b7c6d6', '#d7a9a0'];
  ctx.fillStyle = colours[Math.floor(hash(i + 9) * colours.length)];
  ctx.fillRect(x, HORIZON - h, w, h);
  if (!shop) {
    ctx.fillStyle = '#7a4d3a';
    ctx.beginPath();
    ctx.moveTo(x - 8, HORIZON - h);
    ctx.lineTo(x + w / 2, HORIZON - h - 38);
    ctx.lineTo(x + w + 8, HORIZON - h);
    ctx.fill();
  } else {
    ctx.fillStyle = '#6b6560';
    ctx.fillRect(x - 4, HORIZON - h - 8, w + 8, 10);
  }
  ctx.fillStyle = '#eef4f8';
  const rows = Math.floor((h - 40) / 34);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 3; c++) ctx.fillRect(x + 12 + c * (w - 24) / 3, HORIZON - h + 14 + r * 34, (w - 24) / 3 - 10, 20);
  }
  if (shop) {
    // Striped awning and a shop window at street level.
    const colour = ['#c4473a', '#2f7f8f', '#3e8a5c', '#e0a526'][Math.floor(hash(i + 2) * 4)];
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = k % 2 ? '#f4efe6' : colour;
      ctx.fillRect(x + 6 + k * (w - 12) / 6, HORIZON - 52, (w - 12) / 6, 16);
    }
    ctx.fillStyle = '#bfd3dd';
    ctx.fillRect(x + 10, HORIZON - 34, w - 46, 34);
  }
  ctx.fillStyle = '#5b3a29';
  ctx.fillRect(x + w - 30, HORIZON - 36, 18, 36);
}

// The ground, path and scenery for one kind of place, drawn across the
// whole view; the caller clips it to the stretch it covers.
function drawSetting(ctx, biome, cam, trees) {
  ctx.fillStyle = GROUND[biome];
  ctx.fillRect(0, HORIZON, VIEW_W, VIEW_H - HORIZON);

  if (biome === 'beach') {
    ctx.fillStyle = '#5aa7d8';
    ctx.fillRect(0, 250, VIEW_W, 52);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    for (let i = Math.floor(cam / 70); i < (cam + VIEW_W) / 70 + 1; i++) {
      const x = i * 70 + hash(i) * 30 - cam;
      ctx.beginPath();
      ctx.arc(x, 290, 10, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  }
  if (biome === 'street' || biome === 'town') {
    const spacing = biome === 'town' ? 150 : 175;
    for (let i = Math.floor(cam / spacing) - 1; i < (cam + VIEW_W) / spacing + 1; i++) house(ctx, i * spacing - cam, i, biome === 'town');
  }
  if (biome === 'park' || biome === 'water') {
    const spacing = Math.max(70, 230 - (trees ?? 4) * 10);
    for (let i = Math.floor(cam / spacing) - 1; i < (cam + VIEW_W) / spacing + 1; i++) {
      tree(ctx, i * spacing + hash(i) * 60 - cam, 70 + hash(i + 7) * 50, hash(i + 3) > 0.5);
    }
  }
  if (biome === 'woods') {
    for (const [spacing, shade, scale] of [[48, '#3f6b3a', 1.25], [62, '#4f8644', 1]]) {
      for (let i = Math.floor(cam / spacing) - 1; i < (cam + VIEW_W) / spacing + 1; i++) {
        pine(ctx, i * spacing + hash(i * scale) * 30 - cam, (90 + hash(i + 11) * 60) * scale, shade);
      }
    }
  }
  if (biome === 'water') {
    // The river between the bank and the path.
    ctx.fillStyle = '#5b9bd5';
    ctx.fillRect(0, 318, VIEW_W, 34);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    for (let i = Math.floor(cam / 40); i < (cam + VIEW_W) / 40 + 1; i++) {
      const x = i * 40 + hash(i) * 20 - cam;
      ctx.beginPath();
      ctx.moveTo(x, 330 + hash(i + 1) * 14);
      ctx.lineTo(x + 14, 330 + hash(i + 1) * 14);
      ctx.stroke();
    }
  }

  // The path itself.
  ctx.fillStyle = PATH[biome];
  ctx.fillRect(0, PATH_TOP, VIEW_W, PATH_BOTTOM - PATH_TOP);
  if (biome === 'beach') {
    ctx.strokeStyle = 'rgba(110, 75, 40, 0.35)';
    ctx.lineWidth = 1.5;
    for (let i = Math.floor(cam / 22); i < (cam + VIEW_W) / 22 + 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 22 - cam, PATH_TOP);
      ctx.lineTo(i * 22 - cam, PATH_BOTTOM);
      ctx.stroke();
    }
  }
  if (biome === 'street' || biome === 'town') {
    ctx.fillStyle = '#9a9a96';
    ctx.fillRect(0, PATH_BOTTOM - 4, VIEW_W, 4);
    ctx.fillStyle = '#6e6e72';
    ctx.fillRect(0, PATH_BOTTOM, VIEW_W, VIEW_H - PATH_BOTTOM);
    ctx.fillStyle = '#e8e4d6';
    for (let i = Math.floor(cam / 60); i < (cam + VIEW_W) / 60 + 1; i++) ctx.fillRect(i * 60 - cam, 430, 30, 4);
    // Street lamps.
    for (let i = Math.floor(cam / 240); i < (cam + VIEW_W) / 240 + 1; i++) {
      const x = i * 240 + 40 - cam;
      ctx.fillStyle = '#3d3a36';
      ctx.fillRect(x, 220, 4, PATH_TOP - 220);
      ctx.fillRect(x - 10, 218, 24, 5);
    }
  }
  if (biome === 'water') {
    // Railing along the river side of the path.
    ctx.strokeStyle = '#7a7368';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, PATH_TOP - 14);
    ctx.lineTo(VIEW_W, PATH_TOP - 14);
    ctx.stroke();
    for (let i = Math.floor(cam / 50); i < (cam + VIEW_W) / 50 + 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 50 - cam, PATH_TOP - 14);
      ctx.lineTo(i * 50 - cam, PATH_TOP + 2);
      ctx.stroke();
    }
  }
}

function sign(ctx, x, y, text) {
  ctx.font = '600 11px Figtree, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(31, 42, 36, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 18, w, 18, 6);
  ctx.fill();
  ctx.fillStyle = '#f4f7f4';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x - w / 2 + 6, y - 8.5);
  ctx.textBaseline = 'alphabetic';
}

function drawLandmark(ctx, lm, x) {
  const y = PATH_TOP;
  switch (lm.kind) {
    case 'bench':
      ctx.fillStyle = '#8a5a32';
      for (let k = 0; k < 3; k++) ctx.fillRect(x - 32, y - 30 + k * 7, 64, 4);
      ctx.fillRect(x - 32, y - 10, 64, 5);
      ctx.fillStyle = '#3d3a36';
      ctx.fillRect(x - 28, y - 6, 4, 8);
      ctx.fillRect(x + 24, y - 6, 4, 8);
      break;
    case 'cafe':
    case 'restaurant':
    case 'ice_cream': {
      ctx.fillStyle = '#3d3a36';
      ctx.fillRect(x - 1, y - 60, 3, 60);
      ctx.fillStyle = lm.kind === 'ice_cream' ? '#e46aa0' : '#c4473a';
      ctx.beginPath();
      ctx.moveTo(x - 34, y - 52);
      ctx.lineTo(x, y - 70);
      ctx.lineTo(x + 34, y - 52);
      ctx.fill();
      ctx.fillStyle = '#f2efe6';
      ctx.fillRect(x - 18, y - 22, 36, 4);
      ctx.fillStyle = '#5b3a29';
      ctx.fillRect(x - 2, y - 18, 4, 18);
      break;
    }
    case 'fountain':
    case 'drinking_water':
      ctx.fillStyle = '#b8b2a6';
      ctx.fillRect(x - (lm.kind === 'fountain' ? 30 : 6), y - 16, lm.kind === 'fountain' ? 60 : 12, 16);
      ctx.fillStyle = '#7fb6e8';
      ctx.beginPath();
      ctx.ellipse(x, y - 30, lm.kind === 'fountain' ? 10 : 4, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'playground':
      ctx.strokeStyle = '#d0443c';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x - 30, y);
      ctx.lineTo(x - 30, y - 60);
      ctx.lineTo(x + 30, y);
      ctx.stroke();
      ctx.strokeStyle = '#2f6f9f';
      ctx.beginPath();
      ctx.moveTo(x + 10, y - 60);
      ctx.lineTo(x + 40, y - 60);
      ctx.moveTo(x + 25, y - 60);
      ctx.lineTo(x + 25, y - 22);
      ctx.stroke();
      break;
    case 'dog_park':
      ctx.strokeStyle = '#7a7368';
      ctx.lineWidth = 3;
      for (let k = -3; k <= 3; k++) {
        ctx.beginPath();
        ctx.moveTo(x + k * 14, y);
        ctx.lineTo(x + k * 14, y - 26);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x - 46, y - 20);
      ctx.lineTo(x + 46, y - 20);
      ctx.stroke();
      break;
    default:
      ctx.fillStyle = '#3d3a36';
      ctx.fillRect(x - 2, y - 46, 4, 46);
  }
  sign(ctx, x, y - (lm.kind === 'cafe' || lm.kind === 'restaurant' || lm.kind === 'ice_cream' ? 74 : 66), lm.name ?? LANDMARKS[lm.kind].label.replace(/^an? /, ''));
}

function post(ctx, x, label, finish) {
  ctx.fillStyle = '#3d3a36';
  ctx.fillRect(x - 2, PATH_TOP - 70, 4, 70);
  ctx.fillStyle = finish ? '#1f2a24' : '#1d6d64';
  ctx.fillRect(x + 2, PATH_TOP - 70, 34, 20);
  if (finish) {
    ctx.fillStyle = '#f4f7f4';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2) ctx.fillRect(x + 2 + c * 8.5, PATH_TOP - 70 + r * 10, 8.5, 10);
  }
  sign(ctx, x + 19, PATH_TOP - 74, label);
}

export function drawRouteScene(ctx, world, dark, time) {
  const w = world.walk;
  const route = w.route;
  const cam = world.cam;
  drawSky(ctx, 0, 0, VIEW_W, HORIZON, dark, time);

  // Distant hills drift slowly.
  ctx.fillStyle = '#a6c595';
  ctx.beginPath();
  ctx.moveTo(0, HORIZON);
  for (let x = 0; x <= VIEW_W; x += 20) {
    const wx = x + cam * 0.15;
    ctx.lineTo(x, 225 - Math.sin(wx / 140) * 22 - Math.sin(wx / 53) * 8);
  }
  ctx.lineTo(VIEW_W, HORIZON);
  ctx.fill();

  const toScreen = (metres) => w.startX + metres * UNITS_PER_METER - cam;
  const first = route.segments[0];
  const last = route.segments[route.segments.length - 1];
  const stretches = [
    { biome: first.biome, x0: -Infinity, x1: toScreen(first.from), trees: first.trees },
    ...route.segments.map((s) => ({ biome: s.biome, x0: toScreen(s.from), x1: toScreen(s.to), trees: s.trees })),
    { biome: last.biome, x0: toScreen(last.to), x1: Infinity, trees: last.trees },
  ];
  for (const s of stretches) {
    const x0 = Math.max(0, s.x0);
    const x1 = Math.min(VIEW_W, s.x1);
    if (x1 <= x0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, VIEW_H);
    ctx.clip();
    drawSetting(ctx, s.biome, cam, s.trees);
    ctx.restore();
  }

  for (const lm of route.landmarks) {
    const x = toScreen(lm.d);
    if (x > -80 && x < VIEW_W + 80) drawLandmark(ctx, lm, x);
  }
  const sx = toScreen(0);
  const ex = toScreen(route.length);
  if (sx > -60 && sx < VIEW_W + 60) post(ctx, sx, 'Start', false);
  if (ex > -60 && ex < VIEW_W + 60) post(ctx, ex, 'Finish', true);

  ctx.font = '500 10px Figtree, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(31, 42, 36, 0.7)';
  ctx.textAlign = 'right';
  ctx.fillText('Map data © OpenStreetMap contributors', VIEW_W - 8, VIEW_H - 6);
  ctx.textAlign = 'left';
}
