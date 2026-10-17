// Photos of the owner's places, the pet's custom voice clips and other
// pictures the owner adds, kept in this browser's IndexedDB. Falls back to
// memory when storage is blocked.

const DB_NAME = 'ai-pet-media';
const STORES = ['places', 'voices', 'assets'];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export class MediaStore {
  constructor() {
    this.memory = { places: new Map(), voices: new Map() };
    this.ready = openDb().then((db) => { this.db = db; }).catch(() => { this.db = null; });
  }

  get persistent() { return Boolean(this.db); }

  async all(store) {
    await this.ready;
    if (!this.db) return [...this.memory[store].values()];
    return run(this.db, store, 'readonly', (s) => s.getAll());
  }

  async put(store, record) {
    await this.ready;
    if (!this.db) { this.memory[store].set(record.id, record); return; }
    await run(this.db, store, 'readwrite', (s) => s.put(record));
  }

  async remove(store, id) {
    await this.ready;
    if (!this.db) { this.memory[store].delete(id); return; }
    await run(this.db, store, 'readwrite', (s) => s.delete(id));
  }
}

// Shrink a photo to a size that keeps storage small and drawing fast.
export async function photoToBlob(file, maxW = 1600, maxH = 900, type = 'image/jpeg') {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a photo this browser can open.'));
      i.src = url;
    });
    const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, type, 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}
