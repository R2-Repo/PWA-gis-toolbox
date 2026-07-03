import { openReactIsland } from '../../ui/open-react-island.js';
import { getActiveLayer } from '../../core/state.js';
import drawManager from '../../map/draw-manager.js';
import { PresentationAnimationEngine } from '../../presentation/animation-engine.js';
import {
    buildSceneFromConfig,
    collectSourceFeatures,
    getCompatiblePresets,
    getPresentationUrl,
    summarizeSourceFeatures,
    validateSceneForUrl
} from './engine.js';

let previewRuntime = null;

function stopPreview(ctx) {
    previewRuntime?.engine?.stop();
    previewRuntime?.engine?.cleanup();
    previewRuntime = null;
    ctx.mapService?.clearTempFeatures?.();
}

export async function openPresentationLinkBuilder(ctx, options = {}) {
    await openReactIsland({
        title: 'Presentation Link',
        width: '480px',
        mountPath: '../../../react/widgets/mountPresentationLinkBuilder.jsx',
        mountExport: 'mountPresentationLinkBuilder',
        getProps: (close) => ({
            getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
            getActiveLayer,
            getInitialState: () => {
                const sourceMode = 'selection';
                const features = collectSourceFeatures({
                    ...ctx,
                    getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
                    getActiveLayer
                }, sourceMode);
                return {
                    sourceMode,
                    sourceSummary: summarizeSourceFeatures(features),
                    layout: {
                        showLogo: true,
                        showHomeButton: true
                    },
                    camera: {
                        useCurrent: true,
                        fitToFeatures: true,
                        pitch: ctx.mapService.getMap()?.getPitch?.() ?? 45,
                        bearing: ctx.mapService.getMap()?.getBearing?.() ?? 0,
                        padding: 80,
                        resetNorth: false,
                        startDelayMs: 0
                    },
                    animation: {
                        presetId: 'flyToFeature',
                        durationMs: 3000,
                        delayMs: 0,
                        easing: 'easeInOut',
                        loop: false
                    },
                    metadata: {
                        title: '',
                        subtitle: ''
                    }
                };
            },
            onSourceModeChange: (sourceMode) => {
                const features = collectSourceFeatures({
                    ...ctx,
                    getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
                    getActiveLayer
                }, sourceMode);
                return {
                    features,
                    sourceSummary: summarizeSourceFeatures(features)
                };
            },
            onBuildScene: (formState) => {
                const features = collectSourceFeatures({
                    ...ctx,
                    getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
                    getActiveLayer
                }, formState.sourceMode);
                const scene = buildSceneFromConfig({
                    features,
                    map: ctx.mapService.getMap(),
                    layout: {
                        showLogo: formState.layout?.showLogo !== false,
                        showHomeButton: formState.layout?.showHomeButton !== false
                    },
                    camera: formState.camera,
                    style: {},
                    animation: formState.animation,
                    metadata: formState.metadata
                });
                const validation = validateSceneForUrl(scene);
                return {
                    scene,
                    validation,
                    url: validation.ok ? getPresentationUrl(scene) : null,
                    compatiblePresets: getCompatiblePresets(features)
                };
            },
            onPreview: async (formState) => {
                stopPreview(ctx);
                const features = collectSourceFeatures({
                    ...ctx,
                    getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
                    getActiveLayer
                }, formState.sourceMode);
                const scene = buildSceneFromConfig({
                    features,
                    map: ctx.mapService.getMap(),
                    layout: formState.layout,
                    camera: formState.camera,
                    animation: formState.animation,
                    metadata: formState.metadata
                });
                const validation = validateSceneForUrl(scene);
                if (!validation.ok) {
                    throw new Error(validation.tooLargeMessage || validation.errors[0]);
                }

                const map = ctx.mapService.getMap();
                if (!map) throw new Error('Map is not ready');

                ctx.mapService.showTempFeature(scene.features, 0);
                const engine = new PresentationAnimationEngine({
                    map,
                    features: scene.features,
                    style: scene.style
                });
                previewRuntime = { engine };
                await engine.applyCamera(scene.camera);
                if (scene.animations?.length) {
                    await engine.playSequence(scene.animations);
                }
                ctx.showToast('Presentation preview finished', 'success');
            },
            onCopyUrl: async (url) => {
                await navigator.clipboard.writeText(url);
                ctx.showToast('Presentation URL copied', 'success');
            },
            onResetPreview: () => stopPreview(ctx),
            onCancel: () => {
                stopPreview(ctx);
                close();
            }
        })
    });
}
