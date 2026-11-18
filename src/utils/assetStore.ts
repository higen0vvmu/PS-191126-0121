import type { CatalogTemplate, FurnitureInstance, Project } from '../types/plan';

const DB_NAME = 'plan_studio_assets_v1';
const STORE_NAME = 'glb_assets';

const memCache = new Map<string, string>();
const listeners = new Set<(assetId: string) => void>();

export function subscribeAssetLoaded(cb: (assetId: string) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function notifyAssetLoaded(assetId: string): void {
  for (const cb of listeners) {
    try {
      cb(assetId);
    } catch {
      // ignore listener errors
    }
  }
}

export function fastHashString(input: string): string {
  // Dual 32-bit FNV-1a hash producing a compact 16-char hex digest
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  const step = input.length > 65536 ? Math.ceil(input.length / 65536) : 1;
  for (let i = 0; i < input.length; i += step) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}_${input.length.toString(36)}`;
}

export async function hashContentId(dataUrl: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const encoded = new TextEncoder().encode(dataUrl);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      const bytes = Array.from(new Uint8Array(digest));
      const hex = bytes
        .slice(0, 16)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `glb_${hex}`;
    }
  } catch {
    // Fallback below
  }
  return `glb_${fastHashString(dataUrl)}`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openAssetDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openAssetDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPut(key: string, value: string): Promise<void> {
  const db = await openAssetDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function putGlbAsset(dataUrl: string, explicitId?: string): Promise<string> {
  const assetId = explicitId || (await hashContentId(dataUrl));
  const alreadyCached = memCache.get(assetId) === dataUrl;
  memCache.set(assetId, dataUrl);
  await idbPut(assetId, dataUrl);
  if (!alreadyCached) {
    notifyAssetLoaded(assetId);
  }
  return assetId;
}

export function putGlbAssetSync(dataUrl: string, explicitId?: string): string {
  const assetId = explicitId || `glb_${fastHashString(dataUrl)}`;
  memCache.set(assetId, dataUrl);
  void idbPut(assetId, dataUrl);
  return assetId;
}

export async function getGlbAsset(assetId?: string, fallbackDataUrl?: string): Promise<string | null> {
  if (assetId) {
    const cached = memCache.get(assetId);
    if (cached) return cached;
    const fromDb = await idbGet(assetId);
    if (fromDb) {
      memCache.set(assetId, fromDb);
      notifyAssetLoaded(assetId);
      return fromDb;
    }
  }
  if (fallbackDataUrl) {
    if (assetId) {
      memCache.set(assetId, fallbackDataUrl);
      void idbPut(assetId, fallbackDataUrl);
    }
    return fallbackDataUrl;
  }
  return null;
}

export function getGlbAssetSync(assetId?: string, fallbackDataUrl?: string): string | null {
  if (assetId) {
    const cached = memCache.get(assetId);
    if (cached) return cached;
    if (fallbackDataUrl) {
      memCache.set(assetId, fallbackDataUrl);
      void idbPut(assetId, fallbackDataUrl);
      return fallbackDataUrl;
    }
    // Kick off background hydration from IndexedDB
    void getGlbAsset(assetId);
    return null;
  }
  return fallbackDataUrl ?? null;
}

export function clearMemoryAssetCacheForTest(): void {
  memCache.clear();
}

export function stripInlineGlbForStorage(project: Project): Project {
  // Never store giant glbDataUrl blobs in localStorage when glbAssetId is available
  // (IndexedDB holds the binary payload; representation SVGs remain directly on each object).
  const stripFurn = (f: FurnitureInstance): FurnitureInstance => {
    if (!f.glbDataUrl) return f;
    const assetId = f.glbAssetId || putGlbAssetSync(f.glbDataUrl);
    const { glbDataUrl: _omit, ...rest } = f;
    return { ...rest, glbAssetId: assetId };
  };
  const stripTpl = (t: CatalogTemplate): CatalogTemplate => {
    if (!t.glbDataUrl) return t;
    const assetId = t.glbAssetId || putGlbAssetSync(t.glbDataUrl);
    const { glbDataUrl: _omit, ...rest } = t;
    return { ...rest, glbAssetId: assetId };
  };

  return {
    ...project,
    embeddedAssets: undefined,
    customLibrary: (project.customLibrary ?? []).map(stripTpl),
    levels: project.levels.map((lvl) => ({
      ...lvl,
      furniture: (lvl.furniture ?? []).map(stripFurn),
    })),
  };
}

export async function bundleProjectAssets(project: Project): Promise<Project> {
  const assets: Record<string, string> = { ...(project.embeddedAssets ?? {}) };
  const idsToResolve = new Set<string>();

  const registerItem = async (item: { glbAssetId?: string; glbDataUrl?: string }) => {
    if (item.glbDataUrl) {
      const id = item.glbAssetId || (await putGlbAsset(item.glbDataUrl));
      assets[id] = item.glbDataUrl;
      return id;
    }
    if (item.glbAssetId) {
      idsToResolve.add(item.glbAssetId);
      return item.glbAssetId;
    }
    return undefined;
  };

  for (const tpl of project.customLibrary ?? []) {
    const id = await registerItem(tpl);
    if (id && !tpl.glbAssetId) tpl.glbAssetId = id;
  }
  for (const lvl of project.levels ?? []) {
    for (const f of lvl.furniture ?? []) {
      const id = await registerItem(f);
      if (id && !f.glbAssetId) f.glbAssetId = id;
    }
  }

  for (const id of idsToResolve) {
    if (!assets[id]) {
      const dataUrl = await getGlbAsset(id);
      if (dataUrl) assets[id] = dataUrl;
    }
  }

  return {
    ...stripInlineGlbForStorage(project),
    embeddedAssets: Object.keys(assets).length > 0 ? assets : undefined,
  };
}

export async function hydrateProjectAssets(project: Project): Promise<Project> {
  if (project.embeddedAssets) {
    for (const [assetId, dataUrl] of Object.entries(project.embeddedAssets)) {
      if (typeof dataUrl === 'string' && dataUrl.length > 0) {
        await putGlbAsset(dataUrl, assetId);
      }
    }
  }

  const hydrateFurn = async (f: FurnitureInstance): Promise<FurnitureInstance> => {
    if (f.glbDataUrl) {
      const assetId = await putGlbAsset(f.glbDataUrl, f.glbAssetId);
      const { glbDataUrl: _omit, ...rest } = f;
      return { ...rest, glbAssetId: assetId };
    }
    if (f.glbAssetId) {
      await getGlbAsset(f.glbAssetId);
    }
    return f;
  };

  const hydrateTpl = async (t: CatalogTemplate): Promise<CatalogTemplate> => {
    if (t.glbDataUrl) {
      const assetId = await putGlbAsset(t.glbDataUrl, t.glbAssetId);
      const { glbDataUrl: _omit, ...rest } = t;
      return { ...rest, glbAssetId: assetId };
    }
    if (t.glbAssetId) {
      await getGlbAsset(t.glbAssetId);
    }
    return t;
  };

  const customLibrary = await Promise.all((project.customLibrary ?? []).map(hydrateTpl));
  const levels = await Promise.all(
    (project.levels ?? []).map(async (lvl) => ({
      ...lvl,
      furniture: await Promise.all((lvl.furniture ?? []).map(hydrateFurn)),
    }))
  );

  return {
    ...project,
    embeddedAssets: undefined,
    customLibrary,
    levels,
  };
}
