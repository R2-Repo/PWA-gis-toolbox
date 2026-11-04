import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import {
    buildProducedResult,
    emitProducedResult,
    inferLayerGeometryTypes,
    sendResultToTarget
} from '../../tools/tool-result-interop.js';
import { fetchMilepostSelection, searchMilepostRoutes } from './query.js';

/** Preview and add go through ctx.mapService so the dual-screen map bridge can forward them. */
function clearPreview(ctx) {
    ctx.mapService?.clearTempFeatures?.();
}

function showPreview(ctx, geojson) {
    clearPreview(ctx);
    if (typeof ctx.mapService?.showTempFeature !== 'function') {
        throw new Error('Map preview is unavailable.');
    }
    ctx.mapService.showTempFeature(geojson, 0);
}

function fitPreviewBounds(ctx, geojson) {
    const turfLib = ctx.turf || globalThis.turf;
    if (!turfLib?.bbox || !geojson?.features?.length) return;
    try {
        const bbox = turfLib.bbox(geojson);
        ctx.mapService?.fitBounds?.(
            [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
            { padding: 48, maxZoom: 14, duration: 800 }
        );
    } catch (_) { /* ignore fit errors */ }
}

function cleanup(ctx) {
    clearPreview(ctx);
    ctx.mapService?.cancelInteraction?.();
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object, initialInput?: object }} [options]
 */
export async function openRouteMilepost(ctx, { restoreState = null, initialInput = null } = {}) {
    await openReactIsland({
        title: 'Route Milepost',
        width: '480px',
        mountPath: '../../../react/widgets/mountRouteMilepostDialog.jsx',
        mountExport: 'mountRouteMilepostDialog',
        onClose: () => cleanup(ctx),
        getProps: (close) => ({
            initialInput,
            initialState: restoreState,
            onSendToTarget: (targetId, result) => sendResultToTarget(ctx, targetId, result),
            onCancel: () => {
                cleanup(ctx);
                close();
            },
            onSearchRoutes: (term) => searchMilepostRoutes(term),
            onPreview: (input) => withActivity('Loading mileposts…', async () => {
                const result = await fetchMilepostSelection(input);
                showPreview(ctx, result.preview);
                fitPreviewBounds(ctx, result.preview);
                return result;
            }),
            onRun: (payload) => withActivity('Adding milepost layer…', async () => {
                const features = payload?.features || [];
                if (!features.length) {
                    throw new Error('Preview mileposts before adding a layer.');
                }
                const layerName = payload.layerName || 'Route mileposts';
                const fc = { type: 'FeatureCollection', features };
                const dataset = ctx.createSpatialDataset(layerName, fc, { format: 'derived' });
                ctx.addLayer(dataset);
                ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: true });
                ctx.refreshUI?.();
                clearPreview(ctx);

                const geometry = inferLayerGeometryTypes(dataset);
                const producedResult = buildProducedResult('route-milepost', {
                    layerIds: dataset?.id ? [dataset.id] : [],
                    outputs: [{
                        name: 'mileposts',
                        type: 'layer',
                        ...(geometry ? { geometry } : { geometry: ['Point'] })
                    }],
                    stats: { outCount: features.length }
                });
                emitProducedResult(producedResult);
                ctx.showToast?.(`Added milepost layer: ${layerName}`, 'success');
                return { layerName, producedResult };
            })
        })
    });
}
