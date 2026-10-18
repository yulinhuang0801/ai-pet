// Finding a way you can actually walk between two points, over the streets
// and footpaths in OpenStreetMap data. The route planner asks a routing
// service first; this is the fallback when that service can't be reached,
// using map data from the same Overpass service the walks are built from.
// Pure functions, tested offline.

import { haversine, bbox } from './route.js';

const WALKABLE = 'footway|path|pedestrian|steps|living_street|residential|unclassified|service|track|cycleway|bridleway|road|corridor|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link';

// Paths are preferred over busy roads: each metre of road counts as a bit more.
const COST = { primary: 1.5, primary_link: 1.5, secondary: 1.35, secondary_link: 1.35, tertiary: 1.2, tertiary_link: 1.2, service: 1.1 };

// The Overpass query for everything walkable around some points.
export function pathsQuery(points, pad = 250) {
  const b = bbox(points, pad).map((v) => v.toFixed(6)).join(',');
  return `[out:json][timeout:25];
way["highway"~"^(${WALKABLE})$"]["access"!~"^(private|no)$"]["foot"!~"^(no|private)$"](${b});
out geom;`;
}

// The walkable network as a graph of OSM nodes.
export function pathGraph(osm) {
  const nodes = new Map(); // id -> { lat, lon, edges: [[id, cost]] }
  for (const el of osm.elements ?? []) {
    if (el.type !== 'way' || !el.tags?.highway || !el.nodes || !el.geometry || el.nodes.length !== el.geometry.length) continue;
    const k = COST[el.tags?.highway] ?? 1;
    for (let i = 0; i < el.nodes.length; i++) {
      const id = el.nodes[i];
      if (!nodes.has(id)) nodes.set(id, { lat: el.geometry[i].lat, lon: el.geometry[i].lon, edges: [] });
      if (i === 0) continue;
      const prev = el.nodes[i - 1];
      const d = haversine([el.geometry[i - 1].lat, el.geometry[i - 1].lon], [el.geometry[i].lat, el.geometry[i].lon]) * k;
      nodes.get(prev).edges.push([id, d]);
      nodes.get(id).edges.push([prev, d]);
    }
  }
  return nodes;
}

function nearestNode(graph, [lat, lon]) {
  let best = null;
  let bestD = Infinity;
  for (const [id, n] of graph) {
    if (!n.edges.length) continue;
    const d = haversine([lat, lon], [n.lat, n.lon]);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best === null ? null : { id: best, d: bestD };
}

// A small binary heap for A*.
class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// The shortest walkable way from `from` to `to` ([lat, lon] each), as the
// list of [lat, lon] path points from the one nearest `from` to the one
// nearest `to`, or null if there is none (or either point is more than
// `snap` metres from any path).
export function findPath(graph, from, to, snap = 150) {
  const a = nearestNode(graph, from);
  const b = nearestNode(graph, to);
  if (!a || !b || a.d > snap || b.d > snap) return null;
  const goal = graph.get(b.id);
  const guess = (n) => haversine([n.lat, n.lon], [goal.lat, goal.lon]);
  const cost = new Map([[a.id, 0]]);
  const came = new Map();
  const open = new Heap();
  open.push([guess(graph.get(a.id)), a.id]);
  const done = new Set();
  while (open.size) {
    const [, id] = open.pop();
    if (id === b.id) break;
    if (done.has(id)) continue;
    done.add(id);
    for (const [next, d] of graph.get(id).edges) {
      const c = cost.get(id) + d;
      if (c < (cost.get(next) ?? Infinity)) {
        cost.set(next, c);
        came.set(next, id);
        open.push([c + guess(graph.get(next)), next]);
      }
    }
  }
  if (a.id !== b.id && !came.has(b.id)) return null;
  const ids = [b.id];
  while (ids[ids.length - 1] !== a.id) ids.push(came.get(ids[ids.length - 1]));
  ids.reverse();
  return ids.map((id) => [graph.get(id).lat, graph.get(id).lon]);
}

// Points for a round walk of roughly `metres`, starting and ending at
// `start`: three turning points on a circle, set off in a random direction.
// Streets wind, so the circle is drawn a little smaller than the target.
export function loopPoints([lat, lon], metres, rand = Math.random) {
  const r = (metres / (2 * Math.PI)) * 0.8;
  const heading = rand() * Math.PI * 2;
  // The circle's centre sits `r` away from the start.
  const kLat = 1 / 111320;
  const kLon = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const cx = Math.cos(heading) * r;
  const cy = Math.sin(heading) * r;
  const turns = [1, 2, 3].map((i) => {
    const ang = heading + Math.PI + (i * Math.PI) / 2;
    return [lat + (cy + Math.sin(ang) * r) * kLat, lon + (cx + Math.cos(ang) * r) * kLon];
  });
  return [[lat, lon], ...turns, [lat, lon]];
}
