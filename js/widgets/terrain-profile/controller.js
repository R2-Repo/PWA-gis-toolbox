import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import {
    buildLineOfSight,
    buildLineOfSiteOverlayFeatures,
    buildTerrainFeatureCollection,
    normalizeTerrainView,
    terrainViewsMatch
} from './engine.js';
import {
    buildProducedResult,
    emitProducedResult,
    inferLayerGeometryTypes,
    sendResultToTarget
} from '../../tools/tool-result-interop.js';

function sampleElevationsFromMap(ctx, points) {
    const sampleElevations = ctx.mapService?.sampleElevations;
    if (typeof sampleElevations !== 'function') {
        throw new Error('Elevation sampling is not available on this map.');
    }
    return sampleElevations.call(ctx.mapService, points);
}

async function readTerrainView(ctx) {
    const capture = ctx.mapService?.captureTerrainViewState;
    if (typeof capture !== 'function') return null;
    try {
        return normalizeTerrainView(await capture.call(ctx.mapService));
    } catch {
        return null;
    }
}

function resultToast(result) {
    if (!result?.stats?.validCount) {
        return 'No terrain elevation was returned along this line.';
    }
    return result.visible ? 'Line of Site is visible.' : 'Line of Site is blocked.';
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object | null }} [options]
 */
export async function openTerrainProfile(ctx, options = {}) {
    const restoreState = options.restoreState || null;
    const previous = await readTerrainView(ctx);
    if (!previous || !previous.is3d || !previous.terrain) {
        await ctx.mapService.enable3D?.({
            animate: false,
            pitch: previous?.is3d ? previous.pitch : 30,
            bearing: previous?.bearing ?? 0
        });
    }
    const owned = await readTerrainView(ctx);

    const showOverlay = (observer, target, result) => {
        const geojson = buildLineOfSiteOverlayFeatures(observer, target, result);
        if (!geojson.features.length) {
            ctx.mapService.removeLineOfSiteOverlay?.();
            return;
        }
        ctx.mapService.showLineOfSiteOverlay?.(geojson);
    };

    let closed = false;
    /** @type {Promise<void> | null} */
    let closing = null;
    const cleanup = () => {
        if (closed) return closing;
        closed = true;
        closing = (async () => {
            ctx.mapService.cancelInteraction?.();
            ctx.mapService.removeLineOfSiteBeam?.();
            ctx.mapService.removeLineOfSiteOverlay?.();
            const now = await readTerrainView(ctx);
            if (previous && owned && now && terrainViewsMatch(owned, now)) {
                try {
                    await ctx.mapService.restoreTerrainViewState?.(previous);
                } catch {
                    /* leave the view the user changed to */
                }
            }
        })();
        return closing;
    };

    await openReactIsland({
        title: 'Line of Site',
        width: '480px',
        mountPath: '../../../react/widgets/mountTerrainProfileDialog.jsx',
        mountExport: 'mountTerrainProfileDialog',
        onOverlayDestroy: () => cleanup(),
        getProps: (close) => ({
            initialState: restoreState,
            onCancel: async () => {
                await cleanup();
                close();
            },
            onSendToTarget: (targetId, result) => sendResultToTarget(ctx, targetId, result),
            onPickPoint: async (role) => {
                ctx.mapService.cancelInteraction?.();
                const prompt = role === 'target'
                    ? 'Click the target location'
                    : 'Click the observer location';
                const coord = await ctx.mapService.startPointPick?.(prompt);
                if (!Array.isArray(coord) || coord.length < 2) return null;
                return [coord[0], coord[1]];
            },
            onPreviewPoints: (observer, target) => {
                showOverlay(observer, target, null);
            },
            onRun: (input) => withActivity('Sampling elevation…', async () => {
                const sampleElevations = (points) => sampleElevationsFromMap(ctx, points);
                try {
                    const result = await buildLineOfSight({ ...input, curvature: true, sampleElevations });
                    showOverlay(input?.observer, input?.target, result);
                    ctx.mapService.showLineOfSiteBeam?.(result.beam);
                    const empty = !result.stats?.validCount;
                    ctx.showToast?.(resultToast(result), empty || !result.visible ? 'warning' : 'success');
                    return result;
                } catch (err) {
                    ctx.mapService.removeLineOfSiteBeam?.();
                    throw err;
                }
            }),
            onAddLayer: (result) => {
                const geojson = buildTerrainFeatureCollection(result);
                if (!geojson.features.length) {
                    ctx.showToast?.('Nothing to add', 'warning');
                    return null;
                }
                const layerName = 'Line of Site';
                const dataset = ctx.createSpatialDataset(layerName, geojson, { format: 'derived' });
                ctx.addLayer(dataset);
                ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: false });
                ctx.refreshUI();
                const geometry = inferLayerGeometryTypes(dataset);
                const producedResult = buildProducedResult('terrain-profile', {
                    layerIds: [dataset.id],
                    outputs: [{
                        name: 'profile',
                        type: 'layer',
                        ...(geometry ? { geometry } : {})
                    }],
                    stats: {
                        outCount: geojson.features.length,
                        minM: result.stats?.min ?? null,
                        maxM: result.stats?.max ?? null,
                        gainM: result.stats?.gain ?? null,
                        lossM: result.stats?.loss ?? null,
                        visible: !!result.visible
                    }
                });
                emitProducedResult(producedResult);
                ctx.showToast?.(`Added ${layerName} as a layer`, 'success');
                return producedResult;
            }
        })
    });
}
