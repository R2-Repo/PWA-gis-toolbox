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
/** @type {null | { map: object, onMouseDown: Function, onMouseMove: Function, onMouseUp: Function }} */
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
 * @param {object} mapService
 * @returns {() => void}
 */
export function hideCalloutPreviewForCapture(mapService) {
    return suspendCalloutPreview(mapService);
}

/**
 * @returns {string[]}
 */
export function getCalloutPreviewLayerIds() {
    return activePreviewEntries.flatMap((entry) => entry.layerIds || []);
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
    const map = previewMap(mapService);

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
    const map = previewMap(mapService);
    const layerIds = collectPreviewLayerIds(map).filter((id) => map?.getLayer?.(id));
    if (!map || !layerIds.length || lngLat?.lng == null) return null;
    const point = map.project([lngLat.lng, lngLat.lat]);
    const hits = map.queryRenderedFeatures(point, { layers: layerIds });
    return hits.find((feature) => feature.properties?.leader_key) || hits[0] || null;
}
