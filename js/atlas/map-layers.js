/**
 * Atlas-owned MapLibre layers (do not mutate GIS user layers).
 */
import mapService from '../map/map-service.js';
import dualScreenCoordinator from '../dual-screen/coordinator.js';
import { buildAtlasHoverHtml } from './map-hover.js';
import { atlasMapKindFilterExpression } from './map-ping-filter.js';
import {
    ATLAS_DROP_CORE_COLOR,
    ATLAS_DROP_CORE_RADIUS,
    ATLAS_DROP_CORE_RADIUS_SMALL,
    ATLAS_DROP_NO_CHANNEL_COLOR,
    ATLAS_HUB_ISSUE_COLOR,
    ATLAS_PING_COLORS,
    ATLAS_PING_OPACITY,
    ATLAS_SELECTED_COLOR,
    ATLAS_STATUS_RADIUS,
    ATLAS_STATUS_RADIUS_SMALL,
    displayPingStatus,
    getPingEntry,
    normalizePingIp
} from './ping-format.js';
import { describeHubPing } from './triage.js';

/** Missing channel → gray; otherwise blue (including no-IP). */
const DROP_CORE_COLOR_MATCH = [
    'case',
    ['==', ['get', 'hasChannel'], 0],
    ATLAS_DROP_NO_CHANNEL_COLOR,
    ATLAS_DROP_CORE_COLOR
];

/** Missing channel → translucent gray; otherwise opaque. */
const DROP_CORE_OPACITY_MATCH = [
    'case',
    ['==', ['get', 'hasChannel'], 0],
    0.35,
    1
];

/** Smaller core when no IP and/or no fiber channel. */
const DROP_CORE_RADIUS_MATCH = [
    'case',
    [
        'any',
        ['==', ['get', 'hasChannel'], 0],
        ['==', ['get', 'hasIp'], 0]
    ],
    ATLAS_DROP_CORE_RADIUS_SMALL,
    ATLAS_DROP_CORE_RADIUS
];

const SOURCE_ID = 'atlas-network';
const CHANNEL_SOURCE_ID = 'atlas-channel-path';
const AREA_SOURCE_ID = 'atlas-area';
const LAYER_HUBS = 'atlas-hubs-square';
const LAYER_HUBS_LEGACY = 'atlas-hubs-circle';
const LAYER_HUBS_ISSUE = 'atlas-hubs-issue';
const LAYER_BUILDINGS = 'atlas-buildings-circle';
const LAYER_DROPS = 'atlas-drops-circle';
const LAYER_STATUS = 'atlas-status-circle';
const LAYER_SELECTED = 'atlas-selected-circle';
const LAYER_CHANNEL_LINE = 'atlas-channel-line';
const LAYER_AREA_FILL = 'atlas-area-fill';
const LAYER_AREA_LINE = 'atlas-area-line';

/** Distinct from hub squares and drop cores. */
const BUILDING_FILL_COLOR = '#0f766e';

const HUB_ICON_PREFIX = 'atlas-hub-sq-';
const HUB_ISSUE_ICON = 'atlas-hub-issue-sq';
const HUB_FILL_KEYS = [
    'reachable',
    'unreachable',
    'stale_reachable',
    'stale_unreachable',
    'pending',
    'intermittent',
    'no_ip',
    'mixed',
    'untested',
    'warning'
];

// Prefer hubs when hit-testing overlapping markers.
const CLICK_LAYERS = [
    LAYER_HUBS_ISSUE,
    LAYER_HUBS,
    LAYER_BUILDINGS,
    LAYER_DROPS,
    LAYER_STATUS,
    LAYER_SELECTED
];

/** @returns {any[]} */
function hubIconImageMatch() {
    const expr = ['match', ['get', 'hubFillStatus']];
    for (const key of HUB_FILL_KEYS) {
        if (key === 'warning') {
            expr.push(key, `${HUB_ICON_PREFIX}stale_reachable`);
            continue;
        }
        expr.push(key, `${HUB_ICON_PREFIX}${key}`);
    }
    expr.push(`${HUB_ICON_PREFIX}untested`);
    return expr;
}

/**
 * Sync canvas square for MapLibre `addImage` (pixel-constant size).
 * @param {string} fill
 * @param {string} stroke
 * @param {number} [size=28]
 * @param {number} [strokeWidth=3]
 */
