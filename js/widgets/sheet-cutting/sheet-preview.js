/**
 * Map preview overlays for Sheet Cutter (shared by widget + PDF export).
 */

import { buildMapLabelLayerSpec } from '../../map/map-labels.js';
import { buildSheetLabelCollection } from './sheet-labels.js';
import { INSET_PREVIEW_COLOR } from './inset-views.js';

/** Map preview + overview PDF frame color (matches showTempFeature). */
export const SHEET_FRAME_PREVIEW_COLOR = '#d4a24e';

/** @type {object[]} */
let activePreviewEntries = [];

/**
 * @param {object} mapService
 */
export function clearSheetPreview(mapService) {
    for (const entry of activePreviewEntries) {
        mapService.removeTempFeature?.(entry);
    }
    activePreviewEntries = [];
}

/**
 * @param {object} mapService
 * @param {import('geojson').FeatureCollection} labelCollection
 * @returns {object|null}
 */
function installSheetPreviewLabels(mapService, labelCollection) {
    const map = mapService?.getMap?.();
    if (!map || !labelCollection?.features?.length) return null;

    const srcId = `sheet-preview-labels-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    map.addSource(srcId, { type: 'geojson', data: labelCollection });

    const labelSpec = buildMapLabelLayerSpec(`${srcId}-labels`, srcId, {
        field: 'sheet_label',
        minZoom: 0,
        size: 14,
        anchor: 'center',
        offset: [0, 0],
        color: '#1a1a1a',
        haloColor: '#ffffff',
        haloWidth: 2,
        allowOverlap: true,
        ignorePlacement: true
    });

    if (!labelSpec) return null;

    map.addLayer(labelSpec);
    return { srcId, layerIds: [labelSpec.id] };
}

/**
 * @param {object} mapService
 * @param {import('geojson').FeatureCollection} collection
 * @returns {object|null}
 */
function installInsetPreview(mapService, collection) {
    const map = mapService?.getMap?.();
    const features = collection?.features || [];
    if (!map || !features.length) return null;

    const srcId = `sheet-inset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    map.addSource(srcId, { type: 'geojson', data: collection });
    const layerIds = [];

    const fillId = `${srcId}-fill`;
    map.addLayer({
        id: fillId,
        type: 'fill',
        source: srcId,
        filter: ['==', ['get', 'feature_type'], 'inset_outline'],
        paint: {
            'fill-color': INSET_PREVIEW_COLOR,
            'fill-opacity': 0.08
        }
    });
    layerIds.push(fillId);

    const lineId = `${srcId}-line`;
    map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        filter: ['==', ['get', 'feature_type'], 'inset_outline'],
        paint: {
            'line-color': INSET_PREVIEW_COLOR,
            'line-width': 2.25,
            'line-dasharray': [1.6, 1.1]
        }
    });
    layerIds.push(lineId);

    const labelId = `${srcId}-labels`;
    map.addLayer({
        id: labelId,
        type: 'symbol',
        source: srcId,
        filter: ['==', ['get', 'feature_type'], 'inset_label'],
        layout: {
            'text-field': ['to-string', ['coalesce', ['get', 'label_text'], ['get', 'inset_label']]],
            'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
            'text-size': 12,
            'text-anchor': ['coalesce', ['get', 'label_anchor'], 'bottom'],
            'text-justify': 'center',
            'text-line-height': 1.05,
            'text-max-width': 24,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            'text-padding': 2
        },
        paint: {
            'text-color': '#1e3a8a',
            'text-halo-color': '#ffffff',
            'text-halo-width': 1.6
        }
    });
    layerIds.push(labelId);

    return { srcId, layerIds };
}

/**
 * Temporarily hide user data layers so overview export shows only basemap + sheet frames.
 *
 * @param {object} mapService
 * @returns {() => void}
 */
/**
 * Hide only design layers that will be re-drawn as vector PDF content.
 *
 * @param {object} mapService
 * @param {string[]} [designLayerIds]
 * @returns {() => void}
 */
export function suspendDesignLayersForCapture(mapService, designLayerIds = []) {
    const map = mapService?.getMap?.();
    const restored = [];

    for (const layerId of designLayerIds) {
        const record = mapService.getLayerRecord?.(layerId);
        if (!record) continue;

        const subIds = record.layerIds ?? [];
        let wasVisible = true;

        if (map && subIds.length) {
            for (const subId of subIds) {
                if (!map.getLayer(subId)) continue;
                wasVisible = map.getLayoutProperty(subId, 'visibility') !== 'none';
                break;
            }
        }

        restored.push({ layerId, wasVisible });
        if (wasVisible) {
            mapService.toggleLayer(layerId, false);
        }
    }

    return () => {
        for (const { layerId, wasVisible } of restored) {
            mapService.toggleLayer(layerId, wasVisible);
        }
    };
}

/**
 * @param {object} mapService
 * @param {string} layerId
 * @returns {boolean}
 */
