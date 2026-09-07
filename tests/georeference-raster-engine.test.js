import { describe, expect, it } from 'vitest';
import {
    applyTransform,
    areSourcePointsCollinear,
    computeResiduals,
    computeRmsResidual,
    findWorstResidual,
    fromNormalizedSource,
    getAlignmentStatus,
    invertTransform,
    lngLatToMercator,
    mercatorToLngLat,
    solveAffine,
    solveAlignment,
    solveSimilarity,
    solveTranslation,
    toNormalizedSource,
    transformImageCorners,
    validateGcps
} from '../js/widgets/georeference-raster/engine.js';

function gcp(id, src, mercator) {
    const { lng, lat } = mercatorToLngLat(mercator.x, mercator.y);
    return {
        id,
        enabled: true,
        sourcePx: src,
        sourceNorm: toNormalizedSource(src, 1000, 800),
        mapLngLat: { lng, lat }
    };
}

function expectClose(actual, expected, digits = 6) {
    expect(actual).toBeCloseTo(expected, digits);
}

describe('georeference-raster engine', () => {
    it('maps one control point with a translation preview', () => {
        const src = { x: 120, y: 40 };
        const map = { x: 5000, y: -2000 };
        const transform = solveTranslation([gcp('gcp-1', src, map)], { width: 1000, height: 800 });
        const predicted = applyTransform(transform, src);
        expectClose(predicted.x, map.x, 6);
        expectClose(predicted.y, map.y, 6);
        expect(transform.model).toBe('translation');
    });

    it('recovers a known similarity transform from two pairs', () => {
        const known = { a: 2, b: 0, c: 1000, d: 0, e: 2, f: 2000 };
        const s1 = { x: 10, y: 20 };
        const s2 = { x: 50, y: 20 };
        const m1 = applyTransform(known, s1);
        const m2 = applyTransform(known, s2);
        const transform = solveSimilarity([
            gcp('gcp-1', s1, m1),
            gcp('gcp-2', s2, m2)
        ]);
        expect(transform.model).toBe('similarity');
        expectClose(transform.a, 2, 8);
        expectClose(transform.b, 0, 8);
        expectClose(transform.c, 1000, 5);
        expectClose(transform.d, 0, 8);
        expectClose(transform.e, 2, 8);
        expectClose(transform.f, 2000, 5);
    });

    it('recovers rotation and uniform scale from two pairs', () => {
        const angle = Math.PI / 2;
        const scale = 3;
        const known = {
            a: scale * Math.cos(angle),
            b: -scale * Math.sin(angle),
            c: 250,
            d: scale * Math.sin(angle),
            e: scale * Math.cos(angle),
            f: -80
        };
        const s1 = { x: 0, y: 0 };
        const s2 = { x: 40, y: 10 };
        const transform = solveSimilarity([
            gcp('gcp-1', s1, applyTransform(known, s1)),
            gcp('gcp-2', s2, applyTransform(known, s2))
        ]);
        expectClose(transform.a, known.a, 8);
        expectClose(transform.b, known.b, 8);
        expectClose(transform.d, known.d, 8);
        expectClose(transform.e, known.e, 8);
        expectClose(transform.c, known.c, 6);
        expectClose(transform.f, known.f, 6);
    });

    it('recovers exact affine coefficients from three pairs', () => {
        const known = { a: 1.5, b: 0.2, c: 100, d: -0.1, e: -1.2, f: 500 };
        const pts = [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 0, y: 160 }
        ];
        const gcps = pts.map((src, i) => gcp(`gcp-${i + 1}`, src, applyTransform(known, src)));
        const transform = solveAffine(gcps, { width: 200, height: 160 });
        expect(transform.model).toBe('affine');
        expectClose(transform.a, known.a, 7);
        expectClose(transform.b, known.b, 7);
        expectClose(transform.c, known.c, 5);
        expectClose(transform.d, known.d, 7);
        expectClose(transform.e, known.e, 7);
        expectClose(transform.f, known.f, 5);
        for (const src of pts) {
            const predicted = applyTransform(transform, src);
            const expected = applyTransform(known, src);
            expectClose(predicted.x, expected.x, 6);
            expectClose(predicted.y, expected.y, 6);
        }
    });

    it('fits a least-squares affine through noisy extra points', () => {
        const known = { a: 1.1, b: 0.05, c: 40, d: 0.02, e: -1.05, f: 90 };
        const pts = [
            { x: 0, y: 0 },
            { x: 400, y: 0 },
            { x: 400, y: 300 },
            { x: 0, y: 300 },
            { x: 200, y: 150 }
        ];
        const gcps = pts.map((src, i) => {
            const exact = applyTransform(known, src);
            const noise = i >= 3 ? { x: exact.x + 2.5, y: exact.y - 1.8 } : exact;
            return gcp(`gcp-${i + 1}`, src, noise);
        });
        const transform = solveAffine(gcps, { width: 400, height: 300 });
        expect(transform.model).toBe('affine-ls');
        const residuals = computeResiduals(transform, gcps, { width: 400, height: 300 });
        const rms = computeRmsResidual(residuals);
        expect(rms).toBeLessThan(3);
        expect(findWorstResidual(residuals).meters).toBeLessThan(6);
        expectClose(transform.a, known.a, 1);
        expectClose(transform.e, known.e, 1);
    });

    it('rejects duplicate and collinear GCPs for affine', () => {
        const known = { a: 1, b: 0, c: 0, d: 0, e: -1, f: 0 };
        const line = [
            gcp('gcp-1', { x: 0, y: 0 }, applyTransform(known, { x: 0, y: 0 })),
            gcp('gcp-2', { x: 50, y: 0 }, applyTransform(known, { x: 50, y: 0 })),
            gcp('gcp-3', { x: 90, y: 0 }, applyTransform(known, { x: 90, y: 0 }))
        ];
        const result = validateGcps(line, { width: 200, height: 100 });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('collinear');
        expect(areSourcePointsCollinear(line.map((g) => g.sourcePx))).toBe(true);
        expect(() => solveAffine(line, { width: 200, height: 100 })).toThrow(/line/i);

        const dupes = [
            gcp('gcp-1', { x: 10, y: 10 }, { x: 1, y: 1 }),
            gcp('gcp-2', { x: 10.2, y: 10.1 }, { x: 8, y: 4 })
        ];
        expect(validateGcps(dupes).ok).toBe(false);
    });

    it('round-trips residuals and inverted points', () => {
        const known = { a: 1.2, b: 0.1, c: 30, d: -0.05, e: -1.1, f: 70 };
        const src = { x: 80, y: 45 };
        const mapped = applyTransform(known, src);
        const back = invertTransform(known, mapped);
        expectClose(back.x, src.x, 8);
        expectClose(back.y, src.y, 8);

        const gcps = [
            gcp('gcp-1', { x: 0, y: 0 }, applyTransform(known, { x: 0, y: 0 })),
            gcp('gcp-2', { x: 100, y: 0 }, applyTransform(known, { x: 100, y: 0 })),
            gcp('gcp-3', { x: 10, y: 80 }, applyTransform(known, { x: 10, y: 80 }))
        ];
        const residuals = computeResiduals(known, gcps, { width: 100, height: 80 });
        expect(computeRmsResidual(residuals)).toBeLessThan(1e-6);
        expect(findWorstResidual(residuals).id).toBe('gcp-1');
    });

    it('keeps normalized source coordinates stable across preview sizes', () => {
        const sourcePx = { x: 250, y: 400 };
        const norm = toNormalizedSource(sourcePx, 1000, 800);
        expectClose(norm.x, 0.25, 10);
        expectClose(norm.y, 0.5, 10);
        const preview = fromNormalizedSource(norm, 500, 400);
        expectClose(preview.x, 125, 8);
        expectClose(preview.y, 200, 8);
        const original = fromNormalizedSource(norm, 1000, 800);
        expectClose(original.x, 250, 8);
        expectClose(original.y, 400, 8);
    });

    it('returns MapLibre corner order TL TR BR BL', () => {
        const transform = { a: 1, b: 0, c: 0, d: 0, e: -1, f: 0 };
        const corners = transformImageCorners(transform, 100, 50);
        expect(corners).toHaveLength(4);
        const tl = lngLatToMercator(corners[0][0], corners[0][1]);
        const tr = lngLatToMercator(corners[1][0], corners[1][1]);
        const br = lngLatToMercator(corners[2][0], corners[2][1]);
        const bl = lngLatToMercator(corners[3][0], corners[3][1]);
        expectClose(tl.x, 0, 6);
        expectClose(tl.y, 0, 6);
        expectClose(tr.x, 100, 6);
        expectClose(tr.y, 0, 6);
        expectClose(br.x, 100, 6);
        expectClose(br.y, -50, 6);
        expectClose(bl.x, 0, 6);
        expectClose(bl.y, -50, 6);
    });

    it('progresses alignment status from preview to ready', () => {
        const known = { a: 1, b: 0, c: 10, d: 0, e: -1, f: 20 };
        const one = solveAlignment([
            gcp('gcp-1', { x: 0, y: 0 }, applyTransform(known, { x: 0, y: 0 }))
        ], { width: 200, height: 100 });
        expect(one.preview).toBe(true);
        expect(one.ok).toBe(false);
        expect(getAlignmentStatus(one).code).toBe('need_more');

        const two = solveAlignment([
            gcp('gcp-1', { x: 0, y: 0 }, applyTransform(known, { x: 0, y: 0 })),
            gcp('gcp-2', { x: 80, y: 0 }, applyTransform(known, { x: 80, y: 0 }))
        ], { width: 200, height: 100 });
        expect(two.transform.model).toBe('similarity');
        expect(getAlignmentStatus(two).code).toBe('need_more');

        const three = solveAlignment([
            gcp('gcp-1', { x: 0, y: 0 }, applyTransform(known, { x: 0, y: 0 })),
            gcp('gcp-2', { x: 80, y: 0 }, applyTransform(known, { x: 80, y: 0 })),
            gcp('gcp-3', { x: 10, y: 60 }, applyTransform(known, { x: 10, y: 60 }))
        ], { width: 200, height: 100 });
        expect(three.ok).toBe(true);
        expect(getAlignmentStatus(three).code).toBe('ready_review');
        expect(getAlignmentStatus(three, { reviewed: true }).code).toBe('ready_add');
    });
});
