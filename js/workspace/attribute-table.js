/**
 * Helpers for the layer attribute table (workspace + in-memory).
 * Workspace browsing is attributes-only — no geometries — so rows not
 * drawn on the map (and cold/detached fields) stay visible.
 */

import { isInternalFeatureProp, LGID_PROP } from './feature-identity.js';
import { joinHotColdProperties } from './cold-attributes.js';

/** Rows loaded per page for workspace-backed layers. */
export const ATTRIBUTE_TABLE_PAGE_SIZE = 100;

/**
 * Build ordered field names for the table header.
 * @param {{
 *   schemaFieldNames?: string[],
 *   coldFields?: string[],
 *   sampleRows?: object[],
 *   includeIdentity?: boolean
 * }} opts
 * @returns {string[]}
 */
export function resolveAttributeTableFields({
    schemaFieldNames = [],
    coldFields = [],
    sampleRows = [],
    includeIdentity = false
} = {}) {
    const seen = new Set();
    const out = [];
    const add = (name, { allowInternal = false } = {}) => {
        if (!name || seen.has(name)) return;
        if (!allowInternal && isInternalFeatureProp(name)) return;
        seen.add(name);
        out.push(name);
    };

    if (includeIdentity) {
        add('_featureIndex', { allowInternal: true });
        add(LGID_PROP, { allowInternal: true });
    }
    for (const name of schemaFieldNames) add(name);
    for (const name of coldFields) add(name);
    for (const row of sampleRows) {
        for (const key of Object.keys(row || {})) add(key);
    }
    return out;
}

/**
 * Turn IndexedDB attribute records (+ optional cold map) into table rows.
 * Contiguous feature indices from startIndex for `count` slots.
 *
 * @param {Map<number, object>} attrByIndex
 * @param {Map<string, object>|null} coldByLgid
 * @param {{ includeCold?: boolean, startIndex: number, count: number }} opts
 * @returns {object[]}
 */
export function recordsToAttributeRows(attrByIndex, coldByLgid, {
    includeCold = true,
    startIndex,
    count
}) {
    const rows = [];
    for (let i = 0; i < count; i++) {
        const featureIndex = startIndex + i;
        const rec = attrByIndex?.get?.(featureIndex);
        if (!rec) {
            rows.push({ _featureIndex: featureIndex });
            continue;
        }
        let props = { ...(rec.properties || {}) };
        if (rec.lgid) props[LGID_PROP] = rec.lgid;
        if (includeCold && rec.lgid && coldByLgid?.has(rec.lgid)) {
            props = joinHotColdProperties(props, coldByLgid.get(rec.lgid));
            if (rec.lgid) props[LGID_PROP] = rec.lgid;
        }
        props._featureIndex = featureIndex;
        rows.push(props);
    }
    return rows;
}

/**
 * Clamp a page offset into a valid range.
 * @param {number} offset
 * @param {number} totalCount
 * @param {number} pageSize
 */
export function clampAttributePageOffset(offset, totalCount, pageSize = ATTRIBUTE_TABLE_PAGE_SIZE) {
    const size = Math.max(1, pageSize | 0);
    const total = Math.max(0, totalCount | 0);
    if (total === 0) return 0;
    const maxOffset = Math.floor((total - 1) / size) * size;
    const next = Math.max(0, offset | 0);
    return Math.min(next, maxOffset);
}

export default {
    ATTRIBUTE_TABLE_PAGE_SIZE,
    resolveAttributeTableFields,
    recordsToAttributeRows,
    clampAttributePageOffset
};
