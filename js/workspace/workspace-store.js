/**
 * IndexedDB workspace — chunked feature storage for large layers.
 */
import { GridSpatialIndex, bboxFromFeatures } from './spatial-index.js';
import { filterProperties } from '../import/import-field-filter.js';
import {
    LGID_PROP,
    ensureFeatureLgid,
    buildDisplayIdentityProps
} from './feature-identity.js';
import {
    joinHotColdProperties,
    detachFieldsFromHot,
    mergeColdFieldNames
} from './cold-attributes.js';
import {
    ATTRIBUTE_TABLE_PAGE_SIZE,
    ATTRIBUTE_SCAN_MAX_MATCHES,
    ATTRIBUTE_SCAN_BATCH_SIZE,
    recordsToAttributeRows,
    resolveAttributeTableFields,
    clampAttributePageOffset,
    normalizeAttributeTableQuery,
    rowMatchesAttributeQuery,
    sortAttributeRows
} from './attribute-table.js';

const DB_NAME = 'gis-toolbox-workspace';
/** Bumped for attributes `by-layer-feature` compound index (numeric ranges). */
export const DB_VERSION = 3;
const STORE_LAYERS = 'layers';
const STORE_CHUNKS = 'chunks';
const STORE_ATTRIBUTES = 'attributes';
const STORE_COLD = 'cold_attributes';
const STORE_INDEX = 'spatial_index';
export const ATTR_LAYER_FEATURE_INDEX = 'by-layer-feature';

/** Feature count above which imports use workspace storage. */
export const WORKSPACE_FEATURE_THRESHOLD = 15_000;

export const WORKSPACE_CHUNK_SIZE = 1000;

let db = null;
/** @type {GridSpatialIndex|null} */
let spatialIndex = null;
let _indexMutationVersion = 0;
let _indexPersistedVersion = 0;
let _indexSaveTimer = null;
/** @type {Promise<void>|null} */
let _indexSavePromise = null;

function _ensureAttributeLayerFeatureIndex(attrStore) {
    if (!attrStore.indexNames.contains(ATTR_LAYER_FEATURE_INDEX)) {
        attrStore.createIndex(ATTR_LAYER_FEATURE_INDEX, ['layerId', 'featureIndex'], { unique: true });
    }
}

