/**
 * Layer styling engine — compile saved style rules to MapLibre expressions
 * and resolve per-feature styles for export baking.
 *
 * Saved ids below stay stable so existing projects and ArcGIS renderers
 * load the same paint. The panel maps them to a symbology dropdown.
 */
import { getCategoricalColors, getRampColors, sampleRamp } from './color-ramps.js';
import { equalIntervalUpperBreaks, formatClassRangeLabel, jenksUpperBreaks } from './class-breaks.js';
import { detectGeometryKinds as detectGeometryKindsCached } from './geometry-kind.js';
import { evaluateFilterGroup, applyFilterRuleCases } from './style-filters.js';

/** @typedef {'point'|'line'|'polygon'} GeometryKind */

export const DEFAULT_FLAT_STYLE = {
    strokeColor: '#2563eb',
    fillColor: '#2563eb',
    strokeWidth: 2,
    strokeOpacity: 0.8,
    fillOpacity: 0.3,
    pointSize: 6,
    pointSymbol: 'circle'
};

/** Saved visual-variable ids. Do not rename ids — projects store them. */
export const VISUAL_VARIABLE_TYPES = [
    { id: 'unique', label: 'Unique values' },
    { id: 'range', label: 'Graduated colors' },
    { id: 'ramp', label: 'Graduated colors' },
    { id: 'size', label: 'Graduated size' },
    { id: 'width', label: 'Graduated size' },
    { id: 'opacity', label: 'Opacity' }
];

/**
 * Symbology dropdown, in ArcGIS / QGIS order.
 * Heatmap is omitted: the saved style model has no heatmap renderer.
 */
export const SYMBOLOGY_TYPES = [
    { id: 'single', label: 'Single symbol' },
    { id: 'unique', label: 'Unique values' },
    { id: 'graduated-colors', label: 'Graduated colors' },
    { id: 'graduated-size', label: 'Graduated size' }
];

/** Classification methods stored on a range visual variable. */
export const CLASSIFY_METHODS = [
    { id: 'equal', label: 'Equal interval' },
    { id: 'quantile', label: 'Quantile' },
    { id: 'natural', label: 'Natural breaks' },
    { id: 'manual', label: 'Manual' }
];

export function createDefaultStyle(defaultColor = DEFAULT_FLAT_STYLE.strokeColor) {
    return {
        mode: 'simple',
        strokeColor: defaultColor,
        fillColor: defaultColor,
        strokeWidth: DEFAULT_FLAT_STYLE.strokeWidth,
        strokeOpacity: DEFAULT_FLAT_STYLE.strokeOpacity,
        fillOpacity: DEFAULT_FLAT_STYLE.fillOpacity,
        pointSize: DEFAULT_FLAT_STYLE.pointSize,
        pointSymbol: DEFAULT_FLAT_STYLE.pointSymbol
    };
}

function _preserveLabels(stored) {
    if (!stored?.labels) return undefined;
    const labels = stored.labels;
    return {
        ...labels,
        offset: Array.isArray(labels.offset) ? [...labels.offset] : labels.offset
    };
}

export function normalizeStyle(stored, defaultColor = DEFAULT_FLAT_STYLE.strokeColor) {
    if (!stored) return createDefaultStyle(defaultColor);
    const labels = _preserveLabels(stored);
    if (stored.mode === 'smart') {
        const result = {
            mode: 'smart',
            ...DEFAULT_FLAT_STYLE,
            ...stored,
            smart: {
                defaultStyle: { ...DEFAULT_FLAT_STYLE, ...(stored.smart?.defaultStyle || {}) },
                visualVariables: (stored.smart?.visualVariables || []).map((vv, i) => ({
                    id: vv.id || `vv-${i}`,
                    ...vv
                })),
                filterRules: [...(stored.smart?.filterRules || [])]
            }
        };
        if (labels) result.labels = labels;
        return result;
    }
    const result = { mode: 'simple', ...DEFAULT_FLAT_STYLE, ...stored };
    if (labels) result.labels = labels;
    return result;
}

export function detectGeometryKinds(layer) {
    return detectGeometryKindsCached(layer);
}

