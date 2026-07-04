import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getActiveLayer } from '../../core/state.js';
import drawManager from '../../map/draw-manager.js';
import { PresentationAnimationEngine } from '../../presentation/animation-engine.js';
import {
    buildSceneFromConfig,
    collectSourceFeatures,
    getCompatiblePresets,
    getPresentationUrl,
    summarizeResolvedSource,
    summarizeSourceFeatures,
    validateSceneForUrl
} from './engine.js';

let previewRuntime = null;

function buildPresentationContext(ctx) {
    return {
        ...ctx,
        getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
        getActiveLayer
    };
}

function stopPreview(ctx) {
    previewRuntime?.engine?.stop();
    previewRuntime?.engine?.cleanup();
    previewRuntime = null;
    ctx.mapService?.clearTempFeatures?.();
}

async function resolveSourceBundle(ctx, sourceMode) {
    const presentationCtx = buildPresentationContext(ctx);
    const features = await collectSourceFeatures(presentationCtx, sourceMode);
    const geometrySummary = summarizeSourceFeatures(features);
    const sourceSummary = {
        ...summarizeResolvedSource(presentationCtx, features),
        geometryTypes: geometrySummary.geometryTypes,
        vertexCount: geometrySummary.vertexCount
    };
    return { features, sourceSummary };
}

export async function openPresentationLinkBuilder(ctx, options = {}) {
    await openReactIsland({
        title: 'Presentation Link',
        width: '480px',
        mountPath: '../../../react/widgets/mountPresentationLinkBuilder.jsx',
        mountExport: 'mountPresentationLinkBuilder',
        getProps: (close) => ({
            loadInitialState: async () => {
                const sourceMode = 'selection';
                const { sourceSummary } = await resolveSourceBundle(ctx, sourceMode);
                return {
                    sourceMode,
                    sourceSummary,
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
            onSourceModeChange: async (sourceMode) => resolveSourceBundle(ctx, sourceMode),
            onBuildScene: async (formState) => {
                const { features } = await resolveSourceBundle(ctx, formState.sourceMode);
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
                const { features } = await resolveSourceBundle(ctx, formState.sourceMode);
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
            onSubscribeSourceRefresh: (callback) => {
                const refresh = () => { void callback(); };
                const events = ['selection:changed', 'layers:changed', 'layer:active', 'layer:updated'];
                events.forEach((event) => bus.on(event, refresh));
                return () => events.forEach((event) => bus.off(event, refresh));
            },
            onResetPreview: () => stopPreview(ctx),
            onCancel: () => {
                stopPreview(ctx);
                close();
            }
        })
    });
}