function createSquareImageData(fill, stroke, size = 28, strokeWidth = 3) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return { width: size, height: size, data: new Uint8Array(size * size * 4) };
    }
    ctx.clearRect(0, 0, size, size);
    const inset = strokeWidth / 2 + 1;
    const side = size - inset * 2;
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeWidth;
    ctx.beginPath();
    ctx.rect(inset, inset, side, side);
    ctx.fill();
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
}

/**
 * @param {import('maplibre-gl').Map} map
 */
function ensureAtlasHubSquareImages(map) {
    if (!map?.addImage || !map?.hasImage) return;
    for (const key of HUB_FILL_KEYS) {
        if (key === 'warning') continue;
        const name = `${HUB_ICON_PREFIX}${key}`;
        if (map.hasImage(name)) continue;
        const fill = ATLAS_PING_COLORS[key] || ATLAS_PING_COLORS.untested;
        try {
            map.addImage(name, createSquareImageData(fill, '#ffffff', 28, 3));
        } catch {
            /* style may be mid-update */
        }
    }
    if (!map.hasImage(HUB_ISSUE_ICON)) {
        try {
            map.addImage(HUB_ISSUE_ICON, createSquareImageData(ATLAS_HUB_ISSUE_COLOR, '#ffffff', 14, 2));
        } catch {
            /* ignore */
        }
    }
}

/**
 * Drop legacy circle hub layers / wrong-type hub layers so squares can be added.
 * @param {import('maplibre-gl').Map} map
 */
function removeLegacyHubCircleLayers(map) {
    if (!map?.getLayer) return;
    if (map.getLayer(LAYER_HUBS_LEGACY)) {
        try {
            map.removeLayer(LAYER_HUBS_LEGACY);
        } catch {
            /* ignore */
        }
    }
    const hub = map.getLayer(LAYER_HUBS);
    if (hub && hub.type !== 'symbol') {
        try {
            map.removeLayer(LAYER_HUBS);
        } catch {
            /* ignore */
        }
    }
    const issue = map.getLayer(LAYER_HUBS_ISSUE);
    if (issue && issue.type !== 'symbol') {
        try {
            map.removeLayer(LAYER_HUBS_ISSUE);
        } catch {
            /* ignore */
        }
    }
}

/** Black halo for no channel / no IP; otherwise ping status colors. */
const STATUS_COLOR_MATCH = [
    'case',
    ['==', ['get', 'hasChannel'], 0], ATLAS_PING_COLORS.no_channel,
    ['==', ['get', 'hasIp'], 0], ATLAS_PING_COLORS.no_ip,
    [
        'match',
        ['get', 'pingStatus'],
        'reachable', ATLAS_PING_COLORS.reachable,
        'unreachable', ATLAS_PING_COLORS.unreachable,
        'stale_reachable', ATLAS_PING_COLORS.stale_reachable,
        'stale_unreachable', ATLAS_PING_COLORS.stale_unreachable,
        'pending', ATLAS_PING_COLORS.pending,
        'intermittent', ATLAS_PING_COLORS.intermittent,
        'no_ip', ATLAS_PING_COLORS.no_ip,
        'mixed', ATLAS_PING_COLORS.mixed,
        'warning', ATLAS_PING_COLORS.stale_reachable,
        ATLAS_PING_COLORS.untested
    ]
];

const STATUS_OPACITY_MATCH = [
    'case',
    ['==', ['get', 'hasChannel'], 0], ATLAS_PING_OPACITY.no_channel,
    ['==', ['get', 'hasIp'], 0], ATLAS_PING_OPACITY.no_ip,
    [
        'match',
        ['get', 'pingStatus'],
        'reachable', ATLAS_PING_OPACITY.reachable,
        'unreachable', ATLAS_PING_OPACITY.unreachable,
        'stale_reachable', ATLAS_PING_OPACITY.stale_reachable,
        'stale_unreachable', ATLAS_PING_OPACITY.stale_unreachable,
        'pending', ATLAS_PING_OPACITY.pending,
        'intermittent', ATLAS_PING_OPACITY.intermittent,
        'no_ip', ATLAS_PING_OPACITY.no_ip,
        'mixed', ATLAS_PING_OPACITY.mixed,
        'warning', ATLAS_PING_OPACITY.stale_reachable,
        ATLAS_PING_OPACITY.untested
    ]
];

