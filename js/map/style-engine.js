/**
 * Smart styling engine — compile layer style rules to MapLibre expressions
 * and resolve per-feature styles for export baking.
 */
import { getCategoricalColors, getRampColors, sampleRamp } from './color-ramps.js';
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

export const VISUAL_VARIABLE_TYPES = [
    { id: 'unique', label: 'Unique values' },
    { id: 'range', label: 'Class breaks' },
    { id: 'ramp', label: 'Color ramp' },
    { id: 'size', label: 'Size (points)' },
    { id: 'width', label: 'Width (lines)' },
    { id: 'opacity', label: 'Opacity' }
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
    const types = new Set();
    for (const f of layer.geojson?.features || []) {
        const t = f.geometry?.type;
        if (t === 'Point' || t === 'MultiPoint') types.add('point');
        else if (t === 'LineString' || t === 'MultiLineString') types.add('line');
        else if (t === 'Polygon' || t === 'MultiPolygon') types.add('polygon');
    }
    return types;
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

function buildRampColor(vv, fallback) {
    const min = Number(vv.min);
    const max = Number(vv.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return fallback;
    const colors = getRampColors(vv.ramp || 'ylOrRd');
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

function colorAtRamp(value, min, max, rampName) {
    const colors = getRampColors(rampName);
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
        const color = colorAtRamp(val, Number(vv.min), Number(vv.max), vv.ramp || 'ylOrRd');
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

export function autoClassifyRange(field, features, classCount = 5, rampName = 'ylOrRd', schemaField = null, method = 'equal') {
    if (method === 'quantile') {
        return autoClassifyQuantile(field, features, classCount, rampName, schemaField);
    }
    const { min, max } = numericFieldExtent(field, features, schemaField);
    const colors = sampleRamp(rampName, classCount);
    const step = (max - min) / classCount;
    const classes = [];
    for (let i = 0; i < classCount; i++) {
        const lo = min + step * i;
        const hi = i === classCount - 1 ? max : min + step * (i + 1);
        classes.push({
            value: `${lo.toFixed(2)}–${hi.toFixed(2)}`,
            label: `${lo.toFixed(1)} – ${hi.toFixed(1)}`,
            color: colors[i],
            min: lo,
            max: hi,
            style: {}
        });
    }
    return { classes, min, max, breaks: classes.map((c) => c.max) };
}

export function autoClassifyQuantile(field, features, classCount = 5, rampName = 'ylOrRd', schemaField = null) {
    const values = features
        .map((f) => Number(f.properties?.[field]))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
    if (!values.length) {
        return autoClassifyRange(field, features, classCount, rampName, schemaField, 'equal');
    }
    const colors = sampleRamp(rampName, classCount);
    const classes = [];
    for (let i = 0; i < classCount; i++) {
        const loIdx = Math.floor((i / classCount) * values.length);
        const hiIdx = Math.min(values.length - 1, Math.floor(((i + 1) / classCount) * values.length) - 1);
        const lo = values[loIdx];
        const hi = values[Math.max(hiIdx, loIdx)];
        classes.push({
            value: `q${i + 1}`,
            label: `Q${i + 1}: ${lo.toFixed(1)} – ${hi.toFixed(1)}`,
            color: colors[i],
            min: lo,
            max: hi,
            style: {}
        });
    }
    return { classes, min: values[0], max: values[values.length - 1], breaks: classes.map((c) => c.max) };
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
