/**
 * Resolve CRS metadata for imported datasets that need user confirmation.
 * When the user picks a source CRS and coordinates look projected, reproject
 * the in-memory FeatureCollection to WGS84.
 */
import { isSpatialLayer, analyzeSchema } from '../core/data-model.js';
import { buildCrsWarning, isDisplayReady } from '../crs/detect.js';
import { normalizeCrsCode } from '../crs/registry.js';
import { hasProjectedCoordinates } from '../crs/layer-crs.js';
import { reprojectFeatureCollection } from '../crs/reproject.js';

/**
 * @param {object[]} datasets
 * @param {(opts: object) => Promise<string|null>} pickCrs - modal callback
 */
export async function resolveImportCrsForDatasets(datasets, pickCrs) {
    if (!pickCrs) return datasets;

    for (const ds of datasets) {
        if (!isSpatialLayer(ds)) continue;
        const crs = ds.schema?.crs;
        const needsPrompt = crs === 'UNKNOWN' || (!!ds.source?.crsWarning && !isDisplayReady(crs));
        if (!needsPrompt) continue;

        const picked = await pickCrs({
            layerName: ds.name,
            message: ds.source?.crsWarning,
            defaultCrs: 'EPSG:6337'
        });

        if (!picked) continue;

        const normalized = normalizeCrsCode(picked);
        const projected = ds.geojson?.features?.length && hasProjectedCoordinates(ds.geojson);

        if (projected && !isDisplayReady(normalized)) {
            try {
                ds.geojson = await reprojectFeatureCollection(ds.geojson, normalized, 'EPSG:4326');
                ds.schema = analyzeSchema(ds.geojson);
                ds.schema.crs = 'EPSG:4326';
                ds.source.originalCrs = normalized;
                ds.source.crsDetected = 'user';
                delete ds.source.crsWarning;
                continue;
            } catch {
                // Fall through to metadata-only update
            }
        }

        ds.schema.crs = normalized;
        ds.source.crsDetected = 'user';
        if (isDisplayReady(normalized)) {
            delete ds.source.crsWarning;
        } else {
            ds.source.crsWarning = buildCrsWarning(normalized);
        }
    }

    return datasets;
}
