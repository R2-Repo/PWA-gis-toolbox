/**
 * Build MapLibre smart styles + labels for UDOT Fiber Network layers.
 */
import drawingInfo from './arcgis-drawing-info.json';
import bentleySymbols from './bentley-symbols.json';
import { scaleToZoom } from '../../map/scale-range.js';
import { normalizeStyle } from '../../map/style-engine.js';
import { UDOT_FIBER_LAYER_BY_KEY, matchUdotFiberLayerUrl } from './constants.js';
import { resolvePointGlyph } from './glyphs.js';

const UTAH_LAT = 40.2;
const DEFAULT_LINE_COLOR = '#94a3b8';
const DEFAULT_POINT_COLOR = '#22c55e';

/** @type {Map<string, { name: string, color: string|null, kind: string }>|null} */
let bentleyByName = null;

function getBentleyIndex() {
    if (bentleyByName) return bentleyByName;
    bentleyByName = new Map();
    for (const sym of bentleySymbols.symbols || []) {
        if (!sym?.name) continue;
        bentleyByName.set(String(sym.name).trim().toLowerCase(), sym);
        // Also index without trailing region suffixes like -R2
        const base = String(sym.name).replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
        if (base && !bentleyByName.has(base)) bentleyByName.set(base, sym);
    }
    return bentleyByName;
}

/**
 * @param {string} [layerKey]
 */
export function getDrawingLayer(layerKey) {
    return drawingInfo.layers?.[layerKey] || null;
}

/**
 * @param {string} labelText
 * @returns {string|null}
 */
export function lookupBentleyColor(labelText) {
    if (!labelText) return null;
    const idx = getBentleyIndex();
    const key = String(labelText).trim().toLowerCase();
    const hit = idx.get(key);
    if (hit?.color) return hit.color;
    // Fuzzy: excel name contained in label or vice versa
    for (const [name, sym] of idx) {
        if (!sym.color) continue;
        if (key.includes(name) || name.includes(key)) return sym.color;
    }
    return null;
}

/**
 * Build a MapLibre match color expression from unique classes.
 * @param {string} field
 * @param {Array<{ value: string, color: string }>} classes
 * @param {string} fallback
 */
export function buildClassColorExpression(field, classes, fallback) {
    if (!field || !classes?.length) return fallback;
    const expr = ['match', ['to-string', ['get', field]]];
    for (const cls of classes) {
        expr.push(String(cls.value), cls.color || fallback);
    }
    expr.push(fallback);
    return expr;
}

/**
 * Label text-color: prefer Bentley color by label field value, else ArcGIS class color.
 * @param {object} layerMeta
 */
function buildLabelColorExpression(layerMeta) {
    const labelField = layerMeta.labelField;
    const classField = layerMeta.classField;
    const classes = layerMeta.classes || [];

    if (labelField) {
        const pairs = [];
        const seen = new Set();
        for (const sym of bentleySymbols.symbols || []) {
            if (!sym.color || !sym.name) continue;
            const name = String(sym.name).trim();
            const key = name.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            pairs.push(name, sym.color);
            if (pairs.length >= 200) break; // MapLibre match practical limit
        }
        if (pairs.length) {
            return ['match', ['to-string', ['get', labelField]], ...pairs, DEFAULT_LINE_COLOR];
        }
    }

    if (classField && classes.length) {
        return buildClassColorExpression(classField, classes, DEFAULT_LINE_COLOR);
    }
    return DEFAULT_LINE_COLOR;
}

/**
 * @param {string} layerKey
 * @returns {object|null} normalized layer style
 */
export function buildUdotFiberLayerStyle(layerKey) {
    const layerMeta = getDrawingLayer(layerKey);
    const layerDef = UDOT_FIBER_LAYER_BY_KEY[layerKey];
    if (!layerMeta || !layerDef) return null;

    const isLine = layerDef.geometry === 'line';
    const classField = layerMeta.classField && layerMeta.classField !== '*'
        ? layerMeta.classField
        : null;
    const classes = (layerMeta.classes || [])
        .filter((c) => c.value && c.value !== '*')
        .map((c) => ({
            value: String(c.value),
            label: c.label || String(c.value),
            color: c.color || (isLine ? DEFAULT_LINE_COLOR : DEFAULT_POINT_COLOR),
            style: isLine
                ? { strokeColor: c.color, strokeWidth: Number(c.width) || 2 }
                : { fillColor: c.color, strokeColor: c.color }
        }));

    const defaultColor = classes[0]?.color
        || (isLine ? DEFAULT_LINE_COLOR : DEFAULT_POINT_COLOR);

    const style = {
        mode: 'smart',
        strokeColor: defaultColor,
        fillColor: defaultColor,
        strokeWidth: isLine ? 2 : 1.25,
        strokeOpacity: 1,
        fillOpacity: isLine ? 1 : 0.85,
        pointSize: 6,
        pointSymbol: 'circle',
        smart: {
            defaultStyle: {
                strokeColor: defaultColor,
                fillColor: defaultColor,
                strokeWidth: isLine ? 2 : 1.25,
                pointSize: 6
            },
            visualVariables: [],
            filterRules: []
        }
    };

    if (classField && classes.length) {
        style.smart.visualVariables.push({
            id: `udot-${layerKey}-class`,
            type: 'unique',
            field: classField,
            channel: isLine ? 'stroke' : 'both',
            geometryTarget: isLine ? 'line' : 'point',
            classes,
            defaultColor: isLine ? DEFAULT_LINE_COLOR : DEFAULT_POINT_COLOR
        });
    }

    if (layerMeta.labelField) {
        const minZoom = layerMeta.labelMinScale
            ? (scaleToZoom(layerMeta.labelMinScale, UTAH_LAT) ?? 14)
            : (isLine ? 14 : 12);
        style.labels = {
            enabled: true,
            field: layerMeta.labelField,
            placement: isLine ? 'line' : 'point',
            minZoom: Math.max(10, Math.round(minZoom * 10) / 10),
            maxZoom: 24,
            size: isLine ? 11 : 10,
            color: buildLabelColorExpression(layerMeta),
            haloColor: '#000000',
            haloWidth: 1.25,
            allowOverlap: false,
            ignorePlacement: false
        };
    }

    const normalized = normalizeStyle(style, defaultColor);
    // Glyph / layer hint for map/live renderers (survive normalizeStyle)
    normalized._udotFiber = {
        layerKey,
        classField,
        labelField: layerMeta.labelField || null,
        geometry: layerDef.geometry
    };
    return normalized;
}

