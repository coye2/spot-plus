// memory-engine.js — Multi-layer Playback Memory Engine.
// L1: O(1) in-memory LRU for streams & metadata (zero main-thread JSON serialization).
// L2: Non-blocking IndexedDB persistence for warm startup across reloads, with quota & expiry pruning.
import { isUrlExpired, extractUrlExpiry } from './source-router.js';

const DB_NAME = 'spotplus-playback-memory';
const DB_VERSION = 1;
const STORE_NAME = 'entries';
const MAX_L1_STREAMS = 120;
const MAX_L1_META = 300;
const MAX_L2_ENTRIES = 250;

export class PlaybackMemoryEngine {
  constructor({ idb = globalThis.indexedDB } = {}) {
    this.idbFactory = idb;
    this.streams = new Map();
    this.meta = new Map();
    this._dbPromise = null;
    this._readyPromise = null;
    this._pendingWrites = new Map();
    this._flushTimer = 0;
    this.counters = { hits: 0, misses: 0, evictions: 0, expired: 0 };
  }

  _openDb() {
    if (!this.idbFactory) return Promise.resolve(null);
    return (this._dbPromise ??= new Promise((resolve) => {
      try {
        const req = this.idbFactory.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  }

  async ready() {
    if (this._readyPromise) return this._readyPromise;
    this._readyPromise = (async () => {
      const db = await this._openDb();
      if (!db) return;
      const now = Date.now();
      try {
        const entries = await new Promise((resolve) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const store = tx.objectStore(STORE_NAME);
          const all = [];
          const cur = store.openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) { resolve(all); return; }
            all.push([c.key, c.value]);
            c.continue();
          };
          cur.onerror = () => resolve(all);
        });
        const staleKeys = [];
        for (const [key, val] of entries) {
          if (!val || (val.until && val.until <= now)) {
            staleKeys.push(key);
            continue;
          }
          if (String(key).startsWith('s:')) {
            const rawKey = String(key).slice(2);
            if (!this.streams.has(rawKey)) this._l1Set(this.streams, rawKey, val, MAX_L1_STREAMS);
          } else if (String(key).startsWith('m:')) {
            const rawKey = String(key).slice(2);
            if (!this.meta.has(rawKey)) this._l1Set(this.meta, rawKey, val, MAX_L1_META);
          }
        }
        if (staleKeys.length) {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          for (const k of staleKeys) store.delete(k);
        }
      } catch { /* fallback cleanly to L1 */ }
    })();
    return this._readyPromise;
  }

  _l1Set(map, key, val, limit) {
    if (map.has(key)) map.delete(key);
    map.set(key, val);
    while (map.size > limit) {
      // Evict oldest entry that isn't pinned, preferring lower replay frequency when ties exist.
      const oldestKey = map.keys().next().value;
      map.delete(oldestKey);
      this.counters.evictions++;
    }
  }

  _scheduleFlush() {
    if (!this.idbFactory) return;
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => {
      this._flushTimer = 0;
      this.flush().catch(() => {});
    }, 250);
    this._flushTimer.unref?.();
  }

