import * as turf from '@turf/turf';
import { describe, expect, it } from 'vitest';
import {
    validateConnectedSegmentSequence,
    mergeSegmentGeometries,
    generateFiberRoute,
    synchronizeFiberGeometry
} from '../js/widgets/fiber-procurement-design/fiber-routing-engine.js';
import { createConduitSegment } from '../js/widgets/fiber-procurement-design/design-model.js';

globalThis.turf = turf;

describe('fiber procurement routing', () => {
    const segments = [
        createConduitSegment({
            segmentId: 'seg-1',
            geometry: {
                type: 'LineString',
                coordinates: [[-111.9, 40.75], [-111.895, 40.75]]
            },
            fromStructureId: null,
            toStructureId: 'jb-1',
            measuredLength: 1000
        }),
        createConduitSegment({
            segmentId: 'seg-2',
            geometry: {
                type: 'LineString',
                coordinates: [[-111.895, 40.75], [-111.89, 40.75]]
            },
            fromStructureId: 'jb-1',
            toStructureId: null,
            measuredLength: 1000
        })
    ];

    it('validates connected segment sequences', () => {
        const result = validateConnectedSegmentSequence(segments, ['seg-1', 'seg-2']);
        expect(result.valid).toBe(true);
        expect(result.ordered).toHaveLength(2);
    });

    it('rejects disconnected segment sequences', () => {
        const disconnected = [
            ...segments,
            createConduitSegment({
                segmentId: 'seg-3',
                geometry: {
                    type: 'LineString',
                    coordinates: [[-111.5, 40.8], [-111.49, 40.8]]
                }
            })
        ];
        const result = validateConnectedSegmentSequence(disconnected, ['seg-1', 'seg-3']);
        expect(result.valid).toBe(false);
    });

    it('merges segment geometries', () => {
        const geometry = mergeSegmentGeometries(segments);
        expect(geometry?.coordinates?.length).toBeGreaterThan(2);
    });

    it('generates a fiber route across multiple segments', () => {
        const fiber = generateFiberRoute({
            projectId: 'proj',
            segmentIds: ['seg-1', 'seg-2'],
            segments,
            strandCount: 144,
            cableType: 'SM',
            slackFactor: 0.03
        });
        expect(fiber.sourceSegmentIds).toEqual(['seg-1', 'seg-2']);
        expect(fiber.calculatedLength).toBeGreaterThan(fiber.measuredRouteLength);
    });

    it('synchronizes fiber geometry when segments change', () => {
        const fiber = generateFiberRoute({
            projectId: 'proj',
            segmentIds: ['seg-1', 'seg-2'],
            segments,
            strandCount: 48
        });
        const updatedSegments = segments.map((segment, index) =>
            index === 1
                ? { ...segment, geometry: { type: 'LineString', coordinates: [[-111.895, 40.75], [-111.885, 40.751]] } }
                : segment
        );
        const synced = synchronizeFiberGeometry(fiber, updatedSegments);
        expect(synced.measuredRouteLength).toBeGreaterThan(0);
    });
});
