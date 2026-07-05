import { createDefaultScene } from '../../presentation/presentation-scene-schema.js';
import { buildPresentationUrl, estimateEncodedSceneLength } from '../../presentation/presentation-scene-codec.js';
import { summarizeFeatures, validatePresentationFeatures } from '../../presentation/scene-validation.js';
import { getAnimationPreset, isPresetCompatible } from '../../presentation/animation-presets.js';
import {
    applyPresentationStyles,
    applyPresentationStylesPerLayer,
    deriveSceneStyleFallback,
    resolveLayerStyle
} from '../../presentation/presentation-style-capture.js';
import {
    listLinkAnimations,
    getLinkAnimation,
    applyLinkAnimationCameraStrategy,
    buildLinkAnimationStep,
    ORBIT_PACE_MS,
    COMBO_PACE_MS,
    COMBO_FLY_RATIO,
    splitComboDurations
} from '../../presentation/presentation-link-animations.js';
import {
    compileAuthoringSteps,
    applySequenceCameraStrategy
} from '../../presentation/presentation-sequence-compiler.js';
import { summarizeExportAvailability } from '../../presentation/presentation-export.js';

export { cloneFeature, toFeatureCollection } from './source-features.js';
export {
    buildLimitSummary,
    collectSourceFeatures,
    collectSourceFeaturesForLayer,
    collectSourceFeaturesForLayers,
    collectAllSelectedPresentationFeatures,
    listLayerIdsWithSelections,
    SCENE_LIMITS,
    summarizeResolvedSource
} from './source-features.js';

export {
    summarizeExportAvailability,
    validateSceneForExport,
    buildEmbedCode,
    getEmbedCodeForScene
} from '../../presentation/presentation-export.js';

export {
    ORBIT_PACE_MS,
    COMBO_PACE_MS,
    COMBO_FLY_RATIO,
    splitComboDurations,
    listLinkAnimations,
    getLinkAnimation
} from '../../presentation/presentation-link-animations.js';

/** @deprecated Use listLinkAnimations() — kept for existing imports */
export const SIMPLE_ANIMATION_OPTIONS = listLinkAnimations().map(({ id, label, usageHint }) => ({
    id,
    label,
    usageHint
}));

/**
 * @param {string} presetId
 * @deprecated Use getLinkAnimation(presetId)
 */
export function getSimpleAnimationOption(presetId) {
    const entry = getLinkAnimation(presetId);
    return { id: entry.id, label: entry.label, usageHint: entry.usageHint };
}

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
        mapService,
        layerId,
        layerIds,
        animation = {},
        probeLiveCamera = false
    } = config;

    const resolvedLayerIds = layerIds?.length
        ? layerIds
        : (layerId ? [layerId] : []);
    const hasPerLayerTags = (features?.features || []).some((f) => f?.properties?._plLayer);
    const styledFeatures = hasPerLayerTags
        ? applyPresentationStylesPerLayer(features, mapService)
        : applyPresentationStyles(features, resolveLayerStyle(mapService, resolvedLayerIds[0]));
    const primaryLayerStyle = resolvedLayerIds.length === 1
        ? resolveLayerStyle(mapService, resolvedLayerIds[0])
        : null;
    const presentationStyle = deriveSceneStyleFallback(primaryLayerStyle, styledFeatures);

    const mapCenter = map?.getCenter?.();
    const cameraConfig = {
        useCurrent: false,
        fitToFeatures: false,
        center: mapCenter ? [mapCenter.lng, mapCenter.lat] : [0, 0],
        zoom: map?.getZoom?.() ?? 14,
        pitch: map?.getPitch?.() ?? 45,
        bearing: map?.getBearing?.() ?? 0,
        padding: 80,
        resetNorth: false,
        startDelayMs: 0
    };

    const mapView = {
        basemap: mapService?.getCurrentBasemap?.() || 'voyager',
        enable3D: mapService?.is3DEnabled?.() ?? false
    };

    const animationMode = animation.mode || 'preset';
    const animations = [];

    const cameraCtx = {
        features: styledFeatures,
        map: probeLiveCamera ? map : null,
        cameraConfig
    };

    if (animationMode === 'sequence' && animation.steps?.length) {
        applySequenceCameraStrategy(cameraConfig, animation.steps, cameraCtx);
        animations.push(...compileAuthoringSteps(animation.steps, { map, cameraConfig }));
    } else {
        const presetId = animation.presetId || 'none';
        applyLinkAnimationCameraStrategy(cameraConfig, presetId, cameraCtx);
        const step = buildLinkAnimationStep(presetId, animation, { map, cameraConfig });
        if (step) animations.push(step);
    }

    const authoringMetadata = animationMode === 'sequence' && animation.steps?.length
        ? { mode: 'sequence', steps: animation.steps }
        : { mode: 'preset', presetId: animation.presetId || 'none' };

    return createDefaultScene({
        camera: cameraConfig,
        mapView,
        features: styledFeatures,
        style: presentationStyle,
        animations,
        metadata: {
            generatedAt: new Date().toISOString(),
            authoring: authoringMetadata
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
    return listLinkAnimations().map((entry) => ({
        ...getAnimationPreset(entry.id),
        id: entry.id,
        label: entry.label,
        usageHint: entry.usageHint,
        compatible: isPresetCompatible(features, entry.id)
    }));
}
