/**
 * MapLibre pmtiles:// protocol for the window that owns the map.
 * HTTP(S) archives are fetched by that window. Blob URLs cannot cross a
 * pop-out, so those bytes are stored in IndexedDB under idb:<key> and both
 * windows read the same archive.
 */
import { PMTiles, Protocol } from 'pmtiles';

const DB_NAME = 'gis-toolbox-pmtiles';
const DB_VERSION = 1;
const STORE = 'archives';

/** @type {Protocol | null} */
let protocol = null;
let registered = false;

/** @type {Map<string, ArrayBuffer>} */
const memoryCache = new Map();

/**
 * @param {string} url
 * @returns {string}
 */
export function barePmtilesUrl(url) {
    const text = String(url || '').trim();
    if (text.startsWith('pmtiles://')) return text.slice('pmtiles://'.length);
    return text;
}

/**
 * @param {string} url
 * @returns {string}
 */
export function absolutePmtilesUrl(url) {
    const bare = barePmtilesUrl(url);
    if (!bare) return '';
    if (
        bare.startsWith('idb:')
        || bare.startsWith('blob:')
        || bare.startsWith('http://')
        || bare.startsWith('https://')
    ) {
        return bare;
    }
    if (bare.startsWith('/') && typeof location !== 'undefined' && location.origin) {
        return `${location.origin}${bare}`;
    }
    return bare;
}

/**
 * @param {object | null | undefined} dataset
 * @returns {string}
 */
export function pmtilesDatasetUrl(dataset) {
    const raw = dataset?.pmtiles?.url || (dataset?.source?.format === 'pmtiles' ? dataset?.source?.url : '') || '';
    return absolutePmtilesUrl(raw);
}

function openDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB is not available'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('PMTiles store failed to open'));
    });
}

/**
 * @param {string} key
 * @param {ArrayBuffer} bytes
 */
export async function putPmtilesArchive(key, bytes) {
    const copy = bytes.slice(0);
    memoryCache.set(key, copy);
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(copy, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('PMTiles store write failed'));
    });
    db.close();
}

/**
 * @param {string} key
 * @returns {Promise<ArrayBuffer>}
 */
export async function readPmtilesArchive(key) {
    if (memoryCache.has(key)) return memoryCache.get(key);
    const db = await openDb();
    const bytes = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error('PMTiles store read failed'));
    });
    db.close();
    if (!bytes) throw new Error(`PMTiles archive not found (${key})`);
    const copy = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    memoryCache.set(key, copy);
    return copy;
}

class IdbPmTilesSource {
    /**
     * @param {string} key
     */
    constructor(key) {
        this.key = key;
    }

    getKey() {
        return `idb:${this.key}`;
    }

    /**
     * @param {number} offset
     * @param {number} length
     */
    async getBytes(offset, length) {
        const buf = await readPmtilesArchive(this.key);
        const start = Math.max(0, offset);
        const end = Math.min(buf.byteLength, start + length);
        return { data: buf.slice(start, end) };
    }
}

/**
 * Register pmtiles:// once in this window. Safe to call more than once.
 * @returns {Protocol | null}
 */
export function ensurePmtilesProtocol() {
    if (registered) return protocol;
    const maplibre = globalThis.maplibregl;
    if (typeof maplibre?.addProtocol !== 'function') return null;
    protocol = new Protocol({ metadata: true });
    maplibre.addProtocol('pmtiles', protocol.tile);
    registered = true;
    return protocol;
}

/**
 * @param {string} url absolute http(s) URL or idb:<key>
 * @returns {Promise<PMTiles | null>}
 */
export async function openPmtilesArchive(url) {
    const proto = ensurePmtilesProtocol();
    if (!proto) return null;
    const bare = absolutePmtilesUrl(url);
    if (!bare) return null;
    const existing = proto.get(bare);
    if (existing) return existing;
    const archive = bare.startsWith('idb:')
        ? new PMTiles(new IdbPmTilesSource(bare.slice(4)))
        : new PMTiles(bare);
    proto.add(archive);
    return archive;
}

/**
 * Copy a blob: archive into the shared store and point the dataset at idb:<key>.
 * HTTP(S) URLs are left for the pop-out to fetch itself.
 * @param {object | null | undefined} dataset
 * @returns {Promise<object | null | undefined>}
 */
export async function publishPmtilesDataset(dataset) {
    if (!dataset) return dataset;
    const current = pmtilesDatasetUrl(dataset);
    if (!current.startsWith('blob:')) return dataset;
    const key = String(dataset.pmtiles?.archiveKey || dataset.id || '').trim();
    if (!key) return dataset;
    const res = await fetch(current);
    if (res && res.ok === false) throw new Error(`PMTiles blob fetch failed (${res.status})`);
    const bytes = await res.arrayBuffer();
    await putPmtilesArchive(key, bytes);
    const nextUrl = `idb:${key}`;
    dataset.pmtiles = { ...(dataset.pmtiles || {}), url: nextUrl, archiveKey: key };
    dataset.source = {
        ...(dataset.source || {}),
        format: 'pmtiles',
        url: nextUrl
    };
    if (!dataset.type) dataset.type = 'pmtiles';
    return dataset;
}

/**
 * @param {string} url
 * @returns {string}
 */
export function pmtilesSourceUrl(url) {
    const bare = absolutePmtilesUrl(url);
    return bare ? `pmtiles://${bare}` : '';
}
