import { openReactIsland } from '../../ui/open-react-island.js';
import { UDOT_ROUTE_SEGMENT_CONFIG, OUTPUT_ALIGNMENT } from './config.js';
import {
    buildRouteSearchWhere,
    buildMilepostRangeWhere,
    chooseMilepostLayer,
    computeSegmentResult,
    locateMilepostOnRoute,
    mapRouteSearchRows,
    groupRouteSearchResults,
    selectRouteFeatures,
    validateMilepostRange,
    validateMilepostValue,
    buildOutputLayerName,
    readRouteMileageDisplay
} from './engine.js';
import {
    searchRoutes,
    queryRouteFeaturesById,
    validateWidgetLayerConfig,
    verifyDirectionValues
} from './arcgis-client.js';

/** @type {typeof UDOT_ROUTE_SEGMENT_CONFIG} */
let activeConfig = { ...UDOT_ROUTE_SEGMENT_CONFIG };
let layersValidated = false;

async function ensureLayersReady(ctx) {
    if (layersValidated) return;
    await validateWidgetLayerConfig(activeConfig);
    const directions = await verifyDirectionValues(activeConfig);
    if (!directions.positiveFound) {
        throw new Error(
            `No routes found with ${activeConfig.routeDirectionField} = '${activeConfig.positiveDirectionValue}'. Update config.js direction values.`
        );
    }
    layersValidated = true;
}

function clearPreview(ctx, state) {
    ctx.mapService.removeTempFeature?.(state.previewEntry);
    ctx.mapService.clearTempFeatures?.();
    state.previewEntry = null;
}

function showPreview(ctx, state, geojson) {
    clearPreview(ctx, state);
    state.previewEntry = ctx.mapService.showRouteMilepostPreview?.(geojson, 0)
        ?? ctx.mapService.showTempFeature(geojson, 0);
}

function buildPreviewGeojson(result, routeSelection) {
    const features = [];
    if (routeSelection?.positiveLine) {
        features.push({
            ...routeSelection.positiveLine,
            properties: { ...routeSelection.positiveLine.properties, _preview: 'route' }
        });
    }
    if (result?.startPoint) {
        features.push({ ...result.startPoint, properties: { ...result.startPoint.properties, _preview: 'start_mp' } });
    }
    if (result?.endPoint) {
        features.push({ ...result.endPoint, properties: { ...result.endPoint.properties, _preview: 'end_mp' } });
    }
    if (result?.centerlineSegment) {
        features.push({
            ...result.centerlineSegment,
            properties: { ...result.centerlineSegment.properties, _preview: 'centerline_segment' }
        });
    }
    return { type: 'FeatureCollection', features };
}

