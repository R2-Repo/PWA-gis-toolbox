/**
 * Symbology panel helpers — field picking, dropdown mapping, palette apply.
 * Saved style stays mode + visualVariables. These helpers only build the next
 * object after an explicit user choice.
 */
import {
    autoClassifyRange,
    autoClassifyUnique,
    createVisualVariable
} from './style-engine.js';

const COLOR_TYPES = new Set(['unique', 'range', 'ramp']);
const SIZE_TYPES = new Set(['size', 'width']);

/**
 * @param {Array<{ name: string, type?: string, uniqueCount?: number, selected?: boolean }>} fields
 * @returns {object|null}
 */
export function pickSmartField(fields) {
    const visible = (fields || []).filter((f) => f.selected !== false);
    return visible.find((f) => f.type === 'string' || (f.uniqueCount ?? Infinity) <= 20)
        || visible.find((f) => f.type === 'number')
        || visible[0]
        || null;
}

/**
 * @param {{ type?: string, uniqueCount?: number }|null|undefined} field
 * @returns {'unique'|'range'}
 */
export function suggestVariableType(field) {
    if (!field) return 'unique';
    if (field.type === 'number') return (field.uniqueCount ?? Infinity) <= 12 ? 'unique' : 'range';
    return 'unique';
}

/**
 * Default unique/range color channel from geometry kinds.
 * Line-only layers must use stroke — fill-only unique colors never paint MapLibre lines.
 * @param {Set<string>|null|undefined} geomTypes
 * @returns {'fill'|'stroke'|'both'}
 */
export function suggestStyleChannel(geomTypes) {
    const hasLine = !!geomTypes?.has?.('line');
    const hasFill = !!geomTypes?.has?.('polygon') || !!geomTypes?.has?.('point');
    if (hasLine && !hasFill) return 'stroke';
    if (hasLine && hasFill) return 'both';
    return 'fill';
}

/**
 * Strip mode/smart/labels wrapper; preserve point/line/polygon overrides for defaultStyle.
 * Labels belong on the root style object, not inside smart.defaultStyle.
 * @param {object} style
 */
export function extractDefaultStyle(style) {
    const { mode, smart, labels, ...rest } = style;
    return { ...rest };
}

/**
 * Merge smart.defaultStyle onto layer style for SimpleStyleSection display.
 * @param {object} style
 * @param {object} [defaultStyle]
 */
export function mergeDefaultStyleForDisplay(style, defaultStyle) {
    const ds = defaultStyle || {};
    return {
        ...style,
        ...ds,
        ...(ds.point ? { point: { ...ds.point } } : {}),
        ...(ds.line ? { line: { ...ds.line } } : {}),
        ...(ds.polygon ? { polygon: { ...ds.polygon } } : {}),
        mode: 'simple'
    };
}

/**
 * Apply saved palette colors to the first unique/range visual variable.
 * @param {object[]} visualVariables
 * @param {string[]} paletteColors
 * @returns {object[]|null} updated array, or null if no compatible variable
 */
/**
 * Color classification wins over size when a saved style has both.
 * @param {object|null|undefined} style
 * @returns {object|null}
 */
export function primaryVariable(style) {
    const variables = style?.smart?.visualVariables || [];
    return variables.find((v) => COLOR_TYPES.has(v.type))
        || variables.find((v) => SIZE_TYPES.has(v.type))
        || null;
}

/**
 * @param {object|null|undefined} style
 * @returns {'single'|'unique'|'graduated-colors'|'graduated-size'}
 */
export function symbologyTypeFromStyle(style) {
    if (!style || style.mode !== 'smart') return 'single';
    const vv = primaryVariable(style);
    if (!vv) return 'single';
    if (vv.type === 'unique') return 'unique';
    if (vv.type === 'range' || vv.type === 'ramp') return 'graduated-colors';
    if (vv.type === 'size' || vv.type === 'width') return 'graduated-size';
    return 'single';
}

/**
 * Variables that still paint but are not the dropdown type.
 * @param {object|null|undefined} style
 * @returns {object[]}
 */
export function extraVariables(style) {
    const primary = primaryVariable(style);
    return (style?.smart?.visualVariables || []).filter((v) => v !== primary);
}

/**
 * Engine visual-variable id for a dropdown choice.
 * Pass existingType to keep ramp vs class breaks, or size vs width.
 * @param {string} symbologyType
 * @param {Set<string>|null|undefined} geomTypes
 * @param {string|null|undefined} existingType
 * @returns {'unique'|'range'|'ramp'|'size'|'width'|null}
 */
