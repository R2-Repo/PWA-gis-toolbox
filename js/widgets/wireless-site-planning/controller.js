import { downloadBlob } from '../../export/exporter.js';
import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import {
    UNIT_LABELS,
    buildWirelessLocationsCsvTemplate,
    buildPreviewGeojson,
    buildWirelessPlanningOutputLayers,
    createDefaultPoleSectorAttributes,
    normalizeClientPoints,
    normalizePolePoints,
    runGreedyPoleSectorOptimization,
    splitFeaturesByLocationType,
    validateWirelessPlanningInputs
} from './engine.js';
import {
    buildCoverageRasterBoundsGeojson,
    buildCoverageRasters
} from './coverage-raster.js';

const ANTENNA_SECTOR_LAYER_STYLE = {
    mode: 'smart',
    fillColor: '#e879f9',
    strokeColor: '#c026d3',
    fillOpacity: 0.4,
    strokeWidth: 2,
    strokeOpacity: 0.9,
    smart: {
        defaultStyle: {
            fillColor: '#e879f9',
            strokeColor: '#c026d3',
            fillOpacity: 0.4,
            strokeWidth: 2,
            strokeOpacity: 0.9
        },
        visualVariables: [{
            id: 'antenna-indicator-color',
            type: 'unique',
            field: 'antenna_number',
            channel: 'both',
            classes: [
                { value: '1', color: '#e879f9', style: { fillColor: '#e879f9', strokeColor: '#c026d3' } },
                { value: '2', color: '#bef264', style: { fillColor: '#bef264', strokeColor: '#65a30d' } }
            ]
        }],
        filterRules: []
    }
};

function getLayerFeatures(ctx, layerId) {
    const layer = ctx.getLayers().find((l) => l.id === layerId);
    return layer?.geojson?.features || [];
}

function resolveLocationFeatures(config, ctx) {
    if (config.sourceMode === 'draw') {
        return {
            clients: config.drawnClients || [],
            poles: config.drawnPoles || [],
            splitInvalid: []
        };
    }

    const split = splitFeaturesByLocationType(getLayerFeatures(ctx, config.locationsLayerId));
    return {
        clients: split.clients,
        poles: split.poles,
        splitInvalid: split.invalid
    };
}

function buildLocationValidationStats({ clients, poles, splitInvalid = [] }, settings = {}) {
    const clientNorm = normalizeClientPoints(clients);
    const poleNorm = normalizePolePoints(poles, {
        defaultRange: settings.defaultRange,
        defaultWidth: settings.defaultSectorWidth,
        units: settings.units
    });

    return {
        clientStats: {
            total: clientNorm.total,
            valid: clientNorm.valid.length,
            invalid: clientNorm.invalid.length
        },
        poleStats: {
            total: poleNorm.total,
            valid: poleNorm.valid.length,
            invalid: poleNorm.invalid.length,
            polesWithExistingAttrs: poleNorm.withExistingAttrs,
            polesUsingDefaults: poleNorm.usingDefaults
        },
        splitInvalidCount: splitInvalid.length
    };
}

function addDerivedLayer(ctx, name, fc, options = {}) {
    const dataset = ctx.createSpatialDataset(name, fc, {
        format: 'derived',
        widget: 'wireless-site-planning',
        ...(options.source || {})
    });
    ctx.addLayer(dataset);
    const index = ctx.getLayers().indexOf(dataset);
    if (options.style) {
        ctx.mapService.setLayerStyle?.(dataset.id, options.style);
    }
    ctx.mapService.addLayer(dataset, index, { fit: options.fit ?? false });
    ctx.refreshUI();
    return dataset;
}

function addCoverageHeatmapLayer(ctx, name, coverageRasters, options = {}) {
    const boundsGeojson = buildCoverageRasterBoundsGeojson(coverageRasters);
    const dataset = ctx.createSpatialDataset(name, boundsGeojson, {
        format: 'derived',
        widget: 'wireless-site-planning',
        coverageType: 'raster',
        coverageRasters,
        ...(options.source || {})
    });
    ctx.addLayer(dataset);
    const index = ctx.getLayers().indexOf(dataset);
    if (ctx.mapService.addCoverageHeatmapLayer) {
        ctx.mapService.addCoverageHeatmapLayer(dataset, index, { fit: options.fit ?? false });
    } else {
        ctx.mapService.addLayer(dataset, index, { fit: options.fit ?? false });
    }
    ctx.refreshUI();
    return dataset;
}

