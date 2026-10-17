// Wires the page together: the pet creator, the scene and its hands-on
// controls, places, voice, and the side panel. Saves in this browser.

import {
  COAT_COLORS, EYE_COLORS, COLLAR_COLORS, PATTERNS, SIZES, TRAITS, NEEDS,
  createPet, defaultLook, defaultTraits, catchUp, serialize, deserialize,
  ageLabel, portionGrams,
} from './pet.js';
import { TRICKS, WORDS, expects, formatHour, favouriteActivity, canLearn } from './learning.js';
import { level, HEART_SOURCES, DAILY_CAP, heartsToday, unlocked, unlockLevel, today } from './bond.js';
import { FINDS, drawFind } from './finds.js';
import { World, VIEW_W, VIEW_H, UNITS_PER_METER, petScale } from './world.js';
import { render } from './renderer.js';
import { SKIN_TONES, HAIR_COLORS, HAIR_STYLES, TOP_COLORS, BOTTOM_COLORS, defaultOwner } from './owner.js';
import { Voice, VOICE_SLOTS } from './sound.js';
import { MediaStore, photoToBlob, blobToImage } from './media-store.js';

const SAVE_KEY = 'ai-pet/v1';
const PREFS_KEY = 'ai-pet/prefs';
const speed = Number(new URLSearchParams(location.search).get('speed')) || 1;

// The 3D view loads on demand; the 2D view is the fallback.
let three = null; // the scene3d module, once loaded and if WebGL works
let scene3d = null;
let preview3d = null;
const threeReady = import('./scene3d.js').then((m) => { three = m.supports3D() ? m : null; }).catch(() => { three = null; });
const DOG_BREEDS = [{ id: 'shiba', name: 'Shiba Inu' }, { id: 'husky', name: 'Husky' }];
const BREED_COLORS = { shiba: ['#d49a50', '#f5f2ec'], husky: ['#5b6068', '#f5f2ec'] };

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

const prefs = (() => {
  let data = {};
  try { data = JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {}; } catch { /* storage unavailable */ }
  return {
    get: (k, d) => data[k] ?? d,
    set: (k, v) => { data[k] = v; try { localStorage.setItem(PREFS_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ } },
  };
})();

const media = new MediaStore();
const voice = new Voice();
voice.muted = prefs.get('muted', false);

let world = null; // the live game
let preview = null; // the creator preview
let draft = null; // pet being created or edited
let editing = false;
let places = []; // { id, name, blob, image }
let treatImage = null; // the owner's own treat picture, if any

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

// Pointer position in world units (the walk camera scrolls the view).
function use3D() { return Boolean(three) && prefs.get('view', '3d') === '3d'; }

// Show the WebGL canvas under the 2D one, or hide it.
function setStack(gl, on) {
  gl.hidden = !on;
  gl.parentElement.classList.toggle('three', on);
}

function ensure3D() {
  if (!three) return;
  scene3d ??= new three.Scene3D($('scene3d'));
  preview3d ??= new three.Scene3D($('preview3d'));
}

function toWorld(canvas, e, w) {
  if (use3D() && scene3d && canvas === scene) return scene3d.pick(e.clientX, e.clientY);
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * VIEW_W + (w?.cam ?? 0),
    y: ((e.clientY - r.top) / r.height) * VIEW_H,
  };
}

