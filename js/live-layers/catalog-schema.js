import { LIVE_LAYERS } from './catalog.js';

/**
 * @typedef {'wms' | 'arcgis-mapserver' | 'arcgis-mapserver-vector' | 'arcgis-featureserver' | 'wfs' | 'geojson-feed' | 'firewatch'} ServiceKind
 */

/**
 * @typedef {object} LiveLayerServiceConfig
 * @property {string} id
 * @property {string} name
 * @property {ServiceKind} kind
 * @property {string} url
 * @property {string} [layers] - WMS LAYERS param
 * @property {Record<string, string>} [params]
 * @property {number} [refreshMs]
 * @property {number} [minZoom]
 * @property {number} [opacity]
 * @property {string} [attribution]
 * @property {object} [style]
 * @property {'perimeters' | 'incidents' | 'viirs' | 'modis' | 'noaa'} [firewatchPart]
 */

/**
 * @typedef {object} LiveLayerEntry
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} [icon]
 * @property {string} [category]
 * @property {string} [region]
 * @property {ServiceKind} [kind] - single-service entries
 * @property {string} [url] - single-service entries
 * @property {string} [layers] - WMS LAYERS param
 * @property {Record<string, string>} [params]
 * @property {number} [refreshMs]
 * @property {number} [minZoom]
 * @property {number} [opacity]
 * @property {string} [attribution]
 * @property {object} [style]
 * @property {boolean} [hidden] - omit from Import → Live Layers UI when true
 * @property {{ kind: 'password', hash: string }} [access] - client-side unlock (not real security)
 * @property {LiveLayerServiceConfig[]} [subLayers] - composite catalog entries
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
 * Expand a catalog entry into concrete service configs (1 for single, N for composite).
 * @param {LiveLayerEntry} entry
 * @returns {LiveLayerServiceConfig[]}
 */
export function expandCatalogEntry(entry) {
    if (!entry) return [];
    if (Array.isArray(entry.subLayers) && entry.subLayers.length) {
        return entry.subLayers.map((sub) => ({
            id: sub.id,
            name: sub.name,
            kind: sub.kind,
            url: sub.url,
            layers: sub.layers,
            params: sub.params,
            refreshMs: sub.refreshMs ?? entry.refreshMs,
            minZoom: sub.minZoom ?? entry.minZoom,
            opacity: sub.opacity ?? entry.opacity,
            attribution: sub.attribution ?? entry.attribution,
            style: sub.style,
            ...(sub.firewatchPart ? { firewatchPart: sub.firewatchPart } : {})
        }));
    }
    if (!entry.url || !entry.kind) return [];
    return [{
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        url: entry.url,
        layers: entry.layers,
        params: entry.params,
        refreshMs: entry.refreshMs,
        minZoom: entry.minZoom,
        opacity: entry.opacity,
        attribution: entry.attribution,
        style: entry.style
    }];
}

/**
 * @returns {string[]}
 */
export function validateCatalog() {
    const errors = [];
    const layerIds = new Set();
    const subLayerIds = new Set();

    for (const layer of LIVE_LAYERS) {
        if (layerIds.has(layer.id)) errors.push(`Duplicate live layer id: ${layer.id}`);
        layerIds.add(layer.id);

        const services = expandCatalogEntry(layer);
        if (!services.length) {
            errors.push(`Live layer ${layer.id} missing url/kind or subLayers`);
            continue;
        }

        const seenInEntry = new Set();
        for (const service of services) {
            if (!service.id) errors.push(`Live layer ${layer.id} has a sublayer without id`);
            if (!service.url) errors.push(`Live layer service ${service.id || layer.id} missing url`);
            if (!service.kind) errors.push(`Live layer service ${service.id || layer.id} missing kind`);
            if (!service.id) continue;

            if (seenInEntry.has(service.id)) {
                errors.push(`Duplicate live sublayer id within ${layer.id}: ${service.id}`);
            }
            seenInEntry.add(service.id);

            if (subLayerIds.has(service.id) && service.id !== layer.id) {
                errors.push(`Duplicate live sublayer id: ${service.id}`);
            }
            subLayerIds.add(service.id);
        }

        if (layer.access) {
            if (layer.access.kind !== 'password') {
                errors.push(`Live layer ${layer.id} has unknown access.kind`);
            } else if (!/^[a-f0-9]{64}$/i.test(String(layer.access.hash || ''))) {
                errors.push(`Live layer ${layer.id} password access needs a SHA-256 hex hash`);
            }
        }
    }
    return errors;
}

/**
 * Import UI list — curated live layers from catalog (excludes hidden entries).
 */
export function listCatalogLiveLayers() {
    return LIVE_LAYERS
        .filter((entry) => !entry.hidden)
        .map(({ id, name, description, category, region, icon, subLayers, access }) => ({
            id,
            name,
            description,
            category,
            region,
            icon,
            locked: access?.kind === 'password' && !!access.hash,
            subLayerCount: Array.isArray(subLayers) ? subLayers.length : 1
        }));
}

export function listLiveLayers() {
    return LIVE_LAYERS.flatMap((entry) => {
        return expandCatalogEntry(entry).map((service) => ({
            id: service.id,
            name: service.name,
            kind: service.kind,
            url: service.url,
            catalogId: entry.id
        }));
    });
}
