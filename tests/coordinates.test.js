import { describe, expect, it } from 'vitest';
import { ddToDms, ddToDdm, dmsToDd, ddmToDd } from '../js/tools/coordinates.js';

describe('coordinates DMS/DDM', () => {
    it('rolls seconds into minutes and degrees (no 60″)', () => {
        const out = ddToDms(40.99999999, false);
        expect(out).not.toMatch(/60\.00"/);
        expect(out).toMatch(/^41° 0' 0\.00"/);
    });

    it('rolls decimal minutes (no 60′ in DDM)', () => {
        const out = ddToDdm(40.99999999, false);
        expect(out).not.toMatch(/60\.0000'/);
        expect(out).toMatch(/^41° 0\.0000'/);
    });

    it('preserves negative sign for -0° DMS input', () => {
        expect(dmsToDd("-0° 30' 00\"")).toBeCloseTo(-0.5, 6);
    });

    it('preserves negative sign for -0° DDM input', () => {
        expect(ddmToDd("-0° 30.0000'")).toBeCloseTo(-0.5, 6);
    });

    it('rounds near-60 seconds without emitting 60.00"', () => {
        const dd = 10 + 59 / 60 + 59.9999 / 3600;
        const out = ddToDms(dd, false);
        expect(out).not.toContain('60.00"');
    });
});
