/**
 * Dataset profile — Phase 2 adaptive import.
 *
 * Separate pressures (feature / geometry / attribute / storage / import), not one
 * mystery complexity score. Built during stream/convert; attached to layer meta.
 *
 * @see docs/IMPORT_LARGE_FILES.md
 */

export const DATASET_PROFILE_VERSION = 1;

/**
 * @param {object|null|undefined} geometry
 * @returns {number}
 */
export function countGeometryCoordinates(geometry) {
    if (!geometry?.coordinates) {
        if (geometry?.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
            let n = 0;
            for (const g of geometry.geometries) n += countGeometryCoordinates(g);
            return n;
        }
        return 0;
    }
    return _countCoordsDeep(geometry.coordinates);
}

function _countCoordsDeep(node) {
    if (!Array.isArray(node) || node.length === 0) return 0;
    if (typeof node[0] === 'number') return 1;
    let n = 0;
    for (const child of node) n += _countCoordsDeep(child);
    return n;
}

/**
 * @param {number[]|null|undefined} bbox
 * @param {object|null|undefined} geometry
 * @returns {number[]|null} [west, south, east, north]
 */
export function expandBboxWithGeometry(bbox, geometry) {
    if (!geometry) return bbox || null;
    const acc = bbox
        ? [bbox[0], bbox[1], bbox[2], bbox[3]]
        : [Infinity, Infinity, -Infinity, -Infinity];
    const expand = (node) => {
        if (!Array.isArray(node) || node.length === 0) return;
        if (typeof node[0] === 'number') {
            const lon = node[0];
            const lat = node[1];
            if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
            if (lon < acc[0]) acc[0] = lon;
            if (lat < acc[1]) acc[1] = lat;
            if (lon > acc[2]) acc[2] = lon;
            if (lat > acc[3]) acc[3] = lat;
            return;
        }
        for (const child of node) expand(child);
    };
    if (geometry.type === 'GeometryCollection') {
        for (const g of geometry.geometries || []) {
            if (g?.coordinates) expand(g.coordinates);
        }
    } else if (geometry.coordinates) {
        expand(geometry.coordinates);
    }
    if (!Number.isFinite(acc[0])) return bbox || null;
    return acc;
}

/** @param {string|null|undefined} geomType */
export function geometryClassKey(geomType) {
    if (!geomType) return null;
    if (geomType === 'Point' || geomType === 'MultiPoint') return 'point';
    if (geomType === 'LineString' || geomType === 'MultiLineString') return 'line';
    if (geomType === 'Polygon' || geomType === 'MultiPolygon') return 'polygon';
    return null;
}

/**
 * Mutable accumulator for stream worker / convert path.
 * @returns {object}
 */
export function createProfileAccumulator() {
    return {
        featureCount: 0,
        noGeometryCount: 0,
        coordCount: 0,
        maxCoordsInFeature: 0,
        bbox: null,
        geometryClassCounts: { point: 0, line: 0, polygon: 0 },
        geometryTypes: new Set()
    };
}

/**
 * @param {object} acc
 * @param {object} feature
 */
export function observeFeatureForProfile(acc, feature) {
    if (!acc || !feature) return;
    acc.featureCount++;
    const geometry = feature.geometry;
    if (!geometry) {
        acc.noGeometryCount++;
        return;
    }
    if (geometry.type) acc.geometryTypes.add(geometry.type);
    const cls = geometryClassKey(geometry.type);
    if (cls) acc.geometryClassCounts[cls] = (acc.geometryClassCounts[cls] || 0) + 1;
    const coords = countGeometryCoordinates(geometry);
    acc.coordCount += coords;
    if (coords > acc.maxCoordsInFeature) acc.maxCoordsInFeature = coords;
    acc.bbox = expandBboxWithGeometry(acc.bbox, geometry);
}

/**
 * @param {object} acc
 * @param {{
 *   importMethod?: string,
 *   format?: string,
 *   fileSize?: number,
 *   bytesProcessed?: number,
 *   fieldCount?: number,
 *   fenceFiltered?: number,
 *   featureFiltered?: number,
 *   estimates?: object|null
 * }} [meta]
 */
