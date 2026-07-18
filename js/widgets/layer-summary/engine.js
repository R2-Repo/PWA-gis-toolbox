/**
 * Pure Layer Summary helpers.
 * Web always uses summarizeFeatureCollection().
 * Windows may optionally accelerate large layers via the Python sidecar.
 */

import {
    formatByteSize,
    formatSummaryResult
} from '../geojson-file-summary/engine.js';

export const WIDGET_ID = 'layer-summary';

/** Prefer Python sidecar at/above this feature count when available. */
export const PYTHON_ACCEL_MIN_FEATURES = 2500;

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
 * JavaScript provider — mirrors sidecar summarize_geojson semantics for in-memory layers.
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
 * @param {number} featureCount
 * @param {boolean} pythonAvailable
 * @param {boolean} [preferPython]
 * @returns {'javascript' | 'python'}
 */
export function chooseSummaryProvider(featureCount, pythonAvailable, preferPython = true) {
    if (
        preferPython &&
        pythonAvailable &&
        Number(featureCount) >= PYTHON_ACCEL_MIN_FEATURES
    ) {
        return 'python';
    }
    return 'javascript';
}

/**
 * @param {'javascript' | 'python'} provider
 * @returns {string}
 */
export function providerLabel(provider) {
    if (provider === 'python') return 'Python (accelerated)';
    return 'JavaScript';
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

export { formatByteSize, formatSummaryResult };
