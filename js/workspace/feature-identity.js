/**
 * Stable feature identity for workspace-backed layers.
 *
 * `__lgid` is assigned once at import and links IndexedDB attribute records,
 * map/tile display properties, edit sessions, and export restoration.
 * Positional `_featureIndex` remains for MapLibre selection/tiles.
 */

export const LGID_PROP = '__lgid';

/**
 * @returns {string}
 */
export function createLgid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLgid(value) {
    return typeof value === 'string' && value.length > 0;
}

/**
 * Reuse an existing `__lgid` on the feature when present; otherwise mint one.
 * @param {object|null|undefined} feature
 * @returns {string}
 */
export function ensureFeatureLgid(feature) {
    const existing = feature?.properties?.[LGID_PROP];
    if (isLgid(existing)) return existing;
    return createLgid();
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isArcgisPictureMarkerProp(key) {
    return key === '_udotGlyph' || key === '_udotEsriWidth';
}

/**
 * @param {string} key
 * @returns {boolean} true for internal map/workspace props (not user fields)
 */
export function isInternalFeatureProp(key) {
    if (key === LGID_PROP) return true;
    if (isArcgisPictureMarkerProp(key)) return false;
    return typeof key === 'string' && key.startsWith('_');
}

/**
 * Identity index assigned once at storage time.
 * Rendering must not replace this with a batch or array position.
 * @param {object|null|undefined} feature
 * @returns {number|null}
 */
export function readStoredFeatureIndex(feature) {
    const raw = feature?.properties?._featureIndex ?? feature?.__featureIndex;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

/**
 * Index to stamp while rendering. Keeps a stored identity; otherwise the
 * position in the collection being drawn.
 * @param {object|null|undefined} feature
 * @param {number} fallbackIndex
 * @returns {number}
 */
export function renderFeatureIndex(feature, fallbackIndex) {
    const stored = readStoredFeatureIndex(feature);
    return stored == null ? fallbackIndex : stored;
}

/**
 * @param {object|null|undefined} feature
 * @param {Set<number>|null|undefined} allowlist null = no filter
 * @returns {boolean}
 */
export function featurePassesIndexAllowlist(feature, allowlist) {
    if (allowlist == null) return true;
    const idx = readStoredFeatureIndex(feature);
    return idx != null && allowlist.has(idx);
}

/**
 * Find a rendered feature by its identity index.
 * Positional fallback is only safe when that slot has no different stored index
 * (in-memory layers). Workspace batches are not indexed by storage identity.
 * @param {object[]|null|undefined} features
 * @param {number} featureIndex
 * @param {{ allowPositionalFallback?: boolean }} [options]
 * @returns {object|null}
 */
export function lookupRenderedFeature(features, featureIndex, { allowPositionalFallback = true } = {}) {
    if (!Array.isArray(features)) return null;
    const idx = typeof featureIndex === 'number' ? featureIndex : Number(featureIndex);
    if (!Number.isFinite(idx)) return null;
    const found = features.find((f) => readStoredFeatureIndex(f) === idx);
    if (found) return found;
    if (!allowPositionalFallback || !Number.isInteger(idx) || idx < 0 || idx >= features.length) {
        return null;
    }
    const positional = features[idx];
    if (!positional) return null;
    const stored = readStoredFeatureIndex(positional);
    if (stored != null && stored !== idx) return null;
    return positional;
}

/**
 * Stamp display identity props used by map/tiles.
 * Copies only `displayFields` (style/label) plus a name hint — not all attrs.
 * @param {object} params
 * @param {string} params.lgid
 * @param {string} params.layerId
 * @param {number} params.featureIndex
 * @param {object} [params.properties]
 * @param {string[]|null|undefined} [params.displayFields]
 */
export function buildDisplayIdentityProps({
    lgid,
    layerId,
    featureIndex,
    properties = {},
    displayFields = null
}) {
    const fid = `${layerId}:f:${featureIndex}`;
    const out = {
        _featureIndex: featureIndex,
        _datasetId: layerId,
        _featureId: fid,
        [LGID_PROP]: lgid,
        name: properties?.name ?? properties?.Name ?? null
    };
    if (properties._udotGlyph != null) out._udotGlyph = properties._udotGlyph;
    if (properties._udotEsriWidth != null) out._udotEsriWidth = properties._udotEsriWidth;
    if (!displayFields?.length) return out;
    for (const field of displayFields) {
        if (!field || isInternalFeatureProp(field)) continue;
        if (!Object.prototype.hasOwnProperty.call(properties, field)) continue;
        out[field] = properties[field];
    }
    return out;
}

export default {
    LGID_PROP,
    createLgid,
    isLgid,
    ensureFeatureLgid,
    isInternalFeatureProp,
    readStoredFeatureIndex,
    renderFeatureIndex,
    featurePassesIndexAllowlist,
    lookupRenderedFeature,
    buildDisplayIdentityProps
};
