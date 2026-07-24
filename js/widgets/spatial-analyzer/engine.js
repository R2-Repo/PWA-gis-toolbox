import { processInChunks } from '../../core/task-runner.js';

export const SPATIAL_RELATIONS = [
    { value: 'intersects', label: 'Partially or fully inside', tip: 'Any feature that touches or overlaps the area' },
    { value: 'within', label: 'Completely inside', tip: 'Only features entirely contained within the area' },
    { value: 'centroid_within', label: 'Center point inside', tip: 'Feature whose center falls inside the area' },
    { value: 'contains', label: 'Contains the area', tip: 'Feature that fully surrounds the search area' }
];

export function checkSpatialRelation(feature, area, spatialRelation = 'intersects') {
    const type = feature?.geometry?.type;
    if (!type) return false;

    switch (spatialRelation) {
        case 'intersects':
            if (type === 'Point') return turf.booleanIntersects(feature, area);
            if (type === 'MultiPoint') {
                return feature.geometry.coordinates.some((coord) =>
                    turf.booleanIntersects(turf.point(coord), area)
                );
            }
            return turf.booleanIntersects(feature, area);
        case 'within':
            if (type === 'Point') return turf.booleanPointInPolygon(feature, area);
            if (type === 'MultiPoint') {
                return feature.geometry.coordinates.every((coord) =>
                    turf.booleanPointInPolygon(turf.point(coord), area)
                );
            }
            return turf.booleanWithin(feature, area);
        case 'centroid_within':
            try {
                const centroid = turf.centroid(feature);
                return turf.booleanPointInPolygon(centroid, area);
            } catch {
                return false;
            }
        case 'contains':
            try {
                return turf.booleanContains(feature, area);
            } catch {
                return false;
            }
        default:
            return turf.booleanIntersects(feature, area);
    }
}

export async function runSpatialAnalysis({
    features = [],
    analysisArea,
    spatialRelation = 'intersects',
    chunkSize = 100
}) {
    const matches = await processInChunks(
        features,
        chunkSize,
        (feature) => {
            if (!feature?.geometry) return null;
            try {
                if (checkSpatialRelation(feature, analysisArea, spatialRelation)) {
                    return feature;
                }
            } catch {
                try {
                    const centroid = turf.centroid(feature);
                    if (turf.booleanPointInPolygon(centroid, analysisArea)) {
                        return feature;
                    }
                } catch {
                    return null;
                }
            }
            return null;
        },
        null
    );

    const matchedFeatures = matches.filter(Boolean);
    return {
        matchedFeatures,
        stats: computeMatchStats(matchedFeatures)
    };
}

/**
 * @param {object[]} matchedFeatures
 */
export function computeMatchStats(matchedFeatures = []) {
    const stats = {
        points: 0,
        lines: 0,
        polygons: 0,
        totalLength: null,
        totalArea: null
    };

    let totalLengthKm = 0;
    let totalAreaSqKm = 0;
    let hasLines = false;
    let hasPolygons = false;

    matchedFeatures.forEach((feature) => {
        const type = feature?.geometry?.type;
        if (type === 'Point' || type === 'MultiPoint') {
            stats.points++;
        } else if (type === 'LineString' || type === 'MultiLineString') {
            stats.lines++;
            hasLines = true;
            try {
                totalLengthKm += turf.length(feature, { units: 'kilometers' });
            } catch {
                // Ignore measurement errors for invalid geometries.
            }
        } else if (type === 'Polygon' || type === 'MultiPolygon') {
            stats.polygons++;
            hasPolygons = true;
            try {
                totalAreaSqKm += turf.area(feature) / 1e6;
            } catch {
                // Ignore measurement errors for invalid geometries.
            }
        }
    });

    if (hasLines) {
        const totalLengthFt = totalLengthKm * 3280.84;
        if (totalLengthFt < 5280) {
            stats.totalLength = `${Math.round(totalLengthFt).toLocaleString()} ft`;
        } else {
            const totalLengthMi = totalLengthFt / 5280;
            stats.totalLength = `${totalLengthMi.toFixed(2)} mi`;
        }
    }

    if (hasPolygons) {
        const totalAreaSqFt = totalAreaSqKm * 1.076e7;
        const totalAreaAcres = totalAreaSqFt / 43560;
        if (totalAreaAcres < 1) {
            stats.totalArea = `${Math.round(totalAreaSqFt).toLocaleString()} ft^2`;
        } else if (totalAreaAcres < 640) {
            stats.totalArea = `${totalAreaAcres.toFixed(2)} acres`;
        } else {
            const totalAreaSqMi = totalAreaAcres / 640;
            stats.totalArea = `${totalAreaSqMi.toFixed(3)} mi^2`;
        }
    }

    return stats;
}
