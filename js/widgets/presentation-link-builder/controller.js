import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getActiveLayer } from '../../core/state.js';
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
    getPresentationUrl,
    listLayerIdsWithSelections,
    ORBIT_PACE_MS,
    SCENE_LIMITS,
    summarizeResolvedSource,
    summarizeSourceFeatures,
    validateSceneForUrl
} from './engine.js';

let previewRuntime = null;
/** @type {Map<string, boolean>} */
let previewHiddenLayers = new Map();

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

function selectAllLayerFeatures(mapService, layer) {
    if (!layer?.id) return;
    const mapGeojson = mapService.dataLayers?.get?.(layer.id)?.geojson;
    const features = mapGeojson?.features || layer.geojson?.features || [];
    const indices = features
        .map((feature) => feature.properties?._featureIndex)
        .filter((index) => index !== undefined && index !== null);
    if (indices.length) {
        mapService.selectFeatures(layer.id, indices);
        return;
    }
    if (layer.geojson) {
        mapService.selectAll(layer.id, layer.geojson);
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
    ctx.mapService?.disablePresentationMultiSelect?.();
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
        animation: formState.animation
    });
    const validation = validateSceneForUrl(scene);
    return {
        scene,
        validation,
        limits: buildLimitSummary(validation),
        url: validation.ok ? getPresentationUrl(scene) : null,
        compatiblePresets: getCompatiblePresets(features),
        sourceSummary,
        layerMeta
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
    ctx.mapService.enablePresentationMultiSelect?.();

    await openReactIsland({
        title: 'Presentation Link',
        width: '420px',
        mountPath: '../../../react/widgets/mountPresentationLinkBuilder.jsx',
        mountExport: 'mountPresentationLinkBuilder',
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
            onBuildScene: (formState) => buildSceneBundle(ctx, formState),
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
                selectAllLayerFeatures(ctx.mapService, layer);
                const selectedCount = ctx.mapService.getSelectionCount(layer.id) || 0;
                if (selectedCount > SCENE_LIMITS.maxFeatures) {
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
                        activeLayerId: payload?.layerId
                            || ctx.mapService.getActiveLayerId?.()
                            || getActiveLayer()?.id
                            || ''
                    });
                };
                refresh();
                const handler = (payload) => refresh(payload);
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onPreview: async (formState) => {
                stopPreview(ctx);
                const { scene, validation, layerMeta } = await buildSceneBundle(ctx, formState);
                if (!validation.ok) {
                    throw new Error(validation.tooLargeMessage || validation.errors[0]);
                }

                const map = ctx.mapService.getMap();
                if (!map) throw new Error('Map is not ready');

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
