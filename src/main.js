// Wires the page together: the pet creator, the room, the buttons and the
// side panel. Saves the pet in this browser.

import {
  COAT_COLORS, EYE_COLORS, COLLAR_COLORS, PATTERNS, SIZES, TRAITS, NEEDS,
  createPet, defaultLook, defaultTraits, catchUp, serialize, deserialize,
  bondLabel, ageLabel, portionGrams,
} from './pet.js';
import { TRICKS, WORDS, expects, formatHour, favouriteActivity } from './learning.js';
import { World, VIEW_W, VIEW_H, GROUND, petScale } from './world.js';
import { render } from './renderer.js';

const SAVE_KEY = 'ai-pet/v1';
const speed = Number(new URLSearchParams(location.search).get('speed')) || 1;

const $ = (id) => document.getElementById(id);

const storage = {
  load() {
    try { return deserialize(localStorage.getItem(SAVE_KEY)); } catch { return null; }
  },
  save(pet) {
    try { localStorage.setItem(SAVE_KEY, serialize(pet)); } catch { /* storage unavailable */ }
  },
  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
  },
};

let world = null; // the live game
let preview = null; // the creator preview
let draft = null; // pet being created or edited
let editing = false;

// --- Canvas sizing ---

function fitCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  if (!w) return null;
  const pw = Math.round(w * dpr);
  const ph = Math.round((w * VIEW_H / VIEW_W) * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(pw / VIEW_W, 0, 0, ph / VIEW_H, 0, 0);
  return ctx;
}

function toView(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * VIEW_W, y: ((e.clientY - r.top) / r.height) * VIEW_H };
}

// --- Creator ---

function pressed(container, value) {
  for (const b of container.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === value));
}

function buildSegmented(container, options, value, onPick) {
  container.replaceChildren(...options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = o.id;
    b.textContent = o.name;
    return b;
  }));
  pressed(container, value);
  container.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pressed(container, b.dataset.value);
    onPick(b.dataset.value);
  };
}

function buildSwatches(container, colors, value, onPick) {
  container.replaceChildren(...colors.map((c) => {
    const hex = typeof c === 'string' ? c : c.hex;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.value = hex;
    b.style.background = hex;
    b.setAttribute('aria-label', typeof c === 'string' ? 'Collar colour' : c.name);
    b.title = typeof c === 'string' ? '' : c.name;
    return b;
  }));
  pressed(container, value);
  container.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pressed(container, b.dataset.value);
    onPick(b.dataset.value);
  };
}

function renderCreator() {
  const d = draft;
  $('pet-name').value = d.name;
  pressed($('species'), d.species);
  $('ears-field').hidden = d.species === 'cat';
  buildSegmented($('size'), SIZES, d.look.size, (v) => { d.look.size = v; updatePreview(); });
  pressed($('ears'), d.look.ears);
  buildSwatches($('coat'), COAT_COLORS, d.look.coat, (v) => { d.look.coat = v; updatePreview(); });
  buildSegmented($('pattern'), PATTERNS[d.species], d.look.pattern, (v) => { d.look.pattern = v; updatePreview(); });
  buildSwatches($('marking'), COAT_COLORS, d.look.marking, (v) => { d.look.marking = v; updatePreview(); });
  buildSwatches($('eyes'), EYE_COLORS, d.look.eyes, (v) => { d.look.eyes = v; updatePreview(); });
  buildSwatches($('collar'), COLLAR_COLORS, d.look.collar, (v) => { d.look.collar = v; updatePreview(); });

  $('traits').replaceChildren(...TRAITS.map((t) => {
    const wrap = document.createElement('div');
    wrap.className = 'trait';
    const id = `trait-${t.id}`;
    wrap.innerHTML = `<div class="trait-ends"><label for="${id}">${t.low}</label><span>${t.high}</span></div>`;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = '0';
    input.max = '100';
    input.value = String(Math.round(d.traits[t.id] * 100));
    input.oninput = () => { d.traits[t.id] = Number(input.value) / 100; updatePreview(); };
    wrap.append(input);
    return wrap;
  }));
  updatePreview();
}

