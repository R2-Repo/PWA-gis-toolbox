import { openReactIsland } from '../../ui/open-react-island.js';
import { UDOT_ROUTE_SEGMENT_CONFIG } from '../route-milepost-segment/config.js';
import {
    buildRouteSearchWhere,
    buildMilepostWhere,
    buildRouteIdWhere,
    chooseMilepostLayer,
    computeSegmentResult,
    locateMilepostOnRoute,
    mapRouteSearchRows,
    groupRouteSearchResults,
    selectRouteFeatures,
    validateMilepostRange
} from '../route-milepost-segment/engine.js';
import {
    searchRoutes,
    queryRouteFeaturesById,
    queryMilepostFeatures,
    validateWidgetLayerConfig,
    verifyDirectionValues
} from '../route-milepost-segment/arcgis-client.js';
import { nearestPointOnLineAny, nearestPointOnRouteLine, lineSliceAlongRoute } from '../../tools/line-geojson.js';
import {
    DEFAULT_INTERVAL_FT,
    DEFAULT_STATIONING_GRAPHICS,
    CLIP_METHODS,
    ROUTE_SOURCE_DRAWN,
    ROUTE_SOURCE_IMPORTED,
    isCustomRouteSource,
    buildDrawnRouteContext,
    buildCustomRouteContext,
    resolveCenterlineFromLayer,
    computeProjectStationing,
    buildOutputLayerName,
    formatRouteMileage,
    parseRouteMileage,
    resolvePartialMilepostClipInputs,
    resolveClipMilepostRange,
    resolveClipMilepostEndpoints,
    snapMilepostsAlongCenterline,
    buildMilepostLabelFeatures,
    DEFAULT_STATIONING_LABEL_MIN_ZOOM
} from './engine.js';
import { mergeDatasetLabelsIntoStyle } from '../../map/map-labels.js';
import { createCenterlineDrawHandlers } from '../map-draw-helpers.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { materializeSpatialLayer, getWorkingFeaturesFromLayer } from '../../tools/gis-layer-context.js';
import {
    buildRouteProfile,
    isProjectStationingCenterline,
    readRouteProfile,
    routeProfileToProperties
} from './route-profile.js';
import { importFile } from '../../import/importer.js';
import { createTableDataset } from '../../core/data-model.js';
import { createLayerGroup, assignLayersToGroup } from '../../core/layer-groups.js';
import { detectStationTableColumns, getOffsetEmbeddedSideForMapping, normalizeColumnMapping } from './table-import/station-table-detect.js';
import { validateStationTableRows, buildUnplottedRowsReport } from './table-import/station-table-validation.js';
import { enrichRouteProfileTravelDirection, suggestSideDirectionMapping } from './table-import/station-locator-name.js';

/** @type {typeof UDOT_ROUTE_SEGMENT_CONFIG} */
const activeConfig = { ...UDOT_ROUTE_SEGMENT_CONFIG };
let layersValidated = false;

const NEAR_LINE_FT = 50;

const STATIONING_LABEL_STYLE = {
    placement: 'point',
    anchor: 'center',
    offset: [0, 0],
    allowOverlap: true,
    ignorePlacement: true
};

function isCustomRouteContext(routeContext) {
    const source = routeContext?.source || routeContext?.routeRecord?.source;
    return isCustomRouteSource(source);
}

function clipCustomCenterline(routeContext) {
    const positiveLine = routeContext.routeSelection.positiveLine;
    return {
        clipMethod: CLIP_METHODS.DRAWN,
        baseCenterline: positiveLine,
        trimmedCenterline: positiveLine,
        warnings: []
    };
}

async function syncRouteContext(ctx, input, previewState) {
    if (previewState.routeContext) return previewState.routeContext;
    if (isCustomRouteSource(input?.routeSource)) {
        throw new Error('Centerline route is missing. Select, draw, or import the line again.');
    }
    await ensureLayersReady(ctx);
    previewState.routeContext = await loadRouteContext(input.routeRecord || {
        [activeConfig.routeIdField]: input.routeId,
        [activeConfig.routeAliasField]: input.routeAlias
    });
    return previewState.routeContext;
}

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
    state.previewEntry = ctx.mapService.showProjectStationingPreview?.(geojson, 0)
        ?? ctx.mapService.showRouteMilepostPreview?.(geojson, 0)
        ?? ctx.mapService.showTempFeature(geojson, 0);
}

