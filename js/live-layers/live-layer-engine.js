import { ArcGISRestImporter, schemaFromArcgisMetadata } from '../arcgis/rest-importer.js';
import { styleFromArcgisMetadata } from '../arcgis/drawing-info.js';
import {
    pictureMarkersFromDrawingInfo,
    registerPictureMarkers
} from '../arcgis/picture-markers.js';
import { analyzeSchema, createSpatialDataset } from '../core/data-model.js';
import { getLayers } from '../core/state.js';
import bus from '../core/event-bus.js';
import { compilePaint, getBaseFlatStyle } from '../map/style-engine.js';
import { RENDER_LIMITS } from '../map/render-limits.js';
import { buildMapLabelLayerSpec, resolveLayerLabels } from '../map/map-labels.js';
import { inferServiceKind } from './catalog-schema.js';
import { resolveServiceLayerStyle, scalePaintOpacity } from './live-layer-styles.js';
import {
    applyRenderLimits,
    isVectorServiceKind,
    pruneSelectionToViewport,
    tagServiceFeatures
} from './live-layer-viewport.js';
import { decorateUdotFiberPointFeatures } from '../symbology/udot-fiber/glyphs.js';
import { matchUdotFiberLayerUrl } from '../symbology/udot-fiber/constants.js';
import { addUdotFiberVectorLayers } from '../symbology/udot-fiber/paint.js';
import {
    groupUdotFiberMapLayerIds,
    orderUdotFiberLayers
} from '../symbology/udot-fiber/draw-order.js';
import { applyUdotFiberDisplayOffsets } from '../symbology/udot-fiber/display-offsets.js';
import {
    buildUdotFiberExcludeWhere,
    filterUdotFiberDisplayFeatures
} from '../symbology/udot-fiber/display-filters.js';
import {
    envelopeFromMapBounds,
    isLiveLayerInRange,
    padEnvelope,
    resolveLiveRefreshMs,
    resolveLiveViewportAction
} from './live-layer-cache.js';
import { queryArcgisVectorEnvelope } from './arcgis-vector-query.js';
import logger from '../core/logger.js';
import {
    addFirewatchPart,
    isFirewatchDataset,
    refreshFirewatchPart,
    removeFirewatchPart,
    toggleFirewatchPart
} from './firewatch/runtime.js';
import { FIREWATCH_KIND } from './firewatch/constants.js';

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
 * @property {number|null} [minZoom]
 * @property {import('./live-layer-cache.js').LngLatEnvelope|null} [lastEnvelope]
 * @property {number} [fetchGen]
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
            refreshMs: resolveLiveRefreshMs(undefined, DEFAULT_REFRESH_MS),
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

    if (kind === FIREWATCH_KIND || isFirewatchDataset(dataset)) {
        const runtime = await addFirewatchPart(mapManager, dataset, colorIndex, {
            fit: options.fit,
            registerRuntime: (layerId, fwRuntime) => {
                getRuntimeMap(mapManager).set(layerId, fwRuntime);
            }
        });
        logger.info('LiveLayer', 'Service layer added', { id: dataset.id, kind: FIREWATCH_KIND });
        return runtime;
    }

    const sourceId = `svc-src-${dataset.id}`;
    const runtime = /** @type {ServiceRuntime} */ ({
        layerId: dataset.id,
        sourceId,
        mapLayerIds: [],
        kind,
        url: normalizeServiceUrl(service.url),
        refreshMs: resolveLiveRefreshMs(service.refreshMs, DEFAULT_REFRESH_MS),
        minZoom: Number.isFinite(Number(service.minZoom)) ? Number(service.minZoom) : null,
        colorIndex,
        objectIdField: service.objectIdField || 'OBJECTID',
        truncated: false,
        viewportCache: { type: 'FeatureCollection', features: [] },
        lastEnvelope: null,
        fetchGen: 0,
        metadataReady: false
    });

    const opacity = service.opacity ?? (kind === 'arcgis-mapserver' || kind === 'wms' ? 0.85 : 1);

    const layerStyle = resolveServiceLayerStyle(dataset.service || service, colorIndex);

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
            if (!dataset.geojson) {
                dataset.geojson = { type: 'FeatureCollection', features: [] };
            }

            map.addSource(sourceId, {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            runtime.mapLayerIds = addVectorLayers(map, dataset.id, sourceId, layerStyle, opacity, {
                serviceUrl: runtime.url,
                minZoom: runtime.minZoom
            });
            if (runtime.minZoom != null) {
                mapManager._applyZoomRangeToLayerIds?.(runtime.mapLayerIds, {
                    minzoom: runtime.minZoom,
                    maxzoom: 24
                }, resolveLayerLabels(layerStyle, dataset));
            }

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
        if (matchUdotFiberLayerUrl(runtime.url)) {
            orderUdotFiberLiveLayers(mapManager);
        }
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
async function ensureFeatureServerMetadata(dataset, runtime, map = null) {
    try {
        const importer = new ArcGISRestImporter();
        const metadata = await importer.fetchMetadata(runtime.url);
        runtime.objectIdField = metadata.objectIdField || 'OBJECTID';
        runtime.drawingInfo = metadata.drawingInfo || null;
        const fiberHit = matchUdotFiberLayerUrl(runtime.url);
        runtime.pictureMarkers = fiberHit
            ? { field: null, markers: [] }
            : pictureMarkersFromDrawingInfo(metadata.drawingInfo);
        if (!fiberHit && map && runtime.pictureMarkers.markers.length) {
            await registerPictureMarkers(map, runtime.pictureMarkers);
        }
        if (dataset.service) {
            dataset.service.objectIdField = runtime.objectIdField;
            dataset.service.maxRecordCount = metadata.maxRecordCount || 1000;
            if (!dataset.service.style) {
                const style = styleFromArcgisMetadata(metadata);
                if (style) dataset.service.style = style;
            }
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
 * @param {string} datasetId
 * @param {string} sourceId
 * @param {ReturnType<typeof resolveServiceLayerStyle>} layerStyle
 * @param {number} opacity
 * @param {{ serviceUrl?: string, minZoom?: number|null }} [opts]
 */
function addVectorLayers(map, datasetId, sourceId, layerStyle, opacity, opts = {}) {
    const ids = [];
    const polygonId = `svc-lyr-${datasetId}-fill`;
    const lineId = `svc-lyr-${datasetId}-line`;
    const pointId = `svc-lyr-${datasetId}-circle`;
    const styPoly = compilePaint(layerStyle, 'polygon');
    const styLine = compilePaint(layerStyle, 'line');
    const styPoint = compilePaint(layerStyle, 'point');
    const udotMatch = matchUdotFiberLayerUrl(opts.serviceUrl);
    const fiberKey = udotMatch?.key;
    const minzoom = Number.isFinite(Number(opts.minZoom)) ? Number(opts.minZoom) : undefined;

    if (udotMatch) {
        return addUdotFiberVectorLayers(map, datasetId, sourceId, layerStyle, opacity, {
            fiberKey,
            minZoom: minzoom
        });
    }

    map.addLayer({
        id: polygonId,
        type: 'fill',
        source: sourceId,
        ...(minzoom != null ? { minzoom } : {}),
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
        ...(minzoom != null ? { minzoom } : {}),
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
        ...(minzoom != null ? { minzoom } : {}),
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

    const labelCfg = resolveLayerLabels(layerStyle, null);
    if (labelCfg) {
        const labelSpec = buildMapLabelLayerSpec(datasetId, sourceId, labelCfg, false);
        if (labelSpec) {
            labelSpec.id = `svc-${labelSpec.id}`;
            if (layerStyle?.labels?.color != null) {
                labelSpec.paint = {
                    ...labelSpec.paint,
                    'text-color': layerStyle.labels.color
                };
            }
            if (minzoom != null) {
                labelSpec.minzoom = Math.max(Number(labelSpec.minzoom) || 0, minzoom);
            }
            map.addLayer(labelSpec);
            ids.push(labelSpec.id);
        }
    }

    return ids;
}

/**
 * Stamp procedural glyph image ids onto UDOT Fiber point features.
 * @param {string} serviceUrl
 * @param {object[]} features
 * @param {import('maplibre-gl').Map} map
 */
function decorateUdotFiberGlyphProps(serviceUrl, features, map) {
    const match = matchUdotFiberLayerUrl(serviceUrl);
    if (!match || !features?.length) return features;
    return decorateUdotFiberPointFeatures(match.key, features, map);
}

/**
 * @param {object} mapManager
 * @param {string} layerId
 */
/**
 * @param {import('maplibre-gl').Map} map
 * @param {ServiceRuntime} runtime
 * @param {boolean} visible
 */
function applyLiveLayerVisibility(map, runtime, visible) {
    const vis = visible ? 'visible' : 'none';
    for (const id of runtime.mapLayerIds || []) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    }
}

export async function refreshServiceLayer(mapManager, layerId) {
    const map = mapManager.map;
    const runtime = getRuntimeMap(mapManager).get(layerId);
    if (!map || !runtime) return;

    if (runtime.kind === FIREWATCH_KIND) {
        await refreshFirewatchPart(mapManager, layerId);
        return;
    }

    if (runtime.kind === 'arcgis-mapserver' || runtime.kind === 'wms') {
        const source = map.getSource(runtime.sourceId);
        if (source && 'reload' in source) source.reload();
        return;
    }

    const dataset = getLayers().find((layer) => layer.id === layerId) || null;
    if (dataset?.visible === false) {
        applyLiveLayerVisibility(map, runtime, false);
        return;
    }

    const view = envelopeFromMapBounds(map.getBounds());
    const action = resolveLiveViewportAction({
        zoom: map.getZoom(),
        minZoom: runtime.minZoom,
        view,
        cached: runtime.lastEnvelope
    });
    if (action === 'hide') {
        applyLiveLayerVisibility(map, runtime, false);
        return;
    }
    applyLiveLayerVisibility(map, runtime, true);
    if (action === 'reuse') return;

    runtime.fetchGen = (runtime.fetchGen || 0) + 1;
    const fetchGen = runtime.fetchGen;

    try {
        if (
            (runtime.kind === 'arcgis-featureserver' || runtime.kind === 'arcgis-mapserver-vector')
            && !runtime.metadataReady
        ) {
            await ensureFeatureServerMetadata(dataset, runtime, map);
            if (runtime.fetchGen !== fetchGen) return;
            runtime.metadataReady = true;
        }
        const raw = await fetchVectorData(map, runtime);
        const limited = applyRenderLimits(raw.features || []);
        let tagged = tagServiceFeatures(layerId, limited.features, runtime.objectIdField);
        const fiberHit = matchUdotFiberLayerUrl(runtime.url);
        if (fiberHit) {
            tagged = filterUdotFiberDisplayFeatures(fiberHit.key, tagged);
        }
        if (fiberHit && fiberHit.key === 'fiber') {
            tagged = applyUdotFiberDisplayOffsets(tagged);
        }
        tagged = decorateUdotFiberGlyphProps(runtime.url, tagged, map);
        const geojson = { type: 'FeatureCollection', features: tagged };

        if (runtime.fetchGen !== fetchGen) return;

        runtime.viewportCache = geojson;
        runtime.truncated = limited.truncated || !!raw.truncated;
        runtime.lastError = null;
        runtime.lastEnvelope = runtime.truncated ? view : padEnvelope(view);

        if (!isLiveLayerInRange(map.getZoom(), runtime.minZoom) || dataset?.visible === false) {
            applyLiveLayerVisibility(map, runtime, false);
        }

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

    if (runtime.kind === 'arcgis-featureserver' || runtime.kind === 'arcgis-mapserver-vector') {
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
    const padded = padEnvelope(envelopeFromMapBounds(map.getBounds()));
    return queryArcgisVectorEnvelope(runtime.url, padded, {
        where: buildUdotFiberExcludeWhere(matchUdotFiberLayerUrl(runtime.url)?.key),
        maxFeatures: RENDER_LIMITS.maxFeaturesPerSource
    });
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

    if (runtime?.kind === FIREWATCH_KIND) {
        removeFirewatchPart(mapManager, layerId);
        getRuntimeMap(mapManager).delete(layerId);
        return;
    }

    // Orphaned firewatch part (runtime map already cleared)
    if (removeFirewatchPart(mapManager, layerId)) {
        getRuntimeMap(mapManager).delete(layerId);
        return;
    }

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
        // Firewatch uses a fixed Utah AOI + its own timer — skip moveend refreshes.
        if (runtime.kind === FIREWATCH_KIND) continue;
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
 * Re-apply Fiber draw order: conduit/fiber paint at the back, splices above boxes, cabinets on top.
 * @param {object} mapManager
 */
export function orderUdotFiberLiveLayers(mapManager) {
    const map = mapManager?.map;
    if (!map) return;
    const parts = [];
    for (const [layerId, runtime] of getRuntimeMap(mapManager)) {
        const key = matchUdotFiberLayerUrl(runtime?.url)?.key;
        if (!key) continue;
        const ids = runtime.mapLayerIds?.length
            ? runtime.mapLayerIds
            : mapManager._getMapSubLayerIds?.(layerId) || [];
        parts.push({ key, mapLayerIds: ids });
    }
    if (!parts.length) return;
    orderUdotFiberLayers(map, groupUdotFiberMapLayerIds(parts));
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
    if (runtime.kind === FIREWATCH_KIND) {
        toggleFirewatchPart(mapManager, layerId, visible);
        return;
    }
    if (!visible) {
        applyLiveLayerVisibility(map, runtime, false);
        return;
    }
    if (!isLiveLayerInRange(map.getZoom(), runtime.minZoom)) {
        applyLiveLayerVisibility(map, runtime, false);
        return;
    }
    applyLiveLayerVisibility(map, runtime, true);
    if (!runtime.lastEnvelope) {
        void refreshServiceLayer(mapManager, layerId);
    }
}

export function isServiceLayerDataset(dataset) {
    return dataset?.type === 'service';
}
