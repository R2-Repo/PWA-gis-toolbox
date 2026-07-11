/**
 * Fiber Procurement Design widget engine — pure orchestration.
 */

import { createPlanProject, updatePlanProject } from '../../plan-project/plan-project-model.js';
import { serializePlanProject, restorePlanProject } from '../../plan-project/serialization.js';
import { getStationingRoutes, getStationRangeForLine, getStationAtCoordinate, applyStationingToLineFeature, applyStationingToPointFeature } from '../../plan-project/stationing-adapter.js';
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
import {
    placeSpliceEnclosureOnFiber,
    configureSpliceEnclosure,
    createBranchCableAtEnclosure,
    rebuildFiberSectionsForFibers,
    buildSpliceSchedule,
    SPLICE_MODES,
    SPLICE_MODE_OPTIONS,
    NEAR_FIBER_FT
} from './splice-engine.js';
import { recalculateDesignQuantities, mergeQuantityOverrides, applyManualQuantityOverride } from './quantity-rules.js';
import { buildProjectExportPackage } from './export-builder.js';
import { lineLengthAny } from '../../tools/line-geojson.js';
import {
    listAvailableAssemblies,
    getActiveAssembly,
    expandAssemblyToSegmentDefaults,
    applyAssemblyDefaultsToSegment,
    saveProjectAssembly,
    toggleAssemblyFavorite,
    listFavoriteAssemblies,
    BUILT_IN_ASSEMBLIES
} from './assembly-engine.js';
import {
    resolveConduitDrawingDefaults,
    continueFromConduitSegment,
    copyConduitProperties,
    bulkUpdateConduitSegments,
    applyAutomaticLabels,
    captureLastUsedFromConfiguration,
    summarizeSegmentInheritance
} from './productivity-engine.js';
import {
    validateDesignSessionDetailed,
    buildQuantityTraceabilityReport,
    runDesignReadinessCheck
} from './validation-engine.js';
import { createNonSpatialItem } from './design-model.js';

export const WIDGET_ID = 'fiber-procurement-design';

export const DESIGN_STEPS = [
    'Project',
    'Stationing',
    'Catalog',
    'Assemblies',
    'Alignment',
    'Structures',
    'Conduit',
    'Fiber',
    'Splicing',
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
    const assemblies = (session.design?.assemblies?.length)
        ? session.design.assemblies
        : BUILT_IN_ASSEMBLIES.map((assembly) => ({ ...assembly, isFavorite: false }));

    return {
        ...session,
        catalog: resolved,
        design: {
            ...session.design,
            assemblies
        },
        project: updatePlanProject(session.project, {
            procurementCatalogId: resolved.catalogId,
            procurementCatalogVersion: resolved.version,
            activeAssemblyId: session.project.activeAssemblyId || BUILT_IN_ASSEMBLIES[0].assemblyId
        })
    };
}

/**
 * @param {object} session
 * @returns {object[]}
 */
export function getAvailableAssemblies(session) {
    return listAvailableAssemblies(session.design || {});
}

/**
 * @param {object} session
 * @param {string} assemblyId
 * @returns {object}
 */
export function setActiveAssembly(session, assemblyId) {
    const assembly = listAvailableAssemblies(session.design).find((entry) => entry.assemblyId === assemblyId);
    if (!assembly) throw new Error('Assembly not found.');

    return {
        ...session,
        project: updatePlanProject(session.project, { activeAssemblyId: assemblyId })
    };
}

/**
 * @param {object} session
 * @param {object} assemblyInput
 * @returns {object}
 */
export function saveCustomAssembly(session, assemblyInput = {}) {
    const assemblies = saveProjectAssembly(session.design, assemblyInput);
    return {
        ...session,
        design: {
            ...session.design,
            assemblies
        }
    };
}

/**
 * @param {object} session
 * @param {string} assemblyId
 * @param {boolean} favorite
 * @returns {object}
 */