function backdrops(w) {
  const find = (id) => places.find((p) => p.id === id)?.image ?? null;
  return {
    home: w.pet.home && w.pet.home !== 'room' ? find(w.pet.home) : null,
    walk: w.walk?.place.kind === 'photo' ? find(w.walk.place.id) : null,
  };
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

function buildSwatches(container, colors, value, label, onPick) {
  container.replaceChildren(...colors.map((c, i) => {
    const hex = typeof c === 'string' ? c : c.hex;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.value = hex;
    b.style.background = hex;
    b.setAttribute('aria-label', typeof c === 'string' ? `${label} ${i + 1}` : c.name);
    if (typeof c !== 'string') b.title = c.name;
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
  const look = (key) => (v) => { d.look[key] = v; updatePreview(); };
  const you = (key) => (v) => { d.owner[key] = v; updatePreview(); };
  $('pet-name').value = d.name;
  pressed($('species'), d.species);
  const solid = use3D();
  $('ears-field').hidden = d.species === 'cat' || solid;
  $('breed-field').hidden = d.species === 'cat' || !solid;
  $('pattern').hidden = solid;
  buildSegmented($('breed'), DOG_BREEDS, d.look.breed ?? 'shiba', (v) => {
    d.look.breed = v;
    [d.look.coat, d.look.marking] = BREED_COLORS[v];
    renderCreator();
  });
  buildSegmented($('size'), SIZES, d.look.size, look('size'));
  pressed($('ears'), d.look.ears);
  buildSwatches($('coat'), COAT_COLORS, d.look.coat, 'Coat', look('coat'));
  buildSegmented($('pattern'), PATTERNS[d.species], d.look.pattern, look('pattern'));
  buildSwatches($('marking'), COAT_COLORS, d.look.marking, 'Markings', look('marking'));
  buildSwatches($('eyes'), EYE_COLORS, d.look.eyes, 'Eyes', look('eyes'));
  buildSwatches($('collar'), COLLAR_COLORS, d.look.collar, 'Collar colour', look('collar'));

  buildSegmented($('hair'), HAIR_STYLES, d.owner.hair, you('hair'));
  buildSwatches($('hair-color'), HAIR_COLORS, d.owner.hairColor, 'Hair', you('hairColor'));
  buildSwatches($('skin'), SKIN_TONES, d.owner.skin, 'Skin tone', you('skin'));
  buildSwatches($('top'), TOP_COLORS, d.owner.top, 'Top colour', you('top'));
  buildSwatches($('bottom'), BOTTOM_COLORS, d.owner.bottom, 'Trousers colour', you('bottom'));

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
  }
  Object.assign(preview.pet.look, d.look);
  Object.assign(preview.pet.traits, d.traits);
  Object.assign(preview.pet.owner, d.owner);
  preview.scale = petScale(preview.pet);
  if (use3D()) { ensure3D(); preview3d.setPet(preview.pet); }
}

function openCreator(pet = null) {
  editing = Boolean(pet);
  draft = pet
    ? { name: pet.name, species: pet.species, look: { ...pet.look }, traits: { ...pet.traits }, owner: { ...pet.owner } }
    : { name: '', species: 'dog', look: defaultLook('dog'), traits: defaultTraits('dog'), owner: defaultOwner() };
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
  voice.unlock();
  if (editing && world) {
    const pet = world.pet;
    pet.name = draft.name.trim() || pet.name;
    Object.assign(pet.look, draft.look);
    Object.assign(pet.traits, draft.traits);
    Object.assign(pet.owner, draft.owner);
    world.scale = petScale(pet);
    voice.setPet(pet);
    scene3d?.setPet(pet);
    storage.save(pet);
    showHome();
    return;
  }
  const pet = createPet(draft);
  storage.save(pet);
  startGame(pet, null);
  toast(`${pet.name} is home! Drag a scoop from the food bag to the bowl, or grab the ball and fling it.`);
});

// --- Game ---

function startGame(pet, away) {
  world = new World(pet, {
    onNote: (text) => toast(text, 'note'),
    onToast: (text) => toast(text),
    onSound: (kind) => voice.play(kind),
  });
  voice.setPet(pet);
  loadVoices();
  if (use3D()) { ensure3D(); scene3d.setPet(pet); }
  if (away) {
    world.greet();
    toast(away.text);
  } else world.maybeGift();
  showHome();
}

function showHome() {
  $('creator').hidden = true;
  $('home').hidden = false;
  preview = null;
  window.scrollTo(0, 0);
  renderPanel();
  renderPlaces();
  renderVoices();
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  const box = $('toasts');
  box.append(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), kind === 'note' ? 6000 : 4200);
}

// --- Hands-on controls ---
// Press the food bag for a scoop, the jar for a treat, the ball to pick it up;
// press and hold the pet to stroke it; tap the floor to walk there. On walks,
// hold on either side of the owner to walk that way.

const scene = $('scene');
const pointer = { mode: null, samples: [] };

function trackVelocity(p) {
  const now = performance.now();
  pointer.samples.push({ t: now, x: p.x, y: p.y });
  while (pointer.samples.length > 2 && now - pointer.samples[0].t > 90) pointer.samples.shift();
}

function releaseVelocity() {
  const s = pointer.samples;
  if (s.length < 2) return { vx: 0, vy: 0 };
  const a = s[0];
  const b = s[s.length - 1];
  const dt = Math.max(0.016, (b.t - a.t) / 1000);
  return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
}

const CURSORS = { pet: 'grab', ball: 'grab', bag: 'grab', jar: 'grab', owner: 'pointer', floor: 'pointer', ground: 'pointer', wall: 'default' };

scene.addEventListener('pointerdown', (e) => {
  if (!world) return;
  voice.unlock();
  const p = toWorld(scene, e, world);
  let hit = world.hitTest(p.x, p.y);
  // In 3D, touching the models themselves counts, wherever they are drawn.
  if (p.onPet && !['bag', 'jar', 'ball'].includes(hit)) hit = 'pet';
  else if (p.onOwner && world.scene === 'home' && hit !== 'pet') hit = 'owner';
  scene.setPointerCapture(e.pointerId);
  pointer.samples = [];
  trackVelocity(p);
  if (hit === 'pet') {
    pointer.mode = 'pet';
    world.startPetting(p.x, p.y);
  } else if (hit === 'ball' && world.grab('ball', p.x, p.y)) {
    pointer.mode = 'drag';
  } else if (hit === 'bag' && world.grab('scoop', p.x, p.y)) {
    pointer.mode = 'drag';
  } else if (hit === 'jar' && world.grab('treat', p.x, p.y)) {
    pointer.mode = 'drag';
  } else if (hit === 'owner') {
    pointer.mode = null;
    editYou();
    return;
  } else if (world.scene === 'park') {
    pointer.mode = 'walk';
    world.setWalkInput(p.x >= world.owner.x ? 1 : -1);
  } else if (hit === 'floor') {
    pointer.mode = null;
    world.walkOwnerTo(p.x);
  }
  scene.classList.toggle('grabbing', pointer.mode === 'drag' || pointer.mode === 'pet');
});

scene.addEventListener('pointermove', (e) => {
  if (!world) return;
  const p = toWorld(scene, e, world);
  if (pointer.mode === 'drag') { trackVelocity(p); world.dragTo(p.x, p.y); }
  else if (pointer.mode === 'pet') world.strokeTo(p.x, p.y);
  else if (pointer.mode === 'walk') world.setWalkInput(p.x >= world.owner.x ? 1 : -1);
  else scene.style.cursor = p.onPet ? 'grab' : CURSORS[world.hitTest(p.x, p.y)] ?? 'default';
});

function endPointer() {
  if (!world) return;
  if (pointer.mode === 'drag') {
    const v = releaseVelocity();
    world.release(v.vx, v.vy);
  } else if (pointer.mode === 'pet') world.stopPetting();
  else if (pointer.mode === 'walk') world.setWalkInput(0);
  pointer.mode = null;
  scene.classList.remove('grabbing');
}
scene.addEventListener('pointerup', endPointer);
scene.addEventListener('pointercancel', endPointer);
scene.addEventListener('lostpointercapture', endPointer);

// Hold-to-walk buttons, for touch screens and keyboards.
for (const [id, dir] of [['walk-back', -1], ['walk-on', 1]]) {
  const b = $(id);
  const stop = () => world?.setWalkInput(0);
  b.addEventListener('pointerdown', () => world?.setWalkInput(dir));
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointerleave', stop);
  b.addEventListener('pointercancel', stop);
  b.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') world?.setWalkInput(dir); });
  b.addEventListener('keyup', stop);
}

function walkHome() {
  const r = world.endWalk();
  if (r) toast(`Home again. You walked ${r.meters} m in ${r.minutes} min.`);
  renderPanel();
}

$('act-walk').addEventListener('click', () => {
  voice.unlock();
  renderPicker();
  $('place-picker').hidden = false;
});
$('picker-close').addEventListener('click', () => { $('place-picker').hidden = true; });
$('walk-home').addEventListener('click', walkHome);
$('act-call').addEventListener('click', () => { voice.unlock(); world?.say(world.pet.name); });
$('act-view').addEventListener('click', () => {
  prefs.set('view', use3D() ? '2d' : '3d');
  if (use3D()) { ensure3D(); scene3d.setPet(world.pet); }
  renderPanel();
});

$('act-sound').addEventListener('click', () => {
  voice.unlock();
  voice.muted = !voice.muted;
  prefs.set('muted', voice.muted);
  renderSoundButton();
});

function renderViewButton() {
  const b = $('act-view');
  b.hidden = !three;
  b.textContent = use3D() ? '2D view' : '3D view';
}

function renderSoundButton() {
  $('act-sound').setAttribute('aria-pressed', String(!voice.muted));
  $('act-sound').textContent = voice.muted ? 'Sound off' : 'Sound on';
}

function startWalkAt(place) {
  $('place-picker').hidden = true;
  world.startWalk(place);
  renderPanel();
}

// Keyboard: arrows walk on walks; F, T and B are shortcuts at home.
const held = new Set();
document.addEventListener('keydown', (e) => {
  if (!world || $('home').hidden || e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.target.closest('button') && (k === ' ' || k === 'enter')) return;
  if (world.scene === 'park' && ['arrowleft', 'arrowright', 'a', 'd'].includes(k)) {
    held.add(k);
    world.setWalkInput(k === 'arrowleft' || k === 'a' ? -1 : 1);
    e.preventDefault();
    return;
  }
  voice.unlock();
  if (k === 'f') world.feed();
  else if (k === 't') world.giveTreat();
  else if (k === 'b') world.throwBall();
  else if (k === 'w') { if (world.scene === 'park') walkHome(); else startWalkAt({ id: 'park', kind: 'park' }); }
  else if (k === 'c') world.say(world.pet.name);
  else return;
  renderPanel();
});
document.addEventListener('keyup', (e) => {
  held.delete(e.key.toLowerCase());
  if (world && held.size === 0) world.setWalkInput(0);
});

$('talk').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('talk-input');
  const text = input.value.trim();
  if (!text || !world) return;
  voice.unlock();
  world.say(text);
  input.value = '';
  renderPanel();
});

