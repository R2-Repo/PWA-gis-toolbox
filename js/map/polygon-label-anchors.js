/**
 * One label anchor per polygon feature.
 * MapLibre places a polygon symbol once per tile. A single interior point
 * stays in one tile, so a polygon that crosses tile edges is labeled once.
 */

export const POLYGON_ANCHOR_PROPERTY = '_gisPolyAnchor';
export const POLYGON_LABEL_ANCHOR_LAYER = 'gis-label-anchors';

/**
 * @param {string} sourceId
 * @returns {string}
 */
export function polygonAnchorSourceId(sourceId) {
    return `${sourceId}-poly-anchors`;
}

function ringSignedArea(ring) {
    let sum = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const x1 = ring[j][0];
        const y1 = ring[j][1];
        const x2 = ring[i][0];
        const y2 = ring[i][1];
        sum += (x1 * y2) - (x2 * y1);
    }
    return sum / 2;
}

function ringCentroid(ring) {
    const area = ringSignedArea(ring);
    if (!area) return [ring[0][0], ring[0][1]];
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const x1 = ring[j][0];
        const y1 = ring[j][1];
        const x2 = ring[i][0];
        const y2 = ring[i][1];
        const cross = (x1 * y2) - (x2 * y1);
        cx += (x1 + x2) * cross;
        cy += (y1 + y2) * cross;
    }
    return [cx / (6 * area), cy / (6 * area)];
}

function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const crosses = (yi > y) !== (yj > y);
        if (!crosses) continue;
        const xCross = ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
        if (x < xCross) inside = !inside;
    }
    return inside;
}

function largestOuterRing(geometry) {
    const polygons = geometry?.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry?.type === 'MultiPolygon'
            ? geometry.coordinates
            : [];
    let best = null;
    let bestArea = -1;
    for (const polygon of polygons || []) {
        const ring = polygon?.[0];
        if (!ring || ring.length < 3) continue;
        const area = Math.abs(ringSignedArea(ring));
        if (area >= bestArea) {
            bestArea = area;
            best = ring;
        }
    }
    return best;
}

/**
 * Stable interior point for one polygon or multipolygon.
 * Multipart polygons get one point, on the largest part.
 * @param {object|null|undefined} geometry
 * @returns {[number, number]|null}
 */
export function polygonInteriorPoint(geometry) {
    const ring = largestOuterRing(geometry);
    if (!ring) return null;
    const [cx, cy] = ringCentroid(ring);
    if (Number.isFinite(cx) && Number.isFinite(cy) && pointInRing(cx, cy, ring)) return [cx, cy];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const coord of ring) {
        const x = coord[0];
        const y = coord[1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }
    const bx = (minX + maxX) / 2;
    const by = (minY + maxY) / 2;
    if (pointInRing(bx, by, ring)) return [bx, by];
    return [ring[0][0], ring[0][1]];
}

/**
 * One Point feature per polygon. Other geometry types are skipped.
 * @param {object[]|null|undefined} features
 * @returns {object[]}
 */
export function polygonLabelAnchorFeatures(features) {
    const anchors = [];
    for (const feature of features || []) {
        const type = feature?.geometry?.type;
        if (type !== 'Polygon' && type !== 'MultiPolygon') continue;
        const coordinates = polygonInteriorPoint(feature.geometry);
        if (!coordinates) continue;
        anchors.push({
            type: 'Feature',
            properties: {
                ...(feature.properties || {}),
                [POLYGON_ANCHOR_PROPERTY]: 1
            },
            geometry: { type: 'Point', coordinates }
        });
    }
    return anchors;
}
