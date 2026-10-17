// Draws the owner side on in the 2D view, in view units with the feet at
// y = 0. The owner's look options live in owner-look.js.

// Segment lengths in view units.
export const OWNER = { thigh: 64, shin: 64, torso: 92, upperArm: 58, forearm: 54, head: 31, hipY: 128 };

const shade = (hex, amount) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * (1 - amount));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

// Two-bone IK: the joint between a root and a target, bending toward `bend`.
export function solveJoint(root, target, a, b, bend) {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const d = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const angle = Math.acos((a * a + d * d - b * b) / (2 * a * d));
  const theta = base + bend * angle;
  return { x: root.x + Math.cos(theta) * a, y: root.y + Math.sin(theta) * a };
}

// The near shoulder in view space, for working out what the owner can reach.
export function shoulderPoint(o, groundY) {
  return { x: o.x + o.dir * o.crouch * 22, y: groundY - OWNER.hipY - OWNER.torso + 8 + o.crouch * 60 };
}

function limb(ctx, a, j, b, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(j.x, j.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// s: { x, dir, phase, speed, crouch, time, hand }, where hand is the near
// hand's target in view space, or null to let the arm swing.
export function drawOwner(ctx, look, s, groundY) {
  const { thigh, shin, torso, upperArm, forearm, head: R } = OWNER;
  const moving = Math.min(1, s.speed / 80);
  const crouch = s.crouch;
  const skin = look.skin;
  const top = look.top;
  const bottom = look.bottom;

  ctx.save();
  ctx.translate(s.x, groundY);

  ctx.fillStyle = 'rgba(40, 30, 20, 0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 2, 42, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.scale(s.dir, 1);
  const bob = Math.abs(Math.sin(s.phase)) * 3 * moving;
  const hip = { x: -crouch * 10, y: -OWNER.hipY + crouch * 52 - bob };
  const lean = crouch * 0.35;
  const shoulder = { x: hip.x + Math.sin(lean) * torso, y: hip.y - Math.cos(lean) * (torso - 8) };
  const neck = { x: hip.x + Math.sin(lean) * (torso + 6), y: hip.y - Math.cos(lean) * (torso + 6) };
  const headC = { x: neck.x + 6, y: neck.y - R - 4 };

  // Legs: feet swing while walking, knees bend forward when crouching.
  const legs = [{ far: true, phase: Math.PI }, { far: false, phase: 0 }];
  const drawLeg = (l) => {
    const g = s.phase + l.phase;
    const foot = {
      x: hip.x + (l.far ? 4 : -2) + Math.sin(g) * 26 * moving + crouch * 8,
      y: -Math.max(0, Math.cos(g)) * 12 * moving,
    };
    const h = { x: hip.x + (l.far ? 4 : 0), y: hip.y };
    const ankle = { x: foot.x, y: foot.y - 3 };
    const knee = solveJoint(h, ankle, thigh, shin, -1);
    limb(ctx, h, knee, ankle, 22, l.far ? shade(bottom, 0.22) : bottom);
    ctx.fillStyle = l.far ? '#2a2422' : '#3a312d';
    ctx.beginPath();
    ctx.ellipse(foot.x + 8, foot.y - 5, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  // Arms: the far arm swings; the near arm reaches for the hand target.
  const swing = (phase) => {
    const a = Math.sin(s.phase + phase) * 0.5 * moving;
    const elbow = { x: shoulder.x + Math.sin(a) * upperArm, y: shoulder.y + Math.cos(a) * upperArm };
    const hand = { x: elbow.x + Math.sin(a + 0.25) * forearm, y: elbow.y + Math.cos(a + 0.25) * forearm };
    return { elbow, hand };
  };
  const farArm = swing(0);
  let nearArm = swing(Math.PI);
  if (s.hand) {
    const target = { x: (s.hand.x - s.x) * s.dir, y: s.hand.y - groundY };
    const elbow = solveJoint(shoulder, target, upperArm, forearm, 1);
    const reach = Math.hypot(target.x - shoulder.x, target.y - shoulder.y);
    const k = Math.min(1, (upperArm + forearm) / Math.max(1, reach));
    const hand = { x: shoulder.x + (target.x - shoulder.x) * k, y: shoulder.y + (target.y - shoulder.y) * k };
    nearArm = { elbow, hand };
  }

  const sleeve = (arm, far) => {
    const color = far ? shade(top, 0.22) : top;
    const elbowMid = { x: (shoulder.x + arm.elbow.x) / 2, y: (shoulder.y + arm.elbow.y) / 2 };
    limb(ctx, shoulder, elbowMid, arm.elbow, 17, color);
    limb(ctx, arm.elbow, arm.elbow, arm.hand, 13, far ? shade(skin, 0.15) : skin);
    ctx.fillStyle = far ? shade(skin, 0.15) : skin;
    ctx.beginPath();
    ctx.arc(arm.hand.x, arm.hand.y, 8, 0, Math.PI * 2);
    ctx.fill();
  };

  sleeve(farArm, true);
  drawLeg(legs[0]);

  // Long hair falls behind the body.
  if (look.hair === 'long') {
    ctx.fillStyle = look.hairColor;
    ctx.beginPath();
    ctx.ellipse(headC.x - R * 0.45, headC.y + R * 0.8, R * 0.7, R * 1.25, 0.15, 0, Math.PI * 2);
    ctx.fill();
  }

  // Torso.
  ctx.save();
  ctx.translate(hip.x, hip.y);
  ctx.rotate(lean);
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.roundRect(-24, -torso, 48, torso + 10, [20, 20, 12, 12]);
  ctx.fill();
  ctx.fillStyle = bottom;
  ctx.beginPath();
  ctx.roundRect(-24, -6, 48, 20, [4, 4, 10, 10]);
  ctx.fill();
  ctx.restore();

  drawLeg(legs[1]);

  // Neck and head.
  ctx.strokeStyle = shade(skin, 0.08);
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(neck.x, neck.y + 6);
  ctx.lineTo(headC.x - 2, headC.y + R * 0.6);
  ctx.stroke();

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(headC.x, headC.y, R * 0.92, R, 0, 0, Math.PI * 2);
  ctx.fill();
  // Nose.
  ctx.beginPath();
  ctx.ellipse(headC.x + R * 0.9, headC.y + R * 0.05, R * 0.16, R * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  drawHair(ctx, look, headC, R);

  // Ear, eye and mouth.
  ctx.fillStyle = shade(skin, 0.1);
  ctx.beginPath();
  ctx.ellipse(headC.x - R * 0.15, headC.y + R * 0.08, R * 0.16, R * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#231a16';
  const blink = (s.time % 5.1) < 0.12;
  if (blink) ctx.fillRect(headC.x + R * 0.42, headC.y - R * 0.12, R * 0.22, 2);
  else {
    ctx.beginPath();
    ctx.ellipse(headC.x + R * 0.52, headC.y - R * 0.1, R * 0.08, R * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#7a3b2e';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(headC.x + R * 0.55, headC.y + R * 0.3, R * 0.18, 0.3, Math.PI * 0.8);
  ctx.stroke();

  sleeve(nearArm, false);

  ctx.restore();

  // The near hand in view space, for drawing held items and the leash.
  return { x: s.x + nearArm.hand.x * s.dir, y: groundY + nearArm.hand.y };
}

function drawHair(ctx, look, c, R) {
  ctx.fillStyle = look.hairColor;
  switch (look.hair) {
    case 'buzz':
      ctx.beginPath();
      ctx.ellipse(c.x - R * 0.05, c.y - R * 0.25, R * 0.95, R * 0.8, 0, Math.PI * 0.95, Math.PI * 2.02);
      ctx.fill();
      break;
    case 'curly':
      for (const [dx, dy, r] of [[-0.6, -0.5, 0.42], [-0.15, -0.8, 0.45], [0.35, -0.75, 0.4], [-0.75, 0, 0.4], [0.7, -0.45, 0.3], [-0.5, 0.35, 0.33]]) {
        ctx.beginPath();
        ctx.arc(c.x + dx * R, c.y + dy * R, r * R, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default: {
      // Short, long and bun share the cap of hair over the top and back.
      ctx.beginPath();
      ctx.ellipse(c.x - R * 0.1, c.y - R * 0.3, R * 1.0, R * 0.82, 0, Math.PI * 0.85, Math.PI * 2.05);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x - R * 0.55, c.y + R * 0.05, R * 0.42, R * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(c.x + R * 0.45, c.y - R * 0.62, R * 0.45, R * 0.24, 0.35, 0, Math.PI * 2);
      ctx.fill();
      if (look.hair === 'bun') {
        ctx.beginPath();
        ctx.arc(c.x - R * 0.55, c.y - R * 0.95, R * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
