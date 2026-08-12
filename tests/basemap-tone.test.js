import { describe, expect, it } from 'vitest';
import {
    DEFAULT_RASTER_TONE,
    getRasterPaintForTint,
    normalizeBasemapTone
} from '../js/map/basemap-tone.js';

describe('basemap-tone', () => {
    it('keeps default raster brightness at 100% opacity', () => {
        const tone = normalizeBasemapTone({ tint: 'default', opacity: 1 });
        expect(tone.opacity).toBe(1);
        expect(tone.raster).toEqual(DEFAULT_RASTER_TONE);
    });

    it('lightens tiles without requiring reduced opacity', () => {
        const tone = normalizeBasemapTone({ tint: 'light', opacity: 1 });
        expect(tone.opacity).toBe(1);
        expect(tone.raster['raster-brightness-min']).toBeGreaterThan(0);
        expect(tone.raster['raster-brightness-max']).toBe(1);
        expect(tone.backdrop).toBe('#ffffff');
    });

    it('darkens tiles without requiring reduced opacity', () => {
        const tone = normalizeBasemapTone({ tint: 'dark', opacity: 1 });
        expect(tone.opacity).toBe(1);
        expect(tone.raster['raster-brightness-max']).toBeLessThan(1);
        expect(tone.raster['raster-brightness-min']).toBe(0);
        expect(tone.backdrop).toBe('#000000');
    });

    it('leaves overlay-safe default raster unchanged', () => {
        expect(getRasterPaintForTint('default')).toEqual(DEFAULT_RASTER_TONE);
    });
});
