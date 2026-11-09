/**
 * Session graphics for Line of Site: observer and target dots, labels, and the
 * ground-track preview. Stable source and layer ids so close can remove them
 * on the map that owns the scene, including through the dual-screen bridge.
 * Labels use the app's local glyph stack. This module does not set a glyph URL.
 */
import { LOCAL_GLYPH_FONT_STACK } from '../../map/local-glyphs.js';

export const LINE_OF_SITE_OVERLAY_SOURCE_ID = 'gis-line-of-site-overlay';

export const LOS_DOT_FILL = '#ff2bd6';
export const LOS_DOT_RING = '#ffffff';
export const LOS_DOT_OUTLINE = '#111111';
export const LOS_DOT_FILL_RADIUS = 6;
export const LOS_DOT_RING_RADIUS = 10;
export const LOS_DOT_OUTLINE_RADIUS = 13;

const LINE_CASING_ID = 'gis-line-of-site-overlay-line-casing';
const LINE_ID = 'gis-line-of-site-overlay-line';
const OBSTRUCTION_ID = 'gis-line-of-site-overlay-obstruction';
const OUTLINE_ID = 'gis-line-of-site-overlay-outline';
const RING_ID = 'gis-line-of-site-overlay-ring';
const DOT_ID = 'gis-line-of-site-overlay-dot';
const LABEL_ID = 'gis-line-of-site-overlay-label';

export const LINE_OF_SITE_OVERLAY_LAYER_IDS = [
    LINE_CASING_ID,
    LINE_ID,
    OBSTRUCTION_ID,
    OUTLINE_ID,
    RING_ID,
    DOT_ID,
    LABEL_ID
];

const ENDPOINT_FILTER = ['in', ['get', 'kind'], ['literal', ['observer', 'target']]];
const LINE_FILTER = ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]];

function overlayReady(map) {
    if (typeof map.getSource !== 'function' || !map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)) return false;
    if (typeof map.getLayer !== 'function') return false;
    return LINE_OF_SITE_OVERLAY_LAYER_IDS.every((id) => map.getLayer(id));
}

function overlayLayers() {
    return [
        {
            id: LINE_CASING_ID,
            type: 'line',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: LINE_FILTER,
            paint: { 'line-color': LOS_DOT_OUTLINE, 'line-width': 5 }
        },
        {
            id: LINE_ID,
            type: 'line',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: LINE_FILTER,
            paint: { 'line-color': '#d4a24e', 'line-width': 3 }
        },
        {
            id: OBSTRUCTION_ID,
            type: 'circle',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'obstruction'],
            paint: {
                'circle-radius': 6,
                'circle-color': '#ff2d1a',
                'circle-stroke-color': LOS_DOT_RING,
                'circle-stroke-width': 2,
                'circle-pitch-alignment': 'viewport'
            }
        },
        {
            id: OUTLINE_ID,
            type: 'circle',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: ENDPOINT_FILTER,
            paint: {
                'circle-radius': LOS_DOT_OUTLINE_RADIUS,
                'circle-color': LOS_DOT_OUTLINE,
                'circle-pitch-alignment': 'viewport'
            }
        },
        {
            id: RING_ID,
            type: 'circle',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: ENDPOINT_FILTER,
            paint: {
                'circle-radius': LOS_DOT_RING_RADIUS,
                'circle-color': LOS_DOT_RING,
                'circle-pitch-alignment': 'viewport'
            }
        },
        {
            id: DOT_ID,
            type: 'circle',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: ENDPOINT_FILTER,
            paint: {
                'circle-radius': LOS_DOT_FILL_RADIUS,
                'circle-color': LOS_DOT_FILL,
                'circle-pitch-alignment': 'viewport'
            }
        },
        {
            id: LABEL_ID,
            type: 'symbol',
            source: LINE_OF_SITE_OVERLAY_SOURCE_ID,
            filter: ENDPOINT_FILTER,
            layout: {
                'text-field': ['get', 'label'],
                'text-font': [...LOCAL_GLYPH_FONT_STACK],
                'text-size': 13,
                'text-anchor': 'bottom',
                'text-offset': [0, -0.85],
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-pitch-alignment': 'viewport',
                'text-rotation-alignment': 'viewport'
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': LOS_DOT_OUTLINE,
                'text-halo-width': 2
            }
        }
    ];
}

/**
 * @param {object | null | undefined} map
 * @param {{ type?: string, features?: object[] } | null | undefined} geojson
 */
export function syncLineOfSiteOverlay(map, geojson) {
    if (!map || typeof map.addSource !== 'function') return;
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    if (!features.length) {
        removeLineOfSiteOverlay(map);
        return;
    }
    const data = { type: 'FeatureCollection', features };
    if (overlayReady(map)) {
        map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID).setData?.(data);
        return;
    }
    removeLineOfSiteOverlay(map);
    try {
        map.addSource(LINE_OF_SITE_OVERLAY_SOURCE_ID, { type: 'geojson', data });
    } catch {
        return;
    }
    for (const layer of overlayLayers()) {
        try {
            map.addLayer(layer);
        } catch {
            /* style rejected one layer; remove still clears the ids that landed */
        }
    }
}

/** @param {object | null | undefined} map */
export function removeLineOfSiteOverlay(map) {
    if (!map) return;
    if (typeof map.getLayer === 'function' && typeof map.removeLayer === 'function') {
        for (const id of LINE_OF_SITE_OVERLAY_LAYER_IDS) {
            if (!map.getLayer(id)) continue;
            try {
                map.removeLayer(id);
            } catch {
                /* style no longer has this layer */
            }
        }
    }
    if (typeof map.getSource === 'function' && map.getSource(LINE_OF_SITE_OVERLAY_SOURCE_ID)) {
        try {
            map.removeSource(LINE_OF_SITE_OVERLAY_SOURCE_ID);
        } catch {
            /* style no longer has this source */
        }
    }
}
