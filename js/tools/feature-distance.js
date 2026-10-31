/**
 * Shared geometric distance helpers (Turf.js global in browser; tests assign globalThis.turf).
 * Used by Proximity Join widget and GIS nearestJoin so behavior stays consistent.
 */

/**
 * @param {number} meters
 * @param {'meters'|'kilometers'|'miles'|'feet'} units
 * @returns {number}
 */
export function metersToDisplayUnits(meters, units) {
    switch (units) {
        case 'feet': return meters * 3.28084;
        case 'kilometers': return meters / 1000;
        case 'miles': return meters * 0.000621371;
        case 'meters':
        default: return meters;
    }
}

/**
 * Representative point for lines/polygons (centroid or center-of-mass).
 * @param {GeoJSON.Feature} feature
 * @param {'centroid'|'centerOfMass'} [method]
 * @returns {number[] | null} [lng, lat]
 */
export function representativePoint(feature, method = 'centroid') {
    if (typeof turf === 'undefined') return null;
    try {
        if (!feature?.geometry) return null;
        const g = feature.geometry;
        if (g.type === 'Point') return g.coordinates;
        if (method === 'centerOfMass' || method === 'center-of-mass') {
            const c = turf.centerOfMass(feature);
            return c.geometry.coordinates;
        }
        const c = turf.centroid(feature);
        return c.geometry.coordinates;
    } catch {
        return null;
    }
}

/**
 * Minimum distance in meters between two features (Point / LineString / MultiLineString / Polygon / MultiPolygon).
 * Point-like sources use actual vertex; lines/polygons use centroid as source probe (matches Proximity Join default).
 *
 * @param {GeoJSON.Feature} srcFeature
 * @param {GeoJSON.Feature} tgtFeature
 * @param {'centroid'|'centerOfMass'} [srcRepMethod]
 * @returns {{ distanceMeters: number, nearestCoord: number[] | null }}
 */
export function computeFeatureDistance(srcFeature, tgtFeature, srcRepMethod = 'centroid') {
    if (typeof turf === 'undefined') {
        return { distanceMeters: Infinity, nearestCoord: null };
    }
    try {
        const sg = srcFeature.geometry;
        const tg = tgtFeature.geometry;
        if (!sg || !tg) return { distanceMeters: Infinity, nearestCoord: null };

        let srcPt;
        if (sg.type === 'Point') {
            srcPt = turf.point(sg.coordinates);
        } else {
            const c = representativePoint(srcFeature, srcRepMethod);
            if (!c) return { distanceMeters: Infinity, nearestCoord: null };
            srcPt = turf.point(c);
        }

        if (tg.type === 'Point') {
            const d = turf.distance(srcPt, tgtFeature, { units: 'meters' });
            return { distanceMeters: d, nearestCoord: tg.coordinates };
        }

        if (tg.type === 'MultiPoint') {
            let best = Infinity;
            let nearestCoord = null;
            for (const coord of tg.coordinates) {
                const d = turf.distance(srcPt, turf.point(coord), { units: 'meters' });
                if (d < best) {
                    best = d;
                    nearestCoord = coord;
                }
            }
            return { distanceMeters: best, nearestCoord };
        }

        if (tg.type === 'LineString') {
            const snapped = turf.nearestPointOnLine(tgtFeature, srcPt, { units: 'meters' });
            return {
                distanceMeters: snapped.properties.dist ?? Infinity,
                nearestCoord: snapped.geometry.coordinates
            };
        }

        if (tg.type === 'MultiLineString') {
            let best = Infinity;
            let nearestCoord = null;
            for (const coords of tg.coordinates) {
                const seg = turf.lineString(coords);
                const snapped = turf.nearestPointOnLine(seg, srcPt, { units: 'meters' });
                const d = snapped.properties.dist ?? Infinity;
                if (d < best) {
                    best = d;
                    nearestCoord = snapped.geometry.coordinates;
                }
            }
            return { distanceMeters: best, nearestCoord };
        }

        if (tg.type === 'Polygon' || tg.type === 'MultiPolygon') {
            if (turf.booleanPointInPolygon(srcPt, tgtFeature)) {
                return { distanceMeters: 0, nearestCoord: srcPt.geometry.coordinates };
            }
            try {
                const line = turf.polygonToLine(tgtFeature);
                const snapped = turf.nearestPointOnLine(line, srcPt, { units: 'meters' });
                return {
                    distanceMeters: snapped.properties.dist ?? Infinity,
                    nearestCoord: snapped.geometry.coordinates
                };
            } catch {
                const c = turf.centroid(tgtFeature);
                const d = turf.distance(srcPt, c, { units: 'meters' });
                return { distanceMeters: d, nearestCoord: c.geometry.coordinates };
            }
        }

        const c = turf.centroid(tgtFeature);
        const d = turf.distance(srcPt, c, { units: 'meters' });
        return { distanceMeters: d, nearestCoord: c.geometry.coordinates };
    } catch {
        return { distanceMeters: Infinity, nearestCoord: null };
    }
}
