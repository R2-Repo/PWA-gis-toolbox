import * as turf from '@turf/turf';
import { describe, expect, it, beforeEach } from 'vitest';
import { resetIdSequence } from '../js/plan-project/id-utils.js';
import {
    calculateFusionSplices,
    countFusionSplicesFromMappings,
    buildDefaultBranchMappings,
    suggestBranchMappings,
    snapCoordinateToFiber,
    splitFiberGeometryAtDistances,
    placeSpliceEnclosureOnFiber,
    configureSpliceEnclosure,
    createBranchCableAtEnclosure,
    buildSpliceSchedule,
    validateSpliceConfiguration,
    rebuildFiberSectionsForFibers,
    SPLICE_MODES
} from '../js/widgets/fiber-procurement-design/splice-engine.js';
import { createFiberRoute } from '../js/widgets/fiber-procurement-design/design-model.js';

globalThis.turf = turf;

const fiberGeometry = {
    type: 'LineString',
    coordinates: [
        [-111.9, 40.75],
        [-111.895, 40.75],
        [-111.89, 40.75]
    ]
};

function makeFiber(overrides = {}) {
    return createFiberRoute({
        projectId: 'proj',
        fiberId: 'fiber-main',
        cableName: '144F SM Main',
        geometry: fiberGeometry,
        strandCount: 144,
        cableType: 'SM',
        measuredRouteLength: 1000,
        calculatedLength: 1030,
        ...overrides
    });
}

