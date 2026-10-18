// Draws the living room or the park, the pet, and everything around it.
// The scene follows the real time of day: daylight, sunset, lamp-lit night.

import { drawPet, drawBall } from './pet-art.js';
import { drawOwner } from './owner-art.js';
import {
  VIEW_W, VIEW_H, GROUND, BOWL_X, BED_X, BAG_X, JAR_X, BALL_R, LEASH,
} from './space-side.js';
import { portionGrams } from './pet.js';
import { drawFind } from './finds-art.js';
import { unlocked } from './bond.js';
import { drawRouteScene } from './route-art.js';

// 0 = full day, 1 = full night, from the local clock.
export function darkness(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 7.5 && h <= 18) return 0;
  if (h > 18 && h < 20.5) return (h - 18) / 2.5;
  if (h > 5 && h < 7.5) return 1 - (h - 5) / 2.5;
  return 1;
}

export function skyColors(dark) {
  const mix = (a, b, t) => {
    const pa = a.match(/\w\w/g).map((v) => parseInt(v, 16));
    const pb = b.match(/\w\w/g).map((v) => parseInt(v, 16));
    return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
  };
  if (dark < 0.5) {
    const t = dark * 2;
    return [mix('#7fb6e8', '#f0a36b', t), mix('#cfe6f5', '#f6d38f', t)];
  }
  const t = (dark - 0.5) * 2;
  return [mix('#f0a36b', '#141c3a', t), mix('#f6d38f', '#2e3560', t)];
}

