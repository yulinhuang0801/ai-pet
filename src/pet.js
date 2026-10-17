// Pet model: who the pet is (look, personality) and how it is doing (needs,
// bond, memory). Pure data + pure functions so it can be tested in Node.

export const SAVE_VERSION = 1;

export const COAT_COLORS = [
  { id: 'cream', name: 'Cream', hex: '#efd8b0' },
  { id: 'golden', name: 'Golden', hex: '#d49a50' },
  { id: 'ginger', name: 'Ginger', hex: '#d8763a' },
  { id: 'chocolate', name: 'Chocolate', hex: '#6e4632' },
  { id: 'grey', name: 'Blue grey', hex: '#8b919c' },
  { id: 'black', name: 'Black', hex: '#2c2827' },
  { id: 'white', name: 'White', hex: '#f5f2ec' },
];

export const EYE_COLORS = [
  { id: 'brown', name: 'Brown', hex: '#4a2f1d' },
  { id: 'amber', name: 'Amber', hex: '#c58a1c' },
  { id: 'green', name: 'Green', hex: '#5f9a3a' },
  { id: 'blue', name: 'Blue', hex: '#4f8fd0' },
];

export const PATTERNS = {
  dog: [
    { id: 'solid', name: 'Solid' },
    { id: 'patches', name: 'Patches' },
    { id: 'tuxedo', name: 'Tuxedo' },
    { id: 'saddle', name: 'Saddle' },
  ],
  cat: [
    { id: 'solid', name: 'Solid' },
    { id: 'tabby', name: 'Tabby' },
    { id: 'tuxedo', name: 'Tuxedo' },
    { id: 'patches', name: 'Patches' },
  ],
};

export const COLLAR_COLORS = ['#d0443c', '#2f7f8f', '#e0a526', '#6a4fb3', '#2f8f4e', '#e46aa0'];

export const SIZES = [
  { id: 'small', name: 'Small' },
  { id: 'medium', name: 'Medium' },
  { id: 'large', name: 'Large' },
];

// Personality traits, all 0..1. Shown to the owner as sliders.
export const TRAITS = [
  { id: 'energy', low: 'Couch potato', high: 'Bundle of energy' },
  { id: 'playful', low: 'Dignified', high: 'Playful' },
  { id: 'cuddly', low: 'Aloof', high: 'Cuddly' },
  { id: 'stubborn', low: 'Eager to please', high: 'Stubborn' },
];

export const NEEDS = [
  { id: 'fullness', name: 'Fullness' },
  { id: 'energy', name: 'Energy' },
  { id: 'fun', name: 'Fun' },
  { id: 'affection', name: 'Affection' },
];

export function sizeScale(look, species) {
  const table = species === 'cat'
    ? { small: 0.85, medium: 1, large: 1.15 }
    : { small: 0.75, medium: 1, large: 1.25 };
  return table[look.size] ?? 1;
}

// Grams of food per meal, by species and size.
export function portionGrams(pet) {
  if (pet.species === 'cat') return { small: 40, medium: 50, large: 65 }[pet.look.size] ?? 50;
  return { small: 80, medium: 180, large: 320 }[pet.look.size] ?? 180;
}

export function defaultLook(species) {
  return species === 'cat'
    ? { size: 'medium', coat: '#8b919c', marking: '#f5f2ec', pattern: 'tabby', ears: 'pointy', eyes: '#5f9a3a', collar: '#2f7f8f', seed: 7 }
    : { size: 'medium', coat: '#d49a50', marking: '#f5f2ec', pattern: 'patches', ears: 'floppy', eyes: '#4a2f1d', collar: '#d0443c', seed: 3 };
}

export function defaultTraits(species) {
  return species === 'cat'
    ? { energy: 0.45, playful: 0.55, cuddly: 0.4, stubborn: 0.65 }
    : { energy: 0.65, playful: 0.75, cuddly: 0.7, stubborn: 0.3 };
}

export function createPet({ name, species, look, traits }, now = Date.now()) {
  return {
    version: SAVE_VERSION,
    name: (name || '').trim() || (species === 'cat' ? 'Miso' : 'Mochi'),
    species,
    adoptedAt: now,
    lastSeen: now,
    look: { ...defaultLook(species), ...look },
    traits: { ...defaultTraits(species), ...traits },
    needs: { fullness: 70, energy: 80, fun: 55, affection: 50 },
    bond: 5,
    bowlGrams: 0,
    memory: {
      // How often things happen at each hour of the day, decayed over time.
      routine: { feed: new Array(24).fill(0), walk: new Array(24).fill(0) },
      // 0..1: how reliably the pet performs each trick on cue.
      tricks: { sit: 0.05, down: 0.02, paw: 0, spin: 0 },
      // 0..1: how well the pet recognises each word.
      words: { name: 0.15, walk: 0, dinner: 0, ball: 0, treat: 0 },
      // How much the owner does each thing; shapes the pet's tastes.
      habits: { fetch: 0, petting: 0, walks: 0, treats: 0, talk: 0 },
      milestones: {},
      treatsToday: { day: '', count: 0 },
      stats: { meals: 0, grams: 0, fetches: 0, walkMeters: 0, walks: 0 },
      journal: [],
    },
  };
}

export const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

const PER_HOUR = 1 / 3600;

