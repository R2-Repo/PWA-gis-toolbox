/**
 * Map legend model from saved layer styles.
 * Styles stay mode + visualVariables (including styles converted from ArcGIS renderers).
 */
import { isServiceLayer, isSpatialLayer } from '../core/data-model.js';
import { equalIntervalUpperBreaks, formatClassRangeLabel } from './class-breaks.js';
import { sampleRamp } from './color-ramps.js';
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

function classifiedStops(minValue, maxValue, classCount) {
    const min = Number(minValue);
    const max = Number(maxValue);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
    const count = Math.max(2, Math.min(8, Number(classCount) || 5));
    const lo = min;
    const hi = min === max ? min + 1 : max;
    const upper = equalIntervalUpperBreaks(lo, hi, count);
    const stops = [];
    let start = lo;
    for (const end of upper) {
        stops.push({ label: formatClassRangeLabel(start, end) });
        start = end;
    }
    return stops;
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
        const stops = classifiedStops(variable.min, variable.max, variable.classCount);
        const colors = sampleRamp(variable.ramp || 'ylOrRd', stops.length || 2);
        if (variable.rampReverse) colors.reverse();
        return {
            symbology,
            ramp: null,
            items: stops.map((stop, index) => ({
                label: stop.label,
                color: colors[index] || colors[colors.length - 1],
                swatch,
                size: null,
                width: null
            }))
        };
    }

    if (symbology === 'graduated-size') {
        const useWidth = variable.type === 'width' || swatch === 'line';
        const sizeMin = useWidth ? (variable.widthMin ?? 1) : (variable.sizeMin ?? 4);
        const sizeMax = useWidth ? (variable.widthMax ?? 6) : (variable.sizeMax ?? 16);
        const classStops = variable.classes?.length
            ? variable.classes.map((cls) => ({ label: classLabel(cls) })).filter((stop) => stop.label)
            : classifiedStops(variable.min, variable.max, variable.classCount);
        const span = Math.max(classStops.length - 1, 1);
        return {
            symbology,
            ramp: null,
            items: classStops.map((stop, index) => {
                const t = classStops.length === 1 ? 1 : index / span;
                const size = sizeMin + t * (sizeMax - sizeMin);
                return {
                    label: stop.label,
                    color,
                    swatch,
                    size: useWidth ? null : size,
                    width: useWidth ? size : null
                };
            })
        };
    }

    return {
        symbology: 'single',
        ramp: null,
        items: [{ label: '', color, swatch, size: null, width: null }]
    };
}

/**
 * Spatial layers and imported service overlays, in the given order.
 * Hidden layers stay in the list; buildMapLegend drops them.
 * @param {object[]} layers
 * @param {(layer: object) => object|null|undefined} [styleFor]
 */
export function legendLayerRecords(layers, styleFor) {
    const records = [];
    for (const layer of layers || []) {
        if (!layer) continue;
        if (!isSpatialLayer(layer) && !isServiceLayer(layer)) continue;
        records.push({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            geometryKind: layer.geometryKind || geometryKindFromLayer(layer),
            style: typeof styleFor === 'function' ? styleFor(layer) : layer.style
        });
    }
    return records;
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
