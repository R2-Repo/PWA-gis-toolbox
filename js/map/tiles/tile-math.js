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

export default { tileToBBox, padBBox, bboxIntersects, degreesPerPixel, featureBBox };