// Talking out loud: keeps listening until switched off, so calling the
// pet's name across the room works like it would at home.
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
  const mic = $('mic');
  mic.hidden = false;
  let rec = null;
  let listening = false;
  const stopListening = () => {
    listening = false;
    rec?.stop();
    mic.setAttribute('aria-pressed', 'false');
    mic.textContent = 'Talk out loud';
  };
  const listen = () => {
    rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev) => {
      const r = ev.results[ev.results.length - 1];
      if (!r.isFinal) return;
      const text = r[0].transcript.trim();
      if (text && world) { world.say(text); renderPanel(); }
    };
    rec.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed' || ev.error === 'audio-capture') {
        toast('The microphone is blocked here, so type instead.');
        stopListening();
        mic.hidden = true;
      }
    };
    rec.onend = () => { if (listening) { try { rec.start(); } catch { stopListening(); } } };
    try { rec.start(); } catch { stopListening(); mic.hidden = true; }
  };
  mic.addEventListener('click', () => {
    voice.unlock();
    if (listening) { stopListening(); return; }
    listening = true;
    mic.setAttribute('aria-pressed', 'true');
    mic.textContent = 'Listening… tap to stop';
    listen();
  });
}

// --- Places ---

async function loadPlaces() {
  const rows = await media.all('places');
  places = await Promise.all(rows.map(async (r) => ({ ...r, image: await blobToImage(r.blob).catch(() => null) })));
  places.sort((a, b) => a.added - b.added);
  if (!$('home').hidden) { renderPlaces(); renderPicker(); }
}

