/**
 * Map preview for plan-set callout leaders and numbered circles.
 * Survives widget Done/close so leaders stay editable on the map.
 */

import { buildMapLabelLayerSpec } from '../../map/map-labels.js';
import { getWidgetEntry } from '../widget-state-store.js';
import { restoreSheetSession } from '../sheet-cutting/engine.js';
import { buildCalloutPreviewGeoJson } from './leader-placement.js';

/** @type {object[]} */
let activePreviewEntries = [];
/** @type {null | { map: object, onMouseDown: Function, onMouseMove: Function, onMouseUp: Function, onMouseEnter: Function }} */
let dragListeners = null;
let dragging = null;

/**
 * @returns {object[]}
 */
export function getLinkedInsetViews() {
    const entry = getWidgetEntry('sheet-cutting');
    if (!entry?.state) return [];
    try {
        return restoreSheetSession(entry.state)?.sheets?.insetViews || [];
    } catch {
        return [];
    }
}

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
 * Hide preview during PDF basemap capture so leaders are not rasterized twice.
 * @param {object} mapService
 * @returns {() => void}
 */
export function hideCalloutPreviewForCapture(mapService) {
    const map = mapService?.getMap?.();
    const hidden = [];
    for (const id of getCalloutPreviewLayerIds()) {
        if (!map?.getLayer?.(id)) continue;
        const visibility = map.getLayoutProperty(id, 'visibility');
        if (visibility !== 'none') {
            map.setLayoutProperty(id, 'visibility', 'none');
            hidden.push(id);
        }
    }
    return () => {
        for (const id of hidden) {
            if (map?.getLayer?.(id)) map.setLayoutProperty(id, 'visibility', 'visible');
        }
    };
}

function bubbleLayerIds(map) {
    return getCalloutPreviewLayerIds().filter((id) => (
        map?.getLayer?.(id) && (id.endsWith('-circle') || id.endsWith('-labels'))
    ));
}

function hitBubble(map, point) {
    const layers = bubbleLayerIds(map);
    if (!map || !layers.length || !point) return null;
    const hits = map.queryRenderedFeatures(point, { layers });
    return hits.find((feature) => feature.properties?.feature_type === 'callout_bubble' && feature.properties?.leader_key)
        || null;
}

/**
 * @param {object} mapService
 * @param {{
 *   onDrag?: (leaderKey: string, coord: number[]) => void,
 *   onCommit?: (leaderKey: string, coord: number[]) => void,
 *   isEnabled?: () => boolean
 * }} [handlers]
 */
export function installCalloutDrag(mapService, handlers = {}) {
    const map = mapService?.getMap?.();
    if (!map || dragListeners) return;

    const canvas = map.getCanvas?.();
    const onMouseDown = (e) => {
        if (handlers.isEnabled && handlers.isEnabled() === false) return;
        if (e.originalEvent?.button != null && e.originalEvent.button !== 0) return;
        const hit = hitBubble(map, e.point);
        if (!hit) return;
        dragging = {
            leaderKey: hit.properties.leader_key,
            moved: false,
            start: e.point
        };
        map.dragPan?.disable?.();
        if (canvas) canvas.style.cursor = 'grabbing';
        e.preventDefault();
        e.originalEvent?.preventDefault?.();
        e.originalEvent?.stopPropagation?.();
    };
    const onMouseMove = (e) => {
        if (!dragging) {
            if (canvas && hitBubble(map, e.point)) canvas.style.cursor = 'grab';
            return;
        }
        const dx = e.point.x - dragging.start.x;
        const dy = e.point.y - dragging.start.y;
        if (!dragging.moved && (dx * dx + dy * dy) > 9) dragging.moved = true;
        const coord = [e.lngLat.lng, e.lngLat.lat];
        handlers.onDrag?.(dragging.leaderKey, coord);
    };
    const onMouseUp = (e) => {
        if (!dragging) return;
        const coord = [e.lngLat.lng, e.lngLat.lat];
        const key = dragging.leaderKey;
        const moved = dragging.moved;
        dragging = null;
        map.dragPan?.enable?.();
        if (canvas) canvas.style.cursor = '';
        if (moved) {
            handlers.onCommit?.(key, coord);
            const swallow = (clickEvent) => {
                clickEvent.preventDefault();
                map.off('click', swallow);
            };
            map.once('click', swallow);
        }
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);
    dragListeners = { map, onMouseDown, onMouseMove, onMouseUp };
}

/**
 * @param {object} [mapService]
 */
export function uninstallCalloutDrag(mapService) {
    const map = dragListeners?.map || mapService?.getMap?.();
    if (map && dragListeners) {
        map.off('mousedown', dragListeners.onMouseDown);
        map.off('mousemove', dragListeners.onMouseMove);
        map.off('mouseup', dragListeners.onMouseUp);
    }
    if (dragging) map?.dragPan?.enable?.();
    dragging = null;
    dragListeners = null;
}

function ensurePreviewLayers(map, collection) {
    const existing = activePreviewEntries[0];
    if (existing?.srcId && map.getSource?.(existing.srcId)) {
        map.getSource(existing.srcId).setData(collection);
        return existing;
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

    const entry = { srcId, layerIds };
    activePreviewEntries.push(entry);
    return entry;
}

/**
 * @param {object} mapService
 * @param {object} session
 * @param {object} [options]
 */
export function showCalloutPreview(mapService, session, options = {}) {
    const insetViews = options.insetViews || getLinkedInsetViews();
    const collection = buildCalloutPreviewGeoJson(session, { insetViews });
    const map = mapService?.getMap?.();

    if (!collection.features.length) {
        clearCalloutPreview(mapService);
        return;
    }

    if (!map) {
        clearCalloutPreview(mapService);
        const entry = mapService?.showTempFeature?.(collection, 0);
        if (entry) activePreviewEntries.push(entry);
        return;
    }

    if (!activePreviewEntries[0]?.srcId || !map.getSource?.(activePreviewEntries[0].srcId)) {
        for (const entry of activePreviewEntries) {
            mapService?.removeTempFeature?.(entry);
        }
        activePreviewEntries = [];
    }
    ensurePreviewLayers(map, collection);
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