export function drawSky(ctx, x, y, w, h, dark, time) {
  const [top, bottom] = skyColors(dark);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  if (dark > 0.7) {
    ctx.fillStyle = `rgba(255,255,240,${(dark - 0.7) * 3})`;
    for (let i = 0; i < 14; i++) {
      const sx = x + ((i * 97) % w);
      const sy = y + ((i * 53) % (h * 0.7));
      const tw = 0.6 + 0.4 * Math.sin(time * 2 + i);
      ctx.fillRect(sx, sy, 1.6 * tw, 1.6 * tw);
    }
    ctx.fillStyle = '#f4f0d8';
    ctx.beginPath();
    ctx.arc(x + w * 0.75, y + h * 0.28, 11, 0, Math.PI * 2);
    ctx.fill();
  } else if (dark < 0.4) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const cx = x + ((time * 4) % (w + 80)) - 40;
    for (const [dx, dy, r] of [[0, 0, 13], [14, -6, 15], [30, 0, 12]]) {
      ctx.beginPath();
      ctx.arc(cx + dx, y + h * 0.35 + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawRoom(ctx, world, dark, time) {
  // Wall with a panelled lower half.
  const wall = ctx.createLinearGradient(0, 0, 0, 300);
  wall.addColorStop(0, '#d9e2d2');
  wall.addColorStop(1, '#cbd6c3');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, VIEW_W, 300);
  ctx.fillStyle = '#bccab3';
  ctx.fillRect(0, 222, VIEW_W, 78);
  ctx.strokeStyle = 'rgba(80,100,70,0.18)';
  ctx.lineWidth = 2;
  for (let x = 30; x < VIEW_W; x += 95) ctx.strokeRect(x, 232, 75, 56);
  ctx.fillStyle = '#e8e4d6';
  ctx.fillRect(0, 218, VIEW_W, 5);

  // Window shows the real sky outside.
  const wx = 470;
  const wy = 54;
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(wx - 10, wy - 10, 160, 150);
  drawSky(ctx, wx, wy, 140, 130, dark, time);
  ctx.fillStyle = '#f2efe6';
  ctx.fillRect(wx + 67, wy, 6, 130);
  ctx.fillRect(wx, wy + 62, 140, 6);
  ctx.fillStyle = '#dcd6c6';
  ctx.fillRect(wx - 16, wy + 136, 172, 9);

  // A framed print and a plant.
  ctx.fillStyle = '#8a6a4a';
  ctx.fillRect(170, 86, 96, 74);
  ctx.fillStyle = '#e9e2cf';
  ctx.fillRect(177, 93, 82, 60);
  ctx.fillStyle = '#9fbf8f';
  ctx.beginPath();
  ctx.moveTo(177, 153);
  ctx.lineTo(205, 118);
  ctx.lineTo(228, 140);
  ctx.lineTo(242, 126);
  ctx.lineTo(259, 153);
  ctx.fill();
  ctx.fillStyle = '#e8b04a';
  ctx.beginPath();
  ctx.arc(240, 108, 7, 0, Math.PI * 2);
  ctx.fill();

  // Floor boards.
  const floor = ctx.createLinearGradient(0, 300, 0, VIEW_H);
  floor.addColorStop(0, '#b98a58');
  floor.addColorStop(1, '#d1a46c');
  ctx.fillStyle = floor;
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);
  ctx.strokeStyle = 'rgba(90,55,25,0.22)';
  ctx.lineWidth = 1.5;
  let y = 300;
  for (let i = 0; y < VIEW_H; i++) {
    const gap = 12 + i * 6;
    y += gap;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW_W, y);
    ctx.stroke();
    for (let x = (i * 137) % 180; x < VIEW_W; x += 180) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - gap);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#efe9dc';
  ctx.fillRect(0, 294, VIEW_W, 8);

  // Floor lamp in the corner.
  ctx.fillStyle = '#3d3a36';
  ctx.fillRect(768, 120, 5, 230);
  ctx.fillRect(752, 346, 37, 6);
  ctx.fillStyle = dark > 0.3 ? '#f6dc9c' : '#e9dfc6';
  ctx.beginPath();
  ctx.moveTo(744, 124);
  ctx.lineTo(796, 124);
  ctx.lineTo(786, 84);
  ctx.lineTo(754, 84);
  ctx.fill();

  // Rug.
  ctx.fillStyle = '#7f97b8';
  ctx.beginPath();
  ctx.ellipse(400, 404, 235, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#a9bcd6';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(400, 404, 205, 25, 0, 0, Math.PI * 2);
  ctx.stroke();

}

// Things that stay in the room even when the backdrop is a photo.
function drawFurniture(ctx, world) {
  // Bed.
  ctx.fillStyle = '#3f5f8a';
  ctx.beginPath();
  ctx.ellipse(BED_X, 386, 86, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#9db8dc';
  ctx.beginPath();
  ctx.ellipse(BED_X, 388, 70, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  drawBowl(ctx, world);
  drawBag(ctx, BAG_X, GROUND);
  drawJar(ctx, JAR_X, GROUND);
}

function drawBag(ctx, x, y) {
  ctx.fillStyle = '#c99f62';
  ctx.beginPath();
  ctx.moveTo(x - 24, y);
  ctx.lineTo(x - 21, y - 62);
  ctx.lineTo(x + 21, y - 62);
  ctx.lineTo(x + 24, y);
  ctx.fill();
  ctx.fillStyle = '#b58a4f';
  ctx.beginPath();
  ctx.moveTo(x - 21, y - 62);
  ctx.lineTo(x - 17, y - 74);
  ctx.lineTo(x + 17, y - 74);
  ctx.lineTo(x + 21, y - 62);
  ctx.fill();
  ctx.fillStyle = '#f3ead8';
  ctx.beginPath();
  ctx.roundRect(x - 15, y - 48, 30, 26, 4);
  ctx.fill();
  ctx.fillStyle = '#8a5a32';
  for (const [dx, dy] of [[-6, -38], [0, -32], [6, -38], [-3, -28], [4, -27]]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawBone(ctx, x, y, size = 1, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(size, size);
  ctx.fillStyle = '#c98a4a';
  ctx.strokeStyle = 'rgba(90, 50, 15, 0.7)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-7, -2.5, 14, 5, 2);
  for (const [dx, dy] of [[-7, -2.5], [-7, 2.5], [7, -2.5], [7, 2.5]]) {
    ctx.moveTo(dx + 3, dy);
    ctx.arc(dx, dy, 3, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawJar(ctx, x, y) {
  ctx.fillStyle = 'rgba(220, 235, 240, 0.65)';
  ctx.strokeStyle = 'rgba(90, 110, 120, 0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 15, y - 42, 30, 42, 7);
  ctx.fill();
  ctx.stroke();
  drawBone(ctx, x - 4, y - 10, 0.9, 0.3);
  drawBone(ctx, x + 5, y - 20, 0.9, -0.5);
  drawBone(ctx, x - 3, y - 29, 0.9, 0.1);
  ctx.fillStyle = '#c4473a';
  ctx.beginPath();
  ctx.roundRect(x - 17, y - 50, 34, 10, 3);
  ctx.fill();
}

function drawScoop(ctx, x, y) {
  ctx.strokeStyle = '#8f99a3';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 6, y - 4);
  ctx.lineTo(x - 26, y - 14);
  ctx.stroke();
  ctx.fillStyle = '#b8c2cc';
  ctx.beginPath();
  ctx.ellipse(x + 6, y + 2, 14, 10, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a5a32';
  for (const [dx, dy] of [[0, -3], [6, -4], [11, -1], [4, 1]]) {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBowl(ctx, world) {
  const x = BOWL_X;
  const y = GROUND;
  const portion = portionGrams(world.pet);
  const fill = Math.min(1, world.pet.bowlGrams / portion);
  if (fill > 0) {
    ctx.fillStyle = '#8a5a32';
    for (let i = 0; i < 9 * fill + 2; i++) {
      const kx = x - 18 + ((i * 11) % 36);
      const ky = y - 18 - fill * 6 + ((i * 7) % 6);
      ctx.beginPath();
      ctx.arc(kx, ky, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#aeb9c4';
  ctx.beginPath();
  ctx.moveTo(x - 32, y - 18);
  ctx.lineTo(x + 32, y - 18);
  ctx.lineTo(x + 24, y);
  ctx.lineTo(x - 24, y);
  ctx.fill();
  ctx.fillStyle = '#d6dde4';
  ctx.fillRect(x - 33, y - 21, 66, 5);
}

function hash(i) {
  const v = Math.sin(i * 127.1) * 43758.5453;
  return v - Math.floor(v);
}

function drawPark(ctx, world, dark, time) {
  const off = world.cam;
  drawSky(ctx, 0, 0, VIEW_W, 300, dark, time);

  // Far hills.
  ctx.fillStyle = '#a6c595';
  ctx.beginPath();
  ctx.moveTo(0, 300);
  for (let x = 0; x <= VIEW_W; x += 20) {
    const wx = x + off * 0.15;
    ctx.lineTo(x, 225 - Math.sin(wx / 140) * 22 - Math.sin(wx / 53) * 8);
  }
  ctx.lineTo(VIEW_W, 300);
  ctx.fill();

  // Trees.
  const spacing = 170;
  const tOff = off * 0.5;
  for (let i = Math.floor(tOff / spacing) - 1; i < (tOff + VIEW_W) / spacing + 1; i++) {
    const x = i * spacing + hash(i) * 90 - tOff;
    const h = 70 + hash(i + 7) * 50;
    ctx.fillStyle = '#6e5038';
    ctx.fillRect(x - 5, 300 - h * 0.45, 10, h * 0.45 + 30);
    ctx.fillStyle = hash(i + 3) > 0.5 ? '#5c8f4c' : '#6f9e55';
    ctx.beginPath();
    ctx.arc(x, 300 - h * 0.6, h * 0.36, 0, Math.PI * 2);
    ctx.arc(x - h * 0.2, 300 - h * 0.45, h * 0.26, 0, Math.PI * 2);
    ctx.arc(x + h * 0.22, 300 - h * 0.47, h * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // Grass and path.
  ctx.fillStyle = '#8dbd6e';
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);
  ctx.fillStyle = '#d8c6a0';
  ctx.fillRect(0, 352, VIEW_W, 56);
  ctx.fillStyle = 'rgba(120,95,60,0.18)';
  for (let i = Math.floor(off / 60); i < (off + VIEW_W) / 60 + 1; i++) {
    const x = i * 60 + hash(i) * 40 - off;
    ctx.beginPath();
    ctx.ellipse(x, 365 + hash(i + 2) * 34, 5, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#6fa457';
  ctx.lineWidth = 2;
  for (let i = Math.floor(off / 26); i < (off + VIEW_W) / 26 + 1; i++) {
    const x = i * 26 + hash(i) * 14 - off;
    const y = hash(i + 11) > 0.5 ? 350 : 420;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 3, y - 8);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 3, y - 9);
    ctx.stroke();
  }
}

export function drawCritter(ctx, c, x, time, ground = GROUND, birdY = 330) {
  if (c.kind === 'squirrel') {
    const y = ground - 8 - Math.abs(Math.sin(time * 12)) * 6;
    ctx.fillStyle = '#9a5b34';
    ctx.beginPath();
    ctx.ellipse(x, y, 13, 8, 0, 0, Math.PI * 2);
    ctx.arc(x + 12, y - 6, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x - 14, y - 12, 7, 14, -0.4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const y = birdY - c.t * 40;
    const flap = Math.sin(time * 18) * 6;
    ctx.fillStyle = '#4b4f5c';
    ctx.beginPath();
    ctx.ellipse(x, y, 8, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#4b4f5c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x - 2, y);
    ctx.lineTo(x - 10, y - flap);
    ctx.moveTo(x + 2, y);
    ctx.lineTo(x + 10, y - flap);
    ctx.stroke();
  }
}

export function drawHeart(ctx, x, y, size) {
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.35);
  ctx.bezierCurveTo(x - size, y - size * 0.3, x - size * 0.4, y - size, x, y - size * 0.35);
  ctx.bezierCurveTo(x + size * 0.4, y - size, x + size, y - size * 0.3, x, y + size * 0.35);
  ctx.fill();
}

export function drawParticles(ctx, world) {
  for (const p of world.particles) {
    const a = 1 - p.age / p.life;
    if (p.type === 'heart') {
      ctx.fillStyle = `rgba(232, 86, 120, ${a})`;
      drawHeart(ctx, p.x, p.y, 9);
    } else if (p.type === 'z') {
      ctx.fillStyle = `rgba(70, 80, 120, ${a})`;
      ctx.font = `700 ${14 + p.age * 6}px Grandstander, system-ui, sans-serif`;
      ctx.fillText('z', p.x + p.age * 10, p.y);
    } else if (p.type === 'kibble') {
      ctx.fillStyle = '#8a5a32';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === 'crumb') {
      ctx.fillStyle = `rgba(138, 90, 50, ${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y + 12, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function drawBubble(ctx, text, ax, ay, tone = 'pet') {
  ctx.font = tone === 'pet' ? '700 16px Grandstander, system-ui, sans-serif' : '600 15px Figtree, system-ui, sans-serif';
  const shown = text.length > 42 ? `${text.slice(0, 40)}…` : text;
  const w = ctx.measureText(shown).width + 22;
  const h = 30;
  const x = Math.min(VIEW_W - w - 8, Math.max(8, ax - w / 2));
  const y = Math.max(8, ay - h - 10);
  ctx.fillStyle = tone === 'pet' ? 'rgba(255,255,255,0.95)' : 'rgba(31, 42, 36, 0.88)';
  ctx.strokeStyle = 'rgba(30,40,35,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.moveTo(ax - 6, y + h);
  ctx.lineTo(ax, y + h + 9);
  ctx.lineTo(ax + 6, y + h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = tone === 'pet' ? '#1f2a24' : '#f4f7f4';
  ctx.textBaseline = 'middle';
  ctx.fillText(shown, x + 11, y + h / 2 + 1);
  ctx.textBaseline = 'alphabetic';
}

// A photo as the backdrop. On walks it scrolls slowly with the camera,
// mirrored at the seams, so any snapshot becomes a place to walk through.
function drawPhoto(ctx, img, cam = 0, scrolls = false) {
  const k = scrolls ? VIEW_H / img.height : Math.max(VIEW_W / img.width, VIEW_H / img.height);
  const w = img.width * k;
  const h = img.height * k;
  if (!scrolls) {
    ctx.drawImage(img, (VIEW_W - w) / 2, (VIEW_H - h) / 2, w, h);
  } else {
    const off = cam * 0.45;
    const first = Math.floor(off / w);
    for (let i = first; i * w - off < VIEW_W; i++) {
      const x = i * w - off;
      ctx.save();
      if (i % 2 !== 0) {
        ctx.translate(x + w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0, w, h);
      } else ctx.drawImage(img, x, 0, w, h);
      ctx.restore();
    }
  }
  // Settle the characters onto the ground.
  const g = ctx.createLinearGradient(0, 300, 0, VIEW_H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 300, VIEW_W, VIEW_H - 300);
}

// An owner-supplied picture used as an object, fitted into a square.
export function drawImageItem(ctx, img, x, y, size) {
  const k = size / Math.max(img.width, img.height);
  ctx.drawImage(img, x - (img.width * k) / 2, y - (img.height * k) / 2, img.width * k, img.height * k);
}

// Something waiting to be found on a walk: a glint on the path.
export function drawSparkleFind(ctx, find, time, y = GROUND - 8) {
  drawFind(ctx, find.item.id, find.x, y, 0.9);
  const a = 0.5 + 0.5 * Math.sin(time * 5);
  ctx.strokeStyle = `rgba(255, 245, 190, ${0.4 + a * 0.6})`;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const r = 6 + a * 4;
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2 + time;
    ctx.beginPath();
    ctx.moveTo(find.x + Math.cos(ang) * r, y - 14 + Math.sin(ang) * r);
    ctx.lineTo(find.x + Math.cos(ang) * (r + 5), y - 14 + Math.sin(ang) * (r + 5));
    ctx.stroke();
  }
}

function collarPoint(world) {
  const head = world.headPoint();
  const s = world.scale;
  return { x: head.x - world.body.dir * 20 * s, y: head.y + 22 * s };
}

// The leash sags when slack and pulls straight when tight.
export function drawLeash(ctx, world, hand) {
  const c = collarPoint(world);
  const tension = world.walk.tension;
  const span = Math.hypot(c.x - hand.x, c.y - hand.y);
  const sag = Math.max(0, (LEASH * 1.15 - span) * 0.5) * (1 - tension);
  ctx.strokeStyle = world.pet.look.collar ?? '#d0443c';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hand.x, hand.y);
  ctx.quadraticCurveTo((hand.x + c.x) / 2, (hand.y + c.y) / 2 + sag, c.x, c.y);
  ctx.stroke();
}

function drawNight(ctx, world, dark) {
  if (dark <= 0) return;
  ctx.fillStyle = `rgba(18, 24, 58, ${dark * 0.42})`;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (world.scene === 'home') {
    const g = ctx.createRadialGradient(770, 120, 10, 770, 140, 420);
    g.addColorStop(0, `rgba(255, 214, 150, ${dark * 0.32})`);
    g.addColorStop(1, 'rgba(255, 214, 150, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
}

export function render(ctx, world, { date = new Date(), time = world.time, backdrops = {}, images = {} } = {}) {
  const dark = darkness(date);
  const home = world.scene === 'home';
  const photo = home ? backdrops.home : backdrops.walk;
  if (photo) drawPhoto(ctx, photo, world.cam, !home);
  else if (home) drawRoom(ctx, world, dark, time);
  else if (world.walk.route) drawRouteScene(ctx, world, dark, time);
  else drawPark(ctx, world, dark, time);

  ctx.save();
  ctx.translate(-world.cam, 0);

  if (home) drawFurniture(ctx, world);
  const ball = world.ball;
  if (home && ball.state === 'ground') {
    ctx.fillStyle = 'rgba(40,30,20,0.18)';
    ctx.beginPath();
    ctx.ellipse(ball.x, GROUND, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    drawBall(ctx, ball.x, ball.y, BALL_R, ball.spin);
  }
  const treat = (x, y, size, angle) => (images.treat ? drawImageItem(ctx, images.treat, x, y, size * 16) : drawBone(ctx, x, y, size, angle));
  if (world.floorTreat) treat(world.floorTreat.x, world.floorTreat.y, 1.2, 0.2);
  if (world.walk?.find) drawSparkleFind(ctx, world.walk.find, time);
  if (home && world.shownGift) drawFind(ctx, world.shownGift.id, world.shownGift.x, GROUND - 8, 1.2);
  if (world.walk?.critter) drawCritter(ctx, world.walk.critter, world.walk.critter.x, time);

  // The owner stands behind the pet. On walks the leash hand reaches toward the pet.
  const o = world.owner;
  let hand = o.hand;
  const leashed = !home && !world.walk.offLeash;
  if (leashed && !hand) {
    const toward = Math.sign(world.body.x - o.x) || o.dir;
    const pull = world.walk.tension;
    hand = { x: o.x + toward * (34 + pull * 24), y: GROUND - 150 + pull * 20 };
  }
  const handPos = drawOwner(ctx, world.pet.owner, {
    x: o.x, dir: o.dir, phase: o.phase, speed: o.speed, crouch: o.crouch, time, hand,
  }, GROUND);

  const b = world.body;
  drawPet(ctx, world.pet, {
    x: b.x, y: GROUND - b.jump, jump: b.jump, scale: world.scale, dir: b.dir, pose: b.pose,
    gait: b.gait, speed: b.speed, wagPhase: b.wagPhase, time,
    holdingBall: ball.state === 'mouth',
    goldTag: unlocked(world.pet, 'goldTag'),
  });
  if (leashed) drawLeash(ctx, world, handPos);

  // Whatever is in the owner's hand.
  const d = world.drag;
  if (d?.item === 'scoop') drawScoop(ctx, d.x, d.y);
  if (d?.item === 'treat') treat(d.x, d.y, 1.7, -0.3);
  if (home && (ball.state === 'air' || ball.state === 'drag')) drawBall(ctx, ball.x, ball.y, BALL_R, ball.spin);

  drawParticles(ctx, world);
  ctx.restore();

  drawNight(ctx, world, dark);
  if (world.bubble) {
    const head = world.headPoint();
    drawBubble(ctx, world.bubble.text, head.x - world.cam, head.y - 26 * world.scale, 'pet');
  }
  if (o.bubble) drawBubble(ctx, o.bubble.text, o.x - world.cam + o.dir * 10, GROUND - 330 + o.crouch * 52, 'owner');
}