function isLayerVisibleOnMap(mapService, layerId) {
    const map = mapService?.getMap?.();
    const record = mapService.getLayerRecord?.(layerId);
    const subIds = record?.layerIds ?? [];

    if (map && subIds.length) {
        for (const subId of subIds) {
            if (!map.getLayer(subId)) continue;
            return map.getLayoutProperty(subId, 'visibility') !== 'none';
        }
    }

    return true;
}

/**
 * Temporarily hide data layers outside the export scope so PDF capture matches
 * the map appearance of the route centerline + checked design layers only.
 *
 * @param {object} mapService
 * @param {string[]} [exportLayerIds]
 * @returns {() => void}
 */
export function prepareExportLayerVisibility(mapService, exportLayerIds = []) {
    const exportSet = new Set(exportLayerIds.filter(Boolean));
    const restored = [];

    for (const layerId of mapService.getLayerIds?.() ?? []) {
        if (exportSet.has(layerId)) continue;

        const wasVisible = isLayerVisibleOnMap(mapService, layerId);
        if (wasVisible) {
            mapService.toggleLayer(layerId, false);
            restored.push({ layerId, wasVisible });
        }
    }

    return () => {
        for (const { layerId, wasVisible } of restored) {
            mapService.toggleLayer(layerId, wasVisible);
        }
    };
}

/**
 * Hide data layers for basemap capture. `keepLayerIds` stay on (live Fiber paint).
 *
 * @param {object} mapService
 * @param {string[]} [keepLayerIds]
 * @returns {() => void}
 */
export function suppressMapDataLayersForCapture(mapService, keepLayerIds = []) {
    const keep = new Set((keepLayerIds || []).filter(Boolean));
    const restored = [];

    for (const layerId of mapService.getLayerIds?.() ?? []) {
        if (keep.has(layerId)) continue;
        const wasVisible = isLayerVisibleOnMap(mapService, layerId);
        if (wasVisible) {
            mapService.toggleLayer(layerId, false);
            restored.push({ layerId, wasVisible });
        }
    }

    return () => {
        for (const { layerId, wasVisible } of restored) {
            mapService.toggleLayer(layerId, wasVisible);
        }
    };
}

/**
 * @param {object} mapService
 * @param {object} layers
 * @param {{
 *   singleFrame?: object|null,
 *   overviewOnly?: boolean,
 *   showRoute?: boolean,
 *   showLabels?: boolean
 * }} [options]
 */
export function showSheetPreview(mapService, layers = {}, options = {}) {
    clearSheetPreview(mapService);

    const overviewOnly = options.overviewOnly === true;
    // Route/centerline is already visible as the user's selected stationing layer.
    const showRoute = options.showRoute === true && !overviewOnly;
    const showLabels = options.showLabels !== false && !options.singleFrame;

    const push = (geojson, previewOptions = {}) => {
        if (!geojson?.features?.length && geojson?.type !== 'Feature') return;
        const entry = mapService.showTempFeature?.(geojson, 0, previewOptions);
        if (entry) activePreviewEntries.push(entry);
    };

    const sheetPreviewStyle = { fillOpacity: 0 };

    if (showRoute && layers.route?.features?.length) {
        push(layers.route);
    }

    if (options.singleFrame) {
        push(options.singleFrame, sheetPreviewStyle);
        return;
    }

    if (layers.sheetFrames?.features?.length) {
        push(layers.sheetFrames, sheetPreviewStyle);
    }

    if (showLabels && layers.sheetFrames?.features?.length) {
        const labelCollection = buildSheetLabelCollection(layers.sheetFrames, layers.route?.features?.[0] ?? null);
        const labelEntry = installSheetPreviewLabels(mapService, labelCollection);
        if (labelEntry) activePreviewEntries.push(labelEntry);
    }

    if (!overviewOnly && !options.singleFrame && layers.insetViews?.features?.length) {
        const insetEntry = installInsetPreview(mapService, layers.insetViews);
        if (insetEntry) activePreviewEntries.push(insetEntry);
    }
}

/**
 * @param {import('geojson').FeatureCollection} sheetFrames
 * @param {string} sheetId
 * @returns {import('geojson').FeatureCollection|null}
 */
export function buildSingleSheetFrameCollection(sheetFrames, sheetId) {
    const feature = sheetFrames?.features?.find((entry) => entry.properties?.sheet_id === sheetId);
    if (!feature) return null;
    return { type: 'FeatureCollection', features: [feature] };
}

/**
 * @param {import('geojson').FeatureCollection|import('geojson').Feature} geojson
 * @returns {[[number, number], [number, number]]|null}
 */
export function boundsFromGeoJson(geojson) {
    if (typeof turf === 'undefined' || !geojson) return null;
    try {
        const bbox = turf.bbox(geojson);
        if (!bbox?.every((value) => Number.isFinite(value))) return null;
        return [[bbox[0], bbox[1]], [bbox[2], bbox[3]]];
    } catch (_) {
        return null;
    }
}
