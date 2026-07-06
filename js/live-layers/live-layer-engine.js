import { ArcGISRestImporter } from '../arcgis/rest-importer.js';
import { createSpatialDataset } from '../core/data-model.js';
import { inferServiceKind } from './catalog-schema.js';
import logger from '../core/logger.js';

const DEFAULT_REFRESH_MS = 300000;
const LAYER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

/**
 * @typedef {object} ServiceRuntime
 * @property {string} layerId
 * @property {string} sourceId
 * @property {string[]} mapLayerIds
 * @property {import('./catalog-schema.js').ServiceKind} kind
 * @property {string} url
 * @property {number} refreshMs
 * @property {number} [refreshTimer]
 * @property {import('geojson').FeatureCollection} [viewportCache]
 * @property {string} [lastError]
 * @property {number} colorIndex
 */

/** @type {WeakMap<object, Map<string, ServiceRuntime>>} */
const runtimeByManager = new WeakMap();

/**
 * @param {object} mapManager
 */
function getRuntimeMap(mapManager) {
    if (!runtimeByManager.has(mapManager)) {
        runtimeByManager.set(mapManager, new Map());
    }
    return runtimeByManager.get(mapManager);
}

/**
 * @param {string} url
 */
export function normalizeServiceUrl(url) {
    return String(url || '').trim().replace(/\/+$/, '').split('?')[0];
}

/**
 * @param {object} dataset
 * @param {string} [url]
 * @param {import('./catalog-schema.js').ServiceKind} [kind]
 */
