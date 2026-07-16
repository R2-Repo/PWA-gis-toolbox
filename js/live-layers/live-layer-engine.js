import { ArcGISRestImporter, schemaFromArcgisMetadata } from '../arcgis/rest-importer.js';
import { analyzeSchema, createSpatialDataset } from '../core/data-model.js';
import { getLayers } from '../core/state.js';
import bus from '../core/event-bus.js';
import { compilePaint, getBaseFlatStyle } from '../map/style-engine.js';
import { RENDER_LIMITS } from '../map/render-limits.js';
import { inferServiceKind } from './catalog-schema.js';
import { resolveServiceLayerStyle, scalePaintOpacity } from './live-layer-styles.js';
import {
    applyRenderLimits,
    isVectorServiceKind,
    pruneSelectionToViewport,
    tagServiceFeatures
} from './live-layer-viewport.js';
import logger from '../core/logger.js';

export {
    VECTOR_SERVICE_KINDS,
    isVectorServiceKind,
    applyRenderLimits,
    tagServiceFeatures,
    resolveStableFeatureIndex,
    pruneSelectionToViewport
} from './live-layer-viewport.js';

const DEFAULT_REFRESH_MS = 300000;

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
 * @property {string} [objectIdField]
 * @property {boolean} [truncated]
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
export function createServiceLayerFromUrl(name, url, kind = inferServiceKind(url), style = null) {
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
            attribution: '',
            ...(style ? { style } : {})
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
        objectIdField: service.objectIdField || 'OBJECTID',
        truncated: false,
        viewportCache: { type: 'FeatureCollection', features: [] }
    });

    const opacity = service.opacity ?? (kind === 'arcgis-mapserver' || kind === 'wms' ? 0.85 : 1);
    const layerStyle = resolveServiceLayerStyle(service, colorIndex);

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
            getRuntimeMap(mapManager).set(dataset.id, runtime);
            scheduleServiceRefresh(mapManager, dataset.id);
        } else {
            if (kind === 'arcgis-featureserver') {
                await ensureFeatureServerMetadata(dataset, runtime);
            }

            if (!dataset.geojson) {
                dataset.geojson = { type: 'FeatureCollection', features: [] };
            }

            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            runtime.mapLayerIds = addVectorLayers(map, dataset.id, sourceId, layerStyle, opacity);

            mapManager.dataLayers.set(dataset.id, {
                sourceId,
                layerIds: runtime.mapLayerIds,
                chunkSources: [{ sourceId, layerIds: runtime.mapLayerIds }],
                colorIndex,
                geojson: dataset.geojson,
                liveService: true,
                scaleRange: null
            });

            const styFlat = getBaseFlatStyle(layerStyle, 'point');
            mapManager._layerStyles?.set(dataset.id, layerStyle);
            mapManager._bindLayerClickHandlers?.(dataset, runtime.mapLayerIds, styFlat);

            getRuntimeMap(mapManager).set(dataset.id, runtime);
            await refreshServiceLayer(mapManager, dataset.id);
            scheduleServiceRefresh(mapManager, dataset.id);
        }

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
        removeServiceLayer(mapManager, dataset.id);
        throw error;
    }
}

/**
 * @param {object} dataset
 * @param {ServiceRuntime} runtime
 */
