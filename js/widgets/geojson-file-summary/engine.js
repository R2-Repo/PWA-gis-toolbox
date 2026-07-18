/**
 * Pure helpers for the desktop GeoJSON File Summary widget.
 * Native summarization runs via ctx.services.compute — not here.
 */

export const WIDGET_ID = 'geojson-file-summary';

export const GEOJSON_FILE_FILTERS = Object.freeze([
    {
        name: 'GeoJSON',
        extensions: ['geojson', 'json']
    }
]);

/**
 * @param {string} [path]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function validateGeoJsonPath(path) {
    if (!path || typeof path !== 'string' || !path.trim()) {
        return { ok: false, error: 'Choose a GeoJSON file to summarize.' };
    }
    const lower = path.trim().toLowerCase();
    if (!(lower.endsWith('.geojson') || lower.endsWith('.json'))) {
        return { ok: false, error: 'File must be a .geojson or .json GeoJSON document.' };
    }
    return { ok: true };
}

/**
 * Normalize sidecar output for the dialog.
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
 * @param {string} path
 * @returns {string}
 */
export function basenameFromPath(path) {
    if (!path) return '';
    const parts = String(path).split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || path;
}
