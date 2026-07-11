/**
 * Conduit alignment / structure relationship engine.
 */

import { lineLengthAny, lineSliceAlongRoute } from '../../tools/line-geojson.js';
import { linkParentChild } from '../../plan-project/relationship-model.js';
import {
    createConduitSegment,
    createConduitComponent,
    createStructure,
    STRUCTURE_TYPES
} from './design-model.js';

const FEET_UNITS = 'feet';

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} lineFeature
 * @param {[number, number]} coordinate
 * @returns {{ distanceAlongFt: number, snapCoordinate: [number, number] }}
 */
export function snapCoordinateToLine(lineFeature, coordinate) {
    if (!lineFeature || !coordinate || typeof turf === 'undefined') {
        throw new Error('Turf is required for line snapping.');
    }
    const point = turf.point(coordinate);
    const snap = turf.nearestPointOnLine(lineFeature, point, { units: FEET_UNITS });
    return {
        distanceAlongFt: Number(snap.properties?.location ?? 0),
        snapCoordinate: snap.geometry.coordinates
    };
}

/**
 * @param {import('geojson').Feature<import('geojson').LineString>} lineFeature
 * @param {number[]} distancesFt
 * @returns {import('geojson').Feature<import('geojson').LineString>[]}
 */
export function splitLineAtDistances(lineFeature, distancesFt = []) {
    if (!lineFeature?.geometry || typeof turf === 'undefined') return [];
    const totalLen = lineLengthAny(lineFeature, FEET_UNITS);
    const breakpoints = [0, ...distancesFt.filter((d) => d > 0 && d < totalLen), totalLen]
        .sort((a, b) => a - b)
        .filter((value, index, arr) => index === 0 || Math.abs(value - arr[index - 1]) > 0.01);

    const segments = [];
    for (let i = 0; i < breakpoints.length - 1; i++) {
        const start = breakpoints[i];
        const end = breakpoints[i + 1];
        if (end - start < 0.01) continue;
        const slice = lineSliceAlongRoute(lineFeature, start, end, FEET_UNITS);
        if (slice?.geometry?.coordinates?.length >= 2) {
            segments.push(slice);
        }
    }
    return segments;
}

/**
 * @param {object} input
 * @returns {object}
 */
export function placeStructureOnAlignment({
    alignment,
    coordinate,
    assetType = STRUCTURE_TYPES.JUNCTION_BOX,
    projectId,
    structureName = '',
    existingStructures = [],
    stationing = null
}) {
    if (!alignment?.geometry) {
        throw new Error('Alignment geometry is required.');
    }

    const lineFeature = turf.feature(alignment.geometry);
    const { distanceAlongFt, snapCoordinate } = snapCoordinateToLine(lineFeature, coordinate);

    const duplicate = existingStructures.find((structure) =>
        Math.abs(Number(structure.distanceAlongAlignmentFt) - distanceAlongFt) < 1
    );
    if (duplicate) {
        throw new Error('A structure already exists at this location.');
    }

    const structure = createStructure({
        projectId,
        parentAlignmentId: alignment.alignmentId,
        assetType,
        structureName: structureName || (assetType === STRUCTURE_TYPES.VAULT ? 'Vault' : 'Junction box'),
        geometry: { type: 'Point', coordinates: snapCoordinate },
        distanceAlongAlignmentFt: distanceAlongFt,
        stationingRouteId: stationing?.stationingRouteId || alignment.stationingRouteId || '',
        station: stationing?.stationFeet ?? null,
        milepost: stationing?.milepost ?? null
    });

    return { structure, distanceAlongFt };
}

/**
 * @param {object} input
 * @returns {{ segments: object[], relationships: object[] }}
 */
export function regenerateConduitSegments({
    alignment,
    structures = [],
    projectId,
    projectDefaults = {},
    existingSegments = [],
    relationships = []
}) {
    if (!alignment?.geometry) {
        return { segments: [], relationships };
    }

    const lineFeature = turf.feature(alignment.geometry);
    const structureDistances = structures
        .filter((s) => s.parentAlignmentId === alignment.alignmentId)
        .map((s) => Number(s.distanceAlongAlignmentFt ?? 0))
        .sort((a, b) => a - b);

    const geometrySegments = splitLineAtDistances(lineFeature, structureDistances);
    const sortedStructures = structures
        .filter((s) => s.parentAlignmentId === alignment.alignmentId)
        .sort((a, b) => Number(a.distanceAlongAlignmentFt) - Number(b.distanceAlongAlignmentFt));

    const templateSegment = existingSegments[0];
    const templateComponents = templateSegment?.conduitComponents?.map((component) => ({
        ...createConduitComponent({
            ...component,
            componentId: undefined,
            parentSegmentId: undefined
        })
    })) || [
        createConduitComponent({
            catalogItemId: '',
            productType: 'HDPE',
            diameter: '2-inch',
            ductCount: 2
        })
    ];

    const segments = [];
    let nextRelationships = [...relationships];

    for (let i = 0; i < geometrySegments.length; i++) {
        const geometry = geometrySegments[i].geometry;
        const measuredLength = lineLengthAny(geometrySegments[i], FEET_UNITS);
        const fromStructureId = i === 0 ? null : sortedStructures[i - 1]?.structureId || null;
        const toStructureId = i < sortedStructures.length ? sortedStructures[i]?.structureId || null : null;

        const existing = existingSegments[i];
        const segment = createConduitSegment({
            ...(existing || {}),
            segmentId: existing?.segmentId,
            projectId,
            parentAlignmentId: alignment.alignmentId,
            fromStructureId,
            toStructureId,
            geometry,
            measuredLength,
            installationMethod: existing?.installationMethod || projectDefaults.defaultInstallationMethod || 'directional_bore',
            existingOrProposed: existing?.existingOrProposed || projectDefaults.defaultStatus || 'proposed',
            conduitComponents: (existing?.conduitComponents || templateComponents).map((component) =>
                createConduitComponent({
                    ...component,
                    componentId: component.componentId,
                    parentSegmentId: existing?.segmentId
                })
            ),
            stationingRouteId: alignment.stationingRouteId || '',
            startStation: existing?.startStation ?? alignment.startStation,
            endStation: existing?.endStation ?? alignment.endStation
        });

        for (const component of segment.conduitComponents) {
            component.parentSegmentId = segment.segmentId;
        }

        segments.push(segment);

        const parentLink = linkParentChild(nextRelationships, alignment.alignmentId, segment.segmentId, 'alignment_segment');
        nextRelationships = parentLink.relationships;
        if (fromStructureId) {
            const fromLink = linkParentChild(nextRelationships, fromStructureId, segment.segmentId, 'structure_segment');
            nextRelationships = fromLink.relationships;
        }
        if (toStructureId) {
            const toLink = linkParentChild(nextRelationships, toStructureId, segment.segmentId, 'structure_segment');
            nextRelationships = toLink.relationships;
        }
    }

    return { segments, relationships: nextRelationships };
}

