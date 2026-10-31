import { describe, expect, it, beforeAll } from 'vitest';
import * as turf from '@turf/turf';
import { computeFeatureDistance } from '../js/tools/feature-distance.js';

beforeAll(() => {
    globalThis.turf = turf;
});

describe('computeFeatureDistance', () => {
    it('uses nearest MultiPoint member, not centroid', () => {
        const src = turf.point([-111.5, 40.5]);
        const tgt = turf.multiPoint([
            [-111.6, 40.5],
            [-111.501, 40.5],
            [-111.9, 40.5]
        ]);
        const { distanceMeters, nearestCoord } = computeFeatureDistance(src, tgt);
        const centroidDist = turf.distance(src, turf.centroid(tgt), { units: 'meters' });
        expect(distanceMeters).toBeLessThan(centroidDist);
        expect(nearestCoord[0]).toBeCloseTo(-111.501, 3);
    });

    it('returns Infinity for empty MultiPoint', () => {
        const src = turf.point([0, 0]);
        const tgt = { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [] } };
        const { distanceMeters } = computeFeatureDistance(src, tgt);
        expect(distanceMeters).toBe(Infinity);
    });
});
