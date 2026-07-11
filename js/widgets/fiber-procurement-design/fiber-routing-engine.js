/**
 * Fiber routing along selected conduit segments.
 */

import { lineLengthAny } from '../../tools/line-geojson.js';
import { createFiberRoute } from './design-model.js';
import { calculateFiberQuantity } from './quantity-rules.js';

const FEET_UNITS = 'feet';

/**
 * @param {object} left
 * @param {object} right
 * @returns {boolean}
 */
function sharesLineEndpoint(left, right) {
    if (!left?.geometry?.coordinates?.length || !right?.geometry?.coordinates?.length || typeof turf === 'undefined') {
        return false;
    }
    const leftCoords = left.geometry.coordinates;
    const rightCoords = right.geometry.coordinates;
    const leftStart = leftCoords[0];
    const leftEnd = leftCoords[leftCoords.length - 1];
    const rightStart = rightCoords[0];
    const rightEnd = rightCoords[rightCoords.length - 1];
    const tolerance = 1;
    const near = (a, b) => turf.distance(turf.point(a), turf.point(b), { units: FEET_UNITS }) <= tolerance;
    return near(leftEnd, rightStart) || near(leftEnd, rightEnd) || near(leftStart, rightStart) || near(leftStart, rightEnd);
}

/**
 * @param {object[]} segments
 * @param {string[]} segmentIds
 * @returns {{ valid: boolean, errors: string[], ordered: object[] }}
 */
export function validateConnectedSegmentSequence(segments = [], segmentIds = []) {
    const errors = [];
    if (!segmentIds.length) {
        return { valid: false, errors: ['Select at least one conduit segment.'], ordered: [] };
    }

    const selected = segmentIds.map((id) => segments.find((seg) => seg.segmentId === id)).filter(Boolean);
    if (selected.length !== segmentIds.length) {
        errors.push('One or more selected segments were not found.');
    }

    if (!selected.length) {
        return { valid: false, errors, ordered: [] };
    }

    const ordered = [selected[0]];
    const remaining = selected.slice(1);

    while (remaining.length) {
        const tail = ordered[ordered.length - 1];
        const nextIndex = remaining.findIndex((candidate) =>
            (tail.toStructureId && candidate.fromStructureId === tail.toStructureId) ||
            (tail.fromStructureId && candidate.toStructureId === tail.fromStructureId) ||
            sharesLineEndpoint(tail, candidate)
        );

        if (nextIndex < 0) {
            errors.push('Selected conduit segments are not connected in sequence.');
            break;
        }

        const [next] = remaining.splice(nextIndex, 1);
        ordered.push(next);
    }

    if (remaining.length) {
        errors.push('Unable to order all selected segments into one route.');
    }

    return { valid: errors.length === 0, errors, ordered };
}

/**
 * Merge segment geometries end-to-end.
 * @param {object[]} orderedSegments
 * @returns {import('geojson').LineString|null}
 */
export function mergeSegmentGeometries(orderedSegments = []) {
    if (!orderedSegments.length || typeof turf === 'undefined') return null;

    const coords = [];
    for (let i = 0; i < orderedSegments.length; i++) {
        const geometry = orderedSegments[i].geometry;
        if (!geometry?.coordinates?.length) continue;
        const segmentCoords = geometry.type === 'LineString'
            ? geometry.coordinates
            : geometry.coordinates[0];

        if (!segmentCoords?.length) continue;

        if (!coords.length) {
            coords.push(...segmentCoords);
            continue;
        }

        const last = coords[coords.length - 1];
        const first = segmentCoords[0];
        const sameDirection = turf.distance(turf.point(last), turf.point(first), { units: FEET_UNITS }) < 1;
        if (sameDirection) {
            coords.push(...segmentCoords.slice(1));
        } else {
            const reversed = [...segmentCoords].reverse();
            coords.push(...reversed.slice(1));
        }
    }

    if (coords.length < 2) return null;
    return { type: 'LineString', coordinates: coords };
}

/**
 * @param {object} input
 * @returns {object}
 */
export function generateFiberRoute({
    projectId,
    segmentIds = [],
    segments = [],
    startStructureId = null,
    endStructureId = null,
    catalogItemId = '',
    cableName = '',
    cableType = 'SM',
    strandCount = 144,
    assignedConduitComponentIds = [],
    slackFactor = 0.03,
    fixedSlack = 0,
    additionalLength = 0,
    wasteFactor = 0,
    stationing = null
}) {
    const validation = validateConnectedSegmentSequence(segments, segmentIds);
    if (!validation.valid) {
        throw new Error(validation.errors[0] || 'Invalid segment sequence.');
    }

    const geometry = mergeSegmentGeometries(validation.ordered);
    if (!geometry) {
        throw new Error('Unable to build fiber geometry from selected segments.');
    }

    const measuredRouteLength = lineLengthAny(turf.feature(geometry), FEET_UNITS);
    const calculatedLength = calculateFiberQuantity({
        measuredRouteLength,
        slackFactor,
        fixedSlack,
        additionalLength,
        wasteFactor
    });

    const resolvedStartStructureId = startStructureId || validation.ordered[0]?.fromStructureId || null;
    const resolvedEndStructureId = endStructureId || validation.ordered[validation.ordered.length - 1]?.toStructureId || null;

    return createFiberRoute({
        projectId,
        cableName: cableName || `${strandCount}F ${cableType}`,
        geometry,
        sourceSegmentIds: validation.ordered.map((seg) => seg.segmentId),
        assignedConduitComponentIds,
        catalogItemId,
        cableType,
        strandCount,
        startStructureId: resolvedStartStructureId,
        endStructureId: resolvedEndStructureId,
        measuredRouteLength,
        slackFactor,
        fixedSlack,
        additionalLength,
        calculatedLength,
        stationingRouteId: stationing?.stationingRouteId || validation.ordered[0]?.stationingRouteId || '',
        startStation: stationing?.startStation ?? validation.ordered[0]?.startStation ?? null,
        endStation: stationing?.endStation ?? validation.ordered[validation.ordered.length - 1]?.endStation ?? null,
        startMilepost: stationing?.startMilepost ?? validation.ordered[0]?.startMilepost ?? null,
        endMilepost: stationing?.endMilepost ?? validation.ordered[validation.ordered.length - 1]?.endMilepost ?? null
    });
}

/**
 * @param {object} fiber
 * @param {object[]} segments
 * @returns {object}
 */
export function synchronizeFiberGeometry(fiber, segments = []) {
    const selected = (fiber.sourceSegmentIds || [])
        .map((id) => segments.find((seg) => seg.segmentId === id))
        .filter(Boolean);
    const geometry = mergeSegmentGeometries(selected);
    if (!geometry) return fiber;

    const measuredRouteLength = lineLengthAny(turf.feature(geometry), FEET_UNITS);
    const calculatedLength = calculateFiberQuantity({
        measuredRouteLength,
        slackFactor: fiber.slackFactor,
        fixedSlack: fiber.fixedSlack,
        additionalLength: fiber.additionalLength
    });

    return {
        ...fiber,
        geometry,
        measuredRouteLength,
        calculatedLength
    };
}

/**
 * @param {object} design
 * @returns {object[]}
 */
export function synchronizeAllFiberRoutes(design) {
    const fibers = (design.fibers || []).map((fiber) =>
        synchronizeFiberGeometry(fiber, design.conduitSegments || [])
    );
    return fibers;
}
