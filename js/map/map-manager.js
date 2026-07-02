/**
 * Map manager — MapLibre GL JS integration
 * Keyless basemaps, layer rendering, popups, 3D terrain & buildings
 */
import logger from '../core/logger.js';
import bus from '../core/event-bus.js';
import { getActiveLayer, setActiveLayer } from '../core/state.js';
import { flattenFeatureGeometryCollections, isWorkspaceLayer } from '../core/data-model.js';
import { getCoverageRasters, isCoverageRasterLayer } from '../core/coverage-raster-layer.js';
import { MAP_CHUNK_BATCH_SIZE, RENDER_LIMITS } from './render-limits.js';
import { buildViewportGeoJSON } from '../workspace/viewport-loader.js';
import { getWorkspaceFeatureAttributes, getWorkspaceLayerBounds } from '../workspace/workspace-store.js';
import {
    resolveMapLibreZoomRange,
    normalizeScaleRange,
    MAPLIBRE_MIN_ZOOM,
    MAPLIBRE_MAX_ZOOM
} from './scale-range.js';
import { resetMapPopupScroll } from './map-popup-utils.js';

const POINT_CLUSTER_THRESHOLD = 10000;

function _tagFeaturesForMap(dataset) {
    const skipFlatten = dataset._geometryExploded === true;
    const taggedFeatures = [];

    for (let origIndex = 0; origIndex < dataset.geojson.features.length; origIndex++) {
        const f = dataset.geojson.features[origIndex];
        if (!f.geometry) continue;

        if (skipFlatten) {
            if (!f.properties) f.properties = {};
            else if (!Object.prototype.hasOwnProperty.call(f.properties, '_featureIndex')) {
                f.properties = { ...f.properties };
            }
            f.properties._featureIndex = origIndex;
            f.properties._datasetId = dataset.id;
            taggedFeatures.push(f);
            continue;
        }

        const parts = flattenFeatureGeometryCollections(f);
        for (const part of parts) {
            taggedFeatures.push({
                ...part,
                properties: { ...(part.properties || {}), _featureIndex: origIndex, _datasetId: dataset.id }
            });
        }
    }
    return taggedFeatures;
}
import { bboxDiagonalMeetsMinDragPx, markMapInteractionHandled, shouldStartBoxSelectDrag, suspendDoubleClickZoom } from './map-interaction-utils.js';
import { nearestPointOnRouteLine, lineSliceAlongRoute } from '../tools/line-geojson.js';
import { normalizeStyle, compilePaint, getBaseFlatStyle } from './style-engine.js';
import {
    buildLineHitWidth,
    FEATURE_QUERY_BUFFER_PX,
    lineHitLayerId,
    shouldSkipClickBinding
} from './interaction-hit.js';
import { buildSymbolLayerLayout } from './style-symbols.js';
import { buildMapLabelLayerSpec, resolveLayerLabels, isMapLabelLayerId, resolveEffectiveLabelZoomRange } from './map-labels.js';
import {
    buildAnnotationLayerSpecs,
    excludeAnnotationsFilter,
    removeAnnotationSources,
    syncAnnotationSources
} from './map-annotations.js';
import {
    AnnotationOverlayManager,
    setAnnotationLayersVisibility
} from './annotation-overlay.js';
import {
    buildQueryResultFeatures,
    fitMapToFeatures,
    removeQueryResultLayers,
    renderQueryResultLayers,
    resolveFeaturesForZoom,
    startQueryResultPulse
} from './query-result-overlay.js';

const BASEMAPS = {
    voyager: {
        name: 'Voyager',
        tiles: [
            'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
            'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'
        ],
        attribution: '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        maxZoom: 20
    },
    satellite: {
        name: 'Satellite',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19
    }
};

const LAYER_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#be185d', '#65a30d'];

const POINT_SYMBOL_NAMES = ['circle', 'square', 'triangle', 'diamond', 'star', 'pin'];

const WIRELESS_COVERAGE_RASTER_PAINT = {
    'raster-opacity': 0.78,
    'raster-fade-duration': 0,
    'raster-resampling': 'linear'
};

/** MapLibre filter (boolean expression): geometry-type is one of the given GeoJSON types */
function _geomTypesFilter(types) {
    return ['in', ['geometry-type'], ['literal', types]];
}

/** Create an SVG string for a given point symbol shape */
function _makeSymbolSVG(shape, color, fillColor, size, opacity) {
    const s = size * 2;
    switch (shape) {
        case 'square':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><rect x="1" y="1" width="${s-2}" height="${s-2}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2" rx="2"/></svg>`;
        case 'triangle':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${size},1 ${s-1},${s-1} 1,${s-1}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2"/></svg>`;
        case 'diamond':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${size},1 ${s-1},${size} ${size},${s-1} 1,${size}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="2"/></svg>`;
        case 'star': {
            const cx = size, cy = size, r = size - 1, ri = r * 0.4;
            let pts = '';
            for (let i = 0; i < 5; i++) {
                const aOuter = (Math.PI / 2) + (2 * Math.PI * i / 5);
                const aInner = aOuter + Math.PI / 5;
                pts += `${cx + r * Math.cos(aOuter)},${cy - r * Math.sin(aOuter)} `;
                pts += `${cx + ri * Math.cos(aInner)},${cy - ri * Math.sin(aInner)} `;
            }
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><polygon points="${pts.trim()}" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.5"/></svg>`;
        }
        case 'pin': {
            const h = s + 8;
            return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${h}" viewBox="0 0 ${s} ${h}"><path d="M${size} ${s+6} C${size} ${s+6} ${s-1} ${size+2} ${s-1} ${size} A${size-1} ${size-1} 0 1 0 1 ${size} C1 ${size+2} ${size} ${s+6} ${size} ${s+6}Z" fill="${fillColor}" fill-opacity="${opacity}" stroke="${color}" stroke-width="1.5"/><circle cx="${size}" cy="${size}" r="${size*0.35}" fill="${color}" opacity="0.6"/></svg>`;
        }
        default:
            return null;
    }
}

class MapManager {
    constructor() {
        this.map = null;
        this.dataLayers = new Map();   // layerId -> { sourceId, layerIds[], geojson }
        this._layerNames = new Map();
        this._layerStyles = new Map();
        this.clusterGroups = new Map();
        this.currentBasemap = 'voyager';
        this.drawLayer = null;
        this.highlightLayer = null;
        this._highlightedInfo = null;

        // Import fence
        this._importFence = null;

        // Selection (always-on when map idle; blocked during draw / map picks)
        this._selections = new Map();
        this._selectionBlocked = 0;
        this._activeLayerId = null;
        this._rectSelectCleanup = null;

        // 3D
        this._3dEnabled = false;
        this._terrainEnabled = false;
        this._buildingsEnabled = false;

        // Popup
        this._popup = null;
        this._popupDelegationBound = false;

        // Camera orbit
        this._orbitAnimId = null;
        this._orbitCenter = null;

        // Temp layers
        this._tempLayers = [];

        // ID counter
        this._idCounter = 0;

        // Scale-range re-apply when latitude shifts significantly
        this._lastScaleRangeLat = null;

        this._annotationOverlay = null;
    }

    _layerAddSpec(baseSpec, zoomRange) {
        if (!zoomRange) return baseSpec;
        return { ...baseSpec, minzoom: zoomRange.minzoom, maxzoom: zoomRange.maxzoom };
    }

    _getLayerZoomRange(dataset) {
        if (!dataset || !this.map) return null;
        return resolveMapLibreZoomRange(dataset, this.map.getCenter().lat);
    }

    _applyZoomRangeToLayerIds(layerIds, zoomRange, labelsConfig) {
        if (!this.map || !layerIds?.length) return;
        const geomMin = zoomRange?.minzoom ?? MAPLIBRE_MIN_ZOOM;
        const geomMax = zoomRange?.maxzoom ?? MAPLIBRE_MAX_ZOOM;
        const labelRange = resolveEffectiveLabelZoomRange(labelsConfig, zoomRange);
        for (const lid of layerIds) {
            if (!this.map.getLayer(lid)) continue;
            if (isMapLabelLayerId(lid)) {
                this.map.setLayerZoomRange(lid, labelRange.minzoom, labelRange.maxzoom);
            } else {
                this.map.setLayerZoomRange(lid, geomMin, geomMax);
            }
        }
    }

    _applyScaleRangeForEntry(layerId, entry, scaleRangeConfig) {
        if (!entry || !this.map) return;
        const config = normalizeScaleRange(scaleRangeConfig || {});
        entry.scaleRange = config;
        const zoomRange = resolveMapLibreZoomRange(config, this.map.getCenter().lat);
        const labelsConfig = this._layerStyles.get(layerId)?.labels;
        this._applyZoomRangeToLayerIds(entry.layerIds, zoomRange, labelsConfig);
    }

    setLayerScaleRange(layerId, range, latitude) {
        const entry = this.dataLayers.get(layerId);
        if (!entry || !this.map) return;
        this._applyScaleRangeForEntry(layerId, entry, range);
        if (Number.isFinite(latitude)) {
            this._lastScaleRangeLat = latitude;
        }
    }

    _reapplyAllScaleRangesIfNeeded() {
        if (!this.map) return;
        const lat = this.map.getCenter().lat;
        const prev = this._lastScaleRangeLat;
        if (prev != null && Math.abs(lat - prev) < 0.5) return;

        this._lastScaleRangeLat = lat;
        let changed = false;
        for (const [layerId, entry] of this.dataLayers) {
            if (!entry.scaleRange?.scaleRangeEnabled) continue;
            const zoomRange = resolveMapLibreZoomRange(entry.scaleRange, lat);
            const labelsConfig = this._layerStyles.get(layerId)?.labels;
            this._applyZoomRangeToLayerIds(entry.layerIds, zoomRange, labelsConfig);
            changed = true;
        }
        if (changed) {
            bus.emit('map:scaleRangeChanged', { latitude: lat });
        }
    }

    _storeLayerScaleRange(dataset) {
        const entry = this.dataLayers.get(dataset?.id);
        if (!entry || !this.map) return;
        const scaleRangeConfig = normalizeScaleRange(dataset);
        entry.scaleRange = scaleRangeConfig;
        const zoomRange = resolveMapLibreZoomRange(scaleRangeConfig, this.map.getCenter().lat);
        const labelsConfig = this._layerStyles.get(dataset.id)?.labels;
        this._applyZoomRangeToLayerIds(entry.layerIds, zoomRange, labelsConfig);
        this._lastScaleRangeLat = this.map.getCenter().lat;
    }

    _nextId(prefix) {
        return `${prefix}-${++this._idCounter}`;
    }

    init(containerId) {
        if (typeof maplibregl === 'undefined') {
            logger.error('Map', 'MapLibre GL JS not loaded');
            return;
        }

        this.map = new maplibregl.Map({
            container: containerId,
            style: this._buildStyle('voyager'),
            center: [-111.09, 39.32],
            zoom: 7,
            attributionControl: true,
            maxPitch: 85,
            dragRotate: false,
            touchZoomRotate: true,
            preserveDrawingBuffer: true,
            // Keep parent-zoom tiles visible while zooming in so motion feels smooth
            // (default true cancels them and details pop in abruptly).
            cancelPendingTileRequestsWhileZooming: false
        });

        // Disable right-click rotate and touch rotation (keeps zoom gestures)
        this.map.dragRotate.disable();
        this.map.touchZoomRotate.disableRotation();

        // Scroll zoom: MapLibre uses setWheelZoomRate for mouse wheels and setZoomRate
        // for trackpads / small deltas — setting only the wheel rate leaves laptops unchanged.
        this.map.scrollZoom.setZoomRate(1 / 48);
        this.map.scrollZoom.setWheelZoomRate(1 / 110);

        this.map.addControl(new maplibregl.FullscreenControl(), 'top-right');
        this._bindPopupDelegation();

        this.map.on('error', (e) => {
            if (e.error?.status === 404 || e.error?.message?.includes('tile')) {
                logger.warn('Map', 'Tile load error', { message: e.error?.message });
            }
        });

        // Click on empty map — clear highlight, popup, and selection
        this.map.on('click', (e) => {
            if (e._drawHandled) return;
            const hitLayers = this._getInteractiveLayerIds();
            const features = this._queryFeaturesAtPoint(e.point, hitLayers);
            if (features.length === 0) {
                this.clearHighlight();
                this._closePopup();
                if (this._canSelect()) {
                    if (this._activeLayerId) {
                        this.clearSelection(this._activeLayerId);
                    } else if (this.getTotalSelectionCount() > 0) {
                        this.clearSelection();
                    }
                }
            }
        });

        bus.on('layer:active', (layer) => {
            this._activeLayerId = layer?.id ?? null;
        });

        this._workspaceMoveTimer = null;
        this.map.on('moveend', () => {
            window.clearTimeout(this._workspaceMoveTimer);
            this._workspaceMoveTimer = window.setTimeout(() => {
                this._reapplyAllScaleRangesIfNeeded();
                void this._refreshAllWorkspaceLayers();
            }, 100);
        });

        this._annotationOverlay = new AnnotationOverlayManager(this.map);
        this._annotationOverlay.setGeojsonProvider((datasetId) => this.dataLayers.get(datasetId)?.geojson);
        this._annotationOverlay.bind();
        bus.on('map:3dChanged', (is3D) => {
            this._setAllAnnotationMapLibreVisibility(!is3D);
            this._annotationOverlay?.setActive(!!is3D);
        });

        // Right-click
        this.map.on('contextmenu', (e) => {
            e.preventDefault();
            const hitLayers = this._getInteractiveLayerIds();
            const features = hitLayers.length > 0 ? this._queryFeaturesAtPoint(e.point, hitLayers) : [];
            if (features.length === 0) {
                bus.emit('map:contextmenu', {
                    latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
                    originalEvent: e.originalEvent,
                    layerId: null,
                    featureIndex: null,
                    feature: null
                });
            }
        });

        this.map.on('load', () => {
            logger.info('Map', 'Map initialized');
            bus.emit('map:ready', this.map);
            this._initCoordSearch();
            this._initMeasureTool();
            if (!this._rectSelectCleanup) {
                this._rectSelectCleanup = this._setupRectangleSelect();
            }
        });

        return this.map;
    }

    /**
     * Tear down MapLibre (Dual Screen Mode: map lives in secondary window).
     */
    destroy() {
        this.stopCameraOrbit?.();
        this._closePopup?.();
        this._cancelInteraction?.();
        this.clearSelection?.();
        this._annotationOverlay?.destroy();
        this._annotationOverlay = null;
        if (this._rectSelectCleanup) { this._rectSelectCleanup(); this._rectSelectCleanup = null; }
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
        this.dataLayers.clear();
        this._layerNames?.clear();
        this.clusterGroups?.clear();
        this._selections?.clear();
    }

    // ==========================================
    // Style builder
    // ==========================================

    _buildStyle(basemapKey) {
        const bm = BASEMAPS[basemapKey] || BASEMAPS.voyager;
        const sources = {};
        const layers = [];

        if (bm.tiles) {
            sources['basemap'] = {
                type: 'raster',
                tiles: bm.tiles,
                tileSize: 256,
                maxzoom: bm.maxZoom || 19,
                attribution: bm.attribution
            };
            layers.push({
                id: 'basemap-layer',
                type: 'raster',
                source: 'basemap',
                minzoom: 0,
                maxzoom: 22
            });

            if (bm.overlayTiles) {
                sources['basemap-overlay'] = {
                    type: 'raster',
                    tiles: bm.overlayTiles,
                    tileSize: 256,
                    maxzoom: 20
                };
                layers.push({
                    id: 'basemap-overlay-layer',
                    type: 'raster',
                    source: 'basemap-overlay',
                    minzoom: 0,
                    maxzoom: 22
                });
            }
        }

        return {
            version: 8,
            sources,
            layers,
            glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
        };
    }

    setBasemap(key) {
        const bm = BASEMAPS[key];
        if (!bm) {
            logger.warn('Map', 'Unknown basemap key', { key });
            return;
        }

        // Collect all non-basemap sources/layers to preserve data layers
        // Skip 3D-specific assets — _apply3D will recreate them cleanly
        const _3dIds = new Set(['terrain-source', 'openfreemap']);
        const _3dLayerIds = new Set(['hillshade', 'sky', '3d-buildings']);

        const style = this.map.getStyle();
        const userSources = {};
        const userLayers = [];
        for (const [id, src] of Object.entries(style.sources)) {
            if (id !== 'basemap' && id !== 'basemap-overlay' && !_3dIds.has(id)) {
                userSources[id] = src;
            }
        }
        for (const layer of style.layers) {
            if (!layer.id.startsWith('basemap') && !_3dLayerIds.has(layer.id)) {
                userLayers.push(layer);
            }
        }

        // Build new basemap style
        const newStyle = this._buildStyle(key);

        // Merge user data back
        Object.assign(newStyle.sources, userSources);
        newStyle.layers.push(...userLayers);

        // If 3D is active, carry terrain into the new style so there is
        // no gap between setStyle and _apply3D (prevents black flash)
        if (this._3dEnabled) {
            newStyle.sources['terrain-source'] = {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 15
            };
            newStyle.terrain = { source: 'terrain-source', exaggeration: 1.5 };
        }

        this.map.setStyle(newStyle, { diff: true });
        this.currentBasemap = key;

        // Re-apply 3D if it was active before the basemap switch.
        // style.load does NOT always fire with { diff: true }, so we
        // listen for styledata (always emitted) with a one-shot guard.
        if (this._3dEnabled) {
            let applied = false;
            const reapply = () => {
                if (applied) return;
                applied = true;
                this.map.off('styledata', reapply);
                this._terrainEnabled = false;
                this._buildingsEnabled = false;
                this._apply3D();
            };
            this.map.on('styledata', reapply);
            // Safety fallback in case styledata already fired synchronously
            setTimeout(reapply, 200);
        }

        bus.emit('map:basemap', key);
    }

