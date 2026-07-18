import { describe, expect, it } from 'vitest';
import { normalizeWheelDeltaY } from '../js/platform/windows/map-wheel-zoom.js';

// WheelEvent.DOM_DELTA_* without relying on a browser global in node vitest.
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

describe('normalizeWheelDeltaY', () => {
    it('passes through pixel deltas', () => {
        expect(normalizeWheelDeltaY({ deltaY: 100, deltaMode: DOM_DELTA_PIXEL })).toBe(100);
    });

    it('scales line deltas', () => {
        expect(normalizeWheelDeltaY({ deltaY: 3, deltaMode: DOM_DELTA_LINE })).toBe(48);
    });

    it('scales page deltas', () => {
        expect(normalizeWheelDeltaY({ deltaY: 1, deltaMode: DOM_DELTA_PAGE })).toBe(400);
    });

    it('treats missing delta as zero', () => {
        expect(normalizeWheelDeltaY({})).toBe(0);
        expect(normalizeWheelDeltaY(null)).toBe(0);
    });
});
