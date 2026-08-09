/**
 * Web Mercator tile math (pure).
 */

/** @returns {[number, number, number, number]} [west, south, east, north] in lon/lat */
export function tileToBBox(z, x, y) {
    const n = 2 ** z;
    const west = (x / n) * 360 - 180;
    const east = ((x + 1) / n) * 360 - 180;
    const north = _tileLat(y, n);
    const south = _tileLat(y + 1, n);
    return [west, south, east, north];
}

function _tileLat(y, n) {
    const rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    return (rad * 180) / Math.PI;
}

/**
 * Pad a bbox by a fraction of its own span (tile clip buffer).
 * @param {[number,number,number,number]} bbox
 * @param {number} fraction e.g. 64/4096
 */
export function padBBox(bbox, fraction) {
    const [w, s, e, n] = bbox;
    const dx = (e - w) * fraction;
    const dy = (n - s) * fraction;
    return [w - dx, s - dy, e + dx, n + dy];
}

/** @returns {boolean} */
export function bboxIntersects(a, b) {
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

/**
 * Approximate degrees (longitude) per screen pixel at a zoom (256px tiles).
 * @param {number} z
 */
export function degreesPerPixel(z) {
    return 360 / (2 ** z * 256);
}

/**
 * Compute (and cache) a feature's bbox.
 * @param {object} feature GeoJSON feature
 * @returns {[number,number,number,number]|null}
 */
export function featureBBox(feature) {
    if (feature.__bbox !== undefined) return feature.__bbox;
    const coords = feature.geometry?.coordinates;
    if (!coords) {
        feature.__bbox = null;
        return null;
    }
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const stack = [coords];
    while (stack.length) {
        const c = stack.pop();
        if (typeof c[0] === 'number') {
            if (c[0] < w) w = c[0];
            if (c[1] < s) s = c[1];
            if (c[0] > e) e = c[0];
            if (c[1] > n) n = c[1];
            continue;
        }
        for (let i = 0; i < c.length; i++) stack.push(c[i]);
    }
    feature.__bbox = isFinite(w) ? [w, s, e, n] : null;
    return feature.__bbox;
}

function pointInBBox(lon, lat, bbox) {
    return lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3];
}

/** Cross product orientation for segment intersection (colinear counts as 0). */
function _orient(ax, ay, bx, by, cx, cy) {
    return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function _onSeg(ax, ay, bx, by, cx, cy) {
    return (
        Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx)
        && Math.min(ay, by) <= cy && cy <= Math.max(ay, by)
    );
}

function segmentsIntersect(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
    const o1 = _orient(a1x, a1y, a2x, a2y, b1x, b1y);
    const o2 = _orient(a1x, a1y, a2x, a2y, b2x, b2y);
    const o3 = _orient(b1x, b1y, b2x, b2y, a1x, a1y);
    const o4 = _orient(b1x, b1y, b2x, b2y, a2x, a2y);
    if (o1 === 0 && _onSeg(a1x, a1y, a2x, a2y, b1x, b1y)) return true;
    if (o2 === 0 && _onSeg(a1x, a1y, a2x, a2y, b2x, b2y)) return true;
    if (o3 === 0 && _onSeg(b1x, b1y, b2x, b2y, a1x, a1y)) return true;
    if (o4 === 0 && _onSeg(b1x, b1y, b2x, b2y, a2x, a2y)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

/**
 * True when a line segment intersects an axis-aligned lon/lat bbox
 * (endpoint inside, or crossing any edge).
 */
export function segmentIntersectsBBox(x1, y1, x2, y2, bbox) {
    const [w, s, e, n] = bbox;
    if (Math.max(x1, x2) < w || Math.min(x1, x2) > e || Math.max(y1, y2) < s || Math.min(y1, y2) > n) {
        return false;
    }
    if (pointInBBox(x1, y1, bbox) || pointInBBox(x2, y2, bbox)) return true;
    return (
        segmentsIntersect(x1, y1, x2, y2, w, s, e, s)
        || segmentsIntersect(x1, y1, x2, y2, w, n, e, n)
        || segmentsIntersect(x1, y1, x2, y2, w, s, w, n)
        || segmentsIntersect(x1, y1, x2, y2, e, s, e, n)
    );
}

function lineStringHitsBBox(coords, bbox) {
    if (!coords?.length) return false;
    for (let i = 0; i < coords.length; i++) {
        const p = coords[i];
        if (pointInBBox(p[0], p[1], bbox)) return true;
        if (i > 0) {
            const prev = coords[i - 1];
            if (segmentIntersectsBBox(prev[0], prev[1], p[0], p[1], bbox)) return true;
        }
    }
    return false;
}

function ringHitsBBox(ring, bbox) {
    return lineStringHitsBBox(ring, bbox);
}

/** Ray-cast point-in-ring (lon/lat treated as planar for tile tests). */
function pointInRing(lon, lat, ring) {
    if (!ring || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const denom = yj - yi;
        if (denom === 0) continue;
        const intersect = ((yi > lat) !== (yj > lat))
            && (lon < ((xj - xi) * (lat - yi)) / denom + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

function polygonHitsBBox(rings, bbox) {
    if (!rings?.length) return false;
    for (let i = 0; i < rings.length; i++) {
        if (ringHitsBBox(rings[i], bbox)) return true;
    }
    // Tile fully inside the outer ring (no edge contact).
    const cx = (bbox[0] + bbox[2]) / 2;
    const cy = (bbox[1] + bbox[3]) / 2;
    return pointInRing(cx, cy, rings[0]);
}

/**
 * Geometry vs tile bbox — stricter than feature-bbox intersection.
 * Long LineStrings whose envelope covers a tile but miss it geometrically
 * return false (those previously produced empty MVTs after geojson-vt clip).
 *
 * @param {object|null} geometry GeoJSON geometry
 * @param {[number,number,number,number]} bbox
 * @returns {boolean}
 */
export function geometryIntersectsBBox(geometry, bbox) {
    if (!geometry || !bbox) return false;
    const { type, coordinates: coords } = geometry;
    if (!type || coords == null) return false;

    switch (type) {
        case 'Point':
            return pointInBBox(coords[0], coords[1], bbox);
        case 'MultiPoint':
            for (let i = 0; i < coords.length; i++) {
                if (pointInBBox(coords[i][0], coords[i][1], bbox)) return true;
            }
            return false;
        case 'LineString':
            return lineStringHitsBBox(coords, bbox);
        case 'MultiLineString':
            for (let i = 0; i < coords.length; i++) {
                if (lineStringHitsBBox(coords[i], bbox)) return true;
            }
            return false;
        case 'Polygon':
            return polygonHitsBBox(coords, bbox);
        case 'MultiPolygon':
            for (let i = 0; i < coords.length; i++) {
                if (polygonHitsBBox(coords[i], bbox)) return true;
            }
            return false;
        case 'GeometryCollection':
            for (const g of geometry.geometries || []) {
                if (geometryIntersectsBBox(g, bbox)) return true;
            }
            return false;
        default:
            return false;
    }
}

export default {
    tileToBBox,
    padBBox,
    bboxIntersects,
    degreesPerPixel,
    featureBBox,
    segmentIntersectsBBox,
    geometryIntersectsBBox
};
