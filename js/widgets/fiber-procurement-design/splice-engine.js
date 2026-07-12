/**
 * Splice enclosure placement, fiber sectioning, and fusion splice calculations.
 */

import { createStableId } from '../../plan-project/id-utils.js';
import { lineLengthAny, lineSliceAlongRoute } from '../../tools/line-geojson.js';
import { createFiberRoute, createFiberSection } from './design-model.js';
import { calculateFiberQuantity } from './quantity-rules.js';
import { findNearestFiber } from './fiber-routing-engine.js';

const FEET_UNITS = 'feet';
const NEAR_FIBER_FT = 50;

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

export const SPLICE_MODE_OPTIONS = [
    { value: SPLICE_MODES.PASS_THROUGH, label: 'Pass through without splicing' },
    { value: SPLICE_MODES.FULL_SPLICE, label: 'Full cable splice' },
    { value: SPLICE_MODES.STRAND_COUNT_CHANGE, label: 'Change strand count' },
    { value: SPLICE_MODES.BRANCH, label: 'Add branch cable' },
    { value: SPLICE_MODES.BUILDING_DROP, label: 'Add building drop' },
    { value: SPLICE_MODES.MID_SPAN_ACCESS, label: 'Mid-span access' },
    { value: SPLICE_MODES.TERMINATE, label: 'Terminate cable' },
    { value: SPLICE_MODES.MANUAL, label: 'Configure manually' }
];

/**
 * @param {object} input
 * @returns {object}
 */
