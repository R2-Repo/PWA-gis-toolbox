import { LIVE_LAYERS } from './catalog.js';

/**
 * @typedef {'wms' | 'arcgis-mapserver' | 'arcgis-featureserver' | 'wfs' | 'geojson-feed'} ServiceKind
 */

/**
 * @typedef {object} LiveLayerEntry
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [icon]
 * @property {string} [category]
 * @property {string} [region]
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
    return errors;
}

/**
 * Import UI list — curated live layers from catalog.
 */
export function listCatalogLiveLayers() {
    return LIVE_LAYERS.map(({ id, name, description, category, region, icon }) => ({
        id,
        name,
        description,
        category,
        region,
        icon
    }));
}

export function listLiveLayers() {
    return LIVE_LAYERS.map(({ id, name, kind, url }) => ({ id, name, kind, url }));
}
