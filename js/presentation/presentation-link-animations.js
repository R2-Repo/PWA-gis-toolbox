/**
 * Presentation Link — animation registry (single source of truth for the widget).
 *
 * To add a new animation, see docs/PRESENTATION_LINK_ANIMATIONS.md
 */

import { createAnimationStep } from './animation-presets.js';
import { computeFeatureFitCamera, computeOverviewCamera } from './animation-engine.js';
import { COMBO_FLY_RATIO } from './presentation-constants.js';

/** @typedef {'fit' | 'saved' | 'overview'} LinkCameraStrategy */

/** @typedef {'slow' | 'normal' | 'fast' | 'custom'} LinkPaceId */

/**
 * @typedef {object} LinkAnimationUi
 * @property {boolean} showDuration
 * @property {string} [durationLabel]
 * @property {number} [defaultDurationMs]
 * @property {boolean} [showPace]
 * @property {string} [paceLabel]
 * @property {Record<LinkPaceId, number>} [pacePresetsMs]
 * @property {Record<'slow' | 'normal' | 'fast', string>} [paceOptionLabels]
 */

/**
 * @typedef {object} LinkAnimationDefinition
 * @property {string} id
 * @property {string} label
 * @property {string} usageHint
 * @property {string[]} requires
 * @property {LinkCameraStrategy} cameraStrategy
 * @property {boolean} animated
 * @property {LinkAnimationUi} ui
 * @property {(stepOptions: object, animation: object) => object} [extendStepOptions]
 * @property {(animation: object) => number} [resolveDurationMs]
 */

export const ORBIT_PACE_MS = {
    slow: 20000,
    normal: 12000,
    fast: 6000
};

export const COMBO_PACE_MS = {
    slow: 36000,
    normal: 22000,
    fast: 12000
};

export { COMBO_FLY_RATIO };

/** @type {LinkAnimationDefinition[]} */
const LINK_ANIMATIONS = [
    {
        id: 'none',
        label: 'None — open framed on feature',
        usageHint: 'Pick one small feature. Turn on 3D and set pitch/bearing if you want a tilted final view. The link opens instantly framed on the feature — no animation.',
        requires: [],
        cameraStrategy: 'fit',
        animated: false,
        ui: {
            showDuration: false,
            defaultDurationMs: ORBIT_PACE_MS.normal
        }
    },
    {
        id: 'flyToFeature',
        label: 'Fly to feature',
        usageHint: 'Pick one small feature. Turn on 3D and set pitch/bearing for the final view. The link opens top-down and zoomed out, then slowly pitches down and zooms in together over your chosen duration.',
        requires: ['any'],
        cameraStrategy: 'overview',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Duration (seconds)',
            defaultDurationMs: ORBIT_PACE_MS.normal
        }
    },
    {
        id: 'rotateAroundFeature',
        label: 'Orbit around feature',
        usageHint: 'Pick one small feature. Turn on 3D and frame the feature at the angle and elevation you want. The link opens on your current view, then slowly rotates around it at your chosen pace.',
        requires: ['any'],
        cameraStrategy: 'saved',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Duration (seconds)',
            defaultDurationMs: ORBIT_PACE_MS.normal,
            showPace: true,
            paceLabel: 'Orbit pace',
            pacePresetsMs: ORBIT_PACE_MS,
            paceOptionLabels: {
                slow: 'Cinematic (20s)',
                normal: 'Normal (12s)',
                fast: 'Quick (6s)'
            }
        },
        resolveDurationMs: (animation) => animation.durationMs ?? ORBIT_PACE_MS.normal
    },
    {
        id: 'flyToFeatureThenOrbit',
        label: 'Fly in, then orbit',
        usageHint: 'Pick one small feature. Turn on 3D and set pitch/bearing for the final view. The link opens top-down, pitches down and zooms in, then seamlessly orbits the feature. Use pace to control overall timing.',
        requires: ['any'],
        cameraStrategy: 'overview',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Total duration (seconds)',
            defaultDurationMs: COMBO_PACE_MS.normal,
            showPace: true,
            paceLabel: 'Pace (fly + orbit)',
            pacePresetsMs: COMBO_PACE_MS,
            paceOptionLabels: {
                slow: 'Cinematic (36s)',
                normal: 'Normal (22s)',
                fast: 'Quick (12s)'
            }
        },
        resolveDurationMs: (animation) => animation.durationMs ?? COMBO_PACE_MS.normal,
        extendStepOptions(stepOptions, animation) {
            const totalMs = animation.durationMs ?? COMBO_PACE_MS.normal;
            const { flyDurationMs, orbitDurationMs } = splitComboDurations(totalMs);
            return { ...stepOptions, flyDurationMs, orbitDurationMs };
        }
    },
    {
        id: 'animateLinePath',
        label: 'Draw route',
        usageHint: 'Pick a line feature. The route draws progressively from start to end over your chosen duration.',
        requires: ['line'],
        cameraStrategy: 'fit',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Duration (seconds)',
            defaultDurationMs: ORBIT_PACE_MS.normal
        }
    },
    {
        id: 'flyAlongPath',
        label: 'Follow path',
        usageHint: 'Pick a line feature. The camera travels along the path at your chosen duration.',
        requires: ['line'],
        cameraStrategy: 'fit',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Duration (seconds)',
            defaultDurationMs: ORBIT_PACE_MS.normal
        }
    },
    {
        id: 'animatePointAlongLine',
        label: 'Travel along path',
        usageHint: 'Pick a line feature. A marker travels along the path while the camera follows.',
        requires: ['line'],
        cameraStrategy: 'fit',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Duration (seconds)',
            defaultDurationMs: ORBIT_PACE_MS.normal
        }
    },
    {
        id: 'animatePoint',
        label: 'Pulse point',
        usageHint: 'Pick one or more point features. Selected points pulse to draw attention over your chosen duration.',
        requires: ['point'],
        cameraStrategy: 'fit',
        animated: true,
        ui: {
            showDuration: true,
            durationLabel: 'Duration (seconds)',
            defaultDurationMs: ORBIT_PACE_MS.normal
        }
    }
];