export function createSpliceEnclosure(input = {}) {
    return {
        enclosureId: input.enclosureId || createStableId('splice'),
        projectId: input.projectId,
        geometry: input.geometry || null,
        enclosureType: input.enclosureType || 'splice_enclosure',
        sourceFiberIds: Array.isArray(input.sourceFiberIds) ? [...input.sourceFiberIds] : [],
        connectedFiberSectionIds: Array.isArray(input.connectedFiberSectionIds)
            ? [...input.connectedFiberSectionIds]
            : [],
        connectedCableCount: Number(input.connectedCableCount ?? 0),
        incomingCableCount: Number(input.incomingCableCount ?? 0),
        outgoingCableCount: Number(input.outgoingCableCount ?? 0),
        incomingStrandCount: Number(input.incomingStrandCount ?? 0),
        outgoingStrandCount: Number(input.outgoingStrandCount ?? 0),
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
        symbolKey: input.symbolKey || 'splice-enclosure',
        spliceMode: input.spliceMode || SPLICE_MODES.PASS_THROUGH,
        strandMappings: Array.isArray(input.strandMappings) ? [...input.strandMappings] : [],
        distanceAlongFiberFt: input.distanceAlongFiberFt ?? null,
        hostFiberId: input.hostFiberId || '',
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
 * Suggest connecting all strands of the smaller cable.
 * @param {object} sourceFiber
 * @param {object} branchFiber
 * @returns {object[]}
 */
export function suggestBranchMappings(sourceFiber, branchFiber) {
    const sourceCount = Number(sourceFiber?.strandCount ?? 0);
    const branchCount = Number(branchFiber?.strandCount ?? 0);
    const strandCount = Math.min(sourceCount, branchCount);
    if (!strandCount) return [];

    if (branchCount <= sourceCount) {
        return buildDefaultBranchMappings({
            branchStrandCount: branchCount,
            mainStartStrand: 1
        });
    }

    return buildDefaultBranchMappings({
        branchStrandCount: sourceCount,
        mainStartStrand: 1
    });
}

/**
 * @param {object} fiber
 * @param {[number, number]} coordinate
 * @returns {{ distanceAlongFt: number, snapCoordinate: [number, number], totalLengthFt: number }}
 */
export function snapCoordinateToFiber(fiber, coordinate) {
    if (!fiber?.geometry || !coordinate || typeof turf === 'undefined') {
        throw new Error('Fiber geometry and coordinate are required for snapping.');
    }
    const lineFeature = turf.feature(fiber.geometry);
    const point = turf.point(coordinate);
    const snap = turf.nearestPointOnLine(lineFeature, point, { units: FEET_UNITS });
    return {
        distanceAlongFt: Number(snap.properties?.location ?? 0),
        snapCoordinate: snap.geometry.coordinates,
        totalLengthFt: lineLengthAny(lineFeature, FEET_UNITS)
    };
}

/**
 * Split a fiber route into sections at one or more distances.
 * @param {object} fiber
 * @param {number[]} distancesFt
 * @returns {import('geojson').Feature<import('geojson').LineString>[]}
 */
export function splitFiberGeometryAtDistances(fiber, distancesFt = []) {
    if (!fiber?.geometry || typeof turf === 'undefined') return [];
    const lineFeature = turf.feature(fiber.geometry);
    const totalLen = lineLengthAny(lineFeature, FEET_UNITS);
    const breakpoints = [0, ...distancesFt.filter((d) => d > 0 && d < totalLen), totalLen]
        .sort((a, b) => a - b)
        .filter((value, index, arr) => index === 0 || Math.abs(value - arr[index - 1]) > 0.01);

    const parts = [];
    for (let i = 0; i < breakpoints.length - 1; i++) {
        const start = breakpoints[i];
        const end = breakpoints[i + 1];
        if (end - start < 0.01) continue;
        const slice = lineSliceAlongRoute(lineFeature, start, end, FEET_UNITS);
        if (slice?.geometry?.coordinates?.length >= 2) parts.push(slice);
    }
    return parts;
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function buildFiberSectionsForFiber({
    fiber,
    projectId,
    enclosureDistances = [],
    enclosures = []
}) {
    if (!fiber?.geometry) return [];

    const sortedEnclosures = enclosures
        .filter((enclosure) => enclosure.hostFiberId === fiber.fiberId)
        .sort((a, b) => Number(a.distanceAlongFiberFt) - Number(b.distanceAlongFiberFt));

    const distances = enclosureDistances.length
        ? enclosureDistances
        : sortedEnclosures.map((enclosure) => Number(enclosure.distanceAlongFiberFt));

    const parts = splitFiberGeometryAtDistances(fiber, distances);
    if (!parts.length) {
        return [createFiberSection({
            projectId,
            parentFiberId: fiber.fiberId,
            geometry: fiber.geometry,
            sequenceIndex: 0,
            strandCount: fiber.strandCount,
            cableType: fiber.cableType,
            cableName: fiber.cableName,
            measuredLength: fiber.measuredRouteLength,
            stationingRouteId: fiber.stationingRouteId,
            startStation: fiber.startStation,
            endStation: fiber.endStation
        })];
    }

    return parts.map((part, index) => {
        const fromEnclosure = sortedEnclosures[index - 1]?.enclosureId || null;
        const toEnclosure = sortedEnclosures[index]?.enclosureId || null;
        return createFiberSection({
            projectId,
            parentFiberId: fiber.fiberId,
            geometry: part.geometry,
            sequenceIndex: index,
            strandCount: fiber.strandCount,
            cableType: fiber.cableType,
            cableName: fiber.cableName,
            fromEnclosureId: fromEnclosure,
            toEnclosureId: toEnclosure,
            measuredLength: lineLengthAny(part, FEET_UNITS),
            stationingRouteId: fiber.stationingRouteId,
            startStation: fiber.startStation,
            endStation: fiber.endStation
        });
    });
}

/**
 * @param {object} input
 * @returns {{ enclosure: object, fiberSections: object[], fibers: object[] }}
 */
export function placeSpliceEnclosureOnFiber({
    fiber,
    coordinate,
    projectId,
    existingEnclosures = [],
    existingSections = [],
    stationing = null,
    enclosureType = 'splice_enclosure'
}) {
    const nearest = findNearestFiber([fiber], coordinate, NEAR_FIBER_FT);
    if (!nearest || nearest.fiber.fiberId !== fiber.fiberId) {
        throw new Error(`Click within ${NEAR_FIBER_FT} ft of a fiber cable.`);
    }

    const snap = snapCoordinateToFiber(fiber, coordinate);
    if (snap.distanceAlongFt <= 1 || snap.totalLengthFt - snap.distanceAlongFt <= 1) {
        throw new Error('Place the splice enclosure along the fiber, not at the endpoints.');
    }

    const duplicate = existingEnclosures.find((enclosure) =>
        enclosure.hostFiberId === fiber.fiberId &&
        Math.abs(Number(enclosure.distanceAlongFiberFt) - snap.distanceAlongFt) < 1
    );
    if (duplicate) {
        throw new Error('A splice enclosure already exists at this location.');
    }

    const enclosure = createSpliceEnclosure({
        projectId,
        geometry: { type: 'Point', coordinates: snap.snapCoordinate },
        enclosureType,
        sourceFiberIds: [fiber.fiberId],
        hostFiberId: fiber.fiberId,
        distanceAlongFiberFt: snap.distanceAlongFt,
        incomingStrandCount: fiber.strandCount,
        outgoingStrandCount: fiber.strandCount,
        stationingRouteId: stationing?.stationingRouteId || fiber.stationingRouteId || '',
        station: stationing?.stationFeet ?? null,
        milepost: stationing?.milepost ?? null,
        spliceMode: SPLICE_MODES.PASS_THROUGH
    });

    const enclosures = [...existingEnclosures, enclosure];
    const fiberSections = rebuildFiberSectionsForFibers({
        fibers: [fiber],
        projectId,
        enclosures,
        existingSections: existingSections.filter((section) => section.parentFiberId !== fiber.fiberId)
    });

    const connectedSectionIds = fiberSections
        .filter((section) =>
            section.fromEnclosureId === enclosure.enclosureId ||
            section.toEnclosureId === enclosure.enclosureId
        )
        .map((section) => section.sectionId);

    return {
        enclosure: {
            ...enclosure,
            connectedFiberSectionIds: connectedSectionIds,
            connectedCableCount: 1
        },
        fiberSections,
        fibers: [{ ...fiber }]
    };
}

/**
 * @param {object} input
 * @returns {object[]}
 */
export function rebuildFiberSectionsForFibers({
    fibers = [],
    projectId,
    enclosures = [],
    existingSections = []
}) {
    const retained = existingSections.filter((section) =>
        !fibers.some((fiber) => fiber.fiberId === section.parentFiberId)
    );

    const rebuilt = fibers.flatMap((fiber) =>
        buildFiberSectionsForFiber({
            fiber,
            projectId,
            enclosures
        })
    );

    return [...retained, ...rebuilt];
}

/**
 * @param {object} enclosure
 * @param {object} patch
 * @param {object} [context]
 * @returns {object}
 */
export function configureSpliceEnclosure(enclosure, patch = {}, context = {}) {
    const spliceMode = patch.spliceMode || enclosure.spliceMode;
    const incomingStrandCount = patch.incomingStrandCount ?? enclosure.incomingStrandCount;
    const outgoingStrandCount = patch.outgoingStrandCount ?? enclosure.outgoingStrandCount;
    const branchStrandCount = patch.branchStrandCount ?? patch.outgoingStrandCount ?? enclosure.outgoingStrandCount;
    const strandMappings = patch.strandMappings || enclosure.strandMappings || [];

    const fusionSpliceCount = calculateFusionSplices({
        spliceMode,
        strandMappings,
        incomingStrandCount,
        outgoingStrandCount,
        branchStrandCount
    });

    let passThroughStrandCount = 0;
    if (spliceMode === SPLICE_MODES.PASS_THROUGH) {
        passThroughStrandCount = incomingStrandCount;
    } else if (spliceMode === SPLICE_MODES.FULL_SPLICE) {
        passThroughStrandCount = 0;
    } else if (strandMappings.length) {
        passThroughStrandCount = Math.max(0, incomingStrandCount - countFusionSplicesFromMappings(strandMappings));
    }

    const unusedStrandCount = Math.max(0, incomingStrandCount - fusionSpliceCount - passThroughStrandCount);

    return {
        ...enclosure,
        ...patch,
        spliceMode,
        incomingStrandCount,
        outgoingStrandCount,
        strandMappings,
        fusionSpliceCount,
        passThroughStrandCount,
        unusedStrandCount,
        incomingCableCount: context.incomingCableCount ?? enclosure.incomingCableCount ?? 1,
        outgoingCableCount: context.outgoingCableCount ?? enclosure.outgoingCableCount ?? 1,
        connectedCableCount: context.connectedCableCount ?? enclosure.connectedCableCount ?? 1
    };
}

/**
 * @param {object} input
 * @returns {{ enclosure: object, branchFiber: object, fibers: object[] }}
 */
export function createBranchCableAtEnclosure({
    enclosure,
    sourceFiber,
    branchInput = {},
    projectId,
    projectDefaults = {}
}) {
    const strandCount = Number(branchInput.strandCount ?? 12);
    const cableType = branchInput.cableType || sourceFiber.cableType || 'SM';
    const cableName = branchInput.cableName || `${strandCount}F ${cableType} Branch`;
    const branchGeometry = branchInput.geometry || enclosure.geometry;

    if (!branchGeometry?.coordinates) {
        throw new Error('Branch cable geometry is required.');
    }

    const measuredRouteLength = branchInput.measuredRouteLength
        ?? (typeof turf !== 'undefined'
            ? lineLengthAny(turf.feature(branchGeometry.type ? branchGeometry : { type: 'LineString', coordinates: branchGeometry.coordinates }), FEET_UNITS)
            : 0);

    const branchFiber = createFiberRoute({
        projectId,
        cableName,
        geometry: branchGeometry.type ? branchGeometry : { type: 'LineString', coordinates: branchGeometry.coordinates },
        sourceSegmentIds: branchInput.sourceSegmentIds || [],
        catalogItemId: branchInput.catalogItemId || sourceFiber.catalogItemId || '',
        cableType,
        strandCount,
        measuredRouteLength,
        calculatedLength: calculateFiberQuantity({
            measuredRouteLength,
            slackFactor: branchInput.slackFactor ?? projectDefaults.defaultSlackFactor ?? 0,
            fixedSlack: branchInput.fixedSlack ?? 0,
            additionalLength: branchInput.additionalLength ?? 0,
            wasteFactor: projectDefaults.defaultWasteFactor ?? 0
        }),
        stationingRouteId: enclosure.stationingRouteId || sourceFiber.stationingRouteId || '',
        station: enclosure.station,
        milepost: enclosure.milepost,
        isBranch: true,
        branchSourceEnclosureId: enclosure.enclosureId,
        branchSourceFiberId: sourceFiber.fiberId
    });

    const strandMappings = branchInput.strandMappings
        || suggestBranchMappings(sourceFiber, branchFiber);

    const spliceMode = branchInput.spliceMode
        || (branchInput.buildingDrop ? SPLICE_MODES.BUILDING_DROP : SPLICE_MODES.BRANCH);

    const updatedEnclosure = configureSpliceEnclosure(enclosure, {
        spliceMode,
        strandMappings,
        incomingStrandCount: sourceFiber.strandCount,
        outgoingStrandCount: strandCount,
        branchStrandCount: strandCount,
        sourceFiberIds: [...new Set([...(enclosure.sourceFiberIds || []), sourceFiber.fiberId, branchFiber.fiberId])],
        connectedCableCount: (enclosure.connectedCableCount || 1) + 1,
        incomingCableCount: 1,
        outgoingCableCount: 2
    }, {
        connectedCableCount: (enclosure.connectedCableCount || 1) + 1,
        incomingCableCount: 1,
        outgoingCableCount: 2
    });

    return {
        enclosure: updatedEnclosure,
        branchFiber,
        fibers: [sourceFiber, branchFiber]
    };
}

/**
 * @param {object} design
 * @returns {object[]}
 */
export function buildSpliceSchedule(design = {}) {
    return (design.spliceEnclosures || []).map((enclosure) => ({
        enclosureId: enclosure.enclosureId,
        enclosureType: enclosure.enclosureType,
        spliceMode: enclosure.spliceMode,
        station: enclosure.station,
        milepost: enclosure.milepost,
        hostFiberId: enclosure.hostFiberId,
        incomingStrandCount: enclosure.incomingStrandCount,
        outgoingStrandCount: enclosure.outgoingStrandCount,
        passThroughStrandCount: enclosure.passThroughStrandCount,
        fusionSpliceCount: enclosure.fusionSpliceCount,
        unusedStrandCount: enclosure.unusedStrandCount,
        connectedFiberSectionIds: enclosure.connectedFiberSectionIds || [],
        strandMappingCount: (enclosure.strandMappings || []).length,
        notes: enclosure.notes || ''
    }));
}

/**
 * @param {object} design
 * @returns {string[]}
 */
export function validateSpliceConfiguration(design = {}) {
    const warnings = [];
    for (const enclosure of design.spliceEnclosures || []) {
        if (!enclosure.spliceMode) {
            warnings.push(`Splice ${enclosure.enclosureId} has no splice mode configured.`);
        }
        if (enclosure.spliceMode !== SPLICE_MODES.PASS_THROUGH && enclosure.fusionSpliceCount === 0 && !(enclosure.strandMappings || []).length) {
            warnings.push(`Splice ${enclosure.enclosureId} may need strand mappings or outgoing cable configuration.`);
        }
    }
    return warnings;
}

export { NEAR_FIBER_FT };
