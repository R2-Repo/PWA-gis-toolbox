/**
 * Layer source adapters for Local GIS Library items.
 * Shared code — no Tauri imports. Desktop tiles use platform catalog range reads.
 */

import { createSpatialDataset, createPmTilesLayer } from '../../core/data-model.js';
import { readGisLibraryPreview } from '../../library/gis-library.js';

/**
 * @param {object} item - catalog item
 * @returns {'pmtiles'|'geojson-preview'}
 */
export function resolveLibrarySourceKind(item) {
    if (item?.tilePath) return 'pmtiles';
    return 'geojson-preview';
}

/**
 * @param {object} item
 * @param {object} geojson
 * @returns {object} spatial dataset
 */
export function geojsonPreviewDatasetFromItem(item, geojson) {
    const displayName = item?.displayName || item?.originalFilename || 'Library layer';
    const name = item?.previewOnly ? `${displayName} (library preview)` : displayName;
    return createSpatialDataset(name, geojson, {
        file: item?.originalFilename || displayName,
        format: item?.format || 'geojson',
        libraryItemId: item?.id,
        previewOnly: Boolean(item?.previewOnly),
        fullFeatureCount: item?.featureCount,
        importRoute: 'gis-library',
        adapter: 'geojson-preview'
    });
}

/**
 * @param {object} item
 * @returns {object} pmtiles layer dataset
 */
export function pmtilesDatasetFromItem(item) {
    const displayName = item?.displayName || item?.originalFilename || 'Library layer';
    const manifest = item?.manifest && typeof item.manifest === 'object' ? item.manifest : {};
    return createPmTilesLayer({
        name: `${displayName} (tiles)`,
        tilePath: item.tilePath,
        libraryItemId: item.id,
        bbox: Array.isArray(item.bbox) ? item.bbox : null,
        sourceLayer: manifest.tileSourceLayer || 'default',
        minZoom: manifest.tileMinZoom ?? 0,
        maxZoom: manifest.tileMaxZoom ?? 22,
        featureCount: item.featureCount
    });
}

/**
 * Build the best map dataset for a library item (tiles preferred when present).
 * @param {object} item
 * @returns {Promise<object>}
 */
export async function materializeLibraryMapDataset(item) {
    if (!item?.id) throw new Error('Library item required');
    if (resolveLibrarySourceKind(item) === 'pmtiles') {
        return pmtilesDatasetFromItem(item);
    }
    const result = await readGisLibraryPreview(item.id);
    if (!result?.geojson) throw new Error('No preview available');
    return geojsonPreviewDatasetFromItem(result.item || item, result.geojson);
}
