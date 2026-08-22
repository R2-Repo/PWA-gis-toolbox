/**
 * Map preview for plan-set callout leaders and numbered circles.
 */

import { buildMapLabelLayerSpec } from '../../map/map-labels.js';
import { buildCalloutPreviewGeoJson } from './leader-placement.js';

/** @type {object[]} */
let activePreviewEntries = [];

/**
 * @param {object} mapService
 */
export function clearCalloutPreview(mapService) {
    for (const entry of activePreviewEntries) {
        mapService?.removeTempFeature?.(entry);
    }
    activePreviewEntries = [];
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

    const map = mapService?.getMap?.();
    if (!map) {
        const entry = mapService?.showTempFeature?.(collection, 0);
        if (entry) activePreviewEntries.push(entry);
        return;
    }

    const srcId = `callout-preview-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
            'line-width': 1.4
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
            'circle-radius': 8,
            'circle-color': '#ffffff',
            'circle-stroke-color': '#111111',
            'circle-stroke-width': 1.4
        }
    });
    layerIds.push(circleId);

    const labelSpec = buildMapLabelLayerSpec(`${srcId}-labels`, srcId, {
        field: 'callout_number',
        minZoom: 0,
        size: 11,
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
    const map = mapService?.getMap?.();
    const layerIds = getCalloutPreviewLayerIds().filter((id) => map?.getLayer?.(id));
    if (!map || !layerIds.length || lngLat?.lng == null) return null;
    const point = map.project([lngLat.lng, lngLat.lat]);
    const hits = map.queryRenderedFeatures(point, { layers: layerIds });
    return hits.find((feature) => feature.properties?.leader_key) || hits[0] || null;
}
