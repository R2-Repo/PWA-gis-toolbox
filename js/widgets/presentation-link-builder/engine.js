import { createDefaultScene } from '../../presentation/presentation-scene-schema.js';
import { buildPresentationUrl, estimateEncodedSceneLength } from '../../presentation/presentation-scene-codec.js';
import { summarizeFeatures, validatePresentationFeatures } from '../../presentation/scene-validation.js';
import { createAnimationStep, getAnimationPreset, isPresetCompatible } from '../../presentation/animation-presets.js';

export { cloneFeature, toFeatureCollection } from './source-features.js';
export {
    collectSourceFeatures,
    summarizeResolvedSource
} from './source-features.js';

export const SIMPLE_ANIMATION_OPTIONS = [
    { id: 'none', label: 'None — open on feature' },
    { id: 'flyToFeature', label: 'Fly to feature' },
    { id: 'rotateAroundFeature', label: 'Orbit around feature' }
];

/**
 * @param {import('geojson').FeatureCollection} features
 */
export function summarizeSourceFeatures(features) {
    const summary = summarizeFeatures(features);
    return {
        ...summary,
        isEmpty: summary.featureCount === 0
    };
}

/**
 * @param {object} config
 */
export function buildSceneFromConfig(config) {
    const {
        features,
        map,
        animation = {}
    } = config;

    const mapCenter = map?.getCenter?.();
    const cameraConfig = {
        useCurrent: false,
        fitToFeatures: true,
        center: mapCenter ? [mapCenter.lng, mapCenter.lat] : [0, 0],
        zoom: map?.getZoom?.() ?? 14,
        pitch: map?.getPitch?.() ?? 45,
        bearing: map?.getBearing?.() ?? 0,
        padding: 80,
        resetNorth: false,
        startDelayMs: 0
    };

    const animations = [];
    const presetId = animation.presetId || 'flyToFeature';
    if (presetId !== 'none') {
        animations.push(createAnimationStep(presetId, {
            durationMs: animation.durationMs ?? 3000,
            delayMs: 0,
            easing: 'easeInOut',
            loop: false,
            stepOptions: {
                pitch: cameraConfig.pitch,
                bearing: cameraConfig.bearing,
                padding: cameraConfig.padding
            }
        }));
    }

    return createDefaultScene({
        camera: cameraConfig,
        features,
        animations,
        metadata: {
            generatedAt: new Date().toISOString()
        }
    });
}

export function validateSceneForUrl(scene) {
    return validatePresentationFeatures(scene.features, { sceneDraft: scene });
}

export function getPresentationUrl(scene) {
    return buildPresentationUrl(scene);
}

export function getEstimatedUrlLength(scene) {
    return estimateEncodedSceneLength(scene);
}

export function getCompatiblePresets(features) {
    return SIMPLE_ANIMATION_OPTIONS.map((option) => ({
        ...getAnimationPreset(option.id),
        ...option,
        compatible: isPresetCompatible(features, option.id)
    }));
}
