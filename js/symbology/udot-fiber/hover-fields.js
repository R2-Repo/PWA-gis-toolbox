/**
 * Hover identify fields for UDOT Fiber Network live layers.
 */
import { matchUdotFiberLayerUrl } from './constants.js';

/** @type {Readonly<Record<string, readonly string[]>>} */
export const UDOT_FIBER_HOVER_FIELDS = Object.freeze({
    cabinets: Object.freeze(['NAME_ADDRESS', 'CHANNEL', 'DROP__']),
    splices: Object.freeze(['NAME', 'MODEL']),
    boxes: Object.freeze(['DT_RSCENCLOSURE_NAME']),
    fiber: Object.freeze(['Fiber_Label']),
    conduit: Object.freeze(['CustNameRight', 'CONDUIT_SYM']),
    building: Object.freeze(['NAME'])
});

/** Alternate ArcGIS names when the published field is empty or renamed. */
const FIELD_ALIASES = Object.freeze({
    DROP__: Object.freeze(['DROP__', 'DROP_', 'DROP'])
});

/**
 * @param {object} [dataset]
 * @returns {boolean}
 */
export function isUdotFiberLiveDataset(dataset) {
    if (dataset?.type !== 'service') return false;
    return !!matchUdotFiberLayerUrl(dataset.service?.url || dataset.source?.url);
}

/**
 * @param {string} [value]
 */
export function escapeUdotFiberHoverText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * @param {Record<string, unknown>} [props]
 * @param {string} field
 * @returns {string}
 */
function readHoverValue(props, field) {
    const keys = FIELD_ALIASES[field] || [field];
    for (const key of keys) {
        const raw = props?.[key];
        if (raw == null) continue;
        const text = String(raw).trim();
        if (text) return text;
    }
    return '';
}

/**
 * @param {string} [layerKey]
 * @param {Record<string, unknown>} [props]
 * @returns {Array<{ field: string, value: string }>}
 */
export function pickUdotFiberHoverRows(layerKey, props = {}) {
    const fields = UDOT_FIBER_HOVER_FIELDS[layerKey] || [];
    const rows = [];
    for (const field of fields) {
        const value = readHoverValue(props, field);
        if (!value) continue;
        rows.push({ field, value });
    }
    return rows;
}

/**
 * @param {string} [layerName]
 * @param {string} [layerKey]
 * @param {Record<string, unknown>} [props]
 * @returns {string}
 */
export function buildUdotFiberHoverHtml(layerName, layerKey, props = {}) {
    const title = escapeUdotFiberHoverText(layerName || layerKey || 'UDOT Fiber');
    const rows = pickUdotFiberHoverRows(layerKey, props);
    const body = rows.length
        ? `<table>${rows.map((row) => (
            `<tr><th>${escapeUdotFiberHoverText(row.field)}</th><td>${escapeUdotFiberHoverText(row.value)}</td></tr>`
        )).join('')}</table>`
        : '<div class="udot-fiber-hover-tooltip__empty">No attributes</div>';
    return `<div class="udot-fiber-hover-tooltip__title">${title}</div>${body}`;
}