function fitPreviewBounds(ctx, geojson) {
    if (typeof turf === 'undefined' || !geojson?.features?.length) return;
    try {
        const bbox = turf.bbox(geojson);
        ctx.mapService.fitBounds?.(
            [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
            { padding: 48, maxZoom: 14, duration: 800 }
        );
    } catch (_) { /* ignore fit errors */ }
}

function locateMilepostPoint(routeContext, mp) {
    const located = locateMilepostOnRoute(
        routeContext.routeSelection.positiveLine,
        mp,
        routeContext.routeRecord,
        activeConfig
    );
    return located.ok ? located.point : null;
}

async function previewMileposts(ctx, previewState, input) {
    if (!previewState.routeContext) {
        throw new Error('Select a route first.');
    }

    const range = validateMilepostRange(input.startMilepost, input.endMilepost);
    const routeSelection = previewState.routeContext.routeSelection;

    if (range.valid) {
        const { result, routeContext } = await buildSegment(input, previewState.routeContext);
        const previewGeojson = buildPreviewGeojson(result, routeContext.routeSelection);
        showPreview(ctx, previewState, previewGeojson);
        fitPreviewBounds(ctx, previewGeojson);
        return {
            summary: result.summary,
            warnings: result.warnings
        };
    }

    const startResult = validateMilepostValue(input.startMilepost);
    const endResult = validateMilepostValue(input.endMilepost);

    let startPoint = null;
    let endPoint = null;

    if (startResult.valid) {
        startPoint = locateMilepostPoint(previewState.routeContext, startResult.value);
    }
    if (endResult.valid) {
        endPoint = locateMilepostPoint(previewState.routeContext, endResult.value);
    }

    if (!startPoint && !endPoint) {
        const routePreview = buildPreviewGeojson(null, routeSelection);
        showPreview(ctx, previewState, routePreview);
        return { summary: null, warnings: [] };
    }

    const previewGeojson = buildPreviewGeojson({ startPoint, endPoint }, routeSelection);
    showPreview(ctx, previewState, previewGeojson);
    fitPreviewBounds(ctx, previewGeojson);
    return { summary: null, warnings: [] };
}

async function loadRouteContext(routeRecord) {
    const routeId = routeRecord?.[activeConfig.routeIdField];
    if (!routeId) {
        throw new Error('Selected route is missing a route ID.');
    }

    const routeDirection = routeRecord?.[activeConfig.routeDirectionField] || null;
    const routeFeatures = await queryRouteFeaturesById(routeId, activeConfig, routeDirection);
    const routeSelection = selectRouteFeatures(routeFeatures, activeConfig, routeRecord);
    if (!routeSelection.positiveLine) {
        throw new Error(routeSelection.warnings[0] || 'Unable to find a matching route centerline.');
    }

    return {
        routeId,
        routeAlias: routeRecord?.[activeConfig.routeAliasField] || routeId,
        routeRecord,
        routeFeatures,
        routeSelection
    };
}

async function buildSegment(input, routeContext) {
    const range = validateMilepostRange(input.startMilepost, input.endMilepost);
    if (!range.valid) {
        throw new Error(range.errors?.[0] || 'Invalid milepost range.');
    }

    const layerChoice = chooseMilepostLayer(range.startMp, range.endMp, activeConfig);

    const alignment = OUTPUT_ALIGNMENT.POSITIVE_CENTERLINE;
    const result = computeSegmentResult({
        positiveLine: routeContext.routeSelection.positiveLine,
        negativeLine: routeContext.routeSelection.negativeLine,
        milepostFeatures: [],
        startMp: range.startMp,
        endMp: range.endMp,
        alignment,
        config: activeConfig,
        milepostLayerKey: layerChoice.layerKey,
        routeMeta: {
            routeId: routeContext.routeId,
            routeAlias: routeContext.routeAlias,
            routeRecord: routeContext.routeRecord
        },
        extraWarnings: routeContext.routeSelection.warnings
    });

    if (!result.ok) {
        throw new Error(result.errors?.[0] || 'Unable to build route segment.');
    }

    return { result, range, layerChoice, routeContext };
}

export async function openRouteMilepostSegment(ctx) {
    const previewState = { previewEntry: null, routeContext: null };

    const cleanup = () => {
        clearPreview(ctx, previewState);
        ctx.mapService.cancelInteraction?.();
    };

    await openReactIsland({
        title: 'Route Centerline',
        width: '480px',
        mountPath: '../../../react/widgets/mountRouteMilepostSegmentDialog.jsx',
        mountExport: 'mountRouteMilepostSegmentDialog',
        getProps: (close) => ({
            onCancel: () => {
                cleanup();
                close();
            },
            onSearchRoutes: async (searchText) => {
                await ensureLayersReady(ctx);
                const term = String(searchText || '').trim();
                if (term.length < 2) return [];
                const where = buildRouteSearchWhere(term, activeConfig);
                const rows = await searchRoutes(where, activeConfig);
                return groupRouteSearchResults(mapRouteSearchRows(rows, activeConfig), activeConfig);
            },
            onSelectRoute: async (routeOption) => {
                await ensureLayersReady(ctx);
                const selection = routeOption?.raw
                    ? routeOption
                    : { raw: routeOption, routeId: routeOption?.routeId, routeAlias: routeOption?.routeAlias };
                previewState.routeContext = await loadRouteContext(selection.raw || selection);
                const routePreview = buildPreviewGeojson(null, previewState.routeContext.routeSelection);
                showPreview(ctx, previewState, routePreview);
                return {
                    routeId: previewState.routeContext.routeId,
                    routeAlias: selection.routeLabel || previewState.routeContext.routeAlias,
                    warnings: previewState.routeContext.routeSelection.warnings,
                    ...readRouteMileageDisplay(previewState.routeContext, activeConfig)
                };
            },
            onMilepostPreview: async (input) => {
                await ensureLayersReady(ctx);
                if (!previewState.routeContext) {
                    previewState.routeContext = await loadRouteContext(input.routeRecord || {
                        [activeConfig.routeIdField]: input.routeId,
                        [activeConfig.routeAliasField]: input.routeAlias
                    });
                }
                return previewMileposts(ctx, previewState, input);
            },
            onPreview: async (input) => {
                await ensureLayersReady(ctx);
                if (!previewState.routeContext) {
                    previewState.routeContext = await loadRouteContext(input.routeRecord || {
                        [activeConfig.routeIdField]: input.routeId,
                        [activeConfig.routeAliasField]: input.routeAlias
                    });
                }

                const { result, routeContext } = await buildSegment(input, previewState.routeContext);
                const previewGeojson = buildPreviewGeojson(result, routeContext.routeSelection);
                showPreview(ctx, previewState, previewGeojson);
                fitPreviewBounds(ctx, previewGeojson);

                return {
                    summary: result.summary,
                    warnings: result.warnings
                };
            },
            onRun: async (input) => {
                await ensureLayersReady(ctx);
                if (!previewState.routeContext) {
                    previewState.routeContext = await loadRouteContext(input.routeRecord || {
                        [activeConfig.routeIdField]: input.routeId,
                        [activeConfig.routeAliasField]: input.routeAlias
                    });
                }

                const { result, routeContext } = await buildSegment(input, previewState.routeContext);
                const layerName = buildOutputLayerName(
                    routeContext.routeAlias,
                    result.summary.startMp,
                    result.summary.endMp,
                    result.summary.alignment
                );

                const fc = { type: 'FeatureCollection', features: [result.outputFeature] };
                const dataset = ctx.createSpatialDataset(layerName, fc, { format: 'derived' });
                ctx.addLayer(dataset);
                ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset), { fit: true });
                ctx.refreshUI?.();

                cleanup();
                ctx.showToast(`Created segment layer: ${layerName}`, 'success');
                close();
                return { layerName, summary: result.summary };
            }
        })
    });
}
