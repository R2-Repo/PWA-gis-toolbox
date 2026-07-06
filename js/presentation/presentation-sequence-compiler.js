/**
 * Compiles user-authored animation sequences into timeline playback steps
 * with cinematic merges, smart overlap defaults, and sequential bridging.
 */

import { createAnimationStep } from './animation-presets.js';
import {
    applyLinkAnimationCameraStrategy,
    getLinkAnimation
} from './presentation-link-animations.js';

export const HOLD_STEP_TYPE = 'hold';
export const MAX_SEQUENCE_STEPS = 5;

/** @typedef {'overlap' | 'sequential'} TimelineMode */

/** @typedef {{ id: string, type: string, durationMs: number }} AuthoringStep */

/**
 * @typedef {object} CompiledTimelineStep
 * @property {string} id
 * @property {string} type
 * @property {string} label
 * @property {number} startAtMs
 * @property {number} durationMs
 * @property {TimelineMode} timelineMode
 * @property {string} [overlapHint]
 */

/**
 * @typedef {object} CompiledTimeline
 * @property {CompiledTimelineStep[]} steps
 * @property {number} totalDurationMs
 */

/** Animation types that drive the camera — only one should run at a time unless merged. */
export const CAMERA_STEP_TYPES = new Set([
    'flyToFeature',
    'rotateAroundFeature',
    'flyToFeatureThenOrbit',
    'flyAlongPath',
    'animatePointAlongLine'
]);

/**
 * Smart overlap defaults: fraction of previous step duration when next step starts.
 * @type {Record<string, Record<string, number>>}
 */
export const OVERLAP_PAIR_RULES = {
    flyToFeature: {
        animateLinePath: 0.5,
        animatePoint: 0.6
    },
    rotateAroundFeature: {
        animateLinePath: 0.7
    }
};

/** @returns {number | null} overlap fraction 0–1, or null for sequential */
export function getOverlapFraction(previousType, nextType) {
    if (CAMERA_STEP_TYPES.has(previousType) && CAMERA_STEP_TYPES.has(nextType)) {
        return null;
    }
    const rule = OVERLAP_PAIR_RULES[previousType]?.[nextType];
    return rule ?? null;
}

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
function buildBaseStepOptions(ctx, timelineOptions = {}) {
    return {
        pitch: ctx.map?.getPitch?.() ?? ctx.cameraConfig.pitch,
        bearing: ctx.map?.getBearing?.() ?? ctx.cameraConfig.bearing,
        padding: ctx.cameraConfig.padding,
        entryFromCurrent: true,
        ...timelineOptions
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
 * @param {string} previousType
 * @param {string} nextType
 */
function buildOverlapHint(previousType, nextType, fraction) {
    const prevLabel = getLinkAnimation(previousType).label;
    const nextLabel = getLinkAnimation(nextType).label;
    const pct = Math.round(fraction * 100);
    if (pct <= 50) {
        return `${nextLabel} starts halfway through ${prevLabel}.`;
    }
    if (pct >= 70) {
        return `${nextLabel} starts near the end of ${prevLabel}.`;
    }
    return `${nextLabel} starts ${pct}% through ${prevLabel}.`;
}

/**
 * @typedef {object} CompileUnit
 * @property {string} id
 * @property {string} type
 * @property {number} durationMs
 * @property {number} holdBeforeMs
 * @property {object} stepOptions
 */

/**
 * @param {AuthoringStep[]} authoringSteps
 * @param {object} ctx
 * @returns {CompileUnit[]}
 */
function buildCompileUnits(authoringSteps, ctx) {
    /** @type {CompileUnit[]} */
    const units = [];
    let pendingHoldMs = 0;
    const steps = authoringSteps || [];

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step) continue;

        if (step.type === HOLD_STEP_TYPE) {
            pendingHoldMs += step.durationMs ?? 0;
            continue;
        }

        const next = steps[i + 1];
        const holdBeforeMs = pendingHoldMs;
        pendingHoldMs = 0;

        if (isMergeFlyOrbit(step, next)) {
            const flyDurationMs = step.durationMs;
            const orbitDurationMs = next.durationMs;
            units.push({
                id: step.id,
                type: 'flyToFeatureThenOrbit',
                durationMs: flyDurationMs + orbitDurationMs,
                holdBeforeMs,
                stepOptions: {
                    ...buildBaseStepOptions(ctx, { bridgeBefore: false, timelineMode: 'sequential' }),
                    flyDurationMs,
                    orbitDurationMs
                }
            });
            i += 1;
            continue;
        }

        const definition = getLinkAnimation(step.type);
        let stepOptions = buildBaseStepOptions(ctx);
        if (definition.extendStepOptions) {
            stepOptions = definition.extendStepOptions(stepOptions, {
                durationMs: step.durationMs,
                presetId: step.type
            });
        }

        units.push({
            id: step.id,
            type: step.type,
            durationMs: step.durationMs,
            holdBeforeMs,
            stepOptions
        });
    }

    return units;
}

