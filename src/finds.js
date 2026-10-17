// Things a pet turns up on walks, and the pet's collection of them.
// Their drawings are in finds-art.js.

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