function placeThumb(p) {
  if (p.image) return `<img src="${p.image.src}" alt="">`;
  return `<span class="thumb-art ${p.id}"></span>`;
}

function renderPicker() {
  const list = [{ id: 'park', kind: 'park', name: 'The park' }, ...places.map((p) => ({ ...p, kind: 'photo' }))];
  const ul = $('picker-places');
  ul.replaceChildren(...list.map((p) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'place-tile';
    b.innerHTML = `${placeThumb(p)}<span>${escapeHtml(p.name)}</span>`;
    b.onclick = () => startWalkAt({ id: p.id, kind: p.kind, name: p.name });
    li.append(b);
    return li;
  }));
  const add = document.createElement('li');
  add.innerHTML = `<label class="place-tile add"><input type="file" accept="image/*" class="sr-only"><span class="thumb-art plus" aria-hidden="true">+</span><span>Your own photo</span></label>`;
  add.querySelector('input').addEventListener('change', async (e) => {
    const place = await addPlace(e.target.files[0]);
    if (place) startWalkAt({ id: place.id, kind: 'photo', name: place.name });
  });
  ul.append(add);
}

async function addPlace(file) {
  if (!file) return null;
  try {
    const blob = await photoToBlob(file);
    const name = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 28) || 'My place';
    const record = { id: `p${Date.now().toString(36)}`, name, blob, added: Date.now() };
    await media.put('places', record);
    const place = { ...record, image: await blobToImage(blob) };
    places.push(place);
    renderPlaces();
    renderPicker();
    toast(media.persistent ? `Added “${name}”.` : `Added “${name}” for this visit. This browser won't keep photos after you close the page.`);
    return place;
  } catch (err) {
    toast(err.message || 'That photo could not be added.');
    return null;
  }
}