export function setAssemblyFavorite(session, assemblyId, favorite = true) {
    const assemblies = toggleAssemblyFavorite(session.design, assemblyId, favorite);
    return {
        ...session,
        design: {
            ...session.design,
            assemblies
        }
    };
}

/**
 * @param {object} session
 * @returns {object[]}
 */
export function getFavoriteAssemblies(session) {
    return listFavoriteAssemblies(session.design || {});
}

/**
 * Apply active assembly defaults to conduit segments.
 * @param {object} session
 * @param {string[]} [segmentIds]
 * @returns {object}
 */
export function applyActiveAssemblyToSegments(session, segmentIds = []) {
    const assembly = getActiveAssembly(session.project, session.design);
    const defaults = expandAssemblyToSegmentDefaults(
        assembly,
        session.project,
        session.catalog?.items || []
    );
    const idSet = new Set(segmentIds.length ? segmentIds : (session.design.conduitSegments || []).map((s) => s.segmentId));

    const conduitSegments = (session.design.conduitSegments || []).map((segment) =>
        idSet.has(segment.segmentId) ? applyAssemblyDefaultsToSegment(segment, defaults) : segment
    );

    return recalculateSessionQuantities({
        ...session,
        design: applyAutomaticLabels({
            ...session.design,
            conduitSegments
        })
    });
}

/**
 * @param {object} session
 * @param {string[]} segmentIds
 * @param {object} patch
 * @returns {object}
 */
export function bulkUpdateSegments(session, segmentIds = [], patch = {}) {
    const conduitSegments = bulkUpdateConduitSegments(
        session.design.conduitSegments || [],
        segmentIds,
        patch
    );
    const designWithLastUsed = captureLastUsedFromConfiguration(session, patch);

    return recalculateSessionQuantities({
        ...session,
        design: applyAutomaticLabels({
            ...designWithLastUsed,
            conduitSegments
        })
    });
}

/**
 * @param {object} session
 * @param {string} sourceSegmentId
 * @param {string} targetSegmentId
 * @returns {object}
 */
export function continueConduitFromSegment(session, sourceSegmentId, targetSegmentId) {
    const source = (session.design.conduitSegments || []).find((segment) => segment.segmentId === sourceSegmentId);
    if (!source) throw new Error('Source conduit segment not found.');

    const patch = continueFromConduitSegment(source);
    return bulkUpdateSegments(session, [targetSegmentId], patch);
}

/**
 * @param {object} session
 * @param {string} sourceSegmentId
 * @param {string[]} targetSegmentIds
 * @returns {object}
 */
export function copyConduitToSegments(session, sourceSegmentId, targetSegmentIds = []) {
    const source = (session.design.conduitSegments || []).find((segment) => segment.segmentId === sourceSegmentId);
    if (!source) throw new Error('Source conduit segment not found.');
    return bulkUpdateSegments(session, targetSegmentIds, copyConduitProperties(source));
}

/**
 * @param {object} session
 * @param {object} input
 * @returns {object}
 */
export function addNonSpatialItem(session, input = {}) {
    const catalogItem = (session.catalog?.items || []).find((item) => item.catalogItemId === input.catalogItemId);
    const item = createNonSpatialItem({
        projectId: session.project.projectId,
        catalogItemId: input.catalogItemId || '',
        description: input.description || catalogItem?.description || input.name || 'Non-spatial item',
        quantity: input.quantity ?? 1,
        unit: input.unit || catalogItem?.unit || 'each',
        reason: input.reason || '',
        notes: input.notes || ''
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            nonSpatialItems: [...(session.design.nonSpatialItems || []), item]
        }
    });
}

/**
 * @param {object} session
 * @param {string} quantityId
 * @param {number} finalQuantity
 * @param {string} [reason]
 * @returns {object}
 */
