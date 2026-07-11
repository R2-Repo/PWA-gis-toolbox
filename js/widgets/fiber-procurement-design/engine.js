/**
 * Fiber Procurement Design widget engine — pure orchestration.
 */

import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import { getStationingRoutes, getStationRangeForLine, getStationAtCoordinate, applyStationingToLineFeature, applyStationingToPointFeature } from '../../plan-project/stationing-adapter.js';
import { validateRelationships } from '../../plan-project/relationship-model.js';
import { indexDesignFeatures } from './design-model.js';
import { createSampleProcurementCatalog } from './catalog-adapter.js';
import {
    createAlignment,
    createDesignState,
    createStructure,
    STRUCTURE_TYPES
} from './design-model.js';
import {
    placeStructureOnAlignment,
    regenerateConduitSegments,
    moveStructureOnAlignment,
    deleteStructureFromAlignment,
    updateConduitSegment
} from './relationship-engine.js';
import { generateFiberRoute, synchronizeAllFiberRoutes } from './fiber-routing-engine.js';
import { recalculateDesignQuantities, mergeQuantityOverrides } from './quantity-rules.js';
import { buildProjectExportPackage } from './export-builder.js';
import { lineLengthAny } from '../../tools/line-geojson.js';

export const WIDGET_ID = 'fiber-procurement-design';

export const DESIGN_STEPS = [
    'Project',
    'Stationing',
    'Catalog',
    'Alignment',
    'Structures',
    'Conduit',
    'Fiber',
    'Quantities',
    'Export'
];

/**
 * @param {object} [input]
 * @returns {object}
 */
export function createFiberDesignSession(input = {}) {
    const project = createPlanProject({
        projectName: input.projectName || 'Fiber Procurement Design',
        projectNumber: input.projectNumber || '',
        designer: input.designer || ''
    });

    return {
        project,
        design: createDesignState(),
        catalog: null,
        stationingRoute: null,
        activeAlignmentId: null
    };
}

/**
 * @param {object} session
 * @param {object} patch
 * @returns {object}
 */
export function updateSessionProject(session, patch = {}) {
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
export function selectStationingSource(session, layers = [], stationingLayerId = '') {
    const routes = getStationingRoutes(layers);
    const route = routes.find((entry) => entry.layerId === stationingLayerId) || routes[0] || null;
    if (!route) {
        throw new Error('Select a Project Stationing centerline layer.');
    }

    return {
        ...session,
        stationingRoute: route,
        project: updatePlanProject(session.project, {
            stationingRouteLayerId: route.layerId,
            stationingProjectId: route.routeId
        })
    };
}

/**
 * @param {object} session
 * @param {object} [catalog]
 * @returns {object}
 */
export function loadProcurementCatalog(session, catalog = null) {
    const resolved = catalog || createSampleProcurementCatalog();
    return {
        ...session,
        catalog: resolved,
        project: updatePlanProject(session.project, {
            procurementCatalogId: resolved.catalogId,
            procurementCatalogVersion: resolved.version
        })
    };
}

/**
 * @param {object} session
 * @param {import('geojson').LineString} geometry
 * @param {object} [meta]
 * @returns {object}
 */
export function addPlanningAlignment(session, geometry, meta = {}) {
    if (!geometry?.coordinates?.length || geometry.coordinates.length < 2) {
        throw new Error('Alignment must contain at least two vertices.');
    }

    const lineFeature = { type: 'Feature', geometry, properties: {} };
    const stationing = session.stationingRoute
        ? getStationRangeForLine(session.stationingRoute, lineFeature)
        : null;

    const alignment = createAlignment({
        projectId: session.project.projectId,
        geometry,
        alignmentName: meta.alignmentName || 'Planning alignment',
        routeName: meta.routeName || session.stationingRoute?.routeName || '',
        stationingRouteId: stationing?.stationingRouteId || session.stationingRoute?.routeId || '',
        startStation: stationing?.startStation ?? null,
        endStation: stationing?.endStation ?? null,
        startMilepost: stationing?.startMilepost ?? null,
        endMilepost: stationing?.endMilepost ?? null
    });

    const regen = regenerateConduitSegments({
        alignment,
        structures: [],
        projectId: session.project.projectId,
        projectDefaults: session.project,
        relationships: session.project.relationships || []
    });

    const design = {
        ...session.design,
        alignments: [...(session.design.alignments || []), alignment],
        conduitSegments: regen.segments
    };

    return {
        ...session,
        design,
        activeAlignmentId: alignment.alignmentId,
        project: updatePlanProject(session.project, { relationships: regen.relationships })
    };
}

/**
 * @param {object} session
 * @param {string} assetType
 * @param {[number, number]} coordinate
 * @param {object} [meta]
 * @returns {object}
 */
export function placeStructure(session, assetType, coordinate, meta = {}) {
    const alignment = getActiveAlignment(session);
    if (!alignment) throw new Error('Draw a planning alignment first.');

    const stationing = session.stationingRoute
        ? getStationAtCoordinate(session.stationingRoute, coordinate)
        : null;

    const placement = placeStructureOnAlignment({
        alignment,
        coordinate,
        assetType: assetType || STRUCTURE_TYPES.JUNCTION_BOX,
        projectId: session.project.projectId,
        structureName: meta.structureName || '',
        existingStructures: session.design.structures || [],
        stationing
    });

    const structures = [...(session.design.structures || []), placement.structure];
    const regen = regenerateConduitSegments({
        alignment,
        structures,
        projectId: session.project.projectId,
        projectDefaults: session.project,
        existingSegments: session.design.conduitSegments || [],
        relationships: session.project.relationships || []
    });

    const fibers = synchronizeAllFiberRoutes({
        ...session.design,
        conduitSegments: regen.segments
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            structures,
            conduitSegments: regen.segments,
            fibers
        },
        project: updatePlanProject(session.project, { relationships: regen.relationships })
    });
}

