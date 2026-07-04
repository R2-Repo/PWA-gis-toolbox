import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getActiveLayer } from '../../core/state.js';
import drawManager from '../../map/draw-manager.js';
import { PresentationAnimationEngine } from '../../presentation/animation-engine.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    buildLimitSummary,
    buildSceneFromConfig,
    collectSourceFeaturesForLayer,
    getCompatiblePresets,
    getPresentationUrl,
    ORBIT_PACE_MS,
    SCENE_LIMITS,
    summarizeResolvedSource,
    summarizeSourceFeatures,
    validateSceneForUrl
} from './engine.js';

let previewRuntime = null;

function syncDimensionChrome(is3d) {
    bus.emit('map:chrome', { is3d: !!is3d });
}

function apply3DSelection(mapService, enabled) {
    if (enabled) mapService.enable3D();
    else mapService.disable3D();
    syncDimensionChrome(enabled);
}

function buildPresentationContext(ctx) {
    return {
        ...ctx,
        getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
        getActiveLayer
    };
}

function resolveLayerMeta(ctx, layerId) {
    const layer = (ctx.getLayers?.() || []).find((entry) => entry.id === layerId);
    return {
        layerId: layer?.id || layerId || '',
        layerName: layer?.name || ''
    };
}

function stopPreview(ctx) {
    previewRuntime?.engine?.stop();
    previewRuntime?.engine?.cleanup();
    previewRuntime = null;
    ctx.mapService?.clearTempFeatures?.();
    const map = ctx.mapService?.getMap?.();
    try {
        map?.stop();
    } catch {
        // ignore
    }
}

function syncMapChrome(mapService) {
    syncDimensionChrome(mapService?.is3DEnabled?.() ?? false);
    const basemap = mapService?.getCurrentBasemap?.();
    if (basemap) bus.emit('map:chrome', { basemap });
}

function restoreMapDimensionAfterWidget(ctx, { was3d }) {
    const mapService = ctx.mapService;
    const map = mapService?.getMap?.();
    if (!map || !mapService) return;

    if (!was3d) {
        mapService.set3DEnabled(false);
        const center = map.getCenter();
        mapService.reconcile3DState({
            camera: {
                center: [center.lng, center.lat],
                zoom: map.getZoom(),
                pitch: 0,
                bearing: 0
            },
            emitEvent: false
        });
        return;
    }

    mapService.reconcile3DState({ emitEvent: false });
}

function teardownPresentationWidget(ctx, { was3d }) {
    stopPreview(ctx);
    ctx.mapService?.cancelInteraction?.();

    const map = ctx.mapService?.getMap?.();
    const canvas = map?.getCanvas?.();
    if (canvas) canvas.style.cursor = '';

    restoreMapDimensionAfterWidget(ctx, { was3d });

    syncMapChrome(ctx.mapService);
    window.requestAnimationFrame(() => {
        ctx.mapService?.resize?.();
    });
}

async function resolveSourceBundle(ctx, layerId) {
    const presentationCtx = buildPresentationContext(ctx);
    const features = await collectSourceFeaturesForLayer(presentationCtx, layerId);
    const geometrySummary = summarizeSourceFeatures(features);
    const layerMeta = resolveLayerMeta(ctx, layerId);
    const sourceSummary = {
        ...summarizeResolvedSource(presentationCtx, features, layerMeta),
        geometryTypes: geometrySummary.geometryTypes,
        vertexCount: geometrySummary.vertexCount
    };
    return { features, sourceSummary, layerMeta };
}

function buildDefaultFormState(sourceSummary, layerId) {
    return {
        layerId: layerId || sourceSummary.layerId || '',
        animation: {
            presetId: 'none',
            durationMs: ORBIT_PACE_MS.normal,
            orbitPace: 'normal'
        },
        sourceSummary
    };
}

