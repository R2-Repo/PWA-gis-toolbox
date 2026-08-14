/**
 * Polygon geoprocessing primitives (Turf.js).
 * Dataset wrappers live in gis-tools.js.
 */

const MIN_PIECE_AREA_RATIO = 1e-8;

function requireTurf() {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
}

function copyProps(feature) {
    return { ...(feature.properties || {}) };
}

function featureArea(feature) {
    try {
        return turf.area(feature) || 0;
    } catch (_) {
        return 0;
    }
}

/**
 * Flatten Turf polygon-like output into Polygon features.
 * @param {object|null|undefined} feature
 * @param {object} props
 * @returns {object[]}
 */
export function flattenPolygonLike(feature, props = {}) {
    if (!feature?.geometry) return [];
    const type = feature.geometry.type;
    if (type === 'Polygon') {
        return [{ type: 'Feature', properties: { ...props }, geometry: feature.geometry }];
    }
    if (type === 'MultiPolygon') {
        return feature.geometry.coordinates.map((coordinates) => ({
            type: 'Feature',
            properties: { ...props },
            geometry: { type: 'Polygon', coordinates }
        }));
    }
    if (type === 'GeometryCollection') {
        return (feature.geometry.geometries || []).flatMap((geometry) => (
            flattenPolygonLike({ type: 'Feature', geometry, properties: props }, props)
        ));
    }
    if (type === 'FeatureCollection') {
        return (feature.features || []).flatMap((part) => flattenPolygonLike(part, { ...props, ...part.properties }));
    }
    return [];
}

function isPolygonGeom(type) {
    return type === 'Polygon' || type === 'MultiPolygon';
}

function isLineGeom(type) {
    return type === 'LineString' || type === 'MultiLineString';
}

/**
 * @param {object[]} features
 * @returns {object[]} polygon / multipolygon features
 */
export function listPolygonFeatures(features = []) {
    return features.filter((f) => f?.geometry && isPolygonGeom(f.geometry.type));
}

/**
 * Explode MultiLineString parts into LineString features.
 * @param {object[]} features
 * @returns {object[]}
 */
export function listLineStringParts(features = []) {
    const out = [];
    for (const f of features) {
        const g = f?.geometry;
        if (!g) continue;
        if (g.type === 'LineString') {
            out.push(f);
        } else if (g.type === 'MultiLineString') {
            for (const coordinates of g.coordinates) {
                out.push({
                    type: 'Feature',
                    properties: copyProps(f),
                    geometry: { type: 'LineString', coordinates }
                });
            }
        }
    }
    return out;
}

function pushLineGeometry(geometry, props, out) {
    if (!geometry) return;
    if (geometry.type === 'LineString') {
        out.push({ type: 'Feature', properties: { ...props }, geometry });
        return;
    }
    if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach((coordinates, ring) => {
            out.push({
                type: 'Feature',
                properties: { ...props, ring },
                geometry: { type: 'LineString', coordinates }
            });
        });
        return;
    }
    if (geometry.type === 'GeometryCollection') {
        (geometry.geometries || []).forEach((g) => pushLineGeometry(g, props, out));
    }
}

function collectLineFeatures(converted, props, out) {
    if (!converted) return;
    if (converted.type === 'Feature') {
        pushLineGeometry(converted.geometry, { ...props, ...converted.properties }, out);
        return;
    }
    if (converted.type === 'FeatureCollection') {
        (converted.features || []).forEach((f) => collectLineFeatures(f, props, out));
        return;
    }
    pushLineGeometry(converted, props, out);
}

/**
 * Convert polygon features to outline lines (outer ring + holes).
 * @param {object[]} features
 * @returns {object[]}
 */
export function polygonsToLineFeatures(features = []) {
    requireTurf();
    const out = [];
    for (const feature of listPolygonFeatures(features)) {
        try {
            const converted = turf.polygonToLine(feature);
            collectLineFeatures(converted, copyProps(feature), out);
        } catch (_) {
            /* skip invalid geometry */
        }
    }
    return out;
}

function ringWithoutHoles(ringSet) {
    return ringSet?.length ? [ringSet[0]] : ringSet;
}

