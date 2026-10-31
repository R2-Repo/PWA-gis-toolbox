/**
 * Workflow canvas Simplify: optional tolerance in metres/feet via local equirectangular
 * space at the input bbox centre latitude, then turf simplify in pseudo-degrees
 * (tolerance_m / 111320). Legacy graphs use toleranceUnit "deg" (unchanged behaviour).
 */
import { computeSimplify } from '../../tools/compute/simplify.js';

const METRES_PER_DEG = 111320;
const FT_TO_M = 0.3048;
/** Avoid blow-up near poles when scaling longitude. */
const MIN_ABS_COS_PHI = 1e-6;

function walkCoordinates(coords, visitor) {
    if (!coords) return;
    if (typeof coords[0] === 'number') {
        visitor(coords);
        return;
    }
    for (const c of coords) walkCoordinates(c, visitor);
}

/**
 * @param {import('geojson').FeatureCollection} geojson
 * @returns {number} centre latitude in degrees, or 0 when empty/degenerate
 */
export function referenceLatitudeFromGeojson(geojson) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const f of geojson?.features || []) {
        walkCoordinates(f?.geometry?.coordinates, ([, lat]) => {
            if (typeof lat !== 'number' || !Number.isFinite(lat)) return;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        });
    }
    if (!Number.isFinite(minLat) || !Number.isFinite(maxLat)) return 0;
    return (minLat + maxLat) / 2;
}

export function clampCosLatitude(latDeg) {
    const rad = (latDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    if (!Number.isFinite(cos) || cos === 0) return MIN_ABS_COS_PHI;
    return Math.abs(cos) < MIN_ABS_COS_PHI ? Math.sign(cos || 1) * MIN_ABS_COS_PHI : cos;
}

function transformCoords(coords, cosPhi0, toLocal) {
    if (typeof coords[0] === 'number') {
        const [lon, lat] = coords;
        if (toLocal) return [lon * cosPhi0, lat];
        return [lon / cosPhi0, lat];
    }
    return coords.map((c) => transformCoords(c, cosPhi0, toLocal));
}

function transformFeatureCollection(fc, cosPhi0, toLocal) {
    return {
        type: 'FeatureCollection',
        features: (fc.features || []).map((f) => {
            if (!f?.geometry?.coordinates) return f;
            return {
                ...f,
                geometry: {
                    ...f.geometry,
                    coordinates: transformCoords(f.geometry.coordinates, cosPhi0, toLocal)
                }
            };
        })
    };
}

function toleranceMetres(config) {
    const raw = config.tolerance ?? 0.001;
    const unit = config.toleranceUnit ?? 'deg';
    if (unit === 'ft') return raw * FT_TO_M;
    if (unit === 'm') return raw;
    return null;
}

/**
 * @param {object[]} inputs
 * @param {object} config
 * @param {object} [context]
 */
export function computeWorkflowSimplify(inputs, config, context) {
    const unit = config.toleranceUnit ?? 'deg';
    if (unit === 'deg') {
        return computeSimplify(inputs, config, context);
    }

    const data = inputs[0];
    if (!data || data.type !== 'spatial') throw new Error('Spatial input required');

    const metres = toleranceMetres(config);
    const toleranceDeg = metres / METRES_PER_DEG;
    const phi0 = referenceLatitudeFromGeojson(data.geojson);
    const cosPhi0 = clampCosLatitude(phi0);

    const localGeojson = transformFeatureCollection(structuredClone(data.geojson), cosPhi0, true);
    const localData = { ...data, geojson: localGeojson };
    const simplified = computeSimplify([localData], { tolerance: toleranceDeg }, context);
    const geojson = transformFeatureCollection(simplified.geojson, cosPhi0, false);

    return { ...simplified, geojson };
}
