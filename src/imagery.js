// Satellite photos for route walks. They come from a map company and need a
// key, which the owner gets for free and pastes in once; it stays in this
// browser. Esri (ArcGIS Location Platform): free tier of 2 million tiles a
// month, no card needed. Google (Map Tiles API): 100,000 tiles a month free,
// with a billing account.

export const PROVIDERS = {
  esri: { name: 'Esri', signup: 'https://location.arcgis.com/' },
  google: { name: 'Google', signup: 'https://developers.google.com/maps/documentation/tile/satellite' },
};

// Loads one small tile to check the key works.
function tryTile(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = resolve;
    img.onerror = () => reject(new Error('That key didn’t work for satellite photos. Check it has access to basemaps or map tiles, and that this website is allowed to use it.'));
    img.src = url;
  });
}

// A photo source for map-art.js's setImagery: { tileUrl(z, x, y), maxZoom, credit }.
export async function imagerySource({ provider, key }) {
  const k = encodeURIComponent(key.trim());
  if (provider === 'esri') {
    const tileUrl = (z, x, y) => `https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}?token=${k}`;
    await tryTile(tileUrl(1, 0, 0));
    return { tileUrl, maxZoom: 19, credit: 'Powered by Esri · Esri, Maxar, Earthstar Geographics, and the GIS User Community' };
  }
  if (provider === 'google') {
    // Google hands out a session for the kind of map wanted, then serves tiles for it.
    let res;
    try {
      res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${k}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapType: 'satellite', language: 'en-US', region: 'US' }),
      });
    } catch {
      throw new Error('Couldn’t reach Google’s map tiles. Check your connection.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.session) throw new Error(`Google didn’t accept that key${data.error?.message ? `: ${data.error.message}` : '.'}`);
    const tileUrl = (z, x, y) => `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${data.session}&key=${k}`;
    return { tileUrl, maxZoom: 20, credit: 'Google · Imagery ©Google' };
  }
  throw new Error('Pick a photo service.');
}
