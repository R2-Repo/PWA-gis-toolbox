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
        raster: getRasterPaintForTint(tint)
    };
}
