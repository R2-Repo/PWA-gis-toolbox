/**
 * Atlas-owned MapLibre layers (do not mutate GIS user layers).
 */
import mapService from '../map/map-service.js';
import { displayPingStatus } from './ping-format.js';
import { hubPingRollup } from './triage.js';

const SOURCE_ID = 'atlas-network';
const CHANNEL_SOURCE_ID = 'atlas-channel-path';
const AREA_SOURCE_ID = 'atlas-area';
const LAYER_HUBS = 'atlas-hubs-circle';
const LAYER_DROPS = 'atlas-drops-circle';
const LAYER_STATUS = 'atlas-status-circle';
const LAYER_SELECTED = 'atlas-selected-circle';
const LAYER_CHANNEL_LINE = 'atlas-channel-line';
const LAYER_AREA_FILL = 'atlas-area-fill';
const LAYER_AREA_LINE = 'atlas-area-line';

const CLICK_LAYERS = [LAYER_DROPS, LAYER_HUBS, LAYER_STATUS, LAYER_SELECTED];

/** @type {((e: any) => void) | null} */
let clickHandler = null;
/** @type {((e: any) => void) | null} */
let enterHandler = null;
/** @type {((e: any) => void) | null} */
let leaveHandler = null;

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function syncAtlasMapLayers(snap) {
    const map = mapService.getMap?.();
    if (!map || !map.getStyle?.()) return;

    const selectedId = snap.selection?.id || '';
    const selectedKind = snap.selection?.kind || '';

    const features = [];

    for (const hub of snap.hubs || []) {
        if (hub.lat == null || hub.lon == null) continue;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [hub.lon, hub.lat] },
            properties: {
                atlasKind: 'hub',
                id: hub.id,
                label: hub.name || hub.hubCode,
                pingStatus: hubPingRollup(hub.id, snap),
                selected: selectedKind === 'hub' && hub.id === selectedId ? 1 : 0
            }
        });
    }

    for (const drop of snap.drops || []) {
        if (drop.lat == null || drop.lon == null) continue;
        const ping = drop.ip ? snap.pingResults?.[drop.ip] : null;
        const selected = (selectedKind === 'drop' && drop.id === selectedId)
            || (selectedKind === 'channel' && drop.channelId === selectedId)
            ? 1
            : 0;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [drop.lon, drop.lat] },
            properties: {
                atlasKind: 'drop',
                id: drop.id,
                channelId: drop.channelId || '',
                label: drop.inventoryName || `D${drop.dropNumber ?? '?'}`,
                ip: drop.ip || '',
                pingStatus: displayPingStatus(ping),
                selected
            }
        });
    }

    const fc = { type: 'FeatureCollection', features };

    if (map.getSource(SOURCE_ID)) {
        map.getSource(SOURCE_ID).setData(fc);
    } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
        map.addLayer({
            id: LAYER_STATUS,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'atlasKind'], 'drop'],
            paint: {
                'circle-radius': 9,
                'circle-opacity': 0.35,
                'circle-color': [
                    'match',
                    ['get', 'pingStatus'],
                    'reachable', '#16a34a',
                    'unreachable', '#dc2626',
                    'warning', '#ea580c',
                    'pending', '#ca8a04',
                    '#94a3b8'
                ]
            }
        });
        map.addLayer({
            id: LAYER_HUBS,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'atlasKind'], 'hub'],
            paint: {
                'circle-radius': 8,
                'circle-color': [
                    'match',
                    ['get', 'pingStatus'],
                    'reachable', '#16a34a',
                    'unreachable', '#dc2626',
                    'warning', '#ea580c',
                    'pending', '#ca8a04',
                    '#1d4ed8'
                ],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
            }
        });
        map.addLayer({
            id: LAYER_DROPS,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'atlasKind'], 'drop'],
            paint: {
                'circle-radius': 5,
                'circle-color': '#64748b',
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff'
            }
        });
        map.addLayer({
            id: LAYER_SELECTED,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'selected'], 1],
            paint: {
                'circle-radius': 11,
                'circle-color': 'transparent',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#f59e0b'
            }
        });
    }

    syncChannelPath(snap);
    syncAreaOverlay(snap);
}

/**
 * Draw ordered channel path (drops only; hubs often lack coordinates).
 * @param {import('./types.js').AtlasSnapshot} snap
 */
function syncChannelPath(snap) {
    const map = mapService.getMap?.();
    if (!map) return;

    let coords = [];
    if (snap.selection?.kind === 'channel') {
        const drops = (snap.drops || [])
            .filter((d) => d.channelId === snap.selection.id && d.lat != null && d.lon != null)
            .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));
        coords = drops.map((d) => [d.lon, d.lat]);
    }

    const lineFc = {
        type: 'FeatureCollection',
        features: coords.length >= 2
            ? [{
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: {}
            }]
            : []
    };

    if (map.getSource(CHANNEL_SOURCE_ID)) {
        map.getSource(CHANNEL_SOURCE_ID).setData(lineFc);
    } else if (coords.length >= 2) {
        map.addSource(CHANNEL_SOURCE_ID, { type: 'geojson', data: lineFc });
        map.addLayer({
            id: LAYER_CHANNEL_LINE,
            type: 'line',
            source: CHANNEL_SOURCE_ID,
            paint: {
                'line-color': '#2563eb',
                'line-width': 3,
                'line-opacity': 0.85
            }
        }, LAYER_STATUS);
    }
}

