/**
 * Timeline playback for presentation animation sequences.
 * Schedules overlapping and sequential steps on a shared clock.
 */

import {
    computeFeatureFitCamera,
    getFeatureBounds,
    getFeatureCenter
} from './animation-engine.js';

const BRIDGE_MIN_MS = 400;
const BRIDGE_MAX_MS = 1200;
const BRIDGE_RATIO = 0.15;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepUntil(deadlineMs, shouldStop) {
    const remaining = deadlineMs - performance.now();
    if (remaining <= 0) return Promise.resolve();
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            clearInterval(interval);
            resolve();
        }, remaining);
        const interval = setInterval(() => {
            if (shouldStop()) {
                clearTimeout(timer);
                clearInterval(interval);
                resolve();
            }
        }, 50);
    });
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpBearing(from, to, t) {
    const delta = ((to - from + 540) % 360) - 180;
    return from + delta * t;
}

function cinematicEase(t) {
    const c = Math.min(1, Math.max(0, t));
    return c * c * (3 - 2 * c);
}

function registerRafId(engine, id) {
    if (!engine._rafIds) {
        engine._rafIds = new Set();
    }
    engine._rafIds.add(id);
    engine._rafId = id;
}

function camerasNearEnough(current, target) {
    const centerDelta = Math.hypot(
        current.center[0] - target.center[0],
        current.center[1] - target.center[1]
    );
    return centerDelta < 0.0008
        && Math.abs(current.zoom - target.zoom) < 0.15
        && Math.abs(current.pitch - target.pitch) < 3
        && Math.abs(((current.bearing - target.bearing + 540) % 360) - 180) < 5;
}

/**
 * @param {import('./animation-engine.js').PresentationAnimationEngine} engine
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep} step
 */
export function resolveStepEntryCamera(engine, step) {
    const map = engine.map;
    if (!map) return null;

    const padding = step.options?.padding ?? 80;
    const requestedPitch = step.options?.pitch;
    const targetPitch = (requestedPitch != null && requestedPitch > 5) ? requestedPitch : 55;
    const targetBearing = step.options?.bearing ?? map.getBearing();

    if (step.type === 'rotateAroundFeature') {
        const centerCoords = getFeatureCenter(engine.features);
        if (!centerCoords) return null;
        return {
            center: centerCoords,
            zoom: map.getZoom(),
            pitch: targetPitch,
            bearing: map.getBearing()
        };
    }

    if (step.type === 'flyAlongPath' || step.type === 'animatePointAlongLine') {
        const bounds = getFeatureBounds(engine.features);
        if (!bounds) return null;
        const fit = computeFeatureFitCamera(map, engine.features, {
            padding,
            pitch: Math.min(targetPitch, map.getPitch() || targetPitch),
            bearing: targetBearing
        });
        return fit ?? {
            center: [
                (bounds[0][0] + bounds[1][0]) / 2,
                (bounds[0][1] + bounds[1][1]) / 2
            ],
            zoom: map.getZoom(),
            pitch: map.getPitch(),
            bearing: targetBearing
        };
    }

    const fit = computeFeatureFitCamera(map, engine.features, {
        padding,
        pitch: targetPitch,
        bearing: targetBearing
    });
    if (!fit) return null;

    const featureCenter = getFeatureCenter(engine.features);
    if (featureCenter) {
        fit.center = featureCenter;
    }
    return fit;
}

/**
 * @param {import('./animation-engine.js').PresentationAnimationEngine} engine
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep} step
 */
export async function bridgeToStepEntry(engine, step) {
    const map = engine.map;
    if (!map || !step.options?.bridgeBefore) return;

    const target = resolveStepEntryCamera(engine, step);
    if (!target) return;

    const startCenter = map.getCenter();
    const current = {
        center: [startCenter.lng, startCenter.lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing()
    };

    if (camerasNearEnough(current, target)) return;

    const duration = Math.min(
        BRIDGE_MAX_MS,
        Math.max(BRIDGE_MIN_MS, Math.round((step.durationMs ?? 3000) * BRIDGE_RATIO))
    );

    await new Promise((resolve) => {
        const startTime = performance.now();
        const frame = (now) => {
            if (engine._stopped) {
                resolve();
                return;
            }
            const progress = Math.min(1, (now - startTime) / duration);
            const eased = cinematicEase(progress);

            const id = requestAnimationFrame(frame);
            registerRafId(engine, id);

            map.jumpTo({
                center: [
                    lerp(current.center[0], target.center[0], eased),
                    lerp(current.center[1], target.center[1], eased)
                ],
                zoom: lerp(current.zoom, target.zoom, eased),
                pitch: lerp(current.pitch, target.pitch, eased),
                bearing: lerpBearing(current.bearing, target.bearing, eased),
                essential: true
            });

            if (progress >= 1) {
                resolve();
            }
        };
        const id = requestAnimationFrame(frame);
        registerRafId(engine, id);
    });
}

/**
 * @param {import('./animation-engine.js').PresentationAnimationEngine} engine
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep[]} steps
 */
async function playSequenceLegacy(engine, steps = []) {
    for (const step of steps) {
        if (engine._stopped) return;
        if (step.delayMs > 0) {
            await sleep(step.delayMs);
            if (engine._stopped) return;
        }
        await engine.playStep(step);
        if (engine._stopped) return;
        if (!step.loop) continue;
        await engine.playStep(step);
    }
}

/**
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep[]} steps
 */
export function usesTimelinePlayback(steps = []) {
    return steps.some((step) => step.options?.timelineMode != null || step.startAtMs != null);
}

/**
 * @param {import('./animation-engine.js').PresentationAnimationEngine} engine
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep[]} steps
 */
export async function playTimeline(engine, steps = []) {
    if (!usesTimelinePlayback(steps)) {
        return playSequenceLegacy(engine, steps);
    }

    const sorted = [...steps].sort((a, b) => (a.startAtMs ?? 0) - (b.startAtMs ?? 0));
    const sequenceStart = performance.now();

    const runners = sorted.map((step) => (async () => {
        const startAtMs = step.startAtMs ?? 0;
        if (startAtMs > 0) {
            await sleepUntil(sequenceStart + startAtMs, () => engine._stopped);
        }
        if (engine._stopped) return;

        if (step.options?.bridgeBefore) {
            await bridgeToStepEntry(engine, step);
        }
        if (engine._stopped) return;

        await engine.playStep(step);
        if (engine._stopped) return;
        if (step.loop) {
            await engine.playStep(step);
        }
    })());

    await Promise.all(runners);
}