export function getBaseFlatStyle(style, geometryKind) {
    const root = style.mode === 'smart'
        ? { ...DEFAULT_FLAT_STYLE, ...(style.smart?.defaultStyle || {}), ...style }
        : { ...DEFAULT_FLAT_STYLE, ...style };

    const flat = {
        strokeColor: root.strokeColor ?? DEFAULT_FLAT_STYLE.strokeColor,
        fillColor: root.fillColor ?? root.strokeColor ?? DEFAULT_FLAT_STYLE.fillColor,
        strokeWidth: root.strokeWidth ?? DEFAULT_FLAT_STYLE.strokeWidth,
        strokeOpacity: root.strokeOpacity ?? DEFAULT_FLAT_STYLE.strokeOpacity,
        fillOpacity: root.fillOpacity ?? DEFAULT_FLAT_STYLE.fillOpacity,
        pointSize: root.pointSize ?? DEFAULT_FLAT_STYLE.pointSize,
        pointSymbol: root.pointSymbol || DEFAULT_FLAT_STYLE.pointSymbol
    };

    const geomOverride = style.mode === 'smart'
        ? style.smart?.defaultStyle?.[geometryKind] || style[geometryKind]
        : style[geometryKind];
    if (geomOverride) {
        Object.assign(flat, geomOverride);
        if (!geomOverride.fillColor && geomOverride.strokeColor) flat.fillColor = geomOverride.strokeColor;
    }
    return flat;
}

function variableApplies(vv, geometryKind) {
    const target = vv.geometryTarget || 'all';
    return target === 'all' || target === geometryKind;
}

function fieldExpression(field, extra = null) {
    const concat = extra?.fieldConcat;
    if (Array.isArray(concat) && concat.length > 1) {
        const delim = extra.fieldDelimiter ?? ', ';
        const parts = [];
        for (let i = 0; i < concat.length; i++) {
            if (i > 0) parts.push(delim);
            parts.push(['coalesce', ['to-string', ['get', concat[i]]], '']);
        }
        return ['concat', ...parts];
    }
    return ['coalesce', ['to-string', ['get', field]], ''];
}

function numericFieldExpression(field, fallback = 0) {
    return ['to-number', ['get', field], fallback];
}

function buildMatchColor(field, classes, fallback, extra = null) {
    if (!classes?.length) return fallback;
    const pairs = [];
    for (const cls of classes) {
        pairs.push(String(cls.value), cls.color || cls.style?.fillColor || cls.style?.strokeColor || fallback);
    }
    return ['match', fieldExpression(field, extra), ...pairs, fallback];
}

function buildMatchNumber(field, classes, key, fallback, extra = null) {
    if (!classes?.length) return null;
    const pairs = [];
    for (const cls of classes) {
        const n = Number(cls.style?.[key]);
        if (!Number.isFinite(n)) continue;
        pairs.push(String(cls.value), n);
    }
    if (!pairs.length) return null;
    return ['match', fieldExpression(field, extra), ...pairs, fallback];
}

function buildStepColor(vv, fallback) {
    const classes = vv.classes || [];
    if (!classes.length) return fallback;
    const min = Number(vv.min ?? classes[0]?.min ?? 0);
    const steps = ['step', numericFieldExpression(vv.field, min), vv.defaultColor || fallback];
    for (const cls of classes) {
        if (cls.max != null) steps.push(Number(cls.max), cls.color || cls.style?.fillColor || fallback);
    }
    return steps;
}

function rampColorList(rampName, reverse = false) {
    const colors = getRampColors(rampName || 'ylOrRd').slice();
    return reverse ? colors.reverse() : colors;
}

function sampledRampColors(rampName, count, reverse = false) {
    const colors = sampleRamp(rampName || 'ylOrRd', count);
    return reverse ? colors.slice().reverse() : colors;
}

