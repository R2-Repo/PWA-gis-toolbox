/**
 * Export builder for sheet cutting.
 *
 * Clean sheet cutting geometry is defined in docs/SHEET_CUTTING.md.
 * Do not revert to per-sheet rotated-paper intersection or post-hoc cap snapping.
 */

import { lineSliceAlongRoute } from '../../tools/line-geojson.js';
import { getLocalTangentBearing } from '../project-stationing/engine.js';

const STATION_KEY_SCALE = 1000;
const COORD_EPSILON = 1e-8;

/**
 * @param {number} stationFt
 * @returns {string}
 */
export function stationKey(stationFt) {
    return String(Math.round(stationFt * STATION_KEY_SCALE) / STATION_KEY_SCALE);
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function coordsEqual(a, b, epsilon = COORD_EPSILON) {
    return Math.abs(a[0] - b[0]) <= epsilon && Math.abs(a[1] - b[1]) <= epsilon;
}

/**
 * @param {import('geojson').Feature<import('geojson').Polygon|import('geojson').MultiPolygon>} feature
 * @returns {number[][]|null}
 */
export function extractPrimaryRing(feature) {
    if (!feature?.geometry) return null;
    if (feature.geometry.type === 'Polygon') {
        return feature.geometry.coordinates[0] || null;
    }
    if (feature.geometry.type === 'MultiPolygon') {
        let bestRing = null;
        let bestArea = 0;
        for (const polygon of feature.geometry.coordinates) {
            const ring = polygon?.[0];
            if (!ring?.length) continue;
            const area = turf.area(turf.polygon([ring]));
            if (area > bestArea) {
                bestArea = area;
                bestRing = ring;
            }
        }
        return bestRing;
    }
    return null;
}

/**
 * @param {number[][]} ring
 * @returns {number[][]}
 */
export function flattenRingCoords(ring) {
    const flat = [];
    for (const entry of ring) {
        if (Array.isArray(entry?.[0])) {
            for (const nested of entry) flat.push(nested);
        } else {
            flat.push(entry);
        }
    }
    return flat;
}

/**
 * @param {number[][]} ring
 * @returns {number[][]}
 */
export function dedupeConsecutiveRingPoints(ring) {
    const normalized = flattenRingCoords(ring);
    const output = [];
    for (const coord of normalized) {
        const prev = output[output.length - 1];
        if (!prev || !coordsEqual(prev, coord)) {
            output.push(coord);
        }
    }
    if (output.length > 1 && coordsEqual(output[0], output[output.length - 1])) {
        output.pop();
    }
    return output;
}

/**
 * @param {number[][]} openRing
 * @returns {boolean}
 */
function ringHasKinks(openRing) {
    if (openRing.length < 4) return false;
    try {
        const polygon = turf.polygon([[...openRing, openRing[0]]]);
        return turf.kinks(polygon).features.length > 0;
    } catch (_) {
        return true;
    }
}

/**
 * @param {object[]} sheets
 * @returns {number}
 */
export function computeSharedMatchLineSpan(sheets = []) {
    let maxSpan = 0;
    for (const sheet of sheets) {
        const widthFt = sheet.mapFrameWidthFt || 100;
        const heightFt = sheet.mapFrameHeightFt || 75;
        const clipWidthFt = widthFt + heightFt;
        maxSpan = Math.max(maxSpan, Math.hypot(clipWidthFt, heightFt) / 2 + 10);
    }
    return maxSpan || 500;
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {number} stationFt
 * @param {number} spanHalfWidthFt
 * @returns {import('geojson').Feature<import('geojson').LineString>}
 */
export function buildMatchLineSegment(routeLine, stationFt, spanHalfWidthFt) {
    const totalLength = turf.length(routeLine, { units: 'feet' });
    const clampedStation = Math.max(0, Math.min(stationFt, totalLength));
    const station = turf.along(routeLine, clampedStation, { units: 'feet' });
    const bearing = getLocalTangentBearing(routeLine, clampedStation);
    const left = turf.destination(station, spanHalfWidthFt, bearing - 90, { units: 'feet' });
    const right = turf.destination(station, spanHalfWidthFt, bearing + 90, { units: 'feet' });
    return turf.lineString([left.geometry.coordinates, right.geometry.coordinates]);
}

/**
 * Shared perpendicular cap segments used for clipped sheet geometry.
 * @param {object[]} sheets
 * @param {object} routeLine
 * @returns {Map<string, { stationFt: number, left: number[], right: number[] }>}
 */
export function buildCorridorMatchLineRegistry(sheets = [], routeLine = null) {
    const registry = new Map();
    if (!routeLine?.geometry || typeof turf === 'undefined') return registry;

    for (const sheet of sheets) {
        const halfHeightFt = (sheet.mapFrameHeightFt || 75) / 2;
        for (const stationFt of [sheet.startDistanceFt, sheet.endDistanceFt]) {
            const key = stationKey(stationFt);
            if (registry.has(key)) continue;
            const segment = buildMatchLineSegment(routeLine, stationFt, halfHeightFt);
            registry.set(key, {
                stationFt,
                left: [...segment.geometry.coordinates[0]],
                right: [...segment.geometry.coordinates[1]]
            });
        }
    }
    return registry;
}

/**
 * Wide match-line segments for labels and export metadata.
 * @param {object[]} sheets
 * @param {object} routeLine
 * @returns {Map<string, { stationFt: number, left: number[], right: number[] }>}
 */
export function buildSharedMatchLineRegistry(sheets = [], routeLine = null) {
    const registry = new Map();
    if (!routeLine?.geometry || typeof turf === 'undefined') return registry;

    const spanHalf = computeSharedMatchLineSpan(sheets);
    for (const sheet of sheets) {
        for (const stationFt of [sheet.startDistanceFt, sheet.endDistanceFt]) {
            const key = stationKey(stationFt);
            if (registry.has(key)) continue;
            const segment = buildMatchLineSegment(routeLine, stationFt, spanHalf);
            registry.set(key, {
                stationFt,
                left: [...segment.geometry.coordinates[0]],
                right: [...segment.geometry.coordinates[1]]
            });
        }
    }
    return registry;
}

/**
 * @param {import('geojson').Feature<import('geojson').Point>} centerPoint
 * @param {number} tangentBearing
 * @param {number} widthFt
 * @param {number} heightFt
 * @returns {import('geojson').Feature<import('geojson').Polygon>}
 */
export function buildPaperFrameRectangle(centerPoint, tangentBearing, widthFt, heightFt) {
    const halfW = widthFt / 2;
    const halfH = heightFt / 2;
    const fwd = tangentBearing;
    const perp = tangentBearing + 90;

    const corner = (alongSign, perpSign) => turf.destination(
        turf.destination(centerPoint, halfW * alongSign, fwd, { units: 'feet' }),
        halfH * perpSign,
        perp,
        { units: 'feet' }
    );

    const ring = [
        corner(1, 1),
        corner(1, -1),
        corner(-1, -1),
        corner(-1, 1),
        corner(1, 1)
    ].map((point) => point.geometry.coordinates);

    return turf.polygon([ring]);
}

/**
 * Large half-plane polygon used to clip buffered corridor at a match-line station.
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {number} stationFt
 * @param {boolean} keepAfter Keep corridor on the forward (increasing station) side.
 * @param {number} spanHalfWidthFt
 * @param {number} depthFt
 * @returns {import('geojson').Feature<import('geojson').Polygon>}
 */
export function buildStationHalfPlanePolygon(routeLine, stationFt, keepAfter, spanHalfWidthFt, depthFt) {
    const totalLength = turf.length(routeLine, { units: 'feet' });
    const clampedStation = Math.max(0, Math.min(stationFt, totalLength));
    const station = turf.along(routeLine, clampedStation, { units: 'feet' });
    const forwardBearing = getLocalTangentBearing(routeLine, clampedStation);
    const left = turf.destination(station, spanHalfWidthFt, forwardBearing - 90, { units: 'feet' });
    const right = turf.destination(station, spanHalfWidthFt, forwardBearing + 90, { units: 'feet' });
    const cutBearing = keepAfter ? forwardBearing : (forwardBearing + 180) % 360;
    const farLeft = turf.destination(left, depthFt, cutBearing, { units: 'feet' });
    const farRight = turf.destination(right, depthFt, cutBearing, { units: 'feet' });

    return turf.polygon([[
        left.geometry.coordinates,
        right.geometry.coordinates,
        farRight.geometry.coordinates,
        farLeft.geometry.coordinates,
        left.geometry.coordinates
    ]]);
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} routeLine
 * @param {number} startFt
 * @param {number} endFt
 * @param {number} halfHeightFt
 * @returns {import('geojson').Feature<import('geojson').Polygon>|null}
 */
export function buildBufferedStationCorridor(routeLine, startFt, endFt, halfHeightFt) {
    if (!routeLine?.geometry || halfHeightFt <= 0) return null;

    const totalLength = turf.length(routeLine, { units: 'feet' });
    const start = Math.max(0, Math.min(startFt, totalLength));
    const end = Math.max(start, Math.min(endFt, totalLength));
    if (end - start < 0.01) return null;

    const segment = lineSliceAlongRoute(routeLine, start, end, 'feet');
    if (!segment?.geometry?.coordinates?.length) return null;

    return turf.buffer(segment, halfHeightFt, { units: 'feet', steps: 32, endCapStyle: 'flat' });
}

/**
 * @param {import('geojson').Feature<import('geojson').Polygon>} polygon
 * @param {import('geojson').Feature<import('geojson').Polygon>} clipRegion
 * @returns {import('geojson').Feature<import('geojson').Polygon|import('geojson').MultiPolygon>|null}
 */
export function intersectPolygons(polygon, clipRegion) {
    try {
        const result = turf.intersect(turf.featureCollection([polygon, clipRegion]));
        return result?.geometry ? result : null;
    } catch (_) {
        return null;
    }
}

/**
 * Build the clipped sheet footprint along the route.
 *
 * Geometry model:
 * 1. Buffer the route segment by half the map-frame height (corridor width).
 * 2. Cut flat perpendicular match lines at sheet start/end stations.
 * 3. Limit along-route extent to the map-frame clip width (centered on the sheet).
 *
 * Match-line corners are shared because every sheet uses the same perpendicular cut
 * at each station and the same corridor half-width — not a per-sheet rotated rectangle.
 *
 * @param {object} sheet
 * @param {object} routeLine
 * @param {{ left: number[], right: number[] }|null} [_startCap]
 * @param {{ left: number[], right: number[] }|null} [_endCap]
 * @returns {import('geojson').Feature<import('geojson').Polygon>|null}
 */
export function buildClippedSheetPolygon(sheet, routeLine, _startCap = null, _endCap = null) {
    if (!routeLine?.geometry || typeof turf === 'undefined') return null;

    const routeLength = turf.length(routeLine, { units: 'feet' });
    const startFt = sheet.startDistanceFt ?? 0;
    const endFt = sheet.endDistanceFt ?? routeLength;
    const widthFt = sheet.mapFrameWidthFt || 100;
    const heightFt = sheet.mapFrameHeightFt || 75;
    const halfHeightFt = heightFt / 2;
    const clipWidthFt = widthFt + heightFt;

    const isFirst = startFt <= 0.01;
    const isLast = endFt >= routeLength - 0.01;
    const spanHalf = halfHeightFt * 2;
    const depthFt = clipWidthFt * 2;

    let corridor = buildBufferedStationCorridor(routeLine, startFt, endFt, halfHeightFt);
    if (!corridor) return null;

    if (!isFirst) {
        const startPlane = buildStationHalfPlanePolygon(routeLine, startFt, true, spanHalf, depthFt);
        corridor = intersectPolygons(corridor, startPlane);
        if (!corridor) return null;
    }
    if (!isLast) {
        const endPlane = buildStationHalfPlanePolygon(routeLine, endFt, false, spanHalf, depthFt);
        corridor = intersectPolygons(corridor, endPlane);
        if (!corridor) return null;
    }

    const centerDistance = sheet.centerDistanceFt ?? ((startFt + endFt) / 2);
    const backLimit = Math.max(0, centerDistance - clipWidthFt / 2);
    const forwardLimit = Math.min(routeLength, centerDistance + clipWidthFt / 2);

    const backPlane = buildStationHalfPlanePolygon(routeLine, backLimit, true, spanHalf, depthFt);
    corridor = intersectPolygons(corridor, backPlane);
    if (!corridor) return null;

    const forwardPlane = buildStationHalfPlanePolygon(routeLine, forwardLimit, false, spanHalf, depthFt);
    corridor = intersectPolygons(corridor, forwardPlane);
    if (!corridor) return null;

    const cleaned = turf.cleanCoords(corridor);
    const primaryRing = extractPrimaryRing(cleaned);
    if (!primaryRing?.length) {
        return cleaned.geometry.type === 'Polygon' ? cleaned : null;
    }

    const openRing = dedupeConsecutiveRingPoints(primaryRing);
    if (openRing.length < 3 || ringHasKinks(openRing)) {
        if (cleaned.geometry.type === 'Polygon' && !ringHasKinks(dedupeConsecutiveRingPoints(cleaned.geometry.coordinates[0]))) {
            return cleaned;
        }
        return null;
    }

    return turf.polygon([[...openRing, openRing[0]]]);
}

/**
 * @param {object} sheet
 * @param {object} routeLine
 * @param {Map<string, { left: number[], right: number[] }>} [sharedCaps]
 * @returns {object|null}
 */
export function buildSheetFramePolygon(sheet, routeLine, sharedCaps = null) {
    const routeLength = routeLine?.geometry ? turf.length(routeLine, { units: 'feet' }) : 0;
    const isFirst = (sheet.startDistanceFt ?? 0) <= 0.01;
    const isLast = (sheet.endDistanceFt ?? 0) >= routeLength - 0.01;
    const startCap = !isFirst && sharedCaps
        ? sharedCaps.get(stationKey(sheet.startDistanceFt)) || null
        : null;
    const endCap = !isLast && sharedCaps
        ? sharedCaps.get(stationKey(sheet.endDistanceFt)) || null
        : null;

    const clipped = buildClippedSheetPolygon(sheet, routeLine, startCap, endCap);
    if (!clipped?.geometry) return null;

    const centerDistance = sheet.centerDistanceFt ?? 0;
    const bearing = routeLine?.geometry
        ? getLocalTangentBearing(routeLine, centerDistance)
        : (sheet.rotationDeg ?? 0);

    return {
        type: 'Feature',
        properties: {
            feature_type: 'sheet_frame',
            sheet_id: sheet.sheetId,
            sheet_number: sheet.sheetNumber,
            sheet_type: sheet.sheetType || 'detail',
            center_distance_ft: centerDistance,
            rotation_deg: sheet.rotationDeg ?? bearing,
            start_distance_ft: sheet.startDistanceFt,
            end_distance_ft: sheet.endDistanceFt
        },
        geometry: clipped.geometry
    };
}

/**
 * @param {object[]} sheets
 * @param {object} routeLine
 * @returns {object}
 */
export function buildSheetFramesGeoJson(sheets = [], routeLine = null) {
    const detailSheets = sheets.filter((sheet) => sheet.sheetType !== 'overview');
    const sharedCaps = buildSharedMatchLineRegistry(detailSheets, routeLine);
    const features = detailSheets
        .map((sheet) => buildSheetFramePolygon(sheet, routeLine, sharedCaps))
        .filter(Boolean);

    return { type: 'FeatureCollection', features };
}

/**
 * @param {object} featureA
 * @param {object} featureB
 * @param {number} [minOverlapFt]
 * @returns {boolean}
 */
export function sharedBoundaryEdgesOverlap(featureA, featureB, minOverlapFt = 10) {
    try {
        const boundaryA = turf.polygonToLine(featureA);
        const boundaryB = turf.polygonToLine(featureB);
        const overlap = turf.lineOverlap(boundaryA, boundaryB, { tolerance: 1e-5 });
        const overlapFt = (overlap.features || []).reduce(
            (sum, feature) => sum + turf.length(feature, { units: 'feet' }),
            0
        );
        return overlapFt >= minOverlapFt;
    } catch (_) {
        return false;
    }
}

/**
 * @param {object} featureA
 * @param {object} featureB
 * @param {number} [epsilon]
 * @returns {boolean}
 */
export function sharedBoundaryVerticesMatch(featureA, featureB, epsilon = COORD_EPSILON) {
    const ringA = featureA.geometry.coordinates[0].slice(0, -1);
    const ringB = featureB.geometry.coordinates[0].slice(0, -1);
    let matches = 0;
    for (const coordA of ringA) {
        for (const coordB of ringB) {
            if (coordsEqual(coordA, coordB, epsilon)) {
                matches += 1;
                break;
            }
        }
    }
    return matches >= 2;
}

/**
 * @param {object} overviewSheet
 * @param {object} routeLine
 * @param {object} [sheetFrames]
 * @returns {object}
 */
export function buildOverviewGeoJson(overviewSheet, routeLine = null, sheetFrames = null) {
    const features = [];

    if (routeLine?.geometry) {
        features.push({
            type: 'Feature',
            properties: {
                feature_type: 'overview_route',
                sheet_number: 0
            },
            geometry: routeLine.geometry
        });
    }

    if (sheetFrames?.features?.length) {
        for (const frame of sheetFrames.features) {
            features.push({
                type: 'Feature',
                properties: {
                    feature_type: 'overview_sheet_outline',
                    sheet_id: frame.properties?.sheet_id,
                    sheet_number: frame.properties?.sheet_number
                },
                geometry: frame.geometry
            });
        }
    } else {
        for (const box of overviewSheet?.sheetBoxes || []) {
            features.push({
                type: 'Feature',
                properties: {
                    feature_type: 'overview_sheet_box',
                    sheet_id: box.sheetId,
                    sheet_number: box.sheetNumber,
                    center_distance_ft: box.centerDistanceFt
                },
                geometry: {
                    type: 'Point',
                    coordinates: routeLine?.geometry
                        ? turf.along(routeLine, box.centerDistanceFt || 0, { units: 'feet' }).geometry.coordinates
                        : [0, 0]
                }
            });
        }
    }

    return { type: 'FeatureCollection', features };
}

/**
 * @param {object} feature
 * @param {object} frameFeature
 * @returns {boolean}
 */
export function featureIntersectsSheetFrame(feature, frameFeature) {
    if (!feature?.geometry || !frameFeature?.geometry || typeof turf === 'undefined') {
        return false;
    }

    try {
        const geometry = feature.geometry;
        if (geometry.type === 'Point') {
            return turf.booleanPointInPolygon(feature, frameFeature);
        }
        if (geometry.type === 'MultiPoint') {
            return geometry.coordinates.some((coord) => turf.booleanPointInPolygon(turf.point(coord), frameFeature));
        }

        const clipped = turf.intersect(turf.featureCollection([feature, frameFeature]));
        if (!clipped?.geometry) return false;
        if (clipped.geometry.type === 'GeometryCollection') {
            return (clipped.geometry.geometries || []).length > 0;
        }
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * @param {object} feature
 * @param {object} frameFeature
 * @returns {object|null}
 */
export function clipFeatureToSheetFrame(feature, frameFeature) {
    if (!featureIntersectsSheetFrame(feature, frameFeature)) {
        return null;
    }

    const geometry = feature.geometry;
    if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
        return {
            ...feature,
            properties: {
                ...(feature.properties || {}),
                clipped_to_sheet: true
            }
        };
    }

    try {
        const clipped = turf.intersect(turf.featureCollection([feature, frameFeature]));
        if (!clipped?.geometry) return null;
        return {
            ...feature,
            geometry: clipped.geometry,
            properties: {
                ...(feature.properties || {}),
                clipped_to_sheet: true
            }
        };
    } catch (_) {
        return null;
    }
}

/**
 * @param {object} frameFeature
 * @param {object[]} features
 * @returns {object[]}
 */
export function clipFeaturesToSheetFrame(frameFeature, features = []) {
    const clipped = [];
    for (const feature of features) {
        const next = clipFeatureToSheetFrame(feature, frameFeature);
        if (next) clipped.push(next);
    }
    return clipped;
}

/**
 * @param {object[]} detailSheets
 * @param {object} routeLine
 * @param {object[]} designFeatures
 * @returns {object[]}
 */
export function buildPerSheetLayerExports(detailSheets = [], routeLine = null, designFeatures = []) {
    const sheetFrames = buildSheetFramesGeoJson(detailSheets, routeLine);
    const frameBySheetId = new Map(
        sheetFrames.features.map((feature) => [feature.properties?.sheet_id, feature])
    );

    return detailSheets.map((sheet) => {
        const frameFeature = frameBySheetId.get(sheet.sheetId);
        const clippedFeatures = frameFeature
            ? clipFeaturesToSheetFrame(frameFeature, designFeatures)
            : [];

        const outlineFeature = frameFeature
            ? {
                ...frameFeature,
                properties: {
                    ...(frameFeature.properties || {}),
                    feature_type: 'sheet_outline'
                }
            }
            : null;

        const contents = {
            type: 'FeatureCollection',
            features: [
                ...(outlineFeature ? [outlineFeature] : []),
                ...clippedFeatures
            ]
        };

        return {
            sheetId: sheet.sheetId,
            sheetNumber: sheet.sheetNumber,
            sheetType: sheet.sheetType || 'detail',
            startDistanceFt: sheet.startDistanceFt,
            endDistanceFt: sheet.endDistanceFt,
            frame: frameFeature || null,
            contents
        };
    });
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildSheetPdfPagePlan(session) {
    const sheetSet = session.sheets || {};
    const template = sheetSet.template || {};
    const detailSheets = (sheetSet.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');
    const pages = [];

    if (sheetSet.overviewSheet) {
        pages.push({
            pageType: 'overview',
            sheetNumber: 0,
            title: 'Sheet Index / Overview'
        });
    }

    for (const sheet of detailSheets) {
        pages.push({
            pageType: 'detail',
            sheetId: sheet.sheetId,
            sheetNumber: sheet.sheetNumber,
            title: `Sheet ${String(sheet.sheetNumber).padStart(2, '0')}`
        });
    }

    return {
        paperSize: template.paperSize || 'TABLOID',
        orientation: template.orientation || 'landscape',
        scale: template.scale || 200,
        pages
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildSheetExportPackage(session) {
    const sheetSet = session.sheets || {};
    const detailSheets = (sheetSet.sheets || []).filter((sheet) => sheet.sheetType !== 'overview');
    const designFeatures = session.designFeatures || [];
    const sheetFrames = buildSheetFramesGeoJson(detailSheets, session.routeLine);
    const perSheet = buildPerSheetLayerExports(detailSheets, session.routeLine, designFeatures);

    return {
        projectName: session.project?.projectName || 'Sheet Cutter',
        sheetCount: detailSheets.length,
        template: sheetSet.template || {},
        layers: {
            route: session.routeLine?.geometry
                ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { feature_type: 'route' }, geometry: session.routeLine.geometry }] }
                : { type: 'FeatureCollection', features: [] },
            sheetFrames,
            overview: buildOverviewGeoJson(sheetSet.overviewSheet, session.routeLine, sheetFrames),
            perSheet
        },
        pdf: buildSheetPdfPagePlan(session)
    };
}
