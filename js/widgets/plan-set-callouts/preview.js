/**
 * Map preview for plan-set callout leaders and numbered circles.
 */

import { buildMapLabelLayerSpec } from '../../map/map-labels.js';
import { buildCalloutPreviewGeoJson } from './leader-placement.js';

/** @type {object[]} */
let activePreviewEntries = [];

const PREVIEW_ID_HINT = 'callout-preview-';

function previewMap(mapService) {
    return mapService?.getMap?.() || null;
}

function isPlanSetCalloutPreviewId(id) {
    return String(id).startsWith(PREVIEW_ID_HINT);
}

function collectPreviewLayerIds(map) {
    const ids = new Set(activePreviewEntries.flatMap((entry) => entry.layerIds || []));
    for (const layer of map?.getStyle?.()?.layers || []) {
        if (isPlanSetCalloutPreviewId(layer.id)) ids.add(layer.id);
    }
    return [...ids];
}

function collectPreviewSourceIds(map) {
    const ids = new Set(activePreviewEntries.map((entry) => entry.srcId).filter(Boolean));
    for (const srcId of Object.keys(map?.getStyle?.()?.sources || {})) {
        if (isPlanSetCalloutPreviewId(srcId)) ids.add(srcId);
    }
    return [...ids];
}

/**
 * @param {object} mapService
 */
export function clearCalloutPreview(mapService) {
    const map = previewMap(mapService);
    const entries = [...activePreviewEntries];

    if (!map) {
        activePreviewEntries = [];
        for (const entry of entries) {
            mapService?.removeTempFeature?.(entry);
        }
        return;
    }

    const layerIds = collectPreviewLayerIds(map);
    const sourceIds = collectPreviewSourceIds(map);
    activePreviewEntries = [];

    for (const lid of layerIds) {
        if (map.getLayer?.(lid)) map.removeLayer(lid);
    }
    for (const srcId of sourceIds) {
        if (map.getSource?.(srcId)) map.removeSource(srcId);
    }
}

/**
 * Hide preview paint during PDF capture so callouts are vector-only on corridor sheets
 * and absent from the overview raster.
 * @param {object} mapService
 * @returns {() => void}
 */
export function suspendCalloutPreview(mapService) {
    const map = previewMap(mapService);
    if (!map) return () => {};

    const restored = [];
    for (const id of collectPreviewLayerIds(map)) {
        if (!map.getLayer?.(id)) continue;
        const prev = map.getLayoutProperty?.(id, 'visibility');
        if (prev === 'none') continue;
        map.setLayoutProperty?.(id, 'visibility', 'none');
        restored.push({ id, prev: prev || 'visible' });
    }

    return () => {
        for (const { id, prev } of restored) {
            if (!map.getLayer?.(id)) continue;
            map.setLayoutProperty?.(id, 'visibility', prev);
        }
    };
}

/**
 * @returns {string[]}
 */
export function getCalloutPreviewLayerIds() {
    return activePreviewEntries.flatMap((entry) => entry.layerIds || []);
}

/**
 * @param {object} mapService
 * @param {object} session
 */
export function showCalloutPreview(mapService, session) {
    clearCalloutPreview(mapService);
    const collection = buildCalloutPreviewGeoJson(session);
    if (!collection.features.length) return;

    const map = previewMap(mapService);
    if (!map) {
        const entry = mapService?.showTempFeature?.(collection, 0);
        if (entry) activePreviewEntries.push(entry);
        return;
    }

    const srcId = `${PREVIEW_ID_HINT}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    map.addSource(srcId, { type: 'geojson', data: collection });
    const layerIds = [];

    const lineId = `${srcId}-line`;
    map.addLayer({
        id: lineId,
        type: 'line',
        source: srcId,
        filter: ['==', ['get', 'feature_type'], 'callout_leader'],
        paint: {
            'line-color': '#111111',
            'line-width': 1.2
        }
    });
    layerIds.push(lineId);

    const circleId = `${srcId}-circle`;
    map.addLayer({
        id: circleId,
        type: 'circle',
        source: srcId,
        filter: ['==', ['get', 'feature_type'], 'callout_bubble'],
        paint: {
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-stroke-color': '#111111',
            'circle-stroke-width': 1.1
        }
    });
    layerIds.push(circleId);

    const labelSpec = buildMapLabelLayerSpec(`${srcId}-labels`, srcId, {
        field: 'callout_number',
        minZoom: 0,
        size: 10,
        anchor: 'center',
        offset: [0, 0],
        color: '#111111',
        haloColor: '#ffffff',
        haloWidth: 0.2,
        allowOverlap: true,
        ignorePlacement: true
    });
    if (labelSpec) {
        map.addLayer(labelSpec);
        map.setFilter(labelSpec.id, ['==', ['get', 'feature_type'], 'callout_bubble']);
        layerIds.push(labelSpec.id);
    }

    activePreviewEntries.push({ srcId, layerIds });
}

/**
 * @param {object} mapService
 * @param {{ lng: number, lat: number }} lngLat
 * @returns {object|null}
 */
export function hitCalloutPreview(mapService, lngLat) {
    const map = previewMap(mapService);
    const layerIds = collectPreviewLayerIds(map).filter((id) => map?.getLayer?.(id));
    if (!map || !layerIds.length || lngLat?.lng == null) return null;
    const point = map.project([lngLat.lng, lngLat.lat]);
    const hits = map.queryRenderedFeatures(point, { layers: layerIds });
    return hits.find((feature) => feature.properties?.leader_key) || hits[0] || null;
}