async function ensureFeatureServerMetadata(dataset, runtime) {
    try {
        const importer = new ArcGISRestImporter();
        const metadata = await importer.fetchMetadata(runtime.url);
        runtime.objectIdField = metadata.objectIdField || 'OBJECTID';
        if (dataset.service) {
            dataset.service.objectIdField = runtime.objectIdField;
            dataset.service.maxRecordCount = metadata.maxRecordCount || 1000;
        }
        if (!dataset.schema?.fields?.length) {
            dataset.schema = schemaFromArcgisMetadata(metadata);
        }
    } catch (error) {
        logger.warn('LiveLayer', 'Metadata fetch failed; continuing with defaults', {
            url: runtime.url,
            error: error?.message
        });
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
 * @param {ReturnType<typeof resolveServiceLayerStyle>} layerStyle
 */
function addVectorLayers(map, datasetId, sourceId, layerStyle, opacity) {
    const ids = [];
    const polygonId = `svc-lyr-${datasetId}-fill`;
    const lineId = `svc-lyr-${datasetId}-line`;
    const pointId = `svc-lyr-${datasetId}-circle`;
    const styPoly = compilePaint(layerStyle, 'polygon');
    const styLine = compilePaint(layerStyle, 'line');
    const styPoint = compilePaint(layerStyle, 'point');

    map.addLayer({
        id: polygonId,
        type: 'fill',
        source: sourceId,
        filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        paint: {
            'fill-color': styPoly.fillColor,
            'fill-opacity': scalePaintOpacity(styPoly.fillOpacity, opacity * 0.35)
        }
    });
    map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'], true, false],
        paint: {
            'line-color': styLine.strokeColor,
            'line-width': styLine.strokeWidth,
            'line-opacity': scalePaintOpacity(styLine.strokeOpacity, opacity)
        }
    });
    map.addLayer({
        id: pointId,
        type: 'circle',
        source: sourceId,
        filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        paint: {
            'circle-radius': styPoint.circleRadius,
            'circle-color': styPoint.fillColor,
            'circle-stroke-color': styPoint.strokeColor,
            'circle-stroke-width': styPoint.strokeWidth,
            'circle-opacity': scalePaintOpacity(styPoint.fillOpacity, opacity)
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
        const raw = await fetchVectorData(map, runtime);
        const limited = applyRenderLimits(raw.features || []);
        const tagged = tagServiceFeatures(layerId, limited.features, runtime.objectIdField);
        const geojson = { type: 'FeatureCollection', features: tagged };

        runtime.viewportCache = geojson;
        runtime.truncated = limited.truncated || !!raw.truncated;
        runtime.lastError = null;

        const dataset = getLayers().find((layer) => layer.id === layerId) || null;
        if (dataset) {
            dataset.geojson = geojson;
            if (!dataset.schema?.fields?.length) {
                dataset.schema = analyzeSchema(geojson);
            } else {
                dataset.schema = {
                    ...dataset.schema,
                    featureCount: tagged.length,
                    geometryType: dataset.schema.geometryType || analyzeSchema(geojson).geometryType
                };
            }
            if (runtime.truncated) {
                dataset._viewportTruncated = true;
            } else {
                delete dataset._viewportTruncated;
            }
            bus.emit('layer:updated', dataset);
        }

        const entry = mapManager.dataLayers?.get(layerId);
        if (entry) {
            entry.geojson = geojson;
        }

        const source = map.getSource(runtime.sourceId);
        source?.setData?.(geojson);

        reconcileLiveSelection(mapManager, layerId, tagged);

        if (runtime.truncated) {
            logger.warn('LiveLayer', 'Viewport truncated to render limits', {
                layerId,
                features: tagged.length,
                maxFeatures: RENDER_LIMITS.maxFeaturesPerSource
            });
        }
    } catch (error) {
        runtime.lastError = error?.message || 'Refresh failed';
        logger.warn('LiveLayer', runtime.lastError, { layerId, url: runtime.url });
    }
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 * @param {object[]} taggedFeatures
 */
function reconcileLiveSelection(mapManager, layerId, taggedFeatures) {
    const sel = mapManager._selections?.get(layerId);
    if (!sel?.size) return;

    const next = pruneSelectionToViewport(sel, taggedFeatures);
    if (next.length !== sel.size) {
        if (next.length) {
            mapManager.selectFeatures?.(layerId, next);
        } else {
            mapManager.clearSelection?.(layerId);
        }
        return;
    }
    mapManager._renderSelectionHighlights?.(layerId);
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
        return fetchArcgisFeatureServerViewport(map, runtime);
    }

    return { type: 'FeatureCollection', features: [] };
}

/**
 * Viewport envelope query with pagination until transfer limit clears or render budget is hit.
 * @param {import('maplibre-gl').Map} map
 * @param {ServiceRuntime} runtime
 */
async function fetchArcgisFeatureServerViewport(map, runtime) {
    const bounds = map.getBounds();
    const importer = new ArcGISRestImporter();
    const cleanUrl = importer.normalizeUrl(runtime.url);
    const geometry = {
        xmin: bounds.getWest(),
        ymin: bounds.getSouth(),
        xmax: bounds.getEast(),
        ymax: bounds.getNorth(),
        spatialReference: { wkid: 4326 }
    };

    const pageSize = 1000;
    let offset = 0;
    const features = [];
    let truncated = false;

    while (features.length < RENDER_LIMITS.maxFeaturesPerSource) {
        const remaining = RENDER_LIMITS.maxFeaturesPerSource - features.length;
        const params = new URLSearchParams({
            f: 'geojson',
            where: '1=1',
            geometry: JSON.stringify(geometry),
            geometryType: 'esriGeometryEnvelope',
            inSR: '4326',
            outSR: '4326',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: 'true',
            resultOffset: String(offset),
            resultRecordCount: String(Math.min(pageSize, remaining))
        });

        const resp = await fetch(`${cleanUrl}/query?${params}`);
        if (!resp.ok) throw new Error(`FeatureServer query failed (${resp.status})`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message || 'FeatureServer query error');

        const page = data.type === 'FeatureCollection' ? (data.features || []) : [];
        features.push(...page);

        const exceeded = data.exceededTransferLimit === true || data.properties?.exceededTransferLimit === true;
        if (!page.length || !exceeded) break;

        offset += page.length;
        if (features.length >= RENDER_LIMITS.maxFeaturesPerSource) {
            truncated = true;
            break;
        }
    }

    return { type: 'FeatureCollection', features, truncated };
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

    if (runtime?.refreshTimer) window.clearInterval(runtime.refreshTimer);

    if (runtime && map) {
        for (const id of runtime.mapLayerIds) {
            if (map.getLayer(id)) map.removeLayer(id);
            mapManager._boundClickLayers?.delete(id);
        }
        if (map.getSource(runtime.sourceId)) map.removeSource(runtime.sourceId);
    }

    mapManager.dataLayers?.delete(layerId);
    getRuntimeMap(mapManager).delete(layerId);
    mapManager._layerNames?.delete(layerId);
    mapManager._layerStyles?.delete(layerId);
}

/**
 * @param {object} mapManager
 */
export function refreshAllVectorServiceLayers(mapManager) {
    for (const [layerId, runtime] of getRuntimeMap(mapManager)) {
        if (isVectorServiceKind(runtime.kind)) {
            void refreshServiceLayer(mapManager, layerId);
        }
    }
}

/**
 * @param {object} dataset
 * @param {ServiceRuntime} runtime
 */
function getDatasetBounds(dataset, runtime) {
    const features = runtime.viewportCache?.features || dataset?.geojson?.features || [];
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
    const features = runtime?.viewportCache?.features?.length
        ? runtime.viewportCache.features
        : dataset?.geojson?.features;
    if (!features?.length) {
        throw new Error('No features in the current viewport to materialize. Pan/zoom to load data first.');
    }
    if (runtime?.kind === 'arcgis-mapserver' || runtime?.kind === 'wms' || dataset?.service?.kind === 'arcgis-mapserver' || dataset?.service?.kind === 'wms') {
        throw new Error('Raster service layers are visual overlays only. Materialize is not available.');
    }

    return createSpatialDataset(
        `${dataset.name} (snapshot)`,
        {
            type: 'FeatureCollection',
            features: features.map((f) => structuredClone(f))
        },
        {
            format: 'live-service-snapshot',
            sourceLayerId: dataset.id,
            url: runtime?.url || dataset.service?.url
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
