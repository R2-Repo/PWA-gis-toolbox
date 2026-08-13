import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getActiveLayer } from '../../core/state.js';
import { getLayerFeatureCount, isWorkspaceLayer } from '../../core/data-model.js';
import drawManager from '../../map/draw-manager.js';
import { PresentationAnimationEngine } from '../../presentation/animation-engine.js';
import {
    addPresentationFeatureLayers,
    removePresentationFeatureLayers
} from '../../presentation/presentation-runtime.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    buildLimitSummary,
    buildSceneFromConfig,
    collectAllSelectedPresentationFeatures,
    getCompatiblePresets,
    getEmbedCodeForScene,
    getPresentationUrl,
    listLayerIdsWithSelections,
    ORBIT_PACE_MS,
    SCENE_LIMITS,
    summarizeExportAvailability,
    summarizeResolvedSource,
    summarizeSourceFeatures,
    validateSceneForUrl
} from './engine.js';
import {
    exportPresentationGif,
    exportPresentationVideo
} from '../../presentation/presentation-export.js';
import {
    clearPresentationLinkSceneBundle,
    getPresentationLinkSceneBundle,
    setPresentationLinkSceneBundle
} from './scene-store.js';
import {
    ensureMapInteractionHandlers,
    stopMapCamera,
    waitForMapIdle
} from '../../map/map-interaction-utils.js';

const PRESENTATION_LINK_SCENE_BUNDLE = 'presentation-link:scene-bundle';

let previewRuntime = null;
/** @type {Map<string, boolean>} */
let previewHiddenLayers = new Map();
/** @type {((bundle: object) => void) | null} */
let sceneApplier = null;

function deliverSceneBundleToUi(bundle) {
    sceneApplier?.(bundle);
    setPresentationLinkSceneBundle(bundle);
    bus.emit(PRESENTATION_LINK_SCENE_BUNDLE, bundle);
}

function syncDimensionChrome(is3d) {
    bus.emit('map:chrome', { is3d: !!is3d });
}

const PRESENTATION_MIN_PITCH = 10;

async function ensurePresentation3DView(mapService) {
    const map = mapService?.getMap?.();
    if (!map) return;

    stopMapCamera(map);
    await waitForMapIdle(map);
    ensureMapInteractionHandlers(map);

    const pitch = map.getPitch?.() ?? 0;
    const enabled = mapService.is3DEnabled?.() ?? false;

    if (!enabled || pitch < PRESENTATION_MIN_PITCH) {
        mapService.enable3D({ pitch: 30, animate: false });
    }
    syncDimensionChrome(mapService.is3DEnabled?.() ?? true);
}

function buildPresentationContext(ctx) {
    return {
        ...ctx,
        getDrawnFeature: () => drawManager.getSelectedFeatureSnapshot(),
        getActiveLayer
    };
}

function selectAllLayerFeatures(mapService, layer) {
    if (!layer?.id) return;
    const mapEntry = mapService.dataLayers?.get?.(layer.id);
    const mapGeojson = mapEntry?.geojson;
    const features = mapGeojson?.features || layer.geojson?.features || [];
    const indices = features
        .map((feature) => feature.properties?._featureIndex)
        .filter((index) => index !== undefined && index !== null)
        .map((index) => Number(index))
        .filter(Number.isFinite);

    // In-memory layers: select every feature present in the packet.
    if (indices.length && !(mapEntry?.workspace || mapEntry?.tiled || isWorkspaceLayer(layer))) {
        mapService.selectFeatures(layer.id, indices);
        return;
    }

    // Workspace / tiled layers often have an empty or viewport-only geojson packet.
    // Select a contiguous index range from the store feature count (presentation
    // caps at SCENE_LIMITS.maxFeatures — selecting millions is useless and expensive).
    if (mapEntry?.workspace || mapEntry?.tiled || isWorkspaceLayer(layer)) {
        const total = getLayerFeatureCount(layer) || 0;
        if (total <= 0) return;
        const capped = Math.min(total, SCENE_LIMITS.maxFeatures);
        mapService.selectFeatures(
            layer.id,
            Array.from({ length: capped }, (_, index) => index)
        );
        return;
    }

    if (indices.length) {
        mapService.selectFeatures(layer.id, indices);
        return;
    }
    if (layer.geojson) {
        mapService.selectAll(layer.id, layer.geojson);
    }
}