const STATUS_RADIUS_MATCH = [
    'case',
    [
        'any',
        ['==', ['get', 'hasChannel'], 0],
        ['==', ['get', 'hasIp'], 0]
    ],
    ATLAS_STATUS_RADIUS_SMALL,
    ATLAS_STATUS_RADIUS
];

/**
 * Bottom → top paint order for network markers.
 * @param {import('maplibre-gl').Map} map
 */
function ensureAtlasLayerStack(map) {
    if (!map?.getLayer) return;
    const order = [
        LAYER_STATUS,
        LAYER_DROPS,
        LAYER_BUILDINGS,
        LAYER_HUBS,
        LAYER_HUBS_ISSUE,
        LAYER_SELECTED
    ];
    for (const id of order) {
        if (map.getLayer(id)) {
            try {
                map.moveLayer(id);
            } catch {
                /* style may be mid-update */
            }
        }
    }
}

/**
 * Persist paint updates when layers already exist (not only on first add).
 * @param {import('maplibre-gl').Map} map
 */
function applyAtlasLayerPaint(map) {
    if (!map?.getLayer) return;
    if (map.getLayer(LAYER_STATUS)) {
        map.setPaintProperty(LAYER_STATUS, 'circle-color', STATUS_COLOR_MATCH);
        map.setPaintProperty(LAYER_STATUS, 'circle-opacity', STATUS_OPACITY_MATCH);
        map.setPaintProperty(LAYER_STATUS, 'circle-radius', STATUS_RADIUS_MATCH);
    }
    if (map.getLayer(LAYER_DROPS)) {
        map.setPaintProperty(LAYER_DROPS, 'circle-color', DROP_CORE_COLOR_MATCH);
        map.setPaintProperty(LAYER_DROPS, 'circle-opacity', DROP_CORE_OPACITY_MATCH);
        map.setPaintProperty(LAYER_DROPS, 'circle-stroke-width', 1);
        map.setPaintProperty(LAYER_DROPS, 'circle-stroke-color', '#ffffff');
        map.setPaintProperty(LAYER_DROPS, 'circle-radius', DROP_CORE_RADIUS_MATCH);
    }
    if (map.getLayer(LAYER_BUILDINGS)) {
        map.setPaintProperty(LAYER_BUILDINGS, 'circle-color', BUILDING_FILL_COLOR);
        map.setPaintProperty(LAYER_BUILDINGS, 'circle-radius', 7);
        map.setPaintProperty(LAYER_BUILDINGS, 'circle-opacity', 0.95);
        map.setPaintProperty(LAYER_BUILDINGS, 'circle-stroke-width', 1.5);
        map.setPaintProperty(LAYER_BUILDINGS, 'circle-stroke-color', '#ffffff');
    }
    if (map.getLayer(LAYER_HUBS)?.type === 'symbol') {
        map.setLayoutProperty(LAYER_HUBS, 'icon-image', hubIconImageMatch());
        map.setLayoutProperty(LAYER_HUBS, 'icon-size', 0.72);
        map.setLayoutProperty(LAYER_HUBS, 'icon-allow-overlap', true);
        map.setLayoutProperty(LAYER_HUBS, 'icon-ignore-placement', true);
    }
    if (map.getLayer(LAYER_HUBS_ISSUE)?.type === 'symbol') {
        map.setLayoutProperty(LAYER_HUBS_ISSUE, 'icon-image', HUB_ISSUE_ICON);
        map.setLayoutProperty(LAYER_HUBS_ISSUE, 'icon-size', 0.55);
        map.setLayoutProperty(LAYER_HUBS_ISSUE, 'icon-allow-overlap', true);
        map.setLayoutProperty(LAYER_HUBS_ISSUE, 'icon-ignore-placement', true);
    }
    if (map.getLayer(LAYER_SELECTED)) {
        map.setPaintProperty(LAYER_SELECTED, 'circle-radius', 12);
        map.setPaintProperty(LAYER_SELECTED, 'circle-color', 'transparent');
        map.setPaintProperty(LAYER_SELECTED, 'circle-opacity', 0);
        map.setPaintProperty(LAYER_SELECTED, 'circle-stroke-width', 3);
        map.setPaintProperty(LAYER_SELECTED, 'circle-stroke-color', ATLAS_SELECTED_COLOR);
        map.setPaintProperty(LAYER_SELECTED, 'circle-stroke-opacity', 1);
    }
}

