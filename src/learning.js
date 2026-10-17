// How the pet learns from its owner: tricks through reward, words through
// association, and daily routines through repetition.

import { addJournal, addBond, clamp } from './pet.js';

export const TRICKS = {
  sit: { label: 'Sit' },
  down: { label: 'Lie down' },
  paw: { label: 'Shake paw' },
  spin: { label: 'Spin' },
};

export const WORDS = {
  name: { label: 'Its name' },
  walk: { label: '“Walk”' },
  dinner: { label: '“Dinner”' },
  ball: { label: '“Ball”' },
  treat: { label: '“Treat”' },
};

const SKILL_STEPS = [
  [0.3, (n, t) => `${n} is starting to get “${t}”.`],
  [0.65, (n, t) => `${n} knows “${t}” now.`],
  [0.9, (n, t) => `${n} has “${t}” down perfectly.`],
];

function milestone(pet, key, text, now) {
  if (pet.memory.milestones[key]) return null;
  pet.memory.milestones[key] = now;
  addJournal(pet, text, now);
  return text;
}

// Chance the pet does a trick when asked.
export function trickChance(pet, trick) {
  const skill = pet.memory.tricks[trick] ?? 0;
  const t = pet.traits;
  const n = pet.needs;
  let p = 0.04 + skill * 0.88;
  p *= 1 - t.stubborn * 0.35;
  p *= 0.75 + pet.bond / 400;
  if (pet.species === 'cat') p *= 0.75;
  if (n.energy < 15) p *= 0.5;
  if (n.fullness < 20) p *= 0.7; // too distracted by hunger
  return clamp(p, 0.02, 0.97);
}

// A reward shortly after the pet did a trick (on cue or by itself).
// kind: 'treat' | 'praise'
export function reinforce(pet, trick, kind, now = Date.now()) {
  const tricks = pet.memory.tricks;
  const before = tricks[trick] ?? 0;
  const rate = (kind === 'treat' ? 0.11 : 0.05) * (1 - pet.traits.stubborn * 0.4) * (pet.species === 'cat' ? 0.8 : 1);
  tricks[trick] = clamp(before + rate * (1 - before), 0, 1);
  addBond(pet, kind === 'treat' ? 0.6 : 0.4);
  const label = TRICKS[trick].label.toLowerCase();
  for (const [threshold, text] of SKILL_STEPS) {
    if (before < threshold && tricks[trick] >= threshold) {
      return milestone(pet, `trick:${trick}:${threshold}`, text(pet.name, label), now);
    }
  }
  return null;
}

// Hearing a word shortly before the thing it stands for happens.
export function associate(pet, word, now = Date.now()) {
  const words = pet.memory.words;
  const before = words[word] ?? 0;
  words[word] = clamp(before + 0.2 * (1 - before), 0, 1);
  if (before < 0.5 && words[word] >= 0.5) {
    const text = word === 'name'
      ? `${pet.name} answers to its name now.`
      : `${pet.name} perks up when you say “${word}”.`;
    return milestone(pet, `word:${word}`, text, now);
  }
  return null;
}

export function recognises(pet, word) {
  return (pet.memory.words[word] ?? 0) >= 0.5;
}

export function formatHour(h) {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour} ${suffix}`;
}

// Something happened at this time of day. Old habits fade slowly so a new
// schedule takes over after a few days.
export function recordRoutine(pet, kind, date = new Date()) {
  const bins = pet.memory.routine[kind];
  for (let i = 0; i < 24; i++) bins[i] *= 0.93;
  const h = date.getHours();
  const before = bins[h];
  bins[h] += 1;
  if (before < 2.5 && bins[h] >= 2.5) {
    const what = kind === 'feed' ? 'food comes' : 'walks happen';
    return milestone(pet, `routine:${kind}:${h}`, `${pet.name} has learned that ${what} around ${formatHour(h)}.`, date.getTime());
  }
  return null;
}

// 0..1: how strongly the pet expects this to happen around now.
export function expects(pet, kind, date = new Date()) {
  const bins = pet.memory.routine[kind];
  const h = date.getHours();
  const strength = Math.max(bins[h], bins[(h + 23) % 24] * 0.7);
  return clamp((strength - 1.5) / 2, 0, 1);
}

// The owner's habits slowly shift what the pet enjoys.
export function noteHabit(pet, habit) {
  const habits = pet.memory.habits;
  habits[habit] = (habits[habit] ?? 0) + 1;
  const t = pet.traits;
  if (habit === 'fetch') t.playful = clamp(t.playful + 0.002, 0, 1);
  if (habit === 'petting') t.cuddly = clamp(t.cuddly + 0.0015, 0, 1);
  if (habit === 'walks') t.energy = clamp(t.energy + 0.003, 0, 1);
}

export function favouriteActivity(pet) {
  const h = pet.memory.habits;
  const options = [['fetch', 'playing catch'], ['petting', 'being petted'], ['walks', 'going for walks']];
  const [id, label] = options.reduce((best, o) => ((h[o[0]] ?? 0) > (h[best[0]] ?? 0) ? o : best));
  return (h[id] ?? 0) >= 5 ? { id, label } : null;
}

export function bondMilestone(pet, now = Date.now()) {
  const steps = [[15, 'is warming up to you'], [35, 'thinks of you as a friend'], [60, 'is your best friend'], [85, 'goes everywhere you go']];
  for (const [level, text] of steps) {
    if (pet.bond >= level) {
      const note = milestone(pet, `bond:${level}`, `${pet.name} ${text}.`, now);
      if (note) return note;
    }
  }
  return null;
}
