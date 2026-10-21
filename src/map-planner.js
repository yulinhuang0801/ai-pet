// The map where you pick a real place to walk: search for it or click it, and
// your walk starts at the pin, with the map loading around you as you go
// (explore.js). Map pictures come from openstreetmap.org, place search from
// Nominatim and map data from the Overpass API, so this needs the app to be on
// a site that can reach them (not every preview can). Routes saved before
// walks started from a pin are still walked, and drawn in the places list.

import { overpassQuery, boxesQuery, buildWalk, routeLength } from './route.js';
import { decodeTile, tileElements, tilesFor } from './mvt.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SEARCH = 'https://nominatim.openstreetmap.org/search';
// The main Overpass server, then public mirrors to try when it's busy.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// fetch, giving up after `ms` milliseconds.
async function fetchWithin(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// --- Map data for walking from a pin ---

// OpenStreetMap as vector tiles, from OpenFreeMap's CDN: free, no key, and fast,
// because the tiles are made in advance. Zoom 14 tiles hold every building,
// road and path; one covers about 2 km.
const VECTOR = 'https://tiles.openfreemap.org/planet';
const Z = 14;
let tileTemplate = null;
const vectorTiles = new Map(); // "x/y" -> Promise of elements

function vectorTile(x, y) {
  const key = `${x}/${y}`;
  if (!vectorTiles.has(key)) {
    tileTemplate ??= fetchWithin(VECTOR, {}, 10000).then((r) => r.json()).then((j) => j.tiles[0]).catch((err) => { tileTemplate = null; throw err; });
    const job = tileTemplate
      .then((url) => fetchWithin(url.replace('{z}', Z).replace('{x}', x).replace('{y}', y), {}, 20000))
      .then((res) => { if (!res.ok) throw new Error(`Map tile ${res.status}`); return res.arrayBuffer(); })
      .then((buf) => tileElements(decodeTile(new Uint8Array(buf)), Z, x, y));
    job.catch(() => vectorTiles.delete(key));
    vectorTiles.set(key, job);
  }
  return vectorTiles.get(key);
}

// Whether an element has any point inside a box [south, west, north, east].
function touches(el, [s, w, n, e]) {
  if (el.type === 'node') return el.lat >= s && el.lat <= n && el.lon >= w && el.lon <= e;
  let south = 90; let north = -90; let west = 180; let east = -180;
  for (const g of el.geometry) {
    south = Math.min(south, g.lat); north = Math.max(north, g.lat);
    west = Math.min(west, g.lon); east = Math.max(east, g.lon);
  }
  return south <= n && north >= s && west <= e && east >= w;
}

// The map data for a box [south, west, north, east]: from vector tiles, or,
// if they can't be had, from the Overpass API.
export async function mapArea(box) {
  try {
    const parts = await Promise.all(tilesFor(box, Z).map(([x, y]) => vectorTile(x, y)));
    return { elements: parts.flat().filter((el) => touches(el, box)) };
  } catch {
    return overpass(boxesQuery([box]), 30000);
  }
}

// Asks the Overpass servers in turn until one answers.
export async function overpass(query, ms = 60000) {
  let busy = false;
  for (const url of OVERPASS) {
    try {
      const res = await fetchWithin(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      }, ms);
      if (res.status === 429 || res.status === 504) { busy = true; continue; }
      if (!res.ok) continue;
      const data = await res.json();
      // A query that ran out of time or memory comes back empty with a remark.
      if (data.remark && !data.elements?.length) { busy = true; continue; }
      return data;
    } catch { /* try the next server */ }
  }
  throw new Error(busy
    ? 'The map data servers are busy. Wait a minute and try again.'
    : 'The map data servers didn’t answer. Check your connection and try again.');
}

export const BIOME_COLOURS = {
  park: '#6fae57', woods: '#3f6b3a', water: '#4f8fd0', beach: '#e2c27a', street: '#9a8f86', town: '#c4673a',
};


// Builds a route saved earlier again, with the map around it as it is now.
export async function rebuildRoute(route) {
  return buildWalk(route.points, await overpass(overpassQuery(route.points)), { waypoints: route.waypoints });
}

// A route saved before maps were kept, ready to walk from above with just the
// route itself, for when its map can't be fetched.
export function withoutMap(route) {
  const bare = buildWalk(route.points, { elements: [] });
  return { ...route, line: bare.line, map: bare.map, landmarks: route.landmarks.filter((l) => l.x !== undefined) };
}

export class MapPlanner {
  constructor(els, { onStart, toast }) {
    this.els = els;
    this.onStart = onStart;
    this.toast = toast;
    this.at = null; // the pinned spot, [lat, lon]
    this.placeName = '';
    this.bind();
  }

  bind() {
    const e = this.els;
    e.search.addEventListener('submit', (ev) => { ev.preventDefault(); this.search(e.query.value.trim()); });
    e.locate.addEventListener('click', () => this.locate());
    e.save.addEventListener('click', () => this.start());
  }

