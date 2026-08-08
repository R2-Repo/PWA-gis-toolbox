/**
 * Firewatch composite runtime — shared Utah fetch + per-part MapLibre sources.
 */
import { analyzeSchema } from '../../core/data-model.js';
import { getLayers } from '../../core/state.js';
import bus from '../../core/event-bus.js';
import { tagServiceFeatures } from '../live-layer-viewport.js';
import logger from '../../core/logger.js';
import {
    FIREWATCH_KIND,
    FIREWATCH_REFRESH_MS,
    UTAH_QUERY_ENVELOPE
} from './constants.js';
import { fetchFirewatchUtahCollections } from './fetch.js';
import {
    addFirewatchPartLayers,
    interactiveLayerIdsForPart,
    orderFirewatchLayers
} from './paint.js';

/** @type {Map<string, FirewatchSession>} */
const sessionsByKey = new Map();

/**
 * @typedef {object} FirewatchPartRuntime
 * @property {string} layerId
 * @property {string} sourceId
 * @property {string[]} mapLayerIds
 * @property {import('./constants.js').FirewatchPart} part
 * @property {number} colorIndex
 * @property {import('geojson').FeatureCollection} [viewportCache]
 * @property {string} [lastError]
 * @property {string} kind
 * @property {string} url
 * @property {number} refreshMs
 * @property {string} objectIdField
 * @property {boolean} truncated
 * @property {string} sessionKey
 */

/**
 * @typedef {object} FirewatchSession
 * @property {string} key
 * @property {object} mapManager
 * @property {Map<string, FirewatchPartRuntime>} parts
 * @property {number} [refreshTimer]
 * @property {number} [refreshDebounce]
 * @property {Promise<void>} [inflight]
 * @property {boolean} [pendingRefresh]
 * @property {boolean} [disposed]
 */

/**
 * @param {object} dataset
 */
export function isFirewatchDataset(dataset) {
    return dataset?.service?.kind === FIREWATCH_KIND
        || dataset?.service?.firewatchPart != null;
}

/**
 * @param {object} dataset
 * @returns {import('./constants.js').FirewatchPart | null}
 */
export function resolveFirewatchPart(dataset) {
    const part = dataset?.service?.firewatchPart;
    if (part === 'perimeters' || part === 'incidents' || part === 'viirs' || part === 'modis' || part === 'noaa') {
        return part;
    }
    if (part === 'hotspots') return 'viirs';
    const preset = dataset?.service?.presetId || '';
    if (preset.includes('perimeter')) return 'perimeters';
    if (preset.includes('incident')) return 'incidents';
    if (preset.includes('viirs')) return 'viirs';
    if (preset.includes('modis')) return 'modis';
    if (preset.includes('noaa')) return 'noaa';
    if (preset.includes('hotspot')) return 'viirs';
    return null;
}

/**
 * @param {object} dataset
 */
function sessionKeyFor(dataset) {
    return dataset?.service?.firewatchSessionKey
        || dataset?.groupId
        || dataset?.service?.presetId
        || 'firewatch';
}

/**
 * @param {object} mapManager
 * @param {object} dataset
 * @param {number} [colorIndex]
 * @param {{ fit?: boolean, registerRuntime?: (layerId: string, runtime: object) => void }} [options]
 */
