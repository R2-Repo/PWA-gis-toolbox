import { describe, expect, it } from 'vitest';
import {
    compileAuthoringSteps,
    resolveSequenceCameraPresetId,
    HOLD_STEP_TYPE,
    createSequenceStepId
} from '../js/presentation/presentation-sequence-compiler.js';

const cameraConfig = { pitch: 45, bearing: 30, padding: 80 };
const mockMap = {
    getPitch: () => 45,
    getBearing: () => 30
};

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
        const compiled = compileAuthoringSteps(steps, { map: mockMap, cameraConfig });
        expect(compiled).toHaveLength(1);
        expect(compiled[0].type).toBe('flyToFeatureThenOrbit');
        expect(compiled[0].durationMs).toBe(20000);
        expect(compiled[0].options.flyDurationMs).toBe(8000);
        expect(compiled[0].options.orbitDurationMs).toBe(12000);
    });

    it('applies hold as delay on the next step', () => {
        const steps = [
            { id: 'h1', type: HOLD_STEP_TYPE, durationMs: 2000 },
            { id: 's1', type: 'rotateAroundFeature', durationMs: 6000 }
        ];
        const compiled = compileAuthoringSteps(steps, { map: mockMap, cameraConfig });
        expect(compiled).toHaveLength(1);
        expect(compiled[0].type).toBe('rotateAroundFeature');
        expect(compiled[0].delayMs).toBe(2000);
    });

    it('keeps separate steps when not a merge pair', () => {
        const steps = [
            { id: 's1', type: 'flyToFeature', durationMs: 8000 },
            { id: 's2', type: 'animateLinePath', durationMs: 10000 }
        ];
        const compiled = compileAuthoringSteps(steps, { map: mockMap, cameraConfig });
        expect(compiled).toHaveLength(2);
        expect(compiled[0].type).toBe('flyToFeature');
        expect(compiled[1].type).toBe('animateLinePath');
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
});
