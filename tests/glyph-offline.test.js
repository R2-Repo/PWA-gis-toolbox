import { describe, expect, it, vi } from 'vitest';
import { glyphRequestPlan } from '../js/map/glyph-offline.js';
import {
    CARTO_GLYPH_CACHE_NAME,
    isCartoGlyphUrl,
    PWA_RUNTIME_CACHING
} from '../js/pwa/runtime-cache.js';

const GLYPH_URL = 'https://tiles.basemaps.cartocdn.com/fonts/Open%20Sans%20Regular,Noto%20Sans%20Regular/0-255.pbf';

describe('offline label fonts', () => {
    it('caches CARTO glyph ranges and does not cache tile endpoints', () => {
        expect(isCartoGlyphUrl(GLYPH_URL)).toBe(true);
        expect(isCartoGlyphUrl('https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/tiles.json')).toBe(false);
        const rule = PWA_RUNTIME_CACHING.find((entry) => entry.options.cacheName === CARTO_GLYPH_CACHE_NAME);
        expect(rule.handler).toBe('CacheFirst');
        expect(rule.urlPattern.test(GLYPH_URL)).toBe(true);
        expect(rule.urlPattern.test('https://cdn.jsdelivr.net/npm/maplibre-gl/dist/maplibre-gl.js')).toBe(false);
    });

    it('reads a cached glyph offline without calling fetch', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
        const cached = glyphRequestPlan(GLYPH_URL, { online: false, cacheHit: true });
        const missing = glyphRequestPlan(GLYPH_URL, { online: false, cacheHit: false });
        expect(cached).toEqual({ glyph: true, network: false, source: 'cache' });
        expect(missing).toEqual({ glyph: true, network: false, source: 'unavailable' });
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