/**
 * Show the active area query polygon on the map.
 * @param {import('./types.js').AtlasSnapshot} snap
 */
function syncAreaOverlay(snap) {
    const map = mapService.getMap?.();
    if (!map) return;

    const geometry = snap.areaResults?.geometry;
    const fc = {
        type: 'FeatureCollection',
        features: geometry
            ? [{ type: 'Feature', geometry, properties: {} }]
            : []
    };

    if (map.getSource(AREA_SOURCE_ID)) {
        map.getSource(AREA_SOURCE_ID).setData(fc);
    } else if (geometry) {
        map.addSource(AREA_SOURCE_ID, { type: 'geojson', data: fc });
        map.addLayer({
            id: LAYER_AREA_FILL,
            type: 'fill',
            source: AREA_SOURCE_ID,
            paint: {
                'fill-color': '#d4a24e',
                'fill-opacity': 0.12
            }
        }, LAYER_STATUS);
        map.addLayer({
            id: LAYER_AREA_LINE,
            type: 'line',
            source: AREA_SOURCE_ID,
            paint: {
                'line-color': '#b45309',
                'line-width': 2,
                'line-dasharray': [4, 3]
            }
        }, LAYER_STATUS);
    }
}

/**
 * @param {{ lat: number, lon: number }} center
 * @param {number} [zoom=14]
 */
export function flyToAtlasPoint(center, zoom = 14) {
    if (center?.lat == null || center?.lon == null) return;
    const map = mapService.getMap?.();
    try {
        map?.flyTo?.({ center: [center.lon, center.lat], zoom, duration: 800 });
    } catch {
        /* ignore */
    }
}

/**
 * @param {Array<{ lat: number, lon: number }>} points
 */
export function fitAtlasPoints(points) {
    const map = mapService.getMap?.();
    const valid = (points || []).filter((p) => p?.lat != null && p?.lon != null);
    if (!map || !valid.length) return;
    if (valid.length === 1) {
        flyToAtlasPoint(valid[0], 14);
        return;
    }
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const p of valid) {
        minLng = Math.min(minLng, p.lon);
        maxLng = Math.max(maxLng, p.lon);
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
    }
    try {
        map.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 60, maxZoom: 15, duration: 800 }
        );
    } catch {
        flyToAtlasPoint(valid[0], 12);
    }
}

/**
 * @param {(sel: { kind: 'hub'|'drop', id: string }) => void} onSelect
 */
export function enableAtlasMapInteraction(onSelect) {
    const map = mapService.getMap?.();
    if (!map) return;
    disableAtlasMapInteraction();

    clickHandler = (e) => {
        const feats = map.queryRenderedFeatures(e.point, { layers: CLICK_LAYERS.filter((id) => map.getLayer(id)) });
        const hit = feats?.[0];
        if (!hit?.properties?.id || !hit.properties.atlasKind) return;
        const kind = hit.properties.atlasKind === 'hub' ? 'hub' : 'drop';
        onSelect?.({ kind, id: String(hit.properties.id) });
    };
    enterHandler = () => {
        map.getCanvas().style.cursor = 'pointer';
    };
    leaveHandler = () => {
        map.getCanvas().style.cursor = '';
    };

    for (const layer of CLICK_LAYERS) {
        if (!map.getLayer(layer)) continue;
        map.on('click', layer, clickHandler);
        map.on('mouseenter', layer, enterHandler);
        map.on('mouseleave', layer, leaveHandler);
    }
}

export function disableAtlasMapInteraction() {
    const map = mapService.getMap?.();
    if (!map) {
        clickHandler = null;
        enterHandler = null;
        leaveHandler = null;
        return;
    }
    for (const layer of CLICK_LAYERS) {
        if (!map.getLayer(layer)) continue;
        if (clickHandler) map.off('click', layer, clickHandler);
        if (enterHandler) map.off('mouseenter', layer, enterHandler);
        if (leaveHandler) map.off('mouseleave', layer, leaveHandler);
    }
    map.getCanvas().style.cursor = '';
    clickHandler = null;
    enterHandler = null;
    leaveHandler = null;
}

export function clearAtlasMapLayers() {
    disableAtlasMapInteraction();
    const map = mapService.getMap?.();
    if (!map) return;
    for (const id of [
        LAYER_AREA_LINE, LAYER_AREA_FILL, LAYER_CHANNEL_LINE,
        LAYER_SELECTED, LAYER_STATUS, LAYER_DROPS, LAYER_HUBS
    ]) {
        if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [AREA_SOURCE_ID, CHANNEL_SOURCE_ID, SOURCE_ID]) {
        if (map.getSource(id)) map.removeSource(id);
    }
}
