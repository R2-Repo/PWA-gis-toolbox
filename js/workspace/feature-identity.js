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
 * @returns {boolean} true for internal map/workspace props (not user fields)
 */
export function isInternalFeatureProp(key) {
    if (key === LGID_PROP) return true;
    return typeof key === 'string' && key.startsWith('_');
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
    buildDisplayIdentityProps
};
