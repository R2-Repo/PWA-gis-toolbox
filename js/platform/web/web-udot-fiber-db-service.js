/**
 * PWA stub — UDOT Fiber SQLite is desktop-only.
 */

function unavailable() {
    return Promise.reject(new Error('UDOT Fiber SQLite requires the Windows desktop application'));
}

/**
 * @returns {import('../contracts.js').UdotFiberDbService}
 */
export function createWebUdotFiberDbService() {
    return {
        open: unavailable,
        getSyncMeta: unavailable,
        setSyncMeta: unavailable,
        replaceLayer: unavailable,
        loadLayer: unavailable,
        loadAllLayers: unavailable
    };
}
