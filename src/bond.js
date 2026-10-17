// The relationship: hearts earned by doing things together, capped per day so
// a little every day counts for more than one long session. Hearts add up to
// bond levels, and each level unlocks something.

import { addJournal } from './pet.js';

export const HEART_SOURCES = {
  walk: { label: 'Walks', per: 250, unit: 'm', cap: 3, hint: '1 for every 250 m walked' },
  play: { label: 'Play', per: 3, unit: 'fetches', cap: 2, hint: '1 for every 3 balls brought back' },
  meal: { label: 'Meals', per: 1, unit: 'meal', cap: 2, hint: '1 for each meal you serve' },
  pet: { label: 'Cuddles', per: 15, unit: 's', cap: 2, hint: '1 for every 15 seconds of petting' },
  train: { label: 'Training', per: 1, unit: 'reward', cap: 2, hint: '1 for each trick you reward' },
};
export const DAILY_CAP = 10;

export const LEVELS = [
  { hearts: 0, name: 'Getting to know you', unlock: null },
  { hearts: 5, name: 'Warming up', unlock: { id: 'paw', text: 'can learn “shake paw”' } },
  { hearts: 20, name: 'Friends', unlock: { id: 'spin', text: 'can learn “spin” and brings you gifts' } },
  { hearts: 50, name: 'Good friends', unlock: { id: 'offLeash', text: 'can walk off the leash' } },
  { hearts: 100, name: 'Best friends', unlock: { id: 'nap', text: 'naps at your feet' } },
  { hearts: 200, name: 'Inseparable', unlock: { id: 'goldTag', text: 'wears a golden name tag' } },
];

// Behaviour uses a 0..100 trust value; it follows the hearts.
const TRUST = [0, 15, 35, 60, 85, 100];

export function today(now = new Date()) { return now.toDateString(); }

function state(pet, now) {
  const h = pet.memory.hearts;
  if (h.day !== today(now)) {
    h.day = today(now);
    h.today = {};
    h.partial = {};
  }
  return h;
}

export function levelIndex(total) {
  let i = 0;
  while (i + 1 < LEVELS.length && total >= LEVELS[i + 1].hearts) i++;
  return i;
}

export function level(pet) {
  const total = pet.memory.hearts.total;
  const i = levelIndex(total);
  const next = LEVELS[i + 1];
  return {
    index: i,
    ...LEVELS[i],
    next,
    progress: next ? (total - LEVELS[i].hearts) / (next.hearts - LEVELS[i].hearts) : 1,
  };
}

export function trustFromHearts(total) {
  const i = levelIndex(total);
  const next = LEVELS[i + 1];
  if (!next) return 100;
  const t = (total - LEVELS[i].hearts) / (next.hearts - LEVELS[i].hearts);
  return TRUST[i] + (TRUST[i + 1] - TRUST[i]) * t;
}

export function unlocked(pet, id) {
  const i = levelIndex(pet.memory.hearts.total);
  return LEVELS.slice(0, i + 1).some((l) => l.unlock?.id === id);
}

export function unlockLevel(id) {
  return LEVELS.find((l) => l.unlock?.id === id);
}

export function heartsToday(pet, now = new Date()) {
  const h = state(pet, now);
  return Object.values(h.today).reduce((a, b) => a + b, 0);
}

// Record some of an activity (metres walked, seconds petted...). Returns a
// level-up message when this pushed the bond to a new level.
export function earn(pet, kind, amount, now = new Date()) {
  const src = HEART_SOURCES[kind];
  const h = state(pet, now);
  h.partial[kind] = (h.partial[kind] ?? 0) + amount;
  const whole = Math.floor(h.partial[kind] / src.per);
  if (whole <= 0) return null;
  h.partial[kind] -= whole * src.per;
  const room = Math.min(src.cap - (h.today[kind] ?? 0), DAILY_CAP - heartsToday(pet, now));
  const gained = Math.max(0, Math.min(whole, room));
  if (!gained) return null;
  h.today[kind] = (h.today[kind] ?? 0) + gained;
  return addHearts(pet, gained, now);
}

// For saves made before hearts existed: the hearts that match a trust value.
export function heartsFromTrust(trust) {
  for (let i = 0; i + 1 < TRUST.length; i++) {
    if (trust <= TRUST[i + 1]) {
      const t = (trust - TRUST[i]) / (TRUST[i + 1] - TRUST[i]);
      return LEVELS[i].hearts + (LEVELS[i + 1].hearts - LEVELS[i].hearts) * t;
    }
  }
  return LEVELS[LEVELS.length - 1].hearts;
}

export function addHearts(pet, n, now = new Date()) {
  const h = pet.memory.hearts;
  const before = levelIndex(h.total);
  h.total = Math.max(0, h.total + n);
  pet.bond = trustFromHearts(h.total);
  const after = levelIndex(h.total);
  if (after > before) {
    const l = LEVELS[after];
    const text = `Bond level up: ${l.name}! ${pet.name} ${l.unlock.text}.`;
    addJournal(pet, text, now.getTime());
    return text;
  }
  return null;
}