export function finalizeDatasetProfile(acc, meta = {}) {
    const featureCount = acc?.featureCount || 0;
    const coordCount = acc?.coordCount || 0;
    const fieldCount = meta.fieldCount ?? null;
    const avgCoordsPerFeature = featureCount > 0 ? coordCount / featureCount : 0;
    const geometryTypes = acc?.geometryTypes instanceof Set
        ? [...acc.geometryTypes]
        : Array.isArray(acc?.geometryTypes) ? acc.geometryTypes : [];

    const geometryClassCounts = {};
    for (const [k, v] of Object.entries(acc?.geometryClassCounts || {})) {
        if (v > 0) geometryClassCounts[k] = v;
    }

    const profile = {
        version: DATASET_PROFILE_VERSION,
        featureCount,
        noGeometryCount: acc?.noGeometryCount || 0,
        coordCount,
        avgCoordsPerFeature: Math.round(avgCoordsPerFeature * 100) / 100,
        maxCoordsInFeature: acc?.maxCoordsInFeature || 0,
        geometryClassCounts,
        geometryTypes,
        bbox: Array.isArray(acc?.bbox) ? acc.bbox : null,
        fieldCount,
        fenceFiltered: meta.fenceFiltered || 0,
        featureFiltered: meta.featureFiltered || 0,
        import: {
            method: meta.importMethod || 'unknown',
            format: meta.format || 'unknown',
            ...(meta.fileSize != null ? { fileSize: meta.fileSize } : {}),
            ...(meta.bytesProcessed != null ? { bytesProcessed: meta.bytesProcessed } : {})
        },
        estimates: meta.estimates || null,
        pressures: buildProfilePressures({
            featureCount,
            avgCoordsPerFeature,
            coordCount,
            fieldCount,
            fileSize: meta.fileSize
        }),
        computedAt: new Date().toISOString()
    };
    return profile;
}

/**
 * Separate pressure labels — not a single score.
 * @param {{
 *   featureCount?: number,
 *   avgCoordsPerFeature?: number,
 *   coordCount?: number,
 *   fieldCount?: number|null,
 *   fileSize?: number
 * }} input
 */
export function buildProfilePressures(input = {}) {
    const featureCount = input.featureCount || 0;
    const avgCoords = input.avgCoordsPerFeature || 0;
    const coordCount = input.coordCount || 0;
    const fieldCount = input.fieldCount;
    const fileSize = input.fileSize || 0;

    /** @type {'low'|'moderate'|'high'} */
    let feature = 'low';
    if (featureCount >= 250_000) feature = 'high';
    else if (featureCount >= 50_000) feature = 'moderate';

    let geometry = 'low';
    if (coordCount >= 2_000_000 || avgCoords >= 80) geometry = 'high';
    else if (coordCount >= 500_000 || avgCoords >= 25) geometry = 'moderate';

    let attribute = 'low';
    if (fieldCount != null) {
        if (fieldCount >= 80) attribute = 'high';
        else if (fieldCount >= 25) attribute = 'moderate';
    }

    let storage = 'low';
    if (fileSize >= 200 * 1024 * 1024 || featureCount >= 250_000) storage = 'high';
    else if (fileSize >= 20 * 1024 * 1024 || featureCount >= 50_000) storage = 'moderate';

    return { feature, geometry, attribute, storage };
}

/**
 * Build a profile by scanning an in-memory FeatureCollection (convert path).
 * @param {object[]} features
 * @param {object} [meta]
 */
export function buildDatasetProfileFromFeatures(features, meta = {}) {
    const acc = createProfileAccumulator();
    for (const f of features || []) observeFeatureForProfile(acc, f);
    return finalizeDatasetProfile(acc, meta);
}

/**
 * Slice a global worker accumulator into a per-geometry-class profile.
 * @param {object} globalAcc finalized-like stats from worker
 * @param {string} classKey point|line|polygon
 * @param {number} classFeatureCount
 * @param {object} meta
 */
export function profileForGeometryClass(globalStats, classKey, classFeatureCount, meta = {}) {
    const total = globalStats?.featureCount || 0;
    const ratio = total > 0 ? classFeatureCount / total : 0;
    const acc = {
        featureCount: classFeatureCount,
        noGeometryCount: classKey ? 0 : (globalStats?.noGeometryCount || 0),
        coordCount: Math.round((globalStats?.coordCount || 0) * ratio),
        maxCoordsInFeature: globalStats?.maxCoordsInFeature || 0,
        bbox: globalStats?.bbox || null,
        geometryClassCounts: { [classKey]: classFeatureCount },
        geometryTypes: globalStats?.geometryTypes || []
    };
    return finalizeDatasetProfile(acc, meta);
}

/**
 * Prefer local MVT earlier when geometry pressure is high (Phase 2 light hook).
 * @param {object|null|undefined} layer
 * @param {number} featureCount
 * @param {number} tiledThreshold
 * @returns {boolean}
 */
export function profileSuggestsTiledDisplay(layer, featureCount, tiledThreshold = 50_000) {
    if (featureCount >= tiledThreshold) return true;
    const p = layer?.datasetProfile;
    if (!p) return false;
    if ((p.coordCount || 0) >= 2_000_000) return true;
    if (featureCount >= 15_000 && (p.avgCoordsPerFeature || 0) >= 40) return true;
    if (p.pressures?.geometry === 'high' && featureCount >= 15_000) return true;
    return false;
}

export default {
    DATASET_PROFILE_VERSION,
    countGeometryCoordinates,
    expandBboxWithGeometry,
    geometryClassKey,
    createProfileAccumulator,
    observeFeatureForProfile,
    finalizeDatasetProfile,
    buildProfilePressures,
    buildDatasetProfileFromFeatures,
    profileForGeometryClass,
    profileSuggestsTiledDisplay
};