/**
 * @param {object} input
 * @returns {{ structures: object[], segments: object[], relationships: object[] }}
 */
export function moveStructureOnAlignment({
    alignment,
    structureId,
    coordinate,
    structures = [],
    segments = [],
    relationships = [],
    projectId,
    projectDefaults = {},
    stationing = null
}) {
    const structure = structures.find((item) => item.structureId === structureId);
    if (!structure) throw new Error('Structure not found.');

    const lineFeature = turf.feature(alignment.geometry);
    const { distanceAlongFt, snapCoordinate } = snapCoordinateToLine(lineFeature, coordinate);

    const updatedStructures = structures.map((item) =>
        item.structureId === structureId
            ? {
                ...item,
                geometry: { type: 'Point', coordinates: snapCoordinate },
                distanceAlongAlignmentFt: distanceAlongFt,
                station: stationing?.stationFeet ?? item.station,
                milepost: stationing?.milepost ?? item.milepost
            }
            : item
    );

    const regen = regenerateConduitSegments({
        alignment,
        structures: updatedStructures,
        projectId,
        projectDefaults,
        existingSegments: segments,
        relationships
    });

    return {
        structures: updatedStructures,
        segments: regen.segments,
        relationships: regen.relationships
    };
}

/**
 * @param {object} input
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateSegmentMerge(left, right) {
    if (!left || !right) return { valid: false, reason: 'Missing segment.' };
    if (left.installationMethod !== right.installationMethod) {
        return { valid: false, reason: 'Installation methods differ.' };
    }
    if (left.existingOrProposed !== right.existingOrProposed) {
        return { valid: false, reason: 'Existing/proposed status differs.' };
    }
    const leftComponents = JSON.stringify(left.conduitComponents || []);
    const rightComponents = JSON.stringify(right.conduitComponents || []);
    if (leftComponents !== rightComponents) {
        return { valid: false, reason: 'Conduit component configuration differs.' };
    }
    return { valid: true };
}

/**
 * @param {object} input
 * @returns {{ structures: object[], segments: object[], relationships: object[], merged: boolean, reason?: string }}
 */
export function deleteStructureFromAlignment({
    alignment,
    structureId,
    structures = [],
    segments = [],
    relationships = [],
    mergeAdjoining = false,
    projectId,
    projectDefaults = {}
}) {
    const index = structures.findIndex((item) => item.structureId === structureId);
    if (index < 0) throw new Error('Structure not found.');

    if (mergeAdjoining && index > 0 && index < structures.length) {
        const left = segments[index - 1];
        const right = segments[index];
        const mergeCheck = validateSegmentMerge(left, right);
        if (!mergeCheck.valid) {
            return {
                structures,
                segments,
                relationships,
                merged: false,
                reason: mergeCheck.reason
            };
        }
    }

    const updatedStructures = structures.filter((item) => item.structureId !== structureId);
    const regen = regenerateConduitSegments({
        alignment,
        structures: updatedStructures,
        projectId,
        projectDefaults,
        existingSegments: mergeAdjoining ? [] : segments,
        relationships: relationships.filter((rel) => rel.parentId !== structureId && rel.childId !== structureId)
    });

    return {
        structures: updatedStructures,
        segments: regen.segments,
        relationships: regen.relationships,
        merged: mergeAdjoining
    };
}

/**
 * @param {object} segment
 * @param {object} patch
 * @returns {object}
 */
export function updateConduitSegment(segment, patch = {}) {
    const updated = {
        ...segment,
        ...patch,
        conduitComponents: patch.conduitComponents
            ? patch.conduitComponents.map((component) => createConduitComponent({
                ...component,
                parentSegmentId: segment.segmentId
            }))
            : [...(segment.conduitComponents || [])]
    };

    if (updated.geometry) {
        updated.measuredLength = lineLengthAny(turf.feature(updated.geometry), FEET_UNITS);
    }

    return updated;
}
