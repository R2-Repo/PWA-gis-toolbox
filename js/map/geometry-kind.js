/**
 * Shared geometry mix for style and labels.
 * Results are cached on the features array so a second pass in the same
 * turn does not scan coordinates again. A new array (filter, re-import)
 * misses the cache.
 */

const presenceCache = new WeakMap();

function emptyPresence() {
    return { hasPoints: false, hasLines: false, hasPolygons: false };
}

function cacheKey(schemaGeometryType, includeSchema) {
    return `${includeSchema ? 1 : 0}|${schemaGeometryType || ''}`;
}

function applySchema(presence, schemaGeometryType) {
    const geometryType = String(schemaGeometryType || '');
    if (!geometryType) return presence;
    if (geometryType === 'Mixed') {
        return { hasPoints: true, hasLines: true, hasPolygons: true };
    }
    const next = { ...presence };
    if (geometryType === 'Point' || geometryType === 'MultiPoint') next.hasPoints = true;
    else if (geometryType === 'LineString' || geometryType === 'MultiLineString') next.hasLines = true;
    else if (geometryType === 'Polygon' || geometryType === 'MultiPolygon') next.hasPolygons = true;
    return next;
}

function computePresence(features, schemaGeometryType, includeSchema) {
    const presence = emptyPresence();
    for (const feature of features || []) {
        const type = feature?.geometry?.type;
        if (type === 'Point' || type === 'MultiPoint') presence.hasPoints = true;
        else if (type === 'LineString' || type === 'MultiLineString') presence.hasLines = true;
        else if (type === 'Polygon' || type === 'MultiPolygon') presence.hasPolygons = true;
    }
    if (!includeSchema) return presence;
    return applySchema(presence, schemaGeometryType);
}

/**
 * @param {object[]|null|undefined} features
 * @param {string|null|undefined} schemaGeometryType
 * @param {{ includeSchema?: boolean }} [opts]
 * @returns {{ hasPoints: boolean, hasLines: boolean, hasPolygons: boolean }}
 */
export function geometryPresence(features, schemaGeometryType, { includeSchema = false } = {}) {
    const key = cacheKey(schemaGeometryType, includeSchema);
    if (features && typeof features === 'object') {
        let bucket = presenceCache.get(features);
        if (!bucket) {
            bucket = new Map();
            presenceCache.set(features, bucket);
        }
        const hit = bucket.get(key);
        if (hit) return hit;
        const presence = computePresence(features, schemaGeometryType, includeSchema);
        bucket.set(key, presence);
        return presence;
    }
    return computePresence(features, schemaGeometryType, includeSchema);
}

/**
 * @param {{ hasPoints?: boolean, hasLines?: boolean, hasPolygons?: boolean }} presence
 * @returns {Set<'point'|'line'|'polygon'>}
 */
export function kindsFromPresence(presence) {
    const kinds = new Set();
    if (presence?.hasPoints) kinds.add('point');
    if (presence?.hasLines) kinds.add('line');
    if (presence?.hasPolygons) kinds.add('polygon');
    return kinds;
}

/**
 * Feature geometries only. Schema is ignored so an empty packet stays empty.
 * @param {object|null|undefined} layer
 * @returns {Set<'point'|'line'|'polygon'>}
 */
export function detectGeometryKinds(layer) {
    return kindsFromPresence(geometryPresence(layer?.geojson?.features, null, { includeSchema: false }));
}

/**
 * Style-panel kinds: scan features, then the schema when nothing was found.
 * @param {object|null|undefined} layer
 * @returns {Set<'point'|'line'|'polygon'>}
 */
export function layerGeometryKinds(layer) {
    const features = layer?.geojson?.features;
    const seen = geometryPresence(features, null, { includeSchema: false });
    if (seen.hasPoints || seen.hasLines || seen.hasPolygons) return kindsFromPresence(seen);
    return kindsFromPresence(geometryPresence(features, layer?.schema?.geometryType, { includeSchema: true }));
}
