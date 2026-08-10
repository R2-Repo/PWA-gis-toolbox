/**
 * Build import CRS metadata from shapefile .prj WKT.
 * shpjs reprojects coords to WGS84 when .prj present — schema.crs stays 4326.
 * Missing .prj is NOT assumed WGS84 when coordinates look projected.
 */
import { buildCrsWarning, isDisplayReady, parsePrjWkt } from '../crs/detect.js';
import { normalizeCrsCode } from '../crs/registry.js';
import { isSpatialLayer } from '../core/data-model.js';
import { hasProjectedCoordinates } from '../crs/layer-crs.js';

/**
 * Apply CRS metadata to imported datasets without mutating coordinates.
 * @param {object|object[]} result
 * @param {{ sourceCrs?: string, crsDetected?: string }} [options]
 * @returns {object|object[]}
 */
export function applyImportCrsMetadata(result, options = {}) {
    if (Array.isArray(result)) {
        return result.map((ds) => _applyToDataset(ds, options));
    }
    return _applyToDataset(result, options);
}

function _applyToDataset(dataset, options) {
    if (!dataset || !isSpatialLayer(dataset)) return dataset;

    if (options.sourceCrs && dataset.schema) {
        dataset.schema.crs = normalizeCrsCode(options.sourceCrs);
    }

    if (dataset._importCrs) {
        const meta = dataset._importCrs;
        if (meta.crs) dataset.schema.crs = normalizeCrsCode(meta.crs);
        if (meta.crsWkt) dataset.schema.crsWkt = meta.crsWkt;
        if (meta.originalCrs) dataset.source.originalCrs = meta.originalCrs;
        if (meta.crsDetected) dataset.source.crsDetected = meta.crsDetected;
        delete dataset._importCrs;
    }

    const crs = dataset.schema?.crs || 'EPSG:4326';
    if (!isDisplayReady(crs)) {
        dataset.source.crsWarning = buildCrsWarning(crs);
    }

    return dataset;
}

/**
 * @param {string|null} prjWkt
 * @param {object|null} [geojson] optional — used to detect projected coords when .prj missing
 * @returns {{
 *   crs: string,
 *   originalCrs?: string,
 *   crsDetected: 'prj'|'extent'|'unknown',
 *   crsWkt?: string,
 *   crsWarning?: string
 * }}
 */
export function shapefileCrsFromPrj(prjWkt, geojson = null) {
    if (!prjWkt) {
        if (geojson && hasProjectedCoordinates(geojson)) {
            return {
                crs: 'UNKNOWN',
                crsDetected: 'unknown',
                crsWarning: buildCrsWarning('UNKNOWN')
            };
        }
        // Geographic-looking coords without .prj — assume WGS84; soft note only.
        return {
            crs: 'EPSG:4326',
            crsDetected: 'extent'
        };
    }

    const parsed = parsePrjWkt(prjWkt);
    const originalCrs = parsed.epsg || 'CUSTOM';
    return {
        crs: 'EPSG:4326',
        originalCrs,
        crsDetected: 'prj',
        crsWkt: parsed.wkt
    };
}

/**
 * Build import CRS metadata for projected tabular coordinates.
 * @param {string} [sourceCrs]
 */
export function projectedTableCrsMetadata(sourceCrs) {
    const crs = sourceCrs ? normalizeCrsCode(sourceCrs) : 'UNKNOWN';
    return {
        crs,
        crsDetected: sourceCrs ? 'user' : 'extent',
        crsWarning: buildCrsWarning(crs)
    };
}
