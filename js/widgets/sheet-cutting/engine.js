/**
 * Sheet Cutting — shared engine foundation (Phase 5).
 */

import { createStableId } from '../../plan-project/id-utils.js';
import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import { getStationingRoutes } from '../../plan-project/stationing-adapter.js';
import { getLocalTangentBearing } from '../project-stationing/engine.js';
import { buildSheetExportPackage, buildSheetFramesGeoJson } from './export-builder.js';
import { DEFAULT_PDF_MAP_BEARING_MODE } from './sheet-pdf-orientation.js';

export const PAPER_SIZES = {
    TABLOID: { widthIn: 11, heightIn: 17 },
    ANSI_B: { widthIn: 11, heightIn: 17 },
    ANSI_D: { widthIn: 22, heightIn: 34 },
    ANSI_E: { widthIn: 34, heightIn: 44 },
    ARCH_D: { widthIn: 24, heightIn: 36 }
};

export const PAGE_ORIENTATIONS = {
    LANDSCAPE: 'landscape',
    PORTRAIT: 'portrait'
};

/** Default basemap underlay resolution for hybrid sheet PDF export. */
export const DEFAULT_BASEMAP_DPI = 150;

/** Maximum basemap DPI — vector linework is independent of this cap. */
export const MAX_BASEMAP_DPI = 200;

/** @deprecated Use basemapDpi; kept for session backward compatibility. */
export const DEFAULT_SHEET_EXPORT_DPI = DEFAULT_BASEMAP_DPI;

/**
 * @param {object} [template]
 * @returns {number}
 */
export function resolveBasemapDpi(template = {}) {
    const raw = template.basemapDpi ?? template.exportDpi ?? DEFAULT_BASEMAP_DPI;
    return Math.max(72, Math.min(MAX_BASEMAP_DPI, Number(raw) || DEFAULT_BASEMAP_DPI));
}

export {
    PDF_MAP_BEARING_MODES,
    DEFAULT_PDF_MAP_BEARING_MODE,
    PDF_EXPORT_STATION_EPS_FT,
    PDF_DETAIL_FOOTER_BAND_IN,
    PDF_DETAIL_FOOTER_GAP_IN,
    resolveSheetPdfBearing,
    resolveSheetPdfBearings,
    formatRouteStationFt,
    formatSheetExportDate,
    buildSheetContinuationLabels,
    buildSheetTitleBlockFooterModel,
    tangentToLandscapeMapBearing,
    landscapeBearingCandidates,
    northPointsUpOnPage,
    resolveLandscapeAlignBearing,
    normalizeMapBearingForLeftToRight
} from './sheet-pdf-orientation.js';

/**
 * Printable page dimensions in inches from a sheet template.
 * @param {object} template
 * @returns {{ pageWidthIn: number, pageHeightIn: number, printableWidthIn: number, printableHeightIn: number, marginsIn: object }}
 */
export function computePrintablePageDimensionsIn(template = {}) {
    const sheet = PAPER_SIZES[template.paperSize] || PAPER_SIZES.TABLOID;
    const landscape = (template.orientation || PAGE_ORIENTATIONS.LANDSCAPE) === PAGE_ORIENTATIONS.LANDSCAPE;
    const pageWidthIn = landscape ? sheet.heightIn : sheet.widthIn;
    const pageHeightIn = landscape ? sheet.widthIn : sheet.heightIn;
    const marginsIn = {
        top: 0.5,
        right: 0.5,
        bottom: 0.5,
        left: 0.5,
        ...(template.marginsIn || {})
    };

    return {
        pageWidthIn,
        pageHeightIn,
        printableWidthIn: Math.max(1, pageWidthIn - marginsIn.left - marginsIn.right),
        printableHeightIn: Math.max(1, pageHeightIn - marginsIn.top - marginsIn.bottom),
        marginsIn
    };
}

/**
 * Target map-capture pixel size for sheet PDF export at a given DPI.
 * @param {object} template
 * @param {number} [dpi]
 * @returns {{ widthPx: number, heightPx: number, dpi: number, marginsPt: object, printableWidthIn: number, printableHeightIn: number }}
 */
export function computeSheetExportPixelDimensions(template = {}, dpi = null) {
    const resolvedDpi = resolveBasemapDpi({ ...template, basemapDpi: dpi ?? template.basemapDpi ?? template.exportDpi });
    const page = computePrintablePageDimensionsIn(template);
    const marginsPt = {
        top: page.marginsIn.top * 72,
        right: page.marginsIn.right * 72,
        bottom: page.marginsIn.bottom * 72,
        left: page.marginsIn.left * 72
    };

    return {
        widthPx: Math.round(page.printableWidthIn * resolvedDpi),
        heightPx: Math.round(page.printableHeightIn * resolvedDpi),
        dpi: resolvedDpi,
        marginsPt,
        printableWidthIn: page.printableWidthIn,
        printableHeightIn: page.printableHeightIn
    };
}

