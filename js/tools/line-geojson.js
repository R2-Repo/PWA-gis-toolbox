/**
 * LineString / MultiLineString helpers for GIS tools (expects global Turf in browser).
 */

/**
 * Iterate synthetic LineString features (explodes MultiLineString parts).
 * @param {GeoJSON.FeatureCollection} geojson
 * @param {(lineFeat: GeoJSON.Feature<GeoJSON.LineString>) => void} fn
 */
export function forEachLineStringFeature(geojson, fn) {
    const features = geojson?.features || [];
    for (const f of features) {
        const g = f.geometry;
        if (!g) continue;
        if (g.type === 'LineString') {
            fn(f);
        } else if (g.type === 'MultiLineString') {
            for (const coords of g.coordinates) {
                fn({
                    type: 'Feature',
                    properties: { ...f.properties },
                    geometry: { type: 'LineString', coordinates: coords }
                });
            }
        }
    }
}

/**
 * First LineString feature in collection order (first segment of MultiLineString if no plain LineString).
 * @param {GeoJSON.FeatureCollection} geojson
 * @returns {GeoJSON.Feature<GeoJSON.LineString> | null}
 */
export function findFirstLineStringFeature(geojson) {
    let found = null;
    forEachLineStringFeature(geojson, (lf) => {
        if (!found) found = lf;
    });
    return found;
}

/** All LineString features (MultiLineString exploded to segments). */
export function listLineStringFeatures(geojson) {
    const out = [];
    forEachLineStringFeature(geojson, (lf) => { out.push(lf); });
    return out;
}

/**
 * Shortest point-to-line distance for LineString or MultiLineString.
 * @param {GeoJSON.Feature<GeoJSON.Point>} pointFeature
 * @param {GeoJSON.Feature} lineFeature LineString or MultiLineString
 * @param {string} [units]
 * @returns {number}
 */
export function pointToLineDistanceAny(pointFeature, lineFeature, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = lineFeature.geometry;
    if (!g) throw new Error('Line feature has no geometry');
    if (g.type === 'LineString') {
        return turf.pointToLineDistance(pointFeature, lineFeature, { units });
    }
    if (g.type === 'MultiLineString') {
        let min = Infinity;
        for (const coords of g.coordinates) {
            const seg = turf.lineString(coords);
            const d = turf.pointToLineDistance(pointFeature, seg, { units });
            if (d < min) min = d;
        }
        return min;
    }
    throw new Error('Need LineString or MultiLineString');
}

/**
 * Nearest snap on LineString or MultiLineString (minimum distance segment wins).
 * @param {GeoJSON.Feature<GeoJSON.Point>} pointFeature
 * @param {GeoJSON.Feature} lineFeature
 * @param {string} [units]
 * @returns {GeoJSON.Feature<GeoJSON.Point>}
 */
export function nearestPointOnLineAny(pointFeature, lineFeature, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = lineFeature.geometry;
    if (!g) throw new Error('Line feature has no geometry');
    if (g.type === 'LineString') {
        return turf.nearestPointOnLine(lineFeature, pointFeature, { units });
    }
    if (g.type === 'MultiLineString') {
        let best = null;
        let bestD = Infinity;
        for (const coords of g.coordinates) {
            const seg = turf.lineString(coords);
            const snap = turf.nearestPointOnLine(seg, pointFeature, { units });
            const d = snap.properties.dist ?? Infinity;
            if (d < bestD) {
                bestD = d;
                best = snap;
            }
        }
        if (!best) throw new Error('Empty MultiLineString');
        return best;
    }
    throw new Error('Need LineString or MultiLineString');
}

/**
 * Total length of a LineString or MultiLineString (sum of all parts).
 * @param {GeoJSON.Feature} lineFeature
 * @param {string} [units]
 */
export function lineLengthAny(lineFeature, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = lineFeature?.geometry;
    if (!g) return 0;
    if (g.type === 'LineString') {
        return turf.length(lineFeature, { units });
    }
    if (g.type === 'MultiLineString') {
        return (g.coordinates || []).reduce((sum, coords) => {
            return sum + turf.length(turf.lineString(coords), { units });
        }, 0);
    }
    return 0;
}

/**
 * Ordered route segments with cumulative offsets for MultiLineString routes.
 * @param {GeoJSON.Feature} lineFeature
 * @param {string} [units]
 */
export function listRouteLineSegments(lineFeature, units = 'kilometers') {
    const g = lineFeature?.geometry;
    if (!g) return [];

    const props = lineFeature.properties || {};
    if (g.type === 'LineString') {
        const feature = { type: 'Feature', geometry: g, properties: { ...props } };
        return [{ feature, startOffset: 0, length: turf.length(feature, { units }) }];
    }

    if (g.type === 'MultiLineString') {
        const segments = [];
        let startOffset = 0;
        for (const coords of g.coordinates || []) {
            const feature = {
                type: 'Feature',
                properties: { ...props },
                geometry: { type: 'LineString', coordinates: coords }
            };
            const length = turf.length(feature, { units });
            segments.push({ feature, startOffset, length });
            startOffset += length;
        }
        return segments;
    }

    throw new Error('Need LineString or MultiLineString');
}

/**
 * Snap a click to the nearest point on a route line using cumulative distance along all parts.
 * `properties.location` is distance from the route start in the given units.
 * @param {GeoJSON.Feature<GeoJSON.Point>} pointFeature
 * @param {GeoJSON.Feature} lineFeature
 * @param {string} [units]
 */