/**
 * Resolve style for a dataset from URL or explicit layer key.
 * @param {{ url?: string, service?: { url?: string }, source?: { url?: string }, _udotFiberLayerKey?: string }} dataset
 * @returns {object|null}
 */
export function resolveUdotFiberStyleForDataset(dataset) {
    const key = dataset?._udotFiberLayerKey
        || matchUdotFiberLayerUrl(dataset?.service?.url || dataset?.source?.url || dataset?.url)?.key;
    if (!key) return null;
    return buildUdotFiberLayerStyle(key);
}

/**
 * Class + label fields the UDOT Fiber style pack needs on the imported features.
 * @param {string} layerKey
 * @returns {string[]}
 */
export function requiredStyleFieldsForUdotFiberLayer(layerKey) {
    const meta = getDrawingLayer(layerKey);
    if (!meta) return [];
    const fields = [];
    if (meta.classField && meta.classField !== '*') fields.push(meta.classField);
    if (meta.labelField) fields.push(meta.labelField);
    return fields;
}

/**
 * Ensure unique-value / label fields stay in an ArcGIS field selection.
 * @param {string[]|null|undefined} selectedFields
 * @param {string} url
 * @param {string[]} [availableFieldNames]
 * @returns {string[]|null|undefined}
 */
export function mergeUdotFiberStyleFields(selectedFields, url, availableFieldNames) {
    const hit = matchUdotFiberLayerUrl(url);
    if (!hit || !selectedFields) return selectedFields;
    const extra = requiredStyleFieldsForUdotFiberLayer(hit.key)
        .filter((name) => !availableFieldNames?.length || availableFieldNames.includes(name));
    if (!extra.length) return selectedFields;
    const set = new Set(selectedFields);
    for (const name of extra) set.add(name);
    return [...set];
}

/**
 * Tag an ArcGIS custom-URL import so post-import applies the Fiber style pack.
 * @param {object} dataset
 * @param {string} [url]
 * @returns {{ key: string, id: number }|null}
 */
export function markDatasetForUdotFiberStyle(dataset, url) {
    if (!dataset) return null;
    const hit = matchUdotFiberLayerUrl(url || dataset.service?.url || dataset.source?.url || dataset.url);
    if (!hit) return null;
    dataset._udotFiberLayerKey = hit.key;
    dataset._applyUdotFiberStyle = true;
    if (dataset.source && !dataset.source.url && url) {
        dataset.source.url = url;
    }
    return hit;
}

/**
 * Per-feature style resolution (export / bake helpers).
 * @param {string} layerKey
 * @param {Record<string, unknown>} props
 */
export function resolveStyle(layerKey, props = {}) {
    const layerMeta = getDrawingLayer(layerKey);
    const layerDef = UDOT_FIBER_LAYER_BY_KEY[layerKey];
    if (!layerMeta || !layerDef) {
        return { color: DEFAULT_LINE_COLOR, label: null, glyph: null };
    }

    const classField = layerMeta.classField;
    const classValue = classField ? props[classField] : null;
    const classHit = (layerMeta.classes || []).find((c) => String(c.value) === String(classValue));
    let color = classHit?.color || (layerDef.geometry === 'line' ? DEFAULT_LINE_COLOR : DEFAULT_POINT_COLOR);

    const labelField = layerMeta.labelField;
    const label = labelField && props[labelField] != null ? String(props[labelField]) : null;
    if (label) {
        const bentley = lookupBentleyColor(label);
        if (bentley) color = bentley;
    }

    const glyph = layerDef.geometry === 'point' ? resolvePointGlyph(layerKey, props) : null;
    return {
        color,
        label,
        width: Number(classHit?.width) || (layerDef.geometry === 'line' ? 2 : 6),
        classValue: classValue != null ? String(classValue) : null,
        glyph
    };
}

export { drawingInfo, bentleySymbols };
