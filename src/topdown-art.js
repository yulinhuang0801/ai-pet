// You and your pet seen from straight above, for walks on a map, where the
// ground is seen from above too. Each figure faces along its heading and is
// drawn in metres around its own spot; the caller passes how many drawing
// units make a metre.

import { shade } from './pet-art.js';
import { petLength } from './space-map.js';

// Figures are drawn bigger than life so they read on a real street.
export const OWNER_SPAN = 1.5; // metres across the shoulders

function frame(ctx, x, y, heading, k) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.scale(k, k);
}

// A point in a figure's own metres, back in drawing units.
function out(x, y, heading, k, lx, ly) {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  return { x: x + (lx * c - ly * s) * k, y: y + (lx * s + ly * c) * k };
}

function blob(ctx, x, y, rx, ry, colour, angle = 0) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
  ctx.fill();
}

// --- you ---

// s: { x, y, heading, phase, speed, hand } in drawing units; `hand` is a
// point the near hand reaches for (the leash, or whatever you hold).
// Returns where that hand ends up.
export function drawOwnerTop(ctx, look, s, k) {
  const half = OWNER_SPAN / 2;
  const moving = Math.min(1, s.speed / 60);
  const step = Math.sin(s.phase) * 0.3 * moving;
  frame(ctx, s.x, s.y, s.heading, k);

  blob(ctx, 0, 0, half * 0.75, half * 1.05, 'rgba(30, 30, 20, 0.22)');
  // Feet step out from under the body.
  blob(ctx, 0.12 + step, -0.17, 0.2, 0.1, '#2b2b2e');
  blob(ctx, 0.12 - step, 0.17, 0.2, 0.1, '#2b2b2e');

  // The hand that holds the leash reaches toward it; the other swings.
  let reach = null;
  if (s.hand) {
    const c = Math.cos(-s.heading);
    const sn = Math.sin(-s.heading);
    const dx = (s.hand.x - s.x) / k;
    const dy = (s.hand.y - s.y) / k;
    reach = { x: dx * c - dy * sn, y: dx * sn + dy * c };
  }
  const side = reach && reach.y < 0 ? -1 : 1;
  const shoulder = { x: 0, y: side * half * 0.78 };
  let hand;
  if (reach) {
    const dx = reach.x - shoulder.x;
    const dy = reach.y - shoulder.y;
    const len = Math.hypot(dx, dy) || 1;
    const arm = Math.min(len, 0.75);
    hand = { x: shoulder.x + (dx / len) * arm, y: shoulder.y + (dy / len) * arm };
  } else hand = { x: 0.25 - step, y: side * half * 0.9 };
  const other = { x: 0.2 + step, y: -side * half * 0.9 };
  for (const [from, to] of [[{ x: 0, y: -side * half * 0.78 }, other], [shoulder, hand]]) {
    ctx.strokeStyle = look.top;
    ctx.lineWidth = 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    blob(ctx, to.x, to.y, 0.1, 0.1, look.skin);
  }

  // Shoulders and back.
  blob(ctx, 0, 0, half * 0.42, half, look.top);
  ctx.strokeStyle = shade(look.top, -0.25);
  ctx.lineWidth = 0.04;
  ctx.beginPath();
  ctx.ellipse(0, 0, half * 0.42, half, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Head: mostly hair from above, with the face peeking out in front.
  const r = 0.3;
  blob(ctx, 0.06, 0, r, r, look.skin);
  blob(ctx, 0.26, 0, 0.07, 0.06, shade(look.skin, -0.12)); // nose
  const hair = look.hairColor;
  if (look.hair === 'buzz') {
    ctx.globalAlpha = 0.55;
    blob(ctx, 0, 0, r * 0.95, r * 0.95, hair);
    ctx.globalAlpha = 1;
  } else if (look.hair === 'curly') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      blob(ctx, -0.04 + Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.42, r * 0.42, hair);
    }
    blob(ctx, -0.04, 0, r * 0.7, r * 0.7, hair);
  } else {
    if (look.hair === 'long') blob(ctx, -0.22, 0, r * 0.95, r * 0.85, hair);
    blob(ctx, -0.04, 0, r * 0.98, r * 0.98, hair);
    if (look.hair === 'bun') blob(ctx, -0.3, 0, r * 0.42, r * 0.42, shade(hair, -0.1));
  }
  ctx.restore();
  return out(s.x, s.y, s.heading, k, hand.x, hand.y);
}