export function overrideQuantity(session, quantityId, finalQuantity, reason = '') {
    const quantities = (session.design.quantities || []).map((record) =>
        record.quantityId === quantityId
            ? applyManualQuantityOverride(record, finalQuantity, reason)
            : record
    );

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
 * @returns {object[]}
 */
export function getQuantityTraceability(session) {
    return buildQuantityTraceabilityReport(session.design, session.catalog?.items || []);
}

/**
 * @param {object} session
 * @param {string} segmentId
 * @returns {object}
 */
export function getSegmentInheritanceSummary(session, segmentId) {
    const segment = (session.design.conduitSegments || []).find((item) => item.segmentId === segmentId);
    if (!segment) throw new Error('Conduit segment not found.');
    return summarizeSegmentInheritance(segment, session);
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

    let nextSession = {
        ...session,
        design,
        activeAlignmentId: alignment.alignmentId,
        project: updatePlanProject(session.project, { relationships: regen.relationships })
    };

    nextSession = applyActiveAssemblyToSegments(nextSession);
    return nextSession;
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
            fibers,
            fiberSections: rebuildFiberSectionsForFibers({
                fibers,
                projectId: session.project.projectId,
                enclosures: session.design.spliceEnclosures || [],
                existingSections: session.design.fiberSections || []
            })
        },
        project: updatePlanProject(session.project, { relationships: regen.relationships })
    });
}

/**
 * @param {object} session
 * @param {string} structureId
 * @param {[number, number]} coordinate
 * @returns {object}
 */
export function moveStructure(session, structureId, coordinate) {
    const alignment = getActiveAlignment(session);
    if (!alignment) throw new Error('Draw a planning alignment first.');

    const stationing = session.stationingRoute
        ? getStationAtCoordinate(session.stationingRoute, coordinate)
        : null;

    const result = moveStructureOnAlignment({
        alignment,
        structureId,
        coordinate,
        structures: session.design.structures || [],
        segments: session.design.conduitSegments || [],
        relationships: session.project.relationships || [],
        projectId: session.project.projectId,
        projectDefaults: session.project,
        stationing
    });

    const fibers = synchronizeAllFiberRoutes({
        ...session.design,
        conduitSegments: result.segments
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            structures: result.structures,
            conduitSegments: result.segments,
            fibers,
            fiberSections: rebuildFiberSectionsForFibers({
                fibers,
                projectId: session.project.projectId,
                enclosures: session.design.spliceEnclosures || [],
                existingSections: session.design.fiberSections || []
            })
        },
        project: updatePlanProject(session.project, { relationships: result.relationships })
    });
}

/**
 * @param {object} session
 * @param {string} structureId
 * @param {boolean} [mergeAdjoining]
 * @returns {object}
 */
export function deleteStructure(session, structureId, mergeAdjoining = false) {
    const alignment = getActiveAlignment(session);
    if (!alignment) throw new Error('Draw a planning alignment first.');

    const result = deleteStructureFromAlignment({
        alignment,
        structureId,
        structures: session.design.structures || [],
        segments: session.design.conduitSegments || [],
        relationships: session.project.relationships || [],
        mergeAdjoining,
        projectId: session.project.projectId,
        projectDefaults: session.project
    });

    if (result.merged === false && result.reason) {
        throw new Error(result.reason);
    }

    const fibers = synchronizeAllFiberRoutes({
        ...session.design,
        conduitSegments: result.segments
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            structures: result.structures,
            conduitSegments: result.segments,
            fibers,
            fiberSections: rebuildFiberSectionsForFibers({
                fibers,
                projectId: session.project.projectId,
                enclosures: session.design.spliceEnclosures || [],
                existingSections: session.design.fiberSections || []
            })
        },
        project: updatePlanProject(session.project, { relationships: result.relationships })
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

    const designWithLastUsed = captureLastUsedFromConfiguration(session, patch);

    return recalculateSessionQuantities({
        ...session,
        design: applyAutomaticLabels({
            ...designWithLastUsed,
            conduitSegments: segments
        })
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
            fibers: [...(session.design.fibers || []), fiber],
            fiberSections: rebuildFiberSectionsForFibers({
                fibers: [...(session.design.fibers || []), fiber],
                projectId: session.project.projectId,
                enclosures: session.design.spliceEnclosures || [],
                existingSections: session.design.fiberSections || []
            })
        }
    });
}

