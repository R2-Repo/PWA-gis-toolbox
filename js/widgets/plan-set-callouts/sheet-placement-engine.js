/**
 * Sheet-aware callout placement — maps callout assignments to plan sheets.
 */

import { createStableId } from '../../plan-project/id-utils.js';

function buildCalloutTableFromPlacements(placements = []) {
    const seen = new Map();
    for (const placement of placements) {
        for (const callout of placement.callouts || []) {
            if (!seen.has(callout.calloutId)) {
                seen.set(callout.calloutId, callout);
            }
        }
    }
    return [...seen.values()].sort((a, b) =>
        String(a.code).localeCompare(String(b.code), undefined, { numeric: true })
    );
}

/**
 * @param {object} feature
 * @param {object} routeLine
 * @returns {number|null}
 */
export function resolveFeatureDistanceAlongRoute(feature, routeLine) {
    if (!feature?.geometry || !routeLine?.geometry || typeof turf === 'undefined') {
        return null;
    }

    let point = null;
    if (feature.geometry.type === 'Point') {
        point = turf.point(feature.geometry.coordinates);
    } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length) {
        point = turf.point(feature.geometry.coordinates[0]);
    } else if (feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates[0]?.length) {
        point = turf.point(feature.geometry.coordinates[0][0]);
    }

    if (!point) return null;

    const snapped = turf.nearestPointOnLine(routeLine, point, { units: 'feet' });
    return Number(snapped.properties?.location ?? 0);
}

/**
 * @param {object[]} sheets
 * @param {number} distanceFt
 * @returns {object|null}
 */
export function findSheetForDistance(sheets = [], distanceFt = 0) {
    for (const sheet of sheets) {
        if (distanceFt >= sheet.startDistanceFt && distanceFt <= sheet.endDistanceFt) {
            return sheet;
        }
    }
    return null;
}

/**
 * @param {object} feature
 * @param {object} routeLine
 * @param {number} [offsetFt]
 * @returns {[number, number]|null}
 */
export function computeCalloutMarkerCoordinate(feature, routeLine, offsetFt = 8) {
    if (!feature?.geometry || typeof turf === 'undefined') return null;

    let anchor = null;
    if (feature.geometry.type === 'Point') {
        anchor = turf.point(feature.geometry.coordinates);
    } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length) {
        anchor = turf.point(feature.geometry.coordinates[0]);
    }

    if (!anchor) return null;

    if (!routeLine?.geometry) {
        return anchor.geometry.coordinates;
    }

    const distanceFt = resolveFeatureDistanceAlongRoute(feature, routeLine) ?? 0;
    const lookAhead = Math.min(distanceFt + 10, turf.length(routeLine, { units: 'feet' }));
    const lookBehind = Math.max(distanceFt - 10, 0);
    const ahead = turf.along(routeLine, lookAhead, { units: 'feet' });
    const behind = turf.along(routeLine, lookBehind, { units: 'feet' });
    const bearing = turf.bearing(behind, ahead);
    const marker = turf.destination(anchor, offsetFt, bearing + 90, { units: 'feet' });
    return marker.geometry.coordinates;
}

/**
 * @param {object[]} features
 * @returns {object[]}
 */
export function parseSheetsFromLayerFeatures(features = []) {
    return features
        .filter((feature) => feature.properties?.feature_type === 'sheet_frame')
        .map((feature) => ({
            sheetId: feature.properties.sheet_id || createStableId('sheet'),
            sheetNumber: Number(feature.properties.sheet_number ?? 0),
            sheetType: feature.properties.sheet_type || 'detail',
            centerDistanceFt: Number(feature.properties.center_distance_ft ?? 0),
            startDistanceFt: Number(feature.properties.start_distance_ft ?? 0),
            endDistanceFt: Number(feature.properties.end_distance_ft ?? 0),
            rotationDeg: Number(feature.properties.rotation_deg ?? 0),
            locked: false
        }))
        .sort((a, b) => a.sheetNumber - b.sheetNumber);
}

/**
 * @param {object[]} features
 * @returns {object|null}
 */
