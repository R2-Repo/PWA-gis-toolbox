/**
 * Helpers for the layer attribute table (workspace + in-memory).
 * Workspace browsing is attributes-only — no geometries — so rows not
 * drawn on the map (and cold/detached fields) stay visible.
 */

import { isInternalFeatureProp, LGID_PROP } from './feature-identity.js';
import { joinHotColdProperties } from './cold-attributes.js';

/** Rows loaded per page for workspace-backed layers. */
export const ATTRIBUTE_TABLE_PAGE_SIZE = 100;

/** Cap matching indices from a scan so the UI stays responsive. */
export const ATTRIBUTE_SCAN_MAX_MATCHES = 5_000;

/** Attribute records read per yield during a scan. */
export const ATTRIBUTE_SCAN_BATCH_SIZE = 1_000;

/**
 * @typedef {{
 *   text?: string,
 *   field?: string|null,
 *   fieldValue?: string,
 *   fieldOp?: 'contains'|'equals'|'starts_with'|'is_empty'|'is_not_empty'
 * }} AttributeTableQuery
 */

/**
 * Normalize UI query into a matcher-friendly shape.
 * @param {AttributeTableQuery|null|undefined} query
 * @returns {{ active: boolean, text: string, field: string|null, fieldValue: string, fieldOp: string }}
 */
export function normalizeAttributeTableQuery(query = null) {
    const text = String(query?.text ?? '').trim().toLowerCase();
    const field = query?.field ? String(query.field) : null;
    const fieldValue = String(query?.fieldValue ?? '').trim();
    const fieldOp = query?.fieldOp || 'contains';
    const fieldActive = !!(field && (
        fieldOp === 'is_empty'
        || fieldOp === 'is_not_empty'
        || fieldValue !== ''
    ));
    return {
        active: !!(text || fieldActive),
        text,
        field: fieldActive ? field : null,
        fieldValue: fieldValue.toLowerCase(),
        fieldOp
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function attributeValueToSearchText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'object' && value._att) return String(value.name || '');
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * @param {object} row
 * @param {ReturnType<typeof normalizeAttributeTableQuery>} query
 * @returns {boolean}
 */
export function rowMatchesAttributeQuery(row, query) {
    if (!query?.active) return true;
    const props = row || {};

    if (query.field) {
        const raw = props[query.field];
        const text = attributeValueToSearchText(raw).toLowerCase();
        if (query.fieldOp === 'is_empty') {
            if (text !== '') return false;
        } else if (query.fieldOp === 'is_not_empty') {
            if (text === '') return false;
        } else if (query.fieldOp === 'equals') {
            if (text !== query.fieldValue) return false;
        } else if (query.fieldOp === 'starts_with') {
            if (!text.startsWith(query.fieldValue)) return false;
        } else if (!text.includes(query.fieldValue)) {
            return false;
        }
    }

    if (query.text) {
        let hit = false;
        for (const [key, value] of Object.entries(props)) {
            if (isInternalFeatureProp(key) && key !== LGID_PROP) continue;
            if (attributeValueToSearchText(value).toLowerCase().includes(query.text)) {
                hit = true;
                break;
            }
        }
        if (!hit) return false;
    }

    return true;
}

/**
 * Compare two row values for column sort.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function compareAttributeValues(a, b) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) return 0;
        if (Number.isNaN(a)) return 1;
        if (Number.isNaN(b)) return -1;
        return a - b;
    }
    const as = attributeValueToSearchText(a).toLowerCase();
    const bs = attributeValueToSearchText(b).toLowerCase();
    if (as < bs) return -1;
    if (as > bs) return 1;
    return 0;
}

/**
 * Sort rows in place by field.
 * @param {object[]} rows
 * @param {string} field
 * @param {'asc'|'desc'} [direction]
 * @returns {object[]}
 */
export function sortAttributeRows(rows, field, direction = 'asc') {
    if (!field || !Array.isArray(rows)) return rows || [];
    const dir = direction === 'desc' ? -1 : 1;
    return [...rows].sort((ra, rb) => dir * compareAttributeValues(ra?.[field], rb?.[field]));
}

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
    ATTRIBUTE_SCAN_MAX_MATCHES,
    ATTRIBUTE_SCAN_BATCH_SIZE,
    normalizeAttributeTableQuery,
    attributeValueToSearchText,
    rowMatchesAttributeQuery,
    compareAttributeValues,
    sortAttributeRows,
    resolveAttributeTableFields,
    recordsToAttributeRows,
    clampAttributePageOffset
};