// Need change per second while awake / asleep, before exertion.
export const RATES = {
  fullness: -12.5 * PER_HOUR, // empty bowl to hungry in about 8 h
  energyAwake: -9 * PER_HOUR,
  energySleep: 60 * PER_HOUR, // a 90-minute nap refills a tired pet
  fun: -30 * PER_HOUR,
  affection: -22 * PER_HOUR,
};

// Extra energy cost per second of movement, on top of RATES.
export const EXERTION = { rest: 0, walk: 0.012, run: 0.05, sleep: 0 };

export function tickNeeds(pet, dt, exertion = 'rest') {
  const n = pet.needs;
  const asleep = exertion === 'sleep';
  n.fullness = clamp(n.fullness + RATES.fullness * dt * (asleep ? 0.5 : 1));
  n.energy = clamp(n.energy + (asleep ? RATES.energySleep : RATES.energyAwake - EXERTION[exertion]) * dt);
  n.fun = clamp(n.fun + RATES.fun * dt * (asleep ? 0.3 : 1));
  n.affection = clamp(n.affection + RATES.affection * dt * (asleep ? 0.3 : 1));
}

export function addNeeds(pet, delta) {
  for (const [k, v] of Object.entries(delta)) pet.needs[k] = clamp(pet.needs[k] + v);
}

export function addBond(pet, amount) {
  pet.bond = clamp(pet.bond + amount);
}

export function mood(pet, asleep = false) {
  const n = pet.needs;
  if (asleep) return { id: 'asleep', label: 'Asleep' };
  if (n.fullness < 25) return { id: 'hungry', label: 'Hungry' };
  if (n.energy < 20) return { id: 'tired', label: 'Worn out' };
  if (n.affection < 25) return { id: 'lonely', label: 'Lonely' };
  if (n.fun < 25) return { id: 'bored', label: 'Bored' };
  const avg = (n.fullness + n.energy + n.fun + n.affection) / 4;
  if (avg > 72) return { id: 'happy', label: 'Happy' };
  return { id: 'content', label: 'Content' };
}

export function bondLabel(bond) {
  if (bond < 15) return 'Getting to know you';
  if (bond < 35) return 'Warming up to you';
  if (bond < 60) return 'Friends';
  if (bond < 85) return 'Best friends';
  return 'Inseparable';
}

export function ageLabel(pet, now = Date.now()) {
  const days = Math.floor((now - pet.adoptedAt) / 86400000);
  if (days < 1) return 'Adopted today';
  if (days === 1) return 'With you 1 day';
  return `With you ${days} days`;
}

export function addJournal(pet, text, now = Date.now()) {
  pet.memory.journal.unshift({ t: now, text });
  pet.memory.journal.length = Math.min(pet.memory.journal.length, 60);
}

// Fast-forward the time the owner was away. Pets left alone mostly doze,
// eat what is in the bowl when they get hungry, and miss their person.
export function catchUp(pet, now = Date.now()) {
  const away = Math.max(0, (now - pet.lastSeen) / 1000);
  pet.lastSeen = now;
  if (away < 60) return null;
  const secs = Math.min(away, 3 * 86400);
  const n = pet.needs;
  let ate = 0;

  // Simulate in 10-minute steps, alternating doze and awake time.
  const step = 600;
  for (let t = 0; t < secs; t += step) {
    const dt = Math.min(step, secs - t);
    const sleepy = n.energy < 85;
    tickNeeds(pet, dt * 0.5, sleepy ? 'sleep' : 'rest');
    tickNeeds(pet, dt * 0.5, 'rest');
    if (n.fullness < 60 && pet.bowlGrams > 0) {
      const grams = pet.bowlGrams;
      pet.bowlGrams = 0;
      ate += grams;
      n.fullness = clamp(n.fullness + (grams / portionGrams(pet)) * 55);
    }
  }
  if (secs > 86400) addBond(pet, -2 * (secs / 86400));

  const hours = secs / 3600;
  const duration = hours < 1 ? `${Math.round(secs / 60)} minutes`
    : hours < 48 ? `${Math.round(hours)} hours`
    : `${Math.round(hours / 24)} days`;
  return {
    awaySeconds: away,
    ate,
    text: `You were away ${duration}. ` +
      (ate ? `${pet.name} finished the food in the bowl` : n.fullness < 35 ? `${pet.name} is hungry` : `${pet.name} napped a lot`) +
      (n.affection < 35 ? ' and really missed you.' : '.'),
  };
}

export function serialize(pet) {
  return JSON.stringify(pet);
}

export function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.version !== SAVE_VERSION || !data.species) return null;
  // Fill in anything added since the save was written.
  const fresh = createPet({ name: data.name, species: data.species, look: data.look, traits: data.traits }, data.adoptedAt);
  return {
    ...fresh,
    ...data,
    needs: { ...fresh.needs, ...data.needs },
    memory: {
      ...fresh.memory,
      ...data.memory,
      routine: { ...fresh.memory.routine, ...data.memory?.routine },
      tricks: { ...fresh.memory.tricks, ...data.memory?.tricks },
      words: { ...fresh.memory.words, ...data.memory?.words },
      habits: { ...fresh.memory.habits, ...data.memory?.habits },
      stats: { ...fresh.memory.stats, ...data.memory?.stats },
    },
  };
}
