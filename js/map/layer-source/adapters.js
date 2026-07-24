/**
 * Layer source adapters for Local GIS Library items.
 * Shared code — no Tauri imports. Desktop tiles use platform catalog range reads.
 */

import { createSpatialDataset, createPmTilesLayer, createCogLayer } from '../../core/data-model.js';
import { isGisLibraryRasterItem, readGisLibraryPreview } from '../../library/gis-library.js';

/**
 * @param {object} item - catalog item
 * @returns {'pmtiles'|'cog'|'geojson-preview'}
 */
export function resolveLibrarySourceKind(item) {
    if (item?.tilePath) return 'pmtiles';
    if (isGisLibraryRasterItem(item) || item?.format === 'cog' || item?.manifest?.overviewCoordinates) {
        return 'cog';
    }
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
 * @param {object} item
 * @returns {Promise<object>} COG / raster overview layer
 */
export async function cogDatasetFromItem(item) {
    const displayName = item?.displayName || item?.originalFilename || 'Library raster';
    const manifest = item?.manifest && typeof item.manifest === 'object' ? item.manifest : {};
    const coordinates = item._overviewCoordinates || manifest.overviewCoordinates;
    const bbox = item._bbox || item.bbox || manifest.bbox || null;
    let dataUrl = null;
    if (item._overviewPngBase64) {
        const b64 = item._overviewPngBase64;
        dataUrl = String(b64).startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
    } else {
        const overviewPath = manifest.overviewPath || item.overviewPath;
        if (overviewPath) {
            const { getGisCatalogService } = await import('../../library/gis-library.js');
            const catalog = getGisCatalogService();
            if (catalog?.readFileRange) {
                // Overview PNGs are capped well under the 8 MB range range limit
                const chunk = await catalog.readFileRange(overviewPath, 0, 8 * 1024 * 1024);
                if (chunk?.base64) {
                    dataUrl = `data:image/png;base64,${chunk.base64}`;
                }
            }
        }
    }
    if (!dataUrl || !Array.isArray(coordinates) || coordinates.length !== 4) {
        throw new Error(
            'COG overview is missing. Run Optimize to COG again, or re-import the raster.'
        );
    }
    return createCogLayer({
        name: `${displayName} (COG)`,
        cogPath: item.workingPath || item.managedOriginalPath || item.originalPath,
        libraryItemId: item.id,
        bbox: Array.isArray(bbox) ? bbox : null,
        overviewDataUrl: dataUrl,
        overviewCoordinates: coordinates,
        byteSize: item.byteSize
    });
}

/**
 * Build the best map dataset for a library item (tiles preferred when present).
 * @param {object} item
 * @returns {Promise<object>}
 */
export async function materializeLibraryMapDataset(item) {
    if (!item?.id) throw new Error('Library item required');
    const kind = resolveLibrarySourceKind(item);
    if (kind === 'pmtiles') {
        return pmtilesDatasetFromItem(item);
    }
    if (kind === 'cog') {
        try {
            return await cogDatasetFromItem(item);
        } catch {
            const { optimizeGisLibraryItemToCog } = await import('../../library/gis-library.js');
            const updated = await optimizeGisLibraryItemToCog(item);
            return cogDatasetFromItem(updated || item);
        }
    }
    const result = await readGisLibraryPreview(item.id);
    if (!result?.geojson) throw new Error('No preview available');
    return geojsonPreviewDatasetFromItem(result.item || item, result.geojson);
}
