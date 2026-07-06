import { LIVE_LAYERS, LIVE_MAP_PRESETS } from './catalog.js';
import { encodeLiveUrlEntry } from '../url/app-url-builder.js';

/**
 * @typedef {'wms' | 'arcgis-mapserver' | 'arcgis-featureserver' | 'wfs' | 'geojson-feed'} ServiceKind
 */

/**
 * @typedef {object} LiveLayerEntry
 * @property {string} id
 * @property {string} name
 * @property {ServiceKind} kind
 * @property {string} url
 * @property {string} [layers] - WMS LAYERS param
 * @property {Record<string, string>} [params]
 * @property {number} [refreshMs]
 * @property {number} [opacity]
 * @property {string} [attribution]
 * @property {object} [style]
 */

/**
 * @typedef {object} LiveMapPreset
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [region]
 * @property {string} [category]
 * @property {Array<string | { name: string, url: string, kind?: ServiceKind }>} layers
 * @property {'voyager' | 'satellite'} [basemap]
 * @property {'2d' | '3d'} [dim]
 * @property {'both' | 'left' | 'right' | 'none'} [panel]
 * @property {{ center: [number, number], zoom: number, pitch?: number, bearing?: number } | { bounds: [number, number, number, number], padding?: number }} [viewport]
 */

/**
 * @param {string} url
 * @returns {ServiceKind | null}
 */
export function inferServiceKind(url) {
    const lower = String(url || '').toLowerCase().split('?')[0];
    if (!lower) return null;
    if (lower.includes('/featureserver')) return 'arcgis-featureserver';
    if (lower.includes('/mapserver')) return 'arcgis-mapserver';
    if (lower.includes('service=wms') || lower.includes('/wms')) return 'wms';
    if (lower.includes('service=wfs') || lower.includes('/wfs')) return 'wfs';
    if (lower.endsWith('.geojson') || lower.includes('format=geojson') || lower.includes('/geojson')) {
        return 'geojson-feed';
    }
    if (lower.includes('earthquake') || lower.includes('geojson')) return 'geojson-feed';
    return null;
}

/**
 * @param {string} id
 * @returns {LiveLayerEntry | null}
 */
export function resolveLiveLayer(id) {
    return LIVE_LAYERS.find((entry) => entry.id === id) || null;
}

/**
 * @param {string} id
 * @returns {import('../url/app-url-schema.js').AppUrlConfig | null}
 */
export function resolveMapPreset(id) {
    const preset = LIVE_MAP_PRESETS.find((entry) => entry.id === id);
    if (!preset) return null;
    return presetToAppUrlConfig(preset);
}

/**
 * @param {LiveMapPreset} preset
 */
export function presetToAppUrlConfig(preset) {
    /** @type {import('../url/app-url-schema.js').AppUrlConfig} */
    const config = {
        map: preset.id,
        basemap: preset.basemap,
        dim: preset.dim,
        panel: preset.panel,
        live: (preset.layers || []).map((layer) => {
            if (typeof layer === 'string') return layer;
            return encodeLiveUrlEntry(layer.url);
        })
    };

    if (preset.viewport && 'bounds' in preset.viewport) {
        config.bounds = preset.viewport.bounds;
        config.padding = preset.viewport.padding ?? 30;
    } else if (preset.viewport && 'center' in preset.viewport) {
        config.view = {
            center: preset.viewport.center,
            zoom: preset.viewport.zoom,
            pitch: preset.viewport.pitch ?? 0,
            bearing: preset.viewport.bearing ?? 0
        };
    }

    return config;
}

/**
 * @param {import('../url/app-url-schema.js').AppUrlConfig} config
 * @param {{ name?: string, description?: string, category?: string }} meta
 */
export function appUrlConfigToCatalogPreset(config, meta = {}) {
    const layers = (config.live || []).map((entry) => {
        if (entry.startsWith('url:')) {
            const url = decodeURIComponent(entry.slice(4));
            return { name: url.split('/').pop() || 'Custom Layer', url };
        }
        return entry;
    });

    const preset = {
        id: meta.name?.toLowerCase().replace(/\s+/g, '-') || 'custom-preset',
        name: meta.name || 'Custom Preset',
        description: meta.description || '',
        category: meta.category || 'Custom',
        layers,
        basemap: config.basemap || 'voyager',
        dim: config.dim || '2d',
        panel: config.panel || 'both'
    };

    if (config.bounds) {
        preset.viewport = { bounds: config.bounds, padding: config.padding ?? 30 };
    } else if (config.view) {
        preset.viewport = {
            center: config.view.center,
            zoom: config.view.zoom,
            pitch: config.view.pitch ?? 0,
            bearing: config.view.bearing ?? 0
        };
    }

    return preset;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {import('../url/app-url-schema.js').AppUrlConfig} [chrome]
 */
export function captureAppUrlFromMapWithChrome(map, chrome = {}) {
    const center = map.getCenter();
    return {
        basemap: chrome.basemap,
        dim: chrome.dim,
        panel: chrome.panel,
        view: {
            zoom: map.getZoom(),
            center: [center.lng, center.lat],
            pitch: map.getPitch(),
            bearing: map.getBearing()
        },
        live: chrome.live || []
    };
}

/**
 * @returns {string[]}
 */
export function validateCatalog() {
    const errors = [];
    const layerIds = new Set();
    for (const layer of LIVE_LAYERS) {
        if (layerIds.has(layer.id)) errors.push(`Duplicate live layer id: ${layer.id}`);
        layerIds.add(layer.id);
        if (!layer.url) errors.push(`Live layer ${layer.id} missing url`);
        if (!layer.kind) errors.push(`Live layer ${layer.id} missing kind`);
    }

    const presetIds = new Set();
    for (const preset of LIVE_MAP_PRESETS) {
        if (presetIds.has(preset.id)) errors.push(`Duplicate preset id: ${preset.id}`);
        presetIds.add(preset.id);
        for (const layerRef of preset.layers || []) {
            const id = typeof layerRef === 'string' ? layerRef : null;
            if (id && !resolveLiveLayer(id)) {
                errors.push(`Preset ${preset.id} references unknown layer: ${id}`);
            }
        }
    }

    return errors;
}

export function listLiveMapPresets() {
    return LIVE_MAP_PRESETS.map(({ id, name, description, category, region, icon }) => ({
        id, name, description, category, region, icon
    }));
}

export function listLiveLayers() {
    return LIVE_LAYERS.map(({ id, name, kind, url }) => ({ id, name, kind, url }));
}