/** Hold/pause row for custom sequences only — not a playback handler. */
const HOLD_STEP_DEFINITION = {
    id: 'hold',
    label: 'Hold / pause',
    usageHint: 'Pause between animations.',
    requires: [],
    cameraStrategy: 'saved',
    animated: false,
    sequenceOnly: true,
    ui: {
        showDuration: true,
        durationLabel: 'Hold (seconds)',
        defaultDurationMs: 2000
    }
};

/**
 * @param {number} totalMs
 */
export function splitComboDurations(totalMs) {
    const flyDurationMs = Math.round(totalMs * COMBO_FLY_RATIO);
    return {
        totalMs,
        flyDurationMs,
        orbitDurationMs: totalMs - flyDurationMs
    };
}

export function listLinkAnimations() {
    return LINK_ANIMATIONS;
}

/** Animated presets plus hold — for custom sequence builder rows. */
export function listSequenceStepOptions() {
    return [...LINK_ANIMATIONS.filter((entry) => entry.id !== 'none' && entry.id !== 'flyToFeatureThenOrbit'), HOLD_STEP_DEFINITION];
}

/**
 * @param {string} stepType
 */
export function getSequenceStepDefinition(stepType) {
    if (stepType === 'hold') return HOLD_STEP_DEFINITION;
    return getLinkAnimation(stepType);
}

/**
 * @param {string} presetId
 * @returns {LinkAnimationDefinition}
 */
export function getLinkAnimation(presetId) {
    return LINK_ANIMATIONS.find((entry) => entry.id === presetId) || LINK_ANIMATIONS[0];
}

/**
 * @param {LinkAnimationDefinition} definition
 * @param {LinkPaceId} pace
 */
export function getDurationMsForPace(definition, pace) {
    if (pace === 'custom') return definition.ui.defaultDurationMs;
    return definition.ui.pacePresetsMs?.[pace] ?? definition.ui.defaultDurationMs;
}

/**
 * @param {object} cameraConfig
 * @param {string} presetId
 * @param {object} ctx
 * @param {import('geojson').FeatureCollection} ctx.features
 * @param {import('maplibre-gl').Map} [ctx.map]
 */
export function applyLinkAnimationCameraStrategy(cameraConfig, presetId, ctx) {
    const definition = getLinkAnimation(presetId);
    if (definition.cameraStrategy === 'fit') {
        cameraConfig.fitToFeatures = true;
        return;
    }
    if (definition.cameraStrategy === 'saved') {
        return;
    }
    if (definition.cameraStrategy === 'overview') {
        const targetFit = ctx.map
            ? computeFeatureFitCamera(ctx.map, ctx.features, {
                padding: cameraConfig.padding,
                pitch: ctx.map.getPitch?.() ?? cameraConfig.pitch,
                bearing: ctx.map.getBearing?.() ?? cameraConfig.bearing
            })
            : null;
        const overview = computeOverviewCamera(ctx.features, {
            map: ctx.map,
            padding: 120,
            bearing: cameraConfig.bearing,
            targetZoom: targetFit?.zoom
        });
        if (overview) {
            cameraConfig.fitToFeatures = false;
            cameraConfig.center = overview.center;
            cameraConfig.zoom = overview.zoom;
            cameraConfig.pitch = overview.pitch;
            cameraConfig.bearing = overview.bearing;
        }
    }
}

/**
 * @param {string} presetId
 * @param {object} animation form animation state
 * @param {object} ctx
 * @param {import('maplibre-gl').Map} [ctx.map]
 * @param {object} ctx.cameraConfig
 */
export function buildLinkAnimationStep(presetId, animation, ctx) {
    const definition = getLinkAnimation(presetId);
    if (!definition.animated) return null;

    const durationMs = definition.resolveDurationMs
        ? definition.resolveDurationMs(animation)
        : (animation.durationMs ?? definition.ui.defaultDurationMs);

    let stepOptions = {
        pitch: ctx.map?.getPitch?.() ?? ctx.cameraConfig.pitch,
        bearing: ctx.map?.getBearing?.() ?? ctx.cameraConfig.bearing,
        padding: ctx.cameraConfig.padding
    };

    if (definition.extendStepOptions) {
        stepOptions = definition.extendStepOptions(stepOptions, { ...animation, durationMs });
    }

    return createAnimationStep(presetId, {
        durationMs,
        delayMs: 0,
        easing: 'cinematic',
        loop: false,
        stepOptions
    });
}