export function variableTypeForSymbology(symbologyType, geomTypes, existingType = null) {
    if (symbologyType === 'unique') return 'unique';
    if (symbologyType === 'graduated-colors') {
        if (existingType === 'ramp' || existingType === 'range') return existingType;
        return 'range';
    }
    if (symbologyType === 'graduated-size') {
        if (existingType === 'size' || existingType === 'width') return existingType;
        const hasPoint = !!geomTypes?.has?.('point');
        const hasLine = !!geomTypes?.has?.('line');
        const hasPoly = !!geomTypes?.has?.('polygon');
        if (hasPoint && !hasLine && !hasPoly) return 'size';
        return hasLine || hasPoly ? 'width' : 'size';
    }
    return null;
}

function primaryIndex(variables) {
    let idx = variables.findIndex((v) => COLOR_TYPES.has(v.type));
    if (idx < 0) idx = variables.findIndex((v) => SIZE_TYPES.has(v.type));
    return idx;
}

function withSmart(style, patch) {
    const prev = style?.smart || {};
    const defaultStyle = prev.defaultStyle && Object.keys(prev.defaultStyle).length
        ? prev.defaultStyle
        : extractDefaultStyle(style || {});
    return {
        ...style,
        mode: 'smart',
        smart: {
            defaultStyle,
            visualVariables: [...(prev.visualVariables || [])],
            filterRules: [...(prev.filterRules || [])],
            ...patch
        }
    };
}

function sameFamily(symbologyType, engineType) {
    if (symbologyType === 'unique') return engineType === 'unique';
    if (symbologyType === 'graduated-colors') return engineType === 'range' || engineType === 'ramp';
    if (symbologyType === 'graduated-size') return engineType === 'size' || engineType === 'width';
    return false;
}

/**
 * Next style after a symbology dropdown change.
 * Returns null when the choice needs a field and the user has not chosen one.
 * Does not invent a field.
 * @param {object} style
 * @param {string} symbologyType
 * @param {{ geomTypes?: Set<string>, fields?: object[], features?: object[], channel?: string }} context
 * @returns {object|null}
 */
export function styleForSymbologyType(style, symbologyType, context = {}) {
    if (symbologyType === 'single' || !symbologyType) {
        if (style?.mode !== 'smart') return style;
        return { ...style, mode: 'simple' };
    }
    const variables = [...(style?.smart?.visualVariables || [])];
    const idx = primaryIndex(variables);
    const existing = idx >= 0 ? variables[idx] : null;
    if (!existing?.field) return null;
    if (sameFamily(symbologyType, existing.type)) {
        if (style.mode === 'smart') return style;
        return { ...style, mode: 'smart' };
    }
    const engineType = variableTypeForSymbology(symbologyType, context.geomTypes, null);
    const fieldDef = (context.fields || []).find((f) => f.name === existing.field) || null;
    const channel = existing.channel || context.channel || 'fill';
    const created = createVisualVariable(engineType, existing.field, context.features || [], fieldDef, { channel });
    variables[idx] = { ...created, id: existing.id || created.id, channel };
    return withSmart(style, { visualVariables: variables });
}

/**
 * Next style after the user picks or confirms a field.
 * @param {object} style
 * @param {string} fieldName
 * @param {string} symbologyType
 * @param {{ geomTypes?: Set<string>, fields?: object[], features?: object[], channel?: string }} context
 * @returns {object}
 */
export function styleForSymbologyField(style, fieldName, symbologyType, context = {}) {
    if (!fieldName || symbologyType === 'single') return style;
    const variables = [...(style?.smart?.visualVariables || [])];
    const idx = primaryIndex(variables);
    const existing = idx >= 0 ? variables[idx] : null;
    const engineType = variableTypeForSymbology(symbologyType, context.geomTypes, existing?.type);
    if (existing && existing.field === fieldName && existing.type === engineType) {
        return style?.mode === 'smart' ? style : withSmart(style, { visualVariables: variables });
    }
    const fieldDef = (context.fields || []).find((f) => f.name === fieldName) || null;
    const channel = existing?.channel || context.channel || 'fill';
    const created = createVisualVariable(engineType, fieldName, context.features || [], fieldDef, { channel });
    const nextVv = { ...created, id: existing?.id || created.id, channel };
    if (idx >= 0) variables[idx] = nextVv;
    else variables.unshift(nextVv);
    return withSmart(style, { visualVariables: variables });
}

