/**
 * Callout Builder controller.
 */

import bus from '../../core/event-bus.js';
import { createTableDataset } from '../../core/data-model.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    BOUNDARY_MODES,
    LEGEND_MODES,
    NUMBERING_MODES,
    runCalloutBuilder,
    validateCalloutBuilderInput
} from './engine.js';

/** @type {object[]} */
let previewTempEntries = [];

const BOUNDARY_MODE_OPTIONS = [
    {
        value: BOUNDARY_MODES.WHOLE_LAYER,
        label: 'Whole layer',
        tip: 'Create callouts for all matching features in selected source layers.'
    },
    {
        value: BOUNDARY_MODES.SELECTED_POLYGON,
        label: 'Selected polygon',
        tip: 'Use one selected polygon feature as the boundary.'
    },
    {
        value: BOUNDARY_MODES.SHEET_LAYER,
        label: 'Sheet / index layer',
        tip: 'Generate callouts per sheet using a polygon layer such as Plan Sheet Extents.'
    }
];

const NUMBERING_MODE_OPTIONS = [
    { value: NUMBERING_MODES.PER_BOUNDARY, label: 'Restart numbering per sheet/boundary' },
    { value: NUMBERING_MODES.GLOBAL, label: 'Global numbering across all callouts' }
];

const LEGEND_MODE_OPTIONS = [
    { value: LEGEND_MODES.FIELD_VALUE, label: 'Use field value directly' },
    { value: LEGEND_MODES.FIELD_LABEL, label: 'Prefix with field label' }
];

function clearPreviewLayers(ctx) {
    for (const entry of previewTempEntries) {
        ctx.mapService.removeTempFeature?.(entry);
    }
    previewTempEntries = [];
    ctx.mapService.clearTempFeatures?.();
}

function renderPreview(ctx, result) {
    clearPreviewLayers(ctx);
    if (!result) return;

    if (result.calloutBubbleFeatures?.length) {
        const entry = ctx.mapService.showTempFeature?.({
            type: 'FeatureCollection',
            features: result.calloutBubbleFeatures
        }, 0);
        if (entry) previewTempEntries.push(entry);
    }

    if (result.leaderLineFeatures?.length) {
        const entry = ctx.mapService.showTempFeature?.({
            type: 'FeatureCollection',
            features: result.leaderLineFeatures
        }, 0);
        if (entry) previewTempEntries.push(entry);
    }
}

function getPolygonFeatures(layer) {
    return (layer?.geojson?.features || []).filter((feature) => {
        const type = feature?.geometry?.type;
        return type === 'Polygon' || type === 'MultiPolygon';
    });
}

function getSelectedPolygonFeature(ctx, layerId) {
    const layer = ctx.getLayers().find((entry) => entry.id === layerId);
    if (!layer?.geojson?.features?.length) {
        throw new Error('Boundary polygon layer has no features.');
    }

    const selected = ctx.mapService.getSelectedFeatures?.(layer.id, layer.geojson);
    const candidates = (selected?.features || []).filter((feature) => {
        const type = feature?.geometry?.type;
        return type === 'Polygon' || type === 'MultiPolygon';
    });

    if (!candidates.length) {
        throw new Error('Select one polygon feature on the boundary layer.');
    }

    if (candidates.length > 1) {
        ctx.showToast?.('Multiple polygons selected — using the first selected polygon.', 'info');
    }

    return candidates[0];
}

function buildEngineInput(ctx, config) {
    const layers = ctx.getLayers();
    const layerOptions = getSpatialLayerOptions(ctx, { includeFields: true });
    const sourceLayers = (config.sourceLayerIds || []).map((layerId) => {
        const layer = layers.find((entry) => entry.id === layerId);
        if (!layer) throw new Error(`Source layer not found: ${layerId}`);

        const fieldConfig = config.layerFieldConfig?.[layerId] || { fields: [], labels: {} };
        const calloutFields = (fieldConfig.fields || []).map((field) => ({
            field,
            label: fieldConfig.labels?.[field] || field,
            enabled: true
        }));

        const option = layerOptions.find((entry) => entry.id === layerId);

        return {
            layerId: layer.id,
            layerName: layer.name,
            features: layer.geojson?.features || [],
            availableFields: option?.fields || [],
            calloutFields
        };
    });

    const boundary = { ...config.boundary };
    let sheetFeatures = [];

    if (boundary.mode === BOUNDARY_MODES.SHEET_LAYER) {
        const sheetLayer = layers.find((entry) => entry.id === boundary.sheetLayerId);
        if (!sheetLayer) throw new Error('Sheet boundary layer not found.');
        sheetFeatures = getPolygonFeatures(sheetLayer);
    }

    if (boundary.mode === BOUNDARY_MODES.SELECTED_POLYGON) {
        boundary.polygonFeature = getSelectedPolygonFeature(ctx, boundary.boundaryLayerId);
    }

    return {
        boundary,
        sourceLayers,
        sheetFeatures,
        numbering: config.numbering,
        legend: config.legend,
        placement: config.placement
    };
}