export function parseRouteFromLayerFeatures(features = []) {
    const routeFeature = features.find((feature) =>
        feature.properties?.feature_type === 'route' ||
        feature.properties?.feature_type === 'overview_route'
    );
    if (!routeFeature?.geometry) return null;
    return {
        type: 'Feature',
        geometry: routeFeature.geometry,
        properties: routeFeature.properties || {}
    };
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function generateSheetAwarePlacements({
    assignments = [],
    sheets = [],
    features = [],
    routeLine = null,
    offsetFt = 8
} = {}) {
    const featureMap = new Map(
        features.map((feature, index) => [
            feature.id || feature.properties?.feature_id || `feature-${index}`,
            feature
        ])
    );

    const detailSheets = sheets.filter((sheet) => sheet.sheetType !== 'overview');
    const bySheet = new Map(detailSheets.map((sheet) => [sheet.sheetId, {
        sheetId: sheet.sheetId,
        sheetNumber: sheet.sheetNumber,
        startDistanceFt: sheet.startDistanceFt,
        endDistanceFt: sheet.endDistanceFt,
        placements: []
    }]));

    for (const assignment of assignments) {
        const feature = featureMap.get(assignment.featureId);
        if (!feature) continue;

        const distanceAlongFt = resolveFeatureDistanceAlongRoute(feature, routeLine);
        const sheet = distanceAlongFt != null
            ? findSheetForDistance(detailSheets, distanceAlongFt)
            : detailSheets[0] || null;
        if (!sheet) continue;

        const markerCoordinate = computeCalloutMarkerCoordinate(feature, routeLine, offsetFt);
        const bucket = bySheet.get(sheet.sheetId);
        if (!bucket) continue;

        bucket.placements.push({
            placementId: createStableId('placement'),
            assignmentId: assignment.assignmentId,
            featureId: assignment.featureId,
            sheetId: sheet.sheetId,
            sheetNumber: sheet.sheetNumber,
            distanceAlongFt,
            callouts: assignment.callouts || [],
            calloutIds: assignment.calloutIds || [],
            markerCoordinate
        });
    }

    return [...bySheet.values()].map((entry) => ({
        ...entry,
        calloutTable: buildCalloutTableFromPlacements(entry.placements)
    }));
}

/**
 * @param {object[]} sheetPlacements
 * @returns {Record<string, object[]>}
 */
export function buildPerSheetCalloutTables(sheetPlacements = []) {
    const tables = {};
    for (const sheet of sheetPlacements) {
        tables[sheet.sheetId] = sheet.calloutTable || [];
    }
    return tables;
}

/**
 * @param {object[]} sheetPlacements
 * @returns {object}
 */
export function buildSheetCalloutMarkersGeoJson(sheetPlacements = []) {
    const features = [];

    for (const sheet of sheetPlacements) {
        for (const placement of sheet.placements || []) {
            if (!placement.markerCoordinate) continue;
            const primary = placement.callouts?.[0];
            features.push({
                type: 'Feature',
                properties: {
                    feature_type: 'callout_marker',
                    sheet_id: sheet.sheetId,
                    sheet_number: sheet.sheetNumber,
                    feature_id: placement.featureId,
                    callout_code: primary?.code || '',
                    callout_codes: (placement.callouts || []).map((entry) => entry.code).join(', '),
                    callout_shape: primary?.shape || '',
                    callout_description: primary?.shortDescription || ''
                },
                geometry: {
                    type: 'Point',
                    coordinates: placement.markerCoordinate
                }
            });
        }
    }

    return { type: 'FeatureCollection', features };
}

/**
 * @param {object[]} sheetPlacements
 * @returns {string}
 */
export function buildPerSheetCalloutTablesCsv(sheetPlacements = []) {
    const rows = [['sheet_number', 'sheet_id', 'code', 'shape', 'category', 'description']];
    for (const sheet of sheetPlacements) {
        for (const callout of sheet.calloutTable || []) {
            rows.push([
                String(sheet.sheetNumber ?? ''),
                sheet.sheetId || '',
                callout.code || '',
                callout.shape || '',
                callout.category || '',
                callout.shortDescription || ''
            ]);
        }
    }
    return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * @param {object[]} sheetPlacements
 * @param {object[]} assignments
 * @param {object[]} sheets
 * @returns {{ valid: boolean, warnings: string[], findings: object[] }}
 */
export function validateSheetAwarePlacements(sheetPlacements = [], assignments = [], sheets = []) {
    const findings = [];
    const placedFeatureIds = new Set();

    for (const sheet of sheetPlacements) {
        for (const placement of sheet.placements || []) {
            placedFeatureIds.add(placement.featureId);
        }
    }

    const unplaced = assignments.filter((assignment) => !placedFeatureIds.has(assignment.featureId));
    if (unplaced.length) {
        findings.push({
            severity: 'warning',
            code: 'unplaced_assignments',
            message: `${unplaced.length} callout assignment(s) fall outside sheet coverage.`
        });
    }

    const emptySheets = sheetPlacements.filter((sheet) => !(sheet.placements || []).length);
    if (emptySheets.length && sheets.length) {
        findings.push({
            severity: 'info',
            code: 'empty_sheets',
            message: `${emptySheets.length} sheet(s) have no callout placements.`
        });
    }

    if (!sheetPlacements.length && assignments.length) {
        findings.push({
            severity: 'error',
            code: 'missing_sheet_placements',
            message: 'No sheet-aware placements generated.'
        });
    }

    const warnings = findings
        .filter((entry) => entry.severity === 'warning' || entry.severity === 'error')
        .map((entry) => entry.message);

    return {
        valid: !findings.some((entry) => entry.severity === 'error'),
        warnings,
        findings
    };
}
