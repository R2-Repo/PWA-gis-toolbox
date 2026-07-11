/**
 * Fiber procurement design model types and helpers.
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const ASSET_CATEGORIES = {
    ALIGNMENT: 'alignment',
    CONDUIT_SEGMENT: 'conduit_segment',
    STRUCTURE: 'structure',
    FIBER: 'fiber',
    SPLICE: 'splice',
    POINT_ASSET: 'point_asset',
    NON_SPATIAL: 'non_spatial'
};

export const STRUCTURE_TYPES = {
    JUNCTION_BOX: 'junction_box',
    VAULT: 'vault'
};

export const EXISTING_OR_PROPOSED = {
    PROPOSED: 'proposed',
    EXISTING: 'existing'
};

/**
 * @param {object} input
 * @returns {object}
 */
export function createAlignment(input = {}) {
    return {
        alignmentId: input.alignmentId || createStableId('align'),
        projectId: input.projectId,
        geometry: input.geometry || null,
        alignmentName: input.alignmentName || 'Planning alignment',
        routeName: input.routeName || '',
        stationingRouteId: input.stationingRouteId || '',
        startStation: input.startStation ?? null,
        endStation: input.endStation ?? null,
        startMilepost: input.startMilepost ?? null,
        endMilepost: input.endMilepost ?? null,
        status: input.status || 'proposed',
        assemblyId: input.assemblyId || '',
        symbolKey: input.symbolKey || 'alignment-guide',
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createStructure(input = {}) {
    return {
        structureId: input.structureId || createStableId('struct'),
        projectId: input.projectId,
        parentAlignmentId: input.parentAlignmentId,
        geometry: input.geometry || null,
        assetType: input.assetType || STRUCTURE_TYPES.JUNCTION_BOX,
        structureName: input.structureName || '',
        size: input.size || '',
        existingOrProposed: input.existingOrProposed || EXISTING_OR_PROPOSED.PROPOSED,
        distanceAlongAlignmentFt: input.distanceAlongAlignmentFt ?? null,
        stationingRouteId: input.stationingRouteId || '',
        station: input.station ?? null,
        milepost: input.milepost ?? null,
        symbolKey: input.symbolKey || (
            input.assetType === STRUCTURE_TYPES.VAULT ? 'structure-vault' : 'structure-junction-box'
        ),
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createConduitSegment(input = {}) {
    return {
        segmentId: input.segmentId || createStableId('seg'),
        projectId: input.projectId,
        parentAlignmentId: input.parentAlignmentId,
        fromStructureId: input.fromStructureId || null,
        toStructureId: input.toStructureId || null,
        geometry: input.geometry || null,
        measuredLength: input.measuredLength ?? 0,
        installationMethod: input.installationMethod || '',
        surfaceType: input.surfaceType || '',
        existingOrProposed: input.existingOrProposed || EXISTING_OR_PROPOSED.PROPOSED,
        conduitComponents: Array.isArray(input.conduitComponents) ? [...input.conduitComponents] : [],
        procurementItemIds: Array.isArray(input.procurementItemIds) ? [...input.procurementItemIds] : [],
        restorationSettings: input.restorationSettings || {},
        stationingRouteId: input.stationingRouteId || '',
        startStation: input.startStation ?? null,
        endStation: input.endStation ?? null,
        startMilepost: input.startMilepost ?? null,
        endMilepost: input.endMilepost ?? null,
        symbolKey: input.symbolKey || 'conduit-proposed',
        assemblyId: input.assemblyId || '',
        displayLabel: input.displayLabel || '',
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createConduitComponent(input = {}) {
    return {
        componentId: input.componentId || createStableId('comp'),
        parentSegmentId: input.parentSegmentId,
        catalogItemId: input.catalogItemId || '',
        productType: input.productType || 'HDPE',
        material: input.material || '',
        diameter: input.diameter || '',
        ductCount: Number(input.ductCount ?? 1),
        color: input.color || '',
        designation: input.designation || '',
        occupancyStatus: input.occupancyStatus || 'proposed',
        lengthMultiplier: Number(input.lengthMultiplier ?? 1),
        wasteFactor: input.wasteFactor ?? null,
        symbolKey: input.symbolKey || '',
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createFiberRoute(input = {}) {
    return {
        fiberId: input.fiberId || createStableId('fiber'),
        projectId: input.projectId,
        cableName: input.cableName || '',
        geometry: input.geometry || null,
        sourceSegmentIds: Array.isArray(input.sourceSegmentIds) ? [...input.sourceSegmentIds] : [],
        assignedConduitComponentIds: Array.isArray(input.assignedConduitComponentIds)
            ? [...input.assignedConduitComponentIds]
            : [],
        catalogItemId: input.catalogItemId || '',
        cableType: input.cableType || 'SM',
        strandCount: Number(input.strandCount ?? 0),
        startStructureId: input.startStructureId || null,
        endStructureId: input.endStructureId || null,
        measuredRouteLength: input.measuredRouteLength ?? 0,
        slackFactor: input.slackFactor ?? null,
        fixedSlack: input.fixedSlack ?? 0,
        additionalLength: input.additionalLength ?? 0,
        calculatedLength: input.calculatedLength ?? 0,
        stationingRouteId: input.stationingRouteId || '',
        startStation: input.startStation ?? null,
        endStation: input.endStation ?? null,
        startMilepost: input.startMilepost ?? null,
        endMilepost: input.endMilepost ?? null,
        symbolKey: input.symbolKey || 'fiber-proposed',
        notes: input.notes || '',
        parentFiberId: input.parentFiberId || null,
        isBranch: !!input.isBranch,
        branchSourceEnclosureId: input.branchSourceEnclosureId || null,
        branchSourceFiberId: input.branchSourceFiberId || null,
        hiddenOnMap: !!input.hiddenOnMap
    };
}

/**
 * Logical fiber section created when a splice divides a cable internally.
 * @param {object} input
 * @returns {object}
 */
export function createFiberSection(input = {}) {
    return {
        sectionId: input.sectionId || createStableId('fsec'),
        projectId: input.projectId,
        parentFiberId: input.parentFiberId,
        geometry: input.geometry || null,
        sequenceIndex: Number(input.sequenceIndex ?? 0),
        strandCount: Number(input.strandCount ?? 0),
        cableType: input.cableType || 'SM',
        cableName: input.cableName || '',
        fromEnclosureId: input.fromEnclosureId || null,
        toEnclosureId: input.toEnclosureId || null,
        measuredLength: input.measuredLength ?? 0,
        stationingRouteId: input.stationingRouteId || '',
        startStation: input.startStation ?? null,
        endStation: input.endStation ?? null,
        notes: input.notes || ''
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createNonSpatialItem(input = {}) {
    return {
        itemId: input.itemId || createStableId('nspatial'),
        projectId: input.projectId,
        catalogItemId: input.catalogItemId || '',
        description: input.description || '',
        quantity: Number(input.quantity ?? 0),
        unit: input.unit || 'each',
        reason: input.reason || '',
        notes: input.notes || '',
        manuallyEntered: input.manuallyEntered !== false
    };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function createDesignState(input = {}) {
    return {
        alignments: Array.isArray(input.alignments) ? [...input.alignments] : [],
        structures: Array.isArray(input.structures) ? [...input.structures] : [],
        conduitSegments: Array.isArray(input.conduitSegments) ? [...input.conduitSegments] : [],
        fibers: Array.isArray(input.fibers) ? [...input.fibers] : [],
        fiberSections: Array.isArray(input.fiberSections) ? [...input.fiberSections] : [],
        spliceEnclosures: Array.isArray(input.spliceEnclosures) ? [...input.spliceEnclosures] : [],
        pointAssets: Array.isArray(input.pointAssets) ? [...input.pointAssets] : [],
        nonSpatialItems: Array.isArray(input.nonSpatialItems) ? [...input.nonSpatialItems] : [],
        quantities: Array.isArray(input.quantities) ? [...input.quantities] : [],
        assemblies: Array.isArray(input.assemblies) ? [...input.assemblies] : [],
        lastUsed: input.lastUsed || {}
    };
}

/**
 * @param {object} design
 * @returns {Record<string, object>}
 */
export function indexDesignFeatures(design) {
    const map = {};
    for (const list of [
        design.alignments,
        design.structures,
        design.conduitSegments,
        design.fibers,
        design.fiberSections,
        design.spliceEnclosures,
        design.pointAssets,
        design.nonSpatialItems
    ]) {
        for (const item of list || []) {
            const id = item.alignmentId || item.structureId || item.segmentId || item.fiberId
                || item.sectionId || item.enclosureId || item.itemId;
            if (id) map[id] = item;
        }
    }
    return map;
}
