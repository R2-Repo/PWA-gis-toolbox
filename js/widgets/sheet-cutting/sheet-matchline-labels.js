/**
 * Geographic SEE SHEET labels at sheet match lines.
 * Outward is the direction away from the route just inside this sheet.
 */

import { buildSheetEdgeSeeLabelSpecs } from './sheet-pdf-orientation.js';

/** Distance (ft) from the match-line mid to the stored outward probe. */
export const MATCHLINE_SEE_LABEL_PROBE_FT = 8;

/**
 * @param {{ left: number[], right: number[] }} cap
 * @returns {import('geojson').Feature<import('geojson').Point>|null}
 */
export function capMidpoint(cap) {
    if (!cap?.left?.length || !cap?.right?.length || typeof turf === 'undefined') return null;
    return turf.midpoint(turf.point(cap.left), turf.point(cap.right));
}

/**
 * Point a few feet outside the sheet from the match-line midpoint.
 * Uses the route just inside the sheet so the side cannot flip with cutout shape.
 *
 * @param {{ left: number[], right: number[] }} cap
 * @param {import('geojson').Feature<import('geojson').Polygon>} polygon
 * @param {object} [options]
 * @param {import('geojson').Feature<import('geojson').LineString>} [options.routeLine]
 * @param {number} [options.stationFt]
 * @param {'start'|'end'} [options.position]
 * @param {number} [options.probeFt]
 * @returns {import('geojson').Feature<import('geojson').Point>|null}
 */
export function pickOutwardPointFromCap(cap, polygon, options = {}) {
    const mid = capMidpoint(cap);
    if (!mid || typeof turf === 'undefined') return null;

    const probeFt = options.probeFt ?? MATCHLINE_SEE_LABEL_PROBE_FT;
    const routeLine = options.routeLine;
    const stationFt = options.stationFt;
    const position = options.position;

    let outward = null;
    if (routeLine?.geometry && Number.isFinite(stationFt)) {
        const totalLength = turf.length(routeLine, { units: 'feet' });
        const interiorFt = position === 'start'
            ? Math.min(stationFt + 2, totalLength)
            : Math.max(stationFt - 2, 0);
        const interior = turf.along(routeLine, interiorFt, { units: 'feet' });
        const outBearing = turf.bearing(interior, mid);
        outward = turf.destination(mid, probeFt, outBearing, { units: 'feet' });
        if (polygon?.geometry && turf.booleanPointInPolygon(outward, polygon, { ignoreBoundary: true })) {
            outward = turf.destination(mid, probeFt, outBearing + 180, { units: 'feet' });
        }
        return outward;
    }

    if (!polygon?.geometry) return null;
    const bearing = turf.bearing(turf.point(cap.left), turf.point(cap.right));
    const a = turf.destination(mid, probeFt, bearing + 90, { units: 'feet' });
    const b = turf.destination(mid, probeFt, bearing - 90, { units: 'feet' });
    const aIn = turf.booleanPointInPolygon(a, polygon, { ignoreBoundary: true });
    const bIn = turf.booleanPointInPolygon(b, polygon, { ignoreBoundary: true });
    if (aIn !== bIn) {
        return aIn ? b : a;
    }
    const centroid = turf.centroid(polygon);
    return turf.distance(a, centroid) >= turf.distance(b, centroid) ? a : b;
}

/**
 * @param {{ text: string, position?: string, adjacentSheetNumber?: number, stationFt?: number }} spec
 * @param {{ left: number[], right: number[] }|null} cap
 * @param {import('geojson').Feature<import('geojson').Polygon>|null} frameFeature
 * @param {import('geojson').Feature<import('geojson').LineString>|null} [routeLine]
 * @returns {import('geojson').Feature<import('geojson').Point>|null}
 */
export function buildMatchlineSeeLabelFeature(spec, cap, frameFeature, routeLine = null) {
    if (!spec?.text || !cap?.left?.length || !cap?.right?.length || !frameFeature?.geometry) {
        return null;
    }

    const mid = capMidpoint(cap);
    const outward = pickOutwardPointFromCap(cap, frameFeature, {
        routeLine,
        stationFt: spec.stationFt,
        position: spec.position
    });
    if (!mid || !outward) return null;

    return {
        type: 'Feature',
        geometry: {
            type: 'Point',
            coordinates: [...mid.geometry.coordinates]
        },
        properties: {
            feature_type: 'matchline_see_label',
            text: spec.text,
            position: spec.position ?? null,
            adjacentSheetNumber: spec.adjacentSheetNumber ?? null,
            cap_left: [...cap.left],
            cap_right: [...cap.right],
            outward: [...outward.geometry.coordinates]
        }
    };
}

/**
 * @param {object} sheet
 * @param {import('geojson').Feature<import('geojson').Polygon>|null} frameFeature
 * @param {number} totalSheets
 * @param {Map<string, { left: number[], right: number[] }>} registry
 * @param {(stationFt: number) => string} stationKeyFn
 * @param {import('geojson').Feature<import('geojson').LineString>|null} [routeLine]
 * @returns {import('geojson').Feature<import('geojson').Point>[]}
 */
export function buildMatchlineSeeLabelFeatures(
    sheet,
    frameFeature,
    totalSheets,
    registry,
    stationKeyFn,
    routeLine = null
) {
    if (!sheet || !frameFeature || !registry || typeof stationKeyFn !== 'function') {
        return [];
    }

    const features = [];
    for (const spec of buildSheetEdgeSeeLabelSpecs(sheet, totalSheets)) {
        const cap = registry.get(stationKeyFn(spec.stationFt));
        const feature = buildMatchlineSeeLabelFeature(spec, cap, frameFeature, routeLine);
        if (feature) features.push(feature);
    }
    return features;
}