describe('fiber procurement splice engine', () => {
    beforeEach(() => resetIdSequence());

    it('returns zero fusion splices for pass-through', () => {
        expect(calculateFusionSplices({
            spliceMode: SPLICE_MODES.PASS_THROUGH,
            incomingStrandCount: 144
        })).toBe(0);
    });

    it('calculates full cable splice count', () => {
        expect(calculateFusionSplices({
            spliceMode: SPLICE_MODES.FULL_SPLICE,
            incomingStrandCount: 144,
            outgoingStrandCount: 144
        })).toBe(144);
    });

    it('calculates branch splice count from strand mappings', () => {
        const mappings = buildDefaultBranchMappings({
            branchStrandCount: 12,
            mainStartStrand: 49
        });
        expect(countFusionSplicesFromMappings(mappings)).toBe(12);
        expect(mappings[0]).toEqual({
            fromCable: 'main',
            fromStrand: 49,
            toCable: 'branch',
            toStrand: 1
        });
    });

    it('calculates mid-span branch splice count', () => {
        expect(calculateFusionSplices({
            spliceMode: SPLICE_MODES.MID_SPAN_ACCESS,
            branchStrandCount: 12
        })).toBe(12);
    });

    it('calculates splice count for strand-count change using minimum strands', () => {
        expect(calculateFusionSplices({
            spliceMode: SPLICE_MODES.STRAND_COUNT_CHANGE,
            incomingStrandCount: 48,
            outgoingStrandCount: 144
        })).toBe(48);
    });

    it('calculates full continuation plus branch example as mapping-based count', () => {
        const branchMappings = buildDefaultBranchMappings({ branchStrandCount: 12, mainStartStrand: 49 });
        const continuationMappings = [];
        for (let i = 1; i <= 144; i++) {
            continuationMappings.push({ fromCable: 'main', fromStrand: i, toCable: 'continuation', toStrand: i });
        }
        const total = countFusionSplicesFromMappings([...branchMappings, ...continuationMappings]);
        expect(total).toBe(156);
    });

    it('snaps a coordinate to a fiber route', () => {
        const fiber = makeFiber();
        const snap = snapCoordinateToFiber(fiber, [-111.895, 40.75]);
        expect(snap.distanceAlongFt).toBeGreaterThan(0);
        expect(snap.totalLengthFt).toBeGreaterThan(0);
    });

    it('splits fiber geometry at a distance', () => {
        const fiber = makeFiber();
        const total = turf.length(turf.feature(fiber.geometry), { units: 'feet' });
        const parts = splitFiberGeometryAtDistances(fiber, [total / 2]);
        expect(parts).toHaveLength(2);
    });

    it('places a splice enclosure and creates fiber sections', () => {
        const fiber = makeFiber();
        const result = placeSpliceEnclosureOnFiber({
            fiber,
            coordinate: [-111.895, 40.75],
            projectId: 'proj'
        });
        expect(result.enclosure.hostFiberId).toBe('fiber-main');
        expect(result.fiberSections.length).toBeGreaterThanOrEqual(2);
        expect(result.enclosure.connectedFiberSectionIds.length).toBeGreaterThan(0);
    });

    it('configures pass-through and full splice enclosures', () => {
        const configured = configureSpliceEnclosure(
            { enclosureId: 's1', spliceMode: SPLICE_MODES.PASS_THROUGH, incomingStrandCount: 144, outgoingStrandCount: 144 },
            { spliceMode: SPLICE_MODES.FULL_SPLICE }
        );
        expect(configured.fusionSpliceCount).toBe(144);
        expect(configured.passThroughStrandCount).toBe(0);
    });

    it('creates a branch cable at an enclosure with suggested mappings', () => {
        const sourceFiber = makeFiber();
        const enclosure = {
            enclosureId: 'splice-1',
            geometry: { type: 'Point', coordinates: [-111.895, 40.75] },
            hostFiberId: sourceFiber.fiberId,
            incomingStrandCount: 144,
            outgoingStrandCount: 12,
            spliceMode: SPLICE_MODES.BRANCH,
            sourceFiberIds: [sourceFiber.fiberId],
            connectedCableCount: 1
        };
        const result = createBranchCableAtEnclosure({
            enclosure,
            sourceFiber,
            projectId: 'proj',
            branchInput: {
                strandCount: 12,
                cableType: 'SM',
                geometry: {
                    type: 'LineString',
                    coordinates: [[-111.895, 40.75], [-111.894, 40.751]]
                }
            }
        });
        expect(result.branchFiber.isBranch).toBe(true);
        expect(result.enclosure.fusionSpliceCount).toBe(12);
        expect(result.enclosure.sourceFiberIds).toContain(result.branchFiber.fiberId);
    });

    it('suggests branch mappings for smaller drop cable', () => {
        const mappings = suggestBranchMappings(makeFiber({ strandCount: 144 }), makeFiber({ strandCount: 12, fiberId: 'drop' }));
        expect(mappings).toHaveLength(12);
    });

    it('builds a splice schedule from design data', () => {
        const schedule = buildSpliceSchedule({
            spliceEnclosures: [{
                enclosureId: 's1',
                spliceMode: SPLICE_MODES.BUILDING_DROP,
                fusionSpliceCount: 12,
                passThroughStrandCount: 132,
                incomingStrandCount: 144,
                outgoingStrandCount: 12
            }]
        });
        expect(schedule[0].fusionSpliceCount).toBe(12);
    });

    it('validates missing splice configuration', () => {
        const warnings = validateSpliceConfiguration({
            spliceEnclosures: [{ enclosureId: 's1', spliceMode: SPLICE_MODES.BRANCH, fusionSpliceCount: 0, strandMappings: [] }]
        });
        expect(warnings.length).toBeGreaterThan(0);
    });

    it('rebuilds fiber sections after enclosure placement', () => {
        const fiber = makeFiber();
        const placement = placeSpliceEnclosureOnFiber({
            fiber,
            coordinate: [-111.895, 40.75],
            projectId: 'proj'
        });
        const sections = rebuildFiberSectionsForFibers({
            fibers: [fiber],
            projectId: 'proj',
            enclosures: [placement.enclosure]
        });
        expect(sections.every((section) => section.parentFiberId === fiber.fiberId)).toBe(true);
    });
});
