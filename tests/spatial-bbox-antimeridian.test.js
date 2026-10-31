import { describe, expect, it } from 'vitest';
import { bboxOverlap, bboxToLngSegments, minBBoxSeparationMeters } from '../js/tools/spatial-bbox.js';

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

describe('minBBoxSeparationMeters (antimeridian)', () => {
    const METERS_PER_DEG_LAT = 111320;
    const metersPerDegLon = (lat) => METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

    it('uses the shorter gap across ±180° (not ~340° naive longitude)', () => {
        const eastBox = [170, -5, 175, 5];
        const westBox = [-175, -5, -170, 5];
        const naiveLonGapDeg = 170 - -170;
        expect(naiveLonGapDeg).toBeGreaterThan(300);
        const sep = minBBoxSeparationMeters(eastBox, westBox);
        const latRef = 0;
        const expectedMax = 10 * metersPerDegLon(latRef) * 1.01;
        expect(sep).toBeLessThan(expectedMax);
        expect(sep).toBeGreaterThan(0);
    });

    it('returns 0 for dateline-crossing boxes that overlap', () => {
        const straddle = [170, -10, -170, 10];
        const eastPoint = [175, 0, 175.01, 0.01];
        expect(minBBoxSeparationMeters(straddle, eastPoint)).toBe(0);
    });

    it('matches naive separation for normal Utah boxes', () => {
        const a = [-111.5, 40.5, -111.4, 40.6];
        const b = [-111.2, 40.5, -111.1, 40.6];
        const latRef = (a[1] + a[3] + b[1] + b[3]) / 4;
        const dxDeg = b[0] - a[2];
        const expected = dxDeg * metersPerDegLon(latRef);
        expect(minBBoxSeparationMeters(a, b)).toBeCloseTo(expected, 1);
    });

    it('near dateline but not crossing: small gap stays small', () => {
        const a = [179, 60, 179.5, 61];
        const b = [-179.5, 60, -179, 61];
        const sep = minBBoxSeparationMeters(a, b);
        const latRef = 60.5;
        const wrapDeg = (180 - 179.5) + (180 + -179.5);
        expect(wrapDeg).toBe(1);
        expect(sep).toBeLessThanOrEqual(wrapDeg * metersPerDegLon(latRef) * 1.05);
    });

    it('high latitude: lon meters shrink with cos(lat)', () => {
        const a = [10, 70, 10.1, 70.1];
        const b = [10.5, 70, 10.6, 70.1];
        const latRef = 70.05;
        const dxDeg = b[0] - a[2];
        const expected = dxDeg * metersPerDegLon(latRef);
        expect(minBBoxSeparationMeters(a, b)).toBeCloseTo(expected, 0);
    });
});
