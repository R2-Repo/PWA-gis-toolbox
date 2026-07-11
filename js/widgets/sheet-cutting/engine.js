/**
 * Sheet Cutting — shared engine foundation (Phase 5).
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const PAPER_SIZES = {
    ANSI_D: { widthIn: 22, heightIn: 34 },
    ANSI_E: { widthIn: 34, heightIn: 44 },
    ARCH_D: { widthIn: 24, heightIn: 36 }
};

export const PAGE_ORIENTATIONS = {
    LANDSCAPE: 'landscape',
    PORTRAIT: 'portrait'
};

/**
 * @param {object} input
 * @returns {{ mapFrameWidthFt: number, mapFrameHeightFt: number, explanation: string }}
 */
export function calculateMapFrameGroundDimensions({
    paperSize = 'ANSI_D',
    orientation = PAGE_ORIENTATIONS.LANDSCAPE,
    scale = 200,
    marginsIn = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
    titleBlockIn = { width: 4, height: 2 },
    legendIn = { width: 3, height: 4 },
    notesIn = { width: 0, height: 0 }
}) {
    const sheet = PAPER_SIZES[paperSize] || PAPER_SIZES.ANSI_D;
    const pageWidthIn = orientation === PAGE_ORIENTATIONS.LANDSCAPE ? sheet.heightIn : sheet.widthIn;
    const pageHeightIn = orientation === PAGE_ORIENTATIONS.LANDSCAPE ? sheet.widthIn : sheet.heightIn;

    const printableWidthIn = pageWidthIn - marginsIn.left - marginsIn.right;
    const printableHeightIn = pageHeightIn - marginsIn.top - marginsIn.bottom;
    const mapFrameWidthIn = Math.max(1, printableWidthIn - titleBlockIn.width - legendIn.width - notesIn.width);
    const mapFrameHeightIn = Math.max(1, printableHeightIn - Math.max(titleBlockIn.height, legendIn.height, notesIn.height));

    const inchesPerFoot = 12 / Number(scale || 200);
    const mapFrameWidthFt = mapFrameWidthIn / inchesPerFoot;
    const mapFrameHeightFt = mapFrameHeightIn / inchesPerFoot;

    return {
        mapFrameWidthFt,
        mapFrameHeightFt,
        explanation: `${mapFrameWidthIn.toFixed(2)} in × ${mapFrameHeightIn.toFixed(2)} in map frame at 1:${scale}`
    };
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function generateSheetFramesAlongRoute({
    routeLine,
    mapFrameWidthFt,
    overlapFt = 100,
    direction = 'increasing',
    sheetTemplate = {},
    stationingRoute = null
}) {
    if (!routeLine?.geometry || typeof turf === 'undefined') return [];
    const totalLengthFt = turf.length(routeLine, { units: 'feet' });
    if (totalLengthFt <= 0) return [];

    const step = Math.max(1, mapFrameWidthFt - overlapFt);
    const sheets = [];
    let distance = 0;
    let sheetNumber = 1;

    while (distance < totalLengthFt - 0.01) {
        const endDistance = Math.min(distance + mapFrameWidthFt, totalLengthFt);
        const centerDistance = (distance + endDistance) / 2;
        const centerPoint = turf.along(routeLine, centerDistance, { units: 'feet' });
        const lookAhead = Math.min(centerDistance + 10, totalLengthFt);
        const lookBehind = Math.max(centerDistance - 10, 0);
        const ahead = turf.along(routeLine, lookAhead, { units: 'feet' });
        const behind = turf.along(routeLine, lookBehind, { units: 'feet' });
        const bearing = turf.bearing(behind, ahead);

        sheets.push({
            sheetId: createStableId('sheet'),
            sheetNumber,
            sheetType: 'detail',
            centerDistanceFt: centerDistance,
            startDistanceFt: distance,
            endDistanceFt: endDistance,
            rotationDeg: bearing,
            mapFrameWidthFt,
            mapFrameHeightFt: sheetTemplate.mapFrameHeightFt || mapFrameWidthFt * 0.75,
            locked: false,
            stationingRouteId: stationingRoute?.routeId || '',
            previousSheetId: sheets[sheets.length - 1]?.sheetId || null,
            nextSheetId: null
        });

        if (sheets.length > 1) {
            sheets[sheets.length - 2].nextSheetId = sheets[sheets.length - 1].sheetId;
        }

        if (endDistance >= totalLengthFt - 0.01) break;
        distance += step;
        sheetNumber += 1;
    }

    return direction === 'decreasing' ? sheets.reverse() : sheets;
}

/**
 * @param {object[]} features
 * @param {object[]} sheets
 * @returns {Record<string, string[]>}
 */
export function assignFeaturesToSheets(features = [], sheets = []) {
    const assignments = {};
    for (const sheet of sheets) {
        assignments[sheet.sheetId] = [];
    }

    for (const feature of features) {
        if (!feature?.geometry) continue;
        let coord = null;
        if (feature.geometry.type === 'Point') coord = feature.geometry.coordinates;
        if (feature.geometry.type === 'LineString') coord = feature.geometry.coordinates[0];
        if (!coord) continue;

        for (const sheet of sheets) {
            // Phase 5 foundation: distance-based assignment placeholder.
            assignments[sheet.sheetId].push(feature.id || feature.properties?.feature_id);
        }
    }

    return assignments;
}

/**
 * @param {object} sheet
 * @param {number} nextSheetNumber
 * @returns {object}
 */
export function generateMatchLine(sheet, nextSheetNumber) {
    return {
        sheetId: sheet.sheetId,
        matchLineStation: sheet.endDistanceFt,
        adjacentSheetNumber: nextSheetNumber,
        label: `MATCH LINE – SEE SHEET ${String(nextSheetNumber).padStart(2, '0')}`
    };
}

/**
 * @param {object[]} sheets
 * @param {object} routeLine
 * @returns {object}
 */
export function buildOverviewSheet(sheets = [], routeLine = null) {
    return {
        sheetId: createStableId('sheet'),
        sheetNumber: 0,
        sheetType: 'overview',
        routeGeometry: routeLine?.geometry || null,
        sheetBoxes: sheets.map((sheet) => ({
            sheetId: sheet.sheetId,
            sheetNumber: sheet.sheetNumber,
            centerDistanceFt: sheet.centerDistanceFt,
            rotationDeg: sheet.rotationDeg
        })),
        locked: false
    };
}

/**
 * @param {object[]} sheets
 * @param {object[]} features
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateSheetCoverage(sheets = [], features = []) {
    const warnings = [];
    if (!sheets.length) warnings.push('No sheet boxes generated.');
    if (!features.length) warnings.push('No design features available for sheet assignment.');
    return { valid: warnings.length === 0, warnings };
}
