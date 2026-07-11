/**
 * Plan Set Callouts controller.
 */

import { openReactIsland } from '../../ui/open-react-island.js';
import { getSpatialLayerOptions } from '../widget-context.js';
import { isProjectStationingCenterline } from '../project-stationing/route-profile.js';
import { markWidgetClosed, upsertWidgetState, getWidgetEntry } from '../widget-state-store.js';
import { openPlanProductionExport } from '../plan-production-export/controller.js';
import {
    WIDGET_ID,
    CALLOUT_STEPS,
    RULE_OPERATORS,
    createCalloutSession,
    loadDefaultCalloutProfile,
    updateCalloutProject,
    addCalloutDefinition,
    updateCalloutDefinition,
    removeCalloutDefinition,
    addCalloutRule,
    updateCalloutRule,
    removeCalloutRule,
    selectDesignLayers,
    setDesignFeatures,
    runCalloutAssignment,
    linkSheetSetFromBundle,
    linkSheetSetFromLayers,
    runSheetAwarePlacement,
    getCalloutLegend,
    getSheetPlacements,
    buildSessionExport,
    serializeCalloutSession,
    restoreCalloutSession,
    validateCalloutSession
} from './engine.js';
import { parseRouteFromLayerFeatures } from './sheet-placement-engine.js';

const PREVIEW_LAYER_PREFIX = 'callout_preview_';

function persistSession(session, open = true) {
    upsertWidgetState(WIDGET_ID, {
        open,
        state: serializeCalloutSession(session)
    });
}

function downloadTextFile(filename, content, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
}

function clearPreviewLayers(ctx) {
    for (const key of ['assigned', 'markers']) {
        ctx.mapService.removeTempLayer?.(`${PREVIEW_LAYER_PREFIX}${key}`);
    }
}

function renderAssignmentPreview(ctx, session) {
    clearPreviewLayers(ctx);
    const exportPackage = buildSessionExport(session);

    if (exportPackage.geojson?.assignments?.features?.length) {
        ctx.mapService.showTempFeature?.(
            exportPackage.geojson.assignments,
            0,
            `${PREVIEW_LAYER_PREFIX}assigned`
        );
    }

    if (exportPackage.geojson?.calloutMarkers?.features?.length) {
        ctx.mapService.showTempFeature?.(
            exportPackage.geojson.calloutMarkers,
            0,
            `${PREVIEW_LAYER_PREFIX}markers`
        );
    }
}

function collectFeaturesFromLayers(ctx, layerIds = []) {
    const features = [];
    for (const layerId of layerIds) {
        const layer = ctx.getLayerById?.(layerId) || ctx.getLayers().find((entry) => entry.id === layerId);
        if (!layer?.geojson?.features?.length) continue;
        for (const feature of layer.geojson.features) {
            features.push({
                ...feature,
                properties: {
                    ...(feature.properties || {}),
                    source_layer: layer.name
                }
            });
        }
    }
    return features;
}

function layerHasSheetFrames(layer) {
    return (layer?.geojson?.features || []).some((feature) => feature.properties?.feature_type === 'sheet_frame');
}

function resolveRouteLine(ctx, routeLayerId, featurePool = []) {
    if (routeLayerId) {
        const layer = ctx.getLayerById?.(routeLayerId) || ctx.getLayers().find((entry) => entry.id === routeLayerId);
        if (layer?.geojson?.features?.length) {
            const route = parseRouteFromLayerFeatures(layer.geojson.features);
            if (route) {
                return {
                    type: 'Feature',
                    geometry: route.geometry,
                    properties: route.properties || {}
                };
            }
            const line = layer.geojson.features.find((feature) => feature.geometry?.type === 'LineString');
            if (line) {
                return { type: 'Feature', geometry: line.geometry, properties: line.properties || {} };
            }
        }
    }

    const parsed = parseRouteFromLayerFeatures(featurePool);
    if (parsed) {
        return { type: 'Feature', geometry: parsed.geometry, properties: parsed.properties || {} };
    }

    return null;
}

/**
 * @param {import('../widget-types.js').WidgetContext} ctx
 * @param {{ restoreState?: object }} [options]
 */