    getBasemaps() { return BASEMAPS; }

    getLayerStyle(layerId) {
        return this._layerStyles.get(layerId) || null;
    }

    setLayerStyle(layerId, style) {
        this._layerStyles.set(layerId, style);
    }

    // ==========================================
    // Layer management
    // ==========================================

    addLayer(dataset, colorIndex = 0, { fit = false } = {}) {
        if (!this.map) return;
        if (isWorkspaceLayer(dataset)) {
            return this.addWorkspaceLayer(dataset, colorIndex, { fit });
        }
        if (isCoverageRasterLayer(dataset)) {
            const rasters = getCoverageRasters(dataset);
            if (rasters.length) {
                return this.addCoverageHeatmapLayer(dataset, colorIndex, { fit });
            }
            logger.warn('Map', 'Coverage raster layer missing image data; showing bounds only', {
                name: dataset.name,
                id: dataset.id
            });
        }
        if (!dataset.geojson) return;

        this.removeLayer(dataset.id);

        const defaultColor = LAYER_COLORS[colorIndex % LAYER_COLORS.length];
        const stored = this._layerStyles.get(dataset.id);
        const layerStyle = normalizeStyle(stored, defaultColor);
        if (!stored) this._layerStyles.set(dataset.id, { ...layerStyle });

        const styPoly = compilePaint(layerStyle, 'polygon');
        const styLine = compilePaint(layerStyle, 'line');
        const styPoint = compilePaint(layerStyle, 'point');
        const styFlat = getBaseFlatStyle(layerStyle, 'polygon');

        const taggedFeatures = _tagFeaturesForMap(dataset);

        if (taggedFeatures.length === 0) {
            const sourceId = `src-${dataset.id}`;
            this.map.addSource(sourceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            this.dataLayers.set(dataset.id, {
                sourceId,
                layerIds: [],
                chunkSources: [{ sourceId, layerIds: [] }],
                colorIndex,
                geojson: { type: 'FeatureCollection', features: [] },
                scaleRange: normalizeScaleRange(dataset)
            });
            this._layerNames.set(dataset.id, dataset.name);
            logger.info('Map', 'No geometries to display', { layer: dataset.name });
            this._applyDatasetVisibility(dataset);
            bus.emit('map:layerAdded', { id: dataset.id, name: dataset.name });
            return;
        }

        const geojson = { type: 'FeatureCollection', features: taggedFeatures };
        const sourceId = `src-${dataset.id}`;

        const hasPoints = taggedFeatures.some(f => f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint');
        const hasLines = taggedFeatures.some(f => f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString');
        const hasPolygons = taggedFeatures.some(f => f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');

        const pointCount = taggedFeatures.filter(
            (f) => f.geometry.type === 'Point' || f.geometry.type === 'MultiPoint'
        ).length;
        const useCluster = hasPoints && !hasLines && !hasPolygons
            && pointCount >= POINT_CLUSTER_THRESHOLD
            && (layerStyle.pointSymbol || 'circle') === 'circle';

        this.map.addSource(sourceId, {
            type: 'geojson',
            data: geojson,
            ...(useCluster ? { cluster: true, clusterMaxZoom: 14, clusterRadius: 50 } : {})
        });
        if (useCluster) {
            this.clusterGroups.set(dataset.id, true);
        }

        const layerIds = [];

        // Polygon fill
        if (hasPolygons) {
            const fillId = `${dataset.id}-fill`;
            this.map.addLayer({
                id: fillId, type: 'fill', source: sourceId,
                filter: _geomTypesFilter(['Polygon', 'MultiPolygon']),
                paint: { 'fill-color': styPoly.fillColor, 'fill-opacity': styPoly.fillOpacity }
            });
            layerIds.push(fillId);

            const outlineId = `${dataset.id}-outline`;
            this.map.addLayer({
                id: outlineId, type: 'line', source: sourceId,
                filter: _geomTypesFilter(['Polygon', 'MultiPolygon']),
                paint: {
                    'line-color': styPoly.strokeColor,
                    'line-width': styPoly.strokeWidth,
                    'line-opacity': styPoly.strokeOpacity
                }
            });
            layerIds.push(outlineId);
            layerIds.push(this._ensureLineHitLayer(
                sourceId, outlineId, _geomTypesFilter(['Polygon', 'MultiPolygon']), styPoly.strokeWidth
            ));
        }

        // Lines
        if (hasLines) {
            const lineFilter = excludeAnnotationsFilter(_geomTypesFilter(['LineString', 'MultiLineString']));
            const lineId = `${dataset.id}-line`;
            this.map.addLayer({
                id: lineId, type: 'line', source: sourceId,
                filter: lineFilter,
                paint: {
                    'line-color': styLine.strokeColor,
                    'line-width': styLine.strokeWidth,
                    'line-opacity': styLine.strokeOpacity
                }
            });
            layerIds.push(lineId);
            layerIds.push(this._ensureLineHitLayer(
                sourceId, lineId, lineFilter, styLine.strokeWidth
            ));
        }

        // Points
        if (hasPoints) {
            const fo = Math.min(1, (typeof styPoint.fillOpacity === 'number' ? styPoint.fillOpacity : 0.3) + 0.3);
            const symbolLayout = styPoint.pointSymbol !== 'circle'
                ? buildSymbolLayerLayout(layerStyle, 'point', (shape, color, fillColor, size, opacity) =>
                    this._ensureSymbolImage(shape, color, fillColor, size, opacity))
                : null;
            const pointGeomFilter = excludeAnnotationsFilter(_geomTypesFilter(['Point', 'MultiPoint']));

            if (useCluster) {
                const clusterId = `${dataset.id}-clusters`;
                this.map.addLayer({
                    id: clusterId,
                    type: 'circle',
                    source: sourceId,
                    filter: ['has', 'point_count'],
                    paint: {
                        'circle-color': styPoint.fillColor,
                        'circle-radius': ['step', ['get', 'point_count'], 12, 100, 16, 750, 20],
                        'circle-stroke-color': styPoint.strokeColor,
                        'circle-stroke-width': 1,
                        'circle-opacity': fo
                    }
                });
                layerIds.push(clusterId);
            }

            if (symbolLayout) {
                const ptId = `${dataset.id}-point`;
                this.map.addLayer({
                    id: ptId, type: 'symbol', source: sourceId,
                    filter: useCluster
                        ? ['all', pointGeomFilter, ['!', ['has', 'point_count']]]
                        : pointGeomFilter,
                    layout: symbolLayout.layout
                });
                layerIds.push(ptId);
            } else {
                const ptId = `${dataset.id}-point`;
                this.map.addLayer({
                    id: ptId, type: 'circle', source: sourceId,
                    filter: useCluster
                        ? ['all', pointGeomFilter, ['!', ['has', 'point_count']]]
                        : pointGeomFilter,
                    paint: {
                        'circle-radius': styPoint.circleRadius,
                        'circle-color': styPoint.fillColor,
                        'circle-stroke-color': styPoint.strokeColor,
                        'circle-stroke-width': styPoint.strokeWidth,
                        'circle-opacity': fo
                    }
                });
                layerIds.push(ptId);
            }
        }

        this._addLabelLayers(layerStyle, dataset, dataset.id, sourceId, layerIds, {
            hasPoints,
            hasLines,
            useCluster
        });

        this._addAnnotationLayers(dataset.id, sourceId, taggedFeatures, layerIds);

        // Click handlers
        this._bindLayerClickHandlers(dataset, layerIds, styFlat);

        this.dataLayers.set(dataset.id, {
            sourceId,
            layerIds,
            chunkSources: [{ sourceId, layerIds }],
            colorIndex,
            geojson: dataset._geometryExploded === true ? dataset.geojson : geojson,
            scaleRange: normalizeScaleRange(dataset)
        });
        this._storeLayerScaleRange(dataset);
        this._layerNames.set(dataset.id, dataset.name);

        if (dataset.geojson.features.length > 10000) {
            logger.warn('Map', 'Large dataset — rendering may be slow', { count: dataset.geojson.features.length });
        }

        if (fit) {
            try {
                const bbox = turf.bbox(geojson);
                if (bbox && isFinite(bbox[0])) {
                    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, maxZoom: 16 });
                }
            } catch (e) {
                logger.warn('Map', 'Could not fit bounds', { error: e.message });
            }
        }

        logger.info('Map', 'Layer added', {
            name: dataset.name,
            featureCount: dataset.geojson.features.length,
            renderParts: taggedFeatures.length
        });
        this._applyDatasetVisibility(dataset);
        bus.emit('map:layerAdded', { id: dataset.id, name: dataset.name });
    }

    /** Install georeferenced wireless coverage rasters (image source + raster layer). */
    _addCoverageRasterLayers(coverageRasters = [], prefix = 'coverage') {
        const layerIds = [];
        const extraSourceIds = [];

        coverageRasters.forEach((raster, index) => {
            if (!raster?.dataUrl || !raster?.coordinates?.length) return;

            const sourceId = `${prefix}-raster-src-${index}`;
            const layerId = `${prefix}-raster-${index}`;

            this.map.addSource(sourceId, {
                type: 'image',
                url: raster.dataUrl,
                coordinates: raster.coordinates
            });
            this.map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: WIRELESS_COVERAGE_RASTER_PAINT
            });

            extraSourceIds.push(sourceId);
            layerIds.push(layerId);
        });

        return { layerIds, extraSourceIds };
    }