/**
 * Drop interior rings (holes) from polygon features.
 * @param {object[]} features
 * @returns {{ features: object[], holesRemoved: number }}
 */
export function fillHoleFeatures(features = []) {
    let holesRemoved = 0;
    const out = [];
    for (const feature of features) {
        const g = feature?.geometry;
        if (!g) {
            out.push(feature);
            continue;
        }
        if (g.type === 'Polygon') {
            const extra = Math.max(0, g.coordinates.length - 1);
            holesRemoved += extra;
            out.push(extra
                ? { ...feature, geometry: { type: 'Polygon', coordinates: ringWithoutHoles(g.coordinates) } }
                : feature);
            continue;
        }
        if (g.type === 'MultiPolygon') {
            const coordinates = g.coordinates.map((poly) => {
                holesRemoved += Math.max(0, poly.length - 1);
                return ringWithoutHoles(poly);
            });
            out.push({ ...feature, geometry: { type: 'MultiPolygon', coordinates } });
            continue;
        }
        out.push(feature);
    }
    return { features: out, holesRemoved };
}

function extendLine(line, distKm) {
    const coords = turf.getCoords(line);
    if (!coords || coords.length < 2 || !(distKm > 0)) return line;
    const start = turf.point(coords[0]);
    const second = turf.point(coords[1]);
    const end = turf.point(coords[coords.length - 1]);
    const prev = turf.point(coords[coords.length - 2]);
    const back = turf.bearing(second, start);
    const fwd = turf.bearing(prev, end);
    const newStart = turf.destination(start, distKm, back, { units: 'kilometers' });
    const newEnd = turf.destination(end, distKm, fwd, { units: 'kilometers' });
    return turf.lineString([
        newStart.geometry.coordinates,
        ...coords,
        newEnd.geometry.coordinates
    ]);
}

function halfPlaneFromLine(line, offsetKm) {
    const offset = turf.lineOffset(line, offsetKm, { units: 'kilometers' });
    const a = turf.getCoords(line);
    const b = [...turf.getCoords(offset)].reverse();
    if (!a?.length || !b?.length) return null;
    return turf.polygon([[...a, ...b, a[0]]]);
}

function straightHalfPlane(line, offsetKm) {
    const coords = turf.getCoords(line);
    if (!coords || coords.length < 2) return null;
    const simple = turf.lineString([coords[0], coords[coords.length - 1]]);
    return halfPlaneFromLine(simple, offsetKm);
}

function polygonBboxSpanKm(feature) {
    const bbox = turf.bbox(feature);
    return turf.distance(
        turf.point([bbox[0], bbox[1]]),
        turf.point([bbox[2], bbox[3]]),
        { units: 'kilometers' }
    ) || 0.001;
}

function geometriesIntersect(a, b) {
    try {
        if (typeof turf.booleanIntersects === 'function') {
            return turf.booleanIntersects(a, b);
        }
    } catch (_) { /* fall through */ }
    try {
        if (isLineGeom(b.geometry?.type)) {
            const hits = turf.lineIntersect(turf.polygonToLine(a), b);
            return (hits?.features?.length || 0) > 0;
        }
        const ix = turf.intersect(turf.featureCollection([a, b]));
        return !!ix;
    } catch (_) {
        return false;
    }
}

/**
 * Split one polygon feature with one line. Returns 1+ polygon features.
 * The cutter must intersect the polygon; the line is extended so it can finish the cut.
 * @param {object} polygon
 * @param {object} line
 * @returns {object[]}
 */
export function splitPolygonFeatureByLine(polygon, line) {
    requireTurf();
    if (!polygon?.geometry || !line?.geometry) return polygon ? [polygon] : [];
    if (!isPolygonGeom(polygon.geometry.type) || !isLineGeom(line.geometry.type)) {
        return [polygon];
    }

    const lineParts = listLineStringParts([line]);
    let pieces = [polygon];
    for (const part of lineParts) {
        const next = [];
        for (const piece of pieces) {
            next.push(...splitPolygonBySingleLine(piece, part));
        }
        pieces = next;
    }
    return pieces;
}