/**
 * @param {object} session
 * @param {string} segmentId
 * @param {object} patch
 * @returns {object}
 */
export function configureConduitSegment(session, segmentId, patch = {}) {
    const segments = (session.design.conduitSegments || []).map((segment) =>
        segment.segmentId === segmentId ? updateConduitSegment(segment, patch) : segment
    );

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            conduitSegments: segments
        }
    });
}

/**
 * @param {object} session
 * @param {object} input
 * @returns {object}
 */
export function addFiberRoute(session, input = {}) {
    const fiber = generateFiberRoute({
        projectId: session.project.projectId,
        segmentIds: input.segmentIds || [],
        segments: session.design.conduitSegments || [],
        startStructureId: input.startStructureId,
        endStructureId: input.endStructureId,
        catalogItemId: input.catalogItemId || '',
        cableName: input.cableName || '',
        cableType: input.cableType || 'SM',
        strandCount: input.strandCount || 144,
        assignedConduitComponentIds: input.assignedConduitComponentIds || [],
        slackFactor: input.slackFactor ?? session.project.defaultSlackFactor,
        fixedSlack: input.fixedSlack || 0,
        additionalLength: input.additionalLength || 0,
        wasteFactor: session.project.defaultWasteFactor
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            fibers: [...(session.design.fibers || []), fiber]
        }
    });
}

/**
 * @param {object} session
 * @param {object} asset
 * @returns {object}
 */
export function addPointAsset(session, asset) {
    const pointAsset = {
        itemId: asset.itemId,
        projectId: session.project.projectId,
        assetName: asset.assetName || 'Point asset',
        geometry: asset.geometry,
        catalogItemId: asset.catalogItemId || '',
        symbolKey: asset.symbolKey || 'structure-junction-box'
    };

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            pointAssets: [...(session.design.pointAssets || []), pointAsset]
        }
    });
}

/**
 * @param {object} session
 * @returns {object}
 */