  async open() {
    this.els.panel.hidden = false;
    if (this.map) { this.map.invalidateSize(); return; }
    let L;
    try {
      L = await import('../vendor/leaflet/leaflet-src.esm.js');
    } catch {
      this.notice('The map could not be loaded.');
      return;
    }
    this.L = L;
    this.map = L.map(this.els.map, { zoomControl: true }).setView([51.505, -0.09], 15);
    let loaded = 0;
    let failed = 0;
    L.tileLayer(TILES, { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors' })
      .on('tileload', () => { loaded++; })
      .on('tileerror', () => {
        failed++;
        if (failed === 4 && loaded === 0) {
          this.notice('Map pictures can’t load here. This page blocks outside sites; open the app from its own website to walk on the map.');
        }
      })
      .addTo(this.map);
    this.map.on('click', (ev) => this.pin([ev.latlng.lat, ev.latlng.lng]));
    this.changed();
    this.locate(true);
  }

  close() { this.els.panel.hidden = true; }

  notice(text) {
    this.els.notice.textContent = text;
    this.els.notice.hidden = !text;
  }

  // Drop the pin where your walk starts.
  pin(at, name = '') {
    this.at = at;
    if (name) this.placeName = name;
    const L = this.L;
    if (L) {
      this.marker?.remove();
      this.marker = L.circleMarker(at, { radius: 9, color: '#fff', weight: 3, fillColor: '#1d6d64', fillOpacity: 1 }).addTo(this.map);
    }
    this.els.name.value = this.placeName || 'My spot';
    this.changed();
  }

  changed() {
    this.els.distance.textContent = this.at
      ? 'Your walk starts at the pin. Click somewhere else to move it.'
      : 'Click the map where you want to start walking.';
    this.els.start.hidden = !this.at;
  }

  async search(q) {
    if (!q) return;
    const list = this.els.results;
    list.replaceChildren();
    try {
      const res = await fetch(`${SEARCH}?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error();
      const found = await res.json();
      if (!found.length) { this.notice(`Nothing found for “${q}”.`); return; }
      this.notice('');
      list.replaceChildren(...found.map((r) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ghost small';
        b.textContent = r.display_name;
        b.onclick = () => {
          const [s0, n, w, e] = r.boundingbox.map(Number);
          this.map?.fitBounds([[s0, w], [n, e]], { maxZoom: 17 });
          this.pin([Number(r.lat), Number(r.lon)], r.name || r.display_name.split(',')[0]);
          list.replaceChildren();
        };
        li.append(b);
        return li;
      }));
    } catch {
      this.notice('Place search isn’t reachable from here. You can still pan and zoom the map by hand.');
    }
  }

  locate(quiet = false) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = [pos.coords.latitude, pos.coords.longitude];
        this.map?.setView(at, 17);
        if (!quiet) this.pin(at, 'Near me');
      },
      () => { if (!quiet) this.notice('Your location isn’t available here. Search for a place instead.'); },
      { timeout: 8000 },
    );
  }

  start() {
    if (!this.at) return;
    const name = this.els.name.value.trim() || 'My spot';
    this.onStart({ name, at: this.at });
    this.close();
  }
}

// A small picture of a route for the places list: the line, coloured by
// the kind of place each stretch passes through.
export function routeThumbnail(route, w = 160, h = 90) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#eef1e8';
  ctx.fillRect(0, 0, w, h);
  const pts = route.points;
  const lats = pts.map((p) => p[0]);
  const lons = pts.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const xs = lons.map((v) => v * kx);
  const spanX = Math.max(...xs) - Math.min(...xs) || 1e-6;
  const spanY = Math.max(...lats) - Math.min(...lats) || 1e-6;
  const k = Math.min((w - 20) / spanX, (h - 20) / spanY);
  const ox = (w - spanX * k) / 2;
  const oy = (h - spanY * k) / 2;
  const at = (p) => [ox + (p[1] * kx - Math.min(...xs)) * k, h - oy - (p[0] - Math.min(...lats)) * k];
  // Colour each leg by the stretch it starts in.
  let d = 0;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length; i++) {
    const biome = route.segments.find((s) => d >= s.from && d < s.to)?.biome ?? route.segments[route.segments.length - 1].biome;
    ctx.strokeStyle = BIOME_COLOURS[biome];
    ctx.beginPath();
    ctx.moveTo(...at(pts[i - 1]));
    ctx.lineTo(...at(pts[i]));
    ctx.stroke();
    d += routeLength([pts[i - 1], pts[i]]);
  }
  ctx.fillStyle = '#1d6d64';
  ctx.beginPath();
  ctx.arc(...at(pts[0]), 4, 0, Math.PI * 2);
  ctx.fill();
  return c.toDataURL();
}