export async function addFirewatchPart(mapManager, dataset, colorIndex = 0, options = {}) {
    const map = mapManager.map;
    const part = resolveFirewatchPart(dataset);
    if (!map || !part) {
        throw new Error('Firewatch part is missing or invalid');
    }

    const key = sessionKeyFor(dataset);
    let session = sessionsByKey.get(key);
    if (!session || session.disposed) {
        session = { key, mapManager, parts: new Map(), disposed: false };
        sessionsByKey.set(key, session);
    } else {
        session.mapManager = mapManager;
    }

    const existing = [...session.parts.values()].find((p) => p.part === part || p.layerId === dataset.id);
    if (existing) {
        removeFirewatchPartInternal(mapManager, session, existing.layerId);
    }

    const sourceId = `svc-src-${dataset.id}`;
    const opacity = dataset.service?.opacity ?? 1;

    if (map.getSource(sourceId)) {
        try { map.removeSource(sourceId); } catch { /* ignore */ }
    }

    map.addSource(sourceId, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });

    const mapLayerIds = await addFirewatchPartLayers(map, dataset.id, sourceId, part, opacity);

    /** @type {FirewatchPartRuntime} */
    const runtime = {
        layerId: dataset.id,
        sourceId,
        mapLayerIds,
        part,
        colorIndex,
        kind: FIREWATCH_KIND,
        url: dataset.service?.url || '',
        refreshMs: dataset.service?.refreshMs || FIREWATCH_REFRESH_MS,
        objectIdField: part === 'noaa' ? 'FID' : 'OBJECTID',
        truncated: false,
        viewportCache: { type: 'FeatureCollection', features: [] },
        sessionKey: key
    };

    session.parts.set(dataset.id, runtime);
    options.registerRuntime?.(dataset.id, runtime);

    if (!dataset.geojson) {
        dataset.geojson = { type: 'FeatureCollection', features: [] };
    }

    mapManager.dataLayers.set(dataset.id, {
        sourceId,
        layerIds: mapLayerIds,
        chunkSources: [{ sourceId, layerIds: mapLayerIds }],
        colorIndex,
        geojson: dataset.geojson,
        liveService: true,
        scaleRange: null,
        firewatchPart: part,
        interactiveLayerIds: interactiveLayerIdsForPart(dataset.id, part)
    });

    mapManager._layerNames?.set(dataset.id, dataset.name);

    const clickIds = interactiveLayerIdsForPart(dataset.id, part);
    if (clickIds.length) {
        mapManager._bindLayerClickHandlers?.(dataset, clickIds, {
            strokeColor: '#ff6a3d',
            fillColor: '#ff6a3d',
            pointSize: 8
        });
    }

    orderFirewatchLayers(map, session.parts);
    scheduleSessionRefresh(session);
    queueSessionRefresh(session);

    if (options.fit) {
        fitUtahEnvelope(map);
    }

    logger.info('Firewatch', 'Part added', { id: dataset.id, part, session: key, layers: mapLayerIds.length });
    return runtime;
}

/**
 * @param {FirewatchSession} session
 */
function scheduleSessionRefresh(session) {
    if (session.refreshTimer) window.clearInterval(session.refreshTimer);
    const refreshMs = [...session.parts.values()][0]?.refreshMs || FIREWATCH_REFRESH_MS;
    session.refreshTimer = window.setInterval(() => {
        void refreshFirewatchSession(session);
    }, refreshMs);
}

/**
 * @param {FirewatchSession} session
 * @param {number} [delayMs]
 */
function queueSessionRefresh(session, delayMs = 80) {
    if (session.refreshDebounce) window.clearTimeout(session.refreshDebounce);
    session.refreshDebounce = window.setTimeout(() => {
        session.refreshDebounce = null;
        void refreshFirewatchSession(session);
    }, delayMs);
}

/**
 * Force an immediate Firewatch data load after the full group is on the map.
 * @param {string} sessionKey
 */
export async function flushFirewatchSession(sessionKey) {
    const session = sessionsByKey.get(sessionKey);
    if (!session || session.disposed) {
        logger.warn('Firewatch', 'flush: session not found', { sessionKey });
        return;
    }
    if (session.refreshDebounce) {
        window.clearTimeout(session.refreshDebounce);
        session.refreshDebounce = null;
    }
    await refreshFirewatchSession(session);
    if (session.mapManager?.map) {
        orderFirewatchLayers(session.mapManager.map, session.parts);
    }

    const counts = {};
    for (const runtime of session.parts.values()) {
        counts[runtime.part] = runtime.viewportCache?.features?.length || 0;
    }
    logger.info('Firewatch', 'Session flushed', { sessionKey, counts });
}

/**
 * Re-apply Firewatch draw order after panel syncLayerOrder.
 * @param {string} sessionKey
 */
export function orderFirewatchLayersForSession(sessionKey) {
    const session = sessionsByKey.get(sessionKey);
    if (!session?.mapManager?.map) return;
    orderFirewatchLayers(session.mapManager.map, session.parts);
}

/**
 * @param {FirewatchSession} session
 */