$('place-file').addEventListener('change', async (e) => {
  await addPlace(e.target.files[0]);
  e.target.value = '';
});

function renderPlaces() {
  if (!world) return;
  for (const el of document.querySelectorAll('.pet-name')) el.textContent = world.pet.name;
  const ul = $('places');
  const rows = [{ id: 'room', name: 'Living room', builtIn: true }, { id: 'park', name: 'The park', builtIn: true, walkOnly: true }, ...places];
  ul.replaceChildren(...rows.map((p) => {
    const li = document.createElement('li');
    li.className = 'place-row';
    const isHome = world.pet.home === p.id || (p.id === 'room' && !world.pet.home);
    li.innerHTML = `${placeThumb(p)}<div class="place-info"><input class="place-name" value="${escapeHtml(p.name)}" ${p.builtIn ? 'disabled' : ''} aria-label="Place name"><span class="meta">${isHome ? 'Home' : p.walkOnly ? 'For walks' : ''}</span></div><div class="place-actions"></div>`;
    const actions = li.querySelector('.place-actions');
    const btn = (label, fn, cls = 'ghost') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `small ${cls}`;
      b.textContent = label;
      b.onclick = fn;
      actions.append(b);
    };
    if (p.id !== 'room') btn('Walk here', () => startWalkAt({ id: p.id, kind: p.builtIn ? 'park' : 'photo', name: p.name }));
    if (!p.walkOnly && !isHome) btn('Make home', () => { world.pet.home = p.id; storage.save(world.pet); renderPlaces(); });
    if (!p.builtIn) {
      btn('Remove', async () => {
        await media.remove('places', p.id);
        places = places.filter((x) => x.id !== p.id);
        if (world.pet.home === p.id) world.pet.home = 'room';
        if (world.walk?.place.id === p.id) walkHome();
        renderPlaces();
      }, 'ghost danger');
      li.querySelector('.place-name').addEventListener('change', async (e) => {
        p.name = e.target.value.trim() || p.name;
        await media.put('places', { id: p.id, name: p.name, blob: p.blob, added: p.added });
      });
    }
    return li;
  }));
}

