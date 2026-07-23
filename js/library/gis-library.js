/**
 * Local GIS Library helpers (shared; no Tauri imports).
 */
import { getPlatformBundle } from '../platform/create-platform.js';
import { hasCapability } from '../platform/contracts.js';
import bus from '../core/event-bus.js';

/**
 * @returns {boolean}
 */
export function isGisLibraryAvailable() {
    const { platform } = getPlatformBundle();
    return hasCapability(platform, 'gisLibrary');
}

/**
 * @returns {import('../platform/contracts.js').GisCatalogService|null}
 */
export function getGisCatalogService() {
    if (!isGisLibraryAvailable()) return null;
    const { services } = getPlatformBundle();
    return services.gisCatalog || null;
}

/**
 * Open catalog DB + ensure library folders.
 * @returns {Promise<{ ok?: boolean, libraryRoot?: string }|null>}
 */
export async function openGisLibrary() {
    const catalog = getGisCatalogService();
    if (!catalog) return null;
    const result = await catalog.open();
    bus.emit('gis-library:opened', result);
    return result;
}

/**
 * @returns {Promise<object[]>}
 */
export async function listGisLibraryItems() {
    const catalog = getGisCatalogService();
    if (!catalog) return [];
    const { items } = await catalog.listItems();
    return Array.isArray(items) ? items : [];
}

/**
 * Register a path-imported dataset into the managed library.
 * @param {import('../platform/contracts.js').GisCatalogIngestPayload} payload
 * @returns {Promise<object|null>}
 */
export async function ingestGisLibraryItem(payload) {
    const catalog = getGisCatalogService();
    if (!catalog) return null;
    await catalog.open();
    const { item } = await catalog.ingestPath(payload);
    bus.emit('gis-library:changed', { action: 'ingest', item });
    return item || null;
}

/**
 * @param {string} id
 * @returns {Promise<{ item: object, geojson: object }|null>}
 */
export async function readGisLibraryPreview(id) {
    const catalog = getGisCatalogService();
    if (!catalog) return null;
    await catalog.open();
    const result = await catalog.readPreview(id);
    try {
        await catalog.touchItem?.(id);
    } catch {
        /* non-fatal */
    }
    return result;
}

/**
 * @param {string} id
 * @param {{ deleteFiles?: boolean }} [opts]
 */
export async function removeGisLibraryItem(id, opts = {}) {
    const catalog = getGisCatalogService();
    if (!catalog) return null;
    await catalog.open();
    const result = await catalog.removeItem(id, opts);
    bus.emit('gis-library:changed', { action: 'remove', id });
    return result;
}

export function formatBytes(n) {
    const bytes = Number(n) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Convert managed original (or source path) to GeoParquet and store working_path on the catalog item.
 * Requires sidecar duckdb and/or pyogrio.
 *
 * @param {object} item - catalog item with id + managedOriginalPath or originalPath
 * @param {{ compute?: import('../platform/contracts.js').ComputeService, onProgress?: Function, signal?: AbortSignal }} [opts]
 * @returns {Promise<object|null>} updated item
 */
export async function optimizeGisLibraryItemToGeoParquet(item, opts = {}) {
    const catalog = getGisCatalogService();
    const { platform, services } = getPlatformBundle();
    const compute = opts.compute || services.compute;
    if (!catalog || !item?.id || !compute?.run) return null;

    if (!hasCapability(platform, 'duckdb')) {
        throw new Error(
            'GeoParquet optimize requires DuckDB in the Python sidecar (pip install -r desktop/sidecar/python/requirements.txt)'
        );
    }

    const sourcePath = item.managedOriginalPath || item.originalPath;
    if (!sourcePath) throw new Error('Library item has no source path to optimize');

    await catalog.open();
    const { NATIVE_OPERATIONS } = await import('../platform/jobs/allowed-operations.js');

    // Write beside datasets/<id>/data.parquet when possible
    let outputPath = null;
    if (item.previewPath) {
        const normalized = String(item.previewPath).replace(/\\/g, '/');
        const dir = normalized.includes('/')
            ? normalized.slice(0, normalized.lastIndexOf('/'))
            : null;
        if (dir) outputPath = `${dir}/data.parquet`;
    }

    const converted = await compute.run(
        NATIVE_OPERATIONS.CONVERT_TO_GEOPARQUET,
        {
            path: sourcePath,
            ...(outputPath ? { outputPath } : {})
        },
        { onProgress: opts.onProgress, signal: opts.signal }
    );

    let checksum = null;
    try {
        const hash = await compute.run(
            NATIVE_OPERATIONS.FILE_CHECKSUM,
            { path: converted.outputPath || sourcePath },
            { signal: opts.signal }
        );
        checksum = hash?.checksum || null;
    } catch {
        /* non-fatal */
    }

    const { item: updated } = await catalog.setWorkingPath({
        id: item.id,
        workingPath: converted.outputPath,
        checksum
    });
    bus.emit('gis-library:changed', { action: 'optimize', item: updated });
    return updated || null;
}

/**
 * Generate PMTiles for a library item and store tile_path on the catalog row.
 *
 * @param {object} item
 * @param {{ compute?: import('../platform/contracts.js').ComputeService, onProgress?: Function, signal?: AbortSignal, minZoom?: number, maxZoom?: number }} [opts]
 * @returns {Promise<object|null>} updated item
 */
export async function generateGisLibraryPmTiles(item, opts = {}) {
    const catalog = getGisCatalogService();
    const { services } = getPlatformBundle();
    const compute = opts.compute || services.compute;
    if (!catalog || !item?.id || !compute?.run) return null;

    const sourcePath = item.workingPath || item.managedOriginalPath || item.originalPath;
    if (!sourcePath) throw new Error('Library item has no source path to tile');

    await catalog.open();
    const { NATIVE_OPERATIONS } = await import('../platform/jobs/allowed-operations.js');

    let outputPath = null;
    const rootResult = await catalog.libraryRoot?.();
    const root = rootResult?.path;
    if (root) {
        const normalized = String(root).replace(/\\/g, '/').replace(/\/+$/, '');
        outputPath = `${normalized}/tiles/${item.id}/layer.pmtiles`;
    } else if (item.previewPath) {
        const normalized = String(item.previewPath).replace(/\\/g, '/');
        const datasetsDir = normalized.includes('/')
            ? normalized.slice(0, normalized.lastIndexOf('/'))
            : null;
        // datasets/<id>/preview.geojson → tiles sibling under library root is preferred;
        // fall back beside dataset folder
        if (datasetsDir) outputPath = `${datasetsDir}/layer.pmtiles`;
    }

    const generated = await compute.run(
        NATIVE_OPERATIONS.GENERATE_PMTILES,
        {
            path: sourcePath,
            ...(outputPath ? { outputPath } : {}),
            ...(opts.minZoom != null ? { minZoom: opts.minZoom } : {}),
            ...(opts.maxZoom != null ? { maxZoom: opts.maxZoom } : {})
        },
        { onProgress: opts.onProgress, signal: opts.signal }
    );

    const { item: updated } = await catalog.setTilePath({
        id: item.id,
        tilePath: generated.outputPath,
        minZoom: generated.minZoom,
        maxZoom: generated.maxZoom,
        sourceLayer: generated.sourceLayer || 'default'
    });
    bus.emit('gis-library:changed', { action: 'tiles', item: updated });
    return updated || null;
}
