// Draws a cat or dog from its look and current pose, side on, facing right
// before flipping. Units are view units at size 1; ground is y = 0.

const DIMS = {
  dog: { L: 104, H: 46, leg: 38, legW: 13, R: 25 },
  cat: { L: 90, H: 38, leg: 31, legW: 10.5, R: 22 },
};

const lerp = (a, b, t) => a + (b - a) * t;
const lerpPt = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const ch = (v) => Math.round(lerp(v, target, t));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `rgb(${r},${g},${b})`;
}

// Small deterministic random numbers so markings stay put between frames.
function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function drawBall(ctx, x, y, r = 9, spin = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(spin);
  ctx.fillStyle = '#e3483d';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffd34d';
  ctx.lineWidth = r * 0.32;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, -0.9, 0.9);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.4, r * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, Math.PI * 2);
}

export function drawPet(ctx, pet, s) {
  const { look, species } = pet;
  const cat = species === 'cat';
  const { L, H, leg, legW, R } = DIMS[species];
  const pose = s.pose;
  const coat = look.coat;
  const far = shade(coat, -0.2);
  const dark = shade(coat, -0.35);
  const marking = look.marking;
  const sit = pose.sit * (1 - pose.lie);
  const lie = pose.lie;
  const crouch = pose.crouch * (1 - lie);
  const moving = Math.min(1, s.speed / 60);
  const blink = (s.time % 4.3) < 0.13;

  ctx.save();
  ctx.translate(s.x, s.y);

  // Shadow stays on the floor while the pet hops.
  const shadowScale = 1 / (1 + s.jump / 60);
  ctx.fillStyle = 'rgba(40, 30, 20, 0.18)';
  ellipse(ctx, 0, s.jump + 2, L * 0.62 * s.scale * shadowScale, 6 * s.scale * shadowScale);
  ctx.fill();

  ctx.scale(s.scale * s.dir, s.scale);

  // Body placement for standing, sitting and lying, blended by pose.
  const angle = -0.42 * sit + 0.12 * crouch;
  const standCy = -(leg + H * 0.42) + crouch * leg * 0.3;
  const sitCy = -0.487 * H - 0.1224 * L;
  const lieCy = -H * 0.5;
  const cy = lerp(lerp(standCy, sitCy, sit), lieCy, lie) + Math.sin(s.gait * 2) * 1.6 * moving;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toWorld = (lx, ly) => ({ x: lx * cos - ly * sin, y: cy + lx * sin + ly * cos });

  const stride = 13 * moving;
  const lift = 7 * moving;
  const legs = [
    { front: true, far: true, phase: 0 },
    { front: false, far: true, phase: Math.PI },
    { front: true, far: false, phase: Math.PI },
    { front: false, far: false, phase: 0 },
  ];

  const socks = look.pattern === 'tuxedo';
  function drawLeg(l) {
    const shift = l.far ? 5 : 0;
    const hipLx = (l.front ? 0.3 : -0.3) * L;
    const hip = toWorld(hipLx + shift, 0.15 * H);
    const g = s.gait + l.phase;
    const standPaw = { x: hipLx + shift + Math.sin(g) * stride, y: -Math.max(0, Math.cos(g)) * lift };
    const sitPaw = l.front ? { x: hip.x, y: 0 } : { x: -0.02 * L + shift, y: 0 };
    const liePaw = l.front ? { x: hipLx + leg * 0.95 + shift, y: 0 } : { x: hipLx + leg * 0.55 + shift, y: 0 };
    let paw = lerpPt(lerpPt(standPaw, sitPaw, sit), liePaw, lie);
    if (l.front && !l.far) {
      paw = lerpPt(paw, { x: hip.x + 24, y: hip.y + 2 }, pose.paw);
      paw = lerpPt(paw, { x: hip.x + 16, y: hip.y - 14 }, pose.groom);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = legW;
    ctx.strokeStyle = l.far ? far : coat;
    ctx.beginPath();
    ctx.moveTo(hip.x, hip.y);
    ctx.lineTo(paw.x, paw.y - legW * 0.3);
    ctx.stroke();
    if (socks) {
      const knee = lerpPt(hip, paw, 0.55);
      ctx.strokeStyle = l.far ? shade(marking, -0.15) : marking;
      ctx.beginPath();
      ctx.moveTo(knee.x, knee.y);
      ctx.lineTo(paw.x, paw.y - legW * 0.3);
      ctx.stroke();
    }
    ctx.fillStyle = socks ? (l.far ? shade(marking, -0.15) : marking) : (l.far ? far : coat);
    ellipse(ctx, paw.x + 2, paw.y - legW * 0.32, legW * 0.66, legW * 0.42);
    ctx.fill();
  }

  // Tail, behind the body.
  const tailBase = toWorld(-0.47 * L, -0.12 * H);
  const wag = Math.sin(s.wagPhase) * pose.wag * (cat ? 0.2 : 0.5);
  const theta = Math.PI - 1.2 + pose.tailUp * 2.1 + wag + angle;
  const tlen = cat ? 0.78 * L : 0.36 * L;
  const dirX = Math.cos(theta);
  const dirY = Math.sin(theta);
  const tip = { x: tailBase.x + dirX * tlen, y: Math.min(-3, tailBase.y + dirY * tlen) };
  // Sample the tail curve so it can taper and change colour at the tip.
  const c1 = cat
    ? { x: tailBase.x + dirX * tlen * 0.45 - 6, y: tailBase.y + dirY * tlen * 0.45 + 8 }
    : { x: tailBase.x + dirX * tlen * 0.6 + 6, y: tailBase.y + dirY * tlen * 0.6 - 8 };
  const c2 = cat ? { x: tip.x - 14 + Math.sin(s.time * 1.3) * 6, y: tip.y + 4 } : c1;
  const end = cat ? { x: tip.x + 6, y: tip.y - 2 } : tip;
  const tipColor = cat
    ? (look.pattern === 'tabby' ? dark : coat)
    : (look.pattern === 'patches' || look.pattern === 'tuxedo' ? marking : coat);
  const steps = 12;
  let prev = tailBase;
  ctx.lineCap = 'round';
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const pt = {
      x: u * u * u * tailBase.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
      y: u * u * u * tailBase.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
    };
    ctx.strokeStyle = t > 0.72 ? tipColor : coat;
    ctx.lineWidth = (cat ? 7.5 : 11) * (1 - t * 0.45);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    prev = pt;
  }

  legs.filter((l) => l.far).forEach(drawLeg);

  // Body.
  const bodyPath = () => {
    ctx.beginPath();
    ctx.ellipse(0, cy, L / 2, H / 2, angle, 0, Math.PI * 2);
    const chest = toWorld(0.24 * L, 0.04 * H);
    ctx.ellipse(chest.x, chest.y, 0.3 * L, H * (cat ? 0.5 : 0.56), angle, 0, Math.PI * 2);
  };
  ctx.fillStyle = coat;
  bodyPath();
  ctx.fill();

  ctx.save();
  bodyPath();
  ctx.clip();
  drawBodyPattern(ctx, look, { L, H, toWorld, angle, dark, marking, cat });
  // Soft light from above.
  const top = toWorld(0, -0.5 * H);
  const grad = ctx.createLinearGradient(0, top.y, 0, cy + H * 0.5);
  grad.addColorStop(0, 'rgba(255,255,255,0.16)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.12)');
  ctx.fillStyle = grad;
  ctx.fillRect(-L, top.y - 10, L * 2, H * 1.5);
  ctx.restore();

  // Thigh, bigger when sitting.
  const thigh = toWorld(-0.27 * L, 0.06 * H);
  ctx.fillStyle = coat;
  ellipse(ctx, thigh.x, thigh.y, 0.2 * L + sit * 0.06 * L, 0.42 * H + sit * 0.08 * H, angle - 0.3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 2;
  ctx.stroke();

  legs.filter((l) => !l.far).forEach(drawLeg);

  // Head position: up and forward, lowered to sniff or eat, or turned to groom.
  const neck = toWorld(0.36 * L, -0.2 * H);
  const headUp = { x: neck.x + (cat ? 8 : 10), y: neck.y - (cat ? 20 : 24) };
  const headDown = { x: neck.x + 26, y: -R * 0.8 };
  let head = lerpPt(headUp, headDown, pose.head);
  head = lerpPt(head, { x: neck.x + 10, y: neck.y - 4 }, pose.groom);
  head.y -= crouch * -6;

  ctx.strokeStyle = coat;
  ctx.lineWidth = R * 1.25;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(neck.x - 4, neck.y + 4);
  ctx.lineTo(head.x - R * 0.2, head.y + R * 0.2);
  ctx.stroke();

  // Collar.
  const collar = lerpPt(neck, head, 0.45);
  ctx.strokeStyle = look.collar ?? '#d0443c';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(collar.x - 2, collar.y + 2, R * 0.38, R * 0.62, -0.5, 0.6, Math.PI * 1.3);
  ctx.stroke();
  ctx.fillStyle = s.goldTag ? '#f1c94a' : '#c9ced6';
  ellipse(ctx, collar.x + R * 0.1, collar.y + R * 0.62, 3.6, 3.6);
  ctx.fill();

  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(pose.tilt * 0.38 + pose.head * 0.3);
  if (cat) drawCatHead(ctx, look, pose, { R, coat, dark, marking, blink, time: s.time });
  else drawDogHead(ctx, look, pose, { R, coat, dark, marking, blink, time: s.time });
  if (s.holdingBall) drawBall(ctx, R * 1.18, R * 0.5, 9);
  ctx.restore();

  ctx.restore();
}

function drawBodyPattern(ctx, look, { L, H, toWorld, angle, dark, marking, cat }) {
  const rand = seeded(look.seed ?? 1);
  switch (look.pattern) {
    case 'patches': {
      ctx.fillStyle = marking;
      for (let i = 0; i < 3; i++) {
        const p = toWorld((rand() - 0.5) * 0.8 * L, (rand() - 0.7) * 0.6 * H);
        ellipse(ctx, p.x, p.y, (0.12 + rand() * 0.12) * L, (0.25 + rand() * 0.2) * H, angle + rand());
        ctx.fill();
      }
      break;
    }
    case 'tuxedo': {
      ctx.fillStyle = marking;
      const p = toWorld(0.2 * L, 0.42 * H);
      ellipse(ctx, p.x, p.y, 0.48 * L, 0.36 * H, angle);
      ctx.fill();
      break;
    }
    case 'saddle': {
      ctx.fillStyle = marking;
      const p = toWorld(-0.08 * L, -0.42 * H);
      ellipse(ctx, p.x, p.y, 0.42 * L, 0.38 * H, angle);
      ctx.fill();
      break;
    }
    case 'tabby': {
      ctx.strokeStyle = dark;
      ctx.lineWidth = cat ? 4 : 5;
      ctx.lineCap = 'round';
      for (let i = -3; i <= 3; i++) {
        const a = toWorld(i * 0.11 * L, -0.55 * H);
        const b = toWorld(i * 0.11 * L + 5, 0.05 * H);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(a.x - 6, (a.y + b.y) / 2, b.x, b.y);
        ctx.stroke();
      }
      break;
    }
    default:
  }
}

function drawEye(ctx, x, y, rx, ry, iris, pose, blink, cat) {
  const closed = Math.max(pose.eyes, blink ? 1 : 0);
  if (closed > 0.6) {
    ctx.strokeStyle = '#2a1f1b';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, y - ry * 0.2, rx * 0.95, 0.25, Math.PI - 0.25);
    ctx.stroke();
    return;
  }
  const open = 1 - closed * 0.6;
  ctx.fillStyle = cat ? iris : '#241a16';
  ellipse(ctx, x, y, rx, ry * open);
  ctx.fill();
  if (cat) {
    ctx.fillStyle = '#1b1412';
    ellipse(ctx, x + rx * 0.15, y, rx * 0.32, ry * open * 0.85);
    ctx.fill();
  } else {
    ctx.fillStyle = iris;
    ellipse(ctx, x + rx * 0.1, y + ry * 0.1, rx * 0.6, ry * open * 0.6);
    ctx.fill();
    ctx.fillStyle = '#140e0c';
    ellipse(ctx, x + rx * 0.15, y + ry * 0.12, rx * 0.36, ry * open * 0.38);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ellipse(ctx, x - rx * 0.25, y - ry * 0.35 * open, rx * 0.3, rx * 0.3);
  ctx.fill();
}

function mouthOpen(pose, time) {
  return Math.max(pose.mouth, pose.chew * Math.abs(Math.sin(time * 11)) * 0.6);
}

function drawDogHead(ctx, look, pose, { R, coat, dark, marking, blink, time }) {
  const perk = pose.ears;
  const earColor = look.pattern === 'saddle' ? marking : dark;

  if (look.ears === 'pointy') {
    ctx.fillStyle = shade(look.coat, -0.25);
    ctx.beginPath();
    ctx.moveTo(-R * 0.05, -R * 0.7);
    ctx.lineTo(R * 0.45, -R * 0.75);
    ctx.lineTo(R * 0.18 - (1 - perk) * R * 0.45, -R * 1.5 + (1 - perk) * R * 0.45);
    ctx.fill();
  }

  // Cranium and snout.
  ctx.fillStyle = coat;
  ellipse(ctx, 0, 0, R, R * 0.95);
  ctx.fill();
  const muzzle = look.pattern === 'tuxedo' || look.pattern === 'patches' ? marking : shade(coat, 0.2);
  ctx.fillStyle = muzzle;
  ellipse(ctx, R * 0.82, R * 0.34, R * 0.62, R * 0.44, 0.08);
  ctx.fill();

  // Mouth.
  const m = mouthOpen(pose, time);
  if (m > 0.12) {
    ctx.fillStyle = '#4a2324';
    ellipse(ctx, R * 0.9, R * 0.7, R * 0.36, R * 0.2 * m + 1);
    ctx.fill();
    if (pose.mouth > 0.4) {
      ctx.fillStyle = '#e97f8a';
      ellipse(ctx, R * 0.95, R * 0.82 + m * R * 0.2, R * 0.16, R * 0.22 * m + 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = 'rgba(40,24,20,0.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(R * 1.3, R * 0.5);
  ctx.quadraticCurveTo(R * 1.0, R * 0.68, R * 0.62, R * 0.56);
  ctx.stroke();

  // Nose.
  ctx.fillStyle = '#231c1a';
  ellipse(ctx, R * 1.38, R * 0.16, R * 0.2, R * 0.16);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ellipse(ctx, R * 1.32, R * 0.1, R * 0.06, R * 0.04);
  ctx.fill();

  drawEye(ctx, R * 0.42, -R * 0.12, R * 0.15, R * 0.19, look.eyes, pose, blink, false);

  if (look.ears !== 'pointy') {
    // Floppy ear hangs from the top of the head; perking lifts it a little.
    ctx.fillStyle = earColor;
    ctx.beginPath();
    ctx.moveTo(R * 0.1, -R * 0.82);
    ctx.bezierCurveTo(-R * 0.65, -R * 0.95, -R * 0.75, R * 0.2, -R * 0.42, R * 0.72 - perk * R * 0.35);
    ctx.bezierCurveTo(-R * 0.15, R * 0.85 - perk * R * 0.35, R * 0.05, R * 0.1, R * 0.1, -R * 0.82);
    ctx.fill();
  } else {
    ctx.fillStyle = coat;
    ctx.beginPath();
    ctx.moveTo(-R * 0.6, -R * 0.55);
    ctx.lineTo(R * 0.05, -R * 0.82);
    ctx.lineTo(-R * 0.4 - (1 - perk) * R * 0.5, -R * 1.62 + (1 - perk) * R * 0.5);
    ctx.fill();
    ctx.fillStyle = '#e8a7a4';
    ctx.beginPath();
    ctx.moveTo(-R * 0.45, -R * 0.68);
    ctx.lineTo(-R * 0.1, -R * 0.8);
    ctx.lineTo(-R * 0.38 - (1 - perk) * R * 0.45, -R * 1.38 + (1 - perk) * R * 0.45);
    ctx.fill();
  }
}

function drawCatHead(ctx, look, pose, { R, coat, dark, marking, blink, time }) {
  const perk = pose.ears;
  const ear = (dx, color, inner) => {
    const back = (1 - perk) * R * 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-R * 0.62 + dx, -R * 0.45);
    ctx.lineTo(R * 0.12 + dx, -R * 0.86);
    ctx.lineTo(-R * 0.35 + dx - back, -R * 1.55 + back * 0.6);
    ctx.fill();
    if (inner) {
      ctx.fillStyle = '#eaa3a6';
      ctx.beginPath();
      ctx.moveTo(-R * 0.45 + dx, -R * 0.6);
      ctx.lineTo(R * 0.0 + dx, -R * 0.85);
      ctx.lineTo(-R * 0.33 + dx - back, -R * 1.3 + back * 0.6);
      ctx.fill();
    }
  };
  ear(R * 0.55, shade(look.coat, -0.22), false);

  ctx.fillStyle = coat;
  ellipse(ctx, 0, 0, R * 1.05, R * 0.95);
  ctx.fill();

  if (look.pattern === 'tabby') {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (const dx of [-0.35, -0.05, 0.25]) {
      ctx.beginPath();
      ctx.moveTo(R * dx, -R * 0.88);
      ctx.lineTo(R * (dx - 0.05), -R * 0.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-R * 0.6, R * 0.05);
    ctx.lineTo(-R * 0.1, R * 0.1);
    ctx.stroke();
  }

  const muzzle = look.pattern === 'tuxedo' || look.pattern === 'patches' ? marking : shade(coat, 0.22);
  ctx.fillStyle = muzzle;
  ellipse(ctx, R * 0.72, R * 0.36, R * 0.38, R * 0.3);
  ctx.fill();

  const m = mouthOpen(pose, time);
  if (m > 0.12) {
    ctx.fillStyle = '#4a2324';
    ellipse(ctx, R * 0.86, R * 0.6, R * 0.16, R * 0.12 * m + 1);
    ctx.fill();
  }

  // Nose and mouth.
  ctx.fillStyle = '#d98a8f';
  ctx.beginPath();
  ctx.moveTo(R * 1.02, R * 0.12);
  ctx.lineTo(R * 0.88, R * 0.12);
  ctx.lineTo(R * 0.97, R * 0.24);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,24,20,0.55)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(R * 0.97, R * 0.24);
  ctx.quadraticCurveTo(R * 0.95, R * 0.42, R * 0.78, R * 0.42);
  ctx.stroke();

  // Whiskers.
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1;
  for (const [dy, end] of [[0.28, 0.15], [0.36, 0.4], [0.44, 0.65]]) {
    ctx.beginPath();
    ctx.moveTo(R * 0.85, R * dy);
    ctx.lineTo(R * 1.65, R * end);
    ctx.stroke();
  }

  drawEye(ctx, R * 0.42, -R * 0.1, R * 0.19, R * 0.22, look.eyes, pose, blink, true);
  ear(0, coat, true);
}