function openDB() {
    return new Promise((resolve, reject) => {
        if (db) { resolve(db); return; }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const idb = e.target.result;
            const tx = e.target.transaction;
            if (!idb.objectStoreNames.contains(STORE_LAYERS)) {
                idb.createObjectStore(STORE_LAYERS, { keyPath: 'id' });
            }
            if (!idb.objectStoreNames.contains(STORE_CHUNKS)) {
                idb.createObjectStore(STORE_CHUNKS, { keyPath: 'id' });
            }
            /** @type {IDBObjectStore} */
            let attrStore;
            if (!idb.objectStoreNames.contains(STORE_ATTRIBUTES)) {
                attrStore = idb.createObjectStore(STORE_ATTRIBUTES, { keyPath: 'id' });
            } else {
                attrStore = tx.objectStore(STORE_ATTRIBUTES);
            }
            _ensureAttributeLayerFeatureIndex(attrStore);
            if (!idb.objectStoreNames.contains(STORE_COLD)) {
                idb.createObjectStore(STORE_COLD, { keyPath: 'id' });
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

async function _persistSpatialIndexSnapshot(snapshot, saveVersion) {
    const idb = await openDB();
    const tx = idb.transaction(STORE_INDEX, 'readwrite');
    tx.objectStore(STORE_INDEX).put({ key: 'main', data: snapshot });
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    _indexPersistedVersion = Math.max(_indexPersistedVersion, saveVersion);
}

/**
 * Serialized, versioned spatial-index persist.
 * Mutations bump `_indexMutationVersion`; saves snapshot that version and
 * re-run until persisted catches up (avoids clearing dirty across overlapping saves).
 */
async function _runSpatialIndexSave() {
    if (_indexSavePromise) return _indexSavePromise;
    _indexSavePromise = (async () => {
        try {
            while (_indexPersistedVersion < _indexMutationVersion) {
                const saveVersion = _indexMutationVersion;
                if (!spatialIndex) {
                    _indexPersistedVersion = Math.max(_indexPersistedVersion, saveVersion);
                    break;
                }
                const snapshot = spatialIndex.toJSON();
                await _persistSpatialIndexSnapshot(snapshot, saveVersion);
            }
        } finally {
            _indexSavePromise = null;
        }
    })();
    return _indexSavePromise;
}

/** Debounced spatial index persist — avoids rewriting the full index every batch. */
export function markSpatialIndexDirty() {
    _indexMutationVersion += 1;
    if (_indexSaveTimer) return;
    _indexSaveTimer = setTimeout(() => {
        _indexSaveTimer = null;
        void _runSpatialIndexSave().catch((err) => {
            console.error('[Workspace] Spatial index save failed:', err);
        });
    }, 300);
}

/** Flush pending spatial index writes (call after large imports). */
export async function flushSpatialIndexSave() {
    if (_indexSaveTimer) {
        clearTimeout(_indexSaveTimer);
        _indexSaveTimer = null;
    }
    if (_indexSavePromise) await _indexSavePromise;
    if (_indexPersistedVersion < _indexMutationVersion) {
        await _runSpatialIndexSave();
    }
}

/** Test helper — inspect spatial-index persistence versions. */
export function _getSpatialIndexPersistState() {
    return {
        mutationVersion: _indexMutationVersion,
        persistedVersion: _indexPersistedVersion,
        saving: !!_indexSavePromise
    };
}

function _featureId(layerId, index) {
    return `${layerId}:f:${index}`;
}

function _coldId(layerId, lgid) {
    return `${layerId}:lgid:${lgid}`;
}

async function _idbGet(storeName, key) {
    const idb = await openDB();
    return new Promise((resolve, reject) => {
        const tx = idb.transaction(storeName, 'readonly');
        const r = tx.objectStore(storeName).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

async function _getColdProperties(layerId, lgid) {
    if (!lgid) return null;
    const rec = await _idbGet(STORE_COLD, _coldId(layerId, lgid));
    return rec?.properties || null;
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
 * @param {{ allowCreateLayer?: boolean, displayFields?: string[]|null }} [options]
 *   allowCreateLayer — restore/import only. Normal import must not recreate a
 *   layer that was deleted during cancel/rollback.
 *   displayFields — style/label fields copied onto map/tile features.
 */
export async function appendWorkspaceBatch(
    layerId,
    features,
    startIndex = 0,
    selectedFields = null,
    options = {}
) {
    if (!features?.length) return null;
    const allowCreateLayer = options.allowCreateLayer === true;
    const displayFields = options.displayFields || null;

    const idb = await openDB();
    const idx = await _getSpatialIndex();
    const chunkId = `${layerId}:c:${startIndex}`;
    const bbox = bboxFromFeatures(features);

    const attrRecords = [];
    let maxFeatureIndex = -1;
    const mapFeatures = features.map((f, i) => {
        const globalIndex = Number.isFinite(f?.__featureIndex)
            ? f.__featureIndex
            : (Number.isFinite(f?.properties?._featureIndex)
                ? f.properties._featureIndex
                : startIndex + i);
        maxFeatureIndex = Math.max(maxFeatureIndex, globalIndex);
        const lgid = ensureFeatureLgid(f);
        const fid = _featureId(layerId, globalIndex);
        attrRecords.push({
            id: fid,
            layerId,
            featureIndex: globalIndex,
            lgid,
            properties: filterProperties(f.properties || {}, selectedFields)
        });
        return {
            type: 'Feature',
            id: globalIndex,
            geometry: f.geometry,
            properties: buildDisplayIdentityProps({
                lgid,
                layerId,
                featureIndex: globalIndex,
                properties: f.properties || {},
                displayFields
            })
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
        let rejected = false;
        layerReq.onsuccess = () => {
            const layer = layerReq.result;
            if (!layer) {
                if (!allowCreateLayer) {
                    rejected = true;
                    try {
                        tx.abort();
                    } catch { /* already finished */ }
                    reject(new Error(`Workspace layer "${layerId}" was removed; refusing to recreate from a late batch.`));
                    return;
                }
                layerStore.put({
                    id: layerId,
                    chunkIds: [chunkId],
                    // Unique logical features — max index + 1 (multi-cell copies share indices)
                    featureCount: Math.max(features.length, maxFeatureIndex + 1)
                });
                return;
            }
            layer.chunkIds = layer.chunkIds || [];
            if (!layer.chunkIds.includes(chunkId)) layer.chunkIds.push(chunkId);
            // Multi-cell copies re-put the same indices — never inflate by batch length.
            const prevCount = layer.featureCount || 0;
            layer.featureCount = Math.max(prevCount, maxFeatureIndex + 1);
            layerStore.put(layer);
        };
        layerReq.onerror = () => reject(layerReq.error);
        tx.oncomplete = () => {
            if (!rejected) resolve();
        };
        tx.onerror = () => {
            if (!rejected) reject(tx.error);
        };
        tx.onabort = () => {
            if (!rejected) reject(tx.error || new Error('Workspace batch write aborted'));
        };
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
 * @returns {Promise<object|null>}
 */
export async function getWorkspaceFeatureRecord(layerId, featureIndex) {
    return _idbGet(STORE_ATTRIBUTES, _featureId(layerId, featureIndex));
}

/**
 * Hot attributes for identify/edit. Pass `{ includeCold: true }` to join
 * detach-for-export fields (used by streamed export).
 * @param {string} layerId
 * @param {number} featureIndex
 * @param {{ includeCold?: boolean }} [options]
 */
export async function getWorkspaceFeatureAttributes(layerId, featureIndex, options = {}) {
    const rec = await getWorkspaceFeatureRecord(layerId, featureIndex);
    if (!rec) return null;
    const hot = { ...(rec.properties || {}) };
    if (rec.lgid) hot[LGID_PROP] = rec.lgid;
    if (!options.includeCold) return hot;
    const cold = await _getColdProperties(layerId, rec.lgid);
    return joinHotColdProperties(hot, cold);
}

/**
 * Batch-load attribute records for a contiguous feature-index range.
 * @param {string} layerId
 * @param {number} startIndex
 * @param {number} count
 */
/**
 * Numeric feature-index range bound for the attributes compound index.
 * Exported for regression tests (string primary keys sort lexicographically).
 * @param {string} layerId
 * @param {number} startIndex
 * @param {number} count
 */
export function attributeFeatureIndexRange(layerId, startIndex, count) {
    return IDBKeyRange.bound(
        [layerId, startIndex],
        [layerId, startIndex + count - 1]
    );
}

async function _loadAttributeRecordsRange(layerId, startIndex, count) {
    if (count <= 0) return new Map();
    const idb = await openDB();
    const rows = await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_ATTRIBUTES, 'readonly');
        const store = tx.objectStore(STORE_ATTRIBUTES);
        const index = store.indexNames.contains(ATTR_LAYER_FEATURE_INDEX)
            ? store.index(ATTR_LAYER_FEATURE_INDEX)
            : null;
        const r = index
            ? index.getAll(attributeFeatureIndexRange(layerId, startIndex, count))
            // Legacy DBs without the compound index: fall back to primary-key
            // string range (incorrect across decade boundaries — callers on
            // DB_VERSION >= 3 should never hit this).
            : store.getAll(IDBKeyRange.bound(
                _featureId(layerId, startIndex),
                _featureId(layerId, startIndex + count - 1)
            ));
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
    const byIndex = new Map();
    const end = startIndex + count - 1;
    for (const rec of rows) {
        const idx = rec.featureIndex;
        if (idx == null || idx < startIndex || idx > end) continue;
        if (rec.layerId && rec.layerId !== layerId) continue;
        byIndex.set(idx, rec);
    }
    return byIndex;
}

/**
 * @param {string} layerId
 * @param {string[]} lgids
 * @returns {Promise<Map<string, object>>}
 */
async function _loadColdPropertiesByLgids(layerId, lgids) {
    const out = new Map();
    const unique = [...new Set((lgids || []).filter(Boolean))];
    if (!unique.length) return out;
    const idb = await openDB();
    const tx = idb.transaction(STORE_COLD, 'readonly');
    const store = tx.objectStore(STORE_COLD);
    await Promise.all(unique.map((lgid) => new Promise((resolve, reject) => {
        const r = store.get(_coldId(layerId, lgid));
        r.onsuccess = () => {
            if (r.result?.properties) out.set(lgid, r.result.properties);
            resolve();
        };
        r.onerror = () => reject(r.error);
    })));
    return out;
}

/**
 * @param {string} layerId
 * @param {number} offset
 * @param {number} limit
 * @param {{ includeCold?: boolean }} [options]
 */
export async function iterateWorkspaceFeatures(layerId, offset = 0, limit = 1000, options = {}) {
    const layer = await getWorkspaceLayer(layerId);
    if (!layer?.chunkIds?.length) return [];

    const features = [];
    const seenIndices = new Set();
    let skipped = 0;
    for (const chunkId of layer.chunkIds) {
        if (features.length >= limit) break;
        const chunk = await _idbGet(STORE_CHUNKS, chunkId);
        if (!chunk?.geojson) continue;
        const fc = JSON.parse(chunk.geojson);
        const chunkFeatures = fc.features || [];
        if (!chunkFeatures.length) continue;

        const indexList = chunkFeatures.map((f, i) => (
            Number.isFinite(f?.properties?._featureIndex)
                ? f.properties._featureIndex
                : (chunk.startIndex ?? 0) + i
        ));
        const minIdx = Math.min(...indexList);
        const maxIdx = Math.max(...indexList);
        const attrByIndex = await _loadAttributeRecordsRange(
            layerId,
            minIdx,
            Math.max(1, maxIdx - minIdx + 1)
        );
        let coldByLgid = null;
        if (options.includeCold) {
            const lgids = [...attrByIndex.values()].map((r) => r.lgid).filter(Boolean);
            coldByLgid = await _loadColdPropertiesByLgids(layerId, lgids);
        }

        for (let fi = 0; fi < chunkFeatures.length; fi++) {
            const f = chunkFeatures[fi];
            const idx = indexList[fi];
            // Multi-cell copies share _featureIndex — export/iterate once.
            if (seenIndices.has(idx)) continue;
            seenIndices.add(idx);

            if (skipped < offset) {
                skipped++;
                continue;
            }
            const rec = attrByIndex.get(idx);
            let props = rec?.properties ? { ...rec.properties } : {};
            const lgid = rec?.lgid || f.properties?.[LGID_PROP];
            if (lgid) props[LGID_PROP] = lgid;
            if (options.includeCold && lgid && coldByLgid?.has(lgid)) {
                props = joinHotColdProperties(props, coldByLgid.get(lgid));
            }
            features.push({
                type: 'Feature',
                geometry: f.geometry,
                properties: props
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

    const storeNames = [STORE_LAYERS, STORE_CHUNKS, STORE_ATTRIBUTES];
    if (idb.objectStoreNames.contains(STORE_COLD)) storeNames.push(STORE_COLD);
    const tx = idb.transaction(storeNames, 'readwrite');
    tx.objectStore(STORE_LAYERS).delete(layerId);
    for (const chunkId of layer?.chunkIds || []) {
        tx.objectStore(STORE_CHUNKS).delete(chunkId);
    }

    // Attribute ids are `${layerId}:f:${index}` — delete by key range so large
    // layers never require loading every attribute record into memory.
    const attrStore = tx.objectStore(STORE_ATTRIBUTES);
    attrStore.delete(IDBKeyRange.bound(`${layerId}:f:`, `${layerId}:f:\uffff`));

    if (idb.objectStoreNames.contains(STORE_COLD)) {
        tx.objectStore(STORE_COLD).delete(
            IDBKeyRange.bound(`${layerId}:lgid:`, `${layerId}:lgid:\uffff`)
        );
    }

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

/**
 * Index stamped on a chunk feature (`_featureIndex`, else `id`, else start+offset).
 * @param {object} feature
 * @param {object} chunk
 * @param {number} i
 */
function _chunkFeatureIndex(feature, chunk, i) {
    const fromProp = Number(feature?.properties?._featureIndex);
    if (Number.isInteger(fromProp) && fromProp >= 0) return fromProp;
    const fromId = Number(feature?.id);
    if (Number.isInteger(fromId) && fromId >= 0) return fromId;
    return (chunk.startIndex ?? 0) + i;
}

/**
 * Remove selected features from a workspace layer (chunks + attributes + cold).
 * Feature indices are stable IDs; remaining indices are not compacted.
 * @param {string} layerId
 * @param {number[]} indices
 * @returns {Promise<{ deletedCount: number }>}
 */
export async function deleteWorkspaceFeatures(layerId, indices = []) {
    const wanted = new Set(
        (indices || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0)
    );
    if (!wanted.size) return { deletedCount: 0 };

    const layer = await getWorkspaceLayer(layerId);
    if (!layer) throw new Error('Workspace layer not found.');

    const existingIndices = [];
    const deletedLgids = [];
    for (const featureIndex of wanted) {
        const rec = await getWorkspaceFeatureRecord(layerId, featureIndex);
        if (!rec) continue;
        existingIndices.push(featureIndex);
        if (rec.lgid) deletedLgids.push(rec.lgid);
    }

    const chunkIds = [...(layer.chunkIds || [])];
    const remainingChunkIds = [];
    const chunksToPut = [];
    const chunksToDelete = [];

    for (const chunkId of chunkIds) {
        const chunk = await _idbGet(STORE_CHUNKS, chunkId);
        if (!chunk?.geojson) {
            remainingChunkIds.push(chunkId);
            continue;
        }
        let fc;
        try {
            fc = typeof chunk.geojson === 'string' ? JSON.parse(chunk.geojson) : chunk.geojson;
        } catch {
            remainingChunkIds.push(chunkId);
            continue;
        }
        const features = fc?.features || [];
        const kept = [];
        for (let i = 0; i < features.length; i++) {
            const featureIndex = _chunkFeatureIndex(features[i], chunk, i);
            if (!wanted.has(featureIndex)) kept.push(features[i]);
        }
        if (kept.length === features.length) {
            remainingChunkIds.push(chunkId);
            continue;
        }
        if (kept.length === 0) {
            chunksToDelete.push(chunkId);
            continue;
        }
        const bbox = bboxFromFeatures(kept);
        chunksToPut.push({
            ...chunk,
            geojson: JSON.stringify({ type: 'FeatureCollection', features: kept }),
            featureCount: kept.length,
            bbox
        });
        remainingChunkIds.push(chunkId);
    }

    const idb = await openDB();
    const storeNames = [STORE_LAYERS, STORE_CHUNKS, STORE_ATTRIBUTES];
    if (idb.objectStoreNames.contains(STORE_COLD)) storeNames.push(STORE_COLD);
    const tx = idb.transaction(storeNames, 'readwrite');
    const chunkStore = tx.objectStore(STORE_CHUNKS);
    for (const chunkId of chunksToDelete) chunkStore.delete(chunkId);
    for (const chunk of chunksToPut) chunkStore.put(chunk);

    const attrStore = tx.objectStore(STORE_ATTRIBUTES);
    for (const featureIndex of existingIndices) {
        attrStore.delete(_featureId(layerId, featureIndex));
    }

    if (idb.objectStoreNames.contains(STORE_COLD)) {
        const coldStore = tx.objectStore(STORE_COLD);
        for (const lgid of deletedLgids) {
            coldStore.delete(_coldId(layerId, lgid));
        }
    }

    const layerStore = tx.objectStore(STORE_LAYERS);
    layer.chunkIds = remainingChunkIds;
    if (!remainingChunkIds.length) layer.featureCount = 0;
    layerStore.put(layer);

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });

    const idx = await _getSpatialIndex();
    for (const chunkId of chunksToDelete) idx.remove(chunkId);
    for (const chunk of chunksToPut) {
        idx.remove(chunk.id);
        idx.insert(chunk.id, layerId, chunk.bbox, chunk.featureCount);
    }
    markSpatialIndexDirty();
    await flushSpatialIndexSave();

    return { deletedCount: existingIndices.length };
}

/**
 * Replace hot properties for one feature (keeps lgid). Does not touch cold.
 * @param {string} layerId
 * @param {number} featureIndex
 * @param {object} properties
 */
export async function updateWorkspaceFeatureAttributes(layerId, featureIndex, properties) {
    const idb = await openDB();
    const fid = _featureId(layerId, featureIndex);
    const tx = idb.transaction(STORE_ATTRIBUTES, 'readwrite');
    const store = tx.objectStore(STORE_ATTRIBUTES);
    const existing = await new Promise((resolve, reject) => {
        const r = store.get(fid);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    if (!existing) {
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        return false;
    }
    const nextProps = { ...(properties || {}) };
    delete nextProps._featureIndex;
    delete nextProps._datasetId;
    delete nextProps._featureId;
    // lgid stays on the record, not duplicated as a mutable user field
    delete nextProps[LGID_PROP];
    store.put({
        ...existing,
        properties: nextProps
    });
    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    return true;
}

/**
 * Patch hot properties for many features (merge patch into existing props).
 * @param {string} layerId
 * @param {Array<{ featureIndex: number, patch: object }>} edits
 * @returns {Promise<number>} updated count
 */
export async function updateWorkspaceFeatureAttributesBatch(layerId, edits = []) {
    if (!edits.length) return 0;
    const idb = await openDB();
    let updated = 0;
    const batchSize = 250;

    for (let i = 0; i < edits.length; i += batchSize) {
        const slice = edits.slice(i, i + batchSize);
        const records = [];
        for (const edit of slice) {
            const rec = await getWorkspaceFeatureRecord(layerId, edit.featureIndex);
            if (!rec) continue;
            const props = { ...(rec.properties || {}) };
            for (const [k, v] of Object.entries(edit.patch || {})) {
                if (k === LGID_PROP || k.startsWith('_')) continue;
                props[k] = v;
            }
            records.push({ ...rec, properties: props });
        }
        if (!records.length) continue;
        const tx = idb.transaction(STORE_ATTRIBUTES, 'readwrite');
        const store = tx.objectStore(STORE_ATTRIBUTES);
        for (const rec of records) store.put(rec);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        updated += records.length;
    }

    return updated;
}

/**
 * Move named fields from hot → cold attribute sidecar ("Detach for export").
 * @param {string} layerId
 * @param {string[]} fieldNames
 * @param {{ onProgress?: (done: number, total: number) => void }} [options]
 * @returns {Promise<{ movedFields: string[], featureCount: number }>}
 */
export async function detachFieldsForExport(layerId, fieldNames = [], options = {}) {
    const fields = [...new Set((fieldNames || []).filter((n) => n && !n.startsWith('_') && n !== LGID_PROP))];
    if (!fields.length) {
        return { movedFields: [], featureCount: 0 };
    }

    const layer = await getWorkspaceLayer(layerId);
    if (!layer) throw new Error('Workspace layer not found.');

    const featureCount = layer.featureCount || 0;
    const idb = await openDB();
    const batchSize = 500;
    let done = 0;

    for (let start = 0; start < featureCount; start += batchSize) {
        const count = Math.min(batchSize, featureCount - start);
        const attrByIndex = await _loadAttributeRecordsRange(layerId, start, count);
        const lgids = [...attrByIndex.values()].map((r) => r.lgid).filter(Boolean);
        const coldByLgid = await _loadColdPropertiesByLgids(layerId, lgids);

        const hotPuts = [];
        const coldPuts = [];
        for (const rec of attrByIndex.values()) {
            const lgid = rec.lgid || ensureFeatureLgid({ properties: rec.properties });
            const { hot, cold } = detachFieldsFromHot(
                rec.properties || {},
                coldByLgid.get(lgid) || {},
                fields
            );
            hotPuts.push({ ...rec, lgid, properties: hot });
            if (Object.keys(cold).length) {
                coldPuts.push({
                    id: _coldId(layerId, lgid),
                    layerId,
                    lgid,
                    properties: cold
                });
            }
            done++;
        }

        const tx = idb.transaction([STORE_ATTRIBUTES, STORE_COLD], 'readwrite');
        const hotStore = tx.objectStore(STORE_ATTRIBUTES);
        const coldStore = tx.objectStore(STORE_COLD);
        for (const rec of hotPuts) hotStore.put(rec);
        for (const rec of coldPuts) coldStore.put(rec);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        options.onProgress?.(done, featureCount);
    }

    const coldFields = mergeColdFieldNames(layer.schema?.coldFields || layer.coldFields || [], fields);
    const schema = layer.schema
        ? {
            ...layer.schema,
            coldFields,
            fields: (layer.schema.fields || []).map((f) => (
                fields.includes(f.name) ? { ...f, cold: true, selected: f.selected } : f
            ))
        }
        : layer.schema;
    await updateWorkspaceLayerMeta(layerId, {
        coldFields,
        schema,
        detachedFields: coldFields
    });

    return { movedFields: fields, featureCount };
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

/**
 * Attributes-only page for the data table (no geometries).
 * Includes features that may not currently be drawn on the map.
 *
 * @param {string} layerId
 * @param {number} [offset]
 * @param {number} [limit]
 * @param {{ includeCold?: boolean }} [options]
 * @returns {Promise<{
 *   rows: object[],
 *   fields: string[],
 *   coldFields: string[],
 *   totalCount: number,
 *   offset: number,
 *   limit: number,
 *   includeCold: boolean
 * }>}
 */
export async function loadWorkspaceAttributePage(
    layerId,
    offset = 0,
    limit = ATTRIBUTE_TABLE_PAGE_SIZE,
    options = {}
) {
    const includeCold = options.includeCold !== false;
    const layer = await getWorkspaceLayer(layerId);
    const totalCount = layer?.featureCount ?? 0;
    const coldFields = [
        ...(layer?.schema?.coldFields || layer?.coldFields || layer?.detachedFields || [])
    ];
    const schemaFieldNames = (layer?.schema?.fields || [])
        .map((f) => (typeof f === 'string' ? f : f?.name))
        .filter(Boolean);

    if (!totalCount) {
        return {
            rows: [],
            fields: resolveAttributeTableFields({ schemaFieldNames, coldFields, includeIdentity: true }),
            coldFields,
            totalCount: 0,
            offset: 0,
            limit,
            includeCold
        };
    }

    const pageOffset = clampAttributePageOffset(offset, totalCount, limit);
    const count = Math.min(limit, totalCount - pageOffset);
    const attrByIndex = await _loadAttributeRecordsRange(layerId, pageOffset, count);
    let coldByLgid = null;
    if (includeCold) {
        const lgids = [...attrByIndex.values()].map((r) => r.lgid).filter(Boolean);
        coldByLgid = await _loadColdPropertiesByLgids(layerId, lgids);
    }

    const rows = recordsToAttributeRows(attrByIndex, coldByLgid, {
        includeCold,
        startIndex: pageOffset,
        count
    });
    const fields = resolveAttributeTableFields({
        schemaFieldNames,
        coldFields,
        sampleRows: rows,
        includeIdentity: true
    });

    return {
        rows,
        fields,
        coldFields,
        totalCount,
        offset: pageOffset,
        limit,
        includeCold
    };
}

function _yieldScanTick() {
    return new Promise((resolve) => {
        if (typeof setTimeout === 'function') setTimeout(resolve, 0);
        else resolve();
    });
}

/**
 * Load attribute rows for an explicit list of feature indices (search results).
 * @param {string} layerId
 * @param {number[]} indices
 * @param {{ includeCold?: boolean }} [options]
 */
export async function loadWorkspaceAttributeRowsByIndices(layerId, indices = [], options = {}) {
    const includeCold = options.includeCold !== false;
    const layer = await getWorkspaceLayer(layerId);
    const coldFields = [
        ...(layer?.schema?.coldFields || layer?.coldFields || layer?.detachedFields || [])
    ];
    const schemaFieldNames = (layer?.schema?.fields || [])
        .map((f) => (typeof f === 'string' ? f : f?.name))
        .filter(Boolean);

    if (!indices.length) {
        return {
            rows: [],
            fields: resolveAttributeTableFields({ schemaFieldNames, coldFields, includeIdentity: true }),
            coldFields,
            includeCold
        };
    }

    const sorted = [...indices].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    const attrByIndex = new Map();
    // Load contiguous runs for fewer IDB range reads.
    let runStart = sorted[0];
    let runEnd = sorted[0];
    const flushRun = async () => {
        const count = runEnd - runStart + 1;
        const batch = await _loadAttributeRecordsRange(layerId, runStart, count);
        for (const [idx, rec] of batch) attrByIndex.set(idx, rec);
    };
    for (let i = 1; i < sorted.length; i++) {
        const idx = sorted[i];
        if (idx === runEnd + 1) {
            runEnd = idx;
            continue;
        }
        await flushRun();
        runStart = idx;
        runEnd = idx;
    }
    await flushRun();

    let coldByLgid = null;
    if (includeCold) {
        const lgids = [...attrByIndex.values()].map((r) => r.lgid).filter(Boolean);
        coldByLgid = await _loadColdPropertiesByLgids(layerId, lgids);
    }

    const rows = sorted.map((featureIndex) => {
        const rec = attrByIndex.get(featureIndex);
        if (!rec) return { _featureIndex: featureIndex };
        let props = { ...(rec.properties || {}) };
        if (rec.lgid) props[LGID_PROP] = rec.lgid;
        if (includeCold && rec.lgid && coldByLgid?.has(rec.lgid)) {
            props = joinHotColdProperties(props, coldByLgid.get(rec.lgid));
            if (rec.lgid) props[LGID_PROP] = rec.lgid;
        }
        props._featureIndex = featureIndex;
        return props;
    });

    return {
        rows,
        fields: resolveAttributeTableFields({
            schemaFieldNames,
            coldFields,
            sampleRows: rows,
            includeIdentity: true
        }),
        coldFields,
        includeCold
    };
}

/**
 * Cancelable attribute scan for search/filter. Attributes-only (no geometries).
 *
 * @param {string} layerId
 * @param {import('./attribute-table.js').AttributeTableQuery} query
 * @param {{
 *   includeCold?: boolean,
 *   maxMatches?: number,
 *   signal?: AbortSignal,
 *   onProgress?: (p: { scanned: number, total: number, matches: number }) => void
 * }} [options]
 */
export async function scanWorkspaceAttributeMatches(layerId, query = {}, options = {}) {
    const includeCold = options.includeCold !== false;
    const maxMatches = options.maxMatches ?? ATTRIBUTE_SCAN_MAX_MATCHES;
    const normalized = normalizeAttributeTableQuery(query);
    const layer = await getWorkspaceLayer(layerId);
    const totalCount = layer?.featureCount ?? 0;
    const matchIndices = [];
    let scanned = 0;
    let truncated = false;

    if (!normalized.active || !totalCount) {
        return {
            matchIndices,
            scanned: 0,
            totalCount,
            truncated: false,
            maxMatches
        };
    }

    for (let start = 0; start < totalCount; start += ATTRIBUTE_SCAN_BATCH_SIZE) {
        if (options.signal?.aborted) {
            const err = new Error('Scan cancelled');
            err.name = 'AbortError';
            throw err;
        }
        const count = Math.min(ATTRIBUTE_SCAN_BATCH_SIZE, totalCount - start);
        const attrByIndex = await _loadAttributeRecordsRange(layerId, start, count);
        let coldByLgid = null;
        if (includeCold) {
            const lgids = [...attrByIndex.values()].map((r) => r.lgid).filter(Boolean);
            coldByLgid = await _loadColdPropertiesByLgids(layerId, lgids);
        }
        const rows = recordsToAttributeRows(attrByIndex, coldByLgid, {
            includeCold,
            startIndex: start,
            count
        });
        for (const row of rows) {
            scanned++;
            if (rowMatchesAttributeQuery(row, normalized)) {
                matchIndices.push(row._featureIndex);
                if (matchIndices.length >= maxMatches) {
                    truncated = true;
                    options.onProgress?.({ scanned, total: totalCount, matches: matchIndices.length });
                    return { matchIndices, scanned, totalCount, truncated, maxMatches };
                }
            }
        }
        options.onProgress?.({ scanned, total: totalCount, matches: matchIndices.length });
        await _yieldScanTick();
    }

    return { matchIndices, scanned, totalCount, truncated, maxMatches };
}

/**
 * Resolve a workspace feature (geometry + attributes) by feature index.
 * @param {string} layerId
 * @param {number} featureIndex
 * @param {{ includeCold?: boolean }} [options]
 * @returns {Promise<object|null>} GeoJSON Feature
 */
export async function getWorkspaceFeatureByIndex(layerId, featureIndex, options = {}) {
    const features = await getWorkspaceFeaturesByIndices(layerId, [featureIndex], options);
    return features[0] || null;
}

/**
 * Load geometries (+ attributes) for selected feature indices.
 * Used by table → map zoom/highlight.
 *
 * @param {string} layerId
 * @param {number[]} indices
 * @param {{ includeCold?: boolean }} [options]
 * @returns {Promise<object[]>}
 */
export async function getWorkspaceFeaturesByIndices(layerId, indices = [], options = {}) {
    const includeCold = options.includeCold !== false;
    const wanted = [...new Set((indices || []).map(Number).filter(Number.isFinite))];
    if (!wanted.length) return [];

    const layer = await getWorkspaceLayer(layerId);
    if (!layer?.chunkIds?.length) return [];

    const wantedSet = new Set(wanted);
    const found = new Map();

    for (const chunkId of layer.chunkIds) {
        if (found.size >= wanted.length) break;
        const chunk = await _idbGet(STORE_CHUNKS, chunkId);
        if (!chunk?.geojson) continue;

        let fc;
        try {
            fc = JSON.parse(chunk.geojson);
        } catch {
            continue;
        }
        const chunkFeatures = fc?.features || [];
        if (!chunkFeatures.length) continue;

        const indexList = chunkFeatures.map((f, i) => (
            Number.isFinite(f?.properties?._featureIndex)
                ? Number(f.properties._featureIndex)
                : (chunk.startIndex ?? 0) + i
        ));
        if (!indexList.some((idx) => wantedSet.has(idx))) continue;

        const minIdx = Math.min(...indexList);
        const maxIdx = Math.max(...indexList);
        const attrByIndex = await _loadAttributeRecordsRange(
            layerId,
            minIdx,
            Math.max(1, maxIdx - minIdx + 1)
        );
        let coldByLgid = null;
        if (includeCold) {
            const lgids = [...attrByIndex.values()].map((r) => r.lgid).filter(Boolean);
            coldByLgid = await _loadColdPropertiesByLgids(layerId, lgids);
        }

        for (let i = 0; i < chunkFeatures.length; i++) {
            const f = chunkFeatures[i];
            const idx = Number(indexList[i]);
            if (!wantedSet.has(idx) || found.has(idx)) continue;
            const rec = attrByIndex.get(idx);
            let props = rec?.properties ? { ...rec.properties } : {};
            const lgid = rec?.lgid || f.properties?.[LGID_PROP];
            if (lgid) props[LGID_PROP] = lgid;
            if (includeCold && lgid && coldByLgid?.has(lgid)) {
                props = joinHotColdProperties(props, coldByLgid.get(lgid));
            }
            props._featureIndex = idx;
            found.set(idx, {
                type: 'Feature',
                geometry: f.geometry,
                properties: props
            });
            if (found.size >= wanted.length) break;
        }
    }

    return wanted.map((idx) => found.get(idx)).filter(Boolean);
}

/**
 * Page through either sequential indices or a match-index list, with optional sort of the page.
 * @param {string} layerId
 * @param {{
 *   offset?: number,
 *   limit?: number,
 *   includeCold?: boolean,
 *   matchIndices?: number[]|null,
 *   sortField?: string|null,
 *   sortDir?: 'asc'|'desc'
 * }} [options]
 */
export async function loadWorkspaceAttributeTablePage(layerId, options = {}) {
    const limit = options.limit ?? ATTRIBUTE_TABLE_PAGE_SIZE;
    const includeCold = options.includeCold !== false;
    const matchIndices = options.matchIndices || null;
    const sortField = options.sortField || null;
    const sortDir = options.sortDir === 'desc' ? 'desc' : 'asc';

    if (matchIndices) {
        const totalCount = matchIndices.length;
        const pageOffset = clampAttributePageOffset(options.offset || 0, totalCount, limit);
        const slice = matchIndices.slice(pageOffset, pageOffset + limit);
        const loaded = await loadWorkspaceAttributeRowsByIndices(layerId, slice, { includeCold });
        const rows = sortField
            ? sortAttributeRows(loaded.rows, sortField, sortDir)
            : loaded.rows;
        return {
            ...loaded,
            rows,
            totalCount,
            offset: pageOffset,
            limit,
            includeCold,
            filtered: true,
            sortField,
            sortDir
        };
    }

    const page = await loadWorkspaceAttributePage(layerId, options.offset || 0, limit, { includeCold });
    if (sortField) {
        page.rows = sortAttributeRows(page.rows, sortField, sortDir);
    }
    return {
        ...page,
        filtered: false,
        sortField,
        sortDir
    };
}

/**
 * Legacy in-memory kit path threshold. Layers above this use streamed kit
 * packing (`writeWorkspaceLayerToKitZip`) instead of assembling a full bundle.
 */
export const MAX_BUNDLE_FEATURES = 250_000;

/** Attribute/cold records per kit part file. */
export const KIT_ATTR_PART_SIZE = 500;

/**
 * Export full workspace layer payload for Toolbox Kit bundles (small layers).
 * Large layers should use `writeWorkspaceLayerToKitZip` instead.
 * @param {string} layerId
 */
export async function exportWorkspaceLayerBundle(layerId) {
    const meta = await getWorkspaceLayer(layerId);
    if (!meta) return null;
    if ((meta.featureCount || 0) > MAX_BUNDLE_FEATURES) {
        return null;
    }
    const chunks = await loadWorkspaceChunks(meta.chunkIds || []);
    const attributes = await getWorkspaceLayerAttributes(layerId);
    const cold = await _loadAllColdRecords(layerId);
    return { meta, chunks, attributes, cold };
}

/**
 * @param {string} layerId
 * @returns {Promise<object[]>}
 */
async function _loadAllColdRecords(layerId) {
    const idb = await openDB();
    if (!idb.objectStoreNames.contains(STORE_COLD)) return [];
    const rows = await new Promise((resolve, reject) => {
        const tx = idb.transaction(STORE_COLD, 'readonly');
        const r = tx.objectStore(STORE_COLD).getAll(
            IDBKeyRange.bound(`${layerId}:lgid:`, `${layerId}:lgid:\uffff`)
        );
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
    });
    return rows;
}

/**
 * Stream a workspace layer into an open JSZip instance without assembling a
 * full in-memory bundle (chunks + sharded attributes + cold parts).
 * @param {object} zip JSZip instance
 * @param {string} folderKey kit folder id (usually layer.id)
 * @param {string} layerId workspace layer id
 * @param {{ onProgress?: (done: number, total: number, label?: string) => void }} [options]
 * @returns {Promise<{ featureCount: number, attributeParts: number, coldParts: number }|null>}
 */
export async function writeWorkspaceLayerToKitZip(zip, folderKey, layerId, options = {}) {
    const meta = await getWorkspaceLayer(layerId);
    if (!meta) return null;

    const base = `layers/workspace/${folderKey}`;
    zip.file(`${base}/meta.json`, JSON.stringify(meta, null, 2));

    const chunkIds = meta.chunkIds || [];
    const featureCount = meta.featureCount || 0;
    const attrParts = Math.max(1, Math.ceil(Math.max(featureCount, 1) / KIT_ATTR_PART_SIZE));
    const totalSteps = chunkIds.length + attrParts + 1;
    let done = 0;

    for (const chunkId of chunkIds) {
        const [chunk] = await loadWorkspaceChunks([chunkId]);
        if (chunk) {
            zip.file(`${base}/chunks/${chunk.id}.json`, JSON.stringify(chunk));
        }
        done++;
        options.onProgress?.(done, totalSteps, 'chunks');
        await new Promise((r) => setTimeout(r, 0));
    }

    let attributeParts = 0;
    for (let start = 0; start < featureCount; start += KIT_ATTR_PART_SIZE) {
        const count = Math.min(KIT_ATTR_PART_SIZE, featureCount - start);
        const byIndex = await _loadAttributeRecordsRange(layerId, start, count);
        const records = [...byIndex.values()];
        const partName = `part-${String(attributeParts).padStart(5, '0')}.json`;
        zip.file(`${base}/attributes/${partName}`, JSON.stringify(records));
        attributeParts++;
        done++;
        options.onProgress?.(done, totalSteps, 'attributes');
        await new Promise((r) => setTimeout(r, 0));
    }
    if (featureCount === 0) {
        zip.file(`${base}/attributes/part-00000.json`, '[]');
        attributeParts = 1;
    }

    let coldParts = 0;
    const coldRecords = await _loadAllColdRecords(layerId);
    for (let i = 0; i < coldRecords.length; i += KIT_ATTR_PART_SIZE) {
        const slice = coldRecords.slice(i, i + KIT_ATTR_PART_SIZE);
        const partName = `part-${String(coldParts).padStart(5, '0')}.json`;
        zip.file(`${base}/cold/${partName}`, JSON.stringify(slice));
        coldParts++;
    }
    done++;
    options.onProgress?.(done, totalSteps, 'cold');

    return { featureCount, attributeParts, coldParts };
}

/**
 * Import a workspace layer from kit zip folder contents (meta + chunks +
 * attribute/cold parts). Writes to IndexedDB incrementally.
 * @param {{
 *   meta: object,
 *   loadChunks: () => AsyncGenerator<object>|Generator<object>|Promise<object[]>,
 *   loadAttributeParts?: () => AsyncGenerator<object[]>|Generator<object[]>|Promise<object[][]>,
 *   loadColdParts?: () => AsyncGenerator<object[]>|Generator<object[]>|Promise<object[][]>,
 * }} parts
 * @param {{ newLayerId?: string }} [options]
 */
export async function importWorkspaceLayerFromParts(parts, options = {}) {
    const oldId = parts.meta.id;
    const layerId = options.newLayerId || oldId;
    const replaceId = (value) => (
        typeof value === 'string' && oldId !== layerId
            ? value.split(oldId).join(layerId)
            : value
    );

    const existing = await getWorkspaceLayer(layerId);
    if (existing) await removeWorkspaceLayer(layerId);

    const idb = await openDB();
    const idx = await _getSpatialIndex();
    const meta = {
        ...parts.meta,
        id: layerId,
        chunkIds: (parts.meta.chunkIds || []).map(replaceId)
    };

    {
        const tx = idb.transaction(STORE_LAYERS, 'readwrite');
        tx.objectStore(STORE_LAYERS).put(meta);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    }

    const chunkIter = await parts.loadChunks();
    for await (const chunk of _asAsyncIterable(chunkIter)) {
        const remapped = {
            ...chunk,
            id: replaceId(chunk.id),
            layerId,
            geojson: replaceId(chunk.geojson)
        };
        const tx = idb.transaction(STORE_CHUNKS, 'readwrite');
        tx.objectStore(STORE_CHUNKS).put(remapped);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
        idx.insert(remapped.id, layerId, remapped.bbox, remapped.featureCount);
    }

    if (parts.loadAttributeParts) {
        const attrIter = await parts.loadAttributeParts();
        for await (const batch of _asAsyncIterable(attrIter)) {
            const tx = idb.transaction(STORE_ATTRIBUTES, 'readwrite');
            const store = tx.objectStore(STORE_ATTRIBUTES);
            for (const attr of batch || []) {
                store.put({
                    ...attr,
                    id: replaceId(attr.id),
                    layerId
                });
            }
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        }
    }

    if (parts.loadColdParts && idb.objectStoreNames.contains(STORE_COLD)) {
        const coldIter = await parts.loadColdParts();
        for await (const batch of _asAsyncIterable(coldIter)) {
            const tx = idb.transaction(STORE_COLD, 'readwrite');
            const store = tx.objectStore(STORE_COLD);
            for (const rec of batch || []) {
                const lgid = rec.lgid;
                store.put({
                    ...rec,
                    id: _coldId(layerId, lgid),
                    layerId,
                    lgid
                });
            }
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
        }
    }

    markSpatialIndexDirty();
    await flushSpatialIndexSave();
    return meta;
}

async function* _asAsyncIterable(value) {
    if (!value) return;
    if (Array.isArray(value)) {
        for (const item of value) yield item;
        return;
    }
    if (typeof value[Symbol.asyncIterator] === 'function' || typeof value[Symbol.iterator] === 'function') {
        yield* value;
        return;
    }
    yield value;
}

/**
 * @param {{ meta: object, chunks: object[], attributes: object[] }} bundle
 * @param {{ newLayerId?: string }} [options]
 */
export async function importWorkspaceLayerBundle(bundle, options = {}) {
    return importWorkspaceLayerFromParts({
        meta: bundle.meta,
        async *loadChunks() {
            for (const chunk of bundle.chunks || []) yield chunk;
        },
        async *loadAttributeParts() {
            if (bundle.attributes?.length) yield bundle.attributes;
        },
        async *loadColdParts() {
            if (bundle.cold?.length) yield bundle.cold;
        }
    }, options);
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

/** Reset in-memory index/connection (tests). */
export function _resetWorkspaceCache() {
    spatialIndex = null;
    db = null;
    _indexMutationVersion = 0;
    _indexPersistedVersion = 0;
    _indexSaveTimer = null;
    _indexSavePromise = null;
}

export default {
    WORKSPACE_FEATURE_THRESHOLD,
    WORKSPACE_CHUNK_SIZE,
    MAX_BUNDLE_FEATURES,
    KIT_ATTR_PART_SIZE,
    DB_VERSION,
    ATTR_LAYER_FEATURE_INDEX,
    createWorkspaceLayer,
    updateWorkspaceLayerMeta,
    appendWorkspaceBatch,
    attributeFeatureIndexRange,
    queryWorkspaceChunks,
    loadWorkspaceChunks,
    getWorkspaceFeatureRecord,
    getWorkspaceFeatureAttributes,
    iterateWorkspaceFeatures,
    loadAllWorkspaceFeatures,
    removeWorkspaceLayer,
    deleteWorkspaceFeatures,
    updateWorkspaceFeatureAttributes,
    updateWorkspaceFeatureAttributesBatch,
    detachFieldsForExport,
    getWorkspaceLayer,
    getWorkspaceLayerBounds,
    getWorkspaceLayerAttributes,
    loadWorkspaceAttributePage,
    loadWorkspaceAttributeRowsByIndices,
    scanWorkspaceAttributeMatches,
    getWorkspaceFeatureByIndex,
    getWorkspaceFeaturesByIndices,
    loadWorkspaceAttributeTablePage,
    exportWorkspaceLayerBundle,
    writeWorkspaceLayerToKitZip,
    importWorkspaceLayerFromParts,
    importWorkspaceLayerBundle,
    flushSpatialIndexSave,
    markSpatialIndexDirty,
    _getSpatialIndexPersistState,
    _resetWorkspaceCache
};
