/**
 * Basemap tone — tile brightness + backdrop tint + raster opacity
 *
 * Lighter/Default/Darker adjust MapLibre raster brightness so the effect
 * is visible at 100% opacity. Backdrop color still shows through when
 * opacity is lowered.
 */

export const DEFAULT_RASTER_TONE = {
    'raster-brightness-min': 0,
    'raster-brightness-max': 1,
    'raster-contrast': 0,
    'raster-saturation': 0
};

export const BASEMAP_TINTS = {
    default: {
        backdrop: '#121212',
        label: 'Default',
        raster: { ...DEFAULT_RASTER_TONE }
    },
    light: {
        backdrop: '#ffffff',
        label: 'Lighter',
        raster: {
            'raster-brightness-min': 0.22,
            'raster-brightness-max': 1,
            'raster-contrast': -0.08,
            'raster-saturation': 0
        }
    },
    dark: {
        backdrop: '#000000',
        label: 'Darker',
        raster: {
            'raster-brightness-min': 0,
            'raster-brightness-max': 0.68,
            'raster-contrast': 0.1,
            'raster-saturation': 0
        }
    }
};

export const DEFAULT_BASEMAP_TONE = { tint: 'default', opacity: 1 };

export const BASEMAP_OPACITY_MIN = 0.2;
export const BASEMAP_OPACITY_MAX = 1;

export function getBackdropForTint(tint) {
    return BASEMAP_TINTS[tint]?.backdrop ?? BASEMAP_TINTS.default.backdrop;
}

export function getRasterPaintForTint(tint) {
    return { ...(BASEMAP_TINTS[tint]?.raster ?? BASEMAP_TINTS.default.raster) };
}

export function normalizeBasemapTone(input = {}) {
    const tint = BASEMAP_TINTS[input.tint] ? input.tint : 'default';
    const rawOpacity = Number(input.opacity);
    const opacity = Number.isFinite(rawOpacity)
        ? Math.min(BASEMAP_OPACITY_MAX, Math.max(BASEMAP_OPACITY_MIN, rawOpacity))
        : DEFAULT_BASEMAP_TONE.opacity;
    return {
        tint,
        opacity,
        backdrop: getBackdropForTint(tint),
        raster: getRasterPaintForTint(tint),
        wash: getVectorToneWashPaint(tint)
    };
}

export const BASEMAP_TONE_WASH_LAYER_ID = 'basemap-tone-wash';

export const VECTOR_OPACITY_PAINT_KEYS = {
    background: ['background-opacity'],
    fill: ['fill-opacity'],
    line: ['line-opacity'],
    symbol: ['text-opacity', 'icon-opacity'],
    circle: ['circle-opacity', 'circle-stroke-opacity'],
    heatmap: ['heatmap-opacity'],
    'fill-extrusion': ['fill-extrusion-opacity'],
    raster: ['raster-opacity']
};

/**
 * Whole-tile wash for vector styles (closest match to raster brightness).
 * @param {string} tint
 * @returns {{ 'background-color': string, 'background-opacity': number }}
 */
export function getVectorToneWashPaint(tint) {
    if (tint === 'light') {
        return { 'background-color': '#ffffff', 'background-opacity': 0.22 };
    }
    if (tint === 'dark') {
        return { 'background-color': '#000000', 'background-opacity': 0.32 };
    }
    return { 'background-color': '#ffffff', 'background-opacity': 0 };
}

/**
 * @param {number | object | undefined | null} baseValue
 * @param {number} opacity
 * @returns {number | object}
 */
export function scalePaintOpacity(baseValue, opacity) {
    const factor = Number.isFinite(opacity) ? opacity : 1;
    if (baseValue == null) return factor;
    if (typeof baseValue === 'number') return baseValue * factor;
    return ['*', baseValue, factor];
}

/**
 * @param {object} layer
 * @returns {Record<string, number | object>}
 */
export function snapshotVectorOpacityPaint(layer) {
    const keys = VECTOR_OPACITY_PAINT_KEYS[layer?.type] || [];
    /** @type {Record<string, number | object>} */
    const snapshot = {};
    for (const key of keys) {
        snapshot[key] = layer.paint?.[key] ?? 1;
    }
    return snapshot;
}