async function copyTextWithFallback(text, ctx, successToast) {
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            ctx.showToast(successToast, 'success');
            return;
        }
        throw new Error('clipboard unavailable');
    } catch {
        // Non-secure contexts and blocked clipboard APIs still need a usable path.
        ctx.showToast(text, 'info');
    }
}

function resolveFocusedLayerId(formState) {
    return formState?.focusedLayerId || getActiveLayer()?.id || '';
}

function resolveLayerMeta(ctx, layerIds) {
    const layers = ctx.getLayers?.() || [];
    const names = layerIds.map((id) => layers.find((entry) => entry.id === id)?.name).filter(Boolean);
    return {
        layerIds,
        layerNames: names,
        layerId: layerIds[0] || '',
        layerName: names[0] || ''
    };
}

function stopPreview(ctx) {
    previewRuntime?.engine?.stop();
    previewRuntime?.engine?.cleanup();
    previewRuntime = null;

    const map = ctx.mapService?.getMap?.();
    if (map) removePresentationFeatureLayers(map);
    ctx.mapService?.clearTempFeatures?.();

    if (previewHiddenLayers.size && ctx.mapService) {
        for (const [layerId, wasVisible] of previewHiddenLayers.entries()) {
            ctx.mapService.toggleLayer(layerId, wasVisible);
        }
    }
    previewHiddenLayers = new Map();

    try {
        stopMapCamera(map);
    } catch {
        // ignore
    }
    ensureMapInteractionHandlers(map);
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

    stopMapCamera(map);
    ensureMapInteractionHandlers(map);

    if (!was3d) {
        mapService.disable3D({ animate: false });
        return;
    }

    mapService.reconcile3DState({ emitEvent: false });
}

function teardownPresentationWidget(ctx, { was3d }) {
    stopPreview(ctx);
    ctx.mapService?.disablePresentationMultiSelect?.();
    ctx.mapService?.cancelInteraction?.();

    const map = ctx.mapService?.getMap?.();
    const canvas = map?.getCanvas?.();
    if (canvas) canvas.style.cursor = '';

    restoreMapDimensionAfterWidget(ctx, { was3d });
    ensureMapInteractionHandlers(map);

    syncMapChrome(ctx.mapService);
    window.requestAnimationFrame(() => {
        ctx.mapService?.resize?.();
    });
}

async function resolveSourceBundle(ctx, formState) {
    const presentationCtx = buildPresentationContext(ctx);
    const features = await collectAllSelectedPresentationFeatures(presentationCtx);
    const layerIds = listLayerIdsWithSelections(presentationCtx);
    const geometrySummary = summarizeSourceFeatures(features);
    const layerMeta = resolveLayerMeta(ctx, layerIds);
    const sourceSummary = {
        ...summarizeResolvedSource(presentationCtx, features, layerMeta),
        geometryTypes: geometrySummary.geometryTypes,
        vertexCount: geometrySummary.vertexCount
    };
    return { features, sourceSummary, layerMeta };
}

function buildDefaultFormState(sourceSummary, initialLayerId) {
    return {
        focusedLayerId: initialLayerId || sourceSummary.layerId || '',
        animation: {
            presetId: 'none',
            durationMs: ORBIT_PACE_MS.normal,
            orbitPace: 'normal'
        },
        sourceSummary
    };
}

async function buildSceneBundle(ctx, formState) {
    const { features, sourceSummary, layerMeta } = await resolveSourceBundle(ctx, formState);
    const scene = buildSceneFromConfig({
        features,
        map: ctx.mapService.getMap(),
        mapService: ctx.mapService,
        layerIds: layerMeta.layerIds,
        animation: formState.animation,
        probeLiveCamera: false
    });
    const validation = validateSceneForUrl(scene);
    const bundle = {
        scene,
        validation,
        limits: buildLimitSummary(validation),
        url: validation.ok ? getPresentationUrl(scene) : null,
        compatiblePresets: getCompatiblePresets(features),
        exportAvailability: summarizeExportAvailability(scene),
        sourceSummary,
        layerMeta
    };
    deliverSceneBundleToUi(bundle);
    return bundle;
}

