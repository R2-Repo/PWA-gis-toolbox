/**
 * Workbox runtime routes for the production service worker.
 * Label glyphs are same-origin files under public/fonts and are precached
 * with the app shell (see vite globPatterns). They do not need a runtime route.
 * Tests must not request remote glyph URLs.
 */

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
    }
];
