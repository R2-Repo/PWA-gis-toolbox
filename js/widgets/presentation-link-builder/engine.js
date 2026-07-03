import { createDefaultScene } from '../../presentation/presentation-scene-schema.js';
import { buildPresentationUrl, estimateEncodedSceneLength } from '../../presentation/presentation-scene-codec.js';
import { summarizeFeatures, validatePresentationFeatures } from '../../presentation/scene-validation.js';
import { createAnimationStep, getAnimationPreset, isPresetCompatible } from '../../presentation/animation-presets.js';

export const SOURCE_MODES = [
    { id: 'selection', label: 'Current selected feature(s)' },
    { id: 'drawn', label: 'Current drawn feature' },
    { id: 'active-layer-selection', label: 'Active layer selected feature(s)' }
];

/**
 * @param {import('geojson').Feature} feature
 */
export function cloneFeature(feature) {
    return JSON.parse(JSON.stringify(feature));
}

/**
 * @param {import('geojson').Feature[]} features
 */
export function toFeatureCollection(features = []) {
    return {
        type: 'FeatureCollection',
        features: features.map(cloneFeature)
    };
}

/**
 * @param {object} ctx
 * @param {'selection'|'drawn'|'active-layer-selection'} sourceMode
 */
export function collectSourceFeatures(ctx, sourceMode) {
    const features = [];

    if (sourceMode === 'drawn') {
        const drawn = ctx.getDrawnFeature?.();
        if (drawn?.feature) features.push(drawn.feature);
        return toFeatureCollection(features);
    }

    const layers = ctx.getLayers?.() || [];
    const activeLayer = ctx.getActiveLayer?.() || layers.find((layer) => layer.id === ctx.mapService?.getActiveLayerId?.());

    if (sourceMode === 'active-layer-selection' && activeLayer?.geojson) {
        const selected = ctx.mapService?.getSelectedFeatures?.(activeLayer.id, activeLayer.geojson);
        return selected || toFeatureCollection([]);
    }

    for (const layer of layers) {
        if (!layer?.geojson) continue;
        const selected = ctx.mapService?.getSelectedFeatures?.(layer.id, layer.geojson);
        const count = selected?.features?.length || 0;
        if (count > 0) {
            features.push(...selected.features);
        }
    }

    return toFeatureCollection(features);
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
 * @param {import('geojson').FeatureCollection} config.features
 * @param {import('maplibre-gl').Map} [config.map]
 */
export function buildSceneFromConfig(config) {
    const {
        features,
        map,
        layout = {},
        camera = {},
        style = {},
        animation = {},
        metadata = {}
    } = config;

    const mapCenter = map?.getCenter?.();
    const cameraConfig = {
        useCurrent: camera.useCurrent !== false,
        fitToFeatures: !!camera.fitToFeatures,
        center: camera.center || (mapCenter ? [mapCenter.lng, mapCenter.lat] : [0, 0]),
        zoom: camera.zoom ?? map?.getZoom?.() ?? 14,
        pitch: camera.pitch ?? map?.getPitch?.() ?? 0,
        bearing: camera.bearing ?? map?.getBearing?.() ?? 0,
        padding: camera.padding ?? 80,
        resetNorth: !!camera.resetNorth,
        startDelayMs: camera.startDelayMs ?? 0
    };

    const animations = [];
    const presetId = animation.presetId || 'none';
    if (presetId !== 'none') {
        animations.push(createAnimationStep(presetId, {
            durationMs: animation.durationMs ?? 3000,
            delayMs: animation.delayMs ?? 0,
            easing: animation.easing || 'easeInOut',
            loop: !!animation.loop,
            stepOptions: {
                pitch: cameraConfig.pitch,
                bearing: cameraConfig.bearing,
                padding: cameraConfig.padding,
                followCamera: animation.followCamera !== false
            }
        }));
    }

    return createDefaultScene({
        layout,
        camera: cameraConfig,
        features,
        style,
        animations,
        metadata: {
            title: metadata.title || '',
            subtitle: metadata.subtitle || '',
            generatedAt: new Date().toISOString()
        }
    });
}

/**
 * @param {import('../../presentation/presentation-scene-schema.js').PresentationScene} scene
 */
export function validateSceneForUrl(scene) {
    return validatePresentationFeatures(scene.features, { sceneDraft: scene });
}

/**
 * @param {import('../../presentation/presentation-scene-schema.js').PresentationScene} scene
 */
export function getPresentationUrl(scene) {
    return buildPresentationUrl(scene);
}

export function getEstimatedUrlLength(scene) {
    return estimateEncodedSceneLength(scene);
}

export function getCompatiblePresets(features) {
    return ['none', 'flyToFeature', 'rotateAroundFeature', 'flyAlongPath', 'animatePointAlongLine', 'animatePoint', 'animateLinePath']
        .map((id) => ({
            ...getAnimationPreset(id),
            compatible: isPresetCompatible(features, id)
        }));
}