function buildRampColor(vv, fallback) {
    const min = Number(vv.min);
    const max = Number(vv.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return fallback;
    const colors = rampColorList(vv.ramp, !!vv.rampReverse);
    const stops = [];
    for (let i = 0; i < colors.length; i++) {
        const t = colors.length === 1 ? 0 : i / (colors.length - 1);
        stops.push(min + t * (max - min), colors[i]);
    }
    return ['interpolate', ['linear'], numericFieldExpression(vv.field, min), ...stops];
}

function buildNumericInterpolate(vv, outMin, outMax) {
    const min = Number(vv.min);
    const max = Number(vv.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return outMin;
    return ['interpolate', ['linear'], numericFieldExpression(vv.field, min), min, outMin, max, outMax];
}

function compileVariableColor(vv, channel, geometryKind, baseColor) {
    if (!variableApplies(vv, geometryKind)) return null;
    const ch = vv.channel || 'fill';
    if (ch !== channel && ch !== 'both') return null;
    if (vv.type === 'unique') return buildMatchColor(vv.field, vv.classes, vv.defaultColor || baseColor, vv);
    if (vv.type === 'range') return buildStepColor(vv, baseColor);
    if (vv.type === 'ramp') return buildRampColor(vv, baseColor);
    return null;
}

function compileVariableClassNumber(vv, geometryKind, key, fallback) {
    if (vv.type !== 'unique' || !variableApplies(vv, geometryKind)) return null;
    return buildMatchNumber(vv.field, vv.classes, key, fallback, vv);
}

function mergeStylePatch(out, patch) {
    if (!patch) return;
    if (patch.fillColor != null) out.fillColor = patch.fillColor;
    if (patch.strokeColor != null) out.strokeColor = patch.strokeColor;
    if (patch.strokeWidth != null) out.strokeWidth = patch.strokeWidth;
    if (patch.fillOpacity != null) out.fillOpacity = patch.fillOpacity;
    if (patch.strokeOpacity != null) out.strokeOpacity = patch.strokeOpacity;
    if (patch.pointSize != null) out.pointSize = patch.pointSize;
    if (patch.pointSymbol != null) out.pointSymbol = patch.pointSymbol;
}

function findRangeClass(vv, value) {
    for (const cls of vv.classes || []) {
        const lo = cls.min ?? -Infinity;
        const hi = cls.max ?? Infinity;
        if (value >= lo && value <= hi) return cls;
    }
    return null;
}

export function compilePaint(style, geometryKind) {
    const base = getBaseFlatStyle(style, geometryKind);
    let fillColor = base.fillColor;
    let strokeColor = base.strokeColor;
    let fillOpacity = base.fillOpacity;
    let strokeOpacity = base.strokeOpacity;
    let strokeWidth = base.strokeWidth;
    let circleRadius = base.pointSize;
    let hasDataDriven = false;

    if (style.mode === 'smart' && style.smart?.visualVariables?.length) {
        for (const vv of style.smart.visualVariables) {
            const fillExpr = compileVariableColor(vv, 'fill', geometryKind, base.fillColor);
            if (fillExpr != null) { fillColor = fillExpr; hasDataDriven = true; }
            const strokeExpr = compileVariableColor(vv, 'stroke', geometryKind, base.strokeColor);
            if (strokeExpr != null) { strokeColor = strokeExpr; hasDataDriven = true; }

            if (vv.type === 'opacity' && variableApplies(vv, geometryKind)) {
                fillOpacity = buildNumericInterpolate(vv, Number(vv.min ?? 0), Number(vv.max ?? 1));
                hasDataDriven = true;
            }
            if (vv.type === 'size' && variableApplies(vv, geometryKind) && geometryKind === 'point') {
                circleRadius = buildNumericInterpolate(vv, Number(vv.sizeMin ?? 4), Number(vv.sizeMax ?? 16));
                hasDataDriven = true;
            }
            if (vv.type === 'width' && variableApplies(vv, geometryKind) && (geometryKind === 'line' || geometryKind === 'polygon')) {
                strokeWidth = buildNumericInterpolate(vv, Number(vv.widthMin ?? 1), Number(vv.widthMax ?? 6));
                hasDataDriven = true;
            }
            const classWidth = compileVariableClassNumber(vv, geometryKind, 'strokeWidth', base.strokeWidth);
            if (classWidth != null && (geometryKind === 'line' || geometryKind === 'polygon')) {
                strokeWidth = classWidth;
                hasDataDriven = true;
            }
            const classSize = compileVariableClassNumber(vv, geometryKind, 'pointSize', base.pointSize);
            if (classSize != null && geometryKind === 'point') {
                circleRadius = classSize;
                hasDataDriven = true;
            }
        }
    }

    const filterRules = style.mode === 'smart' ? style.smart?.filterRules : null;
    if (filterRules?.length) {
        fillColor = applyFilterRuleCases(fillColor, filterRules, 'fillColor');
        strokeColor = applyFilterRuleCases(strokeColor, filterRules, 'strokeColor');
        fillOpacity = applyFilterRuleCases(fillOpacity, filterRules, 'fillOpacity');
        strokeOpacity = applyFilterRuleCases(strokeOpacity, filterRules, 'strokeOpacity');
        strokeWidth = applyFilterRuleCases(strokeWidth, filterRules, 'strokeWidth');
        circleRadius = applyFilterRuleCases(circleRadius, filterRules, 'pointSize');
        hasDataDriven = true;
    }

    return {
        fillColor,
        strokeColor,
        fillOpacity,
        strokeOpacity,
        strokeWidth,
        circleRadius,
        pointSymbol: base.pointSymbol,
        hasDataDriven
    };
}

function propNumber(props, field, fallback) {
    const n = Number(props?.[field]);
    return Number.isFinite(n) ? n : fallback;
}

function propString(props, field, extra = null) {
    const concat = extra?.fieldConcat;
    if (Array.isArray(concat) && concat.length > 1) {
        const delim = extra.fieldDelimiter ?? ', ';
        return concat.map((f) => {
            const raw = props?.[f];
            return raw == null || raw === '' ? '' : String(raw);
        }).join(delim);
    }
    const raw = props?.[field];
    if (raw == null || raw === '') return '';
    return String(raw);
}

function colorAtRamp(value, min, max, rampName, reverse = false) {
    const colors = rampColorList(rampName, reverse);
    if (!Number.isFinite(value)) return colors[0];
    if (max === min) return colors[colors.length - 1];
    const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return colors[Math.round(t * (colors.length - 1))];
}

function applyVisualVariable(out, vv, props, geometryKind) {
    if (!variableApplies(vv, geometryKind)) return;
    const ch = vv.channel || 'fill';

    if (vv.type === 'unique') {
        const val = propString(props, vv.field, vv);
        const match = vv.classes?.find((c) => String(c.value) === val);
        const color = match?.color || match?.style?.fillColor || vv.defaultColor;
        if (color) {
            if (ch === 'fill' || ch === 'both') out.fillColor = color;
            if (ch === 'stroke' || ch === 'both') out.strokeColor = color;
        }
        mergeStylePatch(out, match?.style);
    } else if (vv.type === 'range') {
        const val = propNumber(props, vv.field, Number(vv.min));
        const match = findRangeClass(vv, val);
        const color = match?.color || match?.style?.fillColor || vv.defaultColor;
        if (color) {
            if (ch === 'fill' || ch === 'both') out.fillColor = color;
            if (ch === 'stroke' || ch === 'both') out.strokeColor = color;
        }
        mergeStylePatch(out, match?.style);
    } else if (vv.type === 'ramp') {
        const val = propNumber(props, vv.field, Number(vv.min));
        const color = colorAtRamp(val, Number(vv.min), Number(vv.max), vv.ramp || 'ylOrRd', !!vv.rampReverse);
        if (ch === 'fill' || ch === 'both') out.fillColor = color;
        if (ch === 'stroke' || ch === 'both') out.strokeColor = color;
    } else if (vv.type === 'opacity') {
        const val = propNumber(props, vv.field, Number(vv.min ?? 0));
        const min = Number(vv.min ?? 0);
        const max = Number(vv.max ?? 1);
        if (max !== min) {
            const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
            out.fillOpacity = Math.max(0, Math.min(1, min + t * (max - min)));
        }
    } else if (vv.type === 'size' && geometryKind === 'point') {
        const val = propNumber(props, vv.field, Number(vv.min));
        const min = Number(vv.min);
        const max = Number(vv.max);
        if (max !== min) {
            const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
            out.pointSize = Math.round(Number(vv.sizeMin ?? 4) + t * (Number(vv.sizeMax ?? 16) - Number(vv.sizeMin ?? 4)));
        }
    } else if (vv.type === 'width' && (geometryKind === 'line' || geometryKind === 'polygon')) {
        const val = propNumber(props, vv.field, Number(vv.min));
        const min = Number(vv.min);
        const max = Number(vv.max);
        if (max !== min) {
            const t = Math.max(0, Math.min(1, (val - min) / (max - min)));
            out.strokeWidth = Number(vv.widthMin ?? 1) + t * (Number(vv.widthMax ?? 6) - Number(vv.widthMin ?? 1));
        }
    }
}

export function resolveFeatureStyle(style, feature, geometryKind) {
    const base = getBaseFlatStyle(style, geometryKind);
    const props = feature.properties || {};
    const out = { ...base };

    if (style.mode === 'smart') {
        for (const vv of style.smart?.visualVariables || []) {
            applyVisualVariable(out, vv, props, geometryKind);
        }
        for (const fr of style.smart?.filterRules || []) {
            if (evaluateFilterGroup(props, fr.filter)) {
                mergeStylePatch(out, fr.style);
            }
        }
    }
    return out;
}

export function autoClassifyUnique(field, features, maxClasses = 20) {
    const counts = new Map();
    for (const f of features) {
        const raw = f.properties?.[field];
        if (raw == null || raw === '') continue;
        const key = String(raw);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxClasses);
    const colors = getCategoricalColors(sorted.length);
    return sorted.map(([value], i) => ({ value, label: value, color: colors[i], style: {} }));
}

export function numericFieldExtent(field, features, schemaField = null) {
    if (schemaField?.min != null && schemaField?.max != null) {
        return { min: schemaField.min, max: schemaField.max };
    }
    let min = Infinity;
    let max = -Infinity;
    for (const f of features) {
        const n = Number(f.properties?.[field]);
        if (!Number.isFinite(n)) continue;
        if (n < min) min = n;
        if (n > max) max = n;
    }
    if (!Number.isFinite(min)) return { min: 0, max: 100 };
    if (min === max) return { min, max: min + 1 };
    return { min, max };
}

function classesFromUpperBreaks(min, upper, colors) {
    const classes = [];
    let lo = min;
    for (let i = 0; i < upper.length; i++) {
        const hi = upper[i];
        classes.push({
            value: `${Number(lo).toFixed(2)}\u2013${Number(hi).toFixed(2)}`,
            label: formatClassRangeLabel(lo, hi),
            color: colors[i],
            min: lo,
            max: hi,
            style: {}
        });
        lo = hi;
    }
    return {
        classes,
        min,
        max: upper.length ? upper[upper.length - 1] : min,
        breaks: upper.slice()
    };
}

function finiteFieldValues(field, features) {
    const values = [];
    for (const feature of features || []) {
        const n = Number(feature?.properties?.[field]);
        if (Number.isFinite(n)) values.push(n);
    }
    return values;
}

export function autoClassifyRange(field, features, classCount = 5, rampName = 'ylOrRd', schemaField = null, method = 'equal', rampReverse = false) {
    const count = Math.max(2, Math.min(12, Number(classCount) || 5));
    if (method === 'quantile') {
        return autoClassifyQuantile(field, features, count, rampName, schemaField, rampReverse);
    }
    if (method === 'natural') {
        const natural = autoClassifyNatural(field, features, count, rampName, rampReverse);
        if (natural) return natural;
    }
    const { min, max } = numericFieldExtent(field, features, schemaField);
    const colors = sampledRampColors(rampName, count, rampReverse);
    return classesFromUpperBreaks(min, equalIntervalUpperBreaks(min, max, count), colors);
}

export function autoClassifyNatural(field, features, classCount = 5, rampName = 'ylOrRd', rampReverse = false) {
    const jenks = jenksUpperBreaks(finiteFieldValues(field, features), classCount);
    if (!jenks?.upper?.length) return null;
    const colors = sampledRampColors(rampName, jenks.upper.length, rampReverse);
    return classesFromUpperBreaks(jenks.min, jenks.upper, colors);
}

export function autoClassifyQuantile(field, features, classCount = 5, rampName = 'ylOrRd', schemaField = null, rampReverse = false) {
    const values = finiteFieldValues(field, features).sort((a, b) => a - b);
    if (!values.length) {
        return autoClassifyRange(field, features, classCount, rampName, schemaField, 'equal', rampReverse);
    }
    const count = Math.max(2, Math.min(12, Number(classCount) || 5));
    const colors = sampledRampColors(rampName, count, rampReverse);
    const classes = [];
    for (let i = 0; i < count; i++) {
        const loIdx = Math.floor((i / count) * values.length);
        const hiIdx = Math.min(values.length - 1, Math.floor(((i + 1) / count) * values.length) - 1);
        const lo = values[loIdx];
        const hi = values[Math.max(hiIdx, loIdx)];
        classes.push({
            value: `q${i + 1}`,
            label: `Q${i + 1}: ${formatClassRangeLabel(lo, hi)}`,
            color: colors[i],
            min: lo,
            max: hi,
            style: {}
        });
    }
    return { classes, min: values[0], max: values[values.length - 1], breaks: classes.map((c) => c.max) };
}

/**
 * Edit one class bound and keep neighbors contiguous.
 * The method becomes manual so a later reclassify keeps these breaks.
 * @param {object} vv
 * @param {number} index
 * @param {{ min?: number, max?: number }} patch
 */
export function editClassBreak(vv, index, patch) {
    const classes = (vv?.classes || []).map((cls) => ({ ...cls }));
    const current = classes[index];
    if (!current) return vv;
    const previous = classes.map((cls) => ({ min: cls.min, max: cls.max }));
    if (patch?.max != null) {
        const max = Number(patch.max);
        if (!Number.isFinite(max)) return vv;
        current.max = max < Number(current.min) ? Number(current.min) : max;
        if (classes[index + 1]) classes[index + 1].min = current.max;
    }
    if (patch?.min != null) {
        const min = Number(patch.min);
        if (!Number.isFinite(min)) return vv;
        current.min = min > Number(current.max) ? Number(current.max) : min;
        if (classes[index - 1]) classes[index - 1].max = current.min;
    }
    for (let i = 0; i < classes.length; i++) {
        const cls = classes[i];
        const before = previous[i];
        const auto = formatClassRangeLabel(before.min, before.max);
        if (!cls.label || cls.label === auto) cls.label = formatClassRangeLabel(cls.min, cls.max);
        cls.value = `${Number(cls.min).toFixed(2)}\u2013${Number(cls.max).toFixed(2)}`;
    }
    return {
        ...vv,
        method: 'manual',
        classes,
        min: classes[0].min,
        max: classes[classes.length - 1].max,
        breaks: classes.map((cls) => cls.max)
    };
}

export function createVisualVariable(type, field, features, schemaField = null, options = {}) {
    const id = `vv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const ext = numericFieldExtent(field, features, schemaField);
    const channel = options.channel || 'fill';

    switch (type) {
        case 'unique':
            return {
                id, type, field, channel,
                classes: autoClassifyUnique(field, features),
                defaultColor: '#94a3b8'
            };
        case 'range':
            return { id, type, field, channel, ramp: 'ylOrRd', method: 'equal', ...autoClassifyRange(field, features, 5, 'ylOrRd', schemaField) };
        case 'ramp':
            return { id, type, field, channel, ramp: 'ylOrRd', min: ext.min, max: ext.max };
        case 'size':
            return { id, type, field, min: ext.min, max: ext.max, sizeMin: 4, sizeMax: 16 };
        case 'width':
            return { id, type, field, min: ext.min, max: ext.max, widthMin: 1, widthMax: 6 };
        case 'opacity':
            return { id, type, field, min: ext.min, max: ext.max };
        default:
            return { id, type: 'unique', field, channel, classes: [], defaultColor: '#94a3b8' };
    }
}

export function isSmartStyleActive(style) {
    return style?.mode === 'smart' && (
        (style.smart?.visualVariables?.length ?? 0) > 0 ||
        (style.smart?.filterRules?.length ?? 0) > 0
    );
}
