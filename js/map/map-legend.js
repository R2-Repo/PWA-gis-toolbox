/**
 * Map legend model from saved layer styles.
 * Styles stay mode + visualVariables (including styles converted from ArcGIS renderers).
 */
import { getRampColors } from './color-ramps.js';
import { getBaseFlatStyle, normalizeStyle } from './style-engine.js';
import { primaryVariable, symbologyTypeFromStyle } from './style-panel-helpers.js';

/**
 * @param {object|null|undefined} layer
 * @returns {'point'|'line'|'polygon'}
 */
export function geometryKindFromLayer(layer) {
    const raw = String(layer?.schema?.geometryType || layer?.geometryType || '').toLowerCase();
    if (raw.includes('point')) return 'point';
    if (raw.includes('line')) return 'line';
    if (raw.includes('polygon')) return 'polygon';

    const features = layer?.geojson?.features;
    if (!Array.isArray(features) || !features.length) return 'polygon';
    let point = false;
    let line = false;
    let polygon = false;
    const limit = Math.min(features.length, 40);
    for (let i = 0; i < limit; i++) {
        const t = features[i]?.geometry?.type;
        if (t === 'Point' || t === 'MultiPoint') point = true;
        else if (t === 'LineString' || t === 'MultiLineString') line = true;
        else if (t === 'Polygon' || t === 'MultiPolygon') polygon = true;
    }
    const kinds = (point ? 1 : 0) + (line ? 1 : 0) + (polygon ? 1 : 0);
    if (kinds === 1) {
        if (point) return 'point';
        if (line) return 'line';
    }
    if (polygon) return 'polygon';
    if (line) return 'line';
    if (point) return 'point';
    return 'polygon';
}

/**
 * @param {'point'|'line'|'polygon'|string|null|undefined} geometryKind
 * @returns {'circle'|'line'|'fill'}
 */
export function legendSwatchForKind(geometryKind) {
    if (geometryKind === 'point') return 'circle';
    if (geometryKind === 'line') return 'line';
    return 'fill';
}

function formatStop(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 10) / 10);
}

function classLabel(cls) {
    const label = cls?.label;
    if (label != null && String(label).trim() !== '') return String(label);
    if (cls?.value != null && String(cls.value).trim() !== '') return String(cls.value);
    return '';
}

function classColor(cls, fallback) {
    return cls?.color || cls?.style?.fillColor || cls?.style?.strokeColor || fallback;
}

function swatchColor(swatch, base) {
    if (swatch === 'line') return base.strokeColor || base.fillColor;
    return base.fillColor || base.strokeColor;
}

/**
 * @param {object|null|undefined} style
 * @param {'point'|'line'|'polygon'} [geometryKind]
 */
export function legendItemsFromStyle(style, geometryKind = 'polygon') {
    const normalized = normalizeStyle(style);
    const kind = geometryKind === 'point' || geometryKind === 'line' ? geometryKind : 'polygon';
    const base = getBaseFlatStyle(normalized, kind);
    const swatch = legendSwatchForKind(kind);
    const color = swatchColor(swatch, base);
    const symbology = symbologyTypeFromStyle(normalized);
    const variable = primaryVariable(normalized);

    if (symbology === 'single' || !variable) {
        return {
            symbology: 'single',
            ramp: null,
            items: [{
                label: '',
                color,
                swatch,
                size: swatch === 'circle' ? base.pointSize : null,
                width: swatch === 'line' ? base.strokeWidth : null
            }]
        };
    }

    if (variable.classes?.length && (symbology === 'unique' || symbology === 'graduated-colors')) {
        const items = [];
        for (const cls of variable.classes) {
            const label = classLabel(cls);
            if (!label) continue;
            items.push({
                label,
                color: classColor(cls, color),
                swatch,
                size: swatch === 'circle' ? (cls.style?.pointSize ?? base.pointSize) : null,
                width: swatch === 'line' ? (cls.style?.strokeWidth ?? base.strokeWidth) : null
            });
        }
        if (symbology === 'unique' && variable.defaultColor) {
            items.push({
                label: 'Other',
                color: variable.defaultColor,
                swatch,
                size: swatch === 'circle' ? base.pointSize : null,
                width: swatch === 'line' ? base.strokeWidth : null
            });
        }
        return { symbology, ramp: null, items };
    }

    if (symbology === 'graduated-colors' && variable.type === 'ramp') {
        const colors = getRampColors(variable.ramp || 'ylOrRd');
        const from = colors[0];
        const to = colors[colors.length - 1];
        return {
            symbology,
            ramp: { from, to },
            items: [
                { label: formatStop(variable.min), color: from, swatch, size: null, width: null },
                { label: formatStop(variable.max), color: to, swatch, size: null, width: null }
            ]
        };
    }

    if (symbology === 'graduated-size') {
        const useWidth = variable.type === 'width' || swatch === 'line';
        const sizeMin = useWidth ? (variable.widthMin ?? 1) : (variable.sizeMin ?? 4);
        const sizeMax = useWidth ? (variable.widthMax ?? 6) : (variable.sizeMax ?? 16);
        return {
            symbology,
            ramp: null,
            items: [
                {
                    label: formatStop(variable.min),
                    color,
                    swatch,
                    size: useWidth ? null : sizeMin,
                    width: useWidth ? sizeMin : null
                },
                {
                    label: formatStop(variable.max),
                    color,
                    swatch,
                    size: useWidth ? null : sizeMax,
                    width: useWidth ? sizeMax : null
                }
            ]
        };
    }

    return {
        symbology: 'single',
        ramp: null,
        items: [{ label: '', color, swatch, size: null, width: null }]
    };
}

/**
 * One entry per visible layer, in the given order.
 * @param {Array<{ id: string, name?: string, visible?: boolean, style?: object|null, geometryKind?: string, schema?: object, geojson?: object }>} layers
 */
export function buildMapLegend(layers) {
    const entries = [];
    for (const layer of layers || []) {
        if (!layer || layer.visible === false) continue;
        const geometryKind = layer.geometryKind || geometryKindFromLayer(layer);
        const built = legendItemsFromStyle(layer.style, geometryKind);
        entries.push({
            id: layer.id,
            name: layer.name || 'Layer',
            geometryKind,
            symbology: built.symbology,
            ramp: built.ramp,
            items: built.items
        });
    }
    return entries;
}
