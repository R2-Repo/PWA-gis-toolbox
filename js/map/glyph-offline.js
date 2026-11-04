/**
 * Label glyphs are bundled under public/fonts and precached with the app shell.
 * This planner never calls fetch. An external glyph URL is not requested.
 */
import { LOCAL_GLYPHS_URL } from './local-glyphs.js';

const LOCAL_GLYPH_FILE = /(?:^|\/)fonts\/.+\/\d+-\d+\.pbf(?:\?.*)?$/i;

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isExternalGlyphUrl(url) {
    const value = String(url || '');
    if (!/^https?:\/\//i.test(value)) return false;
    if (!/\/fonts\/.+\.pbf/i.test(value) && !/\{fontstack\}/.test(value)) return false;
    try {
        const host = new URL(value).hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false;
    } catch {
        return true;
    }
    return true;
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalGlyphUrl(url) {
    const value = String(url || '');
    if (isExternalGlyphUrl(value)) return false;
    if (LOCAL_GLYPH_FILE.test(value)) return true;
    return value === LOCAL_GLYPHS_URL
        || (value.includes('{fontstack}') && value.includes('{range}.pbf') && !/^https?:/i.test(value));
}

/**
 * @param {string} url
 * @param {{ online?: boolean, cacheHit?: boolean }} [opts]
 * @returns {{ glyph: boolean, network: boolean, source: 'ignore'|'precache'|'unavailable' }}
 */
export function glyphRequestPlan(url) {
    if (isExternalGlyphUrl(url)) {
        return { glyph: true, network: false, source: 'unavailable' };
    }
    if (!isLocalGlyphUrl(url)) {
        return { glyph: false, network: false, source: 'ignore' };
    }
    return { glyph: true, network: false, source: 'precache' };
}