function updatePreview() {
  const d = draft;
  const name = d.name.trim() || (d.species === 'cat' ? 'Miso' : 'Mochi');
  $('adopt').textContent = editing ? 'Save changes' : `Bring ${name} home`;
  $('creator-title').textContent = editing ? `Edit ${name}` : 'Meet your new pet';
  const t = d.traits;
  const words = [
    t.energy > 0.66 ? 'full of beans' : t.energy < 0.33 ? 'happy to nap all day' : 'easy-going',
    t.cuddly > 0.66 ? 'loves a cuddle' : t.cuddly < 0.33 ? 'likes their space' : 'friendly',
    t.stubborn > 0.66 ? 'does things their own way' : t.stubborn < 0.33 ? 'eager to learn' : 'willing to learn with patience',
  ];
  $('preview-note').textContent = `${name} is ${words[0]}, ${words[1]}, and ${words[2]}.`;
  if (!preview || preview.pet.species !== d.species) {
    preview = new World(createPet(d), { rng: Math.random });
    preview.body.x = 400;
  }
  Object.assign(preview.pet.look, d.look);
  Object.assign(preview.pet.traits, d.traits);
  preview.scale = petScale(preview.pet);
}

function openCreator(pet = null) {
  editing = Boolean(pet);
  draft = pet
    ? { name: pet.name, species: pet.species, look: { ...pet.look }, traits: { ...pet.traits } }
    : { name: '', species: 'dog', look: defaultLook('dog'), traits: defaultTraits('dog') };
  preview = null;
  $('species').closest('fieldset').hidden = editing;
  $('cancel-edit').hidden = !editing;
  $('creator').hidden = false;
  $('home').hidden = true;
  window.scrollTo(0, 0);
  renderCreator();
}

$('pet-name').addEventListener('input', (e) => { draft.name = e.target.value; updatePreview(); });
$('species').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.dataset.value === draft.species) return;
  draft.species = b.dataset.value;
  draft.look = defaultLook(draft.species);
  draft.traits = defaultTraits(draft.species);
  renderCreator();
});
$('ears').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  draft.look.ears = b.dataset.value;
  pressed($('ears'), b.dataset.value);
  updatePreview();
});
$('cancel-edit').addEventListener('click', () => showHome());

$('creator-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (editing && world) {
    const pet = world.pet;
    pet.name = draft.name.trim() || pet.name;
    Object.assign(pet.look, draft.look);
    Object.assign(pet.traits, draft.traits);
    world.scale = petScale(pet);
    storage.save(pet);
    showHome();
    return;
  }
  const pet = createPet(draft);
  storage.save(pet);
  startGame(pet, null);
  toast(`${pet.name} is home! Have a look around together.`);
});

// --- Game ---

function startGame(pet, away) {
  world = new World(pet, {
    onNote: (text) => toast(text, 'note'),
    onToast: (text) => toast(text),
  });
  world.body.x = 300;
  if (away) {
    world.greet();
    toast(away.text);
  }
  showHome();
}

function showHome() {
  $('creator').hidden = true;
  $('home').hidden = false;
  preview = null;
  window.scrollTo(0, 0);
  renderPanel();
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  const box = $('toasts');
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), kind === 'note' ? 6000 : 3800);
}

// Pointer: hold on the pet to pet it, tap the ball to pick it up, tap the floor to throw.
const scene = $('scene');
scene.addEventListener('pointerdown', (e) => {
  if (!world) return;
  const p = toView(scene, e);
  if (world.petHit(p.x, p.y)) {
    scene.setPointerCapture(e.pointerId);
    scene.classList.add('petting');
    world.startPetting();
  } else if (world.ballHit(p.x, p.y)) {
    world.pickUpBall();
    toast('Got the ball. Tap the floor to throw it.');
  } else if (world.scene === 'home' && p.y > GROUND - 110) {
    world.throwBall(p.x);
  }
});
const endPet = () => {
  scene.classList.remove('petting');
  world?.stopPetting();
};
scene.addEventListener('pointerup', endPet);
scene.addEventListener('pointercancel', endPet);
scene.addEventListener('lostpointercapture', endPet);

