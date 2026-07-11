/**
 * Splice enclosure calculations — Phase 2 foundation with core fusion splice rules.
 */

import { createStableId } from '../../plan-project/id-utils.js';

export const SPLICE_MODES = {
    PASS_THROUGH: 'pass_through',
    FULL_SPLICE: 'full_splice',
    STRAND_COUNT_CHANGE: 'strand_count_change',
    BRANCH: 'branch',
    BUILDING_DROP: 'building_drop',
    MID_SPAN_ACCESS: 'mid_span_access',
    TERMINATE: 'terminate',
    MANUAL: 'manual'
};

/**
 * @param {object} input
 * @returns {object}
 */
export function createSpliceEnclosure(input = {}) {
    return {
        enclosureId: input.enclosureId || createStableId('splice'),
        projectId: input.projectId,
        geometry: input.geometry || null,
        enclosureType: input.enclosureType || '',
        sourceFiberIds: Array.isArray(input.sourceFiberIds) ? [...input.sourceFiberIds] : [],
        connectedFiberSectionIds: Array.isArray(input.connectedFiberSectionIds)
            ? [...input.connectedFiberSectionIds]
            : [],
        connectedCableCount: Number(input.connectedCableCount ?? 0),
        incomingCableCount: Number(input.incomingCableCount ?? 0),
        outgoingCableCount: Number(input.outgoingCableCount ?? 0),
        passThroughStrandCount: Number(input.passThroughStrandCount ?? 0),
        fusionSpliceCount: Number(input.fusionSpliceCount ?? 0),
        unusedStrandCount: Number(input.unusedStrandCount ?? 0),
        slackLength: Number(input.slackLength ?? 0),
        trayCount: Number(input.trayCount ?? 0),
        enclosureSize: input.enclosureSize || '',
        stationingRouteId: input.stationingRouteId || '',
        station: input.station ?? null,
        milepost: input.milepost ?? null,
        procurementItemIds: Array.isArray(input.procurementItemIds) ? [...input.procurementItemIds] : [],
        symbolKey: input.symbolKey || 'structure-splice',
        spliceMode: input.spliceMode || SPLICE_MODES.PASS_THROUGH,
        strandMappings: Array.isArray(input.strandMappings) ? [...input.strandMappings] : [],
        notes: input.notes || ''
    };
}

/**
 * One strand connected to another strand equals one fusion splice.
 * @param {object[]} strandMappings
 * @returns {number}
 */
export function countFusionSplicesFromMappings(strandMappings = []) {
    return strandMappings.filter((mapping) =>
        mapping?.fromStrand != null && mapping?.toStrand != null
    ).length;
}

/**
 * @param {object} input
 * @returns {number}
 */
export function calculateFusionSplices({
    spliceMode = SPLICE_MODES.PASS_THROUGH,
    strandMappings = [],
    incomingStrandCount = 0,
    outgoingStrandCount = 0,
    branchStrandCount = 0
}) {
    if (strandMappings.length) {
        return countFusionSplicesFromMappings(strandMappings);
    }

    switch (spliceMode) {
        case SPLICE_MODES.PASS_THROUGH:
            return 0;
        case SPLICE_MODES.FULL_SPLICE:
            return Math.min(incomingStrandCount, outgoingStrandCount);
        case SPLICE_MODES.STRAND_COUNT_CHANGE:
            return Math.min(incomingStrandCount, outgoingStrandCount);
        case SPLICE_MODES.BRANCH:
        case SPLICE_MODES.BUILDING_DROP:
        case SPLICE_MODES.MID_SPAN_ACCESS:
            return branchStrandCount;
        case SPLICE_MODES.TERMINATE:
            return incomingStrandCount;
        default:
            return 0;
    }
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function buildDefaultBranchMappings({
    mainStrandCount = 144,
    branchStrandCount = 12,
    mainStartStrand = 49
}) {
    const mappings = [];
    for (let i = 0; i < branchStrandCount; i++) {
        mappings.push({
            fromCable: 'main',
            fromStrand: mainStartStrand + i,
            toCable: 'branch',
            toStrand: i + 1
        });
    }
    return mappings;
}

/**
 * @param {object} enclosure
 * @param {object} patch
 * @returns {object}
 */
export function updateSpliceEnclosure(enclosure, patch = {}) {
    const strandMappings = patch.strandMappings || enclosure.strandMappings || [];
    const fusionSpliceCount = calculateFusionSplices({
        spliceMode: patch.spliceMode || enclosure.spliceMode,
        strandMappings,
        incomingStrandCount: patch.incomingStrandCount ?? enclosure.incomingStrandCount,
        outgoingStrandCount: patch.outgoingStrandCount ?? enclosure.outgoingStrandCount,
        branchStrandCount: patch.branchStrandCount ?? patch.branchStrandCount
    });

    return {
        ...enclosure,
        ...patch,
        strandMappings,
        fusionSpliceCount
    };
}
