import {
    applyDiscreteCameraParams,
    normalizeBasemapKey,
    normalizeDimension,
    normalizePanelMode,
    parseBoundsParam,
    parseLiveParam,
    parseViewParam,
    validateAppUrlConfig,
    DEFAULT_BOUNDS_PADDING
} from './app-url-schema.js';

/**
 * @param {string} [search]
 * @returns {import('./app-url-schema.js').AppUrlConfig}
 */
export function parseAppUrl(search = typeof window !== 'undefined' ? window.location.search : '') {
    const params = new URLSearchParams(search);
    /** @type {import('./app-url-schema.js').AppUrlConfig} */
    const config = {};

    const basemap = params.get('basemap');
    if (basemap) config.basemap = normalizeBasemapKey(basemap);

    const dim = params.get('dim') ?? params.get('3d');
    const normalizedDim = normalizeDimension(dim);
    if (normalizedDim) config.dim = normalizedDim;

    const panel = params.get('panel');
    const normalizedPanel = normalizePanelMode(panel);
    if (normalizedPanel) config.panel = normalizedPanel;

    const mapPreset = params.get('map');
    if (mapPreset) config.map = mapPreset.trim();

    const live = parseLiveParam(params.get('live'));
    if (live.length) config.live = live;

    const bounds = parseBoundsParam(params.get('bounds'));
    if (bounds) config.bounds = bounds;

    const padding = Number.parseFloat(params.get('padding') || '');
    if (Number.isFinite(padding)) config.padding = padding;
    else if (bounds) config.padding = DEFAULT_BOUNDS_PADDING;

    const view = parseViewParam(params.get('view'));
    if (view) config.view = view;

    applyDiscreteCameraParams(config, Object.fromEntries(params.entries()));

    return validateAppUrlConfig(config);
}

/**
 * @param {import('./app-url-schema.js').AppUrlConfig} config
 */
export function hasRecognizedAppUrlConfig(config) {
    if (!config || typeof config !== 'object') return false;
    return Boolean(
        config.basemap
        || config.dim
        || config.panel
        || config.map
        || (config.live && config.live.length)
        || config.view
        || config.bounds
    );
}
