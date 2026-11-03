/**
 * Offline plan for CARTO label glyph requests.
 * The service worker cache (gis-toolbox-carto-glyphs) serves a prior response.
 * This planner never calls fetch. A cold offline session has no glyphs to draw
 * until a range has been cached; it still must not open a network request.
 */
import { isCartoGlyphUrl } from '../pwa/runtime-cache.js';

/**
 * @param {string} url
 * @param {{ online?: boolean, cacheHit?: boolean }} [opts]
 * @returns {{ glyph: boolean, network: boolean, source: 'ignore'|'cache'|'unavailable'|'network' }}
 */
export function glyphRequestPlan(url, { online = true, cacheHit = false } = {}) {
    if (!isCartoGlyphUrl(url)) {
        return { glyph: false, network: false, source: 'ignore' };
    }
    if (cacheHit) return { glyph: true, network: false, source: 'cache' };
    if (!online) return { glyph: true, network: false, source: 'unavailable' };
    return { glyph: true, network: true, source: 'network' };
}
