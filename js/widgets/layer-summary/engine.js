/**
 * Pure Layer Summary helpers.
 * Web always uses summarizeFeatureCollection().
 */

export const WIDGET_ID = 'layer-summary';

/**
 * @param {object} [geojson]
 * @returns {{ ok: true, featureCount: number } | { ok: false, error: string }}
 */
export function validateLayerGeoJson(geojson) {
    if (!geojson || typeof geojson !== 'object') {
        return { ok: false, error: 'Select a layer with features to summarize.' };
    }
    const features = extractFeatures(geojson);
    if (!features.length) {
        return { ok: false, error: 'Selected layer has no features.' };
    }
    return { ok: true, featureCount: features.length };
}

/**
 * @param {object} geojson
 * @returns {object[]}
 */
export function extractFeatures(geojson) {
    if (!geojson || typeof geojson !== 'object') return [];
    if (geojson.type === 'FeatureCollection' && Array.isArray(geojson.features)) {
        return geojson.features;
    }
    if (geojson.type === 'Feature') return [geojson];
    if (geojson.type && geojson.coordinates) {
        return [{ type: 'Feature', geometry: geojson, properties: {} }];
    }
    return [];
}

/**
 * Summarize an in-memory GeoJSON FeatureCollection.
 * @param {object} geojson
 * @param {{ layerName?: string }} [opts]
 * @returns {object}
 */
export function summarizeFeatureCollection(geojson, opts = {}) {
    const features = extractFeatures(geojson);
    const geometryTypes = {};
    const propertyKeys = new Set();

    for (const feature of features) {
        if (!feature || typeof feature !== 'object') continue;
        const geomType = feature.geometry?.type || 'null';
        geometryTypes[geomType] = (geometryTypes[geomType] || 0) + 1;
        const props = feature.properties;
        if (props && typeof props === 'object') {
            Object.keys(props).forEach((key) => propertyKeys.add(String(key)));
        }
    }

    const rootType = geojson?.type || 'FeatureCollection';
    const approxBytes = roughUtf8Size(geojson);

    return formatSummaryResult({
        path: opts.layerName ? `layer:${opts.layerName}` : '',
        rootType,
        featureCount: features.length,
        geometryTypes,
        propertyKeys: [...propertyKeys].sort(),
        byteSize: approxBytes
    });
}

/**
 * Normalize summary output for the dialog.
 * @param {object} [raw]
 * @returns {object}
 */
export function formatSummaryResult(raw = {}) {
    const geometryTypes = raw.geometryTypes && typeof raw.geometryTypes === 'object'
        ? raw.geometryTypes
        : {};
    const propertyKeys = Array.isArray(raw.propertyKeys) ? raw.propertyKeys : [];

    return {
        path: String(raw.path || ''),
        rootType: raw.rootType || 'unknown',
        featureCount: Number(raw.featureCount) || 0,
        geometryTypes,
        propertyKeys,
        byteSize: Number(raw.byteSize) || 0,
        geometryTypeEntries: Object.entries(geometryTypes)
            .map(([type, count]) => ({ type, count: Number(count) || 0 }))
            .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    };
}

/**
 * @param {number} bytes
 * @returns {string}
 */
export function formatByteSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function roughUtf8Size(value) {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
        return 0;
    }
}
