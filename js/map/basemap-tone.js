/**
 * Basemap tone — backdrop tint + raster opacity presets
 */

export const BASEMAP_TINTS = {
    default: { backdrop: '#121212', label: 'Default' },
    light: { backdrop: '#ffffff', label: 'Lighter' },
    dark: { backdrop: '#000000', label: 'Darker' }
};

export const DEFAULT_BASEMAP_TONE = { tint: 'default', opacity: 1 };

export const BASEMAP_OPACITY_MIN = 0.2;
export const BASEMAP_OPACITY_MAX = 1;

export function getBackdropForTint(tint) {
    return BASEMAP_TINTS[tint]?.backdrop ?? BASEMAP_TINTS.default.backdrop;
}

export function normalizeBasemapTone(input = {}) {
    const tint = BASEMAP_TINTS[input.tint] ? input.tint : 'default';
    const rawOpacity = Number(input.opacity);
    const opacity = Number.isFinite(rawOpacity)
        ? Math.min(BASEMAP_OPACITY_MAX, Math.max(BASEMAP_OPACITY_MIN, rawOpacity))
        : DEFAULT_BASEMAP_TONE.opacity;
    return { tint, opacity, backdrop: getBackdropForTint(tint) };
}