/** @type {((e: any) => void) | null} */
let mapClickHandler = null;
/** @type {((e: any) => void) | null} */
let enterHandler = null;
/** @type {((e: any) => void) | null} */
let leaveHandler = null;
/** @type {any} */
let hoverPopup = null;
/** @type {import('maplibre-gl').Map | null} */
let interactionMap = null;

/**
 * Build a BroadcastChannel-safe Atlas map payload from the workspace snapshot.
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function buildAtlasMapPayload(snap) {
    const selectedId = snap.selection?.id || '';
    const selectedKind = snap.selection?.kind || '';
    const features = [];

    for (const hub of snap.hubs || []) {
        if (hub.lat == null || hub.lon == null) continue;
        const rollup = describeHubPing(hub.id, snap);
        const hubIp = normalizePingIp(hub.hubIp);
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [hub.lon, hub.lat] },
            properties: {
                atlasKind: 'hub',
                id: hub.id,
                hubCode: hub.hubCode || '',
                label: hub.aka || hub.name || hub.hubCode,
                hubIp,
                hasIp: hubIp ? 1 : 0,
                pingStatus: rollup.status,
                hubFillStatus: rollup.fillStatus,
                hubIssue: rollup.issue,
                selected: selectedKind === 'hub' && hub.id === selectedId ? 1 : 0
            }
        });
    }

    for (const drop of snap.drops || []) {
        if (drop.lat == null || drop.lon == null) continue;
        const hasIp = Boolean(normalizePingIp(drop.ip));
        const hasChannel = Boolean(drop.channelId && String(drop.channelId).trim());
        const ping = hasIp ? getPingEntry(snap.pingResults, drop.ip) : null;
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
                channelNumber: drop.channelNumber ?? '',
                dropNumber: drop.dropNumber ?? '',
                label: drop.inventoryName || `D${drop.dropNumber ?? '?'}`,
                ip: drop.ip || '',
                hasIp: hasIp ? 1 : 0,
                hasChannel: hasChannel ? 1 : 0,
                pingStatus: displayPingStatus(ping, { hasIp }),
                hubFillStatus: '',
                hubIssue: 0,
                selected
            }
        });
    }

    for (const building of snap.connectedBuildings || []) {
        if (building.lat == null || building.lon == null) continue;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [building.lon, building.lat] },
            properties: {
                atlasKind: 'building',
                id: building.id,
                label: building.buildingName || 'Building',
                address: building.address || '',
                fromHub: building.fromHub || '',
                toHub: building.toHub || '',
                status: building.status || '',
                hasIp: 0,
                pingStatus: '',
                hubFillStatus: '',
                hubIssue: 0,
                selected: selectedKind === 'building' && building.id === selectedId ? 1 : 0
            }
        });
    }

    let channelCoords = [];
    if (snap.selection?.kind === 'channel') {
        const drops = (snap.drops || [])
            .filter((d) => d.channelId === snap.selection.id && d.lat != null && d.lon != null)
            .sort((a, b) => (a.dropNumber ?? 9999) - (b.dropNumber ?? 9999));
        channelCoords = drops.map((d) => [d.lon, d.lat]);
    }

    const geometry = snap.areaResults?.geometry || null;
    const mapPingFilter = snap.prefs?.mapPingFilter || 'all';
    const dropFilter = atlasMapKindFilterExpression('drop', mapPingFilter);
    const hubFilter = atlasMapKindFilterExpression('hub', mapPingFilter);
    const buildingFilter = ['==', ['get', 'atlasKind'], 'building'];
    const hubIssueFilter = [
        'all',
        hubFilter,
        ['==', ['get', 'hubIssue'], 1]
    ];

    return {
        network: { type: 'FeatureCollection', features },
        channel: {
            type: 'FeatureCollection',
            features: channelCoords.length >= 2
                ? [{
                    type: 'Feature',
                    geometry: { type: 'LineString', coordinates: channelCoords },
                    properties: {}
                }]
                : []
        },
        area: {
            type: 'FeatureCollection',
            features: geometry
                ? [{ type: 'Feature', geometry, properties: {} }]
                : []
        },
        dropFilter,
        hubFilter,
        buildingFilter,
        hubIssueFilter
    };
}

/**
 * Apply channel path overlay to a MapLibre map.
 * @param {import('maplibre-gl').Map} map
 * @param {GeoJSON.FeatureCollection} lineFc
 */
