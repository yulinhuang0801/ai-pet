// Things a pet turns up on walks, and the little drawings of them used both
// in the scene and in the collection.

export const FINDS = [
  { id: 'stick', name: 'Stick', weight: 10 },
  { id: 'leaf', name: 'Maple leaf', weight: 9 },
  { id: 'stone', name: 'Smooth stone', weight: 8 },
  { id: 'pinecone', name: 'Pinecone', weight: 7 },
  { id: 'acorn', name: 'Acorn', weight: 7 },
  { id: 'feather', name: 'Feather', weight: 6, cat: 3 },
  { id: 'tennis', name: 'Lost tennis ball', weight: 3 },
  { id: 'cap', name: 'Bottle cap', weight: 3 },
  { id: 'glove', name: 'Odd glove', weight: 1.2 },
  { id: 'clover', name: 'Four-leaf clover', weight: 0.8 },
  { id: 'coin', name: 'Old coin', weight: 0.6 },
];

export const findById = (id) => FINDS.find((f) => f.id === id);

export function pickFind(species, rng = Math.random) {
  const weights = FINDS.map((f) => f.weight * (species === 'cat' ? (f.cat ?? 1) : 1));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < FINDS.length; i++) {
    r -= weights[i];
    if (r <= 0) return FINDS[i];
  }
  return FINDS[0];
}

// Add a find to the pet's collection. Returns true the first time.
export function collect(pet, id, place, now = Date.now()) {
  const c = pet.memory.finds;
  const first = !c[id];
  c[id] ??= { count: 0, first: now, place };
  c[id].count += 1;
  return first;
}

// Small drawing of a find, centred at x, y, about 20 units across at s = 1.
export function drawFind(ctx, id, x, y, s = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  const circle = (cx, cy, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (id) {
    case 'stick':
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-10, 4);
      ctx.lineTo(10, -3);
      ctx.moveTo(2, 0);
      ctx.lineTo(6, -7);
      ctx.stroke();
      break;
    case 'leaf':
      ctx.fillStyle = '#d4602c';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.62;
        ctx.lineTo(Math.cos(a) * 9, Math.sin(a) * 9 + 2);
        ctx.lineTo(Math.cos(a + 0.31) * 4, Math.sin(a + 0.31) * 4 + 2);
      }
      ctx.fill();
      ctx.strokeStyle = '#8a3a18';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.lineTo(0, 9);
      ctx.stroke();
      break;
    case 'stone':
      ctx.fillStyle = '#9aa1a8';
      ctx.beginPath();
      ctx.ellipse(0, 2, 9, 6, 0.2, 0, Math.PI * 2);
      ctx.fill();
      circle(-3, 0, 2, 'rgba(255,255,255,0.4)');
      break;
    case 'pinecone':
      ctx.fillStyle = '#8a5a32';
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#5e3a1e';
      ctx.lineWidth = 1.2;
      for (let i = -6; i <= 6; i += 4) {
        ctx.beginPath();
        ctx.moveTo(-5, i);
        ctx.lineTo(0, i + 3);
        ctx.lineTo(5, i);
        ctx.stroke();
      }
      break;
    case 'acorn':
      ctx.fillStyle = '#b07a3e';
      ctx.beginPath();
      ctx.ellipse(0, 3, 5.5, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6b4a2a';
      ctx.beginPath();
      ctx.ellipse(0, -2.5, 7, 4, 0, Math.PI, Math.PI * 2.0001);
      ctx.fill();
      ctx.fillRect(-1, -9, 2, 4);
      break;
    case 'feather':
      ctx.fillStyle = '#e9e4da';
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5, 10, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9a8f80';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-5, 9);
      ctx.lineTo(5, -9);
      ctx.stroke();
      break;
    case 'tennis':
      circle(0, 0, 8, '#c9df3a');
      ctx.strokeStyle = '#f4f7e8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-8, 0, 7, -1, 1);
      ctx.arc(8, 0, 7, Math.PI - 1, Math.PI + 1);
      ctx.stroke();
      break;
    case 'cap':
      circle(0, 0, 7, '#c4473a');
      circle(0, 0, 4.5, '#e2685c');
      break;
    case 'glove':
      ctx.fillStyle = '#3f6fb0';
      ctx.beginPath();
      ctx.roundRect(-6, -2, 12, 10, 3);
      for (let i = 0; i < 4; i++) ctx.roundRect(-6 + i * 3.2, -9, 2.6, 9, 1.3);
      ctx.roundRect(5, 0, 5, 2.6, 1.3);
      ctx.fill();
      break;
    case 'clover':
      for (const [dx, dy] of [[-3.5, -3.5], [3.5, -3.5], [-3.5, 3.5], [3.5, 3.5]]) circle(dx, dy, 4, '#3f9a4a');
      ctx.strokeStyle = '#2c7036';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(4, 10);
      ctx.stroke();
      break;
    case 'coin':
      circle(0, 0, 7.5, '#d6a734');
      ctx.strokeStyle = '#a77d1c';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
      break;
    default:
      circle(0, 0, 6, '#999');
  }
  ctx.restore();
}