    /** Permanent wireless signal coverage raster layer(s). */
    addCoverageHeatmapLayer(dataset, colorIndex = 0, { fit = false } = {}) {
        if (!this.map || !dataset) return;

        this.removeLayer(dataset.id);

        const coverageRasters = dataset.source?.coverageRasters || [];
        if (!coverageRasters.length) return;

        const taggedFeatures = _tagFeaturesForMap(dataset).filter(
            (f) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
        );
        const geojson = { type: 'FeatureCollection', features: taggedFeatures };
        const sourceId = taggedFeatures.length ? `src-${dataset.id}` : null;

        if (sourceId) {
            this.map.addSource(sourceId, { type: 'geojson', data: geojson });
        }

        const rasterInstall = this._addCoverageRasterLayers(coverageRasters, dataset.id);
        const chunkSources = [
            ...(sourceId ? [{ sourceId, layerIds: [] }] : []),
            ...rasterInstall.extraSourceIds.map((rasterSourceId, index) => ({
                sourceId: rasterSourceId,
                layerIds: [rasterInstall.layerIds[index]]
            }))
        ];

        this.dataLayers.set(dataset.id, {
            sourceId: sourceId || rasterInstall.extraSourceIds[0],
            layerIds: rasterInstall.layerIds,
            chunkSources,
            colorIndex,
            geojson,
            scaleRange: normalizeScaleRange(dataset)
        });
        this._storeLayerScaleRange(dataset);
        this._layerNames.set(dataset.id, dataset.name);

        if (fit) {
            try {
                const bbox = coverageRasters.reduce((acc, raster) => {
                    if (!raster?.bbox) return acc;
                    const [west, south, east, north] = raster.bbox;
                    if (!acc) return [west, south, east, north];
                    return [
                        Math.min(acc[0], west),
                        Math.min(acc[1], south),
                        Math.max(acc[2], east),
                        Math.max(acc[3], north)
                    ];
                }, null);
                if (bbox && isFinite(bbox[0])) {
                    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, maxZoom: 16 });
                }
            } catch (e) {
                logger.warn('Map', 'Could not fit coverage raster bounds', { error: e.message });
            }
        }

        logger.info('Map', 'Coverage raster layer added', {
            name: dataset.name,
            rasters: coverageRasters.length
        });
        this._applyDatasetVisibility(dataset);
        bus.emit('map:layerAdded', { id: dataset.id, name: dataset.name });
    }

    /** Workspace-backed layer — renders viewport packet only. */
    async addWorkspaceLayer(dataset, colorIndex = 0, { fit = false } = {}) {
        if (!this.map || !isWorkspaceLayer(dataset)) return;

        this.removeLayer(dataset.id);
        this._workspaceDatasets = this._workspaceDatasets || new Map();
        this._workspaceDatasets.set(dataset.id, dataset);

        const defaultColor = LAYER_COLORS[colorIndex % LAYER_COLORS.length];
        const stored = this._layerStyles.get(dataset.id);
        const layerStyle = normalizeStyle(stored, defaultColor);
        if (!stored) this._layerStyles.set(dataset.id, { ...layerStyle });

        const bounds = this.map.getBounds();
        const west = bounds.getWest();
        const south = bounds.getSouth();
        const east = bounds.getEast();
        const north = bounds.getNorth();
        const viewportFc = await buildViewportGeoJSON(dataset.workspaceLayerId || dataset.id, [west, south, east, north]);
        dataset.geojson = viewportFc;

        const taggedFeatures = _tagFeaturesForMap(dataset);
        const sourceId = `src-${dataset.id}`;
        const layerIds = this._installGeoJsonChunk(
            dataset, taggedFeatures, 0, layerStyle, { styFlat: getBaseFlatStyle(layerStyle, 'polygon') }
        );
        const geojson = { type: 'FeatureCollection', features: taggedFeatures };

        this.dataLayers.set(dataset.id, {
            sourceId,
            layerIds,
            chunkSources: [{ sourceId, layerIds }],
            colorIndex,
            workspace: true,
            geojson,
            scaleRange: normalizeScaleRange(dataset)
        });
        this._storeLayerScaleRange(dataset);
        this._layerNames.set(dataset.id, dataset.name);

        if (fit && viewportFc.features.length) {
            try {
                const turf = await import('@turf/turf');
                const bbox = turf.bbox(viewportFc);
                if (bbox && isFinite(bbox[0])) {
                    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, maxZoom: 16 });
                }
            } catch (e) {
                logger.warn('Map', 'Could not fit workspace layer bounds', { error: e.message });
            }
        }

        this._applyDatasetVisibility(dataset);
        bus.emit('map:layerAdded', { id: dataset.id, name: dataset.name });
    }

    async _refreshAllWorkspaceLayers() {
        if (!this._workspaceDatasets?.size || !this.map) return;
        for (const [id] of this._workspaceDatasets) {
            await this.refreshWorkspaceLayerViewport(id);
        }
    }

    async refreshWorkspaceLayerViewport(layerId) {
        const dataset = this._workspaceDatasets?.get(layerId);
        const entry = this.dataLayers.get(layerId);
        if (!dataset || !entry || !this.map) return;

        const bounds = this.map.getBounds();
        const viewportFc = await buildViewportGeoJSON(
            dataset.workspaceLayerId || layerId,
            [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
        );
        dataset.geojson = viewportFc;
        const tagged = _tagFeaturesForMap(dataset);
        const geojson = { type: 'FeatureCollection', features: tagged };
        const source = this.map.getSource(entry.sourceId);
        if (source) source.setData(geojson);
        entry.geojson = geojson;
    }

    /** Append a new GeoJSON source chunk (incremental import — no full setData). */
    appendFeaturesToLayer(layerId, dataset, rawFeatures, startIndex) {
        const entry = this.dataLayers.get(layerId);
        if (!entry || !this.map || !rawFeatures?.length) return;

        const skipFlatten = dataset._geometryExploded === true;
        const tagged = [];
        for (let i = 0; i < rawFeatures.length; i++) {
            const origIndex = startIndex + i;
            const f = rawFeatures[i];
            if (!f?.geometry) continue;

            if (skipFlatten) {
                if (!f.properties) f.properties = {};
                else if (!Object.prototype.hasOwnProperty.call(f.properties, '_featureIndex')) {
                    f.properties = { ...f.properties };
                }
                f.properties._featureIndex = origIndex;
                f.properties._datasetId = dataset.id;
                tagged.push(f);
                continue;
            }

            const parts = flattenFeatureGeometryCollections(f);
            for (const part of parts) {
                tagged.push({
                    ...part,
                    properties: { ...(part.properties || {}), _featureIndex: origIndex, _datasetId: dataset.id }
                });
            }
        }
        if (tagged.length === 0) return;

        if (!entry.chunkSources) {
            entry.chunkSources = [{ sourceId: entry.sourceId, layerIds: [...entry.layerIds] }];
        }
        if (entry.chunkSources.length >= RENDER_LIMITS.maxActiveSources) {
            logger.warn('Map', 'Chunk source limit reached — skipping map append for batch', {
                layerId, limit: RENDER_LIMITS.maxActiveSources
            });
            return;
        }

        const chunkIndex = entry.chunkSources.length;
        const defaultColor = LAYER_COLORS[(entry.colorIndex ?? 0) % LAYER_COLORS.length];
        const layerStyle = normalizeStyle(this._layerStyles.get(layerId), defaultColor);
        const chunkLayerIds = this._installGeoJsonChunk(
            dataset, tagged, chunkIndex, layerStyle, { useCluster: false, styFlat: getBaseFlatStyle(layerStyle, 'polygon') }
        );
        if (!chunkLayerIds.length) return;

        const sourceId = chunkIndex === 0 ? entry.sourceId : `src-${dataset.id}-c${chunkIndex}`;
        entry.layerIds.push(...chunkLayerIds);
        entry.chunkSources.push({ sourceId, layerIds: chunkLayerIds });
    }

    /**
     * Add a GeoJSON source + styled layers for one feature batch.
     * @returns {string[]} map layer ids
     */
    _installGeoJsonChunk(dataset, taggedFeatures, chunkIndex, layerStyle, { useCluster = false, styFlat = null } = {}) {
        if (!this.map || !taggedFeatures.length) return [];

        const suffix = chunkIndex === 0 ? '' : `-c${chunkIndex}`;
        const sourceId = `src-${dataset.id}${suffix}`;
        const geojson = { type: 'FeatureCollection', features: taggedFeatures };

        const hasPoints = taggedFeatures.some(f => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint');
        const hasLines = taggedFeatures.some(f => f.geometry?.type === 'LineString' || f.geometry?.type === 'MultiLineString');
        const hasPolygons = taggedFeatures.some(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon');

        const styPoly = compilePaint(layerStyle, 'polygon');
        const styLine = compilePaint(layerStyle, 'line');
        const styPoint = compilePaint(layerStyle, 'point');
        const flat = styFlat || getBaseFlatStyle(layerStyle, 'polygon');

        if (this.map.getSource(sourceId)) {
            this.map.getSource(sourceId).setData(geojson);
        } else {
            this.map.addSource(sourceId, {
                type: 'geojson',
                data: geojson,
                ...(useCluster ? { cluster: true, clusterMaxZoom: 14, clusterRadius: 50 } : {})
            });
        }

        const layerIds = [];
        const idBase = chunkIndex === 0 ? dataset.id : `${dataset.id}-c${chunkIndex}`;

        if (hasPolygons) {
            const fillId = `${idBase}-fill`;
            if (!this.map.getLayer(fillId)) {
                this.map.addLayer({
                    id: fillId, type: 'fill', source: sourceId,
                    filter: _geomTypesFilter(['Polygon', 'MultiPolygon']),
                    paint: { 'fill-color': styPoly.fillColor, 'fill-opacity': styPoly.fillOpacity }
                });
            }
            layerIds.push(fillId);

            const outlineId = `${idBase}-outline`;
            if (!this.map.getLayer(outlineId)) {
                this.map.addLayer({
                    id: outlineId, type: 'line', source: sourceId,
                    filter: _geomTypesFilter(['Polygon', 'MultiPolygon']),
                    paint: {
                        'line-color': styPoly.strokeColor,
                        'line-width': styPoly.strokeWidth,
                        'line-opacity': styPoly.strokeOpacity
                    }
                });
            }
            layerIds.push(outlineId);
            layerIds.push(this._ensureLineHitLayer(
                sourceId, outlineId, _geomTypesFilter(['Polygon', 'MultiPolygon']), styPoly.strokeWidth
            ));
        }

        if (hasLines) {
            const lineFilter = excludeAnnotationsFilter(_geomTypesFilter(['LineString', 'MultiLineString']));
            const lineId = `${idBase}-line`;
            if (!this.map.getLayer(lineId)) {
                this.map.addLayer({
                    id: lineId, type: 'line', source: sourceId,
                    filter: lineFilter,
                    paint: {
                        'line-color': styLine.strokeColor,
                        'line-width': styLine.strokeWidth,
                        'line-opacity': styLine.strokeOpacity
                    }
                });
            }
            layerIds.push(lineId);
            layerIds.push(this._ensureLineHitLayer(
                sourceId, lineId, lineFilter, styLine.strokeWidth
            ));
        }

        if (hasPoints) {
            const fo = Math.min(1, (typeof styPoint.fillOpacity === 'number' ? styPoint.fillOpacity : 0.3) + 0.3);
            const pointGeomFilter = excludeAnnotationsFilter(_geomTypesFilter(['Point', 'MultiPoint']));
            const ptId = `${idBase}-point`;
            if (!this.map.getLayer(ptId)) {
                this.map.addLayer({
                    id: ptId, type: 'circle', source: sourceId,
                    filter: pointGeomFilter,
                    paint: {
                        'circle-radius': styPoint.circleRadius,
                        'circle-color': styPoint.fillColor,
                        'circle-stroke-color': styPoint.strokeColor,
                        'circle-stroke-width': styPoint.strokeWidth,
                        'circle-opacity': fo
                    }
                });
            }
            layerIds.push(ptId);
        }

        this._addLabelLayers(layerStyle, dataset, idBase, sourceId, layerIds, {
            hasPoints,
            hasLines,
            useCluster
        });

        this._bindLayerClickHandlers(dataset, layerIds, flat);
        const zoomRange = this._getLayerZoomRange(dataset);
        this._applyZoomRangeToLayerIds(layerIds, zoomRange, layerStyle.labels);
        return layerIds;
    }

    _addAnnotationLayers(datasetId, mainSourceId, taggedFeatures, layerIds) {
        if (!this.map) return;

        removeAnnotationSources(this.map, datasetId);

        for (const lid of [
            `${datasetId}-ann-callout-line`,
            `${datasetId}-ann-anchor`,
            `${datasetId}-ann-labels`
        ]) {
            if (this.map.getLayer(lid)) this.map.removeLayer(lid);
        }

        const spec = buildAnnotationLayerSpecs(datasetId, mainSourceId, taggedFeatures);
        if (!spec.layers?.length) return;

        if (spec.labelSourceId && spec.labelSourceData) {
            this.map.addSource(spec.labelSourceId, { type: 'geojson', data: spec.labelSourceData });
        }
        if (spec.anchorSourceId && spec.anchorSourceData) {
            this.map.addSource(spec.anchorSourceId, { type: 'geojson', data: spec.anchorSourceData });
        }

        for (const layer of spec.layers) {
            this.map.addLayer(layer);
        }
        layerIds.push(...spec.layerIds);

        this._annotationOverlay?.register(datasetId, spec.layerIds);
        setAnnotationLayersVisibility(this.map, datasetId, !this._3dEnabled);
        if (this._3dEnabled) {
            this._annotationOverlay?.setActive(true);
        }
    }

    _setAllAnnotationMapLibreVisibility(visible) {
        if (!this.map) return;
        for (const datasetId of this.dataLayers.keys()) {
            setAnnotationLayersVisibility(this.map, datasetId, visible);
        }
    }

    compositeAnnotationOverlay(ctx, pixelScale = 1) {
        this._annotationOverlay?.compositeOntoCanvas(ctx, pixelScale);
    }

    syncAnnotationSources(datasetId, geojson) {
        if (!this.map || !datasetId) return;
        syncAnnotationSources(this.map, datasetId, geojson);
        if (this._3dEnabled) {
            this._annotationOverlay?.scheduleRefresh();
        }
    }

    _addLabelLayers(layerStyle, dataset, idBase, sourceId, layerIds, { hasPoints, hasLines, useCluster = false } = {}) {
        const mapLabels = resolveLayerLabels(layerStyle, dataset);
        if (!mapLabels?.field) return;

        const labelSpec = buildMapLabelLayerSpec(idBase, sourceId, mapLabels, useCluster);
        const isLineLabels = mapLabels.placement === 'line';
        const shouldAdd = labelSpec && ((isLineLabels && hasLines) || (!isLineLabels && hasPoints));
        if (!shouldAdd) return;

        if (this.map.getLayer(labelSpec.id)) {
            this.map.removeLayer(labelSpec.id);
        }
        this.map.addLayer(labelSpec);
        layerIds.push(labelSpec.id);
    }

    _ensureLineHitLayer(sourceId, visibleLayerId, filter, strokeWidthPaint) {
        const hitId = lineHitLayerId(visibleLayerId);
        if (!this.map.getLayer(hitId)) {
            this.map.addLayer({
                id: hitId,
                type: 'line',
                source: sourceId,
                filter,
                paint: {
                    'line-color': '#000000',
                    'line-width': buildLineHitWidth(strokeWidthPaint),
                    'line-opacity': 0
                }
            });
        }
        return hitId;
    }

    _bindLayerClickHandlers(dataset, layerIds, styFlat) {
        for (const lid of layerIds) {
            if (shouldSkipClickBinding(lid, layerIds)) continue;
            if (this._boundClickLayers?.has(lid)) continue;
            if (!this._boundClickLayers) this._boundClickLayers = new Set();

            this.map.on('click', lid, (e) => {
                if (e._drawHandled) return;
                e.preventDefault();
                const props = e.features?.[0]?.properties;
                if (!props) return;
                const featureIndex = props._featureIndex;
                const resolveFeature = async () => {
                    let feature = dataset.geojson.features.find(
                        (f) => f.properties?._featureIndex === featureIndex
                    ) || dataset.geojson.features[featureIndex];
                    if (isWorkspaceLayer(dataset)) {
                        const wsId = dataset.workspaceLayerId || dataset.id;
                        const attrs = await getWorkspaceFeatureAttributes(wsId, featureIndex);
                        if (feature && attrs) {
                            feature = { ...feature, properties: { ...attrs } };
                        } else if (attrs) {
                            feature = { type: 'Feature', geometry: e.features[0].geometry, properties: attrs };
                        }
                    } else {
                        feature = dataset.geojson.features[featureIndex];
                    }
                    return feature;
                };

                void resolveFeature().then(async (feature) => {
                    if (!feature) return;
                    const latlng = { lat: e.lngLat.lat, lng: e.lngLat.lng };
                    let nearby = this._findFeaturesNearClick(latlng, dataset.id, featureIndex, e.point);
                    nearby = await this._enrichPopupHitsWithWorkspaceAttrs(nearby);
                    this.highlightFeature(dataset.id, featureIndex, styFlat.strokeColor);
                    this._popupHits = nearby.length > 0 ? nearby : [{
                        feature: this._stripInternalProps(feature), featureIndex,
                        layerId: dataset.id, layerName: dataset.name,
                        layerColor: styFlat.strokeColor
                    }];
                    this._popupIndex = 0;
                    this._popupLatLng = latlng;
                    this._renderCyclePopup();

                    if (this._canSelect()) {
                        const ev = e.originalEvent;
                        const toggle = !!(ev?.shiftKey || ev?.ctrlKey || ev?.metaKey);
                        this._syncSelectionContext(dataset.id, featureIndex, { toggle });
                    }
                });
            });

            this.map.on('contextmenu', lid, (e) => {
                e.preventDefault();
                const props = e.features?.[0]?.properties;
                if (!props) return;
                const featureIndex = props._featureIndex;
                const feature = dataset.geojson.features[featureIndex];
                bus.emit('map:contextmenu', {
                    latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
                    originalEvent: e.originalEvent,
                    layerId: dataset.id, featureIndex, feature
                });
            });

            this.map.on('mouseenter', lid, () => {
                if (this.map.getCanvas().style.cursor !== 'crosshair') {
                    this.map.getCanvas().style.cursor = 'pointer';
                }
            });
            this.map.on('mouseleave', lid, () => {
                if (this.map.getCanvas().style.cursor !== 'crosshair') {
                    this.map.getCanvas().style.cursor = '';
                }
            });
            this._boundClickLayers.add(lid);
        }
    }


    /**
     * Add a large layer in batches to avoid blocking the main thread.
     * @param {object} dataset
     * @param {number} colorIndex
     * @param {{ fit?: boolean, batchSize?: number }} [options]
     */
    async addLayerIncremental(dataset, colorIndex = 0, { fit = false, batchSize = MAP_CHUNK_BATCH_SIZE } = {}) {
        const allFeatures = dataset.geojson?.features || [];
        if (allFeatures.length <= batchSize) {
            this.addLayer(dataset, colorIndex, { fit });
            return;
        }

        const savedFeatures = allFeatures;
        dataset.geojson = { type: 'FeatureCollection', features: savedFeatures.slice(0, batchSize) };
        this.addLayer(dataset, colorIndex, { fit: false });
        dataset.geojson = { type: 'FeatureCollection', features: savedFeatures };

        let loaded = batchSize;
        while (loaded < savedFeatures.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
            const end = Math.min(loaded + batchSize, savedFeatures.length);
            this.appendFeaturesToLayer(dataset.id, dataset, savedFeatures.slice(loaded, end), loaded);
            loaded = end;
        }

        if (fit) {
            try {
                const turf = await import('@turf/turf');
                const bbox = turf.bbox({ type: 'FeatureCollection', features: savedFeatures });
                if (bbox && isFinite(bbox[0])) {
                    this.map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 30, maxZoom: 16 });
                }
            } catch (e) {
                logger.warn('Map', 'Could not fit bounds after incremental load', { error: e.message });
            }
        }

        logger.info('Map', 'Layer added incrementally', {
            name: dataset.name,
            featureCount: savedFeatures.length
        });
    }

    _ensureSymbolImage(shape, color, fillColor, size, opacity) {
        const imgName = `sym-${shape}-${color}-${fillColor}-${size}-${opacity}`.replace(/#/g, '');
        if (this.map.hasImage(imgName)) return imgName;

        const svg = _makeSymbolSVG(shape, color, fillColor, size, opacity);
        if (!svg) return imgName;

        const img = new Image();
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            if (!this.map.hasImage(imgName)) {
                this.map.addImage(imgName, img);
            }
            URL.revokeObjectURL(url);
        };
        img.src = url;
        return imgName;
    }

    _getInteractiveLayerIds() {
        const ids = [];
        for (const info of this.dataLayers.values()) {
            ids.push(...info.layerIds);
        }
        return ids;
    }

    removeLayer(id) {
        const info = this.dataLayers.get(id);
        if (info) {
            const chunks = info.chunkSources || [{ sourceId: info.sourceId, layerIds: info.layerIds || [] }];
            for (const chunk of chunks) {
                for (const lid of chunk.layerIds) {
                    if (this.map.getLayer(lid)) this.map.removeLayer(lid);
                    this._boundClickLayers?.delete(lid);
                }
                if (this.map.getSource(chunk.sourceId)) this.map.removeSource(chunk.sourceId);
            }
            removeAnnotationSources(this.map, id);
            this._annotationOverlay?.unregister(id);
            this.dataLayers.delete(id);
        }
        this._workspaceDatasets?.delete(id);
        this._layerNames.delete(id);
        this.clearSelection(id);
    }

    _applyDatasetVisibility(dataset) {
        if (dataset?.visible === false) {
            this.toggleLayer(dataset.id, false);
        }
    }

    toggleLayer(id, visible) {
        const info = this.dataLayers.get(id);
        if (!info) return;
        const visibility = visible ? 'visible' : 'none';
        for (const lid of info.layerIds) {
            if (this.map.getLayer(lid)) this.map.setLayoutProperty(lid, 'visibility', visibility);
        }
    }

    restyleLayer(layerId, dataset, style) {
        this._layerStyles.set(layerId, { ...style });
        this.addLayer(dataset, this._getLayerZIndex(layerId), { fit: false });
        bus.emit('map:styleChanged', { layerId });
    }

    /**
     * Refresh the GeoJSON source data for an existing layer on the map.
     * Call after in-place mutations to feature properties (e.g. attribute joins).
     */
    refreshLayerData(dataset) {
        const entry = this.dataLayers.get(dataset.id);
        if (!entry) return;
        const source = this.map?.getSource(entry.sourceId);
        if (!source) return;

        const taggedFeatures = _tagFeaturesForMap(dataset);
        const geojson = { type: 'FeatureCollection', features: taggedFeatures };
        source.setData(geojson);
        entry.geojson = geojson;
    }

    _getLayerZIndex(layerId) {
        let i = 0;
        for (const id of this.dataLayers.keys()) {
            if (id === layerId) return i;
            i++;
        }
        return 0;
    }

    static get pointSymbols() {
        return POINT_SYMBOL_NAMES;
    }

    syncLayerOrder(orderedIds) {
        for (const id of orderedIds) {
            const info = this.dataLayers.get(id);
            if (!info) continue;
            for (const lid of info.layerIds) {
                if (this.map.getLayer(lid)) this.map.moveLayer(lid);
            }
        }
    }

    // ==========================================
    // Popups
    // ==========================================

    _buildPopupHtml(feature) {
        const props = feature.properties || {};
        let imgHtml = '';
        const imgSrc = props._thumbnailUrl || props._thumbnailDataUrl;
        if (imgSrc) {
            imgHtml = `<div style="margin-bottom:6px;text-align:center;">
                <img src="${imgSrc}" style="max-width:280px;max-height:200px;border-radius:4px;" />
            </div>`;
        }

        const rows = Object.entries(props)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, v]) => {
                if (v && typeof v === 'object' && v._att && v.dataUrl) {
                    return `<tr><th>${k}</th><td style="padding:4px 0;">
                        <img src="${v.dataUrl}" style="max-width:240px;max-height:180px;border-radius:4px;display:block;margin-bottom:2px;" />
                        <span style="font-size:10px;color:#888;">${v.name || 'photo'}</span>
                    </td></tr>`;
                }
                let val = v;
                if (val == null) val = '';
                else if (typeof v === 'object') val = JSON.stringify(v);
                if (typeof val === 'string' && val.length > 100) val = val.slice(0, 100) + '…';
                return `<tr><th>${k}</th><td>${val}</td></tr>`;
            }).join('');
        const tableHtml = rows ? `<table>${rows}</table>` : '<em>No attributes</em>';
        return imgHtml + tableHtml;
    }

    _attachPopup(popup) {
        popup.addTo(this.map);
        resetMapPopupScroll(popup);
        popup.on('open', () => resetMapPopupScroll(popup));
    }

    showPopup(feature, layer, latlng) {
        const html = this._buildPopupHtml(feature);
        const pos = latlng || this._getFeatureCenter(feature);
        this._closePopup();
        this._popup = new maplibregl.Popup({ maxWidth: '350px' })
            .setLngLat([pos.lng, pos.lat])
            .setHTML(`<div class="map-popup-content"><div class="map-popup-attributes">${html}</div></div>`);
        this._attachPopup(this._popup);
        this._popup.on('close', () => this.clearHighlight());
    }

    _closePopup() {
        if (this._popup) {
            this._popup.remove();
            this._popup = null;
        }
    }

    _getFeatureCenter(feature) {
        try {
            const c = turf.centroid(feature);
            return { lng: c.geometry.coordinates[0], lat: c.geometry.coordinates[1] };
        } catch {
            return { lng: 0, lat: 0 };
        }
    }

    // ==========================================
    // Feature hit detection
    // ==========================================

    _queryFeaturesAtPoint(point, layerIds = null, bufferPx = FEATURE_QUERY_BUFFER_PX) {
        const layers = layerIds ?? this._getInteractiveLayerIds();
        if (!layers.length || !this.map) return [];
        const min = { x: point.x - bufferPx, y: point.y - bufferPx };
        const max = { x: point.x + bufferPx, y: point.y + bufferPx };
        return this.map.queryRenderedFeatures([min, max], { layers });
    }

    _findFeaturesNearClick(latlng, clickedLayerId, clickedFeatureIndex, point = null) {
        const pixel = point ?? this.map.project([latlng.lng, latlng.lat]);
        const results = [];
        const allLayerIds = this._getInteractiveLayerIds();
        const rendered = allLayerIds.length > 0 ? this._queryFeaturesAtPoint(pixel, allLayerIds) : [];

        const seen = new Set();
        for (const rf of rendered) {
            const props = rf.properties;
            if (!props || props._featureIndex === undefined) continue;
            const key = `${props._datasetId}-${props._featureIndex}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const layerId = props._datasetId;
            const featureIndex = props._featureIndex;
            const layerName = this._layerNames.get(layerId) || layerId;
            const sty = this._layerStyles.get(layerId);
            const layerColor = sty?.strokeColor || '#2563eb';

            const info = this.dataLayers.get(layerId);
            let feature = null;
            if (info?.geojson?.features) {
                feature = info.geojson.features.find(f => f.properties?._featureIndex === featureIndex);
            }
            if (!feature) continue;

            results.push({
                feature: this._stripInternalProps(feature),
                featureIndex, layerId, layerName, layerColor
            });
        }

        if (clickedLayerId !== undefined && clickedFeatureIndex !== undefined) {
            const idx = results.findIndex(r => r.layerId === clickedLayerId && r.featureIndex === clickedFeatureIndex);
            if (idx > 0) {
                const [clicked] = results.splice(idx, 1);
                results.unshift(clicked);
            }
        }

        return results;
    }

    async _enrichPopupHitsWithWorkspaceAttrs(hits) {
        if (!hits?.length) return hits;
        const out = [];
        for (const hit of hits) {
            const info = this.dataLayers.get(hit.layerId);
            if (!info?.workspace) {
                out.push(hit);
                continue;
            }
            const wsDataset = this._workspaceDatasets?.get(hit.layerId);
            const wsId = wsDataset?.workspaceLayerId || hit.layerId;
            const attrs = await getWorkspaceFeatureAttributes(wsId, hit.featureIndex);
            if (!attrs) {
                out.push(hit);
                continue;
            }
            out.push({
                ...hit,
                feature: this._stripInternalProps({
                    ...hit.feature,
                    properties: attrs
                })
            });
        }
        return out;
    }

    _stripInternalProps(feature) {
        if (!feature?.properties) return feature;
        const props = {};
        for (const [k, v] of Object.entries(feature.properties)) {
            if (!k.startsWith('_')) props[k] = v;
        }
        return { ...feature, properties: props };
    }

    async _showMultiPopup(hits, latlng) {
        if (hits.length === 0) return;
        const enriched = await this._enrichPopupHitsWithWorkspaceAttrs(hits);
        this._popupHits = enriched;
        this._popupIndex = 0;
        this._popupLatLng = latlng;
        this._renderCyclePopup();
    }

    _renderCyclePopup() {
        const hits = this._popupHits;
        const idx = this._popupIndex;
        if (!hits || !hits[idx]) return;

        const hit = hits[idx];
        const bodyHtml = this._buildPopupHtml(hit.feature);
        const layerName = hit.layerName || hit.layerId;
        const layerLabel = `<div style="font-size:10px;color:var(--text-muted);margin-bottom:4px;border-bottom:1px solid var(--border);padding-bottom:3px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${hit.layerColor};margin-right:4px;"></span>
            <strong>${layerName}</strong>
        </div>`;

        let navHtml = '';
        if (hits.length > 1) {
            navHtml = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;font-size:11px;">
                <button type="button" data-map-popup-action="nav" data-dir="-1" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 8px;cursor:pointer;font-size:13px;">&larr;</button>
                <span>${idx + 1} of ${hits.length}</span>
                <button type="button" data-map-popup-action="nav" data-dir="1" style="background:none;border:1px solid var(--border);color:var(--text);border-radius:3px;padding:1px 8px;cursor:pointer;font-size:13px;">&rarr;</button>
            </div>`;
        }

        const editBtn = `<div style="margin-top:6px;border-top:1px solid var(--border);padding-top:4px;text-align:right;">
            <button type="button" data-map-popup-action="edit" style="background:var(--primary);color:#fff;border:none;border-radius:4px;padding:3px 12px;cursor:pointer;font-size:12px;">✏️ Edit</button>
        </div>`;

        const html = `<div class="map-popup-content">${layerLabel}${navHtml}<div class="map-popup-attributes">${bodyHtml}</div>${editBtn}</div>`;

        this.highlightFeature(hit.layerId, hit.featureIndex, hit.layerColor);

        // Suppress close handler while cycling between features
        this._cyclingPopup = true;
        this._closePopup();
        this._cyclingPopup = false;

        this._popup = new maplibregl.Popup({ maxWidth: '350px', closeOnClick: false })
            .setLngLat([this._popupLatLng.lng, this._popupLatLng.lat])
            .setHTML(html);
        this._attachPopup(this._popup);

        this._popup.on('close', () => {
            if (this._cyclingPopup) return;
            this.clearHighlight();
            this._popupHits = null;
        });
    }

    // ==========================================
    // Feature highlighting
    // ==========================================

    highlightFeature(layerId, featureIndex, originalColor) {
        this.clearHighlight();
        const info = this.dataLayers.get(layerId);
        if (!info) return;
        const matches = info.geojson.features.filter(f => f.properties?._featureIndex === featureIndex);
        if (matches.length === 0) return;

        this._highlightedInfo = { layerId, featureIndex };
        const hlSrcId = 'highlight-source';

        if (this.map.getSource(hlSrcId)) {
            this.map.getSource(hlSrcId).setData({ type: 'FeatureCollection', features: matches });
        } else {
            this.map.addSource(hlSrcId, { type: 'geojson', data: { type: 'FeatureCollection', features: matches } });
        }

        const hasHlPoint = matches.some(f => {
            const t = f.geometry?.type;
            return t === 'Point' || t === 'MultiPoint';
        });
        const hasHlLine = matches.some(f => {
            const t = f.geometry?.type;
            return t === 'LineString' || t === 'MultiLineString';
        });
        const hasHlPoly = matches.some(f => {
            const t = f.geometry?.type;
            return t === 'Polygon' || t === 'MultiPolygon';
        });

        if (hasHlPoint) {
            if (!this.map.getLayer('highlight-circle')) {
                this.map.addLayer({
                    id: 'highlight-circle', type: 'circle', source: hlSrcId,
                    filter: _geomTypesFilter(['Point', 'MultiPoint']),
                    paint: { 'circle-radius': 10, 'circle-color': '#fbbf24', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-opacity': 1 }
                });
            }
        }
        if (hasHlLine) {
            if (!this.map.getLayer('highlight-line')) {
                this.map.addLayer({
                    id: 'highlight-line', type: 'line', source: hlSrcId,
                    filter: _geomTypesFilter(['LineString', 'MultiLineString']),
                    paint: { 'line-color': '#fbbf24', 'line-width': 4, 'line-opacity': 1 }
                });
            }
        }
        if (hasHlPoly) {
            if (!this.map.getLayer('highlight-fill')) {
                this.map.addLayer({
                    id: 'highlight-fill', type: 'fill', source: hlSrcId,
                    filter: _geomTypesFilter(['Polygon', 'MultiPolygon']),
                    paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.35 }
                });
            }
            if (!this.map.getLayer('highlight-outline')) {
                this.map.addLayer({
                    id: 'highlight-outline', type: 'line', source: hlSrcId,
                    filter: _geomTypesFilter(['Polygon', 'MultiPolygon']),
                    paint: { 'line-color': '#fbbf24', 'line-width': 4, 'line-opacity': 1 }
                });
            }
        }
    }

    clearHighlight() {
        for (const lid of ['highlight-fill', 'highlight-line', 'highlight-circle', 'highlight-outline']) {
            if (this.map?.getLayer(lid)) this.map.removeLayer(lid);
        }
        if (this.map?.getSource('highlight-source')) {
            this.map.getSource('highlight-source').setData({ type: 'FeatureCollection', features: [] });
        }
        this._highlightedInfo = null;
    }

    fitToAll() {
        this.fitToLayers([...this.dataLayers.keys()]);
    }

    /** Fit map view to the combined extent of the given layer ids. */
    async fitToLayers(layerIds) {
        if (!this.map || !layerIds?.length) return;

        let west = Infinity;
        let south = Infinity;
        let east = -Infinity;
        let north = -Infinity;
        let found = false;

        for (const id of layerIds) {
            const info = this.dataLayers.get(id);
            if (info?.workspace) {
                const wb = await getWorkspaceLayerBounds(
                    this._workspaceDatasets?.get(id)?.workspaceLayerId || id
                );
                if (wb) {
                    found = true;
                    if (wb[0] < west) west = wb[0];
                    if (wb[1] < south) south = wb[1];
                    if (wb[2] > east) east = wb[2];
                    if (wb[3] > north) north = wb[3];
                }
                continue;
            }
            const features = info?.geojson?.features;
            if (!features?.length) continue;
            for (let i = 0; i < features.length; i++) {
                const f = features[i];
                if (!f?.geometry?.coordinates) continue;
                const bb = turf.bbox(f);
                if (!bb || !isFinite(bb[0])) continue;
                found = true;
                if (bb[0] < west) west = bb[0];
                if (bb[1] < south) south = bb[1];
                if (bb[2] > east) east = bb[2];
                if (bb[3] > north) north = bb[3];
            }
        }

        if (found && isFinite(west)) {
            try {
                this.map.fitBounds([[west, south], [east, north]], { padding: 30, maxZoom: 16 });
            } catch (_) {}
        }
    }

    getBounds() {
        if (!this.map) return null;
        const b = this.map.getBounds();
        return {
            getWest: () => b.getWest(),
            getEast: () => b.getEast(),
            getNorth: () => b.getNorth(),
            getSouth: () => b.getSouth()
        };
    }

    getMap() { return this.map; }

    /** Resize map — replaces Leaflet's invalidateSize */
    resize() {
        this.map?.resize();
    }

    // ==========================================
    // 3D Terrain & Buildings
    // ==========================================

    toggle3D() {
        this._3dEnabled ? this.disable3D() : this.enable3D();
    }

    /** Internal helper — adds terrain, sky, buildings without changing _3dEnabled flag */
    _apply3D() {
        if (!this.map.getSource('terrain-source')) {
            this.map.addSource('terrain-source', {
                type: 'raster-dem',
                tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
                encoding: 'terrarium',
                tileSize: 256,
                maxzoom: 15
            });
        }
        this.map.setTerrain({ source: 'terrain-source', exaggeration: 1.5 });
        this._terrainEnabled = true;

        // Only add hillshade on non-satellite basemaps
        if (this.currentBasemap !== 'satellite' && !this.map.getLayer('hillshade')) {
            // Find the first non-basemap layer to insert hillshade above basemap but below data
            const layers = this.map.getStyle().layers;
            let beforeId;
            for (const l of layers) {
                if (!l.id.startsWith('basemap') && l.id !== 'hillshade' && l.id !== 'sky') {
                    beforeId = l.id;
                    break;
                }
            }
            this.map.addLayer({
                id: 'hillshade',
                type: 'hillshade',
                source: 'terrain-source',
                paint: {
                    'hillshade-illumination-direction': 315,
                    'hillshade-exaggeration': 0.8,
                    'hillshade-shadow-color': '#473B24',
                    'hillshade-highlight-color': '#FFFFFF',
                    'hillshade-accent-color': '#6e6e6e'
                }
            }, beforeId);
        } else if (this.currentBasemap === 'satellite' && this.map.getLayer('hillshade')) {
            this.map.removeLayer('hillshade');
        }

        if (!this.map.getLayer('sky')) {
            this.map.addLayer({
                id: 'sky', type: 'sky',
                paint: { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 }
            });
        }
        this._addBuildingsLayer();
    }

    enable3D() {
        if (this._3dEnabled) return;
        this._3dEnabled = true;

        // Snapshot current view so the tilt doesn't shift position
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();

        // Unlock pitch / rotation for 3D
        this.map.dragRotate.enable();
        this.map.touchZoomRotate.enableRotation();

        this._apply3D();

        // Wait for terrain tiles to start loading before tilting
        // (prevents black flash when DEM tiles haven't arrived yet)
        let tilted = false;
        const doTilt = () => {
            if (tilted) return;
            tilted = true;
            this.map.easeTo({ pitch: 30, center, zoom, duration: 800 });
        };
        const onSourceData = (e) => {
            if (e.sourceId === 'terrain-source' && e.isSourceLoaded) {
                this.map.off('sourcedata', onSourceData);
                doTilt();
            }
        };
        this.map.on('sourcedata', onSourceData);
        // Fallback: tilt after short delay even if tiles are slow
        setTimeout(() => { this.map.off('sourcedata', onSourceData); doTilt(); }, 600);

        logger.info('Map', '3D terrain and buildings enabled');
        bus.emit('map:3dChanged', true);
    }

    disable3D() {
        if (!this._3dEnabled) return;
        this._3dEnabled = false;

        // Snapshot center so the un-tilt doesn't shift position
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();

        // Flatten camera FIRST while terrain is still loaded
        // (removing terrain at a tilted pitch causes the black-screen flash)
        this.map.easeTo({ pitch: 0, bearing: 0, center, zoom, duration: 500 });

        // After the camera is flat, tear down 3D assets safely
        const cleanup = () => {
            // Guard: if 3D was re-enabled while animating, skip teardown
            if (this._3dEnabled) return;

            this.map.setTerrain(null);
            this._terrainEnabled = false;

            if (this.map.getLayer('hillshade')) this.map.removeLayer('hillshade');
            if (this.map.getLayer('sky')) this.map.removeLayer('sky');
            this._removeBuildingsLayer();
            if (this.map.getSource('terrain-source')) this.map.removeSource('terrain-source');

            this.map.dragRotate.disable();
            this.map.touchZoomRotate.disableRotation();
        };
        this.map.once('moveend', cleanup);

        logger.info('Map', '3D terrain and buildings disabled');
        bus.emit('map:3dChanged', false);
    }

    _addBuildingsLayer() {
        if (this._buildingsEnabled) return;

        if (!this.map.getSource('openfreemap')) {
            this.map.addSource('openfreemap', {
                type: 'vector',
                url: 'https://tiles.openfreemap.org/planet'
            });
        }

        if (!this.map.getLayer('3d-buildings')) {
            this.map.addLayer({
                id: '3d-buildings',
                source: 'openfreemap',
                'source-layer': 'building',
                type: 'fill-extrusion',
                minzoom: 15,
                filter: ['!=', ['get', 'hide_3d'], true],
                paint: {
                    'fill-extrusion-color': [
                        'interpolate', ['linear'], ['get', 'render_height'],
                        0, 'lightgray', 200, 'royalblue', 400, 'lightblue'
                    ],
                    'fill-extrusion-height': [
                        'interpolate', ['linear'], ['zoom'],
                        15, 0, 16, ['get', 'render_height']
                    ],
                    'fill-extrusion-base': [
                        'case',
                        ['>=', ['get', 'zoom'], 16],
                        ['get', 'render_min_height'], 0
                    ]
                }
            });
        }

        this._buildingsEnabled = true;
    }

    _removeBuildingsLayer() {
        if (this.map.getLayer('3d-buildings')) this.map.removeLayer('3d-buildings');
        if (this.map.getSource('openfreemap')) this.map.removeSource('openfreemap');
        this._buildingsEnabled = false;
    }

    get is3DEnabled() { return this._3dEnabled; }

    // ==========================================
    // Camera Orbit Animation
    // ==========================================

    /** Min zoom for orbit (close-in — roughly street/building level) */
    static ORBIT_MIN_ZOOM = 13;
    /** Max zoom for orbit (prevents orbiting from too far out) */
    static ORBIT_MAX_ZOOM = 18;
    /** Default pitch during orbit */
    static ORBIT_PITCH = 55;

    /**
     * Start an animated camera orbit around a point.
     * Auto-enables 3D if needed. Clamps zoom to the allowed range.
     * @param {object} center  { lng, lat }
     */
    startCameraOrbit(center) {
        // Stop any existing orbit first
        this.stopCameraOrbit();

        const map = this.map;
        this._orbitCenter = center;

        // Enable 3D if not already
        if (!this._3dEnabled) {
            this.enable3D();
        }

        // Clamp zoom to the sweet-spot range
        let zoom = map.getZoom();
        if (zoom < MapManager.ORBIT_MIN_ZOOM) zoom = MapManager.ORBIT_MIN_ZOOM;
        if (zoom > MapManager.ORBIT_MAX_ZOOM) zoom = MapManager.ORBIT_MAX_ZOOM;

        // Fly to the orbit starting position, then begin rotation
        map.flyTo({
            center: [center.lng, center.lat],
            zoom,
            pitch: MapManager.ORBIT_PITCH,
            duration: 1500
        });

        // Auto-stop orbit on any user interaction
        const stopOnInteract = () => this.stopCameraOrbit();
        const mapEvents = ['dragstart', 'wheel', 'click', 'dblclick', 'contextmenu', 'touchstart'];
        mapEvents.forEach(evt => map.once(evt, stopOnInteract));
        const canvas = map.getCanvas();
        canvas.addEventListener('keydown', stopOnInteract, { once: true });
        this._orbitCleanup = () => {
            mapEvents.forEach(evt => map.off(evt, stopOnInteract));
            canvas.removeEventListener('keydown', stopOnInteract);
        };

        map.once('moveend', () => {
            if (!this._orbitCenter) return; // cancelled while flying
            const startBearing = map.getBearing();
            const startTime = performance.now();
            const degreesPerSec = 10; // rotation speed

            const frame = (now) => {
                if (!this._orbitCenter) return; // stopped
                const elapsed = (now - startTime) / 1000;
                const bearing = startBearing + elapsed * degreesPerSec;
                map.rotateTo(bearing % 360, { duration: 0 });
                this._orbitAnimId = requestAnimationFrame(frame);
            };
            this._orbitAnimId = requestAnimationFrame(frame);
        });

        logger.debug('Map', `Camera orbit started at ${center.lat.toFixed(4)}, ${center.lng.toFixed(4)}`);
        bus.emit('map:orbitStarted', center);
    }

    /** Stop any active camera orbit animation */
    stopCameraOrbit() {
        if (this._orbitAnimId) {
            cancelAnimationFrame(this._orbitAnimId);
            this._orbitAnimId = null;
        }
        if (this._orbitCleanup) {
            this._orbitCleanup();
            this._orbitCleanup = null;
        }
        if (this._orbitCenter) {
            this._orbitCenter = null;
            logger.debug('Map', 'Camera orbit stopped');
            bus.emit('map:orbitStopped');
        }
    }

    /** Whether an orbit animation is currently running */
    get isOrbiting() { return !!this._orbitCenter; }

    /**
     * Fly to orbit view (3D, pitch, zoom clamp) before a scripted rotation export.
     * @param {{ lng: number, lat: number }} center
     * @param {{ zoom?: number, pitch?: number, duration?: number }} [options]
     * @returns {Promise<{ startBearing: number }>}
     */
    async prepareOrbitView(center, options = {}) {
        this.stopCameraOrbit();
        const map = this.map;
        if (!map) {
            throw new Error('Map is not ready');
        }

        if (!this._3dEnabled) {
            this.enable3D();
        }

        let zoom = options.zoom ?? map.getZoom();
        if (zoom < MapManager.ORBIT_MIN_ZOOM) zoom = MapManager.ORBIT_MIN_ZOOM;
        if (zoom > MapManager.ORBIT_MAX_ZOOM) zoom = MapManager.ORBIT_MAX_ZOOM;

        let pitch = options.pitch ?? MapManager.ORBIT_PITCH;
        if (pitch < 0) pitch = 0;
        if (pitch > 85) pitch = 85;

        await new Promise((resolve) => {
            map.once('moveend', resolve);
            map.flyTo({
                center: [center.lng, center.lat],
                zoom,
                pitch,
                duration: options.duration ?? 1500
            });
        });

        return { startBearing: map.getBearing() };
    }

    _touchClientToLngLat(clientX, clientY) {
        const rect = this.map.getContainer().getBoundingClientRect();
        return this.map.unproject(new maplibregl.Point(clientX - rect.left, clientY - rect.top));
    }

    _finalizeDragBboxLngLat(start, endLL) {
        const w = Math.min(start.lng, endLL.lng);
        const s = Math.min(start.lat, endLL.lat);
        const east = Math.max(start.lng, endLL.lng);
        const n = Math.max(start.lat, endLL.lat);
        if (!bboxDiagonalMeetsMinDragPx(w, s, east, n, (ll) => this.map.project(ll))) {
            return null;
        }
        return [w, s, east, n];
    }

    // ==========================================
    // Interactive Drawing / Selection System
    // ==========================================

    startPointPick(prompt = 'Click the map to place a point') {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const banner = this._showInteractionBanner(prompt, () => { cleanup(); resolve(null); });

            const onClick = (e) => {
                markMapInteractionHandled(e);
                cleanup();
                resolve([e.lngLat.lng, e.lngLat.lat]);
            };
            const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('click', onClick);
                document.removeEventListener('keydown', onKeyDown);
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('click', onClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    /**
     * Repeated map clicks until Esc or banner Cancel. onPoint(coord) runs after each click.
     * @param {string} prompt
     * @param {(coord: number[]) => void | Promise<void>} onPoint
     * @returns {Promise<void>}
     */
    startContinuousPointPick(prompt = 'Click the map to add points (Esc or Cancel when done)', onPoint) {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const finish = () => {
                cleanup();
                resolve();
            };

            const banner = this._showInteractionBanner(prompt, finish);

            const onClick = (e) => {
                markMapInteractionHandled(e);
                const coord = [e.lngLat.lng, e.lngLat.lat];
                Promise.resolve(onPoint?.(coord)).catch(() => finish());
            };
            const onKeyDown = (e) => { if (e.key === 'Escape') finish(); };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('click', onClick);
                document.removeEventListener('keydown', onKeyDown);
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('click', onClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    startTwoPointPick(prompt1 = 'Click the first point', prompt2 = 'Click the second point') {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';
            const markers = [];
            let firstPoint = null;

            const dblClickZoom = suspendDoubleClickZoom(this.map);

            const banner = this._showInteractionBanner(prompt1, () => { cleanup(); resolve(null); });
            const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

            const onClick = (e) => {
                markMapInteractionHandled(e);
                const coord = [e.lngLat.lng, e.lngLat.lat];
                const el = document.createElement('div');
                el.style.cssText = 'width:14px;height:14px;background:#d4a24e;border:2px solid #fff;border-radius:50%;';
                const m = new maplibregl.Marker({ element: el }).setLngLat(coord).addTo(this.map);
                markers.push(m);

                if (!firstPoint) {
                    firstPoint = coord;
                    banner.querySelector('.interaction-text').textContent = prompt2;
                } else {
                    cleanup();
                    resolve([firstPoint, coord]);
                }
            };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('click', onClick);
                document.removeEventListener('keydown', onKeyDown);
                markers.forEach(m => m.remove());
                if (banner) banner.remove();
                dblClickZoom.restore();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('click', onClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    /**
     * Two-click pick snapped to a route centerline; returns distances along the line in feet.
     * @param {import('geojson').Feature<import('geojson').LineString|import('geojson').MultiLineString>} routeLine
     * @param {string} [prompt1]
     * @param {string} [prompt2]
     * @returns {Promise<{ mapClipStartFt: number, mapClipEndFt: number } | null>}
     */
    startRouteTwoPointPick(routeLine, prompt1 = 'Click start of clip along route', prompt2 = 'Click end of clip along route', options = {}) {
        const markerColor = options.markerColor || '#22c55e';
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';
            const markers = [];
            let firstLocFt = null;
            let previewEntry = null;
            let settled = false;

            const dblClickZoom = suspendDoubleClickZoom(this.map);

            const clearClipPreview = () => {
                if (previewEntry) {
                    this._removeTempFeature(previewEntry);
                    previewEntry = null;
                }
            };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('click', onClick);
                document.removeEventListener('keydown', onKeyDown);
                markers.forEach(m => m.remove());
                if (banner) banner.remove();
                dblClickZoom.restore();
                this._interactionCleanup = null;
            };

            const finish = (value) => {
                if (settled) return;
                settled = true;
                cleanup();
                clearClipPreview();
                resolve(value);
            };

            const cancelPick = () => finish(null);

            const banner = this._showInteractionBanner(prompt1, cancelPick);
            const onKeyDown = (e) => { if (e.key === 'Escape') cancelPick(); };

            const showClipPreview = (startFt, endFt) => {
                if (!Number.isFinite(startFt) || !Number.isFinite(endFt)) return;
                const startDist = Math.min(startFt, endFt);
                const endDist = Math.max(startFt, endFt);
                if (endDist <= startDist) return;
                const segment = lineSliceAlongRoute(routeLine, startDist, endDist, 'feet');
                clearClipPreview();
                previewEntry = this.showRouteMilepostPreview({
                    type: 'FeatureCollection',
                    features: [{
                        ...segment,
                        properties: { ...(segment.properties || {}), _preview: 'centerline_segment' }
                    }]
                }, 0);
            };

            const onClick = (e) => {
                if (settled) return;
                markMapInteractionHandled(e);
                try { e.originalEvent?.stopPropagation?.(); } catch (_) { /* noop */ }
                try { e.originalEvent?.preventDefault?.(); } catch (_) { /* noop */ }

                const snapped = nearestPointOnRouteLine(
                    { type: 'Feature', geometry: { type: 'Point', coordinates: [e.lngLat.lng, e.lngLat.lat] } },
                    routeLine,
                    'feet'
                );
                const coord = snapped.geometry.coordinates;
                const locFt = Number(snapped.properties?.location ?? NaN);
                if (!Number.isFinite(locFt)) {
                    banner.querySelector('.interaction-text').textContent = 'Could not snap to route — try again closer to the line.';
                    return;
                }

                const el = document.createElement('div');
                el.style.cssText = `width:14px;height:14px;background:${markerColor};border:2px solid #fff;border-radius:50%;`;
                const m = new maplibregl.Marker({ element: el }).setLngLat(coord).addTo(this.map);
                markers.push(m);

                if (firstLocFt == null) {
                    firstLocFt = locFt;
                    banner.querySelector('.interaction-text').textContent = prompt2;
                    return;
                }

                const startDist = Math.min(firstLocFt, locFt);
                const endDist = Math.max(firstLocFt, locFt);
                try {
                    showClipPreview(startDist, endDist);
                } catch (_) { /* preview optional */ }
                finish({ mapClipStartFt: startDist, mapClipEndFt: endDist });
            };

            this._interactionCleanup = cancelPick;
            this.map.on('click', onClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    startRectangleDraw(prompt = 'Click and drag to draw a rectangle') {
        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';
            const banner = this._showInteractionBanner(prompt, () => { cleanup(); resolve(null); });

            let startLngLat = null;
            const rectId = this._nextId('rect-draw');
            const container = this.map.getContainer();

            this.map.addSource(rectId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            this.map.addLayer({ id: rectId + '-fill', type: 'fill', source: rectId, paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.15 } });
            this.map.addLayer({ id: rectId + '-line', type: 'line', source: rectId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });

            const onMouseDown = (e) => {
                startLngLat = e.lngLat;
                this.map.dragPan.disable();
            };
            const onMouseMove = (e) => { if (startLngLat) this._updateRectGeoJSON(rectId, startLngLat, e.lngLat); };
            const onMouseUp = (e) => {
                if (!startLngLat) return;
                markMapInteractionHandled(e);
                const start = startLngLat;
                startLngLat = null;
                this.map.dragPan.enable();
                const bbox = this._finalizeDragBboxLngLat(start, e.lngLat);
                cleanup();
                resolve(bbox);
            };

            const onTouchStart = (e) => {
                if (e.touches.length !== 1) return;
                e.preventDefault();
                startLngLat = this._touchClientToLngLat(e.touches[0].clientX, e.touches[0].clientY);
                this.map.dragPan.disable();
            };
            const onTouchMove = (e) => {
                if (!startLngLat || e.touches.length !== 1) return;
                e.preventDefault();
                const ll = this._touchClientToLngLat(e.touches[0].clientX, e.touches[0].clientY);
                this._updateRectGeoJSON(rectId, startLngLat, ll);
            };
            const onTouchEnd = (e) => {
                if (!startLngLat) return;
                e.preventDefault();
                const ll = this._touchClientToLngLat(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                const start = startLngLat;
                startLngLat = null;
                this.map.dragPan.enable();
                const bbox = this._finalizeDragBboxLngLat(start, ll);
                cleanup();
                resolve(bbox);
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') {
                    startLngLat = null;
                    this.map.dragPan.enable();
                    cleanup();
                    resolve(null);
                }
            };

            const cleanup = () => {
                canvas.style.cursor = '';
                this.map.off('mousedown', onMouseDown);
                this.map.off('mousemove', onMouseMove);
                this.map.off('mouseup', onMouseUp);
                container.removeEventListener('touchstart', onTouchStart);
                container.removeEventListener('touchmove', onTouchMove);
                container.removeEventListener('touchend', onTouchEnd);
                document.removeEventListener('keydown', onKeyDown);
                if (this.map.getLayer(rectId + '-fill')) this.map.removeLayer(rectId + '-fill');
                if (this.map.getLayer(rectId + '-line')) this.map.removeLayer(rectId + '-line');
                if (this.map.getSource(rectId)) this.map.removeSource(rectId);
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('mousedown', onMouseDown);
            this.map.on('mousemove', onMouseMove);
            this.map.on('mouseup', onMouseUp);
            container.addEventListener('touchstart', onTouchStart, { passive: false });
            container.addEventListener('touchmove', onTouchMove, { passive: false });
            container.addEventListener('touchend', onTouchEnd, { passive: false });
            document.addEventListener('keydown', onKeyDown);
        });
    }

    /**
     * Sketch a polygon by clicking vertices; double-click finishes without adding a duplicate vertex (draw-layer UX).
     * @param {{ bannerText?: string, onInsufficientVertices?: () => void }} [opts]
     * @returns {Promise<{ type: 'Polygon', coordinates: number[][][] } | null>}
     */
    startSketchPolygon(opts = {}) {
        const { bannerText = 'Click to add vertices. Double-click to finish.', onInsufficientVertices } = opts;
        return new Promise((resolve) => {
            this._cancelInteraction();
            const map = this.map;
            const canvas = map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const dblClickZoom = suspendDoubleClickZoom(map);

            const banner = this._showInteractionBanner(bannerText, () => { cleanup(); resolve(null); });

            const points = [];
            let clickTimer = null;
            let previewSrcId = null;
            let previewLayerIds = [];

            const drawPreview = () => {
                for (const lid of previewLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (previewSrcId && map.getSource(previewSrcId)) map.removeSource(previewSrcId);
                previewLayerIds = [];
                previewSrcId = null;

                if (points.length < 2) return;

                previewSrcId = this._nextId('sketch-poly');
                const coords = points.map(p => [p[0], p[1]]);
                if (points.length >= 3) {
                    const closed = [...coords, coords[0]];
                    map.addSource(previewSrcId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] } } });
                    const fillId = previewSrcId + '-fill';
                    map.addLayer({ id: fillId, type: 'fill', source: previewSrcId, paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.08 } });
                    const lineId = previewSrcId + '-line';
                    map.addLayer({ id: lineId, type: 'line', source: previewSrcId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });
                    previewLayerIds = [fillId, lineId];
                } else {
                    map.addSource(previewSrcId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
                    const lineId = previewSrcId + '-line';
                    map.addLayer({ id: lineId, type: 'line', source: previewSrcId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });
                    previewLayerIds = [lineId];
                }
            };

            const finishFromDblClick = () => {
                if (points.length < 3) {
                    if (typeof onInsufficientVertices === 'function') onInsufficientVertices();
                    cleanup();
                    resolve(null);
                    return;
                }
                const ring = points.map(p => [p[0], p[1]]);
                ring.push(ring[0]);
                const geom = { type: 'Polygon', coordinates: [ring] };
                cleanup();
                resolve(geom);
            };

            const onClick = (e) => {
                markMapInteractionHandled(e);
                if (clickTimer) clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    points.push([e.lngLat.lng, e.lngLat.lat]);
                    drawPreview();
                }, 90);
            };

            const onDblClick = (e) => {
                markMapInteractionHandled(e);
                if (e.originalEvent) {
                    e.originalEvent.preventDefault();
                    e.originalEvent.stopPropagation();
                }
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }
                finishFromDblClick();
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') { cleanup(); resolve(null); }
                if (e.key === 'Enter' && points.length >= 3) { finishFromDblClick(); }
            };

            const cleanup = () => {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                map.off('click', onClick);
                map.off('dblclick', onDblClick);
                document.removeEventListener('keydown', onKeyDown);
                for (const lid of previewLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (previewSrcId && map.getSource(previewSrcId)) map.removeSource(previewSrcId);
                previewLayerIds = []; previewSrcId = null;
                canvas.style.cursor = '';
                dblClickZoom.restore();
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            map.on('click', onClick);
            map.on('dblclick', onDblClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    /**
     * Sketch a polyline by clicking vertices; double-click or Enter finishes (min 2 vertices).
     * @param {{ bannerText?: string, onInsufficientVertices?: () => void }} [opts]
     * @returns {Promise<{ type: 'LineString', coordinates: number[][] } | null>}
     */
    startSketchPolyline(opts = {}) {
        const {
            bannerText = 'Click to add points. Double-click or Enter to finish the line.',
            onInsufficientVertices
        } = opts;
        return new Promise((resolve) => {
            this._cancelInteraction();
            const map = this.map;
            const canvas = map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const dblClickZoom = suspendDoubleClickZoom(map);

            const banner = this._showInteractionBanner(bannerText, () => { cleanup(); resolve(null); });

            const points = [];
            let clickTimer = null;
            let previewSrcId = null;
            let previewLayerIds = [];

            const drawPreview = () => {
                for (const lid of previewLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (previewSrcId && map.getSource(previewSrcId)) map.removeSource(previewSrcId);
                previewLayerIds = [];
                previewSrcId = null;

                if (points.length < 2) return;

                previewSrcId = this._nextId('sketch-line');
                const coords = points.map((p) => [p[0], p[1]]);
                map.addSource(previewSrcId, {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }
                });
                const lineId = previewSrcId + '-line';
                map.addLayer({
                    id: lineId,
                    type: 'line',
                    source: previewSrcId,
                    paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] }
                });
                previewLayerIds = [lineId];
            };

            const finishLine = () => {
                if (points.length < 2) {
                    if (typeof onInsufficientVertices === 'function') onInsufficientVertices();
                    cleanup();
                    resolve(null);
                    return;
                }
                const geom = { type: 'LineString', coordinates: points.map((p) => [p[0], p[1]]) };
                cleanup();
                resolve(geom);
            };

            const onClick = (e) => {
                markMapInteractionHandled(e);
                if (clickTimer) clearTimeout(clickTimer);
                clickTimer = setTimeout(() => {
                    clickTimer = null;
                    points.push([e.lngLat.lng, e.lngLat.lat]);
                    drawPreview();
                }, 90);
            };

            const onDblClick = (e) => {
                markMapInteractionHandled(e);
                if (e.originalEvent) {
                    e.originalEvent.preventDefault();
                    e.originalEvent.stopPropagation();
                }
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }
                finishLine();
            };

            const onKeyDown = (e) => {
                if (e.key === 'Escape') { cleanup(); resolve(null); }
                if (e.key === 'Enter' && points.length >= 2) { finishLine(); }
            };

            const cleanup = () => {
                if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
                map.off('click', onClick);
                map.off('dblclick', onDblClick);
                document.removeEventListener('keydown', onKeyDown);
                for (const lid of previewLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (previewSrcId && map.getSource(previewSrcId)) map.removeSource(previewSrcId);
                previewLayerIds = [];
                previewSrcId = null;
                canvas.style.cursor = '';
                dblClickZoom.restore();
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            map.on('click', onClick);
            map.on('dblclick', onDblClick);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    /**
     * Two-click circle (center → radius point), Turf polygon output.
     * @param {{ bannerText?: string, onRadiusTooSmall?: () => void }} [opts]
     * @returns {Promise<{ type: 'Polygon' | 'MultiPolygon', coordinates: number[][][] | number[][][][] } | null>}
     */
    startSketchCirclePolygon(opts = {}) {
        const { bannerText = 'Click center, then click to set radius. Esc cancels.', onRadiusTooSmall } = opts;
        const turfLib = typeof globalThis !== 'undefined' ? globalThis.turf : null;
        return new Promise((resolve) => {
            if (!turfLib) {
                logger.error('Map', 'Turf.js is required for startSketchCirclePolygon');
                resolve(null);
                return;
            }

            this._cancelInteraction();
            const map = this.map;
            const canvas = map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const banner = this._showInteractionBanner(bannerText, () => { cleanup(); resolve(null); });

            let centerLngLat = null;
            let circleSrcId = null;
            let circleLayerIds = [];

            const updateCirclePreview = (radiusM) => {
                if (!centerLngLat) return;
                let circlePoly;
                try {
                    circlePoly = turfLib.circle([centerLngLat.lng, centerLngLat.lat], radiusM / 1000, { units: 'kilometers', steps: 64 });
                } catch { return; }
                if (circleSrcId && map.getSource(circleSrcId)) {
                    map.getSource(circleSrcId).setData(circlePoly);
                } else {
                    circleSrcId = this._nextId('sketch-circle');
                    map.addSource(circleSrcId, { type: 'geojson', data: circlePoly });
                    const fillId = circleSrcId + '-fill';
                    map.addLayer({ id: fillId, type: 'fill', source: circleSrcId, paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.12 } });
                    const lineId = circleSrcId + '-line';
                    map.addLayer({ id: lineId, type: 'line', source: circleSrcId, paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [6, 4] } });
                    circleLayerIds = [fillId, lineId];
                }
            };

            const finish = (c, radiusM) => {
                if (radiusM < 1) {
                    if (typeof onRadiusTooSmall === 'function') onRadiusTooSmall();
                    cleanup();
                    resolve(null);
                    return;
                }
                let geom;
                try {
                    geom = turfLib.circle([c.lng, c.lat], radiusM / 1000, { units: 'kilometers', steps: 64 }).geometry;
                } catch {
                    try {
                        geom = turfLib.buffer(turfLib.point([c.lng, c.lat]), radiusM / 1000, { units: 'kilometers', steps: 64 }).geometry;
                    } catch {
                        cleanup();
                        resolve(null);
                        return;
                    }
                }
                cleanup();
                resolve({ type: geom.type, coordinates: geom.coordinates });
            };

            const onClick = (e) => {
                markMapInteractionHandled(e);
                if (!centerLngLat) {
                    centerLngLat = e.lngLat;
                    const ht = banner?.querySelector?.('.interaction-text');
                    if (ht) ht.textContent = 'Move the cursor, then click to set radius.';
                } else {
                    const from = turfLib.point([centerLngLat.lng, centerLngLat.lat]);
                    const to = turfLib.point([e.lngLat.lng, e.lngLat.lat]);
                    const radiusM = turfLib.distance(from, to, { units: 'meters' });
                    finish(centerLngLat, radiusM);
                }
            };

            const onMouseMove = (e) => {
                if (!centerLngLat) return;
                const from = turfLib.point([centerLngLat.lng, centerLngLat.lat]);
                const to = turfLib.point([e.lngLat.lng, e.lngLat.lat]);
                const radiusM = turfLib.distance(from, to, { units: 'meters' });
                updateCirclePreview(radiusM);
            };

            const onKeyDown = (e) => { if (e.key === 'Escape') { cleanup(); resolve(null); } };

            const cleanup = () => {
                map.off('click', onClick);
                map.off('mousemove', onMouseMove);
                document.removeEventListener('keydown', onKeyDown);
                for (const lid of circleLayerIds) { if (map.getLayer(lid)) map.removeLayer(lid); }
                if (circleSrcId && map.getSource(circleSrcId)) map.removeSource(circleSrcId);
                circleLayerIds = []; circleSrcId = null;
                canvas.style.cursor = '';
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            map.on('click', onClick);
            map.on('mousemove', onMouseMove);
            document.addEventListener('keydown', onKeyDown);
        });
    }

    _updateRectGeoJSON(sourceId, start, end) {
        const w = Math.min(start.lng, end.lng), s = Math.min(start.lat, end.lat);
        const e = Math.max(start.lng, end.lng), n = Math.max(start.lat, end.lat);
        const src = this.map.getSource(sourceId);
        if (src) {
            src.setData({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
            });
        }
    }

    // ============================
    // Import Fence
    // ============================

    startImportFenceDraw() {
        this.clearImportFence();
        const isMobile = window.innerWidth < 768 || 'ontouchstart' in window;

        return new Promise((resolve) => {
            this._cancelInteraction();
            const canvas = this.map.getCanvas();
            canvas.style.cursor = 'crosshair';

            const banner = this._showInteractionBanner(
                isMobile ? 'Tap and drag to draw your import fence.' : 'Click and drag to draw your import fence. Only features inside will be imported.',
                () => { cleanup(); resolve(null); }
            );

            let startLngLat = null;
            const fenceId = 'import-fence';

            if (!this.map.getSource(fenceId)) {
                this.map.addSource(fenceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            if (!this.map.getLayer(fenceId + '-fill')) {
                this.map.addLayer({ id: fenceId + '-fill', type: 'fill', source: fenceId, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } });
            }
            if (!this.map.getLayer(fenceId + '-line')) {
                this.map.addLayer({ id: fenceId + '-line', type: 'line', source: fenceId, paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [10, 6] } });
            }

            const onMouseDown = (e) => {
                markMapInteractionHandled(e);
                startLngLat = e.lngLat;
                this.map.dragPan.disable();
            };
            const onMouseMove = (e) => { if (startLngLat) this._updateRectGeoJSON(fenceId, startLngLat, e.lngLat); };
            const onMouseUp = (e) => {
                if (!startLngLat) return;
                markMapInteractionHandled(e);
                const start = startLngLat;
                startLngLat = null;
                this.map.dragPan.enable();
                const bbox = this._finalizeDragBboxLngLat(start, e.lngLat);
                if (!bbox) {
                    cleanup(true);
                    resolve(null);
                    return;
                }
                const [west, south, east, north] = bbox;
                this._importFence = { west, south, east, north };
                cleanup(false);
                resolve([west, south, east, north]);
            };

            const container = this.map.getContainer();
            const onTouchStart = (e) => {
                if (e.touches.length !== 1) return;
                e.preventDefault();
                startLngLat = this._touchClientToLngLat(e.touches[0].clientX, e.touches[0].clientY);
                this.map.dragPan.disable();
            };
            const onTouchMove = (e) => {
                if (!startLngLat || e.touches.length !== 1) return;
                e.preventDefault();
                this._updateRectGeoJSON(fenceId, startLngLat, this._touchClientToLngLat(e.touches[0].clientX, e.touches[0].clientY));
            };
            const onTouchEnd = (e) => {
                if (!startLngLat) return;
                e.preventDefault();
                const ll = this._touchClientToLngLat(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
                const start = startLngLat;
                startLngLat = null;
                this.map.dragPan.enable();
                const bbox = this._finalizeDragBboxLngLat(start, ll);
                if (!bbox) {
                    cleanup(true);
                    resolve(null);
                    return;
                }
                const [west, south, east, north] = bbox;
                this._importFence = { west, south, east, north };
                cleanup(false);
                resolve([west, south, east, north]);
            };
            const onKeyDown = (e) => {
                if (e.key === 'Escape') { this.map.dragPan.enable(); cleanup(); resolve(null); }
            };

            const cleanup = (removeFence = true) => {
                canvas.style.cursor = '';
                this.map.off('mousedown', onMouseDown);
                this.map.off('mousemove', onMouseMove);
                this.map.off('mouseup', onMouseUp);
                container.removeEventListener('touchstart', onTouchStart);
                container.removeEventListener('touchmove', onTouchMove);
                container.removeEventListener('touchend', onTouchEnd);
                document.removeEventListener('keydown', onKeyDown);
                if (removeFence) {
                    if (this.map.getLayer(fenceId + '-fill')) this.map.removeLayer(fenceId + '-fill');
                    if (this.map.getLayer(fenceId + '-line')) this.map.removeLayer(fenceId + '-line');
                    if (this.map.getSource(fenceId)) this.map.removeSource(fenceId);
                }
                if (banner) banner.remove();
                this._interactionCleanup = null;
            };

            this._interactionCleanup = cleanup;
            this.map.on('mousedown', onMouseDown);
            this.map.on('mousemove', onMouseMove);
            this.map.on('mouseup', onMouseUp);
            container.addEventListener('touchstart', onTouchStart, { passive: false });
            container.addEventListener('touchmove', onTouchMove, { passive: false });
            container.addEventListener('touchend', onTouchEnd, { passive: false });
            document.addEventListener('keydown', onKeyDown);
        });
    }

    /**
     * Apply import fence from bbox without interactive draw (dual-screen sync).
     * @param {[number, number, number, number]} bbox [west, south, east, north]
     */
    setImportFenceFromBbox(bbox) {
        if (!this.map || !bbox || bbox.length < 4) return;
        const [west, south, east, north] = bbox;
        this._importFence = { west, south, east, north };
        const fenceId = 'import-fence';
        const sw = { lng: west, lat: south };
        const ne = { lng: east, lat: north };
        if (!this.map.getSource(fenceId)) {
            this.map.addSource(fenceId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        }
        if (!this.map.getLayer(fenceId + '-fill')) {
            this.map.addLayer({ id: fenceId + '-fill', type: 'fill', source: fenceId, paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.08 } });
        }
        if (!this.map.getLayer(fenceId + '-line')) {
            this.map.addLayer({ id: fenceId + '-line', type: 'line', source: fenceId, paint: { 'line-color': '#f59e0b', 'line-width': 2.5, 'line-dasharray': [10, 6] } });
        }
        this._updateRectGeoJSON(fenceId, sw, ne);
    }

    clearImportFence() {
        this._importFence = null;
        const fenceId = 'import-fence';
        if (this.map?.getLayer(fenceId + '-fill')) this.map.removeLayer(fenceId + '-fill');
        if (this.map?.getLayer(fenceId + '-line')) this.map.removeLayer(fenceId + '-line');
        if (this.map?.getSource(fenceId)) this.map.removeSource(fenceId);
        bus.emit('importFence:cleared');
    }

    getImportFenceBbox() {
        if (!this._importFence) return null;
        const b = this._importFence;
        return [b.west, b.south, b.east, b.north];
    }

    getImportFenceEsriEnvelope() {
        if (!this._importFence) return null;
        const b = this._importFence;
        return { xmin: b.west, ymin: b.south, xmax: b.east, ymax: b.north, spatialReference: { wkid: 4326 } };
    }

    get hasImportFence() { return !!this._importFence; }

    showTempFeature(geojson, duration = 10000) {
        const srcId = this._nextId('temp');
        this.map.addSource(srcId, { type: 'geojson', data: geojson });
        const layerIds = [];

        const fillId = srcId + '-fill';
        this.map.addLayer({ id: fillId, type: 'fill', source: srcId, filter: _geomTypesFilter(['Polygon', 'MultiPolygon']), paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.25 } });
        layerIds.push(fillId);

        const outlineId = srcId + '-outline';
        this.map.addLayer({ id: outlineId, type: 'line', source: srcId, filter: _geomTypesFilter(['Polygon', 'MultiPolygon']), paint: { 'line-color': '#d4a24e', 'line-width': 3 } });
        layerIds.push(outlineId);

        const lineId = srcId + '-line';
        this.map.addLayer({ id: lineId, type: 'line', source: srcId, filter: _geomTypesFilter(['LineString', 'MultiLineString']), paint: { 'line-color': '#d4a24e', 'line-width': 3 } });
        layerIds.push(lineId);

        const circleId = srcId + '-circle';
        this.map.addLayer({ id: circleId, type: 'circle', source: srcId, filter: _geomTypesFilter(['Point', 'MultiPoint']), paint: { 'circle-radius': 8, 'circle-color': '#d4a24e', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
        layerIds.push(circleId);

        const entry = { srcId, layerIds };
        this._tempLayers.push(entry);

        if (duration > 0) setTimeout(() => this._removeTempFeature(entry), duration);
        return entry;
    }

    removeTempFeature(entry) {
        if (entry) this._removeTempFeature(entry);
    }

    clearTempFeatures() {
        const entries = [...this._tempLayers];
        for (const entry of entries) {
            this._removeTempFeature(entry);
        }
    }

    /**
     * Wireless site planning preview: coverage rasters, pattern outline, blue square clients, red poles.
     * _preview: draw_client | covered | uncovered | draw_pole | pole | unused_pole | pattern_outline | antenna_indicator | assignment.
     */
    showWirelessPlanningPreview(geojson, options = 0) {
        let duration = 0;
        let coverageRasters = [];
        if (typeof options === 'number') {
            duration = options;
        } else {
            duration = options.duration ?? 0;
            coverageRasters = options.coverageRasters ?? [];
        }

        const srcId = this._nextId('temp');
        this.map.addSource(srcId, { type: 'geojson', data: geojson });
        const layerIds = [];
        const extraSourceIds = [];

        const rasterInstall = this._addCoverageRasterLayers(coverageRasters, srcId);
        layerIds.push(...rasterInstall.layerIds);
        extraSourceIds.push(...rasterInstall.extraSourceIds);

        const patternOutlineId = srcId + '-pattern-outline';
        this.map.addLayer({
            id: patternOutlineId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'pattern_outline']
            ],
            paint: { 'line-color': '#dc2626', 'line-width': 2.5, 'line-opacity': 0.95 }
        });
        layerIds.push(patternOutlineId);

        const patternOutlineLegacyId = srcId + '-pattern-outline-poly';
        this.map.addLayer({
            id: patternOutlineLegacyId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Polygon', 'MultiPolygon']),
                ['==', ['get', '_preview'], 'pattern_outline']
            ],
            paint: { 'line-color': '#dc2626', 'line-width': 2.5, 'line-opacity': 0.95 }
        });
        layerIds.push(patternOutlineLegacyId);

        const antennaIndicatorFillId = srcId + '-antenna-indicator-fill';
        this.map.addLayer({
            id: antennaIndicatorFillId,
            type: 'fill',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Polygon', 'MultiPolygon']),
                ['==', ['get', '_preview'], 'antenna_indicator']
            ],
            paint: {
                'fill-color': ['coalesce', ['get', 'fill'], '#e879f9'],
                'fill-opacity': ['coalesce', ['to-number', ['get', 'fill-opacity']], 0.4]
            }
        });
        layerIds.push(antennaIndicatorFillId);

        const antennaIndicatorOutlineId = srcId + '-antenna-indicator-outline';
        this.map.addLayer({
            id: antennaIndicatorOutlineId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Polygon', 'MultiPolygon']),
                ['==', ['get', '_preview'], 'antenna_indicator']
            ],
            paint: {
                'line-color': ['coalesce', ['get', 'stroke'], '#c026d3'],
                'line-width': ['coalesce', ['to-number', ['get', 'stroke-width']], 2],
                'line-opacity': ['coalesce', ['to-number', ['get', 'stroke-opacity']], 0.9]
            }
        });
        layerIds.push(antennaIndicatorOutlineId);

        const assignmentLineId = srcId + '-assignment-line';
        this.map.addLayer({
            id: assignmentLineId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'assignment']
            ],
            paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-dasharray': [2, 2] }
        });
        layerIds.push(assignmentLineId);

        const clientSquareId = srcId + '-client-square';
        const clientIcon = this._ensureSymbolImage('square', '#ffffff', '#2563eb', 8, 1);
        this.map.addLayer({
            id: clientSquareId,
            type: 'symbol',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Point', 'MultiPoint']),
                ['in', ['get', '_preview'], ['literal', ['draw_client', 'covered', 'uncovered']]]
            ],
            layout: {
                'icon-image': clientIcon,
                'icon-size': 1,
                'icon-allow-overlap': true,
                'icon-anchor': 'center'
            }
        });
        layerIds.push(clientSquareId);

        const poleCircleId = srcId + '-pole-circle';
        this.map.addLayer({
            id: poleCircleId,
            type: 'circle',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Point', 'MultiPoint']),
                ['in', ['get', '_preview'], ['literal', ['draw_pole', 'pole', 'unused_pole']]]
            ],
            paint: {
                'circle-radius': [
                    'match', ['get', '_preview'],
                    'unused_pole', 7,
                    9
                ],
                'circle-color': [
                    'match', ['get', '_preview'],
                    'unused_pole', '#fca5a5',
                    '#ef4444'
                ],
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        layerIds.push(poleCircleId);

        const entry = { srcId, layerIds, extraSourceIds };
        this._tempLayers.push(entry);

        if (duration > 0) setTimeout(() => this._removeTempFeature(entry), duration);
        return entry;
    }

    showRouteMilepostPreview(geojson, duration = 0) {
        const srcId = this._nextId('temp');
        this.map.addSource(srcId, { type: 'geojson', data: geojson });
        const layerIds = [];

        const routeLineId = srcId + '-route-line';
        this.map.addLayer({
            id: routeLineId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['in', ['get', '_preview'], ['literal', ['route', 'centerline_segment']]]
            ],
            paint: { 'line-color': '#ff0000', 'line-width': 4 }
        });
        layerIds.push(routeLineId);

        const mpCircleId = srcId + '-mp-circle';
        this.map.addLayer({
            id: mpCircleId,
            type: 'circle',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Point', 'MultiPoint']),
                ['in', ['get', '_preview'], ['literal', ['start_mp', 'end_mp']]]
            ],
            paint: {
                'circle-radius': 10,
                'circle-color': '#00ff00',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        layerIds.push(mpCircleId);

        const entry = { srcId, layerIds };
        this._tempLayers.push(entry);

        if (duration > 0) setTimeout(() => this._removeTempFeature(entry), duration);
        return entry;
    }

    /**
     * Project stationing widget preview: route, clip, centerline, ticks, labels.
     * _preview: route | centerline_segment | trimmed_centerline | project_centerline |
     *   station_tick | station_label | begin_end_marker | start_mp | end_mp | milepost_tenth
     */
    showProjectStationingPreview(geojson, duration = 0) {
        const srcId = this._nextId('temp');
        this.map.addSource(srcId, { type: 'geojson', data: geojson });
        const layerIds = [];

        const routeLineId = srcId + '-route-line';
        this.map.addLayer({
            id: routeLineId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'route']
            ],
            paint: { 'line-color': '#cc4444', 'line-width': 3, 'line-opacity': 0.5 }
        });
        layerIds.push(routeLineId);

        const mpClipId = srcId + '-mp-clip';
        this.map.addLayer({
            id: mpClipId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'centerline_segment']
            ],
            paint: { 'line-color': '#888888', 'line-width': 3, 'line-dasharray': [2, 2] }
        });
        layerIds.push(mpClipId);

        const trimmedId = srcId + '-trimmed';
        this.map.addLayer({
            id: trimmedId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'trimmed_centerline']
            ],
            paint: { 'line-color': '#00cc66', 'line-width': 5 }
        });
        layerIds.push(trimmedId);

        const projectCenterlineId = srcId + '-project-centerline';
        this.map.addLayer({
            id: projectCenterlineId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'project_centerline']
            ],
            paint: { 'line-color': '#111111', 'line-width': 5, 'line-opacity': 1 }
        });
        layerIds.push(projectCenterlineId);

        const stationTickId = srcId + '-station-tick';
        this.map.addLayer({
            id: stationTickId,
            type: 'line',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['LineString', 'MultiLineString']),
                ['==', ['get', '_preview'], 'station_tick']
            ],
            paint: { 'line-color': '#111111', 'line-width': 2, 'line-opacity': 1 }
        });
        layerIds.push(stationTickId);

        const stationLabelSpec = buildMapLabelLayerSpec(srcId + '-station-labels', srcId, {
            field: 'station_label',
            minZoom: 0,
            size: 11
        });
        if (stationLabelSpec) {
            stationLabelSpec.id = srcId + '-station-label-text';
            stationLabelSpec.filter = ['==', ['get', '_preview'], 'station_label'];
            this.map.addLayer(stationLabelSpec);
            layerIds.push(stationLabelSpec.id);
        }

        const beginEndId = srcId + '-begin-end';
        this.map.addLayer({
            id: beginEndId,
            type: 'circle',
            source: srcId,
            filter: ['==', ['get', '_preview'], 'begin_end_marker'],
            paint: {
                'circle-radius': 7,
                'circle-color': '#00cc66',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        layerIds.push(beginEndId);

        const beginEndLabelSpec = buildMapLabelLayerSpec(srcId + '-begin-end-labels', srcId, {
            field: 'name',
            minZoom: 0,
            size: 12
        });
        if (beginEndLabelSpec) {
            beginEndLabelSpec.id = srcId + '-begin-end-text';
            beginEndLabelSpec.filter = ['==', ['get', '_preview'], 'begin_end_marker'];
            this.map.addLayer(beginEndLabelSpec);
            layerIds.push(beginEndLabelSpec.id);
        }

        const milepostId = srcId + '-milepost';
        this.map.addLayer({
            id: milepostId,
            type: 'circle',
            source: srcId,
            filter: ['==', ['get', '_preview'], 'milepost'],
            paint: {
                'circle-radius': 3,
                'circle-color': '#00ff66',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 1
            }
        });
        layerIds.push(milepostId);

        const clipAreaId = srcId + '-clip-area';
        this.map.addLayer({
            id: clipAreaId,
            type: 'fill',
            source: srcId,
            filter: ['==', ['get', '_preview'], 'clip_area'],
            paint: { 'fill-color': '#d4a24e', 'fill-opacity': 0.15 }
        });
        layerIds.push(clipAreaId);

        const clipAreaLineId = srcId + '-clip-area-line';
        this.map.addLayer({
            id: clipAreaLineId,
            type: 'line',
            source: srcId,
            filter: ['==', ['get', '_preview'], 'clip_area'],
            paint: { 'line-color': '#d4a24e', 'line-width': 2, 'line-dasharray': [4, 3] }
        });
        layerIds.push(clipAreaLineId);

        const mpCircleId = srcId + '-mp-circle';
        this.map.addLayer({
            id: mpCircleId,
            type: 'circle',
            source: srcId,
            filter: ['all',
                _geomTypesFilter(['Point', 'MultiPoint']),
                ['in', ['get', '_preview'], ['literal', ['start_mp', 'end_mp']]]
            ],
            paint: {
                'circle-radius': 10,
                'circle-color': '#00ff00',
                'circle-stroke-color': '#ffffff',
                'circle-stroke-width': 2
            }
        });
        layerIds.push(mpCircleId);

        const entry = { srcId, layerIds };
        this._tempLayers.push(entry);

        if (duration > 0) setTimeout(() => this._removeTempFeature(entry), duration);
        return entry;
    }

    _removeTempFeature(entry) {
        for (const lid of entry.layerIds) { if (this.map?.getLayer(lid)) this.map.removeLayer(lid); }
        if (this.map?.getSource(entry.srcId)) this.map.removeSource(entry.srcId);
        for (const sid of entry.extraSourceIds || []) {
            if (this.map?.getSource(sid)) this.map.removeSource(sid);
        }
        this._tempLayers = this._tempLayers.filter(e => e !== entry);
    }

    _cancelInteraction() {
        if (this._interactionCleanup) { this._interactionCleanup(); this._interactionCleanup = null; }
    }

    /** Cancel active map picks, drag-rectangles, or sketches (draw toolbar + widgets). */
    cancelInteraction() {
        this._cancelInteraction();
    }

    _showInteractionBanner(text, onCancel) {
        const banner = document.createElement('div');
        banner.className = 'map-interaction-banner';
        banner.innerHTML = `
            <span class="interaction-text">${text}</span>
            <button class="interaction-cancel">✕ Cancel</button>
            <span style="font-size:11px;opacity:0.6;margin-left:8px;">(Esc to cancel)</span>
        `;
        banner.querySelector('.interaction-cancel').onclick = onCancel;
        this.map.getContainer().appendChild(banner);
        return banner;
    }

    showInteractionBanner(text, onCancel) {
        return this._showInteractionBanner(text, onCancel);
    }

    // ==========================================
    // Feature Selection System
    // ==========================================

    static get SELECTION_STYLE() {
        return { color: '#00e5ff', weight: 3, opacity: 1, fillColor: '#00e5ff', fillOpacity: 0.35 };
    }
    static get SELECTION_POINT_STYLE() {
        return { radius: 8, fillColor: '#00e5ff', color: '#ffffff', weight: 3, fillOpacity: 1 };
    }

    setActiveLayerId(layerId) {
        this._activeLayerId = layerId ?? null;
    }

    blockSelection() {
        this._selectionBlocked++;
    }

    unblockSelection() {
        this._selectionBlocked = Math.max(0, this._selectionBlocked - 1);
    }

    _canSelect() {
        return this._selectionBlocked === 0 && !this._interactionCleanup;
    }

    _isActiveLayer(layerId) {
        return !this._activeLayerId || layerId === this._activeLayerId;
    }

    /** @deprecated Always-on selection; kept for widget compat */
    enterSelectionMode() {
        this.unblockSelection();
        bus.emit('selection:modeChanged', true);
    }

    /** @deprecated No-op; selection is always available when map is idle */
    exitSelectionMode() {
        bus.emit('selection:modeChanged', false);
    }

    isSelectionMode() { return this._canSelect(); }

    _syncSelectionContext(layerId, featureIndex, { toggle = false } = {}) {
        if (!this._canSelect()) return;
        const previousId = getActiveLayer()?.id;
        if (layerId !== previousId) {
            if (previousId) this.clearSelection(previousId);
            setActiveLayer(layerId);
        }
        this._handleSelectionClick(layerId, featureIndex, toggle);
    }

    _syncPopupHitSelection() {
        const hit = this._getActivePopupHit();
        if (!hit) return;
        this._syncSelectionContext(hit.layerId, hit.featureIndex, { toggle: false });
    }

    _handleSelectionClick(layerId, featureIndex, toggleKey) {
        if (!this._isActiveLayer(layerId)) return;
        if (!this._selections.has(layerId)) this._selections.set(layerId, new Set());
        const sel = this._selections.get(layerId);

        if (toggleKey) {
            sel.has(featureIndex) ? sel.delete(featureIndex) : sel.add(featureIndex);
        } else {
            this._selections.set(layerId, new Set([featureIndex]));
        }

        this._renderSelectionHighlights(layerId);
        bus.emit('selection:changed', { layerId, count: this.getSelectionCount(layerId), totalCount: this.getTotalSelectionCount() });
    }

    _setupRectangleSelect() {
        let startLngLat = null;
        let dragging = false;
        const rectId = 'selection-rect';
        const container = this.map.getContainer();

        if (!this.map.getSource(rectId)) {
            this.map.addSource(rectId, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            this.map.addLayer({ id: rectId + '-fill', type: 'fill', source: rectId, paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.1 } });
            this.map.addLayer({ id: rectId + '-line', type: 'line', source: rectId, paint: { 'line-color': '#00e5ff', 'line-width': 2, 'line-dasharray': [6, 4] } });
        }

        const clearRectPreview = () => {
            this.map.getSource(rectId)?.setData({ type: 'FeatureCollection', features: [] });
        };

        const finishBox = (start, end, shiftKey) => {
            const w = Math.min(start.lng, end.lng);
            const s = Math.min(start.lat, end.lat);
            const east = Math.max(start.lng, end.lng);
            const n = Math.max(start.lat, end.lat);
            if (!bboxDiagonalMeetsMinDragPx(w, s, east, n, (ll) => this.map.project(ll))) {
                clearRectPreview();
                return;
            }
            this._selectFeaturesInBounds([w, s, east, n], shiftKey);
            setTimeout(clearRectPreview, 400);
        };

        const onMouseDown = (e) => {
            if (!this._canSelect() || !this._activeLayerId) return;
            if (!shouldStartBoxSelectDrag(e.originalEvent)) return;
            if (this._queryFeaturesAtPoint(e.point).length > 0) return;
            startLngLat = e.lngLat;
            dragging = true;
            this.map.dragPan.disable();
        };
        const onMouseMove = (e) => {
            if (!dragging || !startLngLat) return;
            this._updateRectGeoJSON(rectId, startLngLat, e.lngLat);
        };
        const onMouseUp = (e) => {
            if (!dragging || !startLngLat) return;
            this.map.dragPan.enable();
            dragging = false;
            const start = startLngLat;
            startLngLat = null;
            finishBox(start, e.lngLat, e.originalEvent?.shiftKey);
        };

        const onTouchStart = (e) => {
            if (!this._canSelect() || !this._activeLayerId || e.touches.length !== 1) return;
            if (!shouldStartBoxSelectDrag(e)) return;
            const point = this._touchClientToPoint(e.touches[0].clientX, e.touches[0].clientY);
            if (this._queryFeaturesAtPoint(point).length > 0) return;
            e.preventDefault();
            startLngLat = this._touchClientToLngLat(e.touches[0].clientX, e.touches[0].clientY);
            dragging = true;
            this.map.dragPan.disable();
        };
        const onTouchMove = (e) => {
            if (!dragging || !startLngLat || e.touches.length !== 1) return;
            e.preventDefault();
            const ll = this._touchClientToLngLat(e.touches[0].clientX, e.touches[0].clientY);
            this._updateRectGeoJSON(rectId, startLngLat, ll);
        };
        const onTouchEnd = (e) => {
            if (!dragging || !startLngLat) return;
            e.preventDefault();
            const ll = this._touchClientToLngLat(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            const start = startLngLat;
            startLngLat = null;
            dragging = false;
            this.map.dragPan.enable();
            finishBox(start, ll, false);
        };

        this.map.on('mousedown', onMouseDown);
        this.map.on('mousemove', onMouseMove);
        this.map.on('mouseup', onMouseUp);
        container.addEventListener('touchstart', onTouchStart, { passive: false });
        container.addEventListener('touchmove', onTouchMove, { passive: false });
        container.addEventListener('touchend', onTouchEnd, { passive: false });

        return () => {
            this.map.off('mousedown', onMouseDown);
            this.map.off('mousemove', onMouseMove);
            this.map.off('mouseup', onMouseUp);
            container.removeEventListener('touchstart', onTouchStart);
            container.removeEventListener('touchmove', onTouchMove);
            container.removeEventListener('touchend', onTouchEnd);
            if (this.map.getLayer(rectId + '-fill')) this.map.removeLayer(rectId + '-fill');
            if (this.map.getLayer(rectId + '-line')) this.map.removeLayer(rectId + '-line');
            if (this.map.getSource(rectId)) this.map.removeSource(rectId);
            this.map.dragPan.enable();
        };
    }

    _touchClientToPoint(clientX, clientY) {
        const rect = this.map.getContainer().getBoundingClientRect();
        return { x: clientX - rect.left, y: clientY - rect.top };
    }

    _selectFeaturesInBounds(bbox, addToExisting) {
        const layerId = this._activeLayerId;
        if (!layerId) return;
        const info = this.dataLayers.get(layerId);
        if (!info) return;

        const firstLayer = info.layerIds[0];
        if (firstLayer && this.map.getLayoutProperty(firstLayer, 'visibility') === 'none') return;

        if (!addToExisting) {
            this._selections.set(layerId, new Set());
        } else if (!this._selections.has(layerId)) {
            this._selections.set(layerId, new Set());
        }
        const sel = this._selections.get(layerId);

        const [west, south, east, north] = bbox;
        const bboxPoly = turf.bboxPolygon([west, south, east, north]);

        for (const f of info.geojson.features) {
            if (!f.geometry) continue;
            const idx = f.properties?._featureIndex;
            if (idx === undefined) continue;
            try {
                if (turf.booleanIntersects(f, bboxPoly)) sel.add(idx);
            } catch {
                try {
                    const c = turf.centroid(f);
                    if (turf.booleanPointInPolygon(c, bboxPoly)) sel.add(idx);
                } catch { /* skip */ }
            }
        }
        this._renderSelectionHighlights(layerId);

        const count = sel.size;
        bus.emit('selection:changed', { layerId, count, totalCount: count });
        if (count > 0) logger.debug('Map', `Box selected ${count} feature(s) on ${layerId}`);
    }

    _renderSelectionHighlights(layerId) {
        if (!this.map) return;
        const selSrcId = `selection-${layerId}`;
        for (const lid of [`${selSrcId}-fill`, `${selSrcId}-outline`, `${selSrcId}-line`, `${selSrcId}-circle`]) {
            if (this.map.getLayer(lid)) this.map.removeLayer(lid);
        }
        if (this.map.getSource(selSrcId)) this.map.removeSource(selSrcId);

        const sel = this._selections.get(layerId);
        if (!sel || sel.size === 0) return;
        const info = this.dataLayers.get(layerId);
        if (!info) return;

        const selectedFeatures = info.geojson.features.filter(f => sel.has(f.properties?._featureIndex));
        if (selectedFeatures.length === 0) return;

        this.map.addSource(selSrcId, { type: 'geojson', data: { type: 'FeatureCollection', features: selectedFeatures } });
        this.map.addLayer({ id: `${selSrcId}-fill`, type: 'fill', source: selSrcId, filter: _geomTypesFilter(['Polygon', 'MultiPolygon']), paint: { 'fill-color': '#00e5ff', 'fill-opacity': 0.35 } });
        this.map.addLayer({ id: `${selSrcId}-outline`, type: 'line', source: selSrcId, filter: _geomTypesFilter(['Polygon', 'MultiPolygon']), paint: { 'line-color': '#00e5ff', 'line-width': 3 } });
        this.map.addLayer({ id: `${selSrcId}-line`, type: 'line', source: selSrcId, filter: _geomTypesFilter(['LineString', 'MultiLineString']), paint: { 'line-color': '#00e5ff', 'line-width': 3 } });
        this.map.addLayer({ id: `${selSrcId}-circle`, type: 'circle', source: selSrcId, filter: _geomTypesFilter(['Point', 'MultiPoint']), paint: { 'circle-radius': 8, 'circle-color': '#00e5ff', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3, 'circle-opacity': 1 } });
    }

    getSelectedIndices(layerId) { return this._selections.get(layerId) ? [...this._selections.get(layerId)] : []; }
    getSelectedFeatures(layerId, geojson) {
        const indices = this.getSelectedIndices(layerId);
        if (indices.length === 0) return null;
        return {
            type: 'FeatureCollection',
            features: geojson.features.filter((f) => indices.includes(f.properties?._featureIndex))
        };
    }
    getSelectionCount(layerId) { return this._selections.get(layerId)?.size || 0; }
    getTotalSelectionCount() { let t = 0; for (const s of this._selections.values()) t += s.size; return t; }

    clearSelection(layerId = null) {
        if (layerId) {
            this._selections.delete(layerId);
            const selSrcId = `selection-${layerId}`;
            for (const l of [`${selSrcId}-fill`, `${selSrcId}-outline`, `${selSrcId}-line`, `${selSrcId}-circle`]) { if (this.map?.getLayer(l)) this.map.removeLayer(l); }
            if (this.map?.getSource(selSrcId)) this.map.removeSource(selSrcId);
        } else {
            for (const lid of this._selections.keys()) {
                const ss = `selection-${lid}`;
                for (const l of [`${ss}-fill`, `${ss}-outline`, `${ss}-line`, `${ss}-circle`]) { if (this.map?.getLayer(l)) this.map.removeLayer(l); }
                if (this.map?.getSource(ss)) this.map.removeSource(ss);
            }
            this._selections.clear();
        }
        bus.emit('selection:changed', { layerId, totalCount: this.getTotalSelectionCount() });
    }

    selectFeatures(layerId, indices) {
        this._selections.set(layerId, new Set(indices));
        this._renderSelectionHighlights(layerId);
        bus.emit('selection:changed', { layerId, count: indices.length, totalCount: this.getTotalSelectionCount() });
    }
    selectAll(layerId, geojson) { this.selectFeatures(layerId, geojson.features.map((_, i) => i)); }
    invertSelection(layerId, geojson) {
        const current = this._selections.get(layerId) || new Set();
        this.selectFeatures(layerId, geojson.features.map((_, i) => i).filter(i => !current.has(i)));
    }

    // ============================
    // Query result overlay (temporary multi-feature highlight)
    // ============================

    _stopQueryResultPulse() {
        if (this._queryPulseCancel) {
            this._queryPulseCancel();
            this._queryPulseCancel = null;
        }
    }

    showQueryResults(layerId, indices = []) {
        if (!this.map) return;
        this._stopQueryResultPulse();
        const features = buildQueryResultFeatures(this.dataLayers, layerId, indices);
        renderQueryResultLayers(this.map, features);
        this._queryResultLayerId = layerId;
        this._queryResultIndices = [...indices];
    }

    clearQueryResults() {
        this._stopQueryResultPulse();
        if (this.map) removeQueryResultLayers(this.map);
        this._queryResultLayerId = null;
        this._queryResultIndices = null;
    }

    pulseQueryResults({ mode = 'pulse' } = {}) {
        if (!this.map) return;
        this._stopQueryResultPulse();
        this._queryPulseCancel = startQueryResultPulse(this.map, { mode });
    }

    fitToFeatureIndices(layerId, indices = [], options = {}) {
        if (!this.map || !indices.length) return;
        const zoomMode = options.mode ?? 'all';
        if (zoomMode === 'none') return;
        const features = resolveFeaturesForZoom(this.dataLayers, layerId, indices, zoomMode);
        if (!features?.length) return;
        fitMapToFeatures(this.map, features, {
            padding: options.padding ?? 48,
            maxZoom: options.maxZoom ?? 16
        });
    }

    // ============================
    // Coordinate Search Control
    // ============================
    _initCoordSearch() {
        this._searchMarker = null;
        this._searchLatLng = null;

        const container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group coord-search-control';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Search Coordinates';
        btn.className = 'coord-search-toggle';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

        const panel = document.createElement('div');
        panel.className = 'coord-search-panel';
        panel.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'text'; input.className = 'coord-search-input';
        input.placeholder = 'Enter coordinates…'; input.autocomplete = 'off';

        const goBtn = document.createElement('button');
        goBtn.className = 'coord-search-go'; goBtn.innerHTML = '→'; goBtn.title = 'Search';

        const clearBtn = document.createElement('button');
        clearBtn.className = 'coord-search-clear'; clearBtn.innerHTML = '✕'; clearBtn.title = 'Clear & close'; clearBtn.style.display = 'none';

        panel.append(input, goBtn, clearBtn);
        container.append(btn, panel);

        container.addEventListener('click', (e) => e.stopPropagation());
        container.addEventListener('dblclick', (e) => e.stopPropagation());

        btn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            const open = panel.style.display !== 'none';
            panel.style.display = open ? 'none' : 'flex';
            if (!open) setTimeout(() => input.focus(), 50);
        };

        const doSearch = () => {
            const val = input.value.trim();
            if (!val) return;
            const result = this._parseCoordinates(val);
            if (result) {
                this._placeSearchMarker(result.lat, result.lng, val, result.format);
                clearBtn.style.display = ''; input.blur();
            } else {
                input.style.outline = '2px solid #e74c3c';
                setTimeout(() => input.style.outline = '', 1200);
            }
        };

        goBtn.onclick = doSearch;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') doSearch();
            if (e.key === 'Escape') panel.style.display = 'none';
        };
        clearBtn.onclick = () => {
            this._clearSearchMarker();
            input.value = ''; clearBtn.style.display = 'none'; panel.style.display = 'none';
        };

        const ctrl = { onAdd: () => container, onRemove: () => container.remove() };
        this.map.addControl(ctrl, 'top-left');
    }

    _parseCoordinates(input) {
        const s = input.trim();
        const ddMatch = s.match(/^([+-]?\d+\.?\d*)[,\s]+([+-]?\d+\.?\d*)$/);
        if (ddMatch) {
            const a = parseFloat(ddMatch[1]), b = parseFloat(ddMatch[2]);
            if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b, format: 'DD' };
            if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return { lat: b, lng: a, format: 'DD' };
        }
        const dmsRegex = /(\d+)[°]\s*(\d+)[′']\s*(\d+\.?\d*)[″"]\s*([NSEW])/gi;
        const dmsMatches = [...s.matchAll(dmsRegex)];
        if (dmsMatches.length >= 2) {
            const parse = (m) => { let dd = parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600; if (m[4].toUpperCase() === 'S' || m[4].toUpperCase() === 'W') dd = -dd; return dd; };
            const v1 = parse(dmsMatches[0]), v2 = parse(dmsMatches[1]);
            const d1 = dmsMatches[0][4].toUpperCase();
            const lat = (d1 === 'N' || d1 === 'S') ? v1 : v2;
            const lng = (d1 === 'E' || d1 === 'W') ? v1 : v2;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'DMS' };
        }
        const dmsPlain = /(-?\d+)\s+(\d+)\s+(\d+\.?\d*)\s*([NSEW])[,\s]+(-?\d+)\s+(\d+)\s+(\d+\.?\d*)\s*([NSEW])/i;
        const dpMatch = s.match(dmsPlain);
        if (dpMatch) {
            let lat = parseInt(dpMatch[1]) + parseInt(dpMatch[2]) / 60 + parseFloat(dpMatch[3]) / 3600;
            if (dpMatch[4].toUpperCase() === 'S') lat = -lat;
            let lng = parseInt(dpMatch[5]) + parseInt(dpMatch[6]) / 60 + parseFloat(dpMatch[7]) / 3600;
            if (dpMatch[8].toUpperCase() === 'W') lng = -lng;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'DMS' };
        }
        const ddmRegex = /(\d+)[°]\s*(\d+\.?\d*)[′']\s*([NSEW])/gi;
        const ddmMatches = [...s.matchAll(ddmRegex)];
        if (ddmMatches.length >= 2) {
            const parse = (m) => { let dd = parseInt(m[1]) + parseFloat(m[2]) / 60; if (m[3].toUpperCase() === 'S' || m[3].toUpperCase() === 'W') dd = -dd; return dd; };
            const v1 = parse(ddmMatches[0]), v2 = parse(ddmMatches[1]);
            const d1 = ddmMatches[0][3].toUpperCase();
            const lat = (d1 === 'N' || d1 === 'S') ? v1 : v2;
            const lng = (d1 === 'E' || d1 === 'W') ? v1 : v2;
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'DDM' };
        }
        const gUrlMatch = s.match(/@([+-]?\d+\.?\d*),([+-]?\d+\.?\d*)/);
        if (gUrlMatch) {
            const lat = parseFloat(gUrlMatch[1]), lng = parseFloat(gUrlMatch[2]);
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng, format: 'URL' };
        }
        return null;
    }

    _placeSearchMarker(lat, lng, inputText, format) {
        this._clearSearchMarker();
        this._searchLatLng = { lat, lng, inputText, format };

        const el = document.createElement('div');
        el.className = 'coord-search-marker';
        el.innerHTML = `<svg viewBox="0 0 24 36" width="28" height="42"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="#e74c3c" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="11" r="4.5" fill="#fff"/></svg>`;

        this._searchMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(this.map);

        const popup = new maplibregl.Popup({ maxWidth: '280px' }).setHTML(this._buildSearchPopup(lat, lng, format));
        this._searchMarker.setPopup(popup);
        popup.addTo(this.map);
        const popupEl = popup.getElement?.();
        popupEl?.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-coord-search-action]');
            if (!actionButton) return;
            event.preventDefault();
            event.stopPropagation();
            const action = actionButton.dataset.coordSearchAction;
            if (action === 'add-new') bus.emit('coord-search:add-new');
            else if (action === 'add-existing') bus.emit('coord-search:add-existing');
            else if (action === 'clear') bus.emit('coord-search:clear');
        });
        this.map.flyTo({ center: [lng, lat], zoom: Math.max(this.map.getZoom(), 14) });
    }

    _buildSearchPopup(lat, lng, format) {
        return `
            <div class="coord-popup-content">
                <div style="font-weight:600;margin-bottom:4px;">📍 ${format} Coordinate</div>
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;font-family:monospace;">${lat.toFixed(6)}, ${lng.toFixed(6)}</div>
                <div style="display:flex;flex-direction:column;gap:4px;">
                    <button class="coord-popup-btn coord-add-new" data-coord-search-action="add-new">＋ Add as New Layer</button>
                    <button class="coord-popup-btn coord-add-existing" data-coord-search-action="add-existing">↳ Add to Existing Layer</button>
                    <button class="coord-popup-btn coord-dismiss" data-coord-search-action="clear">✕ Dismiss</button>
                </div>
            </div>`;
    }

    _clearSearchMarker() {
        if (this._searchMarker) { this._searchMarker.remove(); this._searchMarker = null; }
        this._searchLatLng = null;
    }

    getSearchLatLng() { return this._searchLatLng; }

    // ============================
    // Measure Tool
    // ============================
    _initMeasureTool() {
        this._measureActive = false;
        this._measurePoints = [];
        this._measureMarkers = [];
        this._measureUnit = 'feet';
        this._measureSourceId = '__measure-line';
        this._measureLayerId = '__measure-line-layer';
        this._measureNodeLayerId = '__measure-node-layer';
        this._measureLabelEl = null;

        const UNITS = [
            { key: 'feet', label: 'Feet', turfUnit: 'feet' },
            { key: 'miles', label: 'Miles', turfUnit: 'miles' },
            { key: 'meters', label: 'Meters', turfUnit: 'meters' },
            { key: 'kilometers', label: 'Kilometers', turfUnit: 'kilometers' }
        ];

        // Build control container
        const container = document.createElement('div');
        container.className = 'maplibregl-ctrl maplibregl-ctrl-group measure-control';

        // Toggle button
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Measure path distance — click the map to add vertices along a route (total length sum). Distinct from GIS Tools straight-line distance.';
        btn.className = 'measure-toggle';
        btn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="7" width="22" height="10" rx="2"/><line x1="5" y1="7" x2="5" y2="12"/><line x1="9" y1="7" x2="9" y2="14"/><line x1="13" y1="7" x2="13" y2="12"/><line x1="17" y1="7" x2="17" y2="14"/><line x1="21" y1="7" x2="21" y2="12"/></svg>`;

        // Panel (shows when active)
        const panel = document.createElement('div');
        panel.className = 'measure-panel';
        panel.style.display = 'none';

        // Unit selector
        const unitSel = document.createElement('select');
        unitSel.className = 'measure-unit-select';
        UNITS.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.key; opt.textContent = u.label;
            if (u.key === 'feet') opt.selected = true;
            unitSel.appendChild(opt);
        });

        // Distance readout
        const readout = document.createElement('div');
        readout.className = 'measure-readout';
        readout.textContent = '0.00 ft';

        // Clear button
        const clearBtn = document.createElement('button');
        clearBtn.className = 'measure-clear';
        clearBtn.innerHTML = '✕';
        clearBtn.title = 'Clear & close';

        panel.append(readout, unitSel, clearBtn);
        container.append(btn, panel);

        // Stop propagation so map clicks don't pass through
        panel.addEventListener('click', e => e.stopPropagation());
        panel.addEventListener('dblclick', e => e.stopPropagation());

        // Formatting helper
        const formatDist = (val, unit) => {
            const abbr = { feet: 'ft', miles: 'mi', meters: 'm', kilometers: 'km' };
            if (val >= 10) return `${Math.round(val).toLocaleString()} ${abbr[unit]}`;
            return `${val.toFixed(2)} ${abbr[unit]}`;
        };

        // Recalculate total distance
        const recalc = () => {
            if (typeof turf === 'undefined') {
                readout.textContent = '—';
                return;
            }
            if (this._measurePoints.length < 2) {
                readout.textContent = formatDist(0, this._measureUnit);
                return;
            }
            const line = turf.lineString(this._measurePoints);
            const turfUnit = UNITS.find(u => u.key === this._measureUnit)?.turfUnit || 'feet';
            const dist = turf.length(line, { units: turfUnit });
            readout.textContent = formatDist(dist, this._measureUnit);
        };

        // Update the map line source
        const updateLine = () => {
            if (typeof turf === 'undefined') return;
            const src = this.map.getSource(this._measureSourceId);
            if (!src) return;
            const geojson = {
                type: 'FeatureCollection',
                features: []
            };
            if (this._measurePoints.length >= 2) {
                geojson.features.push({
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: this._measurePoints }
                });
            }
            // Add point nodes
            this._measurePoints.forEach(coord => {
                geojson.features.push({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: coord }
                });
            });
            src.setData(geojson);
        };

        // Activate measure mode
        const activate = () => {
            this._measureActive = true;
            btn.classList.add('active');
            panel.style.display = 'flex';
            this.map.getCanvas().style.cursor = 'crosshair';

            // Add source + layers if not present
            if (!this.map.getSource(this._measureSourceId)) {
                this.map.addSource(this._measureSourceId, {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
                this.map.addLayer({
                    id: this._measureLayerId,
                    type: 'line',
                    source: this._measureSourceId,
                    filter: ['in', ['geometry-type'], ['literal', ['LineString']]],
                    paint: {
                        'line-color': '#ff6600',
                        'line-width': 2.5,
                        'line-dasharray': [3, 2]
                    }
                });
                this.map.addLayer({
                    id: this._measureNodeLayerId,
                    type: 'circle',
                    source: this._measureSourceId,
                    filter: ['in', ['geometry-type'], ['literal', ['Point']]],
                    paint: {
                        'circle-radius': 4.5,
                        'circle-color': '#ff6600',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#1c1c1e'
                    }
                });
            }
        };

        // Deactivate & clean up
        const deactivate = () => {
            this._measureActive = false;
            btn.classList.remove('active');
            panel.style.display = 'none';
            this.map.getCanvas().style.cursor = '';
            this._measurePoints = [];
            this._measureMarkers.forEach(m => m.remove());
            this._measureMarkers = [];
            if (this.map.getLayer(this._measureLayerId)) this.map.removeLayer(this._measureLayerId);
            if (this.map.getLayer(this._measureNodeLayerId)) this.map.removeLayer(this._measureNodeLayerId);
            if (this.map.getSource(this._measureSourceId)) this.map.removeSource(this._measureSourceId);
            readout.textContent = formatDist(0, this._measureUnit);
        };

        // Map click handler for adding points
        this._measureClickHandler = (e) => {
            if (!this._measureActive) return;
            e._drawHandled = true;
            const coord = [e.lngLat.lng, e.lngLat.lat];
            this._measurePoints.push(coord);
            updateLine();
            recalc();
        };
        this.map.on('click', this._measureClickHandler);

        // Button toggles
        btn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            if (this._measureActive) deactivate();
            else activate();
        };

        unitSel.onchange = () => {
            this._measureUnit = unitSel.value;
            recalc();
        };

        clearBtn.onclick = (e) => {
            e.preventDefault(); e.stopPropagation();
            deactivate();
        };

        // Undo last point on right-click while measuring
        this.map.on('contextmenu', (e) => {
            if (!this._measureActive) return;
            e.preventDefault();
            if (this._measurePoints.length > 0) {
                this._measurePoints.pop();
                updateLine();
                recalc();
            }
        });

        const ctrl = { onAdd: () => container, onRemove: () => { deactivate(); container.remove(); } };
        this.map.addControl(ctrl, 'top-left');
    }

    _getActivePopupHit() {
        const hits = this._popupHits;
        const idx = this._popupIndex;
        return hits?.[idx] ?? null;
    }

    _bindPopupDelegation() {
        if (this._popupDelegationBound) return;
        this._popupDelegationBound = true;

        document.addEventListener('click', (e) => {
            const btn = e.target.closest?.('[data-map-popup-action]');
            if (!btn || !btn.closest('.maplibregl-popup')) return;

            e.preventDefault();
            const action = btn.dataset.mapPopupAction;
            if (action === 'nav') {
                const dir = parseInt(btn.dataset.dir, 10) || 1;
                if (!Array.isArray(this._popupHits) || this._popupHits.length === 0) return;
                const len = this._popupHits.length;
                this._popupIndex = (this._popupIndex + dir + len) % len;
                this._renderCyclePopup();
                this._syncPopupHitSelection();
            } else if (action === 'edit') {
                const hit = this._getActivePopupHit();
                if (!hit) return;
                bus.emit('map:popup:edit', hit);
            }
        });
    }
}

export const mapManager = new MapManager();
export default mapManager;