async function preparePresentationPlayback(ctx, formState) {
    stopPreview(ctx);
    const bundle = await buildSceneBundle(ctx, formState);
    const { scene, validation, layerMeta } = bundle;
    if (!validation.ok) {
        throw new Error(validation.tooLargeMessage || validation.errors[0]);
    }

    const map = ctx.mapService.getMap();
    if (!map) throw new Error('Map is not ready');

    await ensurePresentation3DView(ctx.mapService);

    previewHiddenLayers = new Map();
    for (const layerId of layerMeta.layerIds) {
        const layer = (ctx.getLayers?.() || []).find((entry) => entry.id === layerId);
        previewHiddenLayers.set(layerId, layer?.visible !== false);
        ctx.mapService.toggleLayer(layerId, false);
    }

    addPresentationFeatureLayers(map, scene.features, scene.style);
    const engine = new PresentationAnimationEngine({
        map,
        features: scene.features,
        style: scene.style
    });
    previewRuntime = { engine, scene, layerMeta };
    await engine.applyCamera(scene.camera);
    return { map, engine, scene, layerMeta, bundle };
}

export async function openPresentationLinkBuilder(ctx) {
    const was3d = ctx.mapService?.is3DEnabled?.() ?? false;
    const initialLayerId = getActiveLayer()?.id || '';
    let tornDown = false;
    /** @type {object|null} */
    let latestFormState = null;
    let rebuildTimer = null;
    let rebuildRetryTimer = null;
    let unsubscribeSceneRefresh = null;

    const scheduleSceneRebuild = () => {
        if (tornDown) return;
        window.clearTimeout(rebuildTimer);
        rebuildTimer = window.setTimeout(() => {
            void flushSceneRebuild();
        }, 150);
    };

    async function flushSceneRebuild(allowRetry = true) {
        const formState = latestFormState;
        if (!formState || tornDown) return;
        const bundle = await buildSceneBundle(ctx, formState);
        const selectedCount = bundle.sourceSummary?.selectedCount ?? 0;
        const builtFeatureCount = bundle.limits?.featureCount ?? 0;
        if (allowRetry && selectedCount > 0 && builtFeatureCount === 0) {
            window.clearTimeout(rebuildRetryTimer);
            rebuildRetryTimer = window.setTimeout(() => {
                void flushSceneRebuild(false);
            }, 250);
        }
    }

    const subscribeSceneRebuild = () => {
        const rebuild = () => scheduleSceneRebuild();
        const events = ['selection:changed', 'layers:changed', 'layer:active', 'layer:updated'];
        events.forEach((event) => bus.on(event, rebuild));
        return () => {
            events.forEach((event) => bus.off(event, rebuild));
        };
    };

    const teardown = () => {
        if (tornDown) return;
        tornDown = true;
        sceneApplier = null;
        window.clearTimeout(rebuildTimer);
        window.clearTimeout(rebuildRetryTimer);
        unsubscribeSceneRefresh?.();
        unsubscribeSceneRefresh = null;
        latestFormState = null;
        clearPresentationLinkSceneBundle();
        teardownPresentationWidget(ctx, { was3d });
    };

    // Cancel any active draw/pick so _interactionCleanup does not block selection.
    ctx.mapService?.cancelInteraction?.();
    ctx.mapService.enablePresentationMultiSelect?.();
    unsubscribeSceneRefresh = subscribeSceneRebuild();

    await openReactIsland({
        title: 'Presentation Link',
        width: '420px',
        mountPath: '../../../react/widgets/mountPresentationLinkBuilder.jsx',
        mountExport: 'mountPresentationLinkBuilder',
        onOverlayDestroy: () => teardown(),
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeSelectionCount: true }),
            getLayerOptions: () => getSpatialLayerOptions(ctx, { includeSelectionCount: true }),
            initialLayerId,
            loadInitialState: async () => {
                const formState = buildDefaultFormState({}, initialLayerId);
                const { sourceSummary } = await resolveSourceBundle(ctx, formState);
                return buildDefaultFormState(sourceSummary, initialLayerId);
            },
            onRefreshSource: (formState) => resolveSourceBundle(ctx, formState),
            reportFormState: (state) => {
                if (state) latestFormState = state;
                if (state) scheduleSceneRebuild();
            },
            onRegisterSceneApplier: (applyFn) => {
                sceneApplier = applyFn;
                const current = getPresentationLinkSceneBundle();
                if (current) applyFn(current);
                return () => {
                    if (sceneApplier === applyFn) sceneApplier = null;
                };
            },
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI?.();
            },
            onSelectAll: (formState) => {
                const layerId = resolveFocusedLayerId(formState);
                const layer = ctx.getLayers().find((entry) => entry.id === layerId);
                if (!layer) return;
                const layerTotal = getLayerFeatureCount(layer) || 0;
                selectAllLayerFeatures(ctx.mapService, layer);
                const selectedCount = ctx.mapService.getSelectionCount(layer.id) || 0;
                if (layerTotal > SCENE_LIMITS.maxFeatures && selectedCount >= SCENE_LIMITS.maxFeatures) {
                    ctx.showToast(
                        `Selected first ${selectedCount} of ${layerTotal} features — presentation links allow up to ${SCENE_LIMITS.maxFeatures}.`,
                        'warning'
                    );
                } else if (selectedCount > SCENE_LIMITS.maxFeatures) {
                    ctx.showToast(
                        `Selected all ${selectedCount} features — presentation links allow up to ${SCENE_LIMITS.maxFeatures}.`,
                        'warning'
                    );
                }
            },
            onClearSelection: (formState) => {
                ctx.mapService.clearSelection(resolveFocusedLayerId(formState) || null);
            },
            onClearAllSelections: () => {
                ctx.mapService.clearSelection(null);
            },
            onSubscribeLayerSelection: (_formState, callback) => {
                const refresh = (payload) => {
                    callback({
                        count: ctx.mapService.getTotalSelectionCount?.() || 0,
                        selectionLayerId: payload?.layerId || null
                    });
                };
                refresh();
                const handler = (payload) => refresh(payload);
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onPreview: async (formState) => {
                try {
                    const { engine, scene } = await preparePresentationPlayback(ctx, formState);
                    if (scene.animations?.length) {
                        await engine.playSequence(scene.animations);
                    }
                    ctx.showToast('Preview finished', 'success');
                } finally {
                    // Restore source-layer visibility and clear presentation overlays.
                    // GIF/video already do this; Preview previously left layers hidden.
                    stopPreview(ctx);
                }
            },
            onCopyUrl: async (url) => {
                await copyTextWithFallback(url, ctx, 'Presentation URL copied');
            },
            onCopyEmbed: async (formState) => {
                const { bundle } = await buildSceneBundle(ctx, formState);
                if (!bundle.validation.ok) {
                    throw new Error(bundle.validation.tooLargeMessage || bundle.validation.errors[0]);
                }
                const embed = getEmbedCodeForScene(bundle.scene);
                await copyTextWithFallback(embed, ctx, 'Embed code copied');
            },
            onExportGif: async (formState, onProgress) => {
                const { map, engine, scene } = await preparePresentationPlayback(ctx, formState);
                try {
                    const result = await exportPresentationGif({
                        map,
                        mapService: ctx.mapService,
                        scene,
                        engine,
                        onProgress
                    });
                    ctx.showToast(`GIF saved (${result.frames} frames).`, 'success');
                    return result;
                } finally {
                    stopPreview(ctx);
                }
            },
            onExportVideo: async (formState, onProgress) => {
                const { map, engine, scene } = await preparePresentationPlayback(ctx, formState);
                try {
                    const result = await exportPresentationVideo({
                        map,
                        scene,
                        engine,
                        onProgress
                    });
                    ctx.showToast(`Video saved (${result.ext.toUpperCase()}).`, 'success');
                    return result;
                } finally {
                    stopPreview(ctx);
                }
            },
            onSubscribeSourceRefresh: (onLayerListRefresh) => {
                const events = ['selection:changed', 'layers:changed', 'layer:active', 'layer:updated'];
                events.forEach((event) => bus.on(event, onLayerListRefresh));
                onLayerListRefresh?.();
                return () => {
                    events.forEach((event) => bus.off(event, onLayerListRefresh));
                };
            },
            onResetPreview: () => stopPreview(ctx),
            onCancel: () => {
                teardown();
                close();
            }
        })
    });
}
