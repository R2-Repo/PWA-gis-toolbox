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

async function resolveSourceBundle(ctx) {
    const presentationCtx = buildPresentationContext(ctx);
    const features = await collectSourceFeatures(presentationCtx);
    const geometrySummary = summarizeSourceFeatures(features);
    const sourceSummary = {
        ...summarizeResolvedSource(presentationCtx, features),
        geometryTypes: geometrySummary.geometryTypes,
        vertexCount: geometrySummary.vertexCount
    };
    return { features, sourceSummary };
}

function buildDefaultFormState(sourceSummary) {
    return {
        animation: {
            presetId: 'flyToFeature',
            durationMs: 3000
        },
        sourceSummary
    };
}

export async function openPresentationLinkBuilder(ctx) {
    await openReactIsland({
        title: 'Presentation Link',
        width: '420px',
        mountPath: '../../../react/widgets/mountPresentationLinkBuilder.jsx',
        mountExport: 'mountPresentationLinkBuilder',
        getProps: (close) => ({
            loadInitialState: async () => {
                const { sourceSummary } = await resolveSourceBundle(ctx);
                return buildDefaultFormState(sourceSummary);
            },
            onRefreshSource: () => resolveSourceBundle(ctx),
            onBuildScene: async (formState) => {
                const { features } = await resolveSourceBundle(ctx);
                const scene = buildSceneFromConfig({
                    features,
                    map: ctx.mapService.getMap(),
                    animation: formState.animation
                });
                const validation = validateSceneForUrl(scene);
                return {
                    scene,
                    validation,
                    url: validation.ok ? getPresentationUrl(scene) : null,
                    compatiblePresets: getCompatiblePresets(features),
                    sourceSummary: summarizeResolvedSource(buildPresentationContext(ctx), features)
                };
            },
            onPickFeature: async () => {
                const picked = await ctx.mapService.startPresentationFeaturePick?.(
                    'Click the feature you want in the presentation'
                );
                if (!picked) return null;
                ctx.showToast(`Using feature from ${picked.layerName || 'map'}`, 'success');
                return resolveSourceBundle(ctx);
            },
            onPreview: async (formState) => {
                stopPreview(ctx);
                const { features } = await resolveSourceBundle(ctx);
                const scene = buildSceneFromConfig({
                    features,
                    map: ctx.mapService.getMap(),
                    animation: formState.animation
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
                ctx.showToast('Preview finished', 'success');
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
