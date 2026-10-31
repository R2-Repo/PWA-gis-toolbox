import { describe, expect, it } from 'vitest';
import { bboxOverlap, bboxToLngSegments } from '../js/tools/spatial-bbox.js';

describe('bboxToLngSegments', () => {
    it('leaves a normal Utah bbox as one segment', () => {
        expect(bboxToLngSegments([-111.5, 40.5, -111.4, 40.6])).toEqual([
            [-111.5, 40.5, -111.4, 40.6]
        ]);
    });

    it('splits a dateline-crossing box (west > east)', () => {
        expect(bboxToLngSegments([170, -5, -170, 5])).toEqual([
            [170, -5, 180, 5],
            [-180, -5, -170, 5]
        ]);
    });

    it('unwraps MapLibre-style bounds west of -180', () => {
        expect(bboxToLngSegments([-190, 10, -170, 20])).toEqual([
            [170, 10, 180, 20],
            [-180, 10, -170, 20]
        ]);
    });
});

describe('bboxOverlap (antimeridian)', () => {
    it('detects overlap across the dateline', () => {
        const clip = [170, -10, -170, 10];
        const eastPoint = [175, 0, 175.01, 0.01];
        const westPoint = [-175, 0, -174.99, 0.01];
        expect(bboxOverlap(clip, eastPoint)).toBe(true);
        expect(bboxOverlap(clip, westPoint)).toBe(true);
    });

    it('does not false-positive outside a dateline clip', () => {
        const clip = [170, -10, -170, 10];
        const utah = [-112, 40, -111, 41];
        expect(bboxOverlap(clip, utah)).toBe(false);
    });

    it('matches naive overlap for normal boxes', () => {
        const a = [-111.5, 40.5, -111.4, 40.6];
        const b = [-111.45, 40.55, -111.42, 40.58];
        expect(bboxOverlap(a, b)).toBe(true);
        const c = [-110, 40, -109, 41];
        expect(bboxOverlap(a, c)).toBe(false);
    });
});
