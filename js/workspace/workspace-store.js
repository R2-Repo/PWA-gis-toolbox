/**
 * IndexedDB workspace — chunked feature storage for large layers.
 */
import { GridSpatialIndex, bboxFromFeatures } from './spatial-index.js';
import { filterProperties } from '../import/import-field-filter.js';

const DB_NAME = 'gis-toolbox-workspace';
const DB_VERSION = 1;
const STORE_LAYERS = 'layers';
const STORE_CHUNKS = 'chunks';
const STORE_ATTRIBUTES = 'attributes';
const STORE_INDEX = 'spatial_index';

/** Feature count above which imports use workspace storage. */
export const WORKSPACE_FEATURE_THRESHOLD = 15_000;

export const WORKSPACE_CHUNK_SIZE = 1000;

let db = null;
/** @type {GridSpatialIndex|null} */
let spatialIndex = null;
let _indexDirty = false;
let _indexSaveTimer = null;

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) { resolve(db); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const idb = e.target.result;
            if (!idb.objectStoreNames.contains(STORE_LAYERS)) {
                idb.createObjectStore(STORE_LAYERS, { keyPath: 'id' });
            }
            if (!idb.objectStoreNames.contains(STORE_CHUNKS)) {
                idb.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
            }
            if (!idb.objectStoreNames.contains(STORE_ATTRIBUTES)) {
                idb.createObjectStore(STORE_ATTRIBUTES, { keyPath: 'id' });
            }
            if (!idb.objectStoreNames.contains(STORE_INDEX)) {
                idb.createObjectStore(STORE_INDEX, { keyPath: 'key' });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

async function _getSpatialIndex() {
    if (spatialIndex) return spatialIndex;
    const idb = await openDB();
    const tx = idb.transaction(STORE_INDEX, 'readonly');
    const rec = await new Promise((resolve, reject) => {
        const r = tx.objectStore(STORE_INDEX).get('main');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    spatialIndex = GridSpatialIndex.fromJSON(rec?.data || { chunks: [] });
    return spatialIndex;
}

async function _saveSpatialIndexNow() {
    if (!spatialIndex) return;
    const idb = await openDB();
    const tx = idb.transaction(STORE_INDEX, 'readwrite');
    tx.objectStore(STORE_INDEX).put({ key: 'main', data: spatialIndex.toJSON() });
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    _indexDirty = false;
}

/** Debounced spatial index persist — avoids rewriting the full index every batch. */
export function markSpatialIndexDirty() {
    _indexDirty = true;
    if (_indexSaveTimer) return;
    _indexSaveTimer = setTimeout(() => {
        _indexSaveTimer = null;
        if (_indexDirty) {
            void _saveSpatialIndexNow().catch((err) => {
                console.error('[Workspace] Spatial index save failed:', err);
            });
        }
    }, 300);
}

/** Flush pending spatial index writes (call after large imports). */
export async function flushSpatialIndexSave() {
    if (_indexSaveTimer) {
        clearTimeout(_indexSaveTimer);
        _indexSaveTimer = null;
    }
    if (!_indexDirty) return;
    await _saveSpatialIndexNow();
}

function _featureId(layerId, index) {
    return `${layerId}:f:${index}`;
}

/**
 * @param {object} meta
 */
export async function createWorkspaceLayer(meta) {
    const idb = await openDB();
    const layer = {
        id: meta.id,
        name: meta.name,
        type: 'spatial-chunked',
        storage: 'workspace',
        source: meta.source || {},
        featureCount: 0,
        chunkIds: [],
        schema: meta.schema || null,
        visible: true,
        active: true,
        created: new Date().toISOString()
    };
    const tx = idb.transaction(STORE_LAYERS, 'readwrite');
    tx.objectStore(STORE_LAYERS).put(layer);
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    return layer;
}

/**
 * Patch a workspace layer record (e.g. final schema/name after a streaming import).
 * @param {string} layerId
 * @param {object} patch
 */
export async function updateWorkspaceLayerMeta(layerId, patch) {
    const idb = await openDB();
    const tx = idb.transaction(STORE_LAYERS, 'readwrite');
    const store = tx.objectStore(STORE_LAYERS);
    const req = store.get(layerId);
    await new Promise((resolve, reject) => {
        req.onsuccess = () => {
            const layer = req.result;
            if (layer) store.put({ ...layer, ...patch });
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * @param {string} layerId
 * @param {import('geojson').Feature[]} features
 * @param {number} startIndex
 * @param {string[]|null} [selectedFields]
 */
export async function appendWorkspaceBatch(layerId, features, startIndex = 0, selectedFields = null) {
    if (!features?.length) return null;

    const idb = await openDB();
    const idx = await _getSpatialIndex();
    const chunkId = `${layerId}:c:${startIndex}`;
    const bbox = bboxFromFeatures(features);

    const attrRecords = [];
    const mapFeatures = features.map((f, i) => {
        const globalIndex = startIndex + i;
        const fid = _featureId(layerId, globalIndex);
        attrRecords.push({
            id: fid,
            layerId,
            featureIndex: globalIndex,
            properties: filterProperties(f.properties || {}, selectedFields)
        });
        return {
            type: 'Feature',
            id: globalIndex,
            geometry: f.geometry,
            properties: {
                _featureIndex: globalIndex,
                _datasetId: layerId,
                _featureId: fid,
                name: f.properties?.name ?? f.properties?.Name ?? null
            }
        };
    });

    const chunk = {
        id: chunkId,
        layerId,
        bbox,
        featureCount: features.length,
        startIndex,
        geojson: JSON.stringify({ type: 'FeatureCollection', features: mapFeatures })
    };

    const tx = idb.transaction([STORE_CHUNKS, STORE_ATTRIBUTES, STORE_LAYERS], 'readwrite');
    tx.objectStore(STORE_CHUNKS).put(chunk);
    for (const rec of attrRecords) {
        tx.objectStore(STORE_ATTRIBUTES).put(rec);
    }

    const layerStore = tx.objectStore(STORE_LAYERS);
    const layerReq = layerStore.get(layerId);
    await new Promise((resolve, reject) => {
        layerReq.onsuccess = () => {
            const layer = layerReq.result || { id: layerId, chunkIds: [], featureCount: 0 };
            layer.chunkIds = layer.chunkIds || [];
            layer.chunkIds.push(chunkId);
            layer.featureCount = (layer.featureCount || 0) + features.length;
            layerStore.put(layer);
        };
        layerReq.onerror = () => reject(layerReq.error);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    idx.insert(chunkId, layerId, bbox, features.length);
    markSpatialIndexDirty();
    return chunkId;
}

/**
 * @param {[number,number,number,number]} bounds
 * @param {string} layerId
 */
export async function queryWorkspaceChunks(bounds, layerId) {
    const idx = await _getSpatialIndex();
    return idx.query(bounds, layerId);
}

/**
 * @param {string[]} chunkIds
 */
export async function loadWorkspaceChunks(chunkIds) {
    const idb = await openDB();
    const tx = idb.transaction(STORE_CHUNKS, 'readonly');
    const store = tx.objectStore(STORE_CHUNKS);
    const chunks = [];
    for (const id of chunkIds) {
        const rec = await new Promise((resolve, reject) => {
            const r = store.get(id);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
        if (rec) chunks.push(rec);
    }
    return chunks;
}

/**
 * @param {string} layerId
 * @param {number} featureIndex
 */
export async function getWorkspaceFeatureAttributes(layerId, featureIndex) {
    const idb = await openDB();
    const tx = idb.transaction(STORE_ATTRIBUTES, 'readonly');
    const rec = await new Promise((resolve, reject) => {
        const r = tx.objectStore(STORE_ATTRIBUTES).get(_featureId(layerId, featureIndex));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    return rec?.properties || null;
}

/**
 * @param {string} layerId
 * @param {number} offset
 * @param {number} limit
 */
export async function iterateWorkspaceFeatures(layerId, offset = 0, limit = 1000) {
    const idb = await openDB();
    const layer = await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_LAYERS, 'readonly');
        const r = tx.objectStore(STORE_LAYERS).get(layerId);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    if (!layer?.chunkIds?.length) return [];

    const features = [];
    let skipped = 0;
    for (const chunkId of layer.chunkIds) {
        if (features.length >= limit) break;
        const chunk = await new Promise((resolve, reject) => {
            const tx = idb.transaction(STORE_CHUNKS, 'readonly');
            const r = tx.objectStore(STORE_CHUNKS).get(chunkId);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
        if (!chunk?.geojson) continue;
        const fc = JSON.parse(chunk.geojson);
        for (const f of fc.features || []) {
            if (skipped < offset) {
                skipped++;
                continue;
            }
            const idx = f.properties?._featureIndex ?? skipped;
            const attrs = await getWorkspaceFeatureAttributes(layerId, idx);
            features.push({
                type: 'Feature',
                geometry: f.geometry,
                properties: attrs || f.properties || {}
            });
            if (features.length >= limit) break;
        }
    }
    return features;
}

/**
 * Load every feature for a workspace layer (used by GIS tools and export).
 * @param {string} layerId
 * @returns {Promise<object[]>}
 */
export async function loadAllWorkspaceFeatures(layerId) {
    const features = [];
    let offset = 0;
    const batchSize = 1000;
    while (true) {
        const batch = await iterateWorkspaceFeatures(layerId, offset, batchSize);
        if (!batch.length) break;
        features.push(...batch);
        offset += batch.length;
        if (batch.length < batchSize) break;
    }
    return features;
}

/**
 * @param {string} layerId
 */
export async function removeWorkspaceLayer(layerId) {
    const idb = await openDB();
    const layer = await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_LAYERS, 'readonly');
        const r = tx.objectStore(STORE_LAYERS).get(layerId);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });

    const tx = idb.transaction([STORE_LAYERS, STORE_CHUNKS, STORE_ATTRIBUTES], 'readwrite');
    tx.objectStore(STORE_LAYERS).delete(layerId);
    for (const chunkId of layer?.chunkIds || []) {
        tx.objectStore(STORE_CHUNKS).delete(chunkId);
    }

    // Attribute ids are `${layerId}:f:${index}` — delete by key range so large
    // layers never require loading every attribute record into memory.
    const attrStore = tx.objectStore(STORE_ATTRIBUTES);
    attrStore.delete(IDBKeyRange.bound(`${layerId}:f:`, `${layerId}:f:\uffff`));

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    if (spatialIndex) {
        spatialIndex.removeLayer(layerId);
        markSpatialIndexDirty();
        await flushSpatialIndexSave();
    }
}

export async function getWorkspaceLayer(layerId) {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_LAYERS, 'readonly');
        const r = tx.objectStore(STORE_LAYERS).get(layerId);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror = () => reject(r.error);
    });
}

/**
 * Combined bbox for all workspace chunks in a layer (for map fit).
 * @param {string} layerId
 * @returns {Promise<[number,number,number,number]|null>} [west,south,east,north]
 */
export async function getWorkspaceLayerBounds(layerId) {
    const idx = await _getSpatialIndex();
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    let found = false;
    for (const rec of idx.chunks.values()) {
        if (rec.layerId !== layerId) continue;
        found = true;
        const [cw, cs, ce, cn] = rec.bbox;
        if (cw < west) west = cw;
        if (cs < south) south = cs;
        if (ce > east) east = ce;
        if (cn > north) north = cn;
    }
    if (!found || !isFinite(west)) return null;
    return [west, south, east, north];
}

/**
 * @param {string} layerId
 * @returns {Promise<object[]>}
 */
export async function getWorkspaceLayerAttributes(layerId) {
    const idb = await openDB();
    const tx = idb.transaction(STORE_ATTRIBUTES, 'readonly');
    const all = await new Promise((resolve, reject) => {
        const r = tx.objectStore(STORE_ATTRIBUTES).getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
    return all.filter((rec) => rec.layerId === layerId);
}

/** Kit bundles above this are skipped — too large to assemble in memory. */
export const MAX_BUNDLE_FEATURES = 250_000;

/**
 * Export full workspace layer payload for Toolbox Kit bundles.
 * @param {string} layerId
 */
export async function exportWorkspaceLayerBundle(layerId) {
    const meta = await getWorkspaceLayer(layerId);
    if (!meta) return null;
    if ((meta.featureCount || 0) > MAX_BUNDLE_FEATURES) {
        console.warn(`[Workspace] Layer ${layerId} has ${meta.featureCount} features — too large for a kit bundle, skipped`);
        return null;
    }
    const chunks = await loadWorkspaceChunks(meta.chunkIds || []);
    const attributes = await getWorkspaceLayerAttributes(layerId);
    return { meta, chunks, attributes };
}

/**
 * @param {{ meta: object, chunks: object[], attributes: object[] }} bundle
 * @param {{ newLayerId?: string }} [options]
 */
export async function importWorkspaceLayerBundle(bundle, options = {}) {
    const oldId = bundle.meta.id;
    const layerId = options.newLayerId || oldId;
    const remapped = oldId === layerId ? bundle : _remapWorkspaceBundle(bundle, layerId);

    const existing = await getWorkspaceLayer(layerId);
    if (existing) await removeWorkspaceLayer(layerId);

    const idb = await openDB();
    const idx = await _getSpatialIndex();
    const meta = { ...remapped.meta, id: layerId };

    const tx = idb.transaction([STORE_LAYERS, STORE_CHUNKS, STORE_ATTRIBUTES], 'readwrite');
    tx.objectStore(STORE_LAYERS).put(meta);
    for (const chunk of remapped.chunks) {
        tx.objectStore(STORE_CHUNKS).put(chunk);
    }
    for (const attr of remapped.attributes) {
        tx.objectStore(STORE_ATTRIBUTES).put(attr);
    }
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    for (const chunk of remapped.chunks) {
        idx.insert(chunk.id, layerId, chunk.bbox, chunk.featureCount);
    }
    markSpatialIndexDirty();
    await flushSpatialIndexSave();
    return meta;
}

function _remapWorkspaceBundle(bundle, newLayerId) {
    const oldId = bundle.meta.id;
    const replaceId = (value) => (typeof value === 'string' ? value.split(oldId).join(newLayerId) : value);
    return {
        meta: {
            ...bundle.meta,
            id: newLayerId,
            chunkIds: (bundle.meta.chunkIds || []).map(replaceId)
        },
        chunks: (bundle.chunks || []).map((chunk) => ({
            ...chunk,
            id: replaceId(chunk.id),
            layerId: newLayerId,
            geojson: replaceId(chunk.geojson)
        })),
        attributes: (bundle.attributes || []).map((attr) => ({
            ...attr,
            id: replaceId(attr.id),
            layerId: newLayerId
        }))
    };
}

/** Reset in-memory index (tests). */
export function _resetWorkspaceCache() {
    spatialIndex = null;
}

export default {
    WORKSPACE_FEATURE_THRESHOLD,
    WORKSPACE_CHUNK_SIZE,
    createWorkspaceLayer,
    updateWorkspaceLayerMeta,
    appendWorkspaceBatch,
    queryWorkspaceChunks,
    loadWorkspaceChunks,
    getWorkspaceFeatureAttributes,
    iterateWorkspaceFeatures,
    loadAllWorkspaceFeatures,
    removeWorkspaceLayer,
    getWorkspaceLayer,
    getWorkspaceLayerBounds,
    getWorkspaceLayerAttributes,
    exportWorkspaceLayerBundle,
    importWorkspaceLayerBundle,
    flushSpatialIndexSave,
    markSpatialIndexDirty,
    _resetWorkspaceCache
};