async function buildSceneBundle(ctx, formState) {
    const layerId = formState.layerId || getActiveLayer()?.id || '';
    const { features, sourceSummary } = await resolveSourceBundle(ctx, layerId);
    const scene = buildSceneFromConfig({
        features,
        map: ctx.mapService.getMap(),
        mapService: ctx.mapService,
        animation: formState.animation
    });
    const validation = validateSceneForUrl(scene);
    return {
        scene,
        validation,
        limits: buildLimitSummary(validation),
        url: validation.ok ? getPresentationUrl(scene) : null,
        compatiblePresets: getCompatiblePresets(features),
        sourceSummary
    };
}

export async function openPresentationLinkBuilder(ctx) {
    const was3d = ctx.mapService?.is3DEnabled?.() ?? false;
    const initialLayerId = getActiveLayer()?.id || '';
    let tornDown = false;

    const teardown = () => {
        if (tornDown) return;
        tornDown = true;
        teardownPresentationWidget(ctx, { was3d });
    };

    if (!was3d) {
        apply3DSelection(ctx.mapService, true);
    }

    await openReactIsland({
        title: 'Presentation Link',
        width: '420px',
        mountPath: '../../../react/widgets/mountPresentationLinkBuilder.jsx',
        mountExport: 'mountPresentationLinkBuilder',
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeSelectionCount: true }),
            initialLayerId,
            loadInitialState: async () => {
                const { sourceSummary } = await resolveSourceBundle(ctx, initialLayerId);
                return buildDefaultFormState(sourceSummary, initialLayerId);
            },
            onRefreshSource: (layerId) => resolveSourceBundle(ctx, layerId),
            onBuildScene: (formState) => buildSceneBundle(ctx, formState),
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI?.();
            },
            onSelectAll: (layerId) => {
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer?.geojson) return;
                ctx.mapService.selectAll(layer.id, layer.geojson);
                if ((layer.geojson.features?.length || 0) > SCENE_LIMITS.maxFeatures) {
                    ctx.showToast(
                        `Selected all ${layer.geojson.features.length} features — presentation links allow up to ${SCENE_LIMITS.maxFeatures}.`,
                        'warning'
                    );
                }
            },
            onClearSelection: (layerId) => {
                ctx.mapService.clearSelection(layerId || null);
            },
            onAddFeaturesOnMap: async (layerId) => {
                const result = await ctx.mapService.startPresentationFeaturePick?.(
                    'Click features to add · Esc when done',
                    { additive: true, layerId }
                );
                if (!result) return null;
                if (result.mode === 'additive' && result.selectionCount > 0) {
                    ctx.showToast(
                        `${result.selectionCount} feature${result.selectionCount === 1 ? '' : 's'} selected`,
                        'success'
                    );
                }
                return resolveSourceBundle(ctx, layerId);
            },
            onPreview: async (formState) => {
                stopPreview(ctx);
                const { scene, validation } = await buildSceneBundle(ctx, formState);
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
            onSubscribeLayerSelection: (layerId, callback) => {
                const refresh = () => callback(ctx.mapService.getSelectionCount(layerId) || 0);
                refresh();
                const handler = () => refresh();
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onSubscribeSourceRefresh: (onSourceChange, onMapViewChange) => {
                const map = ctx.mapService?.getMap?.();
                let moveTimer = null;
                const refreshSource = () => { void onSourceChange?.(); };
                const refreshMapView = () => {
                    window.clearTimeout(moveTimer);
                    moveTimer = window.setTimeout(() => { onMapViewChange?.(); }, 200);
                };
                const events = ['selection:changed', 'layers:changed', 'layer:active', 'layer:updated'];
                events.forEach((event) => bus.on(event, refreshSource));
                map?.on('moveend', refreshMapView);
                return () => {
                    window.clearTimeout(moveTimer);
                    events.forEach((event) => bus.off(event, refreshSource));
                    map?.off('moveend', refreshMapView);
                };
            },
            onResetPreview: () => stopPreview(ctx),
            onWidgetClose: teardown,
            onCancel: () => {
                teardown();
                close();
            }
        })
    });
}