function addOutputLayers(ctx, result, baseName = 'Callout Builder') {
    const created = [];

    if (result.calloutBubbleFeatures?.length) {
        const dataset = ctx.createSpatialDataset('Callout Bubbles', {
            type: 'FeatureCollection',
            features: result.calloutBubbleFeatures
        }, { format: 'derived', widget: 'callout-builder' });
        ctx.addLayer(dataset);
        ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), {
            fit: created.length === 0,
            style: { mode: 'simple', strokeColor: '#2563eb', fillColor: '#2563eb' }
        });
        created.push(dataset);
    }

    if (result.leaderLineFeatures?.length) {
        const dataset = ctx.createSpatialDataset('Callout Leaders', {
            type: 'FeatureCollection',
            features: result.leaderLineFeatures
        }, { format: 'derived', widget: 'callout-builder' });
        ctx.addLayer(dataset);
        ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), {
            style: { mode: 'simple', strokeColor: '#64748b', strokeWidth: 1.5 }
        });
        created.push(dataset);
    }

    if (result.legendRows?.length) {
        const table = createTableDataset(
            'Callout Legend',
            result.legendRows,
            null,
            { format: 'derived', widget: 'callout-builder' }
        );
        ctx.addLayer(table);
        created.push(table);
    }

    if (result.auditRows?.length) {
        const audit = createTableDataset(
            `${baseName} Audit`,
            result.auditRows,
            null,
            { format: 'derived', widget: 'callout-builder', kind: 'audit' }
        );
        ctx.addLayer(audit);
        created.push(audit);
    }

    if (created.length) {
        ctx.refreshUI?.();
    }

    return created;
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 */
export async function openCalloutBuilder(ctx) {
    await openReactIsland({
        title: 'Callout Builder',
        width: '580px',
        mountPath: '../../../react/widgets/mountCalloutBuilderDialog.jsx',
        mountExport: 'mountCalloutBuilderDialog',
        onClose: () => clearPreviewLayers(ctx),
        getProps: (close) => ({
            layers: getSpatialLayerOptions(ctx, { includeFields: true }),
            polygonLayers: getSpatialLayerOptions(ctx, { includeFields: true, requirePolygons: true }),
            boundaryModeOptions: BOUNDARY_MODE_OPTIONS,
            numberingModeOptions: NUMBERING_MODE_OPTIONS,
            legendModeOptions: LEGEND_MODE_OPTIONS,
            defaultBoundaryMode: BOUNDARY_MODES.WHOLE_LAYER,
            onCancel: () => {
                clearPreviewLayers(ctx);
                close();
            },
            onLayerFocus: (layerId) => {
                if (!layerId) return;
                ctx.setActiveLayer?.(layerId);
                ctx.mapService.setActiveLayerId?.(layerId);
                ctx.refreshUI?.();
            },
            onSubscribeSelection: (layerId, callback) => {
                const refresh = () => callback(ctx.mapService.getSelectionCount(layerId) || 0);
                refresh();
                const handler = () => refresh();
                bus.on('selection:changed', handler);
                return () => bus.off('selection:changed', handler);
            },
            onPreview: async (config) => {
                const input = buildEngineInput(ctx, config);
                const validation = validateCalloutBuilderInput(input);
                if (validation.errors.length) {
                    throw new Error(validation.errors[0]);
                }

                const result = runCalloutBuilder(input);
                if (result.errors?.length) {
                    throw new Error(result.errors[0]);
                }

                renderPreview(ctx, result);
                return result;
            },
            onCreateOutput: async (config) => {
                const input = buildEngineInput(ctx, config);
                const validation = validateCalloutBuilderInput(input);
                if (validation.errors.length) {
                    throw new Error(validation.errors[0]);
                }

                const result = runCalloutBuilder(input);
                if (result.errors?.length) {
                    throw new Error(result.errors[0]);
                }

                if (!result.calloutBubbleFeatures?.length) {
                    throw new Error('No callouts were created. Check selected fields and boundaries.');
                }

                const created = addOutputLayers(ctx, result);
                clearPreviewLayers(ctx);

                ctx.showToast?.(
                    `Created ${created.length} callout output layer${created.length === 1 ? '' : 's'} (${result.summary?.calloutCount ?? 0} callouts).`,
                    'success'
                );

                return {
                    created,
                    message: `Created ${created.length} output layer(s).`,
                    result
                };
            }
        })
    });
}