/** Default along-route sheet length and perpendicular corridor width (ground feet). */
export const DEFAULT_SHEET_LENGTH_FT = 1100;
export const DEFAULT_CORRIDOR_WIDTH_FT = 350;

/**
 * Resolve map-frame ground dimensions from template foot fields or legacy scale.
 * @param {object} template
 * @returns {{ mapFrameWidthFt: number, mapFrameHeightFt: number, explanation: string }}
 */
export function resolveSheetFrameDimensions(template = {}) {
    const hasFootFields = template.sheetLengthFt != null || template.corridorWidthFt != null;

    if (hasFootFields || template.scale == null) {
        const mapFrameWidthFt = Math.max(1, Number(template.sheetLengthFt) || DEFAULT_SHEET_LENGTH_FT);
        const mapFrameHeightFt = Math.max(1, Number(template.corridorWidthFt) || DEFAULT_CORRIDOR_WIDTH_FT);
        return {
            mapFrameWidthFt,
            mapFrameHeightFt,
            explanation: `${Math.round(mapFrameWidthFt).toLocaleString()} ft along route × ${Math.round(mapFrameHeightFt).toLocaleString()} ft corridor`
        };
    }

    return calculateMapFrameGroundDimensions({
        paperSize: template.paperSize,
        orientation: template.orientation,
        scale: template.scale,
        marginsIn: template.marginsIn,
        titleBlockIn: template.titleBlockIn,
        legendIn: template.legendIn,
        notesIn: template.notesIn
    });
}

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
 * Printable PDF page size in points from sheet template.
 * @param {object} template
 * @returns {[number, number]}
 */
