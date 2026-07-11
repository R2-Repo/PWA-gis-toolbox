/**
 * Sheet Cutter controller — preview and output layer wiring.
 */

import bus from '../../core/event-bus.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    WIDGET_ID,
    runSheetCutter
} from './engine.js';

const PREVIEW_LAYER_KEYS = ['route', 'frames', 'matchlines', 'labels', 'arrows'];
const previewEntries = new Map();

function clearPreviewLayers(ctx) {
    for (const key of PREVIEW_LAYER_KEYS) {
        const entry = previewEntries.get(key);
        if (entry) {
            ctx.mapService.removeTempFeature?.(entry);
            previewEntries.delete(key);
        }
    }
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} layer
 * @param {boolean} useSelectedOnly
 * @returns {object[]}
 */
function collectCenterlineFeatures(ctx, layer, useSelectedOnly) {
    if (!layer?.geojson?.features?.length) {
        throw new Error('Selected layer has no features.');
    }

    const isLine = (feature) => {
        const type = feature?.geometry?.type;
        return type === 'LineString' || type === 'MultiLineString';
    };

    if (!useSelectedOnly) {
        const lineFeatures = layer.geojson.features.filter(isLine);
        if (!lineFeatures.length) {
            throw new Error('Selected layer has no line features.');
        }
        return lineFeatures;
    }

    const indices = ctx.mapService.getSelectedIndices?.(layer.id) || [];
    if (!indices.length) {
        throw new Error('Select one or more line features on the map first.');
    }

    const selected = indices
        .map((index) => layer.geojson.features[index])
        .filter(isLine);

    if (!selected.length) {
        throw new Error('Selected features must be LineString or MultiLineString geometry.');
    }

    return selected;
}

/**
 * @param {object} route
 * @param {object} turf
 * @returns {object}
 */
function buildDirectionArrowFeatures(route, turf) {
    if (!route?.geometry || !turf) {
        return { type: 'FeatureCollection', features: [] };
    }

    const totalLength = turf.length(route, { units: 'feet' });
    if (totalLength <= 0) {
        return { type: 'FeatureCollection', features: [] };
    }

    const step = Math.max(100, totalLength / 12);
    const features = [];

    for (let distance = step / 2; distance < totalLength; distance += step) {
        const point = turf.along(route, distance, { units: 'feet' });
        const ahead = turf.along(route, Math.min(distance + 20, totalLength), { units: 'feet' });
        const behind = turf.along(route, Math.max(distance - 20, 0), { units: 'feet' });
        const bearing = turf.bearing(behind, ahead);
        const tip = turf.destination(point, 25, bearing, { units: 'feet' });
        const left = turf.destination(point, 12, bearing - 150, { units: 'feet' });
        const right = turf.destination(point, 12, bearing + 150, { units: 'feet' });

        features.push(turf.lineString(
            [left.geometry.coordinates, tip.geometry.coordinates, right.geometry.coordinates],
            { feature_type: 'direction_arrow' }
        ));
    }

    return { type: 'FeatureCollection', features };
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} result
 */
function renderPreview(ctx, result) {
    clearPreviewLayers(ctx);
    if (!result?.ok) return;

    const show = (key, geojson) => {
        if (!geojson?.features?.length) return;
        const entry = ctx.mapService.showTempFeature?.(geojson, 0);
        if (entry) previewEntries.set(key, entry);
    };

    if (result.route?.geometry) {
        show('route', {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: result.route.geometry,
                properties: { feature_type: 'route' }
            }]
        });
        show('arrows', buildDirectionArrowFeatures(result.route, ctx.turf));
    }

    show('frames', {
        type: 'FeatureCollection',
        features: result.sheetExtentFeatures || []
    });

    show('matchlines', {
        type: 'FeatureCollection',
        features: result.matchlineFeatures || []
    });

    show('labels', {
        type: 'FeatureCollection',
        features: (result.sheetLabelFeatures || []).map((feature) => ({
            ...feature,
            properties: {
                ...(feature.properties || {}),
                label: feature.properties?.sheet_name || ''
            }
        }))
    });

    const allFeatures = [
        ...(result.sheetExtentFeatures || []),
        ...(result.matchlineFeatures || []),
        ...(result.sheetLabelFeatures || [])
    ];
    if (allFeatures.length && ctx.turf) {
        const bounds = ctx.turf.bbox({ type: 'FeatureCollection', features: allFeatures });
        ctx.mapService.fitBounds?.(bounds, { padding: 48, maxZoom: 16 });
    }
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} payload
 * @returns {object}
 */