export function recalculateSessionQuantities(session) {
    const next = recalculateDesignQuantities(
        session.design,
        session.catalog?.items || [],
        session.project
    );
    const quantities = mergeQuantityOverrides(session.design.quantities || [], next);

    return {
        ...session,
        design: {
            ...session.design,
            quantities
        }
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function validateDesignSession(session) {
    const errors = [];
    const warnings = [];

    if (!session.project?.projectId) errors.push('Project is not initialized.');
    if (!session.stationingRoute) warnings.push('No stationing source selected.');
    if (!(session.design.alignments || []).length) warnings.push('No planning alignment drawn.');
    if (!(session.design.conduitSegments || []).length) warnings.push('No conduit segments generated.');

    const featuresById = indexDesignFeatures(session.design);
    const relationshipValidation = validateRelationships(session.project.relationships || [], featuresById);
    if (!relationshipValidation.valid) {
        warnings.push(...relationshipValidation.errors);
    }

    for (const segment of session.design.conduitSegments || []) {
        if (!segment.measuredLength || segment.measuredLength <= 0) {
            warnings.push(`Segment ${segment.segmentId} has zero length.`);
        }
        if (!segment.installationMethod) {
            warnings.push(`Segment ${segment.segmentId} is missing an installation method.`);
        }
    }

    for (const fiber of session.design.fibers || []) {
        if (!fiber.sourceSegmentIds?.length) {
            warnings.push(`Fiber ${fiber.fiberId} has no source conduit segments.`);
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function buildSessionExport(session) {
    return buildProjectExportPackage(
        session.project,
        session.design,
        session.catalog?.items || []
    );
}

/**
 * @param {object} session
 * @returns {object}
 */
export function serializeDesignSession(session) {
    return serializePlanProject(session.project, {
        design: session.design,
        metadata: {
            widget: WIDGET_ID,
            stationingRouteLayerId: session.stationingRoute?.layerId || '',
            activeAlignmentId: session.activeAlignmentId || '',
            catalog: session.catalog
        }
    });
}

/**
 * @param {object} bundle
 * @returns {object}
 */
export function restoreDesignSession(bundle) {
    const restored = restorePlanProject(bundle);
    if (!restored.ok) {
        throw new Error(restored.errors[0]);
    }

    return {
        project: restored.project,
        design: createDesignState(restored.design || {}),
        catalog: bundle.metadata?.catalog || null,
        stationingRoute: null,
        activeAlignmentId: bundle.metadata?.activeAlignmentId || restored.design?.alignments?.[0]?.alignmentId || null
    };
}

/**
 * @param {object} session
 * @returns {object|null}
 */
export function getActiveAlignment(session) {
    const alignments = session.design.alignments || [];
    if (!alignments.length) return null;
    return alignments.find((alignment) => alignment.alignmentId === session.activeAlignmentId) || alignments[0];
}

/**
 * @param {import('geojson').LineString} geometry
 * @returns {number}
 */
export function measureAlignmentLengthFt(geometry) {
    if (!geometry || typeof turf === 'undefined') return 0;
    return lineLengthAny(turf.feature(geometry), 'feet');
}

/**
 * Apply stationing attributes across all design features.
 * @param {object} session
 * @returns {object}
 */
export function applyStationingToDesign(session) {
    if (!session.stationingRoute) return session;

    const alignments = (session.design.alignments || []).map((alignment) => {
        if (!alignment.geometry) return alignment;
        const feature = applyStationingToLineFeature(
            session.stationingRoute,
            { type: 'Feature', geometry: alignment.geometry, properties: {} }
        );
        return {
            ...alignment,
            startStation: feature.properties.start_station,
            endStation: feature.properties.end_station,
            startMilepost: feature.properties.start_milepost,
            endMilepost: feature.properties.end_milepost
        };
    });

    const structures = (session.design.structures || []).map((structure) => {
        if (!structure.geometry?.coordinates) return structure;
        const feature = applyStationingToPointFeature(
            session.stationingRoute,
            { type: 'Feature', geometry: structure.geometry, properties: {} }
        );
        return {
            ...structure,
            station: feature.properties.station,
            milepost: feature.properties.milepost,
            stationingRouteId: feature.properties.stationing_route_id
        };
    });

    const conduitSegments = (session.design.conduitSegments || []).map((segment) => {
        if (!segment.geometry) return segment;
        const feature = applyStationingToLineFeature(
            session.stationingRoute,
            { type: 'Feature', geometry: segment.geometry, properties: {} }
        );
        return {
            ...segment,
            startStation: feature.properties.start_station,
            endStation: feature.properties.end_station,
            startMilepost: feature.properties.start_milepost,
            endMilepost: feature.properties.end_milepost,
            stationingRouteId: feature.properties.stationing_route_id
        };
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            alignments,
            structures,
            conduitSegments
        }
    });
}

export {
    moveStructureOnAlignment,
    deleteStructureFromAlignment,
    getStationingRoutes,
    createSampleProcurementCatalog,
    STRUCTURE_TYPES
};