export function computePdfPageSizePt(template = {}) {
    const sheet = PAPER_SIZES[template.paperSize] || PAPER_SIZES.TABLOID;
    const landscape = (template.orientation || PAGE_ORIENTATIONS.LANDSCAPE) === PAGE_ORIENTATIONS.LANDSCAPE;
    const widthIn = landscape ? sheet.heightIn : sheet.widthIn;
    const heightIn = landscape ? sheet.widthIn : sheet.heightIn;
    return [widthIn * 72, heightIn * 72];
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function generateSheetFramesAlongRoute({
    routeLine,
    mapFrameWidthFt,
    direction = 'increasing',
    sheetTemplate = {},
    stationingRoute = null
}) {
    if (!routeLine?.geometry || typeof turf === 'undefined') return [];
    const totalLengthFt = turf.length(routeLine, { units: 'feet' });
    if (totalLengthFt <= 0 || mapFrameWidthFt <= 0) return [];

    const sheets = [];
    let distance = 0;
    let sheetNumber = 1;

    while (distance < totalLengthFt - 0.01) {
        const endDistance = Math.min(distance + mapFrameWidthFt, totalLengthFt);
        const centerDistance = (distance + endDistance) / 2;
        const bearing = getLocalTangentBearing(routeLine, centerDistance);

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
        distance = endDistance;
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
    const sortedSheets = [...sheets].sort((a, b) => a.startDistanceFt - b.startDistanceFt);

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

        for (let i = 0; i < sortedSheets.length; i++) {
            const sheet = sortedSheets[i];
            if (distanceAlongFt != null) {
                const isLast = i === sortedSheets.length - 1;
                const inRange = distanceAlongFt >= sheet.startDistanceFt
                    && (isLast ? distanceAlongFt <= sheet.endDistanceFt : distanceAlongFt < sheet.endDistanceFt);
                if (inRange) {
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
 * @param {'start'|'end'} position
 * @param {number} adjacentSheetNumber
 * @param {string} adjacentSheetId
 * @returns {object}
 */
export function generateMatchLine(sheet, position, adjacentSheetNumber, adjacentSheetId) {
    const station = position === 'start' ? sheet.startDistanceFt : sheet.endDistanceFt;
    return {
        sheetId: sheet.sheetId,
        position,
        matchLineStation: station,
        adjacentSheetId,
        adjacentSheetNumber,
        label: `MATCH LINE – SEE SHEET ${String(adjacentSheetNumber).padStart(2, '0')}`
    };
}

/**
 * @param {object[]} sheets
 * @returns {object[]}
 */
export function generateSheetMatchLines(sheets = []) {
    const matchLines = [];
    for (let i = 0; i < sheets.length; i++) {
        const sheet = sheets[i];
        if (i > 0) {
            const prev = sheets[i - 1];
            matchLines.push(generateMatchLine(sheet, 'start', prev.sheetNumber, prev.sheetId));
        }
        if (i < sheets.length - 1) {
            const next = sheets[i + 1];
            matchLines.push(generateMatchLine(sheet, 'end', next.sheetNumber, next.sheetId));
        }
    }
    return matchLines;
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
 * @param {number|null} [routeLengthFt]
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateSheetTiling(sheets = [], routeLengthFt = null) {
    const warnings = [];
    const detail = sheets.filter((sheet) => sheet.sheetType !== 'overview');
    if (!detail.length) {
        return { valid: false, warnings: ['No sheet boxes generated.'] };
    }

    if (detail[0].startDistanceFt > 0.01) {
        warnings.push('First sheet does not start at route beginning.');
    }

    for (let i = 0; i < detail.length - 1; i++) {
        if (Math.abs(detail[i].endDistanceFt - detail[i + 1].startDistanceFt) > 0.01) {
            warnings.push(`Gap or overlap between sheet ${detail[i].sheetNumber} and ${detail[i + 1].sheetNumber}.`);
        }
    }

    if (routeLengthFt != null && Math.abs(detail[detail.length - 1].endDistanceFt - routeLengthFt) > 0.01) {
        warnings.push('Last sheet does not reach route end.');
    }

    if (routeLengthFt != null) {
        const totalCoverage = detail.reduce((sum, sheet) => sum + (sheet.endDistanceFt - sheet.startDistanceFt), 0);
        if (Math.abs(totalCoverage - routeLengthFt) > 0.01) {
            warnings.push('Sheet station ranges do not fully cover the route.');
        }
    }

    const lastSheet = detail[detail.length - 1];
    const frameWidth = lastSheet.mapFrameWidthFt || 0;
    const lastSegment = lastSheet.endDistanceFt - lastSheet.startDistanceFt;
    if (frameWidth > 0 && lastSegment < frameWidth * 0.5 && detail.length > 1) {
        warnings.push(`Last sheet covers only ${Math.round(lastSegment)} ft (shorter than map frame width).`);
    }

    return { valid: warnings.length === 0, warnings };
}

/**
 * @param {object[]} sheets
 * @param {object} [routeLine]
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateClippedSheetOverlap(sheets = [], routeLine = null) {
    const warnings = [];
    if (!routeLine?.geometry || typeof turf === 'undefined' || sheets.length < 2) {
        return { valid: true, warnings };
    }

    const frames = buildSheetFramesGeoJson(
        sheets.filter((sheet) => sheet.sheetType !== 'overview'),
        routeLine
    ).features;

    for (let i = 0; i < frames.length - 1; i++) {
        try {
            const intersection = turf.intersect(turf.featureCollection([frames[i], frames[i + 1]]));
            if (intersection && turf.area(intersection) > 1) {
                warnings.push(`Clipped polygons for sheets ${i + 1} and ${i + 2} overlap.`);
            }
        } catch (_) { /* skip invalid geometry pairs */ }
    }

    return { valid: warnings.length === 0, warnings };
}

/**
 * Verify clipped sheet polygons tile the route centerline with no gaps.
 * @param {object[]} sheets
 * @param {object} [routeLine]
 * @param {number} [sampleStepFt]
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateCenterlinePolygonCoverage(sheets = [], routeLine = null, sampleStepFt = 25) {
    const warnings = [];
    if (!routeLine?.geometry || typeof turf === 'undefined' || sheets.length === 0) {
        return { valid: true, warnings };
    }

    const detail = sheets.filter((sheet) => sheet.sheetType !== 'overview');
    const frames = buildSheetFramesGeoJson(detail, routeLine).features;
    if (!frames.length) {
        return { valid: false, warnings: ['No clipped sheet polygons generated.'] };
    }

    if (frames.length !== detail.length) {
        const frameIds = new Set(frames.map((frame) => frame.properties?.sheet_id));
        for (const sheet of detail) {
            if (!frameIds.has(sheet.sheetId)) {
                warnings.push(`Sheet ${String(sheet.sheetNumber).padStart(2, '0')} polygon could not be built.`);
            }
        }
    }

    const routeLengthFt = turf.length(routeLine, { units: 'feet' });
    const step = Math.max(5, sampleStepFt);
    const halfHeight = (detail[0]?.mapFrameHeightFt || 75) / 2;

    for (let distance = 0; distance <= routeLengthFt + 0.01; distance += step) {
        const clamped = Math.min(distance, routeLengthFt);
        const centerPoint = turf.along(routeLine, clamped, { units: 'feet' });
        const bearing = getLocalTangentBearing(routeLine, clamped);
        const offsets = [0, halfHeight * 0.5, -halfHeight * 0.5];

        for (const offset of offsets) {
            const sample = offset === 0
                ? centerPoint
                : turf.destination(centerPoint, Math.abs(offset), bearing + (offset > 0 ? 90 : -90), { units: 'feet' });
            const containing = frames.filter((frame) => turf.booleanPointInPolygon(sample, frame, { ignoreBoundary: true }));

            if (containing.length === 0) {
                warnings.push(`Gap in sheet coverage near ${Math.round(clamped)} ft along route.`);
                return { valid: false, warnings };
            }
            if (containing.length > 1) {
                warnings.push(`Overlapping sheet coverage near ${Math.round(clamped)} ft along route.`);
                return { valid: false, warnings };
            }
        }
    }

    return { valid: warnings.length === 0, warnings };
}

/**
 * @param {object[]} sheets
 * @param {object[]} features
 * @param {object} [routeLine]
 * @returns {{ valid: boolean, warnings: string[] }}
 */
export function validateSheetCoverage(sheets = [], features = [], routeLine = null) {
    const warnings = [];
    const routeLengthFt = routeLine?.geometry && typeof turf !== 'undefined'
        ? turf.length(routeLine, { units: 'feet' })
        : null;

    const tiling = validateSheetTiling(sheets, routeLengthFt);
    warnings.push(...tiling.warnings);

    if (!features.length) warnings.push('No design features available for sheet assignment.');

    const overlap = validateClippedSheetOverlap(sheets, routeLine);
    warnings.push(...overlap.warnings);

    const centerline = validateCenterlinePolygonCoverage(sheets, routeLine);
    warnings.push(...centerline.warnings);

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
    paperSize: 'TABLOID',
    orientation: PAGE_ORIENTATIONS.LANDSCAPE,
    pdfMapBearingMode: DEFAULT_PDF_MAP_BEARING_MODE,
    basemapDpi: DEFAULT_BASEMAP_DPI,
    exportDpi: DEFAULT_BASEMAP_DPI,
    sheetLengthFt: DEFAULT_SHEET_LENGTH_FT,
    corridorWidthFt: DEFAULT_CORRIDOR_WIDTH_FT,
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
        projectName: input.projectName || 'Sheet Cutter',
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

function findLineFeature(layer) {
    return (layer?.geojson?.features || []).find((feature) => {
        const type = feature?.geometry?.type;
        return type === 'LineString' || type === 'MultiLineString';
    }) || null;
}

/**
 * @param {object} session
 * @param {object[]} layers
 * @param {string} stationingLayerId
 * @returns {object}
 */
export function selectRouteSource(session, layers = [], stationingLayerId = '') {
    if (!stationingLayerId) {
        throw new Error('Select a route centerline layer.');
    }

    const layer = layers.find((entry) => entry.id === stationingLayerId);
    if (!layer) {
        throw new Error('Select a route centerline layer.');
    }

    const routes = getStationingRoutes(layers);
    const route = routes.find((entry) => entry.layerId === stationingLayerId);
    if (route) {
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

    const lineFeature = findLineFeature(layer);
    if (!lineFeature) {
        throw new Error('Selected layer has no line geometry.');
    }

    return {
        ...session,
        project: updatePlanProject(session.project, {
            stationingRouteLayerId: layer.id,
            stationingProjectId: ''
        }),
        stationingRoute: {
            routeId: layer.id,
            routeName: layer.name || 'Route',
            layerId: layer.id,
            geometry: lineFeature.geometry,
            lineFeature,
            profile: null
        },
        routeLine: lineFeature
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
    const frameDims = resolveSheetFrameDimensions(template);

    const sheets = generateSheetFramesAlongRoute({
        routeLine: session.routeLine,
        mapFrameWidthFt: frameDims.mapFrameWidthFt,
        direction: template.direction,
        sheetTemplate: frameDims,
        stationingRoute: session.stationingRoute
    });

    const matchLines = generateSheetMatchLines(sheets);

    const overviewSheet = buildOverviewSheet(sheets, session.routeLine);

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

    const coverage = validateSheetCoverage(sheetSet.sheets || [], session.designFeatures || [], session.routeLine);
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
