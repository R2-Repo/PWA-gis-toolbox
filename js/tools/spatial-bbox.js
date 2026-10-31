/**
 * Axis-aligned geographic bbox helpers for spatial pruning (correct lower bounds).
 * Used by GIS tools and Proximity Join to skip impossible pairs.
 */

/** Sort B by separation from each A when |B| reaches this (enables early exit). */
export const NEAREST_JOIN_SORT_THRESHOLD = 64;

/**
 * @param {GeoJSON.Feature} feature
 * @returns {number[] | null} [west, south, east, north]
 */
export function getFeatureBBox(feature) {
    if (typeof turf === 'undefined') return null;
    try {
        if (!feature?.geometry) return null;
        return turf.bbox(feature);
    } catch {
        return null;
    }
}

/**
 * @param {GeoJSON.Geometry | GeoJSON.Feature} geomOrFeature
 * @returns {number[] | null}
 */
export function getBBoxAny(geomOrFeature) {
    if (typeof turf === 'undefined') return null;
    try {
        if (!geomOrFeature) return null;
        if (geomOrFeature.type === 'Feature') return turf.bbox(geomOrFeature);
        return turf.bbox(turf.feature(geomOrFeature));
    } catch {
        return null;
    }
}

/**
 * Expand [west,south,east,north] into one or more segments with west <= east in [-180, 180].
 * Handles MapLibre unwrapped bounds and dateline-crossing boxes (west > east).
 * @param {number[]} box
 * @returns {number[][]}
 */
export function bboxToLngSegments(box) {
    let [w, s, e, n] = box;
    if (![w, s, e, n].every(Number.isFinite)) return [];
    if (e - w >= 360) return [[-180, s, 180, n]];

    if (w > e) {
        return [[w, s, 180, n], [-180, s, e, n]];
    }

    if (w >= -180 && e <= 180) {
        return [[w, s, e, n]];
    }

    if (w < -180) {
        w += 360;
        e += 360;
    }
    if (e > 180) {
        return [[w, s, 180, n], [-180, s, e - 360, n]];
    }
    return [[w, s, e, n]];
}

function segmentsOverlapOnY(a, b) {
    return !(a[3] < b[1] || b[3] < a[1]);
}

function segmentsOverlapOnX(a, b) {
    return !(a[2] < b[0] || b[2] < a[0]);
}

/** Two lng/lat bboxes intersect (closed intervals), including antimeridian spans. */
export function bboxOverlap(boxA, boxB) {
    const segsA = bboxToLngSegments(boxA);
    const segsB = bboxToLngSegments(boxB);
    if (segsA.length === 0 || segsB.length === 0) return false;
    for (const a of segsA) {
        for (const b of segsB) {
            if (segmentsOverlapOnX(a, b) && segmentsOverlapOnY(a, b)) return true;
        }
    }
    return false;
}

/**
 * Clip geometry for an axis-aligned map extent (handles dateline / unwrapped bounds).
 * @param {number} west
 * @param {number} south
 * @param {number} east
 * @param {number} north
 * @returns {import('geojson').Polygon | import('geojson').MultiPolygon}
 */
export function bboxToClipGeometry(west, south, east, north) {
    if (typeof turf === 'undefined') {
        throw new Error('Turf.js not loaded');
    }
    const segments = bboxToLngSegments([west, south, east, north]);
    if (segments.length === 0) {
        throw new Error('Invalid clip bounds');
    }
    if (segments.length === 1) {
        const [w, s, e, n] = segments[0];
        return turf.bboxPolygon([w, s, e, n]).geometry;
    }
    return {
        type: 'MultiPolygon',
        coordinates: segments.map(([w, s, e, n]) => turf.bboxPolygon([w, s, e, n]).geometry.coordinates)
    };
}

const METERS_PER_DEG_LAT = 111320;

function metersPerDegLon(latDeg) {
    return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/**
 * Minimum Euclidean separation of two axis-aligned degree boxes on a local tangent plane (approx meters).
 * Lower bound on true geodesic distance between features contained in the boxes.
 */
export function minBBoxSeparationMeters(boxA, boxB) {
    const [aw, as, ae, an] = boxA;
    const [bw, bs, be, bn] = boxB;

    const overlapX = !(ae < bw || be < aw);
    const overlapY = !(an < bs || bn < as);
    if (overlapX && overlapY) return 0;

    let dxDeg = 0;
    if (!overlapX) {
        if (ae < bw) dxDeg = bw - ae;
        else if (be < aw) dxDeg = aw - be;
    }

    let dyDeg = 0;
    if (!overlapY) {
        if (an < bs) dyDeg = bs - an;
        else if (bn < as) dyDeg = as - bn;
    }

    const latRef = (as + an + bs + bn) / 4;
    const mx = dxDeg * metersPerDegLon(latRef);
    const my = dyDeg * METERS_PER_DEG_LAT;
    return Math.hypot(mx, my);
}

/**
 * Target index entries for bbox pre-filter (used by proximity join and spatial tools).
 * @param {GeoJSON.Feature[]} features
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number, idx: number }[]}
 */
export function buildBBoxIndexEntries(features) {
    const out = [];
    for (let i = 0; i < features.length; i++) {
        const bbox = getFeatureBBox(features[i]);
        if (!bbox) continue;
        out.push({ minX: bbox[0], minY: bbox[1], maxX: bbox[2], maxY: bbox[3], idx: i });
    }
    return out;
}

/**
 * Candidates whose bbox may lie within maxRadiusM (meters) of srcFeature's bbox.
 * Falls back to full list if filtering yields nothing or radius unlimited.
 */
export function bboxPreFilterByRadius(srcFeature, tgtIndex, tgtFeatures, maxRadiusM) {
    if (typeof turf === 'undefined') return tgtFeatures;
    if (!(maxRadiusM > 0 && maxRadiusM < Infinity)) return tgtFeatures;
    try {
        const srcBbox = turf.bbox(srcFeature);
        const latRef = (srcBbox[1] + srcBbox[3]) / 2;
        if (Math.abs(latRef) >= 89 || srcBbox[2] - srcBbox[0] > 180) {
            return tgtFeatures;
        }

        const latPad = ((maxRadiusM / METERS_PER_DEG_LAT) * 1.5);
        const cosLat = Math.cos((latRef * Math.PI) / 180);
        const lonPad = Math.abs(cosLat) < 1e-6 ? 180 : latPad / cosLat;

        const sMinX = srcBbox[0] - lonPad;
        const sMinY = srcBbox[1] - latPad;
        const sMaxX = srcBbox[2] + lonPad;
        const sMaxY = srcBbox[3] + latPad;

        if (sMinX < -180 || sMaxX > 180) {
            return tgtFeatures;
        }

        const candidates = [];
        for (const entry of tgtIndex) {
            if (entry.maxX < sMinX || entry.minX > sMaxX || entry.maxY < sMinY || entry.minY > sMaxY) continue;
            candidates.push(tgtFeatures[entry.idx]);
        }
        return candidates.length > 0 ? candidates : tgtFeatures;
    } catch {
        return tgtFeatures;
    }
}