const actions = {
  feed: () => world.feed(),
  treat: () => world.giveTreat(),
  ball: () => world.throwBall(),
  walk: () => {
    if (world.scene === 'park') {
      const r = world.endWalk();
      if (r) toast(`Home again. You walked ${r.meters} m in ${r.minutes} min.`);
    } else world.startWalk();
  },
  call: () => world.say(world.pet.name),
};
for (const [name, fn] of Object.entries(actions)) {
  $(`act-${name}`).addEventListener('click', () => { if (world) { fn(); renderPanel(); } });
}

document.addEventListener('keydown', (e) => {
  if (!world || $('home').hidden || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const map = { f: 'feed', t: 'treat', b: 'ball', w: 'walk', c: 'call' };
  const action = map[e.key.toLowerCase()];
  if (action) { actions[action](); renderPanel(); }
});

$('talk').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('talk-input');
  const text = input.value.trim();
  if (!text || !world) return;
  world.say(text);
  input.value = '';
  renderPanel();
});

// Speech input where the browser supports it.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  const mic = $('mic');
  mic.hidden = false;
  let rec = null;
  mic.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    mic.setAttribute('aria-pressed', 'true');
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      $('talk-input').value = text;
      world?.say(text);
      renderPanel();
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        toast('Microphone access is blocked here. Type instead.');
        mic.hidden = true;
      }
    };
    rec.onend = () => { rec = null; mic.setAttribute('aria-pressed', 'false'); };
    try { rec.start(); } catch { rec = null; mic.hidden = true; }
  });
}

// --- Side panel ---

