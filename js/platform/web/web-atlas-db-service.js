/**
 * Web stub — Atlas DB unavailable in the PWA.
 */

function unavailable() {
    return Promise.reject(new Error('Network Atlas database requires the Windows desktop application'));
}

/**
 * @returns {import('../contracts.js').DatabaseService}
 */
export function createWebAtlasDbService() {
    return {
        open: unavailable,
        loadSnapshot: unavailable,
        applyImport: unavailable,
        savePingResults: unavailable,
        listPingSessions: unavailable,
        loadPingSession: unavailable,
        finalizePingSession: unavailable,
        updateFinding: unavailable,
        ensureImportInbox: unavailable,
        openImportInbox: unavailable,
        listImportInbox: unavailable,
        readImportFile: unavailable
    };
}
