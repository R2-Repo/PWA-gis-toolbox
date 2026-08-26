import { describe, expect, it } from 'vitest';
import {
    DEFAULT_RASTER_TONE,
    getRasterPaintForTint,
    getVectorToneWashPaint,
    normalizeBasemapTone,
    scalePaintOpacity,
    snapshotVectorOpacityPaint
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

    it('builds a vector wash for lighter and darker tints', () => {
        expect(getVectorToneWashPaint('default')['background-opacity']).toBe(0);
        expect(getVectorToneWashPaint('light')).toEqual({
            'background-color': '#ffffff',
            'background-opacity': 0.22
        });
        expect(getVectorToneWashPaint('dark')['background-color']).toBe('#000000');
        expect(normalizeBasemapTone({ tint: 'light' }).wash['background-opacity']).toBe(0.22);
    });

    it('scales numeric and expression opacities', () => {
        expect(scalePaintOpacity(1, 0.5)).toBe(0.5);
        expect(scalePaintOpacity(0.4, 0.5)).toBe(0.2);
        expect(scalePaintOpacity(['get', 'opacity'], 0.5)).toEqual(['*', ['get', 'opacity'], 0.5]);
        expect(snapshotVectorOpacityPaint({
            type: 'fill',
            paint: { 'fill-opacity': 0.8 }
        })).toEqual({ 'fill-opacity': 0.8 });
    });
});
