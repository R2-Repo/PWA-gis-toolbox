/**
 * Viewport / map hide lists for UDOT Fiber live layers.
 * Exact match after trim — does not delete imported project data.
 */

export const UDOT_BOXES_EXCLUDE_FIELD = 'DT_RSCENCLOSURE_NAME';

/** Enclosure names that should not draw on UDOT Boxes. */
export const UDOT_BOXES_EXCLUDE_VALUES = Object.freeze([
    'POE',
    'Pole',
    'CCTV',
    'Node',
    'Power Source',
    'Power Meter',
    'RWIS',
    'Radio (Master)',
    'Radio (Slave)',
    'Ramp Meter',
    'NID',
    'VMS Over-Head',
    'VMS Road-Side',
    'VSL Road-Side',
    'Transformer on Pole',
    'UDOT Sign',
    'ETC Gantry'
]);

const BOXES_EXCLUDE_SET = new Set(
    UDOT_BOXES_EXCLUDE_VALUES.map((value) => String(value).trim())
);

/**
 * @param {string} [layerKey]
 * @returns {{ field: string, values: readonly string[] }|null}
 */
export function getUdotFiberDisplayFilter(layerKey) {
    if (layerKey === 'boxes') {
        return { field: UDOT_BOXES_EXCLUDE_FIELD, values: UDOT_BOXES_EXCLUDE_VALUES };
    }
    return null;
}

/**
 * @param {string} [layerKey]
 * @param {Record<string, unknown>} [props]
 */
export function isUdotFiberFeatureExcluded(layerKey, props = {}) {
    const spec = getUdotFiberDisplayFilter(layerKey);
    if (!spec) return false;
    return BOXES_EXCLUDE_SET.has(String(props[spec.field] ?? '').trim());
}

/**
 * @param {string} [layerKey]
 * @param {object[]} [features]
 */
export function filterUdotFiberDisplayFeatures(layerKey, features) {
    if (!getUdotFiberDisplayFilter(layerKey) || !features?.length) return features || [];
    return features.filter((feature) => !isUdotFiberFeatureExcluded(layerKey, feature.properties));
}

/**
 * ArcGIS query `where` that skips excluded class values.
 * @param {string} [layerKey]
 */
export function buildUdotFiberExcludeWhere(layerKey) {
    const spec = getUdotFiberDisplayFilter(layerKey);
    if (!spec?.values?.length) return '1=1';
    const quoted = [...new Set(spec.values.map((value) => {
        const escaped = String(value).trim().replace(/'/g, "''");
        return `'${escaped}'`;
    }))];
    return `(${spec.field} IS NULL OR ${spec.field} NOT IN (${quoted.join(',')}))`;
}

/**
 * Hide lists are applied in the ArcGIS `where` and in JS before setData.
 * Do not add a MapLibre `in`/`trim` filter — that expression fails to paint
 * on MapLibre 4 and drops every Boxes feature, not just the excluded names.
 * @param {unknown} baseFilter
 * @param {string} [_layerKey]
 */
export function combineUdotFiberMapLibreFilter(baseFilter, _layerKey) {
    return baseFilter;
}