/**
 * @param {object} session
 * @param {string} fiberId
 * @param {[number, number]} coordinate
 * @param {object} [meta]
 * @returns {object}
 */
export function placeSpliceEnclosure(session, fiberId, coordinate, meta = {}) {
    const fiber = (session.design.fibers || []).find((item) => item.fiberId === fiberId);
    if (!fiber) throw new Error('Fiber route not found.');

    const stationing = session.stationingRoute
        ? getStationAtCoordinate(session.stationingRoute, coordinate)
        : null;

    const result = placeSpliceEnclosureOnFiber({
        fiber,
        coordinate,
        projectId: session.project.projectId,
        existingEnclosures: session.design.spliceEnclosures || [],
        existingSections: session.design.fiberSections || [],
        stationing,
        enclosureType: meta.enclosureType || 'splice_enclosure'
    });

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            spliceEnclosures: [...(session.design.spliceEnclosures || []), result.enclosure],
            fiberSections: result.fiberSections,
            fibers: session.design.fibers || []
        }
    });
}

/**
 * @param {object} session
 * @param {string} enclosureId
 * @param {object} patch
 * @returns {object}
 */
export function configureSplice(session, enclosureId, patch = {}) {
    const enclosures = (session.design.spliceEnclosures || []).map((enclosure) =>
        enclosure.enclosureId === enclosureId
            ? configureSpliceEnclosure(enclosure, patch)
            : enclosure
    );

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            spliceEnclosures: enclosures
        }
    });
}

/**
 * @param {object} session
 * @param {string} enclosureId
 * @param {object} branchInput
 * @returns {object}
 */
export function addBranchCable(session, enclosureId, branchInput = {}) {
    const enclosure = (session.design.spliceEnclosures || []).find((item) => item.enclosureId === enclosureId);
    if (!enclosure) throw new Error('Splice enclosure not found.');

    const sourceFiber = (session.design.fibers || []).find((item) => item.fiberId === enclosure.hostFiberId);
    if (!sourceFiber) throw new Error('Source fiber not found for branch cable.');

    const result = createBranchCableAtEnclosure({
        enclosure,
        sourceFiber,
        branchInput,
        projectId: session.project.projectId,
        projectDefaults: session.project
    });

    const fibers = [
        ...(session.design.fibers || []).filter((item) => item.fiberId !== result.branchFiber.fiberId),
        result.branchFiber
    ];

    const spliceEnclosures = (session.design.spliceEnclosures || []).map((item) =>
        item.enclosureId === enclosureId ? result.enclosure : item
    );

    return recalculateSessionQuantities({
        ...session,
        design: {
            ...session.design,
            fibers,
            spliceEnclosures,
            fiberSections: rebuildFiberSectionsForFibers({
                fibers,
                projectId: session.project.projectId,
                enclosures: spliceEnclosures,
                existingSections: session.design.fiberSections || []
            })
        }
    });
}

/**
 * @param {object} session
 * @returns {object[]}
 */
export function getSpliceSchedule(session) {
    return buildSpliceSchedule(session.design || {});
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
        design: applyAutomaticLabels({
            ...session.design,
            quantities
        })
    };
}

/**
 * @param {object} session
 * @returns {object}
 */
export function validateDesignSession(session) {
    return validateDesignSessionDetailed(session);
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
    STRUCTURE_TYPES,
    SPLICE_MODES,
    SPLICE_MODE_OPTIONS,
    NEAR_FIBER_FT,
    runDesignReadinessCheck,
    buildQuantityTraceabilityReport,
    BUILT_IN_ASSEMBLIES
};
