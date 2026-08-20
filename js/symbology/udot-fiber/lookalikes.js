/**
 * Modern CAD lookalikes for UDOT Fiber point classes.
 * Matches published class labels / values — not ArcGIS picture-marker PNGs.
 */
import drawingInfo from './arcgis-drawing-info.json';

/** @typedef {import('./glyphs.js').UdotGlyphKind} UdotGlyphKind */

/**
 * @typedef {object} UdotLookalike
 * @property {UdotGlyphKind} glyph
 * @property {string} color
 */

const POINT_KEYS = new Set(['cabinets', 'splices', 'boxes', 'building']);

/** Published Boxes PMS: black landscape rects; vaults are red circles. */
export const UDOT_BOX_RECT_COLOR = '#111111';
export const UDOT_VAULT_CIRCLE_COLOR = '#ff0000';

/** @type {Array<{ test: (text: string) => boolean, glyph: UdotGlyphKind, color: string }>} */
const FAMILIES = [
    { test: (t) => t.includes('uen') && t.includes('building'), glyph: 'square-x', color: '#00ff00' },
    { test: (t) => /hub[\s-]*mini/.test(t), glyph: 'hex', color: '#ff7f00' },
    { test: (t) => /\bhub\b/.test(t), glyph: 'hex', color: '#ff7f00' },
    { test: (t) => t.includes('building'), glyph: 'building', color: '#00ff00' },
    { test: (t) => t.includes('cabinet'), glyph: 'square-x', color: '#00ff00' },
    { test: (t) => t.includes('vault'), glyph: 'ring', color: UDOT_VAULT_CIRCLE_COLOR },
    { test: (t) => /type\s*ii\b|type 2/.test(t), glyph: 'rect', color: UDOT_BOX_RECT_COLOR },
    { test: (t) => /type\s*iii\b|type 3|type\s*i\b|type 1|\bbox\b/.test(t), glyph: 'rect', color: UDOT_BOX_RECT_COLOR },
    { test: (t) => t.includes('border'), glyph: 'ring', color: '#94a3b8' }
];

const CLASS_FIELD_BY_KEY = Object.freeze({
    cabinets: 'MODEL',
    splices: 'MODEL',
    boxes: 'DT_RSCENCLOSURE_NAME',
    building: 'MODEL'
});

/**
 * @param {string} [layerKey]
 * @param {Record<string, unknown>} [props]
 * @returns {{ value: string, label: string, color: string|null }}
 */
export function lookalikeClassText(layerKey, props = {}) {
    const field = CLASS_FIELD_BY_KEY[layerKey]
        || drawingInfo.layers?.[layerKey]?.classField
        || null;
    const raw = field ? props[field] : null;
    const value = raw == null || raw === '' ? '' : String(raw);
    const classes = drawingInfo.layers?.[layerKey]?.classes || [];
    const hit = classes.find((row) => String(row.value) === value);
    return {
        value,
        label: hit?.label ? String(hit.label) : '',
        color: hit?.color || null
    };
}

/**
 * @param {string} text
 * @returns {UdotLookalike|null}
 */
export function matchLookalikeFamily(text) {
    const key = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) return null;
    for (const family of FAMILIES) {
        if (family.test(key)) return { glyph: family.glyph, color: family.color };
    }
    return null;
}

/**
 * @param {string} [layerKey]
 * @param {Record<string, unknown>} [props]
 * @returns {UdotLookalike|null}
 */
export function resolveLookalike(layerKey, props = {}) {
    if (layerKey === 'splices') {
        return { glyph: 'bowtie', color: '#ff0000' };
    }
    if (!POINT_KEYS.has(layerKey)) return null;

    const cls = lookalikeClassText(layerKey, props);
    const family = matchLookalikeFamily(`${cls.label} ${cls.value}`);
    if (family) return family;

    if (layerKey === 'boxes') {
        return { glyph: 'rect', color: UDOT_BOX_RECT_COLOR };
    }

    const fallback = cls.color && cls.color !== '#94a3b8' ? cls.color : '#94a3b8';
    return { glyph: 'circle', color: fallback };
}
