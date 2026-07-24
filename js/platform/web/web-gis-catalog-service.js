/**
 * Web stub — Local GIS Library unavailable in the PWA.
 */

function unavailable() {
    return Promise.reject(
        new Error('Local GIS Library requires the Windows desktop application')
    );
}

/**
 * @returns {import('../contracts.js').GisCatalogService}
 */
export function createWebGisCatalogService() {
    return {
        open: unavailable,
        libraryRoot: unavailable,
        openLibraryFolder: unavailable,
        listItems: unavailable,
        getItem: unavailable,
        ingestPath: unavailable,
        touchItem: unavailable,
        removeItem: unavailable,
        readPreview: unavailable,
        setWorkingPath: unavailable,
        setTilePath: unavailable,
        updateMeta: unavailable,
        storageStats: unavailable,
        exportPack: unavailable,
        importPack: unavailable,
        readFileRange: unavailable
    };
}