export function createServiceLayerFromUrl(name, url, kind = inferServiceKind(url)) {
    const resolvedKind = kind || inferServiceKind(url) || 'geojson-feed';
    return {
        id: `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: name || 'Live Layer',
        type: 'service',
        visible: true,
        active: true,
        created: new Date().toISOString(),
        service: {
            kind: resolvedKind,
            url: normalizeServiceUrl(url),
            refreshMs: DEFAULT_REFRESH_MS,
            opacity: resolvedKind === 'arcgis-mapserver' || resolvedKind === 'wms' ? 0.85 : 1,
            attribution: ''
        },
        source: {
            format: 'live-service',
            url: normalizeServiceUrl(url)
        }
    };
}

/**
 * @param {object} mapManager
 * @param {object} dataset
 * @param {number} [colorIndex]
 * @param {{ fit?: boolean }} [options]
 */
export async function addServiceLayer(mapManager, dataset, colorIndex = 0, options = {}) {
    const map = mapManager.map;
    if (!map || dataset?.type !== 'service') return;

    removeServiceLayer(mapManager, dataset.id);

    const service = dataset.service || {};
    const kind = service.kind || inferServiceKind(service.url);
    const sourceId = `svc-src-${dataset.id}`;
    const runtime = /** @type {ServiceRuntime} */ ({
        layerId: dataset.id,
        sourceId,
        mapLayerIds: [],
        kind,
        url: normalizeServiceUrl(service.url),
        refreshMs: service.refreshMs || DEFAULT_REFRESH_MS,
        colorIndex,
        viewportCache: { type: 'FeatureCollection', features: [] }
    });

    const color = LAYER_COLORS[colorIndex % LAYER_COLORS.length];
    const opacity = service.opacity ?? (kind === 'arcgis-mapserver' || kind === 'wms' ? 0.85 : 1);

    try {
        if (kind === 'arcgis-mapserver' || kind === 'wms') {
            const tileUrl = buildRasterTileUrl(runtime, service);
            map.addSource(sourceId, {
                type: 'raster',
                tiles: [tileUrl],
                tileSize: 256
            });
            const layerId = `svc-lyr-${dataset.id}`;
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: { 'raster-opacity': opacity }
            });
            runtime.mapLayerIds = [layerId];
        } else {
            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            runtime.mapLayerIds = addVectorLayers(map, dataset.id, sourceId, color, opacity);
            await refreshServiceLayer(mapManager, dataset.id);
        }

        getRuntimeMap(mapManager).set(dataset.id, runtime);
        scheduleServiceRefresh(mapManager, dataset.id);

        if (options.fit) {
            const bounds = getDatasetBounds(dataset, runtime);
            if (bounds) {
                map.fitBounds(bounds, { padding: 40, duration: 0 });
            }
        }

        mapManager._layerNames?.set(dataset.id, dataset.name);
        logger.info('LiveLayer', 'Service layer added', { id: dataset.id, kind });
    } catch (error) {
        runtime.lastError = error?.message || 'Failed to add service layer';
        logger.warn('LiveLayer', runtime.lastError, { url: service.url });
        throw error;
    }
}

/**
 * @param {ServiceRuntime} runtime
 * @param {object} service
 */
function buildRasterTileUrl(runtime, service) {
    if (runtime.kind === 'wms') {
        const base = service.url.split('?')[0];
        const layers = service.layers || service.params?.layers || '';
        const sep = base.includes('?') ? '&' : '?';
        return `${base}${sep}service=WMS&version=1.1.1&request=GetMap&layers=${encodeURIComponent(layers)}&styles=&bbox={bbox-epsg-3857}&width=256&height=256&srs=EPSG:3857&format=image/png&transparent=true`;
    }
    return `${runtime.url}/tile/{z}/{y}/{x}`;
}

/**
 * @param {import('maplibre-gl').Map} map
 */
function addVectorLayers(map, datasetId, sourceId, color, opacity) {
    const ids = [];
    const polygonId = `svc-lyr-${datasetId}-fill`;
    const lineId = `svc-lyr-${datasetId}-line`;
    const pointId = `svc-lyr-${datasetId}-circle`;

    map.addLayer({
        id: polygonId,
        type: 'fill',
        source: sourceId,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        paint: {
            'fill-color': color,
            'fill-opacity': opacity * 0.35
        }
    });
    map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false],
        paint: {
            'line-color': color,
            'line-width': 2,
            'line-opacity': opacity
        }
    });
    map.addLayer({
        id: pointId,
        type: 'circle',
        source: sourceId,
        filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        paint: {
            'circle-color': color,
            'circle-radius': 5,
            'circle-opacity': opacity
        }
    });

    ids.push(polygonId, lineId, pointId);
    return ids;
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
export async function refreshServiceLayer(mapManager, layerId) {
    const map = mapManager.map;
    const runtime = getRuntimeMap(mapManager).get(layerId);
    if (!map || !runtime) return;

    if (runtime.kind === 'arcgis-mapserver' || runtime.kind === 'wms') {
        const source = map.getSource(runtime.sourceId);
        if (source && 'reload' in source) source.reload();
        return;
    }

    try {
        const geojson = await fetchVectorData(map, runtime);
        runtime.viewportCache = geojson;
        runtime.lastError = null;
        const source = map.getSource(runtime.sourceId);
        source?.setData?.(geojson);
    } catch (error) {
        runtime.lastError = error?.message || 'Refresh failed';
        logger.warn('LiveLayer', runtime.lastError, { layerId, url: runtime.url });
    }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {ServiceRuntime} runtime
 */
async function fetchVectorData(map, runtime) {
    if (runtime.kind === 'geojson-feed') {
        const resp = await fetch(runtime.url);
        if (!resp.ok) throw new Error(`GeoJSON feed failed (${resp.status})`);
        const data = await resp.json();
        if (data?.type === 'FeatureCollection') return data;
        if (data?.type === 'Feature') return { type: 'FeatureCollection', features: [data] };
        return { type: 'FeatureCollection', features: [] };
    }

    if (runtime.kind === 'arcgis-featureserver') {
        return fetchArcgisFeatureServerViewport(map, runtime.url);
    }

    return { type: 'FeatureCollection', features: [] };
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} url
 */
async function fetchArcgisFeatureServerViewport(map, url) {
    const bounds = map.getBounds();
    const importer = new ArcGISRestImporter();
    const cleanUrl = importer.normalizeUrl(url);
    const geometry = {
        xmin: bounds.getWest(),
        ymin: bounds.getSouth(),
        xmax: bounds.getEast(),
        ymax: bounds.getNorth(),
        spatialReference: { wkid: 4326 }
    };
    const params = new URLSearchParams({
        f: 'geojson',
        where: '1=1',
        geometry: JSON.stringify(geometry),
        geometryType: 'esriGeometryEnvelope',
        inSR: '4326',
        outSR: '4326',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: 'true'
    });

    const resp = await fetch(`${cleanUrl}/query?${params}`);
    if (!resp.ok) throw new Error(`FeatureServer query failed (${resp.status})`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'FeatureServer query error');
    if (data.type === 'FeatureCollection') return data;
    return { type: 'FeatureCollection', features: [] };
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
function scheduleServiceRefresh(mapManager, layerId) {
    const runtime = getRuntimeMap(mapManager).get(layerId);
    if (!runtime?.refreshMs) return;
    if (runtime.refreshTimer) window.clearInterval(runtime.refreshTimer);
    runtime.refreshTimer = window.setInterval(() => {
        void refreshServiceLayer(mapManager, layerId);
    }, runtime.refreshMs);
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
export function removeServiceLayer(mapManager, layerId) {
    const map = mapManager.map;
    const runtime = getRuntimeMap(mapManager).get(layerId);
    if (!runtime) return;

    if (runtime.refreshTimer) window.clearInterval(runtime.refreshTimer);

    if (map) {
        for (const id of runtime.mapLayerIds) {
            if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getSource(runtime.sourceId)) map.removeSource(runtime.sourceId);
    }

    getRuntimeMap(mapManager).delete(layerId);
    mapManager._layerNames?.delete(layerId);
}

/**
 * @param {object} mapManager
 */
export function refreshAllVectorServiceLayers(mapManager) {
    for (const [layerId, runtime] of getRuntimeMap(mapManager)) {
        if (runtime.kind === 'arcgis-featureserver' || runtime.kind === 'geojson-feed' || runtime.kind === 'wfs') {
            void refreshServiceLayer(mapManager, layerId);
        }
    }
}

/**
 * @param {object} dataset
 * @param {ServiceRuntime} runtime
 */
function getDatasetBounds(dataset, runtime) {
    const features = runtime.viewportCache?.features || [];
    if (!features.length || typeof globalThis.turf === 'undefined') return null;
    try {
        const bbox = globalThis.turf.bbox({ type: 'FeatureCollection', features });
        return [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    } catch {
        return null;
    }
}

/**
 * @param {object} mapManager
 * @param {object} dataset
 */
export function materializeServiceLayerViewport(mapManager, dataset) {
    const runtime = getRuntimeMap(mapManager).get(dataset.id);
    if (!runtime?.viewportCache?.features?.length) {
        throw new Error('No features in the current viewport to materialize. Pan/zoom to load data first.');
    }
    if (runtime.kind === 'arcgis-mapserver' || runtime.kind === 'wms') {
        throw new Error('Raster service layers are visual overlays only. Materialize is not available.');
    }

    return createSpatialDataset(
        `${dataset.name} (snapshot)`,
        {
            type: 'FeatureCollection',
            features: runtime.viewportCache.features.map((f) => structuredClone(f))
        },
        {
            format: 'live-service-snapshot',
            sourceLayerId: dataset.id,
            url: runtime.url
        }
    );
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
export function getServiceLayerRuntime(mapManager, layerId) {
    return getRuntimeMap(mapManager).get(layerId) || null;
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 * @param {boolean} visible
 */
export function toggleServiceLayer(mapManager, layerId, visible) {
    const map = mapManager.map;
    const runtime = getRuntimeMap(mapManager).get(layerId);
    if (!map || !runtime) return;
    const visibility = visible ? 'visible' : 'none';
    for (const id of runtime.mapLayerIds) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
    }
}

export function isServiceLayerDataset(dataset) {
    return dataset?.type === 'service';
}
