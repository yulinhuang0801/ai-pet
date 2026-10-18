// The route planner: a real map where the owner searches for a place, clicks
// out a route, and the app fetches what lies along it from OpenStreetMap to
// build a walk. Clicks are joined along real streets and footpaths, not in
// straight lines through houses. Map tiles come from openstreetmap.org, place
// search from Nominatim, walking routes from the FOSSGIS routing server and
// map data from the Overpass API, so this needs the app to be on a site that
// can reach them (not every preview can).

import { overpassQuery, buildWalk, describeWalk, routeLength, BIOMES } from './route.js';
import { pathsQuery, pathGraph, findPath, loopPoints } from './paths.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SEARCH = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';
const MAX_METRES = 5000;

async function overpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(res.status === 429 ? 'The map data service is busy. Wait a minute and try again.' : 'The map data service didn’t answer.');
  return res.json();
}

// A walking route through some [lat, lon] points, as [lat, lon] points along
// real streets and paths. Asks the routing server, then falls back to
// finding paths in map data; null if neither works.
async function walkingRoute(points) {
  try {
    const coords = points.map(([lat, lon]) => `${lon.toFixed(6)},${lat.toFixed(6)}`).join(';');
    const res = await fetch(`${ROUTER}/${coords}?overview=full&geometries=geojson`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const line = data.routes?.[0]?.geometry?.coordinates;
    if (data.code === 'Ok' && line?.length >= 2) return line.map(([lon, lat]) => [lat, lon]);
  } catch { /* try the map data instead */ }
  try {
    const graph = pathGraph(await overpass(pathsQuery(points)));
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

export class RoutePlanner {
  constructor(els, { onSave, toast }) {
    this.els = els;
    this.onSave = onSave;
    this.toast = toast;
    // The points clicked, and the way between each one and the one before.
    this.waypoints = [];
    this.legs = [];
    this.busy = false;
    this.walk = null;
    this.placeName = '';
    this.bind();
  }

  bind() {
    const e = this.els;
    e.search.addEventListener('submit', (ev) => { ev.preventDefault(); this.search(e.query.value.trim()); });
    e.locate.addEventListener('click', () => this.locate());
    e.undo.addEventListener('click', () => { this.waypoints.pop(); this.legs.pop(); this.changed(); });
    e.clear.addEventListener('click', () => { this.waypoints = []; this.legs = []; this.changed(); });
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
    this.dots = L.layerGroup().addTo(this.map);
    this.map.on('click', (ev) => this.addPoint([ev.latlng.lat, ev.latlng.lng]));
    this.changed();
    this.locate(true);
  }

  close() { this.els.panel.hidden = true; }

  // The whole route so far, as [lat, lon] points.
  get points() { return joinLegs(this.legs); }

  async addPoint(p) {
    if (this.busy) return;
    const prev = this.waypoints[this.waypoints.length - 1];
    this.waypoints.push(p);
    if (!prev) { this.legs.push([p]); this.changed(); return; }
    // The first leg replaces the starting click with where the path really starts.
    if (this.legs.length === 1) this.legs = [];
    if (!this.els.snap.checked) { this.legs.push([prev, p]); this.changed(); return; }
    this.setBusy('Finding a way you can walk…');
    const path = await walkingRoute([prev, p]);
    this.setBusy(null);
    if (path) this.legs.push(path);
    else {
      this.legs.push([prev, p]);
      this.notice('Couldn’t find a path between those points, so that part is a straight line.');
    }
    this.changed();
  }

  // A round walk of about the chosen length from the first point (or the
  // middle of the map), along real streets and paths. Press again for another.
  async suggestLoop() {
    if (this.busy || !this.map) return;
    const c = this.map.getCenter();
    const start = this.waypoints[0] ?? [c.lat, c.lng];
    const metres = Number(this.els.loopLength.value);
    this.setBusy('Looking for a loop…');
    const path = await walkingRoute(loopPoints(start, metres));
    this.setBusy(null);
    if (!path) {
      this.changed();
      this.notice('Couldn’t find a loop here. Try somewhere else, or click out your own route.');
      return;
    }
    this.notice('');
    this.waypoints = [path[0], path[path.length - 1]];
    this.legs = [path];
    this.changed();
    this.map.fitBounds(this.line.getBounds(), { padding: [20, 20] });
  }

  setBusy(text) {
    this.busy = Boolean(text);
    if (text) this.els.distance.textContent = text;
    for (const b of [this.els.loop, this.els.undo, this.els.clear, this.els.build]) b.disabled = this.busy || b.disabled;
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
    if (L) {
      this.line.setLatLngs(points);
      this.dots.clearLayers();
      this.waypoints.forEach((p, i) => {
        const end = i === this.waypoints.length - 1 && i > 0;
        L.circleMarker(p, { radius: i === 0 || end ? 7 : 4, color: '#fff', weight: 2, fillColor: i === 0 ? '#1d6d64' : end ? '#1f2a24' : '#5cc4b4', fillOpacity: 1 }).addTo(this.dots);
      });
    }
    const len = points.length > 1 ? routeLength(points) : 0;
    this.els.distance.textContent = this.waypoints.length === 0
      ? 'Click where your walk starts, then where you want to go. The route follows real streets and paths.'
      : this.waypoints.length === 1 ? 'Now click where you want to go next.' : `Your route: ${fmt(len)}`;
    this.els.undo.disabled = this.waypoints.length === 0;
    this.els.clear.disabled = this.waypoints.length === 0;
    this.els.loop.disabled = false;
    this.els.build.disabled = points.length < 2 || len > MAX_METRES;
    if (len > MAX_METRES) this.els.distance.textContent += ` (keep it under ${fmt(MAX_METRES)})`;
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
      this.notice(err.message?.startsWith('The map') ? err.message : 'Couldn’t fetch what’s along your route. Check your connection and try again.');
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
    this.waypoints = [];
    this.legs = [];
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
