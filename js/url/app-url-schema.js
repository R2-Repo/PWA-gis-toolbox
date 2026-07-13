import { getAllBasemapKeys } from '../map/basemap-catalog.js';

/** @typedef {import('../map/basemap-catalog.js').BasemapCategory} BasemapCategory */
/** @typedef {ReturnType<typeof getAllBasemapKeys>[number]} BasemapKey */
/** @typedef {'2d' | '3d'} DimensionMode */
/** @typedef {'both' | 'left' | 'right' | 'none'} PanelMode */

/**
 * @typedef {object} AppUrlView
 * @property {number} zoom
 * @property {[number, number]} center - [lng, lat]
 * @property {number} [pitch]
 * @property {number} [bearing]
 */

/**
 * @typedef {object} AppUrlConfig
 * @property {BasemapKey} [basemap]
 * @property {DimensionMode} [dim]
 * @property {PanelMode} [panel]
 * @property {AppUrlView} [view]
 * @property {[number, number, number, number]} [bounds] - west, south, east, north
 * @property {number} [padding]
 * @property {string} [map] - prebuilt preset id
 * @property {string[]} [live] - catalog layer ids or url: entries
 */

export const BASEMAP_KEYS = getAllBasemapKeys();
export const DIMENSION_MODES = ['2d', '3d'];
export const PANEL_MODES = ['both', 'left', 'right', 'none'];

export const APP_URL_PARAM_KEYS = [
    'view',
    'bounds',
    'lng',
    'lat',
    'zoom',
    'pitch',
    'bearing',
    'heading',
    'padding',
    'basemap',
    'dim',
    '3d',
    'panel',
    'map',
    'live'
];

export const DEFAULT_APP_CENTER = [-111.09, 39.32];
export const DEFAULT_APP_ZOOM = 7;
export const DEFAULT_BOUNDS_PADDING = 30;

/**
 * @param {unknown} value
 * @returns {BasemapKey}
 */
export function normalizeBasemapKey(value) {
    const key = String(value || '').toLowerCase();
    return BASEMAP_KEYS.includes(key) ? /** @type {BasemapKey} */ (key) : 'voyager';
}

/**
 * @param {unknown} value
 * @returns {DimensionMode | undefined}
 */
export function normalizeDimension(value) {
    if (value === '3d' || value === '2d') return value;
    if (value === '1' || value === 'true') return '3d';
    if (value === '0' || value === 'false') return '2d';
    return undefined;
}

/**
 * @param {unknown} value
 * @returns {PanelMode | undefined}
 */
export function normalizePanelMode(value) {
    const mode = String(value || '').toLowerCase();
    return PANEL_MODES.includes(mode) ? /** @type {PanelMode} */ (mode) : undefined;
}

/**
 * @param {number[]} nums
 * @param {number} count
 */
function takeNumbers(nums, count) {
    const out = nums.slice(0, count).filter((n) => Number.isFinite(n));
    return out.length === count ? out : null;
}

/**
 * @param {string | null | undefined} raw
 * @returns {AppUrlView | null}
 */
export function parseViewParam(raw) {
    if (!raw) return null;
    const parts = raw.split(',').map((p) => Number.parseFloat(p.trim()));
    const basic = takeNumbers(parts, 3);
    if (!basic) return null;
    const full = takeNumbers(parts, 5);
    return {
        zoom: basic[0],
        center: [basic[1], basic[2]],
        pitch: full ? full[3] : 0,
        bearing: full ? full[4] : 0
    };
}

/**
 * @param {string | null | undefined} raw
 * @returns {[number, number, number, number] | null}
 */
export function parseBoundsParam(raw) {
    if (!raw) return null;
    const parts = raw.split(',').map((p) => Number.parseFloat(p.trim()));
    const nums = takeNumbers(parts, 4);
    return nums ? /** @type {[number, number, number, number]} */ (nums) : null;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
export function parseLiveParam(raw) {
    if (!raw) return [];
    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

/**
 * Merge discrete camera params into a view object when present.
 * @param {AppUrlConfig} config
 * @param {Record<string, string>} params
 */
export function applyDiscreteCameraParams(config, params) {
    const lng = Number.parseFloat(params.lng);
    const lat = Number.parseFloat(params.lat);
    const zoom = Number.parseFloat(params.zoom);
    const pitch = Number.parseFloat(params.pitch);
    const bearing = Number.parseFloat(params.bearing ?? params.heading);

    if (!config.view && Number.isFinite(lng) && Number.isFinite(lat)) {
        config.view = {
            center: [lng, lat],
            zoom: Number.isFinite(zoom) ? zoom : DEFAULT_APP_ZOOM,
            pitch: Number.isFinite(pitch) ? pitch : 0,
            bearing: Number.isFinite(bearing) ? bearing : 0
        };
    } else if (config.view) {
        if (Number.isFinite(zoom)) config.view.zoom = zoom;
        if (Number.isFinite(pitch)) config.view.pitch = pitch;
        if (Number.isFinite(bearing)) config.view.bearing = bearing;
    }
}

/**
 * @param {AppUrlConfig} config
 * @returns {AppUrlConfig}
 */
export function validateAppUrlConfig(config) {
    const out = { ...config };
    if (out.basemap) out.basemap = normalizeBasemapKey(out.basemap);
    if (out.dim) {
        const dim = normalizeDimension(out.dim);
        if (dim) out.dim = dim;
        else delete out.dim;
    }
    if (out.panel) {
        const panel = normalizePanelMode(out.panel);
        if (panel) out.panel = panel;
        else delete out.panel;
    }
    if (out.padding != null && !Number.isFinite(out.padding)) delete out.padding;
    return out;
}
