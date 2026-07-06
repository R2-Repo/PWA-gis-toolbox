import { describe, expect, it } from 'vitest';
import {
    compileAuthoringSteps,
    compilePreviewTimeline,
    resolveSequenceCameraPresetId,
    estimateTimelineDurationMs,
    getOverlapHintForStep,
    getOverlapFraction,
    HOLD_STEP_TYPE,
    createSequenceStepId
} from '../js/presentation/presentation-sequence-compiler.js';
import { estimateSceneDurationMs } from '../js/presentation/presentation-export-profiles.js';

const cameraConfig = { pitch: 45, bearing: 30, padding: 80 };
const mockMap = {
    getPitch: () => 45,
    getBearing: () => 30
};
const ctx = { map: mockMap, cameraConfig };

describe('presentation sequence compiler', () => {
    it('creates unique step ids', () => {
        const a = createSequenceStepId();
        const b = createSequenceStepId();
        expect(a).not.toBe(b);
    });

    it('merges fly + orbit into cinematic combo step', () => {
        const steps = [
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'rotateAroundFeature', durationMs: 12000 }
        ];
        const compiled = compileAuthoringSteps(steps, ctx);
        expect(compiled).toHaveLength(1);
        expect(compiled[0].type).toBe('flyToFeatureThenOrbit');
        expect(compiled[0].durationMs).toBe(20000);
        expect(compiled[0].startAtMs).toBe(0);
        expect(compiled[0].options.flyDurationMs).toBe(8000);
        expect(compiled[0].options.orbitDurationMs).toBe(12000);
        expect(compiled[0].options.entryFromCurrent).toBe(true);
    });

    it('applies hold as startAtMs offset on the next step', () => {
        const steps = [
            { id: 'h1', type: HOLD_STEP_TYPE, durationMs: 2000 },
            { id: 's1', type: 'rotateAroundFeature', durationMs: 6000 }
        ];
        const compiled = compileAuthoringSteps(steps, ctx);
        expect(compiled).toHaveLength(1);
        expect(compiled[0].type).toBe('rotateAroundFeature');
        expect(compiled[0].startAtMs).toBe(2000);
        expect(compiled[0].delayMs).toBe(0);
    });

    it('overlaps fly + draw route at 50%', () => {
        const steps = [
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'animateLinePath', durationMs: 10000 }
        ];
        const compiled = compileAuthoringSteps(steps, ctx);
        expect(compiled).toHaveLength(2);
        expect(compiled[0].startAtMs).toBe(0);
        expect(compiled[1].startAtMs).toBe(4000);
        expect(compiled[1].options.timelineMode).toBe('overlap');
        expect(compiled[1].options.bridgeBefore).toBe(false);

        const timeline = compilePreviewTimeline(steps, ctx);
        expect(timeline.totalDurationMs).toBe(14000);
    });

    it('keeps camera + camera pairs sequential with bridge', () => {
        const steps = [
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'flyAlongPath', durationMs: 10000 }
        ];
        const compiled = compileAuthoringSteps(steps, ctx);
        expect(compiled[1].startAtMs).toBe(8000);
        expect(compiled[1].options.timelineMode).toBe('sequential');
        expect(compiled[1].options.bridgeBefore).toBe(true);
        expect(getOverlapFraction('flyToFeature', 'flyAlongPath')).toBeNull();
    });

    it('resolves camera preset from first meaningful step', () => {
        expect(resolveSequenceCameraPresetId([
            { id: 'h1', type: HOLD_STEP_TYPE, durationMs: 1000 },
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'rotateAroundFeature', durationMs: 12000 }
        ])).toBe('flyToFeatureThenOrbit');

        expect(resolveSequenceCameraPresetId([
            { id: 's1', type: 'rotateAroundFeature', durationMs: 12000 }
        ])).toBe('rotateAroundFeature');
    });

    it('provides overlap hints for UI', () => {
        const steps = [
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'animateLinePath', durationMs: 10000 }
        ];
        expect(getOverlapHintForStep(steps, 0, ctx)).toBeNull();
        expect(getOverlapHintForStep(steps, 1, ctx)).toMatch(/Draw route starts halfway/i);
    });

    it('estimates timeline duration for export', () => {
        const steps = [
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'animateLinePath', durationMs: 10000 }
        ];
        const compiled = compileAuthoringSteps(steps, ctx);
        expect(estimateTimelineDurationMs(compiled)).toBe(14000);
        expect(estimateSceneDurationMs(compiled)).toBe(14000);
    });

    it('falls back to sequential sum for legacy steps without startAtMs', () => {
        const legacy = [
            { durationMs: 5000, delayMs: 1000 },
            { durationMs: 3000, delayMs: 0 }
        ];
        expect(estimateTimelineDurationMs(legacy)).toBe(9000);
    });
});