function buildDrawPreviewGeojson({ drawnClients = [], drawnPoles = [] } = {}) {
    const features = [
        ...drawnClients.map((feature) => ({
            ...feature,
            properties: { ...(feature.properties || {}), _preview: 'draw_client' }
        })),
        ...drawnPoles.map((feature) => ({
            ...feature,
            properties: { ...(feature.properties || {}), _preview: 'draw_pole' }
        }))
    ];
    return { type: 'FeatureCollection', features };
}

function clearPreviewEntries(ctx, state) {
    if (state.drawPreviewEntry) {
        ctx.mapService.removeTempFeature?.(state.drawPreviewEntry);
        state.drawPreviewEntry = null;
    }
    if (state.optimizationPreviewEntry) {
        ctx.mapService.removeTempFeature?.(state.optimizationPreviewEntry);
        state.optimizationPreviewEntry = null;
    }
    ctx.mapService.clearTempFeatures?.();
}

function showWirelessPreview(ctx, geojson, coverageRasters = []) {
    return ctx.mapService.showWirelessPlanningPreview?.(geojson, { duration: 0, coverageRasters })
        ?? ctx.mapService.showTempFeature?.(geojson, 0)
        ?? null;
}

function showDrawPreview(ctx, state, geojson) {
    if (state.drawPreviewEntry) {
        ctx.mapService.removeTempFeature?.(state.drawPreviewEntry);
        state.drawPreviewEntry = null;
    }
    if (!geojson?.features?.length) return;
    state.drawPreviewEntry = showWirelessPreview(ctx, geojson);
}

function showOptimizationPreview(ctx, state, geojson, coverageRasters = []) {
    if (state.drawPreviewEntry) {
        ctx.mapService.removeTempFeature?.(state.drawPreviewEntry);
        state.drawPreviewEntry = null;
    }
    if (state.optimizationPreviewEntry) {
        ctx.mapService.removeTempFeature?.(state.optimizationPreviewEntry);
        state.optimizationPreviewEntry = null;
    }
    state.optimizationPreviewEntry = showWirelessPreview(ctx, geojson, coverageRasters);
}

function buildDrawnClientFeature(coord, seq) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coord },
        properties: {
            id: `drawn-client-${seq}`,
            name: `Client ${seq}`
        }
    };
}

function buildDrawnPoleFeature(coord, seq, settings = {}) {
    const defaults = createDefaultPoleSectorAttributes(
        parseFloat(settings.defaultRange) || 1,
        parseFloat(settings.defaultSectorWidth) || 45,
        settings.units || 'miles'
    );
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: coord },
        properties: {
            id: `drawn-pole-${seq}`,
            name: `Pole ${seq}`,
            ...defaults
        }
    };
}

function buildRunPayload(ctx, config) {
    const { clients: clientFeatures, poles: poleFeatures } = resolveLocationFeatures(config, ctx);

    const validation = validateWirelessPlanningInputs({
        clients: clientFeatures,
        poles: poleFeatures,
        settings: config.settings
    });

    if (validation.errors.length) {
        throw new Error(validation.errors[0]);
    }

    return {
        clients: validation.clientNorm.valid,
        poles: validation.poleNorm.valid,
        validation
    };
}

