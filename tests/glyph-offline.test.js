import { describe, expect, it, vi } from 'vitest';
import { glyphRequestPlan, isExternalGlyphUrl, isLocalGlyphUrl } from '../js/map/glyph-offline.js';
import { PWA_RUNTIME_CACHING } from '../js/pwa/runtime-cache.js';
import { LOCAL_GLYPHS_URL } from '../js/map/local-glyphs.js';

const LOCAL_URL = 'http://127.0.0.1:5175/fonts/Open%20Sans%20Regular,Noto%20Sans%20Regular/0-255.pbf';
const REMOTE_URL = 'https://tiles.basemaps.cartocdn.com/fonts/Open%20Sans%20Regular,Noto%20Sans%20Regular/0-255.pbf';

describe('offline label fonts', () => {
    it('precaches same-origin glyph ranges and does not runtime-cache CARTO fonts', () => {
        expect(isLocalGlyphUrl(LOCAL_URL)).toBe(true);
        expect(isLocalGlyphUrl(LOCAL_GLYPHS_URL)).toBe(true);
        expect(isExternalGlyphUrl(REMOTE_URL)).toBe(true);
        expect(isExternalGlyphUrl('https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/tiles.json')).toBe(false);
        expect(PWA_RUNTIME_CACHING.some((entry) => /glyph/i.test(String(entry.options?.cacheName || '')))).toBe(false);
        expect(PWA_RUNTIME_CACHING.some((entry) => /cartocdn\.com\/fonts/i.test(String(entry.urlPattern)))).toBe(false);
    });

    it('does not plan a network fetch for local or remote glyphs', () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network disabled'));
        expect(glyphRequestPlan(LOCAL_URL, { online: false, cacheHit: true })).toEqual({
            glyph: true,
            network: false,
            source: 'precache'
        });
        expect(glyphRequestPlan(REMOTE_URL, { online: true, cacheHit: false })).toEqual({
            glyph: true,
            network: false,
            source: 'unavailable'
        });
        expect(glyphRequestPlan('https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/tiles.json')).toEqual({
            glyph: false,
            network: false,
            source: 'ignore'
        });
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });
});
