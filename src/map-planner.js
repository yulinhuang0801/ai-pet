// The route planner: a real map where the owner searches for a place, clicks
// out a route, and the app fetches what lies along it from OpenStreetMap to
// build a walk. Clicks are joined along real streets and footpaths, not in
// straight lines through houses. Map tiles come from openstreetmap.org, place
// search from Nominatim, walking routes from the FOSSGIS routing server and
// map data from the Overpass API, so this needs the app to be on a site that
// can reach them (not every preview can).

import { overpassQuery, buildWalk, describeWalk, routeLength, bbox, BIOMES } from './route.js';
import { pathsQuery, pathGraph, findPath, loopPoints } from './paths.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SEARCH = 'https://nominatim.openstreetmap.org/search';
// The main Overpass server, then public mirrors to try when it's busy.
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';
const MAX_METRES = 5000;

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

// Asks the Overpass servers in turn until one answers.
async function overpass(query, ms = 60000) {
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

// Walkable paths around some points, fetched once per area and kept, one
// area at a time so the servers aren't asked for the same place twice.
const graphs = [];
let graphQueue = Promise.resolve();
function pathsAround(points) {
  const covers = (g) => points.every(([lat, lon]) => lat > g.inner[0] && lat < g.inner[2] && lon > g.inner[1] && lon < g.inner[3]);
  const next = graphQueue.then(async () => {
    const known = graphs.find(covers);
    if (known) return known.graph;
    const graph = pathGraph(await overpass(pathsQuery(points, 600), 25000));
    graphs.push({ inner: bbox(points, 400), graph });
    return graph;
  });
  graphQueue = next.catch(() => {});
  return next;
}

// A walking route through some [lat, lon] points, as [lat, lon] points along
// real streets and paths. Asks the routing server, then falls back to
// finding paths in map data; null if neither works.
async function walkingRoute(points) {
  try {
    const coords = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
    const res = await fetchWithin(`${ROUTER}/${coords}?overview=full&geometries=geojson`, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      const line = data.routes?.[0]?.geometry?.coordinates;
      if (data.code === 'Ok' && line?.length >= 2) return line.map(([lon, lat]) => [lat, lon]);
    }
  } catch { /* try the map data instead */ }
  try {
    const graph = await pathsAround(points);
    const out = [];
    for (let i = 1; i < points.length; i++) {
      const leg = findPath(graph, points[i - 1], points[i]);
      if (!leg) return null;
      out.push(...(out.length ? leg.slice(1) : leg));
    }
    return out.length >= 2 ? out : null;
  } catch {
    return null;
  }
}

// Joins legs end to end, dropping the point where each meets the next.
function joinLegs(legs) {
  const out = [];
  for (const leg of legs) {
    for (const p of leg) {
      const last = out[out.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
    }
  }
  return out;
}

export const BIOME_COLOURS = {
  park: '#6fae57', woods: '#3f6b3a', water: '#4f8fd0', beach: '#e2c27a', street: '#9a8f86', town: '#c4673a',
};

const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

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

export class RoutePlanner {
  constructor(els, { onSave, toast }) {
    this.els = els;
    this.onSave = onSave;
    this.toast = toast;
    // The points clicked. Each has the way from the one before it: a path
    // along streets once found, or null for a straight line.
    this.pins = [];
    this.loading = false;
    this.walk = null;
    this.placeName = '';
    this.bind();
  }

  bind() {
    const e = this.els;
    e.search.addEventListener('submit', (ev) => { ev.preventDefault(); this.search(e.query.value.trim()); });
    e.locate.addEventListener('click', () => this.locate());
    e.undo.addEventListener('click', () => { this.pins.pop(); this.changed(); });
    e.clear.addEventListener('click', () => { this.pins = []; this.notice(''); this.changed(); });
    e.loop.addEventListener('click', () => this.suggestLoop());
    e.build.addEventListener('click', () => this.build());
    e.save.addEventListener('click', () => this.save());
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
          this.notice('Map pictures can’t load here. This page blocks outside sites; open the app from its own website to plan routes on the map.');
        }
      })
      .addTo(this.map);
    this.map.attributionControl.addAttribution('Walking routes: <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS</a>');
    this.line = L.polyline([], { color: '#1d6d64', weight: 5, opacity: 0.85 }).addTo(this.map);
    this.rough = L.polyline([], { color: '#1d6d64', weight: 4, opacity: 0.6, dashArray: '6 9' }).addTo(this.map);
    this.dots = L.layerGroup().addTo(this.map);
    this.map.on('click', (ev) => this.addPoint([ev.latlng.lat, ev.latlng.lng]));
    this.changed();
    this.locate(true);
  }

  close() { this.els.panel.hidden = true; }

  // The points clicked, and the whole route so far, as [lat, lon] points.
  get waypoints() { return this.pins.map((p) => p.at); }

  legs() { return this.pins.slice(1).map((p, i) => p.path ?? [this.pins[i].at, p.at]); }

  get points() { return this.pins.length > 1 ? joinLegs(this.legs()) : this.waypoints; }

  // A click adds a point straight away; the way there along streets and
  // paths is filled in when it's found, so you can keep clicking.
  addPoint(at) {
    const prev = this.pins[this.pins.length - 1];
    const pin = { at, path: null, pending: false };
    this.pins.push(pin);
    if (prev && this.els.snap.checked) {
      pin.pending = true;
      walkingRoute([prev.at, at]).then((path) => {
        if (!this.pins.includes(pin)) return; // undone or cleared meanwhile
        pin.pending = false;
        pin.path = path;
        if (!path) this.notice('Couldn’t find a walkable path for part of your route, so that part is a straight line (dashed).');
        this.changed();
      });
    }
    this.changed();
  }

  // A round walk of about the chosen length from the first point (or the
  // middle of the map), along real streets and paths. Press again for another.
  async suggestLoop() {
    if (this.loading || !this.map) return;
    const c = this.map.getCenter();
    const start = this.pins[0]?.at ?? [c.lat, c.lng];
    const metres = Number(this.els.loopLength.value);
    this.loading = true;
    this.changed();
    const path = await walkingRoute(loopPoints(start, metres));
    this.loading = false;
    if (!path) {
      this.changed();
      this.notice('Couldn’t find a loop here. Try somewhere else, or click out your own route.');
      return;
    }
    this.notice('');
    this.pins = [{ at: path[0], path: null }, { at: path[path.length - 1], path }];
    this.changed();
    this.map.fitBounds(this.line.getBounds(), { padding: [20, 20] });
  }

  notice(text) {
    this.els.notice.textContent = text;
    this.els.notice.hidden = !text;
  }

  changed() {
    this.walk = null;
    this.els.result.hidden = true;
    const L = this.L;
    const points = this.points;
    const waiting = this.pins.filter((p) => p.pending).length;
    if (L) {
      // Legs that follow streets are solid; straight ones (not found yet, or not found at all) are dashed.
      const legs = this.legs();
      this.line.setLatLngs(legs.filter((_, i) => this.pins[i + 1].path));
      this.rough.setLatLngs(legs.filter((_, i) => !this.pins[i + 1].path));
      this.dots.clearLayers();
      this.pins.forEach((p, i) => {
        const end = i === this.pins.length - 1 && i > 0;
        L.circleMarker(p.at, { radius: i === 0 || end ? 7 : 5, color: '#fff', weight: 2, fillColor: i === 0 ? '#1d6d64' : end ? '#1f2a24' : '#5cc4b4', fillOpacity: 1 }).addTo(this.dots);
      });
    }
    const len = points.length > 1 ? routeLength(points) : 0;
    let text = this.pins.length === 0
      ? 'Click where your walk starts, then each place you want to go. The route follows real streets and paths.'
      : this.pins.length === 1 ? 'Now click the next place you want to go.' : `Your route: ${fmt(len)}`;
    if (waiting) text += ' · finding paths…';
    if (this.loading) text = 'Looking for a loop…';
    if (len > MAX_METRES) text += ` (keep it under ${fmt(MAX_METRES)})`;
    this.els.distance.textContent = text;
    this.els.undo.disabled = this.pins.length === 0;
    this.els.clear.disabled = this.pins.length === 0;
    this.els.loop.disabled = this.loading;
    this.els.build.disabled = points.length < 2 || len > MAX_METRES || waiting > 0 || this.loading;
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
          const [s, n, w, e] = r.boundingbox.map(Number);
          this.map?.fitBounds([[s, w], [n, e]], { maxZoom: 17 });
          this.placeName = r.name || r.display_name.split(',')[0];
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
      (pos) => this.map?.setView([pos.coords.latitude, pos.coords.longitude], 16),
      () => { if (!quiet) this.notice('Your location isn’t available here. Search for a place instead.'); },
      { timeout: 8000 },
    );
  }

  async build() {
    const e = this.els;
    e.build.disabled = true;
    e.build.textContent = 'Looking at what’s along your route…';
    this.notice('');
    try {
      const points = this.points;
      this.walk = buildWalk(points, await overpass(overpassQuery(points)), { waypoints: this.waypoints });
      this.showResult();
    } catch (err) {
      this.notice(err.message?.startsWith('The map') ? err.message : `Something went wrong building the walk (${err.message}).`);
    } finally {
      e.build.textContent = 'Build this walk';
      e.build.disabled = false;
    }
  }

  showResult() {
    const e = this.els;
    const w = this.walk;
    e.summary.textContent = describeWalk(w);
    e.strip.replaceChildren(...w.segments.map((s) => {
      const span = document.createElement('span');
      span.style.flexGrow = String(Math.max(1, s.to - s.from));
      span.style.background = BIOME_COLOURS[s.biome];
      span.title = `${BIOMES[s.biome].label}: ${fmt(s.to - s.from)}`;
      return span;
    }));
    e.name.value = this.placeName ? `${this.placeName} walk` : 'My route';
    e.result.hidden = false;
  }

  save() {
    if (!this.walk) return;
    const name = this.els.name.value.trim() || 'My route';
    this.onSave({ name, route: this.walk });
    this.pins = [];
    this.changed();
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