export async function openWirelessSitePlanning(ctx) {
    const previewState = {
        drawPreviewEntry: null,
        optimizationPreviewEntry: null
    };

    const cleanup = () => {
        clearPreviewEntries(ctx, previewState);
        ctx.mapService.cancelInteraction?.();
    };

    await openReactIsland({
        title: 'Wireless Site Planning',
        width: '560px',
        mountPath: '../../../react/widgets/mountWirelessSitePlanningDialog.jsx',
        mountExport: 'mountWirelessSitePlanningDialog',
        getProps: (close) => {
            const closeWidget = () => {
                cleanup();
                close();
            };

            return {
                closeWidget,
                onCleanup: cleanup,
                layers: getSpatialLayerOptions(ctx, { includeFields: true, requirePoints: true }),
                unitOptions: UNIT_LABELS.map((entry) => ({
                    value: entry.value,
                    label: `${entry.label} (${entry.abbr})`
                })),
                onCancel: closeWidget,
                onValidateLocations: async ({ sourceMode, locationsLayerId, drawnClients, drawnPoles, settings }) => {
                const resolved = resolveLocationFeatures(
                    { sourceMode, locationsLayerId, drawnClients, drawnPoles },
                    ctx
                );
                return buildLocationValidationStats(resolved, settings);
            },
            onUpdateDrawPreview: ({ drawnClients = [], drawnPoles = [] } = {}) => {
                const geojson = buildDrawPreviewGeojson({ drawnClients, drawnPoles });
                showDrawPreview(ctx, previewState, geojson);
            },
            onDownloadLocationsTemplate: () => {
                const csv = buildWirelessLocationsCsvTemplate();
                downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'wireless_locations_template.csv');
                ctx.showToast?.('Downloaded locations CSV template', 'success');
            },
            onStopPointDraw: () => {
                ctx.mapService.cancelInteraction?.();
            },
            onStartDrawClientPoints: async ({ onPoint } = {}) => {
                ctx.mapService.cancelInteraction?.();
                let seq = 0;
                await ctx.mapService.startContinuousPointPick?.(
                    'Click the map to add client locations (Esc or Cancel when done)',
                    (coord) => {
                        seq += 1;
                        onPoint?.(buildDrawnClientFeature(coord, seq));
                    }
                );
            },
            onStartDrawPolePoints: async ({ onPoint, settings = {} } = {}) => {
                ctx.mapService.cancelInteraction?.();
                let seq = 0;
                await ctx.mapService.startContinuousPointPick?.(
                    'Click the map to add pole locations (Esc or Cancel when done)',
                    (coord) => {
                        seq += 1;
                        onPoint?.(buildDrawnPoleFeature(coord, seq, settings));
                    }
                );
            },
            onRun: async (config) => {
                const { clients, poles, validation } = buildRunPayload(ctx, config);
                const settings = config.settings || {};

                const result = runGreedyPoleSectorOptimization(clients, poles, {
                    defaultRange: settings.defaultRange,
                    defaultSectorWidth: settings.defaultSectorWidth,
                    sectorWidthMode: settings.sectorWidthMode,
                    maxAntennasPerPole: settings.maxAntennasPerPole,
                    optimizationGoal: settings.optimizationGoal,
                    units: settings.units
                });

                const previewGeojson = buildPreviewGeojson(result, {
                    units: settings.units,
                    createAssignmentLines: settings.createAssignmentLines,
                    allPoles: poles
                });
                const coverageRasters = buildCoverageRasters(result.selectedPoles, settings.units);

                showOptimizationPreview(ctx, previewState, previewGeojson, coverageRasters);

                ctx.showToast?.(
                    `Covered ${result.summary.coveredClients} of ${result.summary.totalClients} locations (${result.summary.coveragePercent}%)`,
                    'success'
                );

                return {
                    ...result,
                    warnings: validation.warnings,
                    settings
                };
            },
            onCreateOutputs: async (result, options = {}) => {
                const settings = options.settings || result.settings || {};
                const layers = buildWirelessPlanningOutputLayers(result, {
                    units: settings.units,
                    createAssignmentLines: options.createAssignmentLines ?? settings.createAssignmentLines
                });

                let created = 0;
                let fitNext = true;

                if (layers.coverageRasters?.length) {
                    addCoverageHeatmapLayer(ctx, 'Wireless Signal Coverage', layers.coverageRasters, { fit: fitNext });
                    fitNext = false;
                    created++;
                }

                const layerDefs = [
                    { name: 'Wireless Radiation Pattern', fc: layers.sectorCoverage, style: { mode: 'simple', strokeColor: '#dc2626', strokeWidth: 2.5, fillOpacity: 0 } },
                    { name: 'Wireless Antenna Sectors', fc: layers.antennaIndicators, style: ANTENNA_SECTOR_LAYER_STYLE },
                    { name: 'Wireless Recommended Poles', fc: layers.recommendedPoles, style: { mode: 'simple', fillColor: '#ef4444', strokeColor: '#dc2626' } },
                    { name: 'Wireless Covered Clients', fc: layers.coveredClients, style: { mode: 'simple', fillColor: '#2563eb', strokeColor: '#1d4ed8', pointSymbol: 'square' } },
                    { name: 'Wireless Uncovered Clients', fc: layers.uncoveredClients, style: { mode: 'simple', fillColor: '#2563eb', strokeColor: '#1d4ed8', pointSymbol: 'square' } }
                ];

                if (options.createAssignmentLines && layers.clientAssignments.features.length) {
                    layerDefs.push({
                        name: 'Wireless Client Assignments',
                        fc: layers.clientAssignments,
                        style: { mode: 'simple', strokeColor: '#94a3b8', strokeWidth: 2 }
                    });
                }

                layerDefs.forEach((def) => {
                    if (def.fc.features.length) {
                        addDerivedLayer(ctx, def.name, def.fc, {
                            fit: fitNext,
                            style: def.style
                        });
                        fitNext = false;
                        created++;
                    }
                });

                if (!created) {
                    throw new Error('No output features to create.');
                }

                clearPreviewEntries(ctx, previewState);

                ctx.showToast?.(`Created ${created} wireless planning layer${created === 1 ? '' : 's'}.`, 'success');
            }
        };
        }
    });
}
