import { describe, expect, it } from 'vitest';
import {
    calculateFusionSplices,
    countFusionSplicesFromMappings,
    buildDefaultBranchMappings,
    SPLICE_MODES
} from '../js/widgets/fiber-procurement-design/splice-engine.js';

describe('fiber procurement splice engine', () => {
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
            mainStrandCount: 144,
            branchStrandCount: 12,
            mainStartStrand: 49
        });
        expect(countFusionSplicesFromMappings(mappings)).toBe(12);
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
});
