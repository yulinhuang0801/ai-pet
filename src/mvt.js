// Reading Mapbox vector tiles: the compact, pre-built map tiles that
// OpenStreetMap data is served as from a CDN (OpenFreeMap, in the
// OpenMapTiles schema). A tile is a protocol-buffer file of layers, each a
// list of features with tags and a geometry drawn in tile pixels.
// Spec: https://github.com/mapbox/vector-tile-spec (version 2). Pure, so it
// works in any view and is tested offline.

// --- protocol buffers, just what tiles use ---

class Reader {
  constructor(bytes, start = 0, end = bytes.length) {
    this.b = bytes;
    this.pos = start;
    this.end = end;
  }

  varint() {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = this.b[this.pos++];
      // Past 28 bits, multiply instead of shifting so numbers stay exact.
      result += shift < 28 ? (byte & 0x7f) << shift : (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }

  // The fields of a message: [field number, wire type] pairs, then the caller reads the value.
  *fields() {
    while (this.pos < this.end) {
      const key = this.varint();
      yield [key >>> 3, key & 7];
    }
  }

  bytes() {
    const len = this.varint();
    const start = this.pos;
    this.pos += len;
    return [start, this.pos];
  }

  string() {
    const [s, e] = this.bytes();
    return new TextDecoder().decode(this.b.subarray(s, e));
  }

  packed() {
    const [s, e] = this.bytes();
    const r = new Reader(this.b, s, e);
    const out = [];
    while (r.pos < r.end) out.push(r.varint());
    return out;
  }

  skip(type) {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) this.bytes();
    else if (type === 5) this.pos += 4;
  }
}

const zigzag = (n) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

function readValue(r) {
  const [s, e] = r.bytes();
  const v = new Reader(r.b, s, e);
  const view = new DataView(r.b.buffer, r.b.byteOffset);
  let value = null;
  for (const [field, type] of v.fields()) {
    if (field === 1) value = v.string();
    else if (field === 2) { value = view.getFloat32(v.pos, true); v.pos += 4; }
    else if (field === 3) { value = view.getFloat64(v.pos, true); v.pos += 8; }
    else if (field === 4 || field === 5) value = v.varint();
    else if (field === 6) value = zigzag(v.varint());
    else if (field === 7) value = Boolean(v.varint());
    else v.skip(type);
  }
  return value;
}

// Geometry commands into lists of [x, y] points (lines or rings).
function readGeometry(cmds) {
  const parts = [];
  let part = null;
  let x = 0;
  let y = 0;
  for (let i = 0; i < cmds.length;) {
    const cmd = cmds[i] & 7;
    const count = cmds[i] >> 3;
    i++;
    if (cmd === 7) { if (part?.length) part.push([part[0][0], part[0][1]]); continue; }
    for (let k = 0; k < count; k++) {
      x += zigzag(cmds[i++]);
      y += zigzag(cmds[i++]);
      if (cmd === 1) { part = [[x, y]]; parts.push(part); } else part.push([x, y]);
    }
  }
  return parts;
}

const TYPES = { 1: 'point', 2: 'line', 3: 'polygon' };

// All the layers of a tile: { name: { extent, features: [{ type, tags, parts }] } }.
export function decodeTile(bytes) {
  const r = new Reader(bytes);
  const layers = {};
  for (const [field, type] of r.fields()) {
    if (field !== 3) { r.skip(type); continue; }
    const [s, e] = r.bytes();
    const l = new Reader(bytes, s, e);
    let name = '';
    let extent = 4096;
    const keys = [];
    const values = [];
    const raw = [];
    for (const [f, t] of l.fields()) {
      if (f === 1) name = l.string();
      else if (f === 2) raw.push(l.bytes());
      else if (f === 3) keys.push(l.string());
      else if (f === 4) values.push(readValue(l));
      else if (f === 5) extent = l.varint();
      else l.skip(t);
    }
    const features = raw.map(([fs, fe]) => {
      const fr = new Reader(bytes, fs, fe);
      let id = null;
      let kind = 0;
      let tagIdx = [];
      let geom = [];
      for (const [f, t] of fr.fields()) {
        if (f === 1) id = fr.varint();
        else if (f === 2) tagIdx = fr.packed();
        else if (f === 3) kind = fr.varint();
        else if (f === 4) geom = fr.packed();
        else fr.skip(t);
      }
      const tags = {};
      for (let k = 0; k + 1 < tagIdx.length; k += 2) tags[keys[tagIdx[k]]] = values[tagIdx[k + 1]];
      return { id, type: TYPES[kind], tags, parts: readGeometry(geom) };
    });
    layers[name] = { extent, features };
  }
  return layers;
}

// --- from the OpenMapTiles schema to OpenStreetMap tags ---

// The rest of the app reads OpenStreetMap-style data (what the Overpass API
// returns), so tile features are turned back into elements with the tags they
// came from, as near as the schema allows.

const SHOPS = new Set(['shop', 'clothing_store', 'grocery', 'bakery', 'butcher', 'books', 'florist', 'gift', 'hairdresser', 'jewelry', 'laundry', 'mobile_phone', 'optician', 'pharmacy', 'shoes', 'convenience', 'supermarket', 'alcohol_shop', 'beauty', 'pet', 'toys', 'music', 'furniture', 'hardware', 'stationery', 'bicycle', 'deli', 'department_store']);
const PATH_KINDS = new Set(['footway', 'cycleway', 'path', 'steps', 'pedestrian', 'bridleway', 'corridor', 'track']);

