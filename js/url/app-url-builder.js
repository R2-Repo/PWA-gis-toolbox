import { DEFAULT_APP_CENTER, DEFAULT_APP_ZOOM } from './app-url-schema.js';

/**
 * @param {import('./app-url-schema.js').AppUrlConfig} config
 * @param {string} [baseUrl]
 */
export function buildAppUrl(config, baseUrl) {
    const params = new URLSearchParams();

    if (config.map) params.set('map', config.map);
    if (config.live?.length) params.set('live', config.live.join(','));

    if (config.basemap) params.set('basemap', config.basemap);
    if (config.dim) params.set('dim', config.dim);
    if (config.panel) params.set('panel', config.panel);

    if (config.bounds?.length === 4) {
        params.set('bounds', config.bounds.join(','));
        if (config.padding != null && config.padding !== 30) {
            params.set('padding', String(config.padding));
        }
    } else if (config.view) {
        const { zoom, center, pitch = 0, bearing = 0 } = config.view;
        if (pitch || bearing) {
            params.set('view', [zoom, center[0], center[1], pitch, bearing].join(','));
        } else {
            params.set('view', [zoom, center[0], center[1]].join(','));
        }
    }

    const query = params.toString();
    const origin = baseUrl
        || (typeof window !== 'undefined'
            ? `${window.location.origin}${window.location.pathname}`
            : '');

    return query ? `${origin}?${query}` : origin;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{ includeChrome?: boolean, mode?: 'center' | 'bounds' }} [options]
 * @returns {import('./app-url-schema.js').AppUrlConfig}
 */
export function captureAppUrlFromMap(map, options = {}) {
    const mode = options.mode || 'center';
    /** @type {import('./app-url-schema.js').AppUrlConfig} */
    const config = {};

    if (mode === 'bounds') {
        const bounds = map.getBounds();
        config.bounds = [
            bounds.getWest(),
            bounds.getSouth(),
            bounds.getEast(),
            bounds.getNorth()
        ];
        config.padding = 30;
    } else {
        const center = map.getCenter();
        config.view = {
            zoom: map.getZoom(),
            center: [center.lng, center.lat],
            pitch: map.getPitch(),
            bearing: map.getBearing()
        };
    }

    return config;
}

/**
 * MapLibre init options from app URL config (before map load).
 * @param {import('./app-url-schema.js').AppUrlConfig | null | undefined} config
 */
export function resolveAppUrlMapInit(config) {
    if (!config) {
        return {
            basemap: 'voyager',
            center: DEFAULT_APP_CENTER,
            zoom: DEFAULT_APP_ZOOM,
            pitch: 0,
            bearing: 0,
            enable3D: false,
            bounds: null,
            padding: 30
        };
    }

    const enable3D = config.dim === '3d';
    let center = DEFAULT_APP_CENTER;
    let zoom = DEFAULT_APP_ZOOM;
    let pitch = 0;
    let bearing = 0;

    if (config.view) {
        center = config.view.center;
        zoom = config.view.zoom;
        pitch = config.view.pitch ?? 0;
        bearing = config.view.bearing ?? 0;
    }

    return {
        basemap: config.basemap || 'voyager',
        center,
        zoom,
        pitch,
        bearing,
        enable3D,
        bounds: config.bounds || null,
        padding: config.padding ?? 30
    };
}

/**
 * Encode a custom service URL for the live= query param.
 * @param {string} url
 */
export function encodeLiveUrlEntry(url) {
    return `url:${encodeURIComponent(url.trim())}`;
}

/**
 * @param {string} entry
 * @returns {{ type: 'catalog', id: string } | { type: 'url', url: string }}
 */
export function parseLiveEntry(entry) {
    const trimmed = entry.trim();
    if (trimmed.startsWith('url:')) {
        return { type: 'url', url: decodeURIComponent(trimmed.slice(4)) };
    }
    return { type: 'catalog', id: trimmed };
}