function runFromPayload(ctx, payload) {
    const layer = ctx.getLayerById?.(payload.layerId) || ctx.getLayers().find((entry) => entry.id === payload.layerId);
    if (!layer) {
        throw new Error('Centerline layer not found.');
    }

    const centerlineFeatures = collectCenterlineFeatures(
        ctx,
        layer,
        payload.input?.options?.useSelectedOnly !== false
    );

    const result = runSheetCutter({
        centerlineFeatures,
        options: {
            ...payload.input.options,
            sourceLayerId: layer.id,
            sourceFeatureId: centerlineFeatures.length === 1
                ? (centerlineFeatures[0].id || centerlineFeatures[0].properties?.feature_id || '')
                : ''
        }
    });

    if (!result.ok) {
        throw new Error(result.errors[0] || 'Sheet generation failed.');
    }

    return result;
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {object} result
 * @param {string} baseName
 */
function createOutputLayers(ctx, result, baseName = 'Plan_Sheet') {
    const created = [];
    const layerDefs = [
        { name: 'Plan Sheet Extents', features: result.sheetExtentFeatures },
        { name: 'Plan Sheet Matchlines', features: result.matchlineFeatures },
        { name: 'Plan Sheet Labels', features: result.sheetLabelFeatures }
    ];

    for (const def of layerDefs) {
        if (!def.features?.length) continue;
        const dataset = ctx.createSpatialDataset(
            `${baseName}_${def.name.replace(/\s+/g, '_')}`,
            { type: 'FeatureCollection', features: def.features },
            { format: 'derived' }
        );
        ctx.addLayer(dataset);
        ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset));
        created.push(dataset);
    }

    if (!created.length) {
        throw new Error('No output features were generated.');
    }

    ctx.refreshUI();
    ctx.setActiveLayer?.(created[0].id);
    return created;
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export async function openSheetCutter(ctx) {
    await openReactIsland({
        title: 'Sheet Cutter',
        width: '580px',
        mountPath: '../../../react/widgets/mountSheetCutterDialog.jsx',
        mountExport: 'mountSheetCutterDialog',
        onClose: () => clearPreviewLayers(ctx),
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, {
                includeFields: true,
                requireLines: true,
                includeSelectionCount: true
            }),
            defaultTemplate: {
                preset: 'ARCH_D_LANDSCAPE',
                orientation: 'landscape',
                usableFrameWidth: 1600,
                usableFrameHeight: 900,
                scale: '1in=100ft',
                overlap: 100,
                corridorWidth: 300,
                rotationMode: 'follow-centerline',
                prefix: 'C-',
                startNumber: 101,
                increment: 1,
                padLength: 0,
                aheadTemplate: 'MATCHLINE - SEE SHEET {nextSheet}',
                backTemplate: 'MATCHLINE - SEE SHEET {previousSheet}'
            },
            onCancel: () => {
                clearPreviewLayers(ctx);
                close();
            },
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI();
            },
            onSubscribeSelection: (layerId, callback) => {
                const refresh = () => callback(ctx.mapService.getSelectionCount(layerId) || 0);
                refresh();
                const handler = () => refresh();
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onPreview: async (payload) => {
                const result = runFromPayload(ctx, payload);
                renderPreview(ctx, result);
                if (result.warnings?.length) {
                    ctx.showToast(result.warnings[0], 'warning');
                }
                return result;
            },
            onCreateOutput: async (payload, previewResult) => {
                const result = previewResult?.ok ? previewResult : runFromPayload(ctx, payload);
                const baseName = payload.layerName || 'Plan_Sheet';
                const created = createOutputLayers(ctx, result, baseName.replace(/\s+/g, '_'));
                clearPreviewLayers(ctx);
                ctx.showToast(`Created ${created.length} sheet layer(s)`, 'success');
                close();
                return created;
            }
        })
    });
}

export { WIDGET_ID };
