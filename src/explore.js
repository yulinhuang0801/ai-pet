// Walking from a pinned spot with no route: the map loads around you as you
// go, a square of it at a time, the way Minecraft loads chunks. Each square is
// fetched from OpenStreetMap, built into blocks (blocks.js) and added to one
// growing area that the walk stands on.
//
// Positions are map metres from the pinned spot: x east, y south.

import { projector, boxesQuery, landmarksIn } from './route.js';
import { extractMap } from './route-map.js';
import { emptyBlocks, addArea, CHUNK } from './blocks.js';

export const TILE = CHUNK * 8; // 256 m squares
const MARGIN = 40; // map data fetched around each square, so its edges come out whole
const AHEAD = 120; // load squares within this many metres of you
const RETRY = 20000; // ms before trying a square that failed again

export class Explorer {
  // `origin` is [lat, lon]; `fetchOsm(query)` resolves with Overpass JSON.
  constructor(origin, { fetchOsm, now = () => Date.now() }) {
    this.fetchOsm = fetchOsm;
    this.now = now;
    this.project = projector(origin);
    const one = this.project([origin[0] + 0.001, origin[1] + 0.001]);
    this.perDegree = { x: one[0] / 0.001, y: one[1] / 0.001 };
    this.tiles = new Map(); // "i,j" -> { state: 'loading' | 'ready' | 'failed', at }
    this.busy = false;
    // Shaped like a saved route, so the walk and its drawing treat both alike.
    this.area = {
      origin,
      points: [origin, origin],
      line: [],
      landmarks: [],
      segments: [],
      map: { areas: [], lines: [], buildings: [], trees: [] },
      blocks: emptyBlocks({ outsideSolid: true }),
      version: 0,
      explore: this,
    };
  }

  // Latitude and longitude of a point in map metres.
  latLon(x, y) {
    const [lat0, lon0] = this.area.origin;
    return [lat0 - y / this.perDegree.y, lon0 + x / this.perDegree.x];
  }

  // Is the square under this point loaded?
  ready(x, y) {
    return this.tiles.get(`${Math.floor(x / TILE)},${Math.floor(y / TILE)}`)?.state === 'ready';
  }

  get loading() { return this.busy; }

  // Call as you move: starts loading the nearest square not yet loaded near (x, y).
  update(x, y) {
    if (this.busy) return null;
    const wanted = [];
    for (let i = Math.floor((x - AHEAD) / TILE); i <= Math.floor((x + AHEAD) / TILE); i++) {
      for (let j = Math.floor((y - AHEAD) / TILE); j <= Math.floor((y + AHEAD) / TILE); j++) {
        const t = this.tiles.get(`${i},${j}`);
        if (t?.state === 'ready' || t?.state === 'loading') continue;
        if (t?.state === 'failed' && this.now() - t.at < RETRY) continue;
        const cx = (i + 0.5) * TILE;
        const cy = (j + 0.5) * TILE;
        wanted.push({ i, j, d: Math.hypot(cx - x, cy - y) });
      }
    }
    if (!wanted.length) return null;
    wanted.sort((a, b) => a.d - b.d);
    return this.load(wanted[0].i, wanted[0].j);
  }

  async load(i, j) {
    const key = `${i},${j}`;
    this.tiles.set(key, { state: 'loading', at: this.now() });
    this.busy = true;
    try {
      const box = { x0: i * TILE, y0: j * TILE, x1: (i + 1) * TILE, y1: (j + 1) * TILE };
      // Overpass boxes are [south, west, north, east].
      const [north, west] = this.latLon(box.x0 - MARGIN, box.y0 - MARGIN);
      const [south, east] = this.latLon(box.x1 + MARGIN, box.y1 + MARGIN);
      const osm = await this.fetchOsm(boxesQuery([[south, west, north, east]]));
      this.add(box, osm);
      this.tiles.set(key, { state: 'ready', at: this.now() });
    } catch (err) {
      this.tiles.set(key, { state: 'failed', at: this.now(), error: err.message });
    } finally {
      this.busy = false;
    }
  }

  // Builds one square from its map data and adds it to the area.
  add(box, osm) {
    const a = this.area;
    const corners = [[box.x0, -box.y0], [box.x1, -box.y1]];
    const map = extractMap(osm, this.project, corners, MARGIN);
    addArea(a.blocks, map, box);
    for (const k of ['areas', 'lines', 'buildings', 'trees']) a.map[k].push(...map[k]);
    const known = new Set(a.landmarks.map((l) => l.d));
    for (const lm of landmarksIn(osm, this.project)) {
      if (!known.has(lm.d) && lm.x >= box.x0 && lm.x < box.x1 && lm.y >= box.y0 && lm.y < box.y1) a.landmarks.push(lm);
    }
    a.version++;
  }
}
