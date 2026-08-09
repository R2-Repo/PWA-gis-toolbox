/**
 * Web Worker — builds MVT tiles for heavy workspace layers on demand.
 *
 * Reads the shared workspace IndexedDB (chunks + grid spatial index snapshot)
 * read-only, selects the features intersecting a requested tile with bounded
 * budgets, and encodes MVT bytes (geojson-vt + vt-pbf). The main thread's
 * gis-tiles:// MapLibre protocol proxies tile requests here.
 */
import { GridSpatialIndex } from '../workspace/spatial-index.js';
import { tileToBBox, padBBox } from '../map/tiles/tile-math.js';
import { selectTileFeatures, selectChunksForTile } from '../map/tiles/tile-feature-select.js';
import { buildTileFromFeatures } from '../map/tiles/tile-builder.js';
import {
    TILE_BUFFER,
    TILE_EXTENT,
    TILE_CHUNK_CACHE_SIZE,
    MAX_CHUNKS_PER_TILE,
    MAX_TILE_FEATURES
} from '../map/tiles/tile-constants.js';

const DB_NAME = 'gis-toolbox-workspace';
/** Keep in sync with js/workspace/workspace-store.js (worker never upgrades). */
const DB_VERSION = 2;
const STORE_CHUNKS = 'chunks';
const STORE_INDEX = 'spatial_index';

let dbPromise = null;
/** @type {GridSpatialIndex|null} */
let spatialIndex = null;
/** @type {Map<string, object[]>} LRU: chunkId -> parsed features */
const chunkCache = new Map();

function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // Never upgrade from the worker — the main thread owns the schema.
        req.onupgradeneeded = () => { /* same version; no-op */ };
    });
    return dbPromise;
}

function idbGet(db, store, key) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function getSpatialIndex() {
    if (spatialIndex) return spatialIndex;
    const db = await openDB();
    const rec = await idbGet(db, STORE_INDEX, 'main');
    spatialIndex = GridSpatialIndex.fromJSON(rec?.data || { chunks: [] });
    return spatialIndex;
}

async function loadChunkFeatures(chunkId) {
    if (chunkCache.has(chunkId)) {
        // LRU touch
        const features = chunkCache.get(chunkId);
        chunkCache.delete(chunkId);
        chunkCache.set(chunkId, features);
        return features;
    }
    const db = await openDB();
    const rec = await idbGet(db, STORE_CHUNKS, chunkId);
    let features = [];
    if (rec?.geojson) {
        try {
            features = JSON.parse(rec.geojson).features || [];
        } catch { /* corrupt chunk — render without it */ }
    }
    chunkCache.set(chunkId, features);
    while (chunkCache.size > TILE_CHUNK_CACHE_SIZE) {
        chunkCache.delete(chunkCache.keys().next().value);
    }
    return features;
}

function invalidate(layerId) {
    spatialIndex = null;
    if (!layerId) {
        chunkCache.clear();
        return;
    }
    for (const key of [...chunkCache.keys()]) {
        if (key.startsWith(`${layerId}:`)) chunkCache.delete(key);
    }
}

async function buildTile(layerId, z, x, y) {
    const index = await getSpatialIndex();
    const tileBbox = padBBox(tileToBBox(z, x, y), TILE_BUFFER / TILE_EXTENT);
    const chunkIds = index.query(tileBbox, layerId);
    if (!chunkIds.length) return null;

    // Rank by overlap with this tile so huge long-line chunk bboxes do not
    // consume the load budget before local geometry is considered.
    const chunkRecords = chunkIds.map((chunkId) => {
        const rec = index.chunks.get(chunkId);
        return {
            chunkId,
            bbox: rec?.bbox,
            featureCount: rec?.featureCount || 0
        };
    });
    const { chunkIds: selectedIds } = selectChunksForTile(chunkRecords, tileBbox, {
        maxFeatures: MAX_TILE_FEATURES,
        maxChunks: MAX_CHUNKS_PER_TILE
    });

    // selectedIds are already ranked by tile overlap (local chunks first).
    const loaded = [];
    for (const chunkId of selectedIds) {
        loaded.push({ features: await loadChunkFeatures(chunkId) });
    }

    const { features } = selectTileFeatures(loaded, tileBbox, z);
    return buildTileFromFeatures(features, z, x, y);
}

self.onmessage = (event) => {
    const msg = event.data || {};

    if (msg.type === 'invalidate') {
        invalidate(msg.layerId || null);
        return;
    }

    if (msg.type === 'tile') {
        const { reqId, layerId, z, x, y } = msg;
        buildTile(layerId, z, x, y)
            .then((bytes) => {
                if (bytes) {
                    // Copy into a transferable buffer (vt-pbf may return a view).
                    const buffer = bytes.buffer.byteLength === bytes.byteLength
                        ? bytes.buffer
                        : bytes.slice().buffer;
                    self.postMessage({ type: 'tile', reqId, buffer }, [buffer]);
                } else {
                    self.postMessage({ type: 'tile', reqId, buffer: null });
                }
            })
            .catch((error) => {
                self.postMessage({
                    type: 'tile',
                    reqId,
                    error: error?.message || String(error)
                });
            });
    }
};