// --- Voice ---

async function loadVoices() {
  const rows = await media.all('voices');
  for (const r of rows) {
    const [species, kind] = r.id.split(':');
    if (species !== world?.pet.species) continue;
    try { await voice.setClip(kind, await r.blob.arrayBuffer()); } catch { /* skip unplayable clip */ }
  }
  renderVoices();
}

const canRecord = Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
let recording = null;

async function saveClip(kind, blob) {
  try {
    voice.unlock();
    await voice.setClip(kind, await blob.arrayBuffer());
    await media.put('voices', { id: `${world.pet.species}:${kind}`, blob });
    renderVoices();
    voice.play(kind);
  } catch (err) {
    toast(err.message || 'That clip could not be used.');
  }
}

async function record(kind, button) {
  if (recording) { recording.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      recording = null;
      saveClip(kind, new Blob(chunks, { type: rec.mimeType }));
    };
    rec.start();
    recording = rec;
    button.textContent = 'Stop';
    button.setAttribute('aria-pressed', 'true');
    setTimeout(() => { if (recording === rec) rec.stop(); }, 4000);
  } catch {
    toast('The microphone is blocked here. Upload a sound file instead.');
  }
}

function renderVoices() {
  if (!world) return;
  const pet = world.pet;
  $('voice-title').textContent = `${pet.name}'s voice`;
  $('voice-help').textContent = canRecord
    ? `Record or upload your own sounds for ${pet.name}, like your real pet's bark. Clips up to a few seconds work best.`
    : `Upload your own sounds for ${pet.name}, like a clip of your real pet. Clips up to a few seconds work best.`;
  $('voices').replaceChildren(...VOICE_SLOTS[pet.species].map((slot) => {
    const li = document.createElement('li');
    li.className = 'voice-row';
    const custom = voice.hasClip(slot.kind);
    li.innerHTML = `<div><span>${slot.name}</span><span class="meta">${custom ? 'Your recording' : 'Built-in'}</span></div><div class="place-actions"></div>`;
    const actions = li.querySelector('.place-actions');
    const add = (label, fn, cls = 'ghost') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `small ${cls}`;
      b.textContent = label;
      b.onclick = () => fn(b);
      actions.append(b);
      return b;
    };
    add('Play', () => { voice.unlock(); voice.play(slot.kind); });
    if (canRecord) add('Record', (b) => record(slot.kind, b));
    const upload = document.createElement('label');
    upload.className = 'small ghost file-button';
    upload.innerHTML = '<input type="file" accept="audio/*" class="sr-only"><span>Upload</span>';
    upload.querySelector('input').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) saveClip(slot.kind, file);
    });
    actions.append(upload);
    if (custom) {
      add('Reset', async () => {
        await voice.setClip(slot.kind, null);
        await media.remove('voices', `${pet.species}:${slot.kind}`);
        renderVoices();
      }, 'ghost danger');
    }
    return li;
  }));
}

// --- Side panel ---

