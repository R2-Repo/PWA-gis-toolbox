import { openReactIsland } from '../../ui/open-react-island.js';
import { withActivity } from '../../ui/app-activity.js';
import {
    buildElevationProfile,
    buildLineOfSight,
    buildTerrainFeatureCollection
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

function resultToast(result) {
    if (!result?.stats?.validCount) {
        return 'No terrain elevation was returned along this line.';
    }
    if (result.mode === 'los') {
        return result.visible ? 'Line of sight is visible.' : 'Line of sight is blocked.';
    }
    return 'Elevation profile ready.';
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object | null }} [options]
 */
export async function openTerrainProfile(ctx, options = {}) {
    const restoreState = options.restoreState || null;
    /** @type {{ srcId?: string } | null} */
    let previewEntry = null;

    const replacePreview = (geojson) => {
        if (previewEntry?.srcId) ctx.mapService.removeTempFeature?.(previewEntry);
        const entry = ctx.mapService.showTempFeature?.(geojson, 180000);
        previewEntry = entry?.srcId ? entry : null;
    };

    const closeWidget = (close) => {
        ctx.mapService.cancelInteraction?.();
        if (previewEntry?.srcId) ctx.mapService.removeTempFeature?.(previewEntry);
        previewEntry = null;
        close();
    };

    await openReactIsland({
        title: 'Terrain Profile',
        width: '480px',
        mountPath: '../../../react/widgets/mountTerrainProfileDialog.jsx',
        mountExport: 'mountTerrainProfileDialog',
        getProps: (close) => ({
            initialState: restoreState,
            onCancel: () => closeWidget(close),
            onSendToTarget: (targetId, result) => sendResultToTarget(ctx, targetId, result),
            onDrawLine: async () => {
                ctx.mapService.cancelInteraction?.();
                const geometry = await ctx.mapService.startSketchPolyline?.({
                    bannerText: 'Click to add points. Double-click or Enter to finish the profile line.',
                    onInsufficientVertices: () => ctx.showToast?.('Need at least 2 points for a profile line', 'warning')
                });
                if (!geometry?.coordinates || geometry.coordinates.length < 2) return null;
                const coordinates = geometry.coordinates.map((coord) => [coord[0], coord[1]]);
                replacePreview({
                    type: 'Feature',
                    properties: { kind: 'profile-line' },
                    geometry: { type: 'LineString', coordinates }
                });
                return coordinates;
            },
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
                const features = [];
                if (Array.isArray(observer)) {
                    features.push({
                        type: 'Feature',
                        properties: { kind: 'observer' },
                        geometry: { type: 'Point', coordinates: observer }
                    });
                }
                if (Array.isArray(target)) {
                    features.push({
                        type: 'Feature',
                        properties: { kind: 'target' },
                        geometry: { type: 'Point', coordinates: target }
                    });
                }
                if (!features.length) return;
                replacePreview({ type: 'FeatureCollection', features });
            },
            onRun: (input) => withActivity('Sampling elevation…', async () => {
                const sampleElevations = (points) => sampleElevationsFromMap(ctx, points);
                const result = input?.mode === 'los'
                    ? await buildLineOfSight({ ...input, sampleElevations })
                    : await buildElevationProfile({ ...input, sampleElevations });
                const geojson = buildTerrainFeatureCollection(result);
                if (geojson.features.length) replacePreview(geojson);
                const empty = !result.stats?.validCount;
                const blocked = result.mode === 'los' && !result.visible;
                ctx.showToast?.(resultToast(result), empty || blocked ? 'warning' : 'success');
                return result;
            }),
            onAddLayer: (result) => {
                const geojson = buildTerrainFeatureCollection(result);
                if (!geojson.features.length) {
                    ctx.showToast?.('Nothing to add', 'warning');
                    return null;
                }
                const layerName = result?.mode === 'los' ? 'Line of sight' : 'Terrain profile';
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
                        visible: result.mode === 'los' ? !!result.visible : null
                    }
                });
                emitProducedResult(producedResult);
                ctx.showToast?.(`Added ${layerName} as a layer`, 'success');
                return producedResult;
            }
        })
    });
}