function tagsFor(layer, t, type) {
  switch (layer) {
    case 'building': return t.hide_3d ? null : { building: 'yes', ...(t.render_height ? { height: String(t.render_height) } : {}) };
    case 'transportation': {
      if (t.brunnel === 'tunnel') return null;
      const cls = t.class;
      const sub = t.subclass;
      let highway = null;
      if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(cls)) highway = cls + (t.ramp ? '_link' : '');
      else if (cls === 'minor') highway = ['residential', 'unclassified', 'living_street', 'road'].includes(sub) ? sub : 'residential';
      else if (cls === 'service') highway = 'service';
      else if (cls === 'track') highway = 'track';
      else if (cls === 'path') highway = PATH_KINDS.has(sub) ? sub : 'footway';
      else if (cls === 'rail' || cls === 'transit') return type === 'line' ? { railway: 'rail' } : null;
      if (!highway) return null;
      const tags = { highway };
      if (type === 'polygon') tags.area = 'yes';
      if (t.surface === 'unpaved' && cls !== 'path') tags.surface = 'unpaved';
      return tags;
    }
    case 'landuse': {
      const c = t.class;
      if (['residential', 'commercial', 'retail', 'industrial', 'railway', 'cemetery', 'garages'].includes(c)) return { landuse: c === 'garages' ? 'industrial' : c };
      if (c === 'pitch' || c === 'playground' || c === 'track') return { leisure: c };
      if (c === 'stadium') return { leisure: 'pitch' };
      return null;
    }
    case 'landcover': {
      const c = t.class;
      const s = t.subclass;
      if (c === 'wood') return { natural: 'wood' };
      if (c === 'sand') return s === 'beach' ? { natural: 'beach' } : { natural: 'sand' };
      if (c === 'farmland') return { landuse: 'farmland' };
      if (c === 'grass' || c === 'wetland') {
        if (s === 'park' || s === 'garden' || s === 'recreation_ground' || s === 'village_green') return { leisure: 'park' };
        return { landuse: 'grass' };
      }
      return null;
    }
    case 'park': return ['park', 'garden', 'nature_reserve'].includes(t.class) ? { leisure: 'park' } : null;
    case 'water': return t.brunnel === 'tunnel' ? null : { natural: 'water' };
    case 'waterway': return t.brunnel === 'tunnel' ? null : { waterway: ['river', 'canal', 'stream', 'ditch', 'drain'].includes(t.class) ? t.class : 'stream' };
    case 'poi': {
      const c = t.class;
      const s = t.subclass;
      const name = t.name ? { name: t.name } : {};
      if (['cafe', 'restaurant', 'ice_cream', 'fountain', 'drinking_water', 'bench'].includes(s)) return { amenity: s, ...name };
      if (s === 'playground' || s === 'dog_park') return { leisure: s, ...name };
      if (c === 'cafe' || c === 'restaurant' || c === 'ice_cream') return { amenity: c, ...name };
      if (SHOPS.has(c)) return { shop: s ?? c, ...name };
      return null;
    }
    default: return null;
  }
}

const LAYERS = ['landcover', 'landuse', 'park', 'water', 'waterway', 'transportation', 'building', 'poi'];

// A decoded tile at zoom `z`, column `x`, row `y` as OpenStreetMap-style
// elements, with points as { lat, lon }. Ids are made from the tile and the
// feature's place in it, so they stay the same each time it's read.
export function tileElements(layers, z, x, y) {
  const n = 2 ** z;
  const elements = [];
  for (const name of LAYERS) {
    const layer = layers[name];
    if (!layer) continue;
    const ext = layer.extent;
    const at = ([px, py]) => {
      const lon = ((x + px / ext) / n) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / ext)) / n))) * 180) / Math.PI;
      return { lat, lon };
    };
    layer.features.forEach((f, i) => {
      const tags = tagsFor(name, f.tags, f.type);
      if (!tags) return;
      const id = `${z}/${x}/${y}/${name}/${f.id ?? i}`;
      if (f.type === 'point') {
        // Each point is a part of its own.
        f.parts.forEach((p, k) => elements.push({ type: 'node', id: f.parts.length > 1 ? `${id}/${k}` : id, tags, ...at(p[0]) }));
      } else if (f.type === 'line') {
        f.parts.forEach((p, k) => { if (p.length >= 2) elements.push({ type: 'way', id: `${id}/${k}`, tags, geometry: p.map(at) }); });
      } else if (f.type === 'polygon') {
        // Outer rings only (holes are rare at this size): in tile pixels, with y
        // down, an outer ring has a positive area.
        f.parts.forEach((ring, k) => {
          let area = 0;
          for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) area += ring[b][0] * ring[a][1] - ring[a][0] * ring[b][1];
          if (area > 0 && ring.length >= 4) elements.push({ type: 'way', id: `${id}/${k}`, tags, geometry: ring.map(at) });
        });
      }
    });
  }
  return elements;
}

// The tiles at zoom `z` covering a box [south, west, north, east].
export function tilesFor([south, west, north, east], z) {
  const n = 2 ** z;
  const tx = (lon) => Math.floor(((lon + 180) / 360) * n);
  const ty = (lat) => Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
  const out = [];
  for (let x = tx(west); x <= tx(east); x++) for (let y = ty(north); y <= ty(south); y++) out.push([x, y]);
  return out;
}