export async function openPlanSetCallouts(ctx, { restoreState = null } = {}) {
    let session = restoreState
        ? restoreCalloutSession(restoreState)
        : createCalloutSession();

    const sheetCuttingEntry = getWidgetEntry('sheet-cutting');

    await openReactIsland({
        title: 'Plan Set Callouts',
        width: '620px',
        mountPath: '../../../react/widgets/mountPlanSetCalloutsDialog.jsx',
        mountExport: 'mountPlanSetCalloutsDialog',
        onClose: () => {
            clearPreviewLayers(ctx);
            markWidgetClosed(WIDGET_ID);
        },
        getProps: (close) => ({
            steps: CALLOUT_STEPS,
            ruleOperators: RULE_OPERATORS,
            designLayers: getSpatialLayerOptions(ctx),
            sheetLayers: getSpatialLayerOptions(ctx).filter((layer) => {
                const full = ctx.getLayerById?.(layer.id) || ctx.getLayers().find((entry) => entry.id === layer.id);
                return layerHasSheetFrames(full);
            }),
            stationingLayers: getSpatialLayerOptions(ctx).filter((layer) => {
                const full = ctx.getLayerById?.(layer.id) || ctx.getLayers().find((entry) => entry.id === layer.id);
                return isProjectStationingCenterline(full);
            }),
            hasLinkedSheetWidget: Boolean(sheetCuttingEntry?.state?.sheets?.sheets?.length),
            initialSession: session,
            onCancel: () => {
                clearPreviewLayers(ctx);
                markWidgetClosed(WIDGET_ID);
                close();
            },
            onCreateProject: (input) => {
                session = createCalloutSession(input);
                session = loadDefaultCalloutProfile(session);
                persistSession(session);
                return session;
            },
            onLoadProfile: () => {
                session = loadDefaultCalloutProfile(session);
                persistSession(session);
                return session;
            },
            onUpdateProject: (patch) => {
                session = updateCalloutProject(session, patch);
                persistSession(session);
                return session;
            },
            onAddDefinition: (input) => {
                session = addCalloutDefinition(session, input);
                persistSession(session);
                return session;
            },
            onUpdateDefinition: (calloutId, patch) => {
                session = updateCalloutDefinition(session, calloutId, patch);
                persistSession(session);
                return session;
            },
            onRemoveDefinition: (calloutId) => {
                session = removeCalloutDefinition(session, calloutId);
                persistSession(session);
                return session;
            },
            onAddRule: (input) => {
                session = addCalloutRule(session, input);
                persistSession(session);
                return session;
            },
            onUpdateRule: (ruleId, patch) => {
                session = updateCalloutRule(session, ruleId, patch);
                persistSession(session);
                return session;
            },
            onRemoveRule: (ruleId) => {
                session = removeCalloutRule(session, ruleId);
                persistSession(session);
                return session;
            },
            onSelectDesignLayers: (layerIds) => {
                session = selectDesignLayers(session, layerIds);
                const features = collectFeaturesFromLayers(ctx, layerIds);
                session = setDesignFeatures(session, features);
                persistSession(session);
                return session;
            },
            onRunAssignment: () => {
                session = runCalloutAssignment(session);
                renderAssignmentPreview(ctx, session);
                persistSession(session);
                return session;
            },
            onLinkSheetSetFromWidget: () => {
                const entry = getWidgetEntry('sheet-cutting');
                if (!entry?.state) {
                    throw new Error('Open Sheet Cutter and generate sheets first, or link sheet layers from the map.');
                }
                session = linkSheetSetFromBundle(session, entry.state);
                persistSession(session);
                return session;
            },
            onLinkSheetSetFromLayers: (sheetLayerIds, routeLayerId) => {
                const features = collectFeaturesFromLayers(ctx, sheetLayerIds);
                const routeLine = resolveRouteLine(ctx, routeLayerId, features);
                if (!routeLine) {
                    throw new Error('Select a route centerline layer for sheet-aware placement.');
                }
                session = linkSheetSetFromLayers(session, features, routeLine, sheetLayerIds);
                persistSession(session);
                return session;
            },
            onRunSheetPlacement: () => {
                session = runSheetAwarePlacement(session);
                renderAssignmentPreview(ctx, session);
                persistSession(session);
                return session;
            },
            onGetLegend: () => getCalloutLegend(session),
            onGetSheetPlacements: () => getSheetPlacements(session),
            onValidate: () => validateCalloutSession(session),
            onExportPackage: () => {
                const exportPackage = buildSessionExport(session);
                const base = session.project.projectName || 'plan_callouts';
                downloadTextFile(`${base}_assignments.csv`, exportPackage.csv.assignments, 'text/csv');
                downloadTextFile(`${base}_legend.csv`, exportPackage.csv.legend, 'text/csv');
                if (exportPackage.csv.perSheetTables) {
                    downloadTextFile(`${base}_per_sheet_callouts.csv`, exportPackage.csv.perSheetTables, 'text/csv');
                }
                downloadTextFile(`${base}_callouts.json`, JSON.stringify(exportPackage, null, 2), 'application/json');
                ctx.showToast('Callout export files downloaded', 'success');
                return exportPackage;
            },
            onAddResultLayers: () => {
                const exportPackage = buildSessionExport(session);
                const created = [];
                const baseName = session.project.projectName || 'Plan_Callouts';

                const layerDefs = [
                    { name: `${baseName}_Callout_Assignments`, data: exportPackage.geojson.assignments },
                    { name: `${baseName}_Callout_Markers`, data: exportPackage.geojson.calloutMarkers }
                ];

                for (const def of layerDefs) {
                    if (!def.data?.features?.length) continue;
                    const dataset = ctx.createSpatialDataset(def.name, def.data, { format: 'derived' });
                    ctx.addLayer(dataset);
                    ctx.mapService.addLayer(dataset, ctx.getLayers().indexOf(dataset));
                    created.push(dataset);
                }

                if (created.length) {
                    ctx.refreshUI();
                    ctx.showToast(`Added ${created.length} callout layer(s)`, 'success');
                } else {
                    ctx.showToast('No callout layers to add', 'warning');
                }

                renderAssignmentPreview(ctx, session);
                return created;
            },
            onSaveSession: () => {
                persistSession(session);
                downloadTextFile(
                    `${session.project.projectName || 'plan_callouts'}.json`,
                    JSON.stringify(serializeCalloutSession(session), null, 2),
                    'application/json'
                );
            },
            onOpenFullPlanExport: () => {
                openPlanProductionExport(ctx);
            }
        })
    });
}
