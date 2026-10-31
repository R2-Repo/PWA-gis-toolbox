import { describe, expect, it, beforeAll } from 'vitest';
import * as turf from '@turf/turf';
import { buildBBoxIndexEntries, bboxPreFilterByRadius } from '../js/tools/spatial-bbox.js';

beforeAll(() => {
    globalThis.turf = turf;
});

describe('bboxPreFilterByRadius', () => {
    it('keeps east-west candidates at 60°N when within search radius', () => {
        const src = turf.point([0, 60]);
        const near = turf.point([0.02, 60], { id: 'near' });
        const far = turf.point([1, 60], { id: 'far' });
        const targets = [near, far];
        const index = buildBBoxIndexEntries(targets);
        const radiusM = 1500;
        const filtered = bboxPreFilterByRadius(src, index, targets, radiusM);
        const ids = filtered.map((f) => f.properties.id);
        expect(ids).toContain('near');
        expect(ids).not.toContain('far');
    });

    it('falls back to all targets when padded window crosses the antimeridian', () => {
        const src = turf.point([179.5, 45]);
        const west = turf.point([-179.8, 45], { id: 'west' });
        const targets = [west];
        const index = buildBBoxIndexEntries(targets);
        const filtered = bboxPreFilterByRadius(src, index, targets, 50000);
        expect(filtered).toBe(targets);
    });
});