/**
 * @param {object} style
 * @param {(vv: object) => object} updater
 * @returns {object}
 */
export function mapPrimaryVariable(style, updater) {
    const variables = [...(style?.smart?.visualVariables || [])];
    const idx = primaryIndex(variables);
    if (idx < 0) return style;
    variables[idx] = updater(variables[idx]);
    return withSmart(style, { visualVariables: variables });
}

/**
 * Recompute classes from current features. Unique labels the user edited stay
 * when the value is still present.
 * @param {object} vv
 * @param {object[]} features
 * @param {object|null} schemaField
 */
export function reclassifyVariable(vv, features, schemaField = null) {
    if (!vv?.field) return vv;
    if (vv.type === 'unique') {
        const fresh = autoClassifyUnique(vv.field, features);
        const labels = new Map((vv.classes || []).map((c) => [String(c.value), c.label]));
        return {
            ...vv,
            classes: fresh.map((c) => ({
                ...c,
                label: labels.has(String(c.value)) ? labels.get(String(c.value)) : c.label
            }))
        };
    }
    if (vv.type === 'range' && vv.method === 'manual') {
        const count = (vv.classes || []).length;
        const colored = autoClassifyRange(
            vv.field,
            features,
            count || vv.classCount || 5,
            vv.ramp || 'ylOrRd',
            schemaField,
            'equal',
            !!vv.rampReverse
        );
        const colors = (colored.classes || []).map((cls) => cls.color);
        return {
            ...vv,
            classes: (vv.classes || []).map((cls, i) => ({
                ...cls,
                color: colors[i] || cls.color
            }))
        };
    }
    if (vv.type === 'range') {
        const result = autoClassifyRange(
            vv.field,
            features,
            vv.classCount || 5,
            vv.ramp || 'ylOrRd',
            schemaField,
            vv.method || 'equal',
            !!vv.rampReverse
        );
        return { ...vv, ...result, rampReverse: !!vv.rampReverse };
    }
    return vv;
}

/**
 * Highlight rules live on the smart block and only paint in smart mode.
 * Promoting a single-symbol style keeps its variables empty so the dropdown
 * stays on Single symbol.
 * @param {object} style
 * @param {object[]} filterRules
 */
export function styleForHighlightRules(style, filterRules) {
    const rules = filterRules || [];
    if (style?.mode !== 'smart') {
        if (!rules.length) return style;
        return withSmart(style, {
            filterRules: rules,
            visualVariables: [...(style?.smart?.visualVariables || [])]
        });
    }
    return withSmart(style, { filterRules: rules });
}

/**
 * Write the base symbol onto the style that actually paints.
 * Smart mode keeps visual variables. Root flat keys win over defaultStyle
 * in the paint compiler, so both are updated together.
 * @param {object} style current saved style
 * @param {object} nextFromSection style emitted by the symbol controls
 */
export function styleForBaseSymbol(style, nextFromSection) {
    if (style?.mode !== 'smart') {
        return {
            ...nextFromSection,
            mode: 'simple',
            labels: style?.labels ?? nextFromSection.labels,
            smart: style?.smart
        };
    }
    const extracted = extractDefaultStyle(nextFromSection);
    const { point, line, polygon, ...flat } = extracted;
    return {
        ...style,
        ...flat,
        ...(point ? { point } : {}),
        ...(line ? { line } : {}),
        ...(polygon ? { polygon } : {}),
        mode: 'smart',
        labels: style.labels,
        smart: {
            ...(style.smart || {}),
            defaultStyle: extracted
        }
    };
}

/**
 * Apply saved palette colors to the first unique/range visual variable.
 * @param {object[]} visualVariables
 * @param {string[]} paletteColors
 * @returns {object[]|null} updated array, or null if no compatible variable
 */
export function applyPaletteToVariables(visualVariables, paletteColors) {
    if (!paletteColors?.length) return null;
    const idx = (visualVariables || []).findIndex((v) => v.type === 'unique' || v.type === 'range');
    if (idx < 0) return null;
    const vv = visualVariables[idx];
    const classes = (vv.classes || []).map((cls, i) => ({
        ...cls,
        color: paletteColors[i % paletteColors.length] || cls.color
    }));
    return visualVariables.map((v, j) => (j === idx ? { ...v, classes } : v));
}
