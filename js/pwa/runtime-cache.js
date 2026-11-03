/**
 * Workbox runtime routes for the production service worker.
 * CARTO label glyphs are protobuf font ranges. CacheFirst keeps a copy
 * after the first online load so later offline sessions do not need the network.
 * Tests must not request these URLs.
 */

export const CARTO_GLYPH_CACHE_NAME = 'gis-toolbox-carto-glyphs';

/** Fonts only. Does not match CARTO vector tiles or style JSON. */
export const CARTO_GLYPH_URL_PATTERN = /^https:\/\/tiles\.basemaps\.cartocdn\.com\/fonts\/.+\.pbf(?:\?.*)?$/i;

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isCartoGlyphUrl(url) {
    return CARTO_GLYPH_URL_PATTERN.test(String(url || ''));
}

export const PWA_RUNTIME_CACHING = [
    {
        urlPattern: /^https:\/\/(unpkg\.com|cdn\.sheetjs\.com|cdn\.jsdelivr\.net)\//i,
        handler: 'CacheFirst',
        options: {
            cacheName: 'gis-toolbox-cdn-libs',
            expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 30
            },
            cacheableResponse: {
                statuses: [0, 200]
            }
        }
    },
    {
        urlPattern: CARTO_GLYPH_URL_PATTERN,
        handler: 'CacheFirst',
        options: {
            cacheName: CARTO_GLYPH_CACHE_NAME,
            expiration: {
                maxEntries: 80,
                maxAgeSeconds: 60 * 60 * 24 * 365
            },
            cacheableResponse: {
                statuses: [0, 200]
            }
        }
    }
];
