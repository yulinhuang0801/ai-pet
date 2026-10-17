// The route planner: a real map where the owner searches for a place, clicks
// out a route, and the app fetches what lies along it from OpenStreetMap to
// build a walk. Map tiles come from openstreetmap.org, place search from
// Nominatim and map data from the Overpass API, so this needs the app to be
// on a site that can reach them (not every preview can).

import { overpassQuery, buildWalk, describeWalk, routeLength, BIOMES } from './route.js';

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SEARCH = 'https://nominatim.openstreetmap.org/search';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const MAX_METRES = 5000;

export const BIOME_COLOURS = {
  park: '#6fae57', woods: '#3f6b3a', water: '#4f8fd0', beach: '#e2c27a', street: '#9a8f86', town: '#c4673a',
};

const fmt = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

export class RoutePlanner {
  constructor(els, { onSave, toast }) {
    this.els = els;
    this.onSave = onSave;
    this.toast = toast;
    this.points = [];
    this.walk = null;
    this.placeName = '';
    this.bind();
  }

  bind() {
    const e = this.els;
    e.search.addEventListener('submit', (ev) => { ev.preventDefault(); this.search(e.query.value.trim()); });
    e.locate.addEventListener('click', () => this.locate());
    e.undo.addEventListener('click', () => { this.points.pop(); this.changed(); });
    e.clear.addEventListener('click', () => { this.points = []; this.changed(); });
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
    this.line = L.polyline([], { color: '#1d6d64', weight: 5, opacity: 0.85 }).addTo(this.map);
    this.dots = L.layerGroup().addTo(this.map);
    this.map.on('click', (ev) => {
      this.points.push([ev.latlng.lat, ev.latlng.lng]);
      this.changed();
    });
    this.changed();
    this.locate(true);
  }

  close() { this.els.panel.hidden = true; }

  notice(text) {
    this.els.notice.textContent = text;
    this.els.notice.hidden = !text;
  }

  changed() {
    this.walk = null;
    this.els.result.hidden = true;
    const L = this.L;
    if (L) {
      this.line.setLatLngs(this.points);
      this.dots.clearLayers();
      this.points.forEach((p, i) => {
        const end = i === this.points.length - 1 && i > 0;
        L.circleMarker(p, { radius: i === 0 || end ? 7 : 4, color: '#fff', weight: 2, fillColor: i === 0 ? '#1d6d64' : end ? '#1f2a24' : '#5cc4b4', fillOpacity: 1 }).addTo(this.dots);
      });
    }
    const len = this.points.length > 1 ? routeLength(this.points) : 0;
    this.els.distance.textContent = this.points.length === 0
      ? 'Click the map where your walk starts, then click along the paths you’d take.'
      : this.points.length === 1 ? 'Now click along your route.' : `Your route: ${fmt(len)}`;
    this.els.undo.disabled = this.points.length === 0;
    this.els.clear.disabled = this.points.length === 0;
    this.els.build.disabled = this.points.length < 2 || len > MAX_METRES;
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
      const res = await fetch(OVERPASS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(overpassQuery(this.points))}`,
      });
      if (!res.ok) throw new Error(res.status === 429 ? 'The map data service is busy. Wait a minute and try again.' : 'The map data service didn’t answer.');
      this.walk = buildWalk(this.points, await res.json());
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
    this.points = [];
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
