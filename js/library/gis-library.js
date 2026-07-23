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
