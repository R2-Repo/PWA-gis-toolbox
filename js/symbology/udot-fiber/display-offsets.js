/**
 * Parallel display offsets for multi-sheath fiber (plan-style CAD separation).
 * Mutates a copy of coordinates in WebMercator-ish screen offset approx via lat/lon nudge.
 */

/**
 * @param {object[]} features
 * @param {{ field?: string, metersPerUnit?: number }} [opts]
 * @returns {object[]}
 */
export function applyUdotFiberDisplayOffsets(features, opts = {}) {
    const field = opts.field || 'MULTISHEATH';
    const metersPerUnit = opts.metersPerUnit ?? 1.75;
    if (!features?.length) return features || [];

    return features.map((feature, index) => {
        const props = feature?.properties || {};
        if (Number(props._udotDisplayOffsetM) > 0) return feature;
        const raw = props[field];
        const sheath = Number(raw);
        // Offset alternate features slightly when MULTISHEATH missing but DESCR hints parallel
        let units = Number.isFinite(sheath) && sheath > 1 ? (index % Math.min(sheath, 4)) : 0;
        if (!units && props.Fiber_Label && /multi|parallel/i.test(String(props.Fiber_Label))) {
            units = index % 2;
        }
        if (!units || !feature.geometry) return feature;

        const offsetMeters = units * metersPerUnit;
        const geom = offsetGeometry(feature.geometry, offsetMeters);
        if (!geom) return feature;
        return {
            ...feature,
            geometry: geom,
            properties: {
                ...props,
                _udotDisplayOffsetM: offsetMeters
            }
        };
    });
}

/**
 * Approximate perpendicular offset in WGS84 for LineString/MultiLineString.
 * @param {object} geometry
 * @param {number} meters
 */
function offsetGeometry(geometry, meters) {
    if (!geometry) return null;
    if (geometry.type === 'LineString') {
        return { type: 'LineString', coordinates: offsetLine(geometry.coordinates, meters) };
    }
    if (geometry.type === 'MultiLineString') {
        return {
            type: 'MultiLineString',
            coordinates: geometry.coordinates.map((line) => offsetLine(line, meters))
        };
    }
    return geometry;
}

/**
 * @param {number[][]} coords
 * @param {number} meters
 */
function offsetLine(coords, meters) {
    if (!coords?.length || coords.length < 2) return coords;
    const out = [];
    for (let i = 0; i < coords.length; i++) {
        const prev = coords[Math.max(0, i - 1)];
        const next = coords[Math.min(coords.length - 1, i + 1)];
        const [x1, y1] = prev;
        const [x2, y2] = next;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        // Perpendicular unit vector; convert meters → degrees at latitude
        const lat = coords[i][1];
        const mPerDegLat = 111320;
        const mPerDegLon = Math.max(1e-6, 111320 * Math.cos((lat * Math.PI) / 180));
        const nx = (-dy / len) * (meters / mPerDegLon);
        const ny = (dx / len) * (meters / mPerDegLat);
        out.push([coords[i][0] + nx, coords[i][1] + ny]);
    }
    return out;
}
