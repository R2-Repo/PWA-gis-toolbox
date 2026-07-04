import { describe, expect, it } from 'vitest';
import { getAnimationPreset } from '../js/presentation/animation-presets.js';
import { listRegisteredAnimationTypes } from '../js/presentation/presentation-animation-handlers.js';
import {
    listLinkAnimations,
    getLinkAnimation,
    getDurationMsForPace,
    splitComboDurations,
    COMBO_FLY_RATIO
} from '../js/presentation/presentation-link-animations.js';

describe('presentation link animation registry', () => {
    it('lists at least the four widget animations', () => {
        const ids = listLinkAnimations().map((entry) => entry.id);
        expect(ids).toContain('none');
        expect(ids).toContain('flyToFeature');
        expect(ids).toContain('rotateAroundFeature');
        expect(ids).toContain('flyToFeatureThenOrbit');
    });

    it('every animated link type has a preset and playback handler', () => {
        const handlers = new Set(listRegisteredAnimationTypes());
        for (const entry of listLinkAnimations()) {
            expect(getAnimationPreset(entry.id)).toBeTruthy();
            if (entry.animated) {
                expect(handlers.has(entry.id)).toBe(true);
            }
        }
    });

    it('returns pace durations from registry ui config', () => {
        const orbit = getLinkAnimation('rotateAroundFeature');
        expect(getDurationMsForPace(orbit, 'slow')).toBe(orbit.ui.pacePresetsMs.slow);
        expect(getDurationMsForPace(orbit, 'custom')).toBe(orbit.ui.defaultDurationMs);
    });

    it('splits combo fly/orbit durations by ratio', () => {
        const totalMs = 22000;
        const { flyDurationMs, orbitDurationMs } = splitComboDurations(totalMs);
        expect(flyDurationMs).toBe(Math.round(totalMs * COMBO_FLY_RATIO));
        expect(flyDurationMs + orbitDurationMs).toBe(totalMs);
    });
});