function fitPreviewBounds(ctx, geojson) {
    if (typeof turf === 'undefined' || !geojson?.features?.length) return;
    try {
        const bbox = turf.bbox(geojson);
        ctx.mapService.fitBounds?.(
            [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
            { padding: 48, maxZoom: 14, duration: 800 }
        );
    } catch (_) { /* ignore */ }
}

function readRouteMileage(routeContext) {
    const record = routeContext?.routeRecord;
    const posLine = routeContext?.routeSelection?.positiveLine;
    const beg = parseRouteMileage(
        record?.[activeConfig.begMileageField] ?? posLine?.properties?.[activeConfig.begMileageField]
    );
    const end = parseRouteMileage(
        record?.[activeConfig.endMileageField] ?? posLine?.properties?.[activeConfig.endMileageField]
    );
    return {
        begMileage: beg,
        endMileage: end,
        begMileageFormatted: formatRouteMileage(beg),
        endMileageFormatted: formatRouteMileage(end)
    };
}

function buildClipPreviewGeojson(clipResult, routeSelection, stationResult = null, milepostOutput = null) {
    const features = [];
    if (routeSelection?.positiveLine) {
        features.push({
            ...routeSelection.positiveLine,
            properties: { ...routeSelection.positiveLine.properties, _preview: 'route' }
        });
    }
    if (clipResult?.startPoint) {
        features.push({
            ...clipResult.startPoint,
            properties: { ...clipResult.startPoint.properties, _preview: 'start_mp' }
        });
    }
    if (clipResult?.endPoint) {
        features.push({
            ...clipResult.endPoint,
            properties: { ...clipResult.endPoint.properties, _preview: 'end_mp' }
        });
    }
    const activeLine = clipResult?.trimmedCenterline || clipResult?.baseCenterline || clipResult?.mpCenterline;
    if (activeLine) {
        features.push({
            ...activeLine,
            properties: { ...activeLine.properties, _preview: 'trimmed_centerline' }
        });
    }
    if (stationResult?.centerline) {
        features.push({
            ...stationResult.centerline,
            properties: { ...stationResult.centerline.properties, _preview: 'project_centerline' }
        });
    }
    if (stationResult?.stationTicks?.length) {
        for (const tick of stationResult.stationTicks) {
            features.push({
                ...tick,
                properties: { ...tick.properties, _preview: 'station_tick' }
            });
        }
    }
    if (stationResult?.stationLabels?.length) {
        for (const lbl of stationResult.stationLabels) {
            features.push({
                ...lbl,
                properties: { ...lbl.properties, _preview: 'station_label' }
            });
        }
    }
    if (stationResult?.beginEndMarkers?.length) {
        for (const m of stationResult.beginEndMarkers) {
            features.push({
                ...m,
                properties: { ...m.properties, _preview: 'begin_end_marker' }
            });
        }
    }
    const milepostPoints = milepostOutput?.points ?? [];
    const milepostLabels = milepostOutput?.labels ?? [];
    const milepostLabelFeatures = milepostLabels.length ? milepostLabels : milepostPoints;
    for (const pt of milepostPoints) {
        features.push({
            ...pt,
            properties: { ...pt.properties, _preview: 'milepost' }
        });
    }
    for (const lbl of milepostLabelFeatures) {
        features.push({
            ...lbl,
            properties: { ...lbl.properties, _preview: 'milepost_label' }
        });
    }
    return { type: 'FeatureCollection', features };
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

    const routeAlias = routeRecord?.[activeConfig.routeAliasField] || routeId;

    return {
        routeId,
        routeAlias,
        routeRecord,
        routeFeatures,
        routeSelection
    };
}

async function buildMpClip(input, routeContext) {
    const range = validateMilepostRange(input.startMilepost, input.endMilepost);
    if (!range.valid) {
        throw new Error(range.errors?.[0] || 'Invalid milepost range.');
    }

    const layerChoice = chooseMilepostLayer(range.startMp, range.endMp, activeConfig);

    const result = computeSegmentResult({
        positiveLine: routeContext.routeSelection.positiveLine,
        negativeLine: routeContext.routeSelection.negativeLine,
        milepostFeatures: [],
        startMp: range.startMp,
        endMp: range.endMp,
        alignment: 'positive_direction_centerline',
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

    return {
        clipMethod: CLIP_METHODS.MILEPOST,
        mpCenterline: result.centerlineSegment,
        baseCenterline: result.centerlineSegment,
        trimmedCenterline: result.centerlineSegment,
        startPoint: result.startPoint,
        endPoint: result.endPoint,
        range,
        warnings: result.warnings || []
    };
}

function clipFullRoute(routeContext) {
    const positiveLine = routeContext.routeSelection.positiveLine;
    return {
        clipMethod: CLIP_METHODS.FULL_ROUTE,
        baseCenterline: positiveLine,
        trimmedCenterline: positiveLine,
        warnings: [...(routeContext.routeSelection.warnings || [])]
    };
}

function clipByMapPick(positiveLine, mapClipStartFt, mapClipEndFt, intervalFt = DEFAULT_INTERVAL_FT) {
    if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
    const startFt = Number(mapClipStartFt);
    const endFt = Number(mapClipEndFt);
    if (!Number.isFinite(startFt) || !Number.isFinite(endFt)) {
        throw new Error('Map clip distances are invalid.');
    }
    const startDist = Math.min(startFt, endFt);
    const endDist = Math.max(startFt, endFt);
    if (endDist - startDist < intervalFt) {
        throw new Error(`Picked segment must be at least ${intervalFt} ft.`);
    }
    const clipped = lineSliceAlongRoute(positiveLine, startDist, endDist, 'feet');
    return {
        clipMethod: CLIP_METHODS.MAP_PICK,
        baseCenterline: clipped,
        trimmedCenterline: clipped,
        mapClipStartFt: startDist,
        mapClipEndFt: endDist,
        warnings: []
    };
}

function hasValidMilepostRange(input) {
    if (!input.startMilepost?.trim() || !input.endMilepost?.trim()) return false;
    return validateMilepostRange(input.startMilepost, input.endMilepost).valid;
}

async function resolveClip(input, routeContext) {
    if (isCustomRouteContext(routeContext)) {
        return clipCustomCenterline(routeContext);
    }

    const positiveLine = routeContext.routeSelection.positiveLine;
    const intervalFt = Number(input.intervalFt) || DEFAULT_INTERVAL_FT;

    if (input.mapClipStartFt != null && input.mapClipEndFt != null) {
        return clipByMapPick(positiveLine, input.mapClipStartFt, input.mapClipEndFt, intervalFt);
    }

    if (hasValidMilepostRange(input)) {
        return buildMpClip(input, routeContext);
    }

    return clipFullRoute(routeContext);
}

async function resolveClipForPreview(input, routeContext) {
    if (isCustomRouteContext(routeContext)) {
        return clipCustomCenterline(routeContext);
    }

    const positiveLine = routeContext.routeSelection.positiveLine;
    const intervalFt = Number(input.intervalFt) || DEFAULT_INTERVAL_FT;
    const mileage = readRouteMileage(routeContext);

    if (input.mapClipStartFt != null && input.mapClipEndFt != null) {
        return clipByMapPick(positiveLine, input.mapClipStartFt, input.mapClipEndFt, intervalFt);
    }

    if (input.clipMode === 'full') {
        return clipFullRoute(routeContext);
    }

    const resolved = resolvePartialMilepostClipInputs(
        input.startMilepost,
        input.endMilepost,
        mileage.begMileage,
        mileage.endMileage
    );

    if (resolved.ok) {
        return buildMpClip(
            {
                ...input,
                startMilepost: resolved.startMilepost,
                endMilepost: resolved.endMilepost
            },
            routeContext
        );
    }

    return clipFullRoute(routeContext);
}

async function pickClipOnRoute(ctx, positiveLine) {
    const result = ctx.mapService.startRouteTwoPointPick
        ? await ctx.mapService.startRouteTwoPointPick(
            positiveLine,
            'Click start of clip along route',
            'Click end of clip along route'
        )
        : await (async () => {
            if (typeof turf === 'undefined') throw new Error('Turf.js not loaded');
            const pts = await ctx.mapService.startTwoPointPick(
                'Click start of clip along route',
                'Click end of clip along route'
            );
            if (!pts) return null;
            const snap1 = nearestPointOnRouteLine(turf.point(pts[0]), positiveLine, 'feet');
            const snap2 = nearestPointOnRouteLine(turf.point(pts[1]), positiveLine, 'feet');
            const loc1 = Number(snap1.properties?.location ?? 0);
            const loc2 = Number(snap2.properties?.location ?? 0);
            return {
                mapClipStartFt: Math.min(loc1, loc2),
                mapClipEndFt: Math.max(loc1, loc2)
            };
        })();

    if (!result) return null;

    const startDist = Number(result.mapClipStartFt);
    const endDist = Number(result.mapClipEndFt);
    if (!Number.isFinite(startDist) || !Number.isFinite(endDist)) {
        throw new Error('Map pick did not return valid clip distances.');
    }

    if (endDist - startDist < DEFAULT_INTERVAL_FT) {
        throw new Error(`Picked segment must be at least ${DEFAULT_INTERVAL_FT} ft.`);
    }

    return { mapClipStartFt: startDist, mapClipEndFt: endDist };
}

function filterPointsNearLine(features, line, maxDistFt = NEAR_LINE_FT) {
    if (typeof turf === 'undefined' || !line?.geometry) return features || [];
    return (features || []).filter((feature) => {
        if (!feature?.geometry) return false;
        try {
            const nearest = nearestPointOnLineAny(feature, line, 'feet');
            const dist = Number(nearest.properties?.dist ?? nearest.properties?.distance);
            if (Number.isFinite(dist)) return dist <= maxDistFt;
            const d = turf.pointToLineDistance(feature, line, { units: 'feet' });
            return d <= maxDistFt;
        } catch (_) {
            return false;
        }
    });
}

function filterPositiveMileposts(features) {
    const posVal = String(activeConfig.positiveDirectionValue).toUpperCase();
    return (features || []).filter((f) => {
        const dir = String(f?.properties?.[activeConfig.milepostDirectionField] ?? '').toUpperCase();
        return dir === posVal;
    });
}

function decorateMilepostFeatures(features) {
    return (features || []).map((f) => {
        const mp = formatRouteMileage(f.properties?.[activeConfig.milepostValueField]);
        return {
            ...f,
            properties: {
                ...f.properties,
                milepost: mp,
                name: mp
            }
        };
    });
}

const MILEPOST_POINT_COLOR = '#00ff66';

async function fetchMilepostTenths(clip, routeContext, offsetCenterline, options = {}) {
    const filterCenterline = options.filterCenterline || offsetCenterline;
    const centerlineOffsetFt = Math.max(0, Number(options.centerlineOffsetFt) || 0);
    const nearTolerance = NEAR_LINE_FT + centerlineOffsetFt;
    const mpRange = resolveClipMilepostRange(clip, routeContext, activeConfig);
    let features = [];

    if (mpRange.ok) {
        const where = buildMilepostWhere(
            routeContext.routeId,
            mpRange.minMp,
            mpRange.maxMp,
            activeConfig
        );
        features = await queryMilepostFeatures(where, 'tenth', activeConfig);
    } else {
        const where = buildRouteIdWhere(routeContext.routeId, activeConfig);
        features = await queryMilepostFeatures(where, 'tenth', activeConfig);
    }

    features = filterPositiveMileposts(features);

    if (filterCenterline) {
        features = filterPointsNearLine(features, filterCenterline, nearTolerance);
    }

    if (offsetCenterline) {
        features = snapMilepostsAlongCenterline(features, filterCenterline, offsetCenterline);
    }

    features = decorateMilepostFeatures(features);

    return features;
}

function buildMilepostOutput(milepostPoints, centerline, options = {}) {
    const points = milepostPoints || [];
    const labels = buildMilepostLabelFeatures(points, centerline, options);
    return { points, labels };
}

function buildStationingInput(input, clip, routeContext) {
    const milepostEndpoints = resolveClipMilepostEndpoints(clip, routeContext, activeConfig);
    const centerlineOffsetFt = Math.max(0, Number(input.centerlineOffsetFt) || 0);
    const centerlineOffsetSide = String(input.centerlineOffsetSide || 'right').toLowerCase() === 'left'
        ? 'left'
        : 'right';
    const labelOffsetFt = Math.max(
        0,
        Number(input.labelOffsetFt ?? DEFAULT_STATIONING_GRAPHICS.labelOffsetFt)
    );
    const labelSide = String(input.labelSide || DEFAULT_STATIONING_GRAPHICS.labelSide).toLowerCase() === 'left'
        ? 'left'
        : 'right';

    return {
        centerline: clip.trimmedCenterline || clip.baseCenterline || clip.mpCenterline,
        beginStation: input.beginStation,
        endStation: input.endStation,
        intervalFt: Number(input.intervalFt) || DEFAULT_INTERVAL_FT,
        startOffsetFt: 0,
        endOffsetFt: 0,
        centerlineOffsetFt,
        centerlineOffsetSide,
        graphics: {
            labelOffsetFt,
            labelSide,
            centerlineOffsetFt,
            centerlineOffsetSide
        },
        routeMeta: {
            routeId: routeContext.routeId,
            routeAlias: routeContext.routeAlias,
            routeDirection: routeContext.routeSelection?.positiveLine?.properties?.[activeConfig.routeDirectionField] || '',
            travelDirection: routeContext.routeRecord?.travel_direction || ''
        },
        clipMeta: {
            clipMethod: clip.clipMethod || CLIP_METHODS.FULL_ROUTE,
            mileposts: milepostEndpoints || {},
            warnings: clip.warnings || []
        }
    };
}

function buildMilepostFetchOptions(stationInput, stationResult) {
    return {
        filterCenterline: stationResult.baseCenterline || stationInput.centerline,
        centerlineOffsetFt: stationInput.centerlineOffsetFt,
        labelOffsetFt: stationInput.graphics?.labelOffsetFt,
        labelSide: stationInput.graphics?.labelSide
    };
}

function addDerivedLayer(ctx, name, fc, options = {}) {
    const dataset = ctx.createSpatialDataset(name, fc, {
        format: 'derived',
        widget: 'project-stationing',
        ...(options.source || {})
    });
    if (options._mapLabels) dataset._mapLabels = options._mapLabels;
    if (options._kmlExport) dataset._kmlExport = options._kmlExport;
    if (options._stationingProfile) dataset._stationingProfile = options._stationingProfile;
    const layerStyle = mergeDatasetLabelsIntoStyle(options.style || null, dataset);
    ctx.addLayer(dataset);
    const index = ctx.getLayers().indexOf(dataset);
    if (layerStyle && Object.keys(layerStyle).length) {
        ctx.mapService.setLayerStyle(dataset.id, layerStyle);
    }
    ctx.mapService.addLayer(dataset, index, { fit: options.fit ?? false });
    return dataset;
}

function groupOutputLayers(groupName, datasets) {
    const layers = (datasets || []).filter(Boolean);
    if (layers.length < 2) return null;

    const group = createLayerGroup(
        groupName,
        layers.map((ds) => ds.id),
        { collapsed: true, source: 'manual' }
    );
    if (!group) return null;

    assignLayersToGroup(group.id, layers);
    return group;
}

function extractRowsFromImportResult(result) {
    const ds = Array.isArray(result) ? result[0] : result;
    if (!ds) return { rows: [], fields: [] };
    const rows = ds.type === 'spatial'
        ? (ds.geojson?.features || []).map((f) => ({ ...(f.properties || {}) }))
        : (ds.rows || []);
    const fields = rows[0] ? Object.keys(rows[0]) : (ds.schema?.fields || []).map((f) => f.name);
    return { rows, fields, datasetName: ds.name || ds.source?.file || 'Station table' };
}

function getRouteLineFromLayer(layer) {
    return (layer?.geojson?.features || []).find((feature) =>
        feature?.geometry?.type === 'LineString' || feature?.geometry?.type === 'MultiLineString'
    ) || null;
}

async function plotStationTableOutput(ctx, routeLayer, routeProfile, importState, mappingOverrides, options = {}) {
    const output = await analyzeStationTableImport(
        ctx,
        routeLayer,
        routeProfile,
        importState,
        mappingOverrides,
        options
    );
    const baseName = routeProfile.route_name || routeLayer.name || 'Stationing';
    const eventName = `${baseName} Imported Events`;
    const importOutputLayers = [];

    if (output.eventPoints.length > 0) {
        importOutputLayers.push(addDerivedLayer(
            ctx,
            eventName,
            { type: 'FeatureCollection', features: output.eventPoints },
            {
                fit: true,
                _mapLabels: { field: 'name', placement: 'point', minZoom: DEFAULT_STATIONING_LABEL_MIN_ZOOM, size: 11 },
                style: {
                    mode: 'simple',
                    strokeColor: '#ff7f00',
                    fillColor: '#ff7f00',
                    pointSize: 7,
                    strokeWidth: 2,
                    fillOpacity: 0.95
                },
                source: { stationingTable: importState.datasetName }
            }
        ));
    }

    if (output.connectorLines.length > 0) {
        importOutputLayers.push(addDerivedLayer(
            ctx,
            `${baseName} Offset Connectors`,
            { type: 'FeatureCollection', features: output.connectorLines },
            {
                fit: false,
                style: {
                    mode: 'simple',
                    strokeColor: '#ff7f00',
                    strokeWidth: 2,
                    strokeOpacity: 0.75
                },
                source: { stationingTable: importState.datasetName }
            }
        ));
    }

    if (options.includeQaLines && output.qaLines.length > 0) {
        importOutputLayers.push(addDerivedLayer(
            ctx,
            `${baseName} Coordinate QA Lines`,
            { type: 'FeatureCollection', features: output.qaLines },
            {
                fit: false,
                style: {
                    mode: 'simple',
                    strokeColor: '#cc0000',
                    strokeWidth: 2,
                    strokeOpacity: 0.8
                },
                source: { stationingTable: importState.datasetName }
            }
        ));
    }

    if (output.unplottedRows.length > 0) {
        const report = createTableDataset(
            `${baseName} Unplotted Rows Report`,
            buildUnplottedRowsReport(output.unplottedRows),
            null,
            { format: 'station-table-report', stationingTable: importState.datasetName }
        );
        ctx.addLayer(report);
        importOutputLayers.push(report);
    }

    groupOutputLayers(`${baseName} Station Table`, importOutputLayers);

    ctx.refreshUI?.();
    ctx.showToast?.(
        `Plotted ${output.eventPoints.length} station table rows (${output.unplottedRows.length} unplotted).`,
        output.unplottedRows.length ? 'info' : 'success'
    );
    return output;
}

async function analyzeStationTableImport(ctx, routeLayer, routeProfile, importState, mappingOverrides = {}, plotOptions = {}) {
    const routeLine = getRouteLineFromLayer(routeLayer);
    const suggestedNaming = suggestSideDirectionMapping(routeLine, routeProfile);
    const detection = importState.detection || detectStationTableColumns(importState.rows, importState.fields);
    const mapping = normalizeColumnMapping(detection, mappingOverrides);
    const output = await validateStationTableRows(importState.rows, routeLine, routeProfile, mapping, {
        positiveOffsetMeans: 'right',
        includeQaLines: true,
        coordinateCrs: plotOptions.coordinateCrs,
        locatorNaming: plotOptions.locatorNaming,
        sideDirectionSuggestion: suggestedNaming
    });
    return {
        detection,
        mapping,
        offsetEmbeddedSide: getOffsetEmbeddedSideForMapping(importState.rows, mapping.offset),
        suggestedNaming,
        ...output
    };
}

export function buildImportStationTableProps(ctx, routeLayerOrId, options = {}) {
    const routeLayer = typeof routeLayerOrId === 'string'
        ? ctx.getLayerById?.(routeLayerOrId)
        : routeLayerOrId;
    const routeLine = getRouteLineFromLayer(routeLayer);
    const routeProfile = enrichRouteProfileTravelDirection(
        routeLine,
        readRouteProfile(routeLayer),
        { forceRecompute: true }
    );
    const suggestedNaming = suggestSideDirectionMapping(routeLine, routeProfile);
    if (!routeLayer || !routeProfile || !routeLine) {
        return null;
    }

    function buildDefaultLocatorNaming(overrides = {}) {
        return {
            routeName: routeProfile.route_name || '',
            rtDirection: suggestedNaming.rtDirection || '',
            ltDirection: suggestedNaming.ltDirection || '',
            clDirection: suggestedNaming.clDirection || suggestedNaming.rtDirection || '',
            ...overrides
        };
    }

    const importState = {
        rows: [],
        fields: [],
        detection: null,
        datasetName: 'Station table'
    };

    async function analyze(mappingOverrides = {}, plotOptions = {}) {
        const result = await analyzeStationTableImport(
            ctx,
            routeLayer,
            routeProfile,
            importState,
            mappingOverrides,
            plotOptions
        );
        return result;
    }

    return {
        routeProfile,
        suggestedNaming,
        onFileLoad: async (file, loadOptions = {}) => {
            const result = await importFile(file, { skipGuard: true, source: 'project-stationing-table' });
            const extracted = extractRowsFromImportResult(result);
            importState.rows = extracted.rows;
            importState.fields = extracted.fields;
            importState.datasetName = extracted.datasetName || file.name;
            importState.detection = detectStationTableColumns(importState.rows, importState.fields);
            const naming = loadOptions.locatorNaming || buildDefaultLocatorNaming();
            const analysis = await analyze({}, { locatorNaming: naming });
            return {
                rowCount: importState.rows.length,
                fields: importState.fields,
                datasetName: importState.datasetName,
                previewRows: importState.rows.slice(0, 5),
                ...analysis
            };
        },
        onAnalyzeMapping: async (mappingOverrides, plotOptions = {}) => analyze(mappingOverrides, plotOptions),
        onPlot: async (mappingOverrides, plotOptions = {}) => {
            const output = await plotStationTableOutput(
                ctx,
                routeLayer,
                routeProfile,
                importState,
                mappingOverrides,
                plotOptions
            );
            options.afterPlot?.(output);
            return output.summary;
        }
    };
}

export async function openImportStationTable(ctx, routeLayerOrId) {
    const routeLayer = typeof routeLayerOrId === 'string'
        ? ctx.getLayerById?.(routeLayerOrId)
        : routeLayerOrId;
    const props = buildImportStationTableProps(ctx, routeLayer, {
        afterPlot: () => {}
    });
    if (!props) {
        ctx.showToast?.('Select a Project Stationing centerline layer first.', 'error');
        return;
    }

    await openReactIsland({
        title: 'Import Station Table',
        width: '680px',
        mountPath: '../../../react/widgets/project-stationing/mountImportStationTableDialog.jsx',
        mountExport: 'mountImportStationTableDialog',
        getProps: (close) => ({
            ...props,
            onCancel: close,
            onPlot: async (mappingOverrides, plotOptions = {}) => {
                const summary = await props.onPlot(mappingOverrides, plotOptions);
                close();
                return summary;
            }
        })
    });
}

export async function openProjectStationing(ctx) {
    const previewState = { previewEntry: null, routeContext: null };
    const centerlineDraw = createCenterlineDrawHandlers(ctx);

    const cleanup = () => {
        clearPreview(ctx, previewState);
        ctx.mapService.cancelInteraction?.();
    };

    await openReactIsland({
        title: 'Project Stationing',
        width: '520px',
        mountPath: '../../../react/widgets/mountProjectStationingDialog.jsx',
        mountExport: 'mountProjectStationingDialog',
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
                const mileage = readRouteMileage(previewState.routeContext);
                const geojson = buildClipPreviewGeojson(null, previewState.routeContext.routeSelection);
                showPreview(ctx, previewState, geojson);
                fitPreviewBounds(ctx, geojson);
                return {
                    routeId: previewState.routeContext.routeId,
                    routeAlias: selection.routeLabel || previewState.routeContext.routeAlias,
                    routeSource: 'udot',
                    warnings: previewState.routeContext.routeSelection.warnings,
                    ...mileage
                };
            },
            onDrawCenterline: async ({ routeName, travelDirection }) => {
                ctx.mapService.cancelInteraction?.();
                const lineFeature = await centerlineDraw.drawCenterline();
                if (!lineFeature) return null;

                const built = buildDrawnRouteContext(lineFeature, { routeName, travelDirection });
                if (!built.ok) {
                    throw new Error(built.error || 'Unable to use drawn centerline.');
                }

                previewState.routeContext = {
                    routeId: built.routeId,
                    routeAlias: built.routeAlias,
                    routeRecord: built.routeRecord,
                    routeFeatures: [],
                    routeSelection: built.routeSelection,
                    source: ROUTE_SOURCE_DRAWN
                };

                const geojson = buildClipPreviewGeojson(null, built.routeSelection);
                showPreview(ctx, previewState, geojson);
                fitPreviewBounds(ctx, geojson);

                const lineLengthFt = typeof turf !== 'undefined'
                    ? Math.round(turf.length(lineFeature, { units: 'feet' }) * 100) / 100
                    : null;

                return {
                    routeId: built.routeId,
                    routeAlias: built.routeAlias,
                    routeSource: ROUTE_SOURCE_DRAWN,
                    routeRecord: built.routeRecord,
                    lineLengthFt,
                    warnings: []
                };
            },
            onImportCenterline: async ({ layerId, routeName, travelDirection }) => {
                const layer = ctx.getLayerById?.(layerId);
                if (!layer) {
                    throw new Error('Layer not found.');
                }

                const materialized = await materializeSpatialLayer(layer);
                if (!materialized) {
                    throw new Error('Selected layer is not a spatial layer.');
                }

                const work = getWorkingFeaturesFromLayer(materialized, 'auto', {
                    getSelectionCount: (id) => ctx.mapService.getSelectionCount?.(id) || 0,
                    getSelectedFeatures: (id, geojson) => ctx.mapService.getSelectedFeatures?.(id, geojson)
                });
                if (!work?.geojson) {
                    throw new Error('Unable to read features from the selected layer.');
                }

                const resolved = resolveCenterlineFromLayer(work.geojson, { minLengthFt: DEFAULT_INTERVAL_FT });
                if (!resolved.ok) {
                    throw new Error(resolved.error || 'Unable to use line from layer.');
                }

                const built = buildCustomRouteContext(resolved.line, {
                    routeName,
                    travelDirection,
                    sourceLayerId: layerId
                }, ROUTE_SOURCE_IMPORTED);
                if (!built.ok) {
                    throw new Error(built.error || 'Unable to use imported centerline.');
                }

                const warnings = [...(resolved.warnings || [])];
                if (work.isSelection) {
                    warnings.push(`Using ${work.count} selected feature${work.count === 1 ? '' : 's'} from the layer.`);
                }
                if (isProjectStationingCenterline(layer)) {
                    warnings.push('Selected layer was created by Project Stationing; re-stationing may duplicate metadata.');
                }

                previewState.routeContext = {
                    routeId: built.routeId,
                    routeAlias: built.routeAlias,
                    routeRecord: built.routeRecord,
                    routeFeatures: [],
                    routeSelection: built.routeSelection,
                    source: ROUTE_SOURCE_IMPORTED
                };

                const geojson = buildClipPreviewGeojson(null, built.routeSelection);
                showPreview(ctx, previewState, geojson);
                fitPreviewBounds(ctx, geojson);

                return {
                    routeId: built.routeId,
                    routeAlias: built.routeAlias,
                    routeSource: ROUTE_SOURCE_IMPORTED,
                    routeRecord: built.routeRecord,
                    lineLengthFt: resolved.lineLengthFt,
                    warnings
                };
            },
            lineLayerOptions: getSpatialLayerOptions(ctx, { requireLines: true, includeSelectionCount: true }),
            onPickClipOnRoute: async () => {
                if (!previewState.routeContext) {
                    throw new Error('Select a route first.');
                }
                ctx.mapService.cancelInteraction?.();
                return pickClipOnRoute(
                    ctx,
                    previewState.routeContext.routeSelection.positiveLine
                );
            },
            onCancelMapInteraction: () => {
                ctx.mapService.cancelInteraction?.();
            },
            onClipPreview: async (input) => {
                if (!isCustomRouteSource(input.routeSource)) {
                    await ensureLayersReady(ctx);
                }
                await syncRouteContext(ctx, input, previewState);

                const clip = await resolveClipForPreview(input, previewState.routeContext);
                const geojson = buildClipPreviewGeojson(
                    clip,
                    previewState.routeContext.routeSelection
                );
                showPreview(ctx, previewState, geojson);
                fitPreviewBounds(ctx, geojson);

                return { warnings: clip.warnings || [] };
            },
            onStationPreview: async (input) => {
                if (!isCustomRouteSource(input.routeSource)) {
                    await ensureLayersReady(ctx);
                }
                await syncRouteContext(ctx, input, previewState);

                const clip = await resolveClip(input, previewState.routeContext);
                const stationInput = buildStationingInput(input, clip, previewState.routeContext);
                const stationResult = computeProjectStationing(stationInput);
                if (!stationResult.ok) {
                    throw new Error(stationResult.errors?.[0] || 'Unable to generate stationing.');
                }

                let milepostOutput = { points: [], labels: [] };
                if (input.includeMilepostTenths) {
                    const fetchOptions = buildMilepostFetchOptions(stationInput, stationResult);
                    const milepostPoints = await fetchMilepostTenths(
                        clip,
                        previewState.routeContext,
                        stationResult.centerline,
                        fetchOptions
                    );
                    milepostOutput = buildMilepostOutput(
                        milepostPoints,
                        stationResult.centerline,
                        fetchOptions
                    );
                }

                const geojson = buildClipPreviewGeojson(
                    clip,
                    previewState.routeContext.routeSelection,
                    stationResult,
                    milepostOutput
                );
                showPreview(ctx, previewState, geojson);

                return {
                    summary: stationResult.summary,
                    warnings: [...(clip.warnings || []), ...(stationResult.warnings || [])]
                };
            },
            onRun: async (input) => {
                if (!isCustomRouteSource(input.routeSource)) {
                    await ensureLayersReady(ctx);
                }
                await syncRouteContext(ctx, input, previewState);

                const clip = await resolveClip(input, previewState.routeContext);
                const stationInput = buildStationingInput(input, clip, previewState.routeContext);
                const stationResult = computeProjectStationing(stationInput);
                if (!stationResult.ok) {
                    throw new Error(stationResult.errors?.[0] || 'Unable to generate stationing.');
                }

                const { summary } = stationResult;
                const baseName = buildOutputLayerName(
                    previewState.routeContext.routeAlias,
                    summary.beginStation,
                    summary.endStation,
                    summary.intervalFeet
                );
                const routeProfile = enrichRouteProfileTravelDirection(
                    stationResult.centerline,
                    buildRouteProfile(stationInput, stationResult)
                );
                stationResult.centerline.properties = {
                    ...stationResult.centerline.properties,
                    ...routeProfileToProperties(routeProfile)
                };

                const outputLayers = [];

                const centerlineDataset = addDerivedLayer(
                    ctx,
                    `${baseName} Centerline`,
                    { type: 'FeatureCollection', features: [stationResult.centerline] },
                    {
                        fit: true,
                        _stationingProfile: routeProfile,
                        style: {
                            mode: 'simple',
                            strokeColor: '#111111',
                            strokeWidth: 4,
                            strokeOpacity: 1
                        }
                    }
                );
                outputLayers.push(centerlineDataset);
                routeProfile.stationed_centerline_layer_id = centerlineDataset.id;
                centerlineDataset._stationingProfile = routeProfile;
                centerlineDataset.geojson.features[0].properties = {
                    ...centerlineDataset.geojson.features[0].properties,
                    stationed_centerline_layer_id: centerlineDataset.id
                };

                outputLayers.push(addDerivedLayer(
                    ctx,
                    `${baseName} Station Ticks`,
                    { type: 'FeatureCollection', features: stationResult.stationTicks },
                    {
                        fit: false,
                        style: {
                            mode: 'simple',
                            strokeColor: '#111111',
                            strokeWidth: 2,
                            strokeOpacity: 1
                        }
                    }
                ));

                outputLayers.push(addDerivedLayer(
                    ctx,
                    `${baseName} Station Labels`,
                    { type: 'FeatureCollection', features: stationResult.stationLabels },
                    {
                        fit: false,
                        _kmlExport: { labelOnly: true },
                        _mapLabels: {
                            field: 'station_label',
                            minZoom: DEFAULT_STATIONING_LABEL_MIN_ZOOM,
                            size: 11,
                            ...STATIONING_LABEL_STYLE
                        },
                        style: {
                            mode: 'simple',
                            strokeColor: '#111111',
                            fillColor: '#111111',
                            pointSize: 0,
                            strokeWidth: 0,
                            fillOpacity: 0,
                            strokeOpacity: 0
                        }
                    }
                ));

                let milepostCount = 0;
                if (input.includeMilepostTenths) {
                    const fetchOptions = buildMilepostFetchOptions(stationInput, stationResult);
                    const milepostPoints = await fetchMilepostTenths(
                        clip,
                        previewState.routeContext,
                        stationResult.centerline,
                        fetchOptions
                    );
                    const milepostOutput = buildMilepostOutput(
                        milepostPoints,
                        stationResult.centerline,
                        fetchOptions
                    );
                    milepostCount = milepostOutput.points.length;
                    if (milepostCount > 0) {
                        const useSeparateLabels = milepostOutput.labels.length > 0;
                        outputLayers.push(addDerivedLayer(
                            ctx,
                            `${baseName} Mileposts (tenth)`,
                            { type: 'FeatureCollection', features: milepostOutput.points },
                            {
                                fit: false,
                                _kmlExport: { milepost: true, labelField: useSeparateLabels ? '' : 'milepost' },
                                ...(useSeparateLabels ? {} : {
                                    _mapLabels: {
                                        field: 'milepost',
                                        minZoom: DEFAULT_STATIONING_LABEL_MIN_ZOOM,
                                        size: 10,
                                        ...STATIONING_LABEL_STYLE
                                    }
                                }),
                                style: {
                                    mode: 'simple',
                                    strokeColor: MILEPOST_POINT_COLOR,
                                    fillColor: MILEPOST_POINT_COLOR,
                                    pointSize: 4,
                                    strokeWidth: 1,
                                    fillOpacity: 1
                                }
                            }
                        ));
                        if (useSeparateLabels) {
                            outputLayers.push(addDerivedLayer(
                                ctx,
                                `${baseName} Milepost Labels`,
                                { type: 'FeatureCollection', features: milepostOutput.labels },
                                {
                                    fit: false,
                                    _kmlExport: { labelOnly: true },
                                    _mapLabels: {
                                        field: 'milepost',
                                        minZoom: DEFAULT_STATIONING_LABEL_MIN_ZOOM,
                                        size: 10,
                                        ...STATIONING_LABEL_STYLE
                                    },
                                    style: {
                                        mode: 'simple',
                                        strokeColor: '#111111',
                                        fillColor: '#111111',
                                        pointSize: 0,
                                        strokeWidth: 0,
                                        fillOpacity: 0,
                                        strokeOpacity: 0
                                    }
                                }
                            ));
                        }
                    }
                }

                groupOutputLayers(baseName, outputLayers);

                ctx.refreshUI?.();
                cleanup();
                const toastMsg = milepostCount > 0
                    ? `Created ${summary.tickCount} ticks + ${summary.labelCount} labels + ${milepostCount} milepost points`
                    : `Project stationing created: ${summary.tickCount} ticks, ${summary.labelCount} labels, ${Math.round(summary.lineLengthFeet)} ft`;
                ctx.showToast(toastMsg, 'success');
                const importTable = buildImportStationTableProps(ctx, centerlineDataset);
                return {
                    layerName: centerlineDataset.name,
                    centerlineLayerId: centerlineDataset.id,
                    routeProfile,
                    summary,
                    milepostCount,
                    importTable
                };
            }
        })
    });
}