function bar(color, value) {
  return `<div class="bar"><i style="width:${Math.round(value)}%;background:var(--${color})"></i></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function contextHint() {
  const w = world;
  if (w.scene === 'park') return 'Hold on either side of you, or the arrow keys, to walk. Press and hold your pet to give them a fuss.';
  if (w.drag?.item === 'scoop') return 'Hold the scoop over the bowl to pour. Let go when it looks like enough.';
  if (w.drag?.item === 'treat') return 'Hold the treat up high to lure a sit, or down on the floor to lure lying down. Let go at their mouth to hand it over.';
  if (w.drag?.item === 'ball') return 'Fling it: move fast and let go.';
  if (w.ball.state === 'mouth') return `${w.pet.name} has the ball. Press it to take it back.`;
  return 'Press the food bag for a scoop, the jar for a treat, or the ball to pick it up. Press and hold your pet to stroke them. Tap the floor to walk over.';
}

function renderPanel() {
  if (!world) return;
  const pet = world.pet;
  const m = world.mood();
  $('pet-name-label').textContent = pet.name;
  $('mood').textContent = m.label;
  $('mood').dataset.mood = m.id;
  $('pet-meta').textContent = `${pet.species === 'cat' ? 'Cat' : 'Dog'} · ${ageLabel(pet)}`;
  const lv = level(pet);
  const total = Math.floor(pet.memory.hearts.total);
  $('bond-label').textContent = lv.name;
  $('bond-hearts').textContent = `${total} ♥`;
  $('bond-bar').style.width = `${Math.max(2, lv.progress * 100)}%`;
  $('bond-next').textContent = lv.next
    ? `${Math.ceil(lv.next.hearts - pet.memory.hearts.total)} more ♥ to ${lv.next.name}: ${pet.name} ${lv.next.unlock.text}.`
    : `${pet.name} couldn't be closer to you.`;

  const todayCount = heartsToday(pet);
  $('today-count').textContent = `${todayCount} / ${DAILY_CAP} ♥`;
  $('today').innerHTML = Object.entries(HEART_SOURCES).map(([id, src]) => {
    const got = pet.memory.hearts.day === today() ? pet.memory.hearts.today[id] ?? 0 : 0;
    const done = got >= src.cap || todayCount >= DAILY_CAP;
    const icons = '♥'.repeat(got) + '♡'.repeat(src.cap - got);
    return `<li data-done="${done}"><span>${src.label}</span><span class="hearts" aria-label="${got} of ${src.cap} hearts">${icons}</span><span class="meta">${done ? 'Done for today' : src.hint}</span></li>`;
  }).join('');

  const leash = $('walk-leash');
  const onWalk = world.scene === 'park';
  leash.hidden = !(onWalk && unlocked(pet, 'offLeash'));
  if (onWalk) {
    leash.setAttribute('aria-pressed', String(!world.walk.offLeash));
    leash.textContent = world.walk.offLeash ? 'Leash off' : 'Leash on';
  }
  renderFinds();
  $('act-call').textContent = `Call ${pet.name}`;
  const walking = world.scene === 'park';
  $('home-actions').hidden = walking;
  $('walk-actions').hidden = !walking;
  if (walking) {
    $('place-picker').hidden = true;
    $('walk-stat').textContent = `${Math.round(world.walk.distance / UNITS_PER_METER)} m · ${world.walk.place.name ?? 'The park'}`;
  }
  $('hint').textContent = contextHint();
  renderSoundButton();
  renderViewButton();

  $('needs').innerHTML = NEEDS.map((n) => {
    const v = pet.needs[n.id];
    return `<div class="need" data-low="${v < 25}"><div class="need-row"><span>${n.name}</span><span>${Math.round(v)}</span></div>${bar(n.id, v)}</div>`;
  }).join('');
  const portion = portionGrams(pet);
  $('bowl').textContent = pet.bowlGrams > 0
    ? `Bowl: ${Math.round(pet.bowlGrams)} g of food (a meal is about ${portion} g).`
    : `Bowl: empty. A meal is about ${portion} g.`;

  $('tricks').innerHTML = Object.entries(TRICKS).map(([id, t]) => {
    const v = pet.memory.tricks[id] * 100;
    const locked = !canLearn(pet, id);
    const state = locked ? `Unlocks at ${unlockLevel(t.unlock).name}`
      : v >= 65 ? 'Knows it' : v >= 30 ? 'Learning' : v > 6 ? 'Getting the idea' : 'Not yet';
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
    ['Balls fetched', s.fetches], ['Walked', `${km} · ${s.walks} ${s.walks === 1 ? 'walk' : 'walks'}`],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}

$('edit-pet').addEventListener('click', () => openCreator(world.pet));
$('edit-you').addEventListener('click', () => editYou());

// Open the editor straight at the owner's own look.
function editYou() {
  openCreator(world.pet);
  const you = document.querySelector('.field.you');
  you.scrollIntoView({ block: 'start' });
  you.querySelector('button')?.focus({ preventScroll: true });
}

$('walk-leash').addEventListener('click', () => {
  if (world?.setOffLeash(!world.walk.offLeash)) renderPanel();
});

// --- Finds ---

let findsKey = '';
function renderFinds() {
  const pet = world.pet;
  const c = pet.memory.finds;
  const key = JSON.stringify(c);
  if (key === findsKey) return;
  findsKey = key;
  const found = FINDS.filter((f) => c[f.id]).length;
  $('finds-count').textContent = `${found} of ${FINDS.length}`;
  $('finds').replaceChildren(...FINDS.map((f) => {
    const li = document.createElement('li');
    li.className = 'find';
    const have = c[f.id];
    li.dataset.found = String(Boolean(have));
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 80;
    const ctx = canvas.getContext('2d');
    drawFind(ctx, f.id, 40, 40, 2.6);
    li.append(canvas);
    const name = document.createElement('span');
    name.textContent = have ? f.name : '?';
    li.append(name);
    if (have) {
      const count = document.createElement('span');
      count.className = 'count';
      count.textContent = `×${have.count}`;
      li.title = `First found: ${have.place}, ${new Date(have.first).toLocaleDateString()}`;
      li.append(count);
    }
    return li;
  }));
}

// --- Custom treat picture ---

async function loadAssets() {
  const rows = await media.all('assets');
  const treat = rows.find((r) => r.id === 'treat');
  treatImage = treat ? await blobToImage(treat.blob).catch(() => null) : null;
  renderTreat();
}

function renderTreat() {
  $('treat-meta').textContent = treatImage ? 'Your own picture' : 'Bone biscuits';
  $('treat-reset').hidden = !treatImage;
}

$('treat-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const blob = await photoToBlob(file, 256, 256, 'image/png');
    await media.put('assets', { id: 'treat', blob });
    treatImage = await blobToImage(blob);
    renderTreat();
    toast('Treats now look like your picture. Take one from the jar to see it.');
  } catch (err) {
    toast(err.message || 'That picture could not be used.');
  }
});