function applyChannelPathToMap(map, lineFc) {
    const features = lineFc?.features || [];
    if (map.getSource(CHANNEL_SOURCE_ID)) {
        map.getSource(CHANNEL_SOURCE_ID).setData(lineFc);
        return;
    }
    if (features.length < 1) return;
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

/**
 * Apply area query overlay to a MapLibre map.
 * @param {import('maplibre-gl').Map} map
 * @param {GeoJSON.FeatureCollection} fc
 */
function applyAreaOverlayToMap(map, fc) {
    const hasGeometry = (fc?.features || []).length > 0;
    if (map.getSource(AREA_SOURCE_ID)) {
        map.getSource(AREA_SOURCE_ID).setData(fc);
        return;
    }
    if (!hasGeometry) return;
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

/**
 * Apply an Atlas map payload to any MapLibre map instance.
 * @param {import('maplibre-gl').Map} map
 * @param {ReturnType<typeof buildAtlasMapPayload>} payload
 */
export function applyAtlasMapToMap(map, payload) {
    if (!map || !map.getStyle?.() || !payload) return;

    const fc = payload.network || { type: 'FeatureCollection', features: [] };
    const dropFilter = payload.dropFilter || ['==', ['get', 'atlasKind'], 'drop'];
    const hubFilter = payload.hubFilter || ['==', ['get', 'atlasKind'], 'hub'];
    const buildingFilter = payload.buildingFilter || ['==', ['get', 'atlasKind'], 'building'];
    const hubIssueFilter = payload.hubIssueFilter || [
        'all',
        hubFilter,
        ['==', ['get', 'hubIssue'], 1]
    ];

    ensureAtlasHubSquareImages(map);
    removeLegacyHubCircleLayers(map);

    if (map.getSource(SOURCE_ID)) {
        map.getSource(SOURCE_ID).setData(fc);
    } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: fc });
        // Paint order (bottom → top): status halo → drops → buildings → hub squares → hub issue → selection
        map.addLayer({
            id: LAYER_STATUS,
            type: 'circle',
            source: SOURCE_ID,
            filter: dropFilter,
            paint: {
                'circle-radius': STATUS_RADIUS_MATCH,
                'circle-opacity': STATUS_OPACITY_MATCH,
                'circle-color': STATUS_COLOR_MATCH
            }
        });
        map.addLayer({
            id: LAYER_DROPS,
            type: 'circle',
            source: SOURCE_ID,
            filter: dropFilter,
            paint: {
                'circle-radius': DROP_CORE_RADIUS_MATCH,
                'circle-color': DROP_CORE_COLOR_MATCH,
                'circle-opacity': DROP_CORE_OPACITY_MATCH,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#ffffff'
            }
        });
        map.addLayer({
            id: LAYER_BUILDINGS,
            type: 'circle',
            source: SOURCE_ID,
            filter: buildingFilter,
            paint: {
                'circle-radius': 7,
                'circle-color': BUILDING_FILL_COLOR,
                'circle-opacity': 0.95,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff'
            }
        });
        map.addLayer({
            id: LAYER_HUBS,
            type: 'symbol',
            source: SOURCE_ID,
            filter: hubFilter,
            layout: {
                'icon-image': hubIconImageMatch(),
                'icon-size': 0.72,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
        map.addLayer({
            id: LAYER_HUBS_ISSUE,
            type: 'symbol',
            source: SOURCE_ID,
            filter: hubIssueFilter,
            layout: {
                'icon-image': HUB_ISSUE_ICON,
                'icon-size': 0.55,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        });
        map.addLayer({
            id: LAYER_SELECTED,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['get', 'selected'], 1],
            paint: {
                'circle-radius': 12,
                'circle-color': 'transparent',
                'circle-opacity': 0,
                'circle-stroke-width': 3,
                'circle-stroke-color': ATLAS_SELECTED_COLOR,
                'circle-stroke-opacity': 1
            }
        });
    }

    // Add buildings layer when migrating from older sessions
    if (map.getSource(SOURCE_ID) && !map.getLayer(LAYER_BUILDINGS)) {
        map.addLayer({
            id: LAYER_BUILDINGS,
            type: 'circle',
            source: SOURCE_ID,
            filter: buildingFilter,
            paint: {
                'circle-radius': 7,
                'circle-color': BUILDING_FILL_COLOR,
                'circle-opacity': 0.95,
                'circle-stroke-width': 1.5,
                'circle-stroke-color': '#ffffff'
            }
        }, map.getLayer(LAYER_HUBS) ? LAYER_HUBS : (map.getLayer(LAYER_SELECTED) ? LAYER_SELECTED : undefined));
    }

    // Add square hub layers when migrating from older circle sessions
    if (map.getSource(SOURCE_ID) && !map.getLayer(LAYER_HUBS)) {
        map.addLayer({
            id: LAYER_HUBS,
            type: 'symbol',
            source: SOURCE_ID,
            filter: hubFilter,
            layout: {
                'icon-image': hubIconImageMatch(),
                'icon-size': 0.72,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        }, map.getLayer(LAYER_SELECTED) ? LAYER_SELECTED : undefined);
    }
    if (map.getSource(SOURCE_ID) && !map.getLayer(LAYER_HUBS_ISSUE) && map.getLayer(LAYER_HUBS)) {
        map.addLayer({
            id: LAYER_HUBS_ISSUE,
            type: 'symbol',
            source: SOURCE_ID,
            filter: hubIssueFilter,
            layout: {
                'icon-image': HUB_ISSUE_ICON,
                'icon-size': 0.55,
                'icon-allow-overlap': true,
                'icon-ignore-placement': true
            }
        }, map.getLayer(LAYER_SELECTED) ? LAYER_SELECTED : undefined);
    }

    if (map.getLayer(LAYER_STATUS)) map.setFilter(LAYER_STATUS, dropFilter);
    if (map.getLayer(LAYER_DROPS)) map.setFilter(LAYER_DROPS, dropFilter);
    if (map.getLayer(LAYER_BUILDINGS)) map.setFilter(LAYER_BUILDINGS, buildingFilter);
    if (map.getLayer(LAYER_HUBS)) map.setFilter(LAYER_HUBS, hubFilter);
    if (map.getLayer(LAYER_HUBS_ISSUE)) map.setFilter(LAYER_HUBS_ISSUE, hubIssueFilter);
    applyAtlasLayerPaint(map);
    ensureAtlasLayerStack(map);

    applyChannelPathToMap(map, payload.channel || { type: 'FeatureCollection', features: [] });
    applyAreaOverlayToMap(map, payload.area || { type: 'FeatureCollection', features: [] });
}

/**
 * Remove Atlas sources/layers from a MapLibre map.
 * @param {import('maplibre-gl').Map} map
 */
export function clearAtlasMapFromMap(map) {
    if (!map) return;
    for (const id of [
        LAYER_AREA_LINE, LAYER_AREA_FILL, LAYER_CHANNEL_LINE,
        LAYER_SELECTED, LAYER_HUBS_ISSUE, LAYER_HUBS_LEGACY, LAYER_STATUS, LAYER_DROPS, LAYER_BUILDINGS, LAYER_HUBS
    ]) {
        if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [AREA_SOURCE_ID, CHANNEL_SOURCE_ID, SOURCE_ID]) {
        if (map.getSource(id)) map.removeSource(id);
    }
}

/**
 * @param {import('./types.js').AtlasSnapshot} snap
 */
export function syncAtlasMapLayers(snap) {
    const payload = buildAtlasMapPayload(snap);
    const map = mapService.getMap?.();
    // Always refresh the local map (primary). Dual-screen also mirrors to secondary.
    if (map?.getStyle?.()) {
        applyAtlasMapToMap(map, payload);
    }
    if (dualScreenCoordinator.isActive) {
        dualScreenCoordinator.broadcastMapCmd('atlasSync', { payload }, { focusMap: false });
    }
}

/**
 * @param {{ lat: number, lon: number }} center
 * @param {number} [zoom=14]
 */
export function flyToAtlasPoint(center, zoom = 14) {
    if (center?.lat == null || center?.lon == null) return;
    const lng = center.lon;
    const lat = center.lat;
    const pad = 0.00015;
    try {
        mapService.fitBounds?.(
            [[lng - pad, lat - pad], [lng + pad, lat + pad]],
            { padding: 60, maxZoom: zoom, duration: 800 }
        );
    } catch {
        /* ignore */
    }
}

/**
 * @param {Array<{ lat: number, lon: number }>} points
 */
export function fitAtlasPoints(points) {
    const valid = (points || []).filter((p) => p?.lat != null && p?.lon != null);
    if (!valid.length) return;
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
        mapService.fitBounds?.(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 60, maxZoom: 15, duration: 800 }
        );
    } catch {
        flyToAtlasPoint(valid[0], 12);
    }
}

function hideAtlasHoverPopup() {
    try {
        hoverPopup?.remove?.();
    } catch {
        /* ignore */
    }
    hoverPopup = null;
}

/**
 * @param {any} map
 * @param {any} feature
 */
function showAtlasHoverPopup(map, feature) {
    const ml = globalThis.maplibregl;
    if (!ml?.Popup || !feature?.geometry?.coordinates) return;
    const html = buildAtlasHoverHtml(feature.properties || {});
    if (!html) return;
    hideAtlasHoverPopup();
    hoverPopup = new ml.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14,
        maxWidth: '260px',
        className: 'atlas-hover-popup'
    })
        .setLngLat(feature.geometry.coordinates)
        .setHTML(html)
        .addTo(map);
}

