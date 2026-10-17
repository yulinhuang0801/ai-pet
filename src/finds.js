// Things a pet turns up on walks, and the pet's collection of them.
// Their drawings are in finds-art.js.

// `where` makes a find likelier (or, at 0, impossible) in some settings:
// park, woods, water, beach, street, town.
export const FINDS = [
  { id: 'stick', name: 'Stick', weight: 10, where: { woods: 2, park: 1.5, town: 0.3 } },
  { id: 'leaf', name: 'Maple leaf', weight: 9, where: { park: 1.5, woods: 1.5, beach: 0.2 } },
  { id: 'stone', name: 'Smooth stone', weight: 8, where: { water: 2, beach: 2 } },
  { id: 'pinecone', name: 'Pinecone', weight: 7, where: { woods: 3, park: 1.3, street: 0.3, town: 0.1, beach: 0.1 } },
  { id: 'acorn', name: 'Acorn', weight: 7, where: { woods: 2, park: 2, street: 0.4, town: 0.1, beach: 0 } },
  { id: 'feather', name: 'Feather', weight: 6, cat: 3, where: { water: 2, beach: 1.5 } },
  { id: 'shell', name: 'Seashell', weight: 5, where: { beach: 3, water: 0.6, park: 0, woods: 0, street: 0, town: 0, any: 0 } },
  { id: 'tennis', name: 'Lost tennis ball', weight: 3, where: { park: 1.5, woods: 0.3 } },
  { id: 'cap', name: 'Bottle cap', weight: 3, where: { street: 3, town: 3, woods: 0.2 } },
  { id: 'glove', name: 'Odd glove', weight: 1.2, where: { street: 2, town: 2 } },
  { id: 'clover', name: 'Four-leaf clover', weight: 0.8, where: { park: 2, street: 0.2, town: 0, beach: 0 } },
  { id: 'coin', name: 'Old coin', weight: 0.6, where: { town: 2, beach: 1.5 } },
];

export const findById = (id) => FINDS.find((f) => f.id === id);

// A random find for this kind of place ('any' when the setting is unknown).
export function pickFind(species, rng = Math.random, where = 'any') {
  const weights = FINDS.map((f) => f.weight * (species === 'cat' ? (f.cat ?? 1) : 1) * (f.where?.[where] ?? 1));
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
