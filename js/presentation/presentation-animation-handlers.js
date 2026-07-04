/**
 * Maps presentation animation step types to PresentationAnimationEngine methods.
 * Register every engine-capable type here (widget + advanced presets).
 */

/** @type {Record<string, string>} */
export const PRESENTATION_ANIMATION_HANDLERS = {
    flyToFeature: '_flyToFeature',
    flyToFeatureThenOrbit: '_flyToFeatureThenOrbit',
    rotateAroundFeature: '_rotateAroundFeature',
    flyAlongPath: '_flyAlongPath',
    animatePointAlongLine: '_animatePointAlongLine',
    animatePoint: '_animatePoint',
    animateLinePath: '_animateLinePath'
};

/**
 * @param {import('./animation-engine.js').PresentationAnimationEngine} engine
 * @param {import('./presentation-scene-schema.js').PresentationAnimationStep} step
 */
export async function runPresentationAnimationStep(engine, step) {
    if (!step?.type || step.type === 'none') return;
    const methodName = PRESENTATION_ANIMATION_HANDLERS[step.type];
    const method = methodName ? engine[methodName] : null;
    if (typeof method !== 'function') return;
    return method.call(engine, step);
}

export function listRegisteredAnimationTypes() {
    return Object.keys(PRESENTATION_ANIMATION_HANDLERS);
}
