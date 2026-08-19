/**
 * Smart Style panel helpers — field picking, default style extraction, palette apply.
 */

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