// --- your pet ---

// s: { x, y, heading, pose, gait, speed, wagPhase, jump, time, scale } in
// drawing units. Returns where the leash clips on, at the collar.
export function drawPetTop(ctx, pet, s, k) {
  const { look, species } = pet;
  const cat = species === 'cat';
  const p = s.pose;
  const sit = p.sit * (1 - p.lie);
  const lie = p.lie;
  const L = petLength(pet, s.scale);
  const W = L * (cat ? 0.34 : 0.38);
  const bodyL = L * 0.62 * (1 - 0.32 * sit + 0.08 * lie);
  const bodyW = W * (1 + 0.15 * sit + 0.12 * lie);
  const moving = Math.min(1, s.speed / 50);
  const coat = look.coat;
  const dark = shade(coat, -0.28);
  const lift = 1 + Math.min(0.25, (s.jump ?? 0) / 300);
  frame(ctx, s.x, s.y, s.heading, k);

  blob(ctx, -0.05 * L, 0.06 * L * (lift - 1) * 4, bodyL * 0.62, bodyW * 0.75, 'rgba(30, 30, 20, 0.22)');
  ctx.scale(lift, lift);

  // Tail, wagging.
  const wag = Math.sin(s.wagPhase) * (0.25 + p.wag * 0.6);
  const tailL = L * (cat ? 0.5 : 0.32);
  const back = -bodyL / 2;
  ctx.strokeStyle = cat ? coat : dark;
  ctx.lineWidth = W * (cat ? 0.18 : 0.26);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(back + 0.05 * L, 0);
  const tailEnd = { x: back - Math.cos(wag) * tailL, y: Math.sin(wag) * tailL * (sit ? 1.6 : 1) };
  ctx.quadraticCurveTo(back - tailL * 0.5, wag * tailL * 0.2, tailEnd.x, tailEnd.y);
  ctx.stroke();

  // Legs, stepping when moving; tucked in when sitting, out to the sides lying down.
  const legs = [[0.3, -1], [0.3, 1], [-0.3, -1], [-0.3, 1]];
  legs.forEach(([fx, side], i) => {
    const swing = Math.sin(s.gait + (i === 0 || i === 3 ? 0 : Math.PI)) * 0.12 * L * moving;
    let x = fx * bodyL * 1.25 + swing;
    let y = side * bodyW * (0.55 + lie * 0.45);
    if (sit && fx < 0) { x = -bodyL * 0.15; y = side * bodyW * 0.7; }
    blob(ctx, x, y, L * 0.08, L * 0.05, dark);
  });

  // Body and coat pattern.
  blob(ctx, 0, 0, bodyL / 2, bodyW / 2, coat);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, bodyL / 2, bodyW / 2, 0, 0, Math.PI * 2);
  ctx.clip();
  if (look.pattern === 'patches') {
    blob(ctx, -bodyL * 0.15, -bodyW * 0.2, bodyL * 0.2, bodyW * 0.3, look.marking, 0.4);
    blob(ctx, bodyL * 0.2, bodyW * 0.25, bodyL * 0.15, bodyW * 0.22, look.marking, -0.3);
  } else if (look.pattern === 'tuxedo') {
    blob(ctx, bodyL * 0.42, 0, bodyL * 0.18, bodyW * 0.35, look.marking);
  } else if (look.pattern === 'saddle') {
    blob(ctx, -bodyL * 0.05, 0, bodyL * 0.32, bodyW * 0.42, dark);
  } else if (look.pattern === 'tabby') {
    ctx.strokeStyle = dark;
    ctx.lineWidth = W * 0.09;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * bodyL * 0.17, -bodyW);
      ctx.lineTo(i * bodyL * 0.17 + bodyL * 0.05, bodyW);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Collar, then the head, which reaches forward to sniff.
  const neck = bodyL / 2 - L * 0.04;
  ctx.strokeStyle = look.collar ?? '#d0443c';
  ctx.lineWidth = L * 0.05;
  ctx.beginPath();
  ctx.moveTo(neck, -bodyW * 0.36);
  ctx.lineTo(neck, bodyW * 0.36);
  ctx.stroke();
  const R = L * (cat ? 0.17 : 0.16);
  const hx = neck + R * 0.85 + p.head * L * 0.1 - lie * L * 0.02;
  const tilt = p.tilt * 0.4;
  ctx.save();
  ctx.translate(hx, 0);
  ctx.rotate(tilt);
  // Ears.
  if (look.ears === 'floppy' && !cat) {
    for (const side of [-1, 1]) blob(ctx, -R * 0.15, side * R * 0.95, R * 0.55, R * 0.32, dark, side * 0.3);
  } else {
    ctx.fillStyle = cat ? coat : dark;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-R * 0.45, side * R * 0.35);
      ctx.lineTo(-R * 0.1, side * R * 1.25);
      ctx.lineTo(R * 0.15, side * R * 0.55);
      ctx.fill();
    }
  }
  blob(ctx, 0, 0, R, R * 0.92, coat);
  // Muzzle, nose and eyes.
  const muzzle = look.pattern === 'solid' ? shade(coat, 0.15) : look.marking;
  blob(ctx, R * 0.75, 0, R * (cat ? 0.38 : 0.55), R * 0.4, muzzle);
  blob(ctx, R * (cat ? 1.0 : 1.22), 0, R * 0.14, R * 0.17, '#2a2220');
  if (p.eyes > 0.5) {
    ctx.strokeStyle = '#2a2220';
    ctx.lineWidth = R * 0.08;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(R * 0.3, side * R * 0.32);
      ctx.lineTo(R * 0.45, side * R * 0.4);
      ctx.stroke();
    }
  } else for (const side of [-1, 1]) blob(ctx, R * 0.42, side * R * 0.38, R * 0.11, R * 0.11, '#2a2220');
  ctx.restore();
  ctx.restore();
  return out(s.x, s.y, s.heading, k * lift, neck, 0);
}

// --- small animals, from above ---

export function drawCritterTop(ctx, c, time, k) {
  const heading = Math.atan2(c.ay ?? 0, c.ax ?? c.dir ?? 1);
  frame(ctx, c.x, c.y, heading, k);
  if (c.kind === 'squirrel') {
    const hop = Math.abs(Math.sin(time * 12)) * 0.05;
    blob(ctx, 0, 0, 0.3, 0.16, 'rgba(30, 30, 20, 0.2)');
    blob(ctx, -0.32, 0, 0.26, 0.17, '#b07444', Math.sin(time * 9) * 0.3);
    blob(ctx, hop, 0, 0.2, 0.12, '#9a5b34');
    blob(ctx, 0.2 + hop, 0, 0.09, 0.08, '#9a5b34');
  } else {
    // A bird, flying off.
    const flap = Math.sin(time * 18) * 0.25;
    blob(ctx, 0, 0, 0.14, 0.07, '#4b4f5c');
    ctx.fillStyle = '#5d6270';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0.05, 0);
      ctx.lineTo(-0.05, side * (0.32 + flap));
      ctx.lineTo(-0.12, 0);
      ctx.fill();
    }
  }
  ctx.restore();
}