/**
 * Assign startAtMs and timeline metadata to compile units.
 * @param {CompileUnit[]} units
 * @returns {{ units: CompileUnit[], timelineSteps: CompiledTimelineStep[], totalDurationMs: number }}
 */
function assignTimelineMetadata(units) {
    /** @type {CompiledTimelineStep[]} */
    const timelineSteps = [];
    let totalDurationMs = 0;

    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const prev = i > 0 ? units[i - 1] : null;
        const prevTimeline = i > 0 ? timelineSteps[i - 1] : null;
        let startAtMs = 0;
        /** @type {TimelineMode} */
        let timelineMode = 'sequential';
        let bridgeBefore = i > 0;
        let overlapHint;

        if (i === 0) {
            startAtMs = unit.holdBeforeMs;
        } else if (unit.holdBeforeMs > 0) {
            startAtMs = prevTimeline.startAtMs + prev.durationMs + unit.holdBeforeMs;
            timelineMode = 'sequential';
            bridgeBefore = true;
        } else {
            const overlap = getOverlapFraction(prev.type, unit.type);
            if (overlap != null) {
                startAtMs = prevTimeline.startAtMs + Math.round(prev.durationMs * overlap);
                timelineMode = 'overlap';
                bridgeBefore = false;
                overlapHint = buildOverlapHint(prev.type, unit.type, overlap);
            } else {
                startAtMs = prevTimeline.startAtMs + prev.durationMs;
                timelineMode = 'sequential';
                bridgeBefore = true;
            }
        }

        unit.stepOptions = {
            ...unit.stepOptions,
            bridgeBefore,
            timelineMode
        };
        unit.startAtMs = startAtMs;

        const label = getLinkAnimation(unit.type).label;
        timelineSteps.push({
            id: unit.id,
            type: unit.type,
            label,
            startAtMs,
            durationMs: unit.durationMs,
            timelineMode,
            overlapHint
        });

        totalDurationMs = Math.max(totalDurationMs, startAtMs + unit.durationMs);
    }

    return { units, timelineSteps, totalDurationMs };
}

/**
 * @param {AuthoringStep[]} authoringSteps
 * @param {object} ctx
 * @returns {import('./presentation-scene-schema.js').PresentationAnimationStep[]}
 */
export function compileAuthoringSteps(authoringSteps, ctx) {
    const rawUnits = buildCompileUnits(authoringSteps, ctx);
    const { units } = assignTimelineMetadata(rawUnits);

    return units.map((unit) => createAnimationStep(unit.type, {
        id: unit.id,
        durationMs: unit.durationMs,
        delayMs: 0,
        startAtMs: unit.startAtMs,
        easing: 'cinematic',
        loop: false,
        stepOptions: unit.stepOptions
    }));
}

/**
 * @param {AuthoringStep[]} authoringSteps
 * @param {object} [ctx]
 * @returns {CompiledTimeline}
 */
export function compilePreviewTimeline(authoringSteps, ctx = {}) {
    const rawUnits = buildCompileUnits(authoringSteps, ctx);
    const { timelineSteps, totalDurationMs } = assignTimelineMetadata(rawUnits);
    return { steps: timelineSteps, totalDurationMs };
}

/**
 * @param {AuthoringStep[]} authoringSteps
 * @param {number} stepIndex index in authoring steps array
 * @param {object} [ctx]
 * @returns {string | null}
 */
export function getOverlapHintForStep(authoringSteps, stepIndex, ctx = {}) {
    const timeline = compilePreviewTimeline(authoringSteps, ctx);
    const step = authoringSteps?.[stepIndex];
    if (!step || step.type === HOLD_STEP_TYPE) return null;

    const compiled = timeline.steps.find((entry) => entry.id === step.id);
    return compiled?.overlapHint ?? null;
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep[]} animations
 */
export function estimateTimelineDurationMs(animations = []) {
    if (!animations?.length) return 0;
    if (animations.some((step) => step.startAtMs != null)) {
        return Math.max(
            0,
            ...animations.map((step) => (step.startAtMs ?? 0) + (step.durationMs ?? 0))
        );
    }
    let total = 0;
    for (const step of animations) {
        total += (step.delayMs ?? 0) + (step.durationMs ?? 0);
    }
    return total;
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
