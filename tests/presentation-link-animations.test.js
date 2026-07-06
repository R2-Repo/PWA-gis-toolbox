import { describe, expect, it } from 'vitest';
import { getAnimationPreset } from '../js/presentation/animation-presets.js';
import { listRegisteredAnimationTypes } from '../js/presentation/presentation-animation-handlers.js';
import { COMBO_FLY_RATIO } from '../js/presentation/presentation-constants.js';
import {
    listLinkAnimations,
    getLinkAnimation,
    getDurationMsForPace,
    splitComboDurations
} from '../js/presentation/presentation-link-animations.js';

describe('presentation link animation registry', () => {
    it('lists curated widget animations plus line/point primitives', () => {
        const ids = listLinkAnimations().map((entry) => entry.id);
        expect(ids).toContain('none');
        expect(ids).toContain('flyToFeature');
        expect(ids).toContain('rotateAroundFeature');
        expect(ids).toContain('flyToFeatureThenOrbit');
        expect(ids).toContain('animateLinePath');
        expect(ids).toContain('flyAlongPath');
        expect(ids).toContain('animatePoint');
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
