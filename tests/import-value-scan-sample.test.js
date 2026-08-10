/**
 * Unit coverage for value-scan early-stop helpers (mirrors worker _createScanState budget).
 */
import { describe, it, expect } from 'vitest';
import { createValueAccumulator } from '../js/import/import-value-accumulator.js';
import {
    VALUE_SCAN_MAX_FEATURES,
    VALUE_SCAN_MAX_BYTES
} from '../js/import/import-scan-cache.js';

function makeSampleBudget({
    sampleMaxFeatures = VALUE_SCAN_MAX_FEATURES,
    sampleMaxBytes = VALUE_SCAN_MAX_BYTES,
    valueCap = 50
} = {}) {
    const acc = createValueAccumulator(valueCap);
    let sampled = false;
    return {
        acc,
        shouldStop(bytesProcessed = 0) {
            if (acc.rowCount >= sampleMaxFeatures) {
                sampled = true;
                return true;
            }
            if (bytesProcessed >= sampleMaxBytes) {
                sampled = true;
                return true;
            }
            return false;
        },
        get sampled() {
            return sampled;
        }
    };
}

describe('value-scan sample budget', () => {
    it('stops after the feature sample cap', () => {
        const state = makeSampleBudget({ sampleMaxFeatures: 5, sampleMaxBytes: 1e12 });
        for (let i = 0; i < 5; i++) {
            expect(state.shouldStop(0)).toBe(false);
            state.acc.addProperties({ id: String(i) });
        }
        expect(state.shouldStop(0)).toBe(true);
        expect(state.sampled).toBe(true);
        expect(state.acc.rowCount).toBe(5);
    });

    it('stops after the byte sample cap', () => {
        const state = makeSampleBudget({ sampleMaxFeatures: 1e9, sampleMaxBytes: 100 });
        state.acc.addProperties({ id: '1' });
        expect(state.shouldStop(50)).toBe(false);
        expect(state.shouldStop(100)).toBe(true);
        expect(state.sampled).toBe(true);
    });
});
