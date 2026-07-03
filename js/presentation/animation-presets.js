/** @typedef {import('./presentation-scene-schema.js').PresentationAnimationStep} PresentationAnimationStep */

export const ANIMATION_PRESETS = [
    {
        id: 'none',
        label: 'None',
        description: 'Open to the saved camera without animation.',
        requires: []
    },
    {
        id: 'flyToFeature',
        label: 'Fly to feature',
        description: 'Fly or fit the camera to the selected feature bounds.',
        requires: ['any']
    },
    {
        id: 'rotateAroundFeature',
        label: 'Rotate around feature',
        description: 'Orbit the camera around the feature center.',
        requires: ['any']
    },
    {
        id: 'flyAlongPath',
        label: 'Fly along feature/path',
        description: 'Move the camera along a line path.',
        requires: ['line']
    },
    {
        id: 'animatePointAlongLine',
        label: 'Animate point along line',
        description: 'Move a point marker along a line over time.',
        requires: ['line']
    },
    {
        id: 'animatePoint',
        label: 'Animate point',
        description: 'Pulse or highlight a point feature.',
        requires: ['point']
    },
    {
        id: 'animateLinePath',
        label: 'Animate line/path/route',
        description: 'Draw the line progressively from start to end.',
        requires: ['line']
    }
];

const EASING_OPTIONS = [
    { id: 'linear', label: 'Linear' },
    { id: 'easeIn', label: 'Ease in' },
    { id: 'easeOut', label: 'Ease out' },
    { id: 'easeInOut', label: 'Ease in/out' }
];

/**
 * @param {string} presetId
 */
export function getAnimationPreset(presetId) {
    return ANIMATION_PRESETS.find((preset) => preset.id === presetId) || ANIMATION_PRESETS[0];
}

/**
 * @param {string} presetId
 * @param {object} [options]
 * @returns {PresentationAnimationStep}
 */
export function createAnimationStep(presetId, options = {}) {
    return {
        id: options.id || `step-${Date.now()}`,
        type: presetId,
        durationMs: options.durationMs ?? 3000,
        delayMs: options.delayMs ?? 0,
        easing: options.easing || 'easeInOut',
        target: options.target || 'allFeatures',
        loop: !!options.loop,
        options: options.stepOptions || {}
    };
}

export function listEasingOptions() {
    return EASING_OPTIONS;
}

/**
 * @param {import('geojson').FeatureCollection} features
 * @param {string} presetId
 */
export function isPresetCompatible(features, presetId) {
    const preset = getAnimationPreset(presetId);
    if (!preset.requires.length || preset.requires.includes('any')) return true;

    const types = new Set();
    for (const feature of features?.features || []) {
        const geomType = feature?.geometry?.type;
        if (!geomType) continue;
        if (geomType === 'Point' || geomType === 'MultiPoint') types.add('point');
        if (geomType === 'LineString' || geomType === 'MultiLineString') types.add('line');
        if (geomType === 'Polygon' || geomType === 'MultiPolygon') types.add('polygon');
    }

    if (preset.requires.includes('line')) return types.has('line');
    if (preset.requires.includes('point')) return types.has('point');
    return true;
}