export async function refreshFirewatchSession(session) {
    if (!session || session.disposed || !session.parts.size) return;
    if (session.inflight) {
        session.pendingRefresh = true;
        return session.inflight;
    }

    session.inflight = (async () => {
        try {
            do {
                session.pendingRefresh = false;
                const collections = await fetchFirewatchUtahCollections();
                applyCollectionsToSession(session, collections);
            } while (session.pendingRefresh && !session.disposed);
        } catch (error) {
            const message = error?.message || 'Firewatch refresh failed';
            logger.warn('Firewatch', message);
            for (const runtime of session.parts.values()) {
                runtime.lastError = message;
            }
            throw error;
        } finally {
            session.inflight = null;
        }
    })();

    return session.inflight;
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
export async function refreshFirewatchPart(mapManager, layerId) {
    const session = findSessionForLayer(layerId);
    if (!session) return;
    return refreshFirewatchSession(session);
}

/**
 * @param {FirewatchSession} session
 * @param {{ perimeters: object, incidents: object, viirs: object, modis: object, noaa: object }} collections
 */
function applyCollectionsToSession(session, collections) {
    const mapManager = session.mapManager;
    const map = mapManager?.map;
    if (!map) return;

    for (const runtime of session.parts.values()) {
        const fc = collections[runtime.part];
        if (!fc) {
            logger.warn('Firewatch', 'No collection for part', { part: runtime.part });
            continue;
        }

        const tagged = tagServiceFeatures(runtime.layerId, fc.features || [], runtime.objectIdField);
        const geojson = { type: 'FeatureCollection', features: tagged };
        runtime.viewportCache = geojson;
        runtime.lastError = null;
        runtime.truncated = false;

        const dataset = getLayers().find((layer) => layer.id === runtime.layerId) || null;
        if (dataset) {
            dataset.geojson = geojson;
            dataset.schema = analyzeSchema(geojson);
            bus.emit('layer:updated', dataset);
        }

        const entry = mapManager.dataLayers?.get(runtime.layerId);
        if (entry) entry.geojson = geojson;

        const source = map.getSource(runtime.sourceId);
        if (source?.setData) {
            source.setData(geojson);
        } else {
            logger.warn('Firewatch', 'Missing source for setData', {
                part: runtime.part,
                sourceId: runtime.sourceId
            });
        }
    }
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
export function removeFirewatchPart(mapManager, layerId) {
    const session = findSessionForLayer(layerId);
    if (!session) return false;
    removeFirewatchPartInternal(mapManager, session, layerId);
    if (!session.parts.size) {
        if (session.refreshTimer) window.clearInterval(session.refreshTimer);
        if (session.refreshDebounce) window.clearTimeout(session.refreshDebounce);
        session.disposed = true;
        sessionsByKey.delete(session.key);
    } else if (mapManager.map) {
        orderFirewatchLayers(mapManager.map, session.parts);
    }
    return true;
}

/**
 * @param {object} mapManager
 * @param {FirewatchSession} session
 * @param {string} layerId
 */
function removeFirewatchPartInternal(mapManager, session, layerId) {
    const map = mapManager.map;
    const runtime = session.parts.get(layerId);
    if (!runtime) return;

    if (map) {
        for (const id of runtime.mapLayerIds) {
            if (map.getLayer(id)) map.removeLayer(id);
            mapManager._boundClickLayers?.delete(id);
        }
        if (map.getSource(runtime.sourceId)) map.removeSource(runtime.sourceId);
    }

    mapManager.dataLayers?.delete(layerId);
    mapManager._layerNames?.delete(layerId);
    mapManager._layerStyles?.delete(layerId);
    session.parts.delete(layerId);
}

/**
 * @param {string} layerId
 */
function findSessionForLayer(layerId) {
    for (const session of sessionsByKey.values()) {
        if (session.parts.has(layerId)) return session;
    }
    return null;
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 * @param {boolean} visible
 */
export function toggleFirewatchPart(mapManager, layerId, visible) {
    const session = findSessionForLayer(layerId);
    const runtime = session?.parts.get(layerId);
    const map = mapManager.map;
    if (!map || !runtime) return false;
    const visibility = visible ? 'visible' : 'none';
    for (const id of runtime.mapLayerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
    return true;
}

/**
 * @param {import('maplibre-gl').Map} map
 */
export function fitUtahEnvelope(map) {
    if (!map) return;
    const { xmin, ymin, xmax, ymax } = UTAH_QUERY_ENVELOPE;
    try {
        map.fitBounds([[xmin, ymin], [xmax, ymax]], { padding: 40, duration: 0 });
    } catch {
        /* ignore */
    }
}

export function getUtahFitBounds() {
    const { xmin, ymin, xmax, ymax } = UTAH_QUERY_ENVELOPE;
    return [[xmin, ymin], [xmax, ymax]];
}