function splitPolygonBySingleLine(polygon, line) {
    if (!geometriesIntersect(polygon, line)) return [polygon];

    const originalArea = featureArea(polygon);
    const spanKm = Math.max(polygonBboxSpanKm(polygon), 0.05);
    const extendKm = spanKm * 4;
    const offsetKm = spanKm * 4;

    let half = null;
    try {
        const extended = extendLine(line, extendKm);
        half = halfPlaneFromLine(extended, offsetKm) || straightHalfPlane(extended, offsetKm);
    } catch (_) {
        try {
            half = straightHalfPlane(extendLine(line, extendKm), offsetKm);
        } catch (_) { /* ignore */ }
    }
    if (!half) return [polygon];

    let overlap = null;
    let remainder = null;
    try {
        overlap = turf.intersect(turf.featureCollection([polygon, half]));
    } catch (_) { /* ignore */ }
    try {
        remainder = turf.difference(turf.featureCollection([polygon, half]));
    } catch (_) { /* ignore */ }

    const props = copyProps(polygon);
    const left = flattenPolygonLike(overlap, props);
    const right = flattenPolygonLike(remainder, props);
    const pieces = [...left, ...right].filter((f) => featureArea(f) > originalArea * MIN_PIECE_AREA_RATIO);

    if (pieces.length < 2) return [polygon];
    return pieces;
}

/**
 * Split polygon features by all intersecting lines.
 * @param {object[]} polygons
 * @param {object[]} lines
 * @returns {object[]}
 */
export function splitPolygonFeaturesByLines(polygons = [], lines = []) {
    requireTurf();
    const polyList = listPolygonFeatures(polygons);
    const lineList = listLineStringParts(lines);
    if (!lineList.length) return polyList.map((f) => ({ ...f, properties: copyProps(f) }));

    const out = [];
    for (const poly of polyList) {
        let pieces = [poly];
        for (const line of lineList) {
            const next = [];
            for (const piece of pieces) {
                next.push(...splitPolygonFeatureByLine(piece, line));
            }
            pieces = next;
        }
        out.push(...pieces);
    }
    return out;
}

function unionPolygonFeatures(features) {
    if (!features.length) return null;
    let acc = features[0];
    for (let i = 1; i < features.length; i++) {
        try {
            const merged = turf.union(turf.featureCollection([acc, features[i]]));
            if (merged) acc = merged;
        } catch (_) { /* skip invalid pair */ }
    }
    return acc;
}

/**
 * Split target polygons by a splitter polygon layer (overlap + remainder).
 * @param {object[]} targets
 * @param {object[]} splitters
 * @returns {object[]}
 */
export function splitPolygonFeaturesByPolygons(targets = [], splitters = []) {
    requireTurf();
    const polyList = listPolygonFeatures(targets);
    const cutterList = listPolygonFeatures(splitters);
    if (!cutterList.length) return polyList.map((f) => ({ ...f, properties: copyProps(f) }));

    const cutter = unionPolygonFeatures(cutterList) || cutterList[0];
    const out = [];

    for (const poly of polyList) {
        if (!geometriesIntersect(poly, cutter)) {
            out.push({ ...poly, properties: copyProps(poly) });
            continue;
        }

        const originalArea = featureArea(poly);
        const props = copyProps(poly);
        let overlap = null;
        let remainder = null;
        try {
            overlap = turf.intersect(turf.featureCollection([poly, cutter]));
        } catch (_) { /* ignore */ }
        try {
            remainder = turf.difference(turf.featureCollection([poly, cutter]));
        } catch (_) { /* ignore */ }

        const pieces = [
            ...flattenPolygonLike(overlap, props),
            ...flattenPolygonLike(remainder, props)
        ].filter((f) => featureArea(f) > originalArea * MIN_PIECE_AREA_RATIO);

        if (pieces.length < 2 && !overlap) {
            out.push({ ...poly, properties: props });
            continue;
        }
        if (!pieces.length) {
            out.push({ ...poly, properties: props });
            continue;
        }
        out.push(...pieces);
    }
    return out;
}