function bar(color, value) {
  return `<div class="bar"><i style="width:${Math.round(value)}%;background:var(--${color})"></i></div>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function renderPanel() {
  if (!world) return;
  const pet = world.pet;
  const m = world.mood();
  $('pet-name-label').textContent = pet.name;
  $('mood').textContent = m.label;
  $('mood').dataset.mood = m.id;
  $('pet-meta').textContent = `${pet.species === 'cat' ? 'Cat' : 'Dog'} · ${ageLabel(pet)}`;
  $('bond-label').textContent = bondLabel(pet.bond);
  $('bond-bar').style.width = `${Math.max(2, pet.bond)}%`;
  $('call-label').textContent = `Call ${pet.name}`;
  $('walk-label').textContent = world.scene === 'park' ? 'Head home' : 'Go for a walk';
  $('act-feed').disabled = world.scene !== 'home';
  $('act-ball').disabled = world.scene !== 'home' || world.ball.state === 'mouth';

  $('needs').innerHTML = NEEDS.map((n) => {
    const v = pet.needs[n.id];
    return `<div class="need" data-low="${v < 25}"><div class="need-row"><span>${n.name}</span><span>${Math.round(v)}</span></div>${bar(n.id, v)}</div>`;
  }).join('');
  const portion = portionGrams(pet);
  $('bowl').textContent = pet.bowlGrams > 0
    ? `Bowl: ${Math.round(pet.bowlGrams)} g of food (a meal is ${portion} g).`
    : `Bowl: empty. A meal is ${portion} g.`;

  $('tricks').innerHTML = Object.entries(TRICKS).map(([id, t]) => {
    const v = pet.memory.tricks[id] * 100;
    const state = v >= 65 ? 'Knows it' : v >= 30 ? 'Learning' : v > 6 ? 'Getting the idea' : 'Not yet';
    return `<li class="skill"><div class="need-row"><span>${t.label}</span><span>${state}</span></div>${bar('fun', Math.max(2, v))}</li>`;
  }).join('');

  $('words').innerHTML = Object.entries(WORDS).map(([id, w]) => {
    const known = pet.memory.words[id] >= 0.5;
    const label = id === 'name' ? `“${escapeHtml(pet.name)}”` : w.label;
    return `<li class="word" data-known="${known}" title="${known ? 'Recognises this' : 'Still learning'}">${label}</li>`;
  }).join('');

  const facts = [];
  const now = new Date();
  for (const [kind, what] of [['feed', 'food'], ['walk', 'a walk']]) {
    const bins = pet.memory.routine[kind];
    const best = bins.indexOf(Math.max(...bins));
    if (bins[best] >= 2.5) facts.push(`Expects ${what} around ${formatHour(best)}.`);
  }
  if (expects(pet, 'feed', now) > 0.5 && pet.bowlGrams === 0) facts.push(`Thinks it's about time to eat.`);
  const fav = favouriteActivity(pet);
  if (fav) facts.push(`Favourite thing: ${fav.label}.`);
  $('facts').innerHTML = facts.map((f) => `<li>${escapeHtml(f)}</li>`).join('');

  const journal = pet.memory.journal;
  $('journal').innerHTML = journal.length
    ? journal.slice(0, 30).map((j) => {
      const d = new Date(j.t);
      const when = d.toDateString() === now.toDateString()
        ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `<li><time>${when}</time><span>${escapeHtml(j.text)}</span></li>`;
    }).join('')
    : `<li class="journal-empty">Milestones show up here as ${escapeHtml(pet.name)} learns and grows closer to you.</li>`;

  const s = pet.memory.stats;
  const km = s.walkMeters >= 1000 ? `${(s.walkMeters / 1000).toFixed(1)} km` : `${s.walkMeters} m`;
  $('stats').innerHTML = [
    ['Meals', s.meals], ['Food eaten', `${(s.grams / 1000).toFixed(1)} kg`],
    ['Balls fetched', s.fetches], ['Walked', `${km} · ${s.walks} walks`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

$('edit-pet').addEventListener('click', () => openCreator(world.pet));
$('reset').addEventListener('click', () => {
  $('reset-text').textContent = `This says goodbye to ${world.pet.name} and everything they've learned. It can't be undone.`;
  $('reset-confirm').hidden = false;
});
$('reset-no').addEventListener('click', () => { $('reset-confirm').hidden = true; });
$('reset-yes').addEventListener('click', () => {
  storage.clear();
  world = null;
  $('reset-confirm').hidden = true;
  openCreator();
});

// --- Main loop ---

let last = performance.now();
let panelTimer = 0;
let saveTimer = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const date = new Date();
  $('clock').textContent = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (!$('creator').hidden && preview) {
    preview.update(dt);
    const ctx = fitCanvas($('preview'));
    if (ctx) render(ctx, preview, { date });
  } else if (world) {
    // Large speeds are for testing; step in small slices so behaviour stays stable.
    let left = dt * speed;
    while (left > 0) {
      const step = Math.min(left, 0.1);
      world.update(step);
      left -= step;
    }
    const ctx = fitCanvas(scene);
    if (ctx) render(ctx, world, { date });
    $('status').textContent = world.status();
    panelTimer += dt;
    saveTimer += dt;
    if (panelTimer > 0.4) { panelTimer = 0; renderPanel(); }
    if (saveTimer > 5) { saveTimer = 0; world.pet.lastSeen = Date.now(); storage.save(world.pet); }
  }
  requestAnimationFrame(frame);
}

function saveNow() {
  if (!world) return;
  world.pet.lastSeen = Date.now();
  storage.save(world.pet);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saveNow();
  else if (world) {
    const away = catchUp(world.pet);
    if (away) { toast(away.text); world.greet(); }
  }
});
window.addEventListener('pagehide', saveNow);

// --- Boot ---

const saved = storage.load();
if (saved) startGame(saved, catchUp(saved));
else openCreator();
requestAnimationFrame(frame);