/**
 * @param {(sel: { kind: 'hub'|'drop'|'building', id: string }) => void} onSelect
 * @param {import('maplibre-gl').Map} [mapOverride] secondary window passes its map
 * @param {() => void} [onEmptyClick] click on map with no Atlas feature (clear selection)
 */
export function enableAtlasMapInteraction(onSelect, mapOverride, onEmptyClick) {
    const map = mapOverride || mapService.getMap?.();
    if (!map) return;
    disableAtlasMapInteraction();
    interactionMap = map;

    const atlasPickAllowed = () => mapService.isSelectionMode?.() !== false;

    mapClickHandler = (e) => {
        // Skip while rectangle/polygon draw (or other map pick) is active.
        if (!atlasPickAllowed()) return;
        const layers = CLICK_LAYERS.filter((id) => map.getLayer(id));
        const feats = layers.length
            ? map.queryRenderedFeatures(e.point, { layers })
            : [];
        const hit = feats?.[0];
        if (hit?.properties?.id && hit.properties.atlasKind) {
            const raw = String(hit.properties.atlasKind);
            const kind = raw === 'hub' || raw === 'building' ? raw : 'drop';
            hideAtlasHoverPopup();
            onSelect?.({ kind, id: String(hit.properties.id) });
            return;
        }
        if (onEmptyClick) {
            hideAtlasHoverPopup();
            onEmptyClick();
        }
    };
    enterHandler = (e) => {
        if (!atlasPickAllowed()) return;
        map.getCanvas().style.cursor = 'pointer';
        const feat = e.features?.[0];
        if (feat) showAtlasHoverPopup(map, feat);
    };
    leaveHandler = () => {
        if (!atlasPickAllowed()) {
            hideAtlasHoverPopup();
            return;
        }
        map.getCanvas().style.cursor = '';
        hideAtlasHoverPopup();
    };

    map.on('click', mapClickHandler);
    for (const layer of CLICK_LAYERS) {
        if (!map.getLayer(layer)) continue;
        map.on('mouseenter', layer, enterHandler);
        map.on('mouseleave', layer, leaveHandler);
    }
}

export function disableAtlasMapInteraction() {
    hideAtlasHoverPopup();
    const map = interactionMap || mapService.getMap?.();
    if (!map) {
        mapClickHandler = null;
        enterHandler = null;
        leaveHandler = null;
        interactionMap = null;
        return;
    }
    if (mapClickHandler) map.off('click', mapClickHandler);
    for (const layer of CLICK_LAYERS) {
        if (!map.getLayer(layer)) continue;
        if (enterHandler) map.off('mouseenter', layer, enterHandler);
        if (leaveHandler) map.off('mouseleave', layer, leaveHandler);
    }
    try {
        map.getCanvas().style.cursor = '';
    } catch {
        /* ignore */
    }
    mapClickHandler = null;
    enterHandler = null;
    leaveHandler = null;
    interactionMap = null;
}

export function clearAtlasMapLayers() {
    disableAtlasMapInteraction();
    if (dualScreenCoordinator.isActive) {
        dualScreenCoordinator.broadcastMapCmd('atlasClear', {}, { focusMap: false });
        return;
    }
    clearAtlasMapFromMap(mapService.getMap?.());
}
