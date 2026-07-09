/**
 * GIS tool eligibility for the map right-click context menu.
 */
import { getEnabledMapGisTools } from './tool-catalog.js';
import { isSpatialLayer, isServiceLayer, isWorkspaceLayer } from '../core/data-model.js';
import { isCoverageRasterLayer } from '../core/coverage-raster-layer.js';

/** @type {Record<string, string[]|null>} null = any geometry type */
const TOOL_GEOM_TYPES = {
    buffer: null,
    simplify: ['LineString', 'Polygon'],
    'clip-extent': null,
    'bbox-clip': null,
    dissolve: ['Polygon'],
    'line-offset': ['LineString'],
    reproject: null,
    union: ['Polygon'],
    kinks: null,
    sample: null,
    explode: ['LineString', 'Polygon']
};

const GEOM_FAMILIES = {
    Point: ['Point', 'MultiPoint'],
    LineString: ['LineString', 'MultiLineString'],
    Polygon: ['Polygon', 'MultiPolygon']
};

/**
 * @param {object|null|undefined} feature
 * @param {string[]|null|undefined} geomTypes
 * @returns {boolean}
 */
export function featureMatchesGeomTypes(feature, geomTypes) {
    const type = feature?.geometry?.type;
    if (!type) return false;
    if (!geomTypes || geomTypes.length === 0) return true;
    return geomTypes.some((allowed) => {
        const family = GEOM_FAMILIES[allowed] || [allowed];
        return family.includes(type);
    });
}

/**
 * @param {object|null|undefined} layer
 * @returns {boolean}
 */
export function isLayerEligibleForContextMenuTools(layer) {
    return !!layer
        && isSpatialLayer(layer)
        && !isServiceLayer(layer)
        && !isCoverageRasterLayer(layer);
}

/**
 * @param {object|null|undefined} layer
 * @returns {boolean}
 */
export function isLayerFeatureDeletable(layer) {
    return !!layer
        && layer.type === 'spatial'
        && !isWorkspaceLayer(layer)
        && !isCoverageRasterLayer(layer);
}

/**
 * @param {object|null|undefined} layer
 * @param {object|null|undefined} feature
 * @returns {import('./tool-catalog.js').MapGisToolDef[]}
 */
export function getContextMenuGisTools(layer, feature) {
    if (!isLayerEligibleForContextMenuTools(layer) || !feature) return [];
    return getEnabledMapGisTools().filter((tool) => {
        const geomTypes = TOOL_GEOM_TYPES[tool.id] ?? null;
        return featureMatchesGeomTypes(feature, geomTypes);
    });
}
