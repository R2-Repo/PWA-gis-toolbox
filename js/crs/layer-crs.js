/**
 * Layer-level CRS helpers.
 */
import { AppError, ErrorCategory } from '../core/error-handler.js';
import { isSpatialLayer } from '../core/data-model.js';
import { buildCrsWarning, isDisplayReady, looksProjected } from './detect.js';
import { crsLabel, normalizeCrsCode } from './registry.js';

/**
 * @param {object|null|undefined} geojson
 * @returns {[number, number]|null}
 */
export function sampleLayerCoordinate(geojson) {
    const features = geojson?.features || [];
    for (const feature of features) {
        const geometry = feature?.geometry;
        if (!geometry?.coordinates) continue;

        if (geometry.type === 'Point') {
            return geometry.coordinates;
        }
        if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
            return geometry.coordinates[0];
        }
        if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
            return geometry.coordinates[0]?.[0] ?? null;
        }
        if (geometry.type === 'MultiPolygon') {
            return geometry.coordinates[0]?.[0]?.[0] ?? null;
        }
    }
    return null;
}

/**
 * @param {object|null|undefined} geojson
 * @returns {boolean}
 */
export function hasProjectedCoordinates(geojson) {
    const sample = sampleLayerCoordinate(geojson);
    return sample ? looksProjected(sample[0], sample[1]) : false;
}

/**
 * Parse EPSG code embedded in derived layer names like *_reproject_EPSG26912.
 * @param {string} layerName
 * @returns {string|null}
 */
export function parseReprojectSuffixCrs(layerName) {
    const match = String(layerName || '').match(/_reproject_EPSG(\d+)$/i);
    if (!match) return null;
    return normalizeCrsCode(match[1]);
}

/**
 * Resolve the CRS that matches stored coordinates for reprojection.
 * @param {object} layer
 * @param {object|null|undefined} geojson
 * @returns {string}
 */
export function resolveReprojectFromCrs(layer, geojson) {
    const schemaCrs = getLayerCrs(layer);
    const sample = sampleLayerCoordinate(geojson);
    if (!sample) return schemaCrs;

    const coordsProjected = looksProjected(sample[0], sample[1]);
    if (!coordsProjected) return schemaCrs;

    if (!isDisplayReady(schemaCrs) && schemaCrs !== 'UNKNOWN') {
        return schemaCrs;
    }

    const suffixCrs = parseReprojectSuffixCrs(layer.name);
    if (suffixCrs && !isDisplayReady(suffixCrs)) {
        return suffixCrs;
    }

    const originalCrs = layer.source?.originalCrs;
    if (originalCrs) {
        const normalized = normalizeCrsCode(originalCrs);
        if (!isDisplayReady(normalized) && normalized !== 'UNKNOWN') {
            return normalized;
        }
    }

    throw new AppError(
        `Layer "${layer.name}" has projected coordinates but is labeled ${crsLabel(schemaCrs)}. Re-import with the correct source CRS, or delete broken reproject copies and start from the original layer.`,
        ErrorCategory.VALIDATION_ERROR,
        { layerId: layer.id, crs: schemaCrs }
    );
}

/**
 * @param {object} layer
 * @returns {string}
 */
export function getLayerCrs(layer) {
    if (!layer?.schema?.crs) return 'EPSG:4326';
    return normalizeCrsCode(layer.schema.crs);
}

/**
 * @param {object} layer
 * @returns {boolean}
 */
export function isLayerDisplayReady(layer) {
    if (!isSpatialLayer(layer)) return true;
    if (!isDisplayReady(getLayerCrs(layer))) return false;
    if (layer.geojson?.features?.length && hasProjectedCoordinates(layer.geojson)) {
        return false;
    }
    return true;
}

/**
 * @param {object} layer
 * @returns {string}
 */
export function layerCrsWarning(layer) {
    if (!isSpatialLayer(layer)) return '';
    if (layer.source?.crsWarning) return layer.source.crsWarning;
    const crs = getLayerCrs(layer);
    return buildCrsWarning(crs);
}

/**
 * @param {object} layer
 * @param {string} [context]
 */
export function assertDisplayReady(layer, context = 'This operation') {
    if (isLayerDisplayReady(layer)) return;
    const crs = getLayerCrs(layer);
    throw new AppError(
        `${context} requires WGS84 coordinates. Layer "${layer.name}" uses ${crsLabel(crs)}. Reproject to EPSG:4326 first.`,
        ErrorCategory.VALIDATION_ERROR,
        { layerId: layer.id, crs }
    );
}

/**
 * @param {object} layer
 * @returns {string}
 */
export function requireDisplayReadyLayer(layer) {
    assertDisplayReady(layer);
    return layer;
}