export function nearestPointOnRouteLine(pointFeature, lineFeature, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const g = lineFeature?.geometry;
    if (!g) throw new Error('Line feature has no geometry');

    if (g.type === 'LineString') {
        return turf.nearestPointOnLine(lineFeature, pointFeature, { units });
    }

    if (g.type === 'MultiLineString') {
        let best = null;
        let bestDist = Infinity;
        for (const { feature, startOffset } of listRouteLineSegments(lineFeature, units)) {
            const snap = turf.nearestPointOnLine(feature, pointFeature, { units });
            const distToClick = snap.properties?.dist ?? Infinity;
            if (distToClick < bestDist) {
                bestDist = distToClick;
                const location = startOffset + Number(snap.properties?.location ?? 0);
                best = {
                    ...snap,
                    properties: {
                        ...snap.properties,
                        dist: distToClick,
                        location,
                        segmentStartOffset: startOffset
                    }
                };
            }
        }
        if (!best) throw new Error('Empty MultiLineString');
        return best;
    }

    throw new Error('Need LineString or MultiLineString');
}

/**
 * Point at a cumulative distance along a LineString or MultiLineString.
 * Distance walks parts in order and does not jump across spatial gaps.
 * @param {GeoJSON.Feature} lineFeature
 * @param {number} distance
 * @param {string} [units]
 */
export function pointAlongRoute(lineFeature, distance, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const segments = listRouteLineSegments(lineFeature, units);
    if (!segments.length) throw new Error('Route line is empty.');

    const total = segments.reduce((sum, seg) => sum + seg.length, 0);
    let remaining = Math.max(0, Math.min(Number(distance) || 0, total));
    let chosen = segments[segments.length - 1];
    let local = chosen.length;

    for (const seg of segments) {
        if (remaining <= seg.length) {
            chosen = seg;
            local = remaining;
            break;
        }
        remaining -= seg.length;
    }

    return turf.along(chosen.feature, Math.max(0, Math.min(local, chosen.length)), { units });
}

function coordinatesTouch(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a[0] === b[0] && a[1] === b[1];
}

/**
 * Slice a route between cumulative distances.
 * Touching parts are joined. A spatial gap stays a separate part so the slice
 * does not draw a straight chord across missing centerline.
 * @param {GeoJSON.Feature} lineFeature
 * @param {number} startDist
 * @param {number} stopDist
 * @param {string} [units]
 */
export function lineSliceAlongRouteParts(lineFeature, startDist, stopDist, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const start = Math.min(startDist, stopDist);
    const stop = Math.max(startDist, stopDist);
    const g = lineFeature?.geometry;
    if (!g) throw new Error('Line feature has no geometry');

    if (g.type === 'LineString') {
        return turf.lineSliceAlong(lineFeature, start, stop, { units });
    }

    if (g.type !== 'MultiLineString') {
        throw new Error('Need LineString or MultiLineString');
    }

    const segments = listRouteLineSegments(lineFeature, units);
    const parts = [];

    for (const { feature, startOffset, length } of segments) {
        const segEnd = startOffset + length;
        if (stop <= startOffset || start >= segEnd) continue;

        const localStart = Math.max(0, start - startOffset);
        const localStop = Math.min(length, stop - startOffset);
        if (localStop - localStart <= 1e-6) continue;

        const part = turf.lineSliceAlong(feature, localStart, localStop, { units });
        const partCoords = part.geometry?.coordinates || [];
        if (partCoords.length < 2) continue;

        const prev = parts[parts.length - 1];
        if (prev && coordinatesTouch(prev[prev.length - 1], partCoords[0])) {
            prev.push(...partCoords.slice(1));
        } else {
            parts.push(partCoords);
        }
    }

    if (!parts.length) {
        throw new Error('Clip range does not intersect route geometry.');
    }

    return {
        type: 'Feature',
        properties: { ...(lineFeature.properties || {}) },
        geometry: parts.length === 1
            ? { type: 'LineString', coordinates: parts[0] }
            : { type: 'MultiLineString', coordinates: parts }
    };
}

/**
 * Slice a route line between cumulative start/stop distances (supports MultiLineString gaps).
 * @param {GeoJSON.Feature} lineFeature
 * @param {number} startDist
 * @param {number} stopDist
 * @param {string} [units]
 */
export function lineSliceAlongRoute(lineFeature, startDist, stopDist, units = 'kilometers') {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');

    const start = Math.min(startDist, stopDist);
    const stop = Math.max(startDist, stopDist);
    const g = lineFeature?.geometry;
    if (!g) throw new Error('Line feature has no geometry');

    if (g.type === 'LineString') {
        return turf.lineSliceAlong(lineFeature, start, stop, { units });
    }

    if (g.type === 'MultiLineString') {
        const segments = listRouteLineSegments(lineFeature, units);
        const coordsOut = [];

        for (const { feature, startOffset, length } of segments) {
            const segEnd = startOffset + length;
            if (stop <= startOffset || start >= segEnd) continue;

            const localStart = Math.max(0, start - startOffset);
            const localStop = Math.min(length, stop - startOffset);
            if (localStop <= localStart) continue;

            const part = turf.lineSliceAlong(feature, localStart, localStop, { units });
            const partCoords = part.geometry?.coordinates || [];
            if (!partCoords.length) continue;

            if (coordsOut.length) {
                const last = coordsOut[coordsOut.length - 1];
                const first = partCoords[0];
                if (last[0] === first[0] && last[1] === first[1]) {
                    coordsOut.push(...partCoords.slice(1));
                } else {
                    coordsOut.push(...partCoords);
                }
            } else {
                coordsOut.push(...partCoords);
            }
        }

        if (coordsOut.length < 2) {
            throw new Error('Clip range does not intersect route geometry.');
        }

        return {
            type: 'Feature',
            properties: { ...(lineFeature.properties || {}) },
            geometry: { type: 'LineString', coordinates: coordsOut }
        };
    }

    throw new Error('Need LineString or MultiLineString');
}