$('treat-reset').addEventListener('click', async () => {
  await media.remove('assets', 'treat');
  treatImage = null;
  renderTreat();
});
$('reset').addEventListener('click', () => {
  $('reset-text').textContent = `This says goodbye to ${world.pet.name} and everything they've learned. Your photos and recordings stay. It can't be undone.`;
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

  const solid = use3D();
  if (solid) ensure3D();
  if (!$('creator').hidden && preview) {
    preview.update(dt);
    setStack($('preview3d'), solid);
    const ctx = fitCanvas($('preview'));
    if (solid) {
      preview3d.render(preview, { date, dt });
      if (ctx) preview3d.drawOverlay(ctx, preview);
    } else if (ctx) render(ctx, preview, { date });
  } else if (world) {
    // Large speeds are for testing; step in small slices so behaviour stays stable.
    let left = dt * speed;
    while (left > 0) {
      const step = Math.min(left, 0.05);
      world.update(step);
      left -= step;
    }
    const ctx = fitCanvas(scene);
    const opts = { date, dt: dt * speed, backdrops: backdrops(world), images: { treat: treatImage } };
    setStack($('scene3d'), solid);
    if (solid) {
      scene3d.render(world, opts);
      if (ctx) scene3d.drawOverlay(ctx, world);
    } else if (ctx) render(ctx, world, opts);
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
    if (away) { toast(away.text); if (world.scene === 'home') world.greet(); }
  }
});
window.addEventListener('pagehide', saveNow);

// --- Boot ---

// ?debug exposes the simulation for testing in the browser console.
if (new URLSearchParams(location.search).has('debug')) window.aiPet = { get world() { return world; }, get scene3d() { return scene3d; } };

// Wait for the 3D module so the first frame uses the right view.
threeReady.then(() => {
  const saved = storage.load();
  if (saved) startGame(saved, catchUp(saved));
  else openCreator();
});
loadPlaces();
loadAssets();
requestAnimationFrame(frame);
