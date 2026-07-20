/**
 * Atlas-owned MapLibre layers (do not mutate GIS user layers).
 */
import mapService from '../map/map-service.js';

const SOURCE_ID = 'atlas-network';
const LAYER_HUBS = 'atlas-hubs-circle';
const LAYER_DROPS = 'atlas-drops-circle';
const LAYER_STATUS = 'atlas-status-circle';

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function syncAtlasMapLayers(snap) {
    const map = mapService.getMap?.();
    if (!map || !map.getStyle?.()) return;

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
                pingStatus: 'untested'
            }
        });
    }

    for (const drop of snap.drops || []) {
        if (drop.lat == null || drop.lon == null) continue;
        const ping = drop.ip ? snap.pingResults?.[drop.ip] : null;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [drop.lon, drop.lat] },
            properties: {
                atlasKind: 'drop',
                id: drop.id,
                label: drop.inventoryName || `D${drop.dropNumber ?? '?'}`,
                ip: drop.ip || '',
                pingStatus: ping?.status || 'untested'
            }
        });
    }

    const fc = { type: 'FeatureCollection', features };

    if (map.getSource(SOURCE_ID)) {
        map.getSource(SOURCE_ID).setData(fc);
    } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
        map.addLayer({
            id: LAYER_HUBS,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'atlasKind'], 'hub'],
            paint: {
                'circle-radius': 8,
                'circle-color': '#1d4ed8',
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
    try {
        mapService.highlightFeature?.(
            {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [center.lon, center.lat] },
                properties: {}
            },
            null
        );
    } catch {
        /* highlight optional */
    }
}

export function clearAtlasMapLayers() {
    const map = mapService.getMap?.();
    if (!map) return;
    for (const id of [LAYER_STATUS, LAYER_DROPS, LAYER_HUBS]) {
        if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}
