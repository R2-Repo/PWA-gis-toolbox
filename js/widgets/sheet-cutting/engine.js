/**
 * Sheet Cutting — shared engine foundation (Phase 5).
 */

import { createStableId } from '../../plan-project/id-utils.js';
import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import { getStationingRoutes } from '../../plan-project/stationing-adapter.js';
import { buildSheetExportPackage } from './export-builder.js';

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
 * @param {object} [routeLine]
 * @returns {Record<string, string[]>}
 */
export function assignFeaturesToSheets(features = [], sheets = [], routeLine = null) {
    const assignments = {};
    for (const sheet of sheets) {
        assignments[sheet.sheetId] = [];
    }

    if (!features.length || !sheets.length) {
        return assignments;
    }

    const hasRoute = routeLine?.geometry && typeof turf !== 'undefined';

    for (const feature of features) {
        if (!feature?.geometry) continue;

        const featureId = feature.id
            || feature.properties?.feature_id
            || feature.properties?.segment_id
            || feature.properties?.fiber_id;
        if (!featureId) continue;

        let distanceAlongFt = null;
        if (hasRoute) {
            let point = null;
            if (feature.geometry.type === 'Point') {
                point = turf.point(feature.geometry.coordinates);
            } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length) {
                point = turf.point(feature.geometry.coordinates[0]);
            } else if (feature.geometry.type === 'MultiLineString' && feature.geometry.coordinates[0]?.length) {
                point = turf.point(feature.geometry.coordinates[0][0]);
            }

            if (point) {
                const snapped = turf.nearestPointOnLine(routeLine, point, { units: 'feet' });
                distanceAlongFt = Number(snapped.properties?.location ?? 0);
            }
        }

        for (const sheet of sheets) {
            if (distanceAlongFt != null) {
                if (distanceAlongFt >= sheet.startDistanceFt && distanceAlongFt <= sheet.endDistanceFt) {
                    assignments[sheet.sheetId].push(featureId);
                    break;
                }
            } else if (!hasRoute) {
                assignments[sheet.sheetId].push(featureId);
            }
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

export const WIDGET_ID = 'sheet-cutting';

export const SHEET_STEPS = [
    'Project',
    'Route',
    'Template',
    'Generate',
    'Review',
    'Export'
];

export const DEFAULT_SHEET_TEMPLATE = {
    paperSize: 'ANSI_D',
    orientation: PAGE_ORIENTATIONS.LANDSCAPE,
    scale: 200,
    overlapFt: 100,
    direction: 'increasing',
    marginsIn: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
    titleBlockIn: { width: 4, height: 2 },
    legendIn: { width: 3, height: 4 },
    notesIn: { width: 0, height: 0 },
    includeOverview: true
};

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createSheetSetState(input = {}) {
    return {
        sheetSetId: input.sheetSetId || createStableId('sheetset'),
        sheetSetName: input.sheetSetName || 'Sheet Set 1',
        template: { ...DEFAULT_SHEET_TEMPLATE, ...(input.template || {}) },
        sheets: Array.isArray(input.sheets) ? [...input.sheets] : [],
        overviewSheet: input.overviewSheet || null,
        matchLines: Array.isArray(input.matchLines) ? [...input.matchLines] : [],
        featureAssignments: input.featureAssignments || {},
        designLayerIds: Array.isArray(input.designLayerIds) ? [...input.designLayerIds] : []
    };
}

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createSheetCuttingSession(input = {}) {
    const project = createPlanProject({
        projectName: input.projectName || 'Sheet Cutting',
        projectNumber: input.projectNumber || ''
    });

    return {
        project,
        sheets: createSheetSetState({ sheetSetName: `${project.projectName} Sheets` }),
        routeLine: null,
        stationingRoute: null,
        designFeatures: []
    };
}

/**
 * @param {object} session
 * @param {object} patch
 * @returns {object}
 */
export function updateSheetProject(session, patch = {}) {
    return {
        ...session,
        project: updatePlanProject(session.project, patch)
    };
}

/**
 * @param {object} session
 * @param {object[]} layers
 * @param {string} stationingLayerId
 * @returns {object}
 */
export function selectRouteSource(session, layers = [], stationingLayerId = '') {
    const routes = getStationingRoutes(layers);
    const route = routes.find((entry) => entry.layerId === stationingLayerId) || routes[0] || null;
    if (!route) {
        throw new Error('Select a Project Stationing centerline layer.');
    }

    const routeLine = route.lineFeature || route.feature || {
        type: 'Feature',
        geometry: route.geometry,
        properties: route.properties || {}
    };

    return {
        ...session,
        project: updatePlanProject(session.project, {
            stationingRouteLayerId: route.layerId,
            stationingProjectId: route.projectId || ''
        }),
        stationingRoute: route,
        routeLine
    };
}

/**
 * @param {object} session
 * @param {object} templatePatch
 * @returns {object}
 */
export function configureSheetTemplate(session, templatePatch = {}) {
    return {
        ...session,
        sheets: {
            ...session.sheets,
            template: {
                ...session.sheets.template,
                ...templatePatch
            }
        }
    };
}

/**
 * @param {object} session
 * @param {string[]} layerIds
 * @returns {object}
 */
export function selectDesignLayersForSheets(session, layerIds = []) {
    return {
        ...session,
        sheets: {
            ...session.sheets,
            designLayerIds: [...layerIds]
        }
    };
}

/**
 * @param {object} session
 * @param {object[]} features
 * @returns {object}
 */
export function setSheetDesignFeatures(session, features = []) {
    return {
        ...session,
        designFeatures: features.map((feature, index) => ({
            ...feature,
            id: feature.id || feature.properties?.feature_id || `feature-${index}`
        }))
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function generateSheetSet(session) {
    if (!session.routeLine?.geometry) {
        throw new Error('Select a route centerline before generating sheets.');
    }

    const template = session.sheets.template || DEFAULT_SHEET_TEMPLATE;
    const frameDims = calculateMapFrameGroundDimensions({
        paperSize: template.paperSize,
        orientation: template.orientation,
        scale: template.scale,
        marginsIn: template.marginsIn,
        titleBlockIn: template.titleBlockIn,
        legendIn: template.legendIn,
        notesIn: template.notesIn
    });

    const sheets = generateSheetFramesAlongRoute({
        routeLine: session.routeLine,
        mapFrameWidthFt: frameDims.mapFrameWidthFt,
        mapFrameHeightFt: frameDims.mapFrameHeightFt,
        overlapFt: template.overlapFt,
        direction: template.direction,
        sheetTemplate: frameDims,
        stationingRoute: session.stationingRoute
    });

    const matchLines = sheets.slice(0, -1).map((sheet, index) =>
        generateMatchLine(sheet, sheets[index + 1].sheetNumber)
    );

    const overviewSheet = template.includeOverview
        ? buildOverviewSheet(sheets, session.routeLine)
        : null;

    const featureAssignments = assignFeaturesToSheets(
        session.designFeatures || [],
        sheets,
        session.routeLine
    );

    const sheetSetId = session.sheets.sheetSetId || createStableId('sheetset');

    return {
        ...session,
        project: updatePlanProject(session.project, {
            sheetSetIds: [...new Set([...(session.project.sheetSetIds || []), sheetSetId])]
        }),
        sheets: {
            ...session.sheets,
            sheetSetId,
            sheets,
            overviewSheet,
            matchLines,
            featureAssignments,
            frameDimensions: frameDims
        }
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildSessionExport(session) {
    return buildSheetExportPackage(session);
}

/**
 * @param {object} session
 * @returns {object}
 */
export function serializeSheetSession(session) {
    return serializePlanProject(session.project, {
        sheets: session.sheets,
        metadata: {
            widget: WIDGET_ID,
            stationingRouteLayerId: session.stationingRoute?.layerId || '',
            stationingRouteName: session.stationingRoute?.routeName || '',
            routeGeometry: session.routeLine?.geometry || null,
            designFeatureCount: session.designFeatures?.length || 0
        }
    });
}

/**
 * @param {object} bundle
 * @returns {object}
 */
export function restoreSheetSession(bundle) {
    const restored = restorePlanProject(bundle);
    if (!restored.ok) {
        throw new Error(restored.errors[0]);
    }

    return {
        project: restored.project,
        sheets: createSheetSetState(restored.sheets || {}),
        routeLine: bundle.metadata?.routeGeometry
            ? { type: 'Feature', geometry: bundle.metadata.routeGeometry, properties: {} }
            : null,
        stationingRoute: bundle.metadata?.stationingRouteLayerId
            ? {
                layerId: bundle.metadata.stationingRouteLayerId,
                routeName: bundle.metadata.stationingRouteName || ''
            }
            : null,
        designFeatures: []
    };
}

/**
 * @param {object} session
 * @returns {{ valid: boolean, errors: string[], warnings: string[], findings: object[] }}
 */
export function validateSheetSession(session) {
    const findings = [];
    const sheetSet = session.sheets || {};

    if (!session.stationingRoute) {
        findings.push({
            severity: 'warning',
            code: 'missing_route',
            message: 'No stationing route selected.',
            step: 'Route'
        });
    }

    if (!(sheetSet.sheets || []).length) {
        findings.push({
            severity: 'warning',
            code: 'missing_sheets',
            message: 'Generate sheet frames before export.',
            step: 'Generate'
        });
    }

    const coverage = validateSheetCoverage(sheetSet.sheets || [], session.designFeatures || []);
    for (const warning of coverage.warnings) {
        findings.push({
            severity: 'warning',
            code: 'coverage_warning',
            message: warning,
            step: 'Review'
        });
    }

    const errors = findings.filter((entry) => entry.severity === 'error').map((entry) => entry.message);
    const warnings = findings.filter((entry) => entry.severity === 'warning').map((entry) => entry.message);

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        findings
    };
}
