/**
 * Compiles user-authored animation sequences into playback steps with cinematic merges.
 */

import { createAnimationStep } from './animation-presets.js';
import {
    applyLinkAnimationCameraStrategy,
    getLinkAnimation
} from './presentation-link-animations.js';

export const HOLD_STEP_TYPE = 'hold';
export const MAX_SEQUENCE_STEPS = 5;

/** @typedef {{ id: string, type: string, durationMs: number }} AuthoringStep */

export function createSequenceStepId() {
    return `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** @returns {AuthoringStep[]} */
export function defaultSequenceSteps() {
    return [{
        id: createSequenceStepId(),
        type: 'flyToFeature',
        durationMs: 8000
    }];
}

/**
 * @param {object} ctx
 * @param {import('maplibre-gl').Map} [ctx.map]
 * @param {object} ctx.cameraConfig
 */
function buildBaseStepOptions(ctx) {
    return {
        pitch: ctx.map?.getPitch?.() ?? ctx.cameraConfig.pitch,
        bearing: ctx.map?.getBearing?.() ?? ctx.cameraConfig.bearing,
        padding: ctx.cameraConfig.padding
    };
}

/**
 * @param {AuthoringStep | undefined} current
 * @param {AuthoringStep | undefined} next
 */
function isMergeFlyOrbit(current, next) {
    return current?.type === 'flyToFeature' && next?.type === 'rotateAroundFeature';
}

/**
 * @param {AuthoringStep[]} authoringSteps
 * @param {object} ctx
 * @returns {import('./presentation-scene-schema.js').PresentationAnimationStep[]}
 */
export function compileAuthoringSteps(authoringSteps, ctx) {
    const compiled = [];
    let pendingDelayMs = 0;
    const steps = authoringSteps || [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;

        if (step.type === HOLD_STEP_TYPE) {
            pendingDelayMs += step.durationMs ?? 0;
            continue;
        }

        const next = steps[i + 1];
        const baseOptions = buildBaseStepOptions(ctx);

        if (isMergeFlyOrbit(step, next)) {
            const flyDurationMs = step.durationMs;
            const orbitDurationMs = next.durationMs;
            compiled.push(createAnimationStep('flyToFeatureThenOrbit', {
                id: step.id,
                durationMs: flyDurationMs + orbitDurationMs,
                delayMs: pendingDelayMs,
                easing: 'cinematic',
                loop: false,
                stepOptions: {
                    ...baseOptions,
                    flyDurationMs,
                    orbitDurationMs
                }
            }));
            pendingDelayMs = 0;
            i += 1;
            continue;
        }

        const definition = getLinkAnimation(step.type);
        let stepOptions = { ...baseOptions };
        if (definition.extendStepOptions) {
            stepOptions = definition.extendStepOptions(stepOptions, {
                durationMs: step.durationMs,
                presetId: step.type
            });
        }

        compiled.push(createAnimationStep(step.type, {
            id: step.id,
            durationMs: step.durationMs,
            delayMs: pendingDelayMs,
            easing: 'cinematic',
            loop: false,
            stepOptions
        }));
        pendingDelayMs = 0;
    }

    return compiled;
}

/**
 * @param {AuthoringStep[]} authoringSteps
 */
export function resolveSequenceCameraPresetId(authoringSteps) {
    for (let i = 0; i < (authoringSteps || []).length; i++) {
        const step = authoringSteps[i];
        if (!step || step.type === HOLD_STEP_TYPE) continue;
        if (isMergeFlyOrbit(step, authoringSteps[i + 1])) {
            return 'flyToFeatureThenOrbit';
        }
        return step.type;
    }
    return 'none';
}

/**
 * @param {object} cameraConfig
 * @param {AuthoringStep[]} authoringSteps
 * @param {object} ctx
 */
export function applySequenceCameraStrategy(cameraConfig, authoringSteps, ctx) {
    const presetId = resolveSequenceCameraPresetId(authoringSteps);
    applyLinkAnimationCameraStrategy(cameraConfig, presetId, ctx);
}

/**
 * @param {AuthoringStep[]} steps
 */
export function countSequenceAuthoringSteps(steps) {
    return (steps || []).filter((step) => step?.type !== HOLD_STEP_TYPE).length
        + (steps || []).filter((step) => step?.type === HOLD_STEP_TYPE).length;
}