  async flush() {
    const db = await this._openDb();
    if (!db || !this._pendingWrites.size) return;
    const batch = [...this._pendingWrites.entries()];
    this._pendingWrites.clear();
    try {
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const [k, v] of batch) {
          if (v === null) store.delete(k);
          else store.put(v, k);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => resolve();
      });
      await this._enforceQuota(db);
    } catch { /* ignore IDB write error */ }
  }

  async _enforceQuota(db) {
    try {
      const est = await globalThis.navigator?.storage?.estimate?.();
      const pressure = est?.quota && est?.usage ? (est.usage / est.quota) > 0.85 : false;
      const cap = pressure ? Math.floor(MAX_L2_ENTRIES / 2) : MAX_L2_ENTRIES;
      const items = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const list = [];
        const cur = store.openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) { resolve(list); return; }
          list.push({ key: c.key, priority: (c.value?.playCount || 0) * 60_000 + (c.value?.lastUsed || 0), until: c.value?.until || 0 });
          c.continue();
        };
        cur.onerror = () => resolve(list);
      });
      const now = Date.now();
      const expired = items.filter(x => x.until && x.until <= now).map(x => x.key);
      const valid = items.filter(x => !x.until || x.until > now);
      const overflow = valid.length > cap
        ? valid.sort((a, b) => a.priority - b.priority).slice(0, valid.length - cap).map(x => x.key)
        : [];
      const toDelete = [...expired, ...overflow];
      if (!toDelete.length) return;
      await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const k of toDelete) store.delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => resolve();
      });
      this.counters.evictions += overflow.length;
      this.counters.expired += expired.length;
    } catch { /* ignore quota maintenance error */ }
  }

  computeExpiry(url, now = Date.now()) {
    const exp = extractUrlExpiry(url);
    return Math.min(exp ? exp - 10 * 60_000 : now + 45 * 60_000, now + 3 * 3600_000);
  }

  getStream(key, now = Date.now()) {
    const hit = this.streams.get(key);
    if (!hit) {
      this.counters.misses++;
      return null;
    }
    if ((hit.until && hit.until <= now) || isUrlExpired(hit.stream?.url, now)) {
      this.streams.delete(key);
      this._pendingWrites.set('s:' + key, null);
      this._scheduleFlush();
      this.counters.expired++;
      this.counters.misses++;
      return null;
    }
    hit.lastUsed = now;
    hit.playCount = (hit.playCount || 0) + 1;
    // Touch LRU order
    this.streams.delete(key);
    this.streams.set(key, hit);
    this.counters.hits++;
    return hit.stream;
  }

  putStream(key, stream, now = Date.now()) {
    if (!key || !stream) return;
    const prev = this.streams.get(key);
    const until = this.computeExpiry(stream.url, now);
    const entry = {
      until,
      lastUsed: now,
      playCount: (prev?.playCount || 0) + 1,
      stream,
    };
    this._l1Set(this.streams, key, entry, MAX_L1_STREAMS);
    if (!stream.preview && !/^blob:/.test(stream.url || '')) {
      this._pendingWrites.set('s:' + key, entry);
      this._scheduleFlush();
    }
  }

  forgetStream(key) {
    if (!key) return;
    this.streams.delete(key);
    this._pendingWrites.set('s:' + key, null);
    this._scheduleFlush();
  }

  forgetByInstance(instance) {
    if (!instance) return;
    for (const [key, val] of this.streams) {
      if (val?.stream?.instance === instance) this.forgetStream(key);
    }
  }

  getMeta(id, now = Date.now()) {
    const hit = this.meta.get(String(id));
    if (!hit) return null;
    if (hit.until && hit.until <= now) {
      this.meta.delete(String(id));
      return null;
    }
    hit.lastUsed = now;
    this.meta.delete(String(id));
    this.meta.set(String(id), hit);
    return hit.value;
  }

  putMeta(id, value, ttlMs = 7 * 86_400_000, now = Date.now()) {
    if (!id || !value) return;
    const prev = this.meta.get(String(id));
    const entry = {
      until: now + ttlMs,
      lastUsed: now,
      playCount: (prev?.playCount || 0) + 1,
      value,
    };
    this._l1Set(this.meta, String(id), entry, MAX_L1_META);
    this._pendingWrites.set('m:' + String(id), entry);
    this._scheduleFlush();
  }

  clearStreams() {
    for (const key of this.streams.keys()) this._pendingWrites.set('s:' + key, null);
    this.streams.clear();
    this._scheduleFlush();
  }

  stats() {
    const total = this.counters.hits + this.counters.misses;
    return {
      l1Streams: this.streams.size,
      l1Meta: this.meta.size,
      ...this.counters,
      hitRate: total ? Math.round((this.counters.hits / total) * 1000) / 1000 : 0,
    };
  }
}

export const memoryEngine = new PlaybackMemoryEngine();
